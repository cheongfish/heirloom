// The prediction and judgment screen in a real browser (pivot step 4): the page shows no
// result before the predictions are saved, then reveals and takes the verdicts.
// Runs only with PLAYWRIGHT_CORE (a playwright-core package directory) and CHROMIUM (the
// browser executable) set, as evals/acceptance/dashboard.mjs uses them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';

import { CART_HEAD, OBSERVED, SPEC, handIn, judgedTask } from '../helpers/judge-fixture.mjs';
import { judgeTask, recordPredictions } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PLAYWRIGHT_CORE, CHROMIUM } = process.env;
const skip = PLAYWRIGHT_CORE && CHROMIUM ? false : 'PLAYWRIGHT_CORE와 CHROMIUM이 없음';

/**
 * Bring a question card into view: the cards sit side by side, one in view at a time.
 * @param {any} page
 * @param {string} id
 */
const on = (page, id) => page.getByRole('button', { name: `${id}로 이동` }).click();

test('browser: predict, reveal, judge', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const { home, taskId } = await judgedTask();
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => d.accept());

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByText('먼저 결과를 예측하세요').waitFor();
  const before = await page.locator('main').innerText();
  assert.ok(!before.includes(OBSERVED.head), 'no head output on the page before the reveal');
  assert.match(before, /qty: 12, unit: 10/, 'the probe command is shown');
  const reveal = page.getByRole('button', { name: '예측 저장하고 결과 보기' });
  assert.equal(await reveal.isDisabled(), true, 'disabled until every prediction is in');

  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.base);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await reveal.click();
  await page.getByText('동작 차이').first().waitFor();
  const after = await page.locator('main').innerText();
  assert.ok(after.includes(OBSERVED.head), 'the head output is revealed');
  assert.match(after, /틀림/);
  const q1 = page.getByRole('radiogroup', { name: 'q1 판정' });
  await on(page, 'q1');
  assert.equal(await q1.getByRole('radio', { name: '예상대로' }).isDisabled(), true, 'a wrong prediction cannot be judged as expected');

  await q1.getByRole('radio', { name: '잘못 알았음' }).click();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  const q3 = page.getByRole('radiogroup', { name: 'q3 판정' });
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  const submit = page.getByRole('button', { name: /^판정 저장/ });
  assert.equal(await submit.isDisabled(), true, 'the open choice still needs an answer');
  await page.getByLabel('q4 답').fill('100으로 한다');

  // Sending back q3, which cites the spec, asks what the spec becomes and hides the lifetime.
  await on(page, 'q3');
  await q3.getByRole('radio', { name: '되돌림' }).click();
  await page.getByLabel('q3 이유').fill('경계는 10개로 둔다');
  assert.equal(await page.getByRole('radiogroup', { name: 'spec 수명' }).count(), 0, 'no lifetime while work goes back');
  assert.equal(await submit.isDisabled(), true, 'the spec choice is required');
  assert.match(await page.locator('main').innerText(), /spec 처리를 고르지 않은 질문: q3/);
  await page.getByRole('radiogroup', { name: 'q3 spec 처리' }).getByRole('radio', { name: 'spec이 틀렸다' }).click();
  assert.equal(await submit.isDisabled(), false);

  // Accepting everything instead asks for the spec's lifetime; keeping it needs an owner.
  await q3.getByRole('radio', { name: '의도와 같음' }).click();
  const lifetime = page.getByRole('radiogroup', { name: 'spec 수명' });
  await lifetime.waitFor();
  assert.equal(await lifetime.getByRole('radio', { name: '삭제' }).getAttribute('aria-checked'), 'true', 'the project default is chosen first');
  await lifetime.getByRole('radio', { name: '유지' }).click();
  assert.equal(await submit.isDisabled(), true, 'a kept spec needs an owner');
  await page.getByLabel('spec 소유자').fill('결제팀');
  await submit.click();
  await page.getByText('판정 내용').first().waitFor();
  const done = await page.locator('main').innerText();
  assert.match(done, /모두 수용/);
  assert.match(done, /머지할 때 spec: 유지 \(소유자: 결제팀\)/);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'approved');
  assert.deepEqual(errors, []);
});

