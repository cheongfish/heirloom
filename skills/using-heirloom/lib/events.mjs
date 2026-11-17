// Task event log and state machine. The human's approval, the agent's receipt of it and the
// PR are separate states, so none of them is taken for another.

import { HeirloomError } from './errors.mjs';
import { appendJsonLine, readJsonl, withLock } from './fsx.mjs';
import { assertValid, eventSchema } from './schema.mjs';

/** @typedef {(typeof import('./schema.mjs').EVENT_TYPES)[number]} EventType */
/** @typedef {{ at: string, type: EventType, [key: string]: unknown }} TaskEvent */
/**
 * @typedef {'prepared' | 'drafted' | 'awaiting_approval' | 'approved' | 'applied' | 'pr_created'
 *   | 'failed' | 'stale' | 'returned' | 'discarded' | 'expired'} TaskState
 */

const TERMINAL = new Set(['discarded', 'expired']);

/**
 * @param {TaskState | null} state
 * @param {TaskEvent} event
 * @param {readonly (TaskState | null)[]} allowed
 */
function require(state, event, allowed) {
  if (!allowed.includes(state)) {
    throw new HeirloomError('E_CONFLICT', `현재 상태 ${state ?? '(없음)'}에서 ${event.type} 이벤트를 받을 수 없음`);
  }
}

/** @param {TaskState | null} state */
const live = (state) => state !== null && !TERMINAL.has(state);

/**
 * Apply one event to a state. Throws E_CONFLICT on an invalid transition.
 * @param {TaskState | null} state
 * @param {TaskEvent} event
 * @returns {TaskState}
 */
export function nextState(state, event) {
  switch (event.type) {
    case 'prepared':
      if (state !== null && TERMINAL.has(state)) require(state, event, []);
      return 'prepared';
    case 'draft_checked':
      require(state, event, ['prepared', 'drafted', 'awaiting_approval']);
      return event.ok === true ? 'drafted' : /** @type {TaskState} */ (state);
    case 'awaiting_approval':
      require(state, event, ['drafted']);
      return 'awaiting_approval';
    case 'dashboard_opened':
      if (!live(state)) require(state, event, []);
      return /** @type {TaskState} */ (state);
    case 'approved':
      require(state, event, ['awaiting_approval']);
      return 'approved';
    case 'returned':
      // The human judged and sent the work back: the agent changes the code and prepares again.
      require(state, event, ['awaiting_approval']);
      return 'returned';
    case 'approval_received':
      require(state, event, ['approved', 'applied', 'pr_created']);
      return /** @type {TaskState} */ (state);
    case 'records_written':
      require(state, event, ['approved']);
      return 'applied';
    case 'pr_created':
      require(state, event, ['applied']);
      return 'pr_created';
    case 'failed':
      require(state, event, ['prepared', 'drafted']);
      return 'failed';
    case 'stale':
      require(state, event, ['approved', 'applied', 'pr_created']);
      return 'stale';
    case 'agent_started':
    case 'agent_finished':
      // Notices about a headless run of the context curation removed in 0.4: older task logs
      // still have them, and they never moved the task.
      return /** @type {TaskState} */ (state);
    case 'discarded':
    case 'expired':
      if (!live(state)) require(state, event, []);
      return event.type;
    default:
      throw new HeirloomError('E_INPUT', `알 수 없는 이벤트: ${String(/** @type {{type: unknown}} */ (event).type)}`);
  }
}

/**
 * @param {TaskEvent[]} events
 * @returns {TaskState | null}
 */
export function deriveState(events) {
  /** @type {TaskState | null} */
  let state = null;
  for (const event of events) state = nextState(state, event);
  return state;
}

/**
 * @param {string} file
 * @returns {Promise<TaskEvent[]>}
 */
export async function readEvents(file) {
  return /** @type {TaskEvent[]} */ (await readJsonl(file));
}

/**
 * Validate the event against the current log and append it, under the log's lock.
 * @param {string} file events.jsonl
 * @param {{ type: EventType, [key: string]: unknown }} event `at` is filled in
 * @returns {Promise<TaskState>} the new state
 */
export async function appendEvent(file, event) {
  /** @type {TaskEvent} */
  const stamped = { ...event, at: new Date().toISOString() };
  assertValid(eventSchema, stamped, 'event');
  return withLock(file, async () => {
    const state = nextState(deriveState(await readEvents(file)), stamped);
    await appendJsonLine(file, stamped);
    return state;
  });
}

/** Times one question may be sent back before the dashboard recommends agreeing on the design again. */
export const REDESIGN_AFTER = 2;

/**
 * @typedef {object} PastReturn
 * @property {string} approvalId
 * @property {string} verdict `revert` or `split`
 * @property {string} reason
 * @property {string} at
 */

/**
 * Every time the person sent a question back, by question id, oldest first. A question is the
 * same across rounds when it keeps its id.
 * @param {TaskEvent[]} events
 * @returns {Map<string, PastReturn[]>}
 */
export function returnsByQuestion(events) {
  /** @type {Map<string, PastReturn[]>} */
  const out = new Map();
  for (const e of events) {
    if (e.type !== 'returned' || !Array.isArray(e.items)) continue;
    for (const i of /** @type {any[]} */ (e.items)) {
      if (typeof i?.id !== 'string') continue;
      const list = out.get(i.id) ?? [];
      list.push({ approvalId: String(e.approvalId), verdict: String(i.verdict), reason: String(i.reason ?? ''), at: e.at });
      out.set(i.id, list);
    }
  }
  return out;
}

/**
 * Questions sent back at least REDESIGN_AFTER times: the dashboard recommends agreeing on the
 * design again instead of another round of fixes. Nothing is blocked beyond the PR itself.
 * @param {TaskEvent[]} events
 * @returns {{ id: string, returns: PastReturn[] }[]}
 */
export function repeatedReturns(events) {
  return [...returnsByQuestion(events)].filter(([, list]) => list.length >= REDESIGN_AFTER).map(([id, returns]) => ({ id, returns }));
}

/**
 * Number of prepare runs recorded for a source state (at most two: one transient retry).
 * @param {TaskEvent[]} events
 * @param {string} sourceHash
 */
export function countAttempts(events, sourceHash) {
  return events.filter((e) => e.type === 'prepared' && e.sourceHash === sourceHash).length;
}
