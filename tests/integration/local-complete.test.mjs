// A task whose PR cannot be opened (the remote is neither GitHub nor GitLab) ends when its branch reaches
// the target branch (decision 2026-11-12, MVP-PLAN 2절 'PR 없이 끝나는 작업').

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { approvedTask } from '../helpers/handoff-fixture.mjs';
import { applyApproval, listPendingApprovals } from '../../skills/using-heirloom/lib/apply.mjs';
import { isStaleTask } from '../../skills/using-heirloom/lib/overview.mjs';
import { appliedTaskMerged } from '../../skills/using-heirloom/lib/record-status.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A local-remote task, judged and applied (spec removal staged and committed, PR unavailable). */
async function appliedLocalTask() {
  const t = await approvedTask();
  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(applied.pr.reason, 'unsupported_remote');
  t.repo.commitAll('chore: spec 정리');
  return t;
}

/** Merge the task branch into upstream main and fetch it, as merge-local.sh does. */
function mergeUpstream(/** @type {Awaited<ReturnType<typeof appliedLocalTask>>} */ t) {
  t.repo.git('push', '-q', 'origin', 'feat');
  t.upstream.git('merge', '-q', '--no-ff', '-m', 'merge feat', 'feat');
  t.repo.git('fetch', '-q', 'origin');
}

const context = (/** @type {{ repo: { dir: string }, home: string }} */ t) => buildSessionContext({ cwd: t.repo.dir, home: t.home, pluginRoot: ROOT });

test('local remote, before merge: listed as waiting for a manual merge, not as a missing PR', async () => {
  const t = await appliedLocalTask();
  assert.equal(await appliedTaskMerged({ home: t.home, taskId: t.taskId }), false);
  const ctx = await context(t);
  assert.match(ctx, new RegExp(`${t.taskId}: 기록 파일을 썼고 PR·MR은 만들 수 없음\\(지원하지 않는 원격\\)`));
  assert.doesNotMatch(ctx, /PR이 아직 없음/);
  assert.deepEqual((await listPendingApprovals({ home: t.home, cwd: t.repo.dir })).map((p) => p.state), ['applied']);
});

test('local remote, after merge: the task is finished (session start, pending list, stale list)', async () => {
  const t = await appliedLocalTask();
  mergeUpstream(t);
  assert.equal(await appliedTaskMerged({ home: t.home, taskId: t.taskId }), true);
  assert.doesNotMatch(await context(t), new RegExp(t.taskId));
  assert.deepEqual(await listPendingApprovals({ home: t.home, cwd: t.repo.dir }), []);
  const old = { state: 'applied', updatedAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(isStaleTask(old, Date.parse('2026-11-12T00:00:00Z'), 7), true);
  assert.equal(isStaleTask({ ...old, merged: true }, Date.parse('2026-11-12T00:00:00Z'), 7), false);
});
