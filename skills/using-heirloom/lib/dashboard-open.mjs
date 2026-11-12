// Make sure the dashboard server runs and open a task screen or the overview (MVP-PLAN 6.5).
// After a submit (`once`), the browser opens only the first time per task.

import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBrowser } from './browser.mjs';
import { loadUserConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { taskPaths } from './paths.mjs';
import { ensureServer } from './server-control.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @typedef {object} OpenOptions
 * @property {string} home
 * @property {string} [taskId] omitted: the overview
 * @property {boolean} [once] open only if the task's dashboard was never opened, and only if
 *   the user config allows opening the browser automatically
 * @property {(o: { home: string, pluginRoot: string }) => Promise<{ status: string, url: string }>} [ensure]
 * @property {(url: string) => Promise<{ opened: boolean, reason?: string }>} [open]
 */

/**
 * @param {OpenOptions} options
 * @returns {Promise<{ url: string, server: string, opened: boolean, reason: string | null }>}
 */
export async function openDashboard({ home, taskId, once = false, ensure = ensureServer, open = openBrowser }) {
  /** @type {{ repo: { id: string }, worktree: { id: string } } | undefined} */
  let input;
  /** @type {ReturnType<typeof taskPaths> | undefined} */
  let paths;
  if (taskId !== undefined) {
    paths = taskPaths(home, taskId);
    try {
      await access(paths.events);
    } catch {
      throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);
    }
    input = /** @type {any} */ (await readJson(paths.input));
  }

  const server = await ensure({ home, pluginRoot: PLUGIN_ROOT });
  const url =
    taskId === undefined
      ? server.url
      : input
        ? `${server.url}r/${input.repo.id}/w/${input.worktree.id}/t/${taskId}`
        : `${server.url}r/-/w/-/t/${taskId}`;

  const events = paths ? await readEvents(paths.events) : [];
  const alreadyOpened = events.some((e) => e.type === 'dashboard_opened');
  if (once) {
    if (alreadyOpened) return { url, server: server.status, opened: false, reason: 'already_opened' };
    if (!(await loadUserConfig(home)).dashboard.openBrowser) return { url, server: server.status, opened: false, reason: 'disabled' };
  }

  const result = await open(url);
  if (!result.opened) return { url, server: server.status, opened: false, reason: result.reason ?? 'failed' };
  if (paths && !alreadyOpened) {
    const state = deriveState(events);
    if (state !== 'discarded' && state !== 'expired') await appendEvent(paths.events, { type: 'dashboard_opened' });
  }
  return { url, server: server.status, opened: true, reason: null };
}
