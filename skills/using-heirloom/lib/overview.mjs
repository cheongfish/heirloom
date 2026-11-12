// Dashboard overview helpers (MVP-PLAN 6.4): unhanded changes per registered worktree and
// stale open tasks. Read-only: never issues ids, never writes the index.

import { access } from 'node:fs/promises';

import { loadProjectConfig } from './config.mjs';
import { countAttempts, readEvents } from './events.mjs';
import { repoInfo, resolveBase } from './git.mjs';
import { taskPaths } from './paths.mjs';
import { isMarkdownCodePath } from './schema.mjs';
import { computeSourceState } from './state.mjs';
import { readIndex, tasksForWorktree } from './store.mjs';

/** States in which a task needs nothing more from anyone. */
const FINISHED = new Set(['pr_created', 'discarded', 'expired']);

/**
 * An open task whose last event is `days` or more old (PLAN 12.2: listed, never expired by time).
 * @param {{ state: string | null, updatedAt: string }} task
 * @param {number} now epoch ms
 * @param {number} days
 */
export function isStaleTask(task, now, days) {
  if (task.state === null || FINISHED.has(task.state)) return false;
  return now - Date.parse(task.updatedAt) >= days * 24 * 3600_000;
}

/**
 * @typedef {object} UnhandedChange
 * @property {string} worktreeId
 * @property {string} repoId
 * @property {string} path
 * @property {string | null} branch
 * @property {string} base
 * @property {string} sourceHash
 * @property {string[]} files changed non-Markdown files
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

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`상태 계산 시간 초과(${ms}ms)`)), ms);
  });
  promise.catch(() => {});
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout]).finally(() => clearTimeout(timer)));
}

/**
 * @param {string} home
 * @param {string} worktreeId
 * @param {{ repoId: string, path: string }} wt
 * @returns {Promise<UnhandedChange | null>}
 */
async function checkWorktree(home, worktreeId, wt) {
  const info = await repoInfo(wt.path);
  const config = await loadProjectConfig(info.root);
  const base = await resolveBase({ cwd: info.root, configBase: config.baseBranch });
  const state = await computeSourceState({ root: info.root, mergeBase: base.mergeBase });
  const files = state.files.filter((f) => !isMarkdownCodePath(f.path)).map((f) => f.path);
  if (!files.length) return null;
  const index = await readIndex(home);
  for (const { taskId } of tasksForWorktree(index, worktreeId)) {
    if (countAttempts(await readEvents(taskPaths(home, taskId).events), state.hash) > 0) return null;
  }
  return { worktreeId, repoId: wt.repoId, path: wt.path, branch: info.branch, base: base.ref, sourceHash: state.hash, files };
}

/**
 * Registered worktrees with code changes for which no handoff was prepared at the current
 * source state. Worktrees whose directory is gone are skipped; failures and timeouts are
 * reported as unchecked instead of guessed.
 * @param {{ home: string, timeoutMs?: number }} options
 * @returns {Promise<{ changes: UnhandedChange[], unchecked: { worktreeId: string, path: string, reason: string }[] }>}
 */
export async function findUnhandedChanges({ home, timeoutMs = 2000 }) {
  const index = await readIndex(home);
  const entries = Object.entries(index.worktrees).sort(([, a], [, b]) => (a.path < b.path ? -1 : 1));
  const results = await Promise.all(
    entries.map(async ([worktreeId, wt]) => {
      if (!(await exists(wt.path))) return { skip: true };
      try {
        return { change: await withTimeout(checkWorktree(home, worktreeId, wt), timeoutMs) };
      } catch (err) {
        return { unchecked: { worktreeId, path: wt.path, reason: err instanceof Error ? err.message : String(err) } };
      }
    }),
  );
  /** @type {UnhandedChange[]} */
  const changes = [];
  /** @type {{ worktreeId: string, path: string, reason: string }[]} */
  const unchecked = [];
  for (const r of results) {
    if ('change' in r && r.change) changes.push(r.change);
    if ('unchecked' in r && r.unchecked) unchecked.push(r.unchecked);
  }
  return { changes, unchecked };
}
