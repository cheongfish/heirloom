// Dashboard overview: unhanded changes per registered worktree and stale tasks (MVP-PLAN 6.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { findUnhandedChanges, isStaleTask } from '../../skills/using-heirloom/lib/overview.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';

async function setup() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  const home = await tempDir('home');
  const { worktreeId } = await resolveIds(home, await repoInfo(repo.dir));
  return { repo, home, worktreeId };
}

test('a registered worktree with code changes and no handoff for that state is listed', async () => {
  const { repo, home, worktreeId } = await setup();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const { changes, unchecked } = await findUnhandedChanges({ home });
  assert.deepEqual(unchecked, []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].worktreeId, worktreeId);
  assert.equal(changes[0].path, repo.dir);
  assert.equal(changes[0].branch, 'feat');
  assert.deepEqual(changes[0].files, ['src/a.mjs']);
  assert.match(changes[0].sourceHash, /^sha256:/);
});

test('no changes, Markdown-only changes, or a handoff for the current state are not listed', async () => {
  const { repo, home } = await setup();
  assert.deepEqual((await findUnhandedChanges({ home })).changes, []);

  await repo.write('docs/notes.md', '# 메모\n');
  assert.deepEqual((await findUnhandedChanges({ home })).changes, [], 'Markdown only is not work to hand off');

  await repo.write('src/a.mjs', 'export const a = 2;\n');
  await prepareHandoff({ cwd: repo.dir, home, manual: true });
  assert.deepEqual((await findUnhandedChanges({ home })).changes, [], 'prepared for this state');

  await repo.write('src/a.mjs', 'export const a = 3;\n');
  assert.equal((await findUnhandedChanges({ home })).changes.length, 1, 'changed again after the handoff');
});

test('a worktree whose path is gone is skipped; one that fails is reported as unchecked', async () => {
  const { repo, home } = await setup();
  await repo.cleanup();
  assert.deepEqual(await findUnhandedChanges({ home }), { changes: [], unchecked: [] });

  const other = await setup();
  other.repo.git('remote', 'remove', 'origin');
  const result = await findUnhandedChanges({ home: other.home });
  assert.deepEqual(result.changes, []);
  assert.equal(result.unchecked.length, 1);
  assert.equal(result.unchecked[0].path, other.repo.dir);
  assert.match(result.unchecked[0].reason, /대상 브랜치/);
});

test('a worktree that takes too long is reported as unchecked', async () => {
  const { repo, home } = await setup();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const result = await findUnhandedChanges({ home, timeoutMs: 0 });
  assert.deepEqual(result.changes, []);
  assert.equal(result.unchecked.length, 1);
  assert.match(result.unchecked[0].reason, /시간/);
  await rm(repo.dir, { recursive: true, force: true });
});

test('isStaleTask: open tasks idle for staleDays or more; finished tasks never', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  const at = (/** @type {string} */ iso) => ({ updatedAt: iso });
  assert.equal(isStaleTask({ state: 'awaiting_approval', ...at('2026-11-13T00:00:00Z') }, now, 7), true);
  assert.equal(isStaleTask({ state: 'awaiting_approval', ...at('2026-11-13T00:00:01Z') }, now, 7), false);
  assert.equal(isStaleTask({ state: 'approved', ...at('2026-11-01T00:00:00Z') }, now, 7), true);
  for (const state of /** @type {const} */ (['pr_created', 'discarded', 'expired'])) {
    assert.equal(isStaleTask({ state, ...at('2026-01-01T00:00:00Z') }, now, 7), false, state);
  }
  assert.equal(isStaleTask({ state: 'prepared', ...at('2026-11-17T00:00:00Z') }, now, 3), true);
});
