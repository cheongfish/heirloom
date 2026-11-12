// Dedicated worktrees for context curation. A curation never touches the user's working
// trees: it runs in its own `git worktree` under ~/.heirloom/worktrees/<repoId>/<taskId>/,
// on its own branch started from the target branch, and the worktree is removed when the
// task ends.

import { access } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { git, listRemotes, repoInfo, resolveBase, tryGit } from './git.mjs';
import { baseBranchName } from './github.mjs';
import { newTaskId, randomBase32, resolveIds } from './ids.mjs';
import { ensureDir, homePaths, taskPaths } from './paths.mjs';
import { readIndex, taskKey, updateIndex } from './store.mjs';

/**
 * @typedef {object} CurationMeta curation.json in the task directory
 * @property {1} schemaVersion
 * @property {string} taskId
 * @property {string} repoId
 * @property {string} checkout the user's worktree the target branch was resolved in
 * @property {string} worktree the dedicated worktree
 * @property {string} worktreeId
 * @property {string} branch
 * @property {string} base target branch ref
 * @property {string} createdAt
 * @property {{ fetched: boolean | null, note: string | null }} fetch
 * @property {string} [removedAt] set once the worktree and branch are removed
 * @property {string} [removeNote] why the last removal did not happen
 */

/** @param {string} p */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** @param {Date} [now] */
export function curationBranchName(now = new Date()) {
  return `heirloom/curate-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomBase32(4)}`;
}

/**
 * A registered worktree of the repository that still exists and is not a curation
 * worktree, most recently seen first.
 * @param {{ home: string, repoId: string }} options
 * @returns {Promise<{ worktreeId: string, root: string } | null>}
 */
export async function repoCheckout({ home, repoId }) {
  const index = await readIndex(home);
  const candidates = Object.entries(index.worktrees)
    .filter(([, w]) => w.repoId === repoId && !w.managed)
    .sort(([, a], [, b]) => (a.lastSeen < b.lastSeen ? 1 : -1));
  for (const [worktreeId, w] of candidates) {
    if (await exists(w.path)) return { worktreeId, root: w.path };
  }
  return null;
}

/**
 * The target branch of a repository for curation, resolved without guessing in a
 * registered worktree (explicit config, then origin/HEAD).
 * @param {{ home: string, repoId: string }} options
 */
export async function curationBase({ home, repoId }) {
  const checkout = await repoCheckout({ home, repoId });
  if (!checkout) {
    throw new HeirloomError('E_INPUT', `저장소 ${repoId}의 작업 트리를 찾지 못함`, { hint: '이 저장소에서 Heirloom을 한 번 이상 쓴 작업 트리가 있어야 한다.' });
  }
  const config = await loadProjectConfig(checkout.root);
  const base = await resolveBase({ cwd: checkout.root, configBase: config.baseBranch });
  return { checkout, ref: base.ref };
}

/**
 * Create the task id, the dedicated worktree and its branch, and register them. Fetches the
 * target remote first; a failed fetch goes on with the last known state and says so.
 * @param {{ home: string, repoId: string, fetchTimeoutMs?: number }} options
 * @returns {Promise<CurationMeta>}
 */
export async function createCurationWorktree({ home, repoId, fetchTimeoutMs = 10_000 }) {
  const { checkout, ref } = await curationBase({ home, repoId });
  const root = checkout.root;
  const { remote, branch: baseName } = baseBranchName(ref, await listRemotes(root).catch(() => []));
  /** @type {CurationMeta['fetch']} */
  const fetch = { fetched: null, note: null };
  if (remote) {
    try {
      await git(['fetch', '--quiet', remote, baseName], { cwd: root, timeoutMs: fetchTimeoutMs });
      fetch.fetched = true;
    } catch (err) {
      fetch.fetched = false;
      fetch.note = `git fetch ${remote} ${baseName} 실패: 마지막으로 가져온 상태로 진행함(미확인)`;
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  const taskId = newTaskId();
  const worktree = path.join(homePaths(home).worktrees, repoId, taskId);
  const branch = curationBranchName();
  await ensureDir(path.dirname(worktree));
  await git(['worktree', 'add', '--quiet', '--no-track', '-b', branch, worktree, ref], { cwd: root });

  const ids = await resolveIds(home, await repoInfo(worktree));
  await updateIndex(home, (index) => {
    index.worktrees[ids.worktreeId].managed = true;
    index.tasks[taskKey({ worktreeId: ids.worktreeId, branch, specRef: null })] = taskId;
  });
  /** @type {CurationMeta} */
  const meta = {
    schemaVersion: 1,
    taskId,
    repoId: ids.repoId,
    checkout: root,
    worktree,
    worktreeId: ids.worktreeId,
    branch,
    base: ref,
    createdAt: new Date().toISOString(),
    fetch,
  };
  const paths = taskPaths(home, taskId);
  await ensureDir(paths.dir);
  await writeJsonAtomic(paths.curation, meta);
  return meta;
}

/**
 * @param {string} home
 * @param {string} taskId
 * @returns {Promise<CurationMeta | null>} null when the task is not a curation
 */
export async function readCurationMeta(home, taskId) {
  return /** @type {CurationMeta | null} */ ((await readJson(taskPaths(home, taskId).curation)) ?? null);
}

/**
 * Whether the worktree is registered as a curation worktree.
 * @param {{ home: string, worktreeId: string }} options
 */
export async function isManagedWorktree({ home, worktreeId }) {
  return (await readIndex(home)).worktrees[worktreeId]?.managed === true;
}

/**
 * Remove the dedicated worktree and its local branch of a finished curation. Uncommitted
 * changes are never thrown away: the worktree is kept and the reason recorded.
 * @param {{ home: string, taskId: string }} options
 * @returns {Promise<{ removed: boolean, note: string | null }>}
 */
export async function removeCurationWorktree({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  const meta = await readCurationMeta(home, taskId);
  if (!meta) return { removed: false, note: '정리 작업이 아님' };
  if (meta.removedAt) return { removed: true, note: null };

  const present = await exists(meta.worktree);
  if (present) {
    const dirty = await tryGit(['status', '--porcelain', '--untracked-files=normal'], { cwd: meta.worktree });
    if (dirty === null || dirty !== '') {
      const note = dirty === null ? 'worktree 상태를 읽지 못해 지우지 않음' : '커밋되지 않은 변경이 있어 지우지 않음';
      await writeJsonAtomic(paths.curation, { ...meta, removeNote: note });
      return { removed: false, note };
    }
  }
  const cwd = (await exists(meta.checkout)) ? meta.checkout : null;
  if (cwd) {
    if (present) await git(['worktree', 'remove', meta.worktree], { cwd });
    else await tryGit(['worktree', 'prune'], { cwd });
    await tryGit(['branch', '-D', meta.branch], { cwd });
  } else if (present) {
    await git(['worktree', 'remove', meta.worktree], { cwd: meta.worktree });
  }
  await updateIndex(home, (index) => {
    delete index.worktrees[meta.worktreeId];
  });
  const { removeNote: _drop, ...rest } = meta;
  await writeJsonAtomic(paths.curation, { ...rest, removedAt: new Date().toISOString() });
  return { removed: true, note: null };
}
