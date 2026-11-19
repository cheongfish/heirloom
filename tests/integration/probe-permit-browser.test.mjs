// The probe permit screen in a real browser: every command is shown before anything runs, a
// denial needs a reason, and an allowance lets the waiting probe run start.
// Runs only with PLAYWRIGHT_CORE and CHROMIUM set, like judge-browser.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runPermittedProbes } from '../../skills/using-heirloom/lib/probe-permit.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';

const { PLAYWRIGHT_CORE, CHROMIUM } = process.env;
const skip = PLAYWRIGHT_CORE && CHROMIUM ? false : 'PLAYWRIGHT_CORE와 CHROMIUM이 없음';

test('browser: allow probe commands before they run', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const upstream = await makeRepo({ 'package.json': '{ "type": "module" }\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  repo.commitAll('a');
  const home = await tempDir('home');
  const { taskId } = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  const quiet = { ensure: async () => ({ status: 'reused', url: 'http://127.0.0.1:1/' }), open: async () => ({ opened: false }) };
  const waiting = runPermittedProbes({
    home,
    taskId,
    spec: { probes: [{ id: 'p1', title: 'a의 값', run: ['node', '-e', "import('./src/a.mjs').then((m) => console.log(m.a))"] }] },
    timeoutMs: 60_000,
    pollMs: 50,
    ...quiet,
  });

  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByText('탐침 실행 허락 대기').waitFor();
  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByRole('heading', { name: '탐침 실행 허락' }).waitFor();
  const text = await page.locator('main').innerText();
  assert.match(text, /새 명령/);
  assert.match(text, /탐침 p1: a의 값/);
  assert.match(text, /node -e "import\('\.\/src\/a\.mjs'\)/, 'the whole command is shown');
  assert.equal(await page.getByRole('button', { name: '거절' }).isDisabled(), true, 'a denial needs a reason');
  await page.getByRole('button', { name: '허락하고 실행' }).click();
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /이 명령들을 base와 head 임시 worktree에서 실행해도 될까요\?/);
  await dialog.getByRole('button', { name: '실행', exact: true }).click();
  const out = /** @type {any} */ (await waiting);
  assert.equal(out.permission.state, 'allowed');
  assert.equal(out.probes[0].head.stdout, '2\n');
  await page.getByRole('heading', { name: '탐침 실행 허락' }).waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});
