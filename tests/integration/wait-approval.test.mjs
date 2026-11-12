// Waiting for the approval of a submitted handoff (PLAN 12.1: a live session is notified).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { appendEvent } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { waitForApproval } from '../../skills/using-heirloom/lib/wait-approval.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'wait-approval.mjs');

/** @param {Awaited<ReturnType<typeof submittedTask>>} t */
async function approve(t) {
  const draft = /** @type {any} */ (await readJson(taskPaths(t.home, t.taskId).draft));
  return approveTask({
    home: t.home,
    taskId: t.taskId,
    keystore: 'file',
    request: {
      kind: 'full',
      draftSha256: draftDigest(draft),
      sourceHash: t.sourceHash,
      summary: ['a를 2로 바꿨다', 'spec을 추가했다'],
      items: [{ index: 0, decision: 'approved' }],
    },
  });
}

test('wait: returns when the human approves while waiting', async () => {
  const t = await submittedTask();
  const waiting = waitForApproval({ home: t.home, taskId: t.taskId, timeoutMs: 10_000, pollMs: 20 });
  await new Promise((r) => setTimeout(r, 100));
  const approval = await approve(t);
  const out = await waiting;
  assert.deepEqual(out, { taskId: t.taskId, state: 'approved', approvalId: approval.id, timedOut: false });
});

test('wait: an approval made before waiting is returned at once', async () => {
  const t = await submittedTask();
  const approval = await approve(t);
  const out = await waitForApproval({ home: t.home, taskId: t.taskId, timeoutMs: 10_000, pollMs: 20 });
  assert.equal(out.state, 'approved');
  assert.equal(out.approvalId, approval.id);
});

test('wait: a discarded task ends the wait without an approval', async () => {
  const t = await submittedTask();
  const waiting = waitForApproval({ home: t.home, taskId: t.taskId, timeoutMs: 10_000, pollMs: 20 });
  await appendEvent(taskPaths(t.home, t.taskId).events, { type: 'discarded' });
  assert.deepEqual(await waiting, { taskId: t.taskId, state: 'discarded', approvalId: null, timedOut: false });
});

test('wait: times out still waiting for approval', async () => {
  const t = await submittedTask();
  const out = await waitForApproval({ home: t.home, taskId: t.taskId, timeoutMs: 100, pollMs: 20 });
  assert.deepEqual(out, { taskId: t.taskId, state: 'awaiting_approval', approvalId: null, timedOut: true });
});

test('wait: unknown task is an input error', async () => {
  const home = await tempDir('home');
  await assert.rejects(
    waitForApproval({ home, taskId: 't-20261112-zzzzzzzz', timeoutMs: 100, pollMs: 20 }),
    (/** @type {any} */ e) => e instanceof HeirloomError && e.code === 'E_INPUT',
  );
});

test('wait-approval.mjs prints one JSON object; --timeout-minutes must be positive', async () => {
  const t = await submittedTask();
  await approve(t);
  const env = { ...process.env, HEIRLOOM_HOME: t.home };
  const ok = spawnSync(process.execPath, [SCRIPT, '--task', t.taskId], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.state, 'approved');

  const bad = spawnSync(process.execPath, [SCRIPT, '--task', t.taskId, '--timeout-minutes', '0'], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});
