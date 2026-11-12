// Task event log and state machine. The human's approval, the agent's receipt of it and the
// PR are separate states, so none of them is taken for another.

import { HeirloomError } from './errors.mjs';
import { appendJsonLine, readJsonl, withLock } from './fsx.mjs';
import { assertValid, eventSchema } from './schema.mjs';

/** @typedef {(typeof import('./schema.mjs').EVENT_TYPES)[number]} EventType */
/** @typedef {{ at: string, type: EventType, [key: string]: unknown }} TaskEvent */
/**
 * @typedef {'prepared' | 'drafted' | 'awaiting_approval' | 'approved' | 'applied' | 'pr_created'
 *   | 'failed' | 'stale' | 'discarded' | 'expired'} TaskState
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

/**
 * Number of prepare runs recorded for a source state (at most two: one transient retry).
 * @param {TaskEvent[]} events
 * @param {string} sourceHash
 */
export function countAttempts(events, sourceHash) {
  return events.filter((e) => e.type === 'prepared' && e.sourceHash === sourceHash).length;
}
