// Opening the dashboard: once per task after submit, every time on explicit request (MVP-PLAN 6.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { openDashboard } from '../../skills/using-heirloom/lib/dashboard-open.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { submitAndOpen } from '../../skills/using-heirloom/lib/submit.mjs';

const fakeServer = async () => ({ status: /** @type {const} */ ('reused'), url: 'http://127.0.0.1:17380/', pid: 1 });

/** @param {{ opened: boolean, command?: string, reason?: string }} [result] */
function recorder(result = { opened: true, command: 'xdg-open' }) {
  /** @type {string[]} */
  const urls = [];
  return { urls, open: async (/** @type {string} */ url) => (urls.push(url), result) };
}

/** @param {string} home @param {string} taskId */
async function openedEvents(home, taskId) {
  return (await readEvents(taskPaths(home, taskId).events)).filter((e) => e.type === 'dashboard_opened').length;
}

test('once: opens the task screen the first time and records dashboard_opened; never again', async () => {
  const { home, taskId } = await submittedTask();
  const input = /** @type {any} */ (await readJson(taskPaths(home, taskId).input));
  const b = recorder();
  const first = await openDashboard({ home, taskId, once: true, ensure: fakeServer, open: b.open });
  const url = `http://127.0.0.1:17380/r/${input.repo.id}/w/${input.worktree.id}/t/${taskId}`;
  assert.deepEqual(first, { url, server: 'reused', opened: true, reason: null });
  assert.deepEqual(b.urls, [url]);
  assert.equal(await openedEvents(home, taskId), 1);

  const second = await openDashboard({ home, taskId, once: true, ensure: fakeServer, open: b.open });
  assert.equal(second.opened, false);
  assert.equal(second.reason, 'already_opened');
  assert.equal(second.url, url);
  assert.equal(b.urls.length, 1);
  assert.equal(await openedEvents(home, taskId), 1);
});

test('explicit open always opens, but records dashboard_opened only once', async () => {
  const { home, taskId } = await submittedTask();
  const b = recorder();
  await openDashboard({ home, taskId, ensure: fakeServer, open: b.open });
  await openDashboard({ home, taskId, ensure: fakeServer, open: b.open });
  assert.equal(b.urls.length, 2);
  assert.equal(await openedEvents(home, taskId), 1);
});

test('dashboard.openBrowser false: the URL is returned and nothing opens', async () => {
  const { home, taskId } = await submittedTask();
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, dashboard: { openBrowser: false } }));
  const b = recorder();
  const result = await openDashboard({ home, taskId, once: true, ensure: fakeServer, open: b.open });
  assert.equal(result.opened, false);
  assert.equal(result.reason, 'disabled');
  assert.match(result.url, /\/t\/t-/);
  assert.deepEqual(b.urls, []);
  assert.equal(await openedEvents(home, taskId), 0);
});

test('a browser that cannot open leaves only the URL and no event', async () => {
  const { home, taskId } = await submittedTask();
  const b = recorder({ opened: false, reason: 'xdg-open: ENOENT' });
  const result = await openDashboard({ home, taskId, once: true, ensure: fakeServer, open: b.open });
  assert.equal(result.opened, false);
  assert.equal(result.reason, 'xdg-open: ENOENT');
  assert.equal(await openedEvents(home, taskId), 0);
});

test('without a task the overview opens; an unknown task is an input error', async () => {
  const home = await tempDir('home');
  const b = recorder();
  const result = await openDashboard({ home, ensure: fakeServer, open: b.open });
  assert.equal(result.url, 'http://127.0.0.1:17380/');
  assert.deepEqual(b.urls, ['http://127.0.0.1:17380/']);
  await assert.rejects(
    openDashboard({ home, taskId: 't-20261112-abcdefgh', ensure: fakeServer, open: b.open }),
    (/** @type {any} */ e) => e instanceof HeirloomError && e.code === 'E_INPUT',
  );
});

test('server errors propagate (callers decide how to report them)', async () => {
  const { home, taskId } = await submittedTask();
  const failing = async () => {
    throw new HeirloomError('E_CONFLICT', '포트 사용 중');
  };
  await assert.rejects(openDashboard({ home, taskId, once: true, ensure: failing, open: recorder().open }), /포트 사용 중/);
  assert.equal(await openedEvents(home, taskId), 0);
});

test('submitAndOpen: a dashboard failure does not fail the submit; the hint is returned', async () => {
  const { home, taskId } = await submittedTask();
  // The fixture already submitted; submitting the same draft again is allowed while awaiting approval.
  const failing = async () => {
    throw new HeirloomError('E_CONFLICT', '포트 사용 중', { hint: 'lsof -i :17380' });
  };
  const result = await submitAndOpen({ home, taskId, ensure: failing, open: recorder().open });
  assert.equal(result.state, 'awaiting_approval');
  assert.equal(result.dashboardUrl, null);
  assert.equal(result.browserOpened, false);
  assert.deepEqual(result.dashboardError, { code: 'E_CONFLICT', message: '포트 사용 중', hint: 'lsof -i :17380' });

  const b = recorder();
  const ok = await submitAndOpen({ home, taskId, ensure: fakeServer, open: b.open });
  assert.match(String(ok.dashboardUrl), /\/t\/t-/);
  assert.equal(ok.browserOpened, true);
  assert.equal(ok.dashboardError, null);
});
