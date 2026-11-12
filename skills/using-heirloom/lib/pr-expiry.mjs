// Expiry of tasks whose PR was closed without merge (PLAN 12.2, 14.3; MVP-PLAN 7.5).
// Only gh tells whether a PR was closed. When gh is missing, unauthenticated or offline the
// task keeps waiting: nothing is guessed.

import { access } from 'node:fs/promises';

import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { prState } from './github.mjs';
import { taskPaths } from './paths.mjs';
import { withTaskLock } from './task-lock.mjs';

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
 * @typedef {object} ExpiryCheck
 * @property {string | null} state task state after the check
 * @property {'OPEN' | 'CLOSED' | 'MERGED' | null} pr null when it could not be checked
 * @property {string | null} reason why it could not be checked
 */

/**
 * Check the PR of a `pr_created` task and record `expired` when it was closed without merge.
 * @param {{ home: string, taskId: string, lookup?: typeof prState }} options
 * @returns {Promise<ExpiryCheck>}
 */
export async function checkPrExpiry({ home, taskId, lookup = prState }) {
  const paths = taskPaths(home, taskId);
  const events = await readEvents(paths.events);
  const state = deriveState(events);
  const url = events.filter((e) => e.type === 'pr_created').at(-1)?.url;
  if (state !== 'pr_created' || typeof url !== 'string') return { state, pr: null, reason: 'not_pr_created' };
  const input = /** @type {any} */ (await readJson(paths.input));
  const root = typeof input?.repo?.root === 'string' && (await exists(input.repo.root)) ? input.repo.root : home;
  let pr;
  try {
    pr = await lookup({ cwd: root, url });
  } catch (err) {
    return { state, pr: null, reason: err instanceof Error ? err.message : String(err) };
  }
  if (pr !== 'CLOSED') return { state, pr, reason: null };
  const next = await withTaskLock(home, taskId, async () => {
    const now = deriveState(await readEvents(paths.events));
    if (now !== 'pr_created') return now;
    return appendEvent(paths.events, { type: 'expired', reason: 'pr_closed', url });
  });
  return { state: next, pr, reason: null };
}

/**
 * Check every `pr_created` task, remembering answers: a merged PR is never asked again,
 * an open or unknown one again after `ttlMs`. Used by the dashboard list.
 * @param {{ home: string, taskIds: string[], cache: Map<string, { pr: string | null, at: number }>, now?: number, ttlMs?: number, lookup?: typeof prState }} options
 * @returns {Promise<string[]>} task ids that expired in this call
 */
export async function refreshPrExpiry({ home, taskIds, cache, now = Date.now(), ttlMs = 5 * 60_000, lookup = prState }) {
  const due = taskIds.filter((id) => {
    const hit = cache.get(id);
    return !hit || (hit.pr !== 'MERGED' && now - hit.at >= ttlMs);
  });
  const results = await Promise.all(
    due.map(async (taskId) => {
      try {
        const check = await checkPrExpiry({ home, taskId, lookup });
        cache.set(taskId, { pr: check.pr, at: now });
        return check.state === 'expired' ? taskId : null;
      } catch {
        cache.set(taskId, { pr: null, at: now });
        return null;
      }
    }),
  );
  return results.filter((id) => id !== null);
}
