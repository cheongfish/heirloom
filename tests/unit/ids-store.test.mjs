import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import {
  randomBase32,
  newTaskId,
  newRecordId,
  newApprovalId,
  ID_PATTERNS,
  readIds,
  resolveIds,
} from '../../skills/using-heirloom/lib/ids.mjs';
import { readIndex, taskIdFor } from '../../skills/using-heirloom/lib/store.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';

test('randomBase32 uses lowercase Crockford alphabet', () => {
  const s = randomBase32(1000);
  assert.equal(s.length, 1000);
  assert.match(s, /^[0-9abcdefghjkmnpqrstvwxyz]+$/);
});

test('id formats match MVP-PLAN section 4', () => {
  assert.match(newTaskId(new Date('2026-11-12T23:59:00Z')), /^t-20261112-[0-9a-z]{8}$/);
  assert.match(newTaskId(), ID_PATTERNS.task);
  assert.match(newRecordId('decision'), ID_PATTERNS.decision);
  assert.match(newRecordId('axiom'), ID_PATTERNS.axiom);
  assert.match(newApprovalId(), ID_PATTERNS.approval);
});

test('resolveIds: stable across calls, separate files for repo and main worktree', async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  t.after(() => Promise.all([repo.cleanup(), rm(home, { recursive: true, force: true })]));

  const info = await repoInfo(repo.dir);
  const first = await resolveIds(home, info);
  const second = await resolveIds(home, info);
  assert.deepEqual(first, second);
  assert.match(first.repoId, ID_PATTERNS.repo);
  assert.match(first.worktreeId, ID_PATTERNS.worktree);
  assert.equal(info.gitDir, info.commonDir, 'main worktree shares git dir with common dir');
  assert.equal((await readFile(path.join(info.commonDir, 'heirloom-repo-id'), 'utf8')).trim(), first.repoId);
  assert.equal((await readFile(path.join(info.gitDir, 'heirloom-worktree-id'), 'utf8')).trim(), first.worktreeId);

  const index = await readIndex(home);
  assert.equal(index.worktrees[first.worktreeId].path, repo.dir);
  assert.equal(index.worktrees[first.worktreeId].repoId, first.repoId);
});

test('resolveIds: linked worktree shares repo id but gets its own worktree id', async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const wtDir = path.join(await tempDir('wt'), 'linked');
  t.after(() => Promise.all([repo.cleanup(), rm(home, { recursive: true, force: true }), rm(path.dirname(wtDir), { recursive: true, force: true })]));
  repo.git('worktree', 'add', '-q', '-b', 'feat', wtDir);

  const main = await resolveIds(home, await repoInfo(repo.dir));
  const linked = await resolveIds(home, await repoInfo(wtDir));
  assert.equal(linked.repoId, main.repoId);
  assert.notEqual(linked.worktreeId, main.worktreeId);
});

test('resolveIds: a copied repository gets new ids while the original keeps its own', async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const copyParent = await tempDir('copy');
  const copyDir = path.join(copyParent, 'copy');
  t.after(() => Promise.all([repo.cleanup(), rm(home, { recursive: true, force: true }), rm(copyParent, { recursive: true, force: true })]));

  const original = await resolveIds(home, await repoInfo(repo.dir));
  await cp(repo.dir, copyDir, { recursive: true });
  const copied = await resolveIds(home, await repoInfo(copyDir));
  assert.notEqual(copied.worktreeId, original.worktreeId);
  assert.notEqual(copied.repoId, original.repoId);
  assert.deepEqual(await resolveIds(home, await repoInfo(repo.dir)), original);
  assert.deepEqual(await resolveIds(home, await repoInfo(copyDir)), copied);
});

test('resolveIds: a moved worktree keeps its ids', async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const parent = await tempDir('move');
  const moved = path.join(parent, 'moved');
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(parent, { recursive: true, force: true })]));

  const before = await resolveIds(home, await repoInfo(repo.dir));
  await cp(repo.dir, moved, { recursive: true });
  await repo.cleanup();
  const after = await resolveIds(home, await repoInfo(moved));
  assert.deepEqual(after, before);
  assert.equal((await readIndex(home)).worktrees[before.worktreeId].path, moved);
});

// Codex's workspace-write sandbox makes .git read-only.
const asRoot = process.getuid?.() === 0;

test('resolveIds: a read-only .git keeps the ids under HEIRLOOM_HOME, and readIds finds them there', { skip: asRoot || process.platform === 'win32' }, async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const info = await repoInfo(repo.dir);
  await chmod(info.gitDir, 0o555);
  t.after(() => chmod(info.gitDir, 0o755));

  const first = await resolveIds(home, info);
  assert.match(first.repoId, ID_PATTERNS.repo);
  assert.match(first.worktreeId, ID_PATTERNS.worktree);
  assert.deepEqual(await resolveIds(home, info), first, 'stable across calls');
  assert.deepEqual(await readIds(info, home), first);
  assert.equal(await readIds(info, await tempDir('other-home')), null, 'only that home knows them');
  assert.equal((await readdir(info.gitDir)).some((n) => n.startsWith('heirloom-')), false, 'nothing written into .git');
});

test('resolveIds: ids already in .git win over HEIRLOOM_HOME, also when .git is read-only later', { skip: asRoot || process.platform === 'win32' }, async (t) => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const info = await repoInfo(repo.dir);
  const before = await resolveIds(home, info);
  await chmod(info.gitDir, 0o555);
  t.after(() => chmod(info.gitDir, 0o755));
  assert.deepEqual(await resolveIds(home, info), before);
  assert.deepEqual(await readIds(info, home), before);
});

test('readIds: ids in .git are read without a home; an invalid id file is ignored', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const info = await repoInfo(repo.dir);
  const ids = await resolveIds(home, info);
  assert.deepEqual(await readIds(info), ids);
  await writeFile(path.join(info.gitDir, 'heirloom-repo-id'), 'garbage\n');
  assert.equal(await readIds(info, home), null);
});

test('taskIdFor: one task per (worktree, branch, spec); lookup without create', async (t) => {
  const home = await tempDir('home');
  t.after(() => rm(home, { recursive: true, force: true }));
  const key = { worktreeId: 'w-0000000000', branch: 'feat/x', specRef: 'docs/specs/a.md' };

  assert.equal(await taskIdFor(home, key, { create: false }), null);
  const a = await taskIdFor(home, key);
  assert.match(/** @type {string} */ (a), ID_PATTERNS.task);
  assert.equal(await taskIdFor(home, key), a);
  assert.notEqual(await taskIdFor(home, { ...key, specRef: null }), a);
  assert.notEqual(await taskIdFor(home, { ...key, branch: 'feat/y' }), a);
});
