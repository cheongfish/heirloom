import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlink } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, cloneRepo } from '../helpers/git-fixture.mjs';
import { repoInfo, resolveBase, changedFiles } from '../../skills/using-heirloom/lib/git.mjs';
import { computeSourceState, hashEntries, hashMaterial } from '../../skills/using-heirloom/lib/state.mjs';

/** @param {import('../helpers/git-fixture.mjs').Repo} repo */
async function branchWithChanges(repo) {
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 1;\n');
  await repo.write('README.txt', 'hello world\n');
  await repo.write('.heirloom/decisions/d-00000000.md', 'ignored\n');
}

test('repoInfo reports root, git dirs and branch', async (t) => {
  const repo = await makeRepo();
  t.after(() => repo.cleanup());
  const info = await repoInfo(repo.dir);
  assert.equal(info.root, repo.dir);
  assert.equal(info.gitDir, path.join(repo.dir, '.git'));
  assert.equal(info.commonDir, path.join(repo.dir, '.git'));
  assert.equal(info.branch, 'main');
  assert.match(/** @type {string} */ (info.head), /^[0-9a-f]{40}$/);
  await assert.rejects(repoInfo(path.dirname(repo.dir)), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('resolveBase: explicit --base wins, unknown ref is an input error', async (t) => {
  const repo = await makeRepo();
  t.after(() => repo.cleanup());
  repo.git('checkout', '-q', '-b', 'feat');
  const base = await resolveBase({ cwd: repo.dir, base: 'main' });
  assert.equal(base.ref, 'main');
  assert.equal(base.mergeBase, repo.git('rev-parse', 'main'));
  await assert.rejects(resolveBase({ cwd: repo.dir, base: 'nope' }), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('resolveBase: config baseBranch prefers origin/<branch>, then local', async (t) => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  t.after(() => Promise.all([upstream.cleanup(), repo.cleanup()]));
  repo.git('remote', 'remove', 'origin');
  assert.equal((await resolveBase({ cwd: repo.dir, configBase: 'main' })).ref, 'main');
  repo.git('remote', 'add', 'origin', upstream.dir);
  repo.git('fetch', '-q', 'origin');
  assert.equal((await resolveBase({ cwd: repo.dir, configBase: 'main' })).ref, 'origin/main');
});

test('resolveBase: falls back to origin/HEAD and refuses to guess otherwise', async (t) => {
  const upstream = await makeRepo();
  const other = await cloneRepo(upstream);
  const repo = await cloneRepo(upstream);
  t.after(() => Promise.all([upstream.cleanup(), other.cleanup(), repo.cleanup()]));
  assert.equal((await resolveBase({ cwd: repo.dir })).ref, 'origin/main', 'clone sets origin/HEAD');

  repo.git('remote', 'remove', 'origin');
  await assert.rejects(resolveBase({ cwd: repo.dir }), (err) => /** @type {any} */ (err).code === 'E_INPUT', 'no remote');

  repo.git('remote', 'add', 'origin', upstream.dir);
  repo.git('fetch', '-q', 'origin');
  // git 2.48 and later create origin/HEAD on fetch (remote.<name>.followRemoteHEAD); remove it
  // so the case is the same on every git version.
  repo.git('remote', 'set-head', 'origin', '--delete');
  await assert.rejects(resolveBase({ cwd: repo.dir }), /origin\/HEAD/, 'origin/HEAD not set');
  repo.git('remote', 'set-head', 'origin', 'main');
  assert.equal((await resolveBase({ cwd: repo.dir })).ref, 'origin/main');

  repo.git('remote', 'rename', 'origin', 'up');
  repo.git('remote', 'add', 'fork', other.dir);
  await assert.rejects(resolveBase({ cwd: repo.dir }), (err) => /** @type {any} */ (err).code === 'E_INPUT', 'several remotes, no origin');
});

test('changedFiles: tracked, staged, untracked and deleted files; .heirloom excluded', async (t) => {
  const repo = await makeRepo({ 'README.txt': 'hello\n', 'old.txt': 'old\n' });
  t.after(() => repo.cleanup());
  const mergeBase = repo.git('rev-parse', 'HEAD');
  await branchWithChanges(repo);
  await repo.write('staged.txt', 'staged\n');
  repo.git('add', 'staged.txt');
  await repo.remove('old.txt');

  const files = await changedFiles({ root: repo.dir, mergeBase });
  assert.deepEqual(files, [
    { path: 'README.txt', status: 'M' },
    { path: 'old.txt', status: 'D' },
    { path: 'src/a.mjs', status: 'A' },
    { path: 'staged.txt', status: 'A' },
  ]);
});

test('computeSourceState: committing the same content keeps the hash', async (t) => {
  const repo = await makeRepo();
  t.after(() => repo.cleanup());
  const mergeBase = repo.git('rev-parse', 'HEAD');
  await branchWithChanges(repo);

  const before = await computeSourceState({ root: repo.dir, mergeBase });
  repo.commitAll('work');
  const after = await computeSourceState({ root: repo.dir, mergeBase });
  assert.equal(after.hash, before.hash);
  assert.deepEqual(after.files, before.files);
  assert.match(before.hash, /^sha256:[0-9a-f]{64}$/);
});

test('computeSourceState: content change and .heirloom change', async (t) => {
  const repo = await makeRepo();
  t.after(() => repo.cleanup());
  const mergeBase = repo.git('rev-parse', 'HEAD');
  await branchWithChanges(repo);
  const base = await computeSourceState({ root: repo.dir, mergeBase });

  await repo.write('.heirloom/axioms/a-00000000.md', 'still ignored\n');
  assert.equal((await computeSourceState({ root: repo.dir, mergeBase })).hash, base.hash);

  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const changed = await computeSourceState({ root: repo.dir, mergeBase });
  assert.notEqual(changed.hash, base.hash);
  const entry = changed.files.find((f) => f.path === 'src/a.mjs');
  assert.ok(entry && entry.sha256 !== base.files.find((f) => f.path === 'src/a.mjs')?.sha256);
});

test('computeSourceState: deleted files and symlinks are hashed deterministically', async (t) => {
  const repo = await makeRepo({ 'README.txt': 'hello\n', 'gone.txt': 'bye\n' });
  t.after(() => repo.cleanup());
  const mergeBase = repo.git('rev-parse', 'HEAD');
  await repo.remove('gone.txt');
  if (process.platform !== 'win32') await symlink('README.txt', path.join(repo.dir, 'link'));

  const state = await computeSourceState({ root: repo.dir, mergeBase });
  assert.deepEqual(state.files.find((f) => f.path === 'gone.txt'), { path: 'gone.txt', status: 'D', sha256: 'deleted' });
  if (process.platform !== 'win32') {
    const link = state.files.find((f) => f.path === 'link');
    assert.equal(link?.status, 'A');
    assert.match(/** @type {string} */ (link?.sha256), /^[0-9a-f]{64}$/);
  }
});

test('hashEntries is order independent and sensitive to status', () => {
  const a = { path: 'a', status: /** @type {const} */ ('A'), sha256: '1' };
  const b = { path: 'b', status: /** @type {const} */ ('M'), sha256: '2' };
  assert.equal(hashEntries([a, b]), hashEntries([b, a]));
  assert.notEqual(hashEntries([a, b]), hashEntries([{ ...a, status: 'M' }, b]));
});

test('hashMaterial hashes file bytes relative to the repo root', async (t) => {
  const repo = await makeRepo({ 'docs/spec.md': 'spec\n' });
  t.after(() => repo.cleanup());
  const h = await hashMaterial(repo.dir, 'docs/spec.md');
  assert.match(h, /^[0-9a-f]{64}$/);
  await repo.write('docs/spec.md', 'spec v2\n');
  assert.notEqual(await hashMaterial(repo.dir, 'docs/spec.md'), h);
  await assert.rejects(hashMaterial(repo.dir, 'docs/missing.md'), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});
