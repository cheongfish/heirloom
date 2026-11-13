// Curation runs with the host of the repository's last session: the SessionStart hook records
// it per worktree, and the headless profile follows it, falling back to the user config.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';
import { readIndex } from '../../skills/using-heirloom/lib/store.mjs';
import { curationAgent, recordSessionHost, sessionHostOf } from '../../skills/using-heirloom/lib/session-host.mjs';

test('sessionHostOf: the hooks file names Antigravity; Codex and Claude Code share one and differ by transcript path', () => {
  assert.equal(sessionHostOf('antigravity', {}), 'antigravity');
  assert.equal(sessionHostOf('codex', {}), 'codex');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/home/u/.codex/sessions/2026/11/13/rollout-2026-11-13T11-15-04-01a1.jsonl' }), 'codex');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/home/u/.claude/projects/-home-u-repo/0b7c.jsonl' }), 'claude-code');
  assert.equal(sessionHostOf(undefined, { transcript_path: null }), null, 'unknown: not recorded');
  assert.equal(sessionHostOf(undefined, { transcript_path: '/somewhere/else.jsonl' }), null);
  assert.equal(sessionHostOf('vim', {}), null);
});

test('recordSessionHost: only for a checkout Heirloom already knows; the latest session of the repository wins', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex' });
  assert.deepEqual((await readIndex(home)).worktrees, {}, 'no ids are created by a session start');

  const ids = await resolveIds(home, await repoInfo(repo.dir));
  assert.deepEqual(await curationAgent({ home, repoId: ids.repoId }), { host: 'claude-code', command: 'claude', model: null, source: 'config' });

  await recordSessionHost({ home, cwd: repo.dir, host: 'codex', now: new Date('2026-11-13T01:00:00Z') });
  assert.equal((await readIndex(home)).worktrees[ids.worktreeId].host, 'codex');
  assert.deepEqual(await curationAgent({ home, repoId: ids.repoId }), { host: 'codex', command: 'codex', model: null, source: 'session' });

  // A linked worktree of the same repository opened later in Antigravity.
  const wt = path.join(await tempDir('wt'), 'b');
  repo.git('worktree', 'add', '-q', '-b', 'b', wt);
  await resolveIds(home, await repoInfo(wt));
  await recordSessionHost({ home, cwd: wt, host: 'antigravity', now: new Date('2026-11-13T02:00:00Z') });
  assert.equal((await curationAgent({ home, repoId: ids.repoId })).host, 'antigravity');
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex', now: new Date('2026-11-13T03:00:00Z') });
  assert.equal((await curationAgent({ home, repoId: ids.repoId })).host, 'codex');
});

test('curationAgent: the configured command and model are kept when the session host is the configured host', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const ids = await resolveIds(home, await repoInfo(repo.dir));
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { host: 'codex', command: '/opt/codex', model: 'gpt' } } }));
  assert.deepEqual(await curationAgent({ home, repoId: ids.repoId }), { host: 'codex', command: '/opt/codex', model: 'gpt', source: 'config' });
  await recordSessionHost({ home, cwd: repo.dir, host: 'codex' });
  assert.deepEqual(await curationAgent({ home, repoId: ids.repoId }), { host: 'codex', command: '/opt/codex', model: 'gpt', source: 'session' });
  await recordSessionHost({ home, cwd: repo.dir, host: 'claude-code' });
  assert.deepEqual(await curationAgent({ home, repoId: ids.repoId }), { host: 'claude-code', command: 'claude', model: null, source: 'session' }, 'another host: its default command');
});
