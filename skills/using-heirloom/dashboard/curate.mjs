// Dashboard actions of context curation: start a curation the user chose to run, run the
// apply step after its approval, and run a failed step again on request.

import { rm } from 'node:fs/promises';

import { startAgent } from '../lib/agent-runner.mjs';
import { curationStatus } from '../lib/curation.mjs';
import { createCurationWorktree, readCurationMeta, removeCurationWorktree } from '../lib/curation-worktree.mjs';
import { HeirloomError } from '../lib/errors.mjs';
import { appendEvent, deriveState, readEvents } from '../lib/events.mjs';
import { taskPaths } from '../lib/paths.mjs';
import { prepareCuration } from '../lib/prepare-curation.mjs';
import { taskKey, updateIndex } from '../lib/store.mjs';

/**
 * @typedef {object} RunOptions
 * @property {string} home
 * @property {string} pluginRoot
 * @property {(taskId: string) => void} [onStart] a headless run started
 * @property {(taskId: string) => void} [onExit] it ended
 * @property {(line: string) => void} [log]
 * @property {number} [timeoutMs]
 */

/**
 * @param {RunOptions & { taskId: string, phase: import('../lib/agent-runner.mjs').AgentPhase, worktree: string }} options
 */
async function run({ home, pluginRoot, onStart = () => {}, onExit = () => {}, log, timeoutMs, taskId, phase, worktree }) {
  onStart(taskId);
  try {
    return await startAgent({ home, taskId, phase, worktree, pluginRoot, timeoutMs, log, onExit: () => onExit(taskId) });
  } catch (err) {
    onExit(taskId);
    throw err;
  }
}

/**
 * Create a curation task in its own worktree, freeze its input and start the headless
 * curation. Refused while another curation of the repository is in progress or when there
 * is nothing to review.
 * @param {RunOptions & { repoId: string }} options
 */
export async function startCuration(options) {
  const { home, repoId } = options;
  const status = await curationStatus({ home, repoId });
  if (status.inProgress.length) {
    throw new HeirloomError('E_CONFLICT', `이 저장소의 정리 작업이 이미 진행 중임: ${status.inProgress.map((t) => t.taskId).join(', ')}`);
  }
  if (status.error) throw new HeirloomError('E_INPUT', `정리를 시작할 수 없음: ${status.error}`);
  if (!status.unreviewed) throw new HeirloomError('E_CONFLICT', '검토하지 않은 활성 decision이 없음');

  const meta = await createCurationWorktree({ home, repoId });
  const paths = taskPaths(home, meta.taskId);
  try {
    await prepareCuration({ home, cwd: meta.worktree });
  } catch (err) {
    // Nothing was handed to anyone yet: take the worktree and the task back.
    await removeCurationWorktree({ home, taskId: meta.taskId }).catch(() => {});
    await updateIndex(home, (index) => {
      delete index.tasks[taskKey({ worktreeId: meta.worktreeId, branch: meta.branch, specRef: null })];
    });
    await rm(paths.dir, { recursive: true, force: true });
    throw err;
  }
  // The user is already looking at the dashboard: the headless submit must not open it again.
  await appendEvent(paths.events, { type: 'dashboard_opened' });
  const agent = await run({ ...options, taskId: meta.taskId, phase: 'curate', worktree: meta.worktree });
  return { taskId: meta.taskId, worktree: meta.worktree, branch: meta.branch, base: meta.base, fetch: meta.fetch, agent };
}

/**
 * The headless step a curation task needs in its current state, or null.
 * @param {string | null} state
 * @returns {import('../lib/agent-runner.mjs').AgentPhase | null}
 */
export function phaseFor(state) {
  if (state === 'prepared' || state === 'drafted') return 'curate';
  if (state === 'approved' || state === 'applied') return 'apply';
  return null;
}

/**
 * Start the step a curation task needs now: after an approval, or when the user asks to run
 * a failed step again. Never retried automatically.
 * @param {RunOptions & { taskId: string }} options
 */
export async function runCurationStep(options) {
  const { home, taskId } = options;
  const meta = await readCurationMeta(home, taskId);
  if (!meta) throw new HeirloomError('E_INPUT', `정리 작업이 아님: ${taskId}`);
  if (meta.removedAt) throw new HeirloomError('E_CONFLICT', '정리 worktree가 이미 지워짐');
  const state = deriveState(await readEvents(taskPaths(home, taskId).events));
  const phase = phaseFor(state);
  if (!phase) throw new HeirloomError('E_CONFLICT', `지금 상태(${state ?? '없음'})에서는 실행할 단계가 없음`);
  const agent = await run({ ...options, phase, worktree: meta.worktree });
  return { taskId, phase, agent };
}
