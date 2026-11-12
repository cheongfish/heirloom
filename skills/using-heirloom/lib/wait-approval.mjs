// Wait for the human's answer to a submitted handoff (PLAN 12.1). A live session runs this in
// the background after submitting, so it learns of the approval without being asked.
// The approval record stays the source of truth: this only reads the event log, and a
// missed wait is recovered at the next session start (PLAN 12).

import { access } from 'node:fs/promises';

import { HeirloomError } from './errors.mjs';
import { deriveState, readEvents } from './events.mjs';
import { taskPaths } from './paths.mjs';

/** States that end the wait. `approved` and later carry an approval. */
const ANSWERED = new Set(['approved', 'applied', 'pr_created', 'stale', 'discarded', 'expired']);

/**
 * @param {{ home: string, taskId: string, timeoutMs: number, pollMs?: number }} options
 * @returns {Promise<{ taskId: string, state: string, approvalId: string | null, timedOut: boolean }>}
 */
export async function waitForApproval({ home, taskId, timeoutMs, pollMs = 2000 }) {
  const file = taskPaths(home, taskId).events;
  try {
    await access(file);
  } catch {
    throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await readEvents(file);
    const state = deriveState(events);
    if (state !== null && ANSWERED.has(state)) {
      const approved = events.filter((e) => e.type === 'approved').at(-1);
      const approvalId = typeof approved?.approvalId === 'string' && state !== 'discarded' && state !== 'expired' ? approved.approvalId : null;
      return { taskId, state, approvalId, timedOut: false };
    }
    if (state !== 'awaiting_approval') {
      throw new HeirloomError('E_CONFLICT', `승인을 기다릴 수 없는 상태: ${state ?? '없음'}`, {
        hint: 'submit-draft.mjs가 성공한 뒤에 실행한다.',
      });
    }
    if (Date.now() >= deadline) return { taskId, state, approvalId: null, timedOut: true };
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}
