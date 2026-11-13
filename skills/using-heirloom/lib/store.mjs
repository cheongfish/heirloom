// ~/.heirloom/index.json: worktree registry, task-key mapping, reminders, fetch times.

import { readJson, withLock, writeJsonAtomic } from './fsx.mjs';
import { newTaskId } from './ids.mjs';
import { homePaths } from './paths.mjs';
import { assertValid, indexSchema } from './schema.mjs';

/**
 * @typedef {object} Index
 * @property {1} schemaVersion
 * @property {Record<string, { repoId: string, path: string, lastSeen: string, managed?: boolean, host?: string, hostAt?: string }>} worktrees
 *   `host`, `hostAt`: the host of the worktree's latest session and when it started
 * @property {Record<string, string>} tasks
 * @property {Record<string, { sourceHash: string, at: string }>} reminders
 * @property {Record<string, string>} lastFetch
 */

/** @returns {Index} */
export function emptyIndex() {
  return { schemaVersion: 1, worktrees: {}, tasks: {}, reminders: {}, lastFetch: {} };
}

/**
 * @param {string} home
 * @returns {Promise<Index>}
 */
export async function readIndex(home) {
  const file = homePaths(home).index;
  const value = await readJson(file);
  if (value === undefined) return emptyIndex();
  assertValid(indexSchema, value, file);
  return /** @type {Index} */ (value);
}

/**
 * Read-modify-write the index under its lock.
 * @template T
 * @param {string} home
 * @param {(index: Index) => Promise<T> | T} fn mutate `index` in place
 * @returns {Promise<T>}
 */
export async function updateIndex(home, fn) {
  const file = homePaths(home).index;
  return withLock(file, async () => {
    const index = await readIndex(home);
    const result = await fn(index);
    assertValid(indexSchema, index, file);
    await writeJsonAtomic(file, index);
    return result;
  });
}

/** @typedef {{ worktreeId: string, branch: string | null, specRef: string | null }} TaskKey */

/** @param {TaskKey} key */
export function taskKey({ worktreeId, branch, specRef }) {
  return `${worktreeId}|${branch ?? ''}|${specRef ?? ''}`;
}

/**
 * Task id for (worktree, branch, spec). Issued on first use unless `create` is false.
 * @param {string} home
 * @param {TaskKey} key
 * @param {{ create?: boolean }} [options]
 * @returns {Promise<string | null>}
 */
export async function taskIdFor(home, key, { create = true } = {}) {
  const k = taskKey(key);
  if (!create) return (await readIndex(home)).tasks[k] ?? null;
  return updateIndex(home, (index) => {
    index.tasks[k] ??= newTaskId();
    return index.tasks[k];
  });
}

/**
 * Task ids registered for a worktree.
 * @param {Index} index
 * @param {string} worktreeId
 * @returns {{ key: string, taskId: string }[]}
 */
export function tasksForWorktree(index, worktreeId) {
  return Object.entries(index.tasks)
    .filter(([key]) => key.startsWith(`${worktreeId}|`))
    .map(([key, taskId]) => ({ key, taskId }));
}

/**
 * Issue a fresh task id for a key whose previous task ended (discarded or expired).
 * @param {string} home
 * @param {TaskKey} key
 * @returns {Promise<string>}
 */
export async function replaceTaskId(home, key) {
  return updateIndex(home, (index) => {
    const id = newTaskId();
    index.tasks[taskKey(key)] = id;
    return id;
  });
}
