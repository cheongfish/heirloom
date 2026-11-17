// The SessionStart hook records the host of each session on the worktree's index entry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';
import { readIndex } from '../../skills/using-heirloom/lib/store.mjs';
import { recordSessionHost, sessionHostOf } from '../../skills/using-heirloom/lib/session-host.mjs';

test('sessionHostOf: the hooks file names Antigravity; Codex and Claude Code share one and differ by transcript path', () => {
  assert.equal(sessionHostOf('antigravity', {}), 'antigravity');
  assert.equal(sessionHostOf('codex', {}), 'codex');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/home/u/.codex/sessions/2026/11/13/rollout-2026-11-13T11-15-04-01a1.jsonl' }), 'codex');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/home/u/.claude/projects/-home-u-repo/0b7c.jsonl' }), 'claude-code');
  assert.equal(sessionHostOf(undefined, { transcript_path: null }), null, 'unknown: not recorded');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/somewhere/else.jsonl' }), null);
  assert.equal(sessionHostOf('vim', {}), null);
});

test('recordSessionHost: only for a checkout Heirloom already knows; each worktree keeps its latest session', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex' });
  assert.deepEqual((await readIndex(home)).worktrees, {}, 'no ids are created by a session start');

  const ids = await resolveIds(home, await repoInfo(repo.dir));
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex', now: new Date('2026-11-13T01:00:00Z') });
  assert.equal((await readIndex(home)).worktrees[ids.worktreeId].host, 'codex');

  // A linked worktree of the same repository opened later in Antigravity.
  const wt = path.join(await tempDir('wt'), 'b');
  repo.git('worktree', 'add', '-q', '-b', 'b', wt);
  const linked = await resolveIds(home, await repoInfo(wt));
  await recordSessionHost({ home, cwd: wt, host: 'antigravity', now: new Date('2026-11-13T02:00:00Z') });
  assert.equal((await readIndex(home)).worktrees[linked.worktreeId].host, 'antigravity');
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex', now: new Date('2026-11-13T03:00:00Z') });
  assert.equal((await readIndex(home)).worktrees[ids.worktreeId].host, 'codex');
  assert.equal((await readIndex(home)).worktrees[linked.worktreeId].host, 'antigravity');
});

