// Apply a signed approval: verify it, check the current state, write the approved records
// into the consumer repository and gather what the agent needs to open the PR
// (PLAN 11.4, 12, 14.2, 16; MVP-PLAN 7.2 apply.mjs and complete.mjs).
//
// The approval record is the source of truth; events only tell what was already done, so
// running apply again never writes twice and never needs a second approval (PLAN 12).

import { access } from 'node:fs/promises';
import path from 'node:path';

import { draftDigest } from './canonical.mjs';
import { HeirloomError, classifyError } from './errors.mjs';
import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { git, listRemotes, repoInfo, tryGit } from './git.mjs';
import { baseBranchName, findOpenPr, ghReady, parseGithubRemote } from './github.mjs';
import { readIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { checkPrExpiry } from './pr-expiry.mjs';
import { findProjectRules } from './project-rules.mjs';
import { planRecordChanges } from './record-changes.mjs';
import { appliedTaskMerged } from './record-status.mjs';
import { readRecords, recordPath, writeRecord } from './records.mjs';
import { approvalSchema, validate } from './schema.mjs';
import { verify } from './sign.mjs';
import { computeSourceState, hashMaterial } from './state.mjs';
import { readIndex, tasksForWorktree } from './store.mjs';
import { withTaskLock } from './task-lock.mjs';

/** @typedef {import('./events.mjs').TaskEvent} TaskEvent */

/** @param {string} p */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** @param {TaskEvent[]} events @param {string} type */
const lastOf = (events, type) => events.filter((e) => e.type === type).at(-1);

/**
 * Handoffs in the current worktree that were approved but not finished (PLAN 12.1). An applied
 * task whose approval is already on the target branch is finished even without a PR.
 * @param {{ home: string, cwd: string }} options
 */
export async function listPendingApprovals({ home, cwd }) {
  const ids = await readIds(await repoInfo(cwd));
  if (!ids) return [];
  const index = await readIndex(home);
  const pending = [];
  for (const { taskId } of tasksForWorktree(index, ids.worktreeId)) {
    const events = await readEvents(taskPaths(home, taskId).events);
    const state = deriveState(events);
    if (state !== 'approved' && state !== 'applied') continue;
    if (state === 'applied' && (await appliedTaskMerged({ home, taskId }))) continue;
    const input = /** @type {any} */ (await readJson(taskPaths(home, taskId).input));
    pending.push({ taskId, state, approvalId: String(lastOf(events, 'approved')?.approvalId ?? ''), branch: input?.branch ?? null, approvedAt: lastOf(events, 'approved')?.at ?? null });
  }
  return pending.sort((a, b) => String(a.approvedAt).localeCompare(String(b.approvedAt)));
}

/**
 * PR template selection (PLAN 16.2): one template is used; several are listed and not chosen.
 * @param {string} root
 */
export async function prTemplateChoice(root) {
  const { prTemplates } = await findProjectRules(root);
  return { template: prTemplates.length === 1 ? prTemplates[0] : null, templates: prTemplates };
}

/**
 * Load the latest approval of a task and check it end to end. Throws E_VERIFY when the
 * approval is unsigned, forged, or does not match the current draft (PLAN 11.4).
 * @param {string} home
 * @param {string} taskId
 * @param {TaskEvent[]} events
 */
async function verifiedApproval(home, taskId, events) {
  const paths = taskPaths(home, taskId);
  const approvalId = lastOf(events, 'approved')?.approvalId;
  if (typeof approvalId !== 'string') throw new HeirloomError('E_VERIFY', '승인 이벤트에 승인 ID가 없음');
  const record = /** @type {any} */ (await readJson(path.join(paths.approvals, `${approvalId}.json`)));
  const fail = (/** @type {string} */ why) =>
    new HeirloomError('E_VERIFY', `승인 ${approvalId}을(를) 믿을 수 없음: ${why}`, {
      hint: '이 승인은 미승인으로 취급한다. 기록과 PR을 만들지 말고 사용자에게 알린다. 사용자가 대시보드에서 다시 승인해야 한다.',
    });
  if (!record) throw fail('승인 기록 파일이 없음');
  const result = await verify(home, record);
  if (!result.ok) throw fail(result.reason === 'missing_signature' ? '서명이 없음' : result.reason === 'unknown_key' ? '알 수 없는 서명 키' : '서명이 맞지 않음');
  const problems = validate(approvalSchema, record);
  if (problems.length) throw fail(`형식 오류 (${problems.join('; ')})`);
  if (record.id !== approvalId || record.taskId !== taskId) throw fail('다른 작업이나 다른 승인의 기록임');
  const draft = /** @type {any} */ (await readJson(paths.draft));
  if (!draft || draftDigest(draft) !== record.target.draftSha256) throw fail('승인 뒤에 초안이 바뀜');
  return { approval: record, draft };
}

/**
 * Whether the worktree is still in the state the human approved (sources and materials).
 * @param {any} input
 * @param {any} approval
 */
async function stateMatches(input, approval) {
  const current = await computeSourceState({ root: input.repo.root, mergeBase: input.base.mergeBase });
  if (current.hash !== approval.target.sourceHash) return { ok: false, why: '승인 이후 소스가 바뀜' };
  for (const [ref, sha] of Object.entries(approval.target.materials)) {
    if (!sha) continue;
    let now = null;
    try {
      now = await hashMaterial(input.repo.root, ref);
    } catch {
      // deleted
    }
    if (now !== sha) return { ok: false, why: `승인 이후 자료가 바뀜: ${ref}` };
  }
  return { ok: true, why: null };
}

/**
 * What the agent needs to open (or find) the PR. Never fails the apply: problems are
 * reported as `available: false` with a reason (decision 2026-11-12).
 * @param {any} input
 */
async function prMaterial(input) {
  const root = input.repo.root;
  const remotes = await listRemotes(root).catch(() => []);
  const { remote, branch: base } = baseBranchName(input.base.ref, remotes);
  /** @type {{ fetched: boolean | null, note: string | null }} */
  const fetch = { fetched: null, note: null };
  if (remote) {
    try {
      await git(['fetch', '--quiet', remote, base], { cwd: root, timeoutMs: 10_000 });
      fetch.fetched = true;
    } catch (err) {
      fetch.fetched = false;
      fetch.note = `git fetch ${remote} ${base} 실패: 머지 상태는 미확인`;
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  const url = await tryGit(['remote', 'get-url', remote ?? 'origin'], { cwd: root });
  const github = parseGithubRemote(url);
  const templates = await prTemplateChoice(root);
  const pr = {
    available: false,
    /** @type {string | null} */
    reason: null,
    base,
    head: input.branch,
    repo: github ? `${github.owner}/${github.repo}` : null,
    remote: remote ?? 'origin',
    /** @type {{ number: number, url: string, base: string } | null} */
    existing: null,
    ...templates,
    ...fetch,
  };
  if (!input.branch) return { ...pr, reason: 'detached_head' };
  if (!github) return { ...pr, reason: 'not_github' };
  const ready = await ghReady(root);
  if (!ready.ok) return { ...pr, reason: ready.reason };
  pr.existing = await findOpenPr({ cwd: root, repo: /** @type {string} */ (pr.repo), head: input.branch });
  return { ...pr, available: true };
}

/**
 * @param {{ home: string, taskId: string }} options
 */
export async function applyApproval({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  if (!(await exists(paths.events))) throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);

  // A PR closed without merge ends the task (PLAN 12.2). Unknown PR state keeps it waiting.
  if (deriveState(await readEvents(paths.events)) === 'pr_created') {
    const check = await checkPrExpiry({ home, taskId });
    if (check.state === 'expired') {
      throw new HeirloomError('E_CONFLICT', 'PR이 머지 없이 닫혀 작업이 만료됨', {
        hint: '사용자에게 알린다. 같은 변경을 다시 올리려면 prepare-handoff로 새로 인계한다.',
      });
    }
  }

  const written = await withTaskLock(home, taskId, async () => {
    const input = /** @type {any} */ (await readJson(paths.input));
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    if (state !== 'approved' && state !== 'applied' && state !== 'pr_created') {
      throw new HeirloomError('E_CONFLICT', `반영할 승인이 없음 (현재 상태: ${state ?? '없음'})`, {
        hint: state === 'awaiting_approval' ? '사람이 대시보드에서 승인할 때까지 기다린다.' : state === 'stale' ? 'prepare-handoff로 다시 인계한다.' : undefined,
      });
    }
    const { approval, draft } = await verifiedApproval(home, taskId, events);
    if (!events.some((e) => e.type === 'approval_received' && e.approvalId === approval.id)) {
      await appendEvent(paths.events, { type: 'approval_received', approvalId: approval.id, by: 'apply' });
    }

    const root = input.repo.root;
    const already = state !== 'approved';
    if (state !== 'pr_created') {
      const info = await repoInfo(root);
      if (info.branch !== input.branch) {
        throw new HeirloomError('E_CONFLICT', `승인한 브랜치(${input.branch})가 아닌 ${info.branch ?? '분리된 HEAD'}가 체크아웃되어 있음`, {
          hint: `git switch ${input.branch} 뒤에 다시 실행한다.`,
        });
      }
      const match = await stateMatches(input, approval);
      if (!match.ok) {
        await appendEvent(paths.events, { type: 'stale', approvalId: approval.id, reason: match.why });
        throw new HeirloomError('E_CONFLICT', `${match.why}. 승인은 보존되지만 이 상태로는 반영할 수 없음`, {
          hint: '사용자에게 알리고 prepare-handoff로 다시 인계한다. 기록 파일과 PR은 만들지 않는다.',
        });
      }
    }

    /** @type {string[]} */
    let files;
    if (already) {
      files = /** @type {string[]} */ (lastOf(events, 'records_written')?.files ?? []);
    } else {
      const { records } = await readRecords(root);
      const existing = new Map(records.map((r) => [r.meta.id, { meta: r.meta, body: r.body }]));
      const { writes } = planRecordChanges({ draft, approval, existing });
      files = [];
      for (const doc of writes) {
        await writeRecord(root, doc);
        files.push(path.relative(root, recordPath(root, doc.meta)).split(path.sep).join('/'));
      }
      files.sort();
      await appendEvent(paths.events, { type: 'records_written', approvalId: approval.id, files });
    }
    return { input, draft, approval, files, already };
  });

  const { input, draft, approval, files, already } = written;
  const records = approval.items.map((/** @type {any} */ item) => {
    const op = draft.records[item.index];
    const target = op.op === 'add' ? op.id : op.target;
    return {
      index: item.index,
      op: op.op,
      kind: op.op === 'add' ? op.kind : String(target).startsWith('a-') ? 'axiom' : 'decision',
      id: target,
      title: item.edited?.title ?? op.title ?? null,
      decision: item.decision,
    };
  });
  const after = await readEvents(paths.events);
  const state = deriveState(after);
  const prEvent = lastOf(after, 'pr_created');
  /** @type {Awaited<ReturnType<typeof prMaterial>> | null} */
  let pr = null;
  try {
    if (state !== 'pr_created') pr = await prMaterial(input);
  } catch (err) {
    throw recordsKept(err, files);
  }
  return {
    taskId,
    approvalId: approval.id,
    state,
    alreadyApplied: already,
    root: input.repo.root,
    files,
    summary: approval.summary.final,
    records: records.filter((/** @type {any} */ r) => r.decision === 'approved'),
    pendingItems: records.filter((/** @type {any} */ r) => r.decision === 'pending').map((/** @type {any} */ r) => r.index),
    prUrl: typeof prEvent?.url === 'string' ? prEvent.url : null,
    pr,
    commitGuides: (await findProjectRules(input.repo.root)).commitGuides,
  };
}

/**
 * A failure after the records were written: keep its code, and say that the records are
 * already written, so the agent does not report them as missing (acceptance A8).
 * @param {unknown} err
 * @param {string[]} files
 */
function recordsKept(err, files) {
  const e = classifyError(err);
  const written = files.length ? files.join(', ') : '쓸 기록 없음';
  return new HeirloomError(e.code, `기록 파일은 이미 씀(상태 applied: ${written}). PR 준비 단계에서 실패: ${e.message}`, {
    cause: err,
    hint: [`다시 실행하면 기록을 다시 쓰지 않고 PR 단계부터 이어진다.`, e.hint].filter(Boolean).join(' '),
  });
}

const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;

/**
 * Record that the PR exists (PLAN 12: PR creation is its own state).
 * @param {{ home: string, taskId: string, prUrl: string }} options
 */
export async function completePr({ home, taskId, prUrl }) {
  if (!PR_URL.test(prUrl)) throw new HeirloomError('E_INPUT', `GitHub PR URL이 아님: ${prUrl}`, { hint: 'https://github.com/<owner>/<repo>/pull/<번호> 형식으로 준다.' });
  const paths = taskPaths(home, taskId);
  if (!(await exists(paths.events))) throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);
  return withTaskLock(home, taskId, async () => {
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    const done = lastOf(events, 'pr_created');
    if (state === 'pr_created') {
      if (done?.url === prUrl) return { taskId, state, prUrl };
      throw new HeirloomError('E_CONFLICT', `이미 다른 PR이 기록됨: ${String(done?.url)}`);
    }
    if (state !== 'applied') throw new HeirloomError('E_CONFLICT', `기록 반영 전에는 PR 완료를 기록할 수 없음 (현재 상태: ${state ?? '없음'})`, { hint: 'apply.mjs를 먼저 실행한다.' });
    const approvalId = lastOf(events, 'records_written')?.approvalId;
    const next = await appendEvent(paths.events, { type: 'pr_created', approvalId, url: prUrl });
    return { taskId, state: next, prUrl };
  });
}

