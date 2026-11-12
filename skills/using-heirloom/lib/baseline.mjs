// A signed approval and the state it was given.
// The input and draft copies saved next to the record are trusted only when they hash to
// what the signature covers, so a new prepare cannot rewrite what was approved.

import { draftDigest } from './canonical.mjs';
import { HeirloomError } from './errors.mjs';
import { readJson } from './fsx.mjs';
import { approvalFiles, taskPaths } from './paths.mjs';
import { approvalSchema, validate } from './schema.mjs';
import { verify } from './sign.mjs';
import { hashEntries } from './state.mjs';

/**
 * @param {string} approvalId
 * @param {string} why
 */
const untrusted = (approvalId, why) =>
  new HeirloomError('E_VERIFY', `승인 ${approvalId}을(를) 믿을 수 없음: ${why}`, {
    hint: '이 승인은 미승인으로 취급한다. 기록과 PR을 만들지 말고 사용자에게 알린다. 사용자가 대시보드에서 다시 승인해야 한다.',
  });

/**
 * Read an approval record and check its signature, schema and task. Throws E_VERIFY.
 * @param {{ home: string, taskId: string, approvalId: unknown }} options
 * @returns {Promise<any>} the approval record
 */
export async function verifiedApprovalRecord({ home, taskId, approvalId }) {
  if (typeof approvalId !== 'string') throw new HeirloomError('E_VERIFY', '승인 이벤트에 승인 ID가 없음');
  const record = /** @type {any} */ (await readJson(approvalFiles(taskPaths(home, taskId).approvals, approvalId).record));
  if (!record) throw untrusted(approvalId, '승인 기록 파일이 없음');
  const result = await verify(home, record);
  if (!result.ok) throw untrusted(approvalId, result.reason === 'missing_signature' ? '서명이 없음' : result.reason === 'unknown_key' ? '알 수 없는 서명 키' : '서명이 맞지 않음');
  const problems = validate(approvalSchema, record);
  if (problems.length) throw untrusted(approvalId, `형식 오류 (${problems.join('; ')})`);
  if (record.id !== approvalId || record.taskId !== taskId) throw untrusted(approvalId, '다른 작업이나 다른 승인의 기록임');
  return record;
}

/**
 * The approval with the input and draft it approved. Approvals made before the copies
 * existed fall back to the task's current files when those still match.
 * @param {{ home: string, taskId: string, approvalId: unknown }} options
 * @returns {Promise<{ approval: any, input: any, draft: any }>}
 */
export async function loadApprovalBaseline({ home, taskId, approvalId }) {
  const approval = await verifiedApprovalRecord({ home, taskId, approvalId });
  const paths = taskPaths(home, taskId);
  const files = approvalFiles(paths.approvals, approval.id);
  const input = /** @type {any} */ ((await readJson(files.input)) ?? (await readJson(paths.input)));
  const draft = /** @type {any} */ ((await readJson(files.draft)) ?? (await readJson(paths.draft)));
  const target = approval.target;
  if (!input || input.source?.hash !== target.sourceHash || hashEntries(input.source.files) !== target.sourceHash) {
    throw untrusted(approval.id, '승인 당시 입력을 찾지 못했거나 서명된 소스 상태와 맞지 않음');
  }
  if (!draft || draftDigest(draft) !== target.draftSha256) throw untrusted(approval.id, '승인 당시 초안을 찾지 못했거나 서명된 초안과 맞지 않음');
  return { approval, input, draft };
}
