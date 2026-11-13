// 수용 점검에서 사람 대신 대시보드 화면을 조작한다. 헤드리스 Chromium으로 실제 화면을 열고
// 단추·입력을 눌러 승인한다. API를 직접 부르지 않으므로 화면 동작까지 함께 확인된다.
//
//   node dashboard.mjs <url> [--steps '<JSON 배열>'] [--shot <png>] [--text]
//
// 환경 변수:
//   PLAYWRIGHT_CORE  playwright-core 패키지 디렉터리 (npx로 받은 것 등)
//   CHROMIUM         Chromium 실행 파일 (예: ~/.cache/ms-playwright/chromium-1187/chrome-linux/chrome)
//
// 단계(steps)의 종류:
//   { "tab": "결정" }                              탭 이름(화면 표시)으로 탭 열기
//   { "decide": "결정 항목 1", "value": "승인" }      카드(aria-label 앞부분)의 승인/거절/보류
//   { "fill": "<입력 aria-label>", "value": "…", "nth": 0 }  입력 채우기
//   { "click": "<단추 이름>", "nth": 0 }            단추 누르기 (확인창은 자동 수락)
//   { "wait": 1000 }                               ms 기다리기
//   { "waitText": "…" }                            본문에 글자가 나타날 때까지 기다리기 (최대 60초)
//   { "exec": "<셸 명령>" }                          화면을 연 채로 명령 실행 (검토 중 변경 흉내)
// 끝나면 본문 글자(--text)와 화면 캡처(--shot)를 남기고, 각 단계의 결과를 JSON으로 출력한다.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { steps: { type: 'string' }, shot: { type: 'string' }, text: { type: 'boolean' } },
});
const url = positionals[0];
if (!url) {
  console.error('usage: dashboard.mjs <url> [--steps JSON] [--shot file.png] [--text]');
  process.exit(2);
}
if (!process.env.PLAYWRIGHT_CORE || !process.env.CHROMIUM) {
  console.error('PLAYWRIGHT_CORE와 CHROMIUM 환경 변수가 필요함');
  process.exit(2);
}
const pw = await import(pathToFileURL(path.join(process.env.PLAYWRIGHT_CORE, 'index.mjs')).href);
const { chromium } = pw.default ?? pw;

/** @type {any[]} */
const steps = values.steps ? JSON.parse(values.steps) : [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
/** @type {string[]} */
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('dialog', (d) => void d.accept());
/** @type {any[]} */
const log = [];
let ok = true;
try {
  // The page keeps an event stream open, so "network idle" never comes: wait for the load
  // and give the first fetch a moment.
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  for (const step of steps) {
    try {
      if (step.tab) await page.getByRole('tab', { name: new RegExp(`^${escape(step.tab)}`) }).first().click();
      else if (step.decide) {
        const card = page.locator(`article[aria-label^="${step.decide}"]`).first();
        await card.getByRole('radio', { name: step.value }).first().click();
      } else if (step.fill) await page.getByLabel(step.fill, { exact: true }).nth(step.nth ?? 0).fill(step.value);
      else if (step.click) await page.getByRole('button', { name: step.click, exact: true }).nth(step.nth ?? 0).click();
      else if (step.wait) await page.waitForTimeout(step.wait);
      else if (step.exec) log.push({ exec: execSync(step.exec, { encoding: 'utf8', shell: '/bin/bash' }).trim() });
      else if (step.waitText) await page.getByText(step.waitText).first().waitFor({ timeout: 60_000 });
      else throw new Error(`알 수 없는 단계: ${JSON.stringify(step)}`);
      await page.waitForTimeout(300);
      log.push({ step, ok: true });
    } catch (err) {
      ok = false;
      log.push({ step, ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) });
      break;
    }
  }
  await page.waitForTimeout(800);
  if (values.shot) await page.screenshot({ path: values.shot, fullPage: true });
  const text = values.text ? await page.locator('body').innerText() : undefined;
  process.stdout.write(`${JSON.stringify({ ok, url: page.url(), steps: log, consoleErrors, text }, null, 2)}\n`);
} finally {
  await browser.close();
}
process.exitCode = ok ? 0 : 1;

/** @param {string} s */
function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
