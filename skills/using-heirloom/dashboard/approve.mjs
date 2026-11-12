// Turn a human's dashboard decision into a signed approval record (PLAN 11.2, 11.4, 12).
// The record is saved first; the `approved` event is the notification that follows.

import path from 'node:path';

import { draftDigest } from '../lib/canonical.mjs';
import { HeirloomError } from '../lib/errors.mjs';
import { appendEvent, deriveState, readEvents } from '../lib/events.mjs';
import { readJson, writeJsonAtomic } from '../lib/fsx.mjs';
import { tryGit } from '../lib/git.mjs';
import { newApprovalId } from '../lib/ids.mjs';
import { taskPaths } from '../lib/paths.mjs';
import { approvalSchema, arrayOf, assertValid, codePath, validate } from '../lib/schema.mjs';
import { sign } from '../lib/sign.mjs';
import { computeSourceState } from '../lib/state.mjs';
import { withTaskLock } from '../lib/task-lock.mjs';

const DECISIONS = new Set(['approved', 'rejected', 'pending']);
const EDITABLE = new Set(['title', 'body', 'codePaths', 'topics']);

/**
 * @typedef {object} ApprovalRequest
 * @property {'full' | 'quick'} kind
 * @property {string} draftSha256 digest of the draft the screen showed
 * @property {string} sourceHash source state the screen showed
 * @property {string[]} summary final PR summary bullets
 * @property {{ index: number, decision: 'approved' | 'rejected' | 'pending', edited?: Record<string, unknown> }[]} items
 */

/**
 * @param {any} request
 * @param {any[]} records draft records
 * @returns {asserts request is ApprovalRequest}
 */
function checkRequest(request, records) {
  /** @param {string} message */
  const bad = (message) => {
    throw new HeirloomError('E_INPUT', message);
  };
  if (!request || typeof request !== 'object') bad('요청 본문이 객체가 아님');
  if (request.kind !== 'full' && request.kind !== 'quick') bad('kind는 full 또는 quick이어야 함');
  if (typeof request.draftSha256 !== 'string' || typeof request.sourceHash !== 'string') bad('draftSha256과 sourceHash가 필요함');
  if (!Array.isArray(request.summary) || !request.summary.length || request.summary.some((/** @type {unknown} */ s) => typeof s !== 'string' || !s.trim())) {
    bad('최종 요약 불릿이 하나 이상 필요함');
  }
  if (!Array.isArray(request.items)) bad('items가 배열이 아님');
  if (request.kind === 'quick') {
    if (records.length) bad('decision·axiom 초안이 있는 작업은 간이 승인을 쓸 수 없음');
    if (request.items.length) bad('간이 승인에는 items가 없어야 함');
    return;
  }
  const seen = new Set();
  for (const item of request.items) {
    if (!item || !Number.isInteger(item.index) || item.index < 0 || item.index >= records.length) bad(`잘못된 항목 번호: ${item?.index}`);
    if (seen.has(item.index)) bad(`항목 번호가 중복됨: ${item.index}`);
    seen.add(item.index);
    if (!DECISIONS.has(item.decision)) bad(`항목 ${item.index}: decision은 approved, rejected, pending 중 하나여야 함`);
    if (item.edited !== undefined) {
      if (records[item.index].op !== 'add') bad(`항목 ${item.index}: add 항목만 수정할 수 있음`);
      for (const key of Object.keys(item.edited)) if (!EDITABLE.has(key)) bad(`항목 ${item.index}: 수정할 수 없는 필드 ${key}`);
      if (item.edited.codePaths !== undefined) {
        const problems = validate(arrayOf(codePath), item.edited.codePaths);
        if (problems.length) bad(`항목 ${item.index}: ${problems.join('; ')}`);
      }
    }
  }
  if (seen.size !== records.length) bad('모든 decision·axiom 항목에 승인·거절·보류 중 하나를 명시해야 함');
  const decisionOf = new Map(request.items.map((/** @type {any} */ i) => [i.index, i.decision]));
  records.forEach((op, i) => {
    if (op.op === 'supersede' && decisionOf.get(i) === 'approved' && decisionOf.get(op.with) !== 'approved') {
      bad(`항목 ${i}: 대체를 승인하려면 대체하는 항목 ${op.with}도 승인해야 함`);
    }
  });
}

/**
 * @param {{ home: string, taskId: string, request: unknown, keystore?: import('../lib/sign.mjs').Keystore }} options
 */
export async function approveTask({ home, taskId, request, keystore }) {
  const paths = taskPaths(home, taskId);
  return withTaskLock(home, taskId, async () => {
    const input = /** @type {any} */ (await readJson(paths.input));
    const draft = /** @type {any} */ (await readJson(paths.draft));
    if (!input || !draft) throw new HeirloomError('E_CONFLICT', '승인할 초안이 없음');
    const state = deriveState(await readEvents(paths.events));
    if (state !== 'awaiting_approval') throw new HeirloomError('E_CONFLICT', `승인 대기 상태가 아님 (현재: ${state})`);

    checkRequest(request, draft.records);
    const digest = draftDigest(draft);
    if (request.draftSha256 !== digest || request.sourceHash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '화면이 보던 초안이나 소스 상태가 현재와 다름. 화면을 새로 고친 뒤 다시 검토한다.');
    }
    const current = await computeSourceState({ root: input.repo.root, mergeBase: input.base.mergeBase });
    if (current.hash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '인계 이후 소스가 바뀌어 승인할 수 없음. 에이전트가 prepare-handoff를 다시 실행해야 한다.');
    }

    const initial = /** @type {any} */ (await readJson(paths.draftInitial)) ?? draft;
    // Same identity resolution as `git commit` (config and GIT_AUTHOR_* env): "Name <email> <time> <tz>".
    const ident = await tryGit(['var', 'GIT_AUTHOR_IDENT'], { cwd: input.repo.root });
    const gitUser = ident ? ident.replace(/\s+\d+\s+[+-]\d{4}$/, '') : null;
    const record = {
      schemaVersion: 1,
      id: newApprovalId(),
      taskId,
      kind: request.kind,
      target: {
        sourceHash: input.source.hash,
        materials: Object.fromEntries(input.materials.map((/** @type {any} */ m) => [m.ref, m.sha256])),
        draftSha256: digest,
      },
      summary: { initial: initial.summary.map((/** @type {any} */ b) => b.text), final: request.summary.map((s) => s.trim()) },
      items: request.items.map((i) => (i.edited ? { index: i.index, decision: i.decision, edited: i.edited } : { index: i.index, decision: i.decision })),
      approver: { fingerprint: '', gitUser },
      approvedAt: new Date().toISOString(),
    };
    const signed = await sign(home, record, { keystore });
    assertValid(approvalSchema, signed, 'approval');
    await writeJsonAtomic(path.join(paths.approvals, `${signed.id}.json`), signed);
    await appendEvent(paths.events, { type: 'approved', approvalId: signed.id });
    return signed;
  });
}