test('browser: keep a fork answer in the repository and confirm a discussion', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const fakes = await tempDir('fakes');
  const state = path.join(fakes, 'gh.json');
  await writeFile(state, JSON.stringify({ api: { 'repos/acme/widgets/issues/comments/5': { body: '작은 주문은 할인하지 않는다.', user: { login: 'kim' } } } }));
  process.env.PATH = [path.join(ROOT, 'tests', 'helpers', 'fake-gh'), process.env.PATH].join(path.delimiter);
  process.env.FAKE_GH_STATE = state;
  const anchors = [{ file: 'test/small.test.mjs', test: 'small orders pay full price' }];
  const { home, taskId } = await judgedTask({
    remote: 'https://github.com/acme/widgets.git',
    baseFiles: { 'test/small.test.mjs': "import { test } from 'node:test';\ntest('small orders pay full price', () => {});\n" },
    editDraft: (d) => {
      d.questions[3].decision = { scope: ['src/cart.mjs'], anchors };
      d.discussions = [{ id: 'x1', url: 'https://github.com/acme/widgets/pull/3#issuecomment-5', quote: '작은 주문은 할인하지 않는다.', choice: '작은 주문은 할인하지 않는다', scope: ['src/cart.mjs'], anchors }];
    },
  });
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => d.accept());

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.base);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await page.getByText('동작 차이').first().waitFor();
  await on(page, 'q1');
  await page.getByRole('radiogroup', { name: 'q1 판정' }).getByRole('radio', { name: '잘못 알았음' }).click();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  await on(page, 'q3');
  await page.getByRole('radiogroup', { name: 'q3 판정' }).getByRole('radio', { name: '의도와 같음' }).click();
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  await page.getByLabel('q4 답').fill('100으로 한다');
  const keep = page.getByRole('radiogroup', { name: 'q4 남길 곳' });
  assert.equal(await keep.getByRole('radio', { name: '이 PR에서만' }).getAttribute('aria-checked'), 'true', 'kept in the PR only by default');
  await keep.getByRole('radio', { name: '저장소에 계속 유지' }).click();
  const submit = page.getByRole('button', { name: /^판정 저장/ });
  assert.match(await page.locator('main').innerText(), /확인하지 않은 토론 결정: x1/);
  assert.equal(await submit.isDisabled(), true);
  await on(page, 'x1');
  await page.getByRole('radiogroup', { name: 'x1 확인' }).getByRole('radio', { name: '확정된 결정이 맞다' }).click();
  await submit.click();
  await page.getByText('판정 내용').first().waitFor();
  assert.match(await page.locator('main').innerText(), /결정 기록 d-[0-9a-z]{8}로 남김/);
  const judgment = JSON.parse(await readFile(path.join(taskPaths(home, taskId).approvals, `${(await readEvents(taskPaths(home, taskId).events)).find((e) => e.type === 'approved')?.approvalId}.json`), 'utf8'));
  assert.equal(judgment.items.find((/** @type {any} */ i) => i.id === 'q4').keep.action, 'record');
  assert.equal(judgment.discussions[0].confirmed, true);
  assert.deepEqual(errors, []);
});

test('browser: sending the same question back a second time recommends agreeing on the design', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const { repo, home, taskId, sourceHash } = await judgedTask();
  // First round, judged without the screen: q1 goes back.
  const draft = /** @type {any} */ (await readJson(taskPaths(home, taskId).draft));
  await recordPredictions({ home, taskId, request: { draftSha256: draftDigest(draft), answers: { q1: OBSERVED.head, q2: 'yes' } } });
  await judgeTask({
    home,
    taskId,
    keystore: 'file',
    request: {
      draftSha256: draftDigest(draft),
      sourceHash,
      items: [
        { id: 'q1', verdict: 'revert', reason: '12개에도 할인이 붙어야 한다' },
        { id: 'q2', verdict: 'as-expected' },
        { id: 'q3', verdict: 'as-expected' },
        { id: 'q4', verdict: 'answered', answer: '100' },
      ],
    },
  });
  await repo.write('src/cart.mjs', CART_HEAD.replace('qty >= 100', 'qty >= 50'));
  const round2 = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] }));
  await handIn({ home, taskId, sourceHash: round2.source.hash });

  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => d.accept());

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.head);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await page.getByText('동작 차이').first().waitFor();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  await on(page, 'q3');
  await page.getByRole('radiogroup', { name: 'q3 판정' }).getByRole('radio', { name: '의도와 같음' }).click();
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  await page.getByLabel('q4 답').fill('100');
  const card = page.locator('#question-q1');
  assert.match(await card.innerText(), /이전에 1번 되돌린 질문[\s\S]*1차: 12개에도 할인이 붙어야 한다/);
  await on(page, 'q1');
  await page.getByRole('radiogroup', { name: 'q1 판정' }).getByRole('radio', { name: '되돌림' }).click();
  assert.match(await card.innerText(), /설계부터 다시 합의하세요[\s\S]*이번이 2번째 되돌림입니다/);
  await page.getByLabel('q1 이유').fill('여전히 할인이 없다');
  await page.getByRole('button', { name: /^판정 저장/ }).click();
  await page.getByText('판정 내용').first().waitFor();
  await page.getByRole('tab', { name: /개요/ }).click();
  assert.match(await page.locator('main').innerText(), /설계부터 다시 합의하세요[\s\S]*q1을 2번 되돌렸습니다[\s\S]*2차: 여전히 할인이 없다/);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'returned');
  assert.deepEqual(errors, []);
});
