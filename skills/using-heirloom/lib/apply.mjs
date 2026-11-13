// Apply a signed approval: verify it, check the current state, write the approved records
// into the consumer repository and gather what the agent needs to open the PR.
//
// The approval record is the source of truth; events only tell what was already done, so
// running apply again never writes twice and never needs a second approval.

import { access, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { draftDigest } from './canonical.mjs';
import { HeirloomError, classifyError } from './errors.mjs';
import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson, writeFileAtomic } from './fsx.mjs';
import { buildCurationReview, curationReviewPath } from './curation.mjs';
import { verifiedApprovalRecord } from './baseline.mjs';
import { git, readTreeTexts, repoInfo } from './git.mjs';
import { findOpenPr, ghReady } from './github.mjs';
import { findOpenMr, glabReady, parseMrUrl } from './gitlab.mjs';
import { readIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { checkPrExpiry } from './pr-expiry.mjs';
import { findMrTemplates, findProjectRules } from './project-rules.mjs';
import { planRecordChanges } from './record-changes.mjs';
import { remoteProvider, taskRemote } from './remote.mjs';
import { appliedTaskMerged } from './record-status.mjs';
import { parseRecord, readRecords, recordPath, writeRecord } from './records.mjs';
import { currentSourceState, hashMaterial } from './state.mjs';
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
 * Handoffs in the current worktree that were approved but not finished. An applied
 * task whose approval is already on the target branch is finished even without a PR.
 * @param {{ home: string, cwd: string }} options
 */
export async function listPendingApprovals({ home, cwd }) {
  const ids = await readIds(await repoInfo(cwd), home);
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
 * PR or MR template selection: one template is used; several are listed and not chosen.
 * GitLab's own rule applies to MR templates: among several, `Default.md` is the default.
 * @param {string} root
 * @param {import('./remote.mjs').Provider | null} [provider]
 */
export async function prTemplateChoice(root, provider = 'github') {
  if (provider === 'gitlab') {
    const templates = await findMrTemplates(root);
    const fallback = templates.find((t) => path.posix.basename(t).toLowerCase() === 'default.md') ?? null;
    return { template: templates.length === 1 ? templates[0] : fallback, templates };
  }
  const { prTemplates } = await findProjectRules(root);
  return { template: prTemplates.length === 1 ? prTemplates[0] : null, templates: prTemplates };
}

/**
 * Load the latest approval of a task and check it end to end. Throws E_VERIFY when the
 * approval is unsigned, forged, or does not match the current draft.
 * @param {string} home
 * @param {string} taskId
 * @param {TaskEvent[]} events
 */
async function verifiedApproval(home, taskId, events) {
  const record = await verifiedApprovalRecord({ home, taskId, approvalId: lastOf(events, 'approved')?.approvalId });
  const draft = /** @type {any} */ (await readJson(taskPaths(home, taskId).draft));
  if (!draft || draftDigest(draft) !== record.target.draftSha256) {
    throw new HeirloomError('E_VERIFY', `승인 ${record.id}을(를) 믿을 수 없음: 승인 뒤에 초안이 바뀜`, {
      hint: '이 승인은 미승인으로 취급한다. 기록과 PR을 만들지 말고 사용자에게 알린다. 사용자가 대시보드에서 다시 승인해야 한다.',
    });
  }
  return { approval: record, draft };
}

/**
 * Whether the worktree is still in the state the human approved (sources and materials).
 * @param {any} input
 * @param {any} approval
 */
async function stateMatches(input, approval) {
  const current = await currentSourceState({ root: input.repo.root, base: input.base });
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
 * What the agent needs to open (or find) the PR or MR. Never fails the apply: problems are
 * reported as `available: false` with a reason; the records are still written.
 * @param {any} input
 */
async function prMaterial(input) {
  const root = input.repo.root;
  const { remote, branch: base, url } = await taskRemote(root, input.base.ref);
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
  const { provider, host, repo } = await remoteProvider({ cwd: root, url });
  const templates = await prTemplateChoice(root, provider);
  const pr = {
    available: false,
    /** @type {string | null} */
    reason: null,
    provider,
    host: provider ? host : null,
    base,
    head: input.branch,
    repo: provider ? repo : null,
    remote: remote ?? 'origin',
    /** GitHub: `{ number, url, base }`; GitLab: `{ iid, url, base }`. */
    /** @type {{ number: number, url: string, base: string } | { iid: number, url: string, base: string } | null} */
    existing: null,
    ...templates,
    ...fetch,
  };
  if (!input.branch) return { ...pr, reason: 'detached_head' };
  if (!provider || !host || !repo) return { ...pr, reason: 'unsupported_remote' };
  if (provider === 'gitlab') {
    const ready = await glabReady({ cwd: root, host });
    if (!ready.ok) return { ...pr, reason: ready.reason };
    pr.existing = await findOpenMr({ cwd: root, host, repo, head: input.branch });
  } else {
    const ready = await ghReady(root);
    if (!ready.ok) return { ...pr, reason: ready.reason };
    pr.existing = await findOpenPr({ cwd: root, repo, head: input.branch });
  }
  return { ...pr, available: true };
}

/**
 * @param {{ home: string, taskId: string }} options
 */
export async function applyApproval({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  if (!(await exists(paths.events))) throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);

  // A PR closed without merge ends the task. Unknown PR state keeps it waiting.
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
    const info = await repoInfo(root);
    // After the PR exists a different checkout only means the user moved on; the PR itself
    // is checked again once the task branch is back.
    if (state !== 'pr_created' && info.branch !== input.branch) {
      throw new HeirloomError('E_CONFLICT', `승인한 브랜치(${input.branch})가 아닌 ${info.branch ?? '분리된 HEAD'}가 체크아웃되어 있음`, {
        hint: `git switch ${input.branch} 뒤에 다시 실행한다.`,
      });
    }
    if (info.branch === input.branch) {
      const match = await stateMatches(input, approval);
      if (!match.ok) {
        await appendEvent(paths.events, { type: 'stale', approvalId: approval.id, reason: match.why });
        throw new HeirloomError('E_CONFLICT', `${match.why}. 승인은 보존되고, 바뀐 부분만 다시 확인받으면 된다`, {
          hint: '사용자에게 알리고 prepare-handoff를 다시 실행해 증분 재확인을 시작한다. 지금 상태로는 기록 파일과 PR을 만들거나 고치지 않는다.',
        });
      }
    }

    /** @type {string[]} */
    let files;
    if (already) {
      files = /** @type {string[]} */ (lastOf(events, 'records_written')?.files ?? []);
    } else {
      const { written, removed } = await writeApprovedRecords({ root, input, draft, approval, events });
      files = written;
      await appendEvent(paths.events, { type: 'records_written', approvalId: approval.id, files, ...(removed.length ? { removed } : {}) });
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
  // A PR from before an incremental recheck: its body is updated, not a new PR opened.
  const previousPr = state === 'pr_created' ? undefined : prEvent;
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
    removed: /** @type {string[]} */ (after.filter((e) => e.type === 'records_written' && e.approvalId === approval.id).at(-1)?.removed ?? []),
    summary: approval.summary.final,
    records: records.filter((/** @type {any} */ r) => r.decision === 'approved'),
    pendingItems: records.filter((/** @type {any} */ r) => r.decision === 'pending').map((/** @type {any} */ r) => r.index),
    prUrl: state === 'pr_created' && typeof prEvent?.url === 'string' ? prEvent.url : null,
    previousPrUrl: typeof previousPr?.url === 'string' ? previousPr.url : null,
    pr,
    commitGuides: (await findProjectRules(input.repo.root)).commitGuides,
  };
}

/**
 * Write the records of an approval into the consumer repository. Files written for an earlier approval of this task are not merged yet, so they are
 * first taken back to their merge-base version and the combined approval is applied again:
 * the same approval always yields the same files. Earlier files the new approval no longer
 * produces are restored from the merge-base, or removed when they did not exist there.
 * @param {{ root: string, input: any, draft: any, approval: any, events: TaskEvent[] }} options
 */
async function writeApprovedRecords({ root, input, draft, approval, events }) {
  const prior = [...new Set(events.filter((e) => e.type === 'records_written' && e.approvalId !== approval.id).flatMap((e) => /** @type {string[]} */ (e.files ?? [])))];
  const { records } = await readRecords(root);
  const existing = new Map(records.map((r) => [r.meta.id, { meta: r.meta, body: r.body }]));

  /** @type {Map<string, string>} */
  let baseTexts = new Map();
  if (prior.length) {
    const { mergeBase } = await currentSourceState({ root, base: input.base });
    baseTexts = await readTreeTexts({ cwd: root, ref: mergeBase, dirs: ['.heirloom'] });
    for (const file of prior) {
      if (!RECORD_FILE.test(file)) continue;
      const id = path.basename(file, '.md');
      const text = baseTexts.get(file);
      if (text === undefined) existing.delete(id);
      else {
        const doc = parseRecord(text, file);
        existing.set(id, { meta: doc.meta, body: doc.body });
      }
    }
  }

  const { writes } = planRecordChanges({ draft, approval, existing });
  /** @type {string[]} */
  const written = [];
  for (const doc of writes) {
    await writeRecord(root, doc);
    written.push(path.relative(root, recordPath(root, doc.meta)).split(path.sep).join('/'));
  }
  // A curation also leaves its review history, so the batch counts as reviewed once merged
  // and held or rejected candidates are not proposed again without new evidence.
  if (input.trigger === 'curation') {
    const review = buildCurationReview({ input, draft, approval });
    const file = curationReviewPath(review.id);
    await writeFileAtomic(path.join(root, file), `${JSON.stringify(review, null, 2)}\n`, { mode: 0o644, dirMode: 0o755 });
    written.push(file);
  }
  /** @type {string[]} */
  const removed = [];
  for (const file of prior) {
    if (written.includes(file)) continue;
    const text = baseTexts.get(file);
    if (text === undefined) await rm(path.join(root, file), { force: true });
    else await writeFile(path.join(root, file), text);
    removed.push(file);
  }
  return { written: written.sort(), removed: removed.sort() };
}

/**
 * A failure after the records were written: keep its code, and say that the records are
 * already written, so the agent does not report them as missing.
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

const RECORD_FILE = /^\.heirloom\/(decisions|axioms)\/[^/]+\.md$/;

const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;

/**
 * The provider of a PR or MR URL: a github.com pull request, or a merge request on a host
 * that counts as GitLab (gitlab.com, or a host glab is logged in to).
 * @param {string} url
 * @param {string} cwd
 * @returns {Promise<import('./remote.mjs').Provider>}
 */
async function reviewUrlProvider(url, cwd) {
  if (PR_URL.test(url)) return 'github';
  const mr = parseMrUrl(url);
  if (mr && (await remoteProvider({ cwd, url: `https://${mr.host}/${mr.repo}` })).provider === 'gitlab') return 'gitlab';
  throw new HeirloomError('E_INPUT', `GitHub PR URL이나 GitLab MR URL이 아님: ${url}`, {
    hint: 'https://github.com/<owner>/<repo>/pull/<번호> 또는 https://<GitLab 호스트>/<그룹>/<프로젝트>/-/merge_requests/<번호> 형식으로 준다. 자체 호스팅 GitLab은 glab이 그 호스트에 로그인되어 있어야 한다.',
  });
}

/**
 * Record that the PR or MR exists (its creation is its own state, after the records are written).
 * @param {{ home: string, taskId: string, prUrl: string }} options
 */
export async function completePr({ home, taskId, prUrl }) {
  const paths = taskPaths(home, taskId);
  if (!(await exists(paths.events))) throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);
  const input = /** @type {any} */ (await readJson(paths.input));
  const cwd = typeof input?.repo?.root === 'string' && (await exists(input.repo.root)) ? input.repo.root : home;
  const provider = await reviewUrlProvider(prUrl, cwd);
  return withTaskLock(home, taskId, async () => {
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    const done = lastOf(events, 'pr_created');
    if (state === 'pr_created') {
      if (done?.url === prUrl) return { taskId, state, prUrl, provider };
      throw new HeirloomError('E_CONFLICT', `이미 다른 PR이 기록됨: ${String(done?.url)}`);
    }
    if (state !== 'applied') throw new HeirloomError('E_CONFLICT', `기록 반영 전에는 PR 완료를 기록할 수 없음 (현재 상태: ${state ?? '없음'})`, { hint: 'apply.mjs를 먼저 실행한다.' });
    const approvalId = lastOf(events, 'records_written')?.approvalId;
    const next = await appendEvent(paths.events, { type: 'pr_created', approvalId, url: prUrl, provider });
    return { taskId, state: next, prUrl, provider };
  });
}

