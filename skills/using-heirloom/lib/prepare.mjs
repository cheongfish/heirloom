// Freeze the handoff input: scope, source state, materials and project rules, and the messages
// the person typed in the session (a source for decisions made in the conversation).
// One run per source/material state: the same state returns the existing task.

import { rm } from 'node:fs/promises';
import path from 'node:path';

import { loadApprovalBaseline } from './baseline.mjs';
import { freezeConversation } from './conversation.mjs';
import { HeirloomError } from './errors.mjs';
import { loadProjectConfig } from './config.mjs';
import { appendEvent, countAttempts, deriveState, readEvents } from './events.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { matchesAny } from './glob.mjs';
import { filesChangedBetween, repoInfo, resolveBase, tryGit } from './git.mjs';
import { reviewMatchesSource } from './handoff.mjs';
import { resolveIds } from './ids.mjs';
import { approvalFiles, taskPaths } from './paths.mjs';
import { isMarkdownCodePath } from './schema.mjs';
import { findProjectRules } from './project-rules.mjs';
import { diffStates } from './recheck.mjs';
import { readRecords } from './records.mjs';
import { computeCommitState, computeSourceState, hashMaterial } from './state.mjs';
import { replaceTaskId, taskIdFor } from './store.mjs';
import { withTaskLock } from './task-lock.mjs';

export const MATERIAL_ROLES = /** @type {const} */ (['spec', 'design', 'plan', 'review', 'verification', 'other']);

/**
 * @typedef {object} PrepareOptions
 * @property {string} cwd
 * @property {string} home
 * @property {string | null} [base]
 * @property {string[]} [specs]
 * @property {string[]} [reviews]
 * @property {{ role: string, ref: string }[]} [materials] other materials (design, plan, ...)
 * @property {string | null} [sdlcRef]
 * @property {string | null} [reviewedCommit] commit the final review covered
 * @property {boolean} [manual]
 */

/**
 * @param {string} root
 * @param {string} ref
 */
function normalizeRef(root, ref) {
  const abs = path.resolve(root, ref);
  const rel = path.relative(root, abs);
  return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/');
}

/** @param {any[]} materials */
const materialKey = (materials) => JSON.stringify(materials.map((m) => [m.role, m.ref, m.sha256, m.reviewedSourceHash ?? null]));

/**
 * @param {PrepareOptions} options
 */
export async function prepareHandoff(options) {
  const { cwd, home, specs = [], reviews = [], sdlcRef = null, reviewedCommit = null, manual = false } = options;
  if (!manual && specs.length === 0) {
    throw new HeirloomError('E_INPUT', '자동 인계는 spec 기반 작업에만 쓴다. --spec을 지정하거나, 사용자가 요청한 수동 인계면 --manual을 쓴다.');
  }
  for (const m of options.materials ?? []) {
    if (!(/** @type {readonly string[]} */ (MATERIAL_ROLES)).includes(m.role)) {
      throw new HeirloomError('E_INPUT', `알 수 없는 자료 역할: ${m.role} (${MATERIAL_ROLES.join(', ')})`);
    }
  }

  const info = await repoInfo(cwd);
  const root = info.root;
  const config = await loadProjectConfig(root);
  const base = await resolveBase({ cwd: root, base: options.base, configBase: config.baseBranch });
  const ids = await resolveIds(home, info);
  const source = await computeSourceState({ root, mergeBase: base.mergeBase });

  /** @type {string[]} */
  const unknowns = [];
  if (!sdlcRef) unknowns.push('sdlcTaskRef');
  if (!specs.length) unknowns.push('spec');
  if (!reviews.length) unknowns.push('review');
  if (!info.branch) unknowns.push('branch');

  let reviewedSourceHash = null;
  if (reviewedCommit) {
    reviewedSourceHash = (await computeCommitState({ root, mergeBase: base.mergeBase, commit: reviewedCommit })).hash;
  } else if (reviews.length) {
    unknowns.push('reviewedSourceHash');
  }

  const requested = [
    ...specs.map((ref) => ({ role: 'spec', ref })),
    ...reviews.map((ref) => ({ role: 'review', ref })),
    ...(options.materials ?? []),
  ];
  /** @type {any[]} */
  const materials = [];
  for (const { role, ref } of requested) {
    const normalized = normalizeRef(root, ref);
    let sha256 = null;
    try {
      sha256 = await hashMaterial(root, normalized);
    } catch (err) {
      if (/** @type {any} */ (err).code !== 'E_INPUT') throw err;
      unknowns.push(`material:${normalized}`);
    }
    materials.push(role === 'review' && reviewedSourceHash ? { role, ref: normalized, sha256, reviewedSourceHash } : { role, ref: normalized, sha256 });
  }

  const key = { worktreeId: ids.worktreeId, branch: info.branch, specRef: materials.find((m) => m.role === 'spec')?.ref ?? null };
  let taskId = /** @type {string} */ (await taskIdFor(home, key));
  const firstState = deriveState(await readEvents(taskPaths(home, taskId).events));
  if (firstState === 'discarded' || firstState === 'expired') taskId = await replaceTaskId(home, key);
  const paths = taskPaths(home, taskId);

  const remote = await tryGit(['remote', 'get-url', 'origin'], { cwd: root });
  const projectRules = await findProjectRules(root);

  return withTaskLock(home, taskId, async () => {
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    const existing = /** @type {any} */ (await readJson(paths.input));
    const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
    // A stale task is prepared again even when the content went back to the approved state:
    // the new round is what takes it out of `stale`. So is a task approved item by item before
    // the pivot: that approval is no longer applied, and the work is judged anew.
    const legacy = typeof approvalId === 'string' && (state === 'approved' || state === 'applied' || state === 'pr_created') && /** @type {any} */ (await readJson(approvalFiles(paths.approvals, approvalId).record))?.kind !== 'judgment';
    const sameState = state !== 'stale' && !legacy && existing && existing.source.hash === source.hash && materialKey(existing.materials) === materialKey(materials);

    let input = existing;
    let current = state;
    if (!sameState) {
      input = {
        schemaVersion: 1,
        taskId,
        repo: { id: ids.repoId, root, remote },
        worktree: { id: ids.worktreeId, path: root },
        branch: info.branch,
        base,
        sdlcTaskRef: sdlcRef,
        trigger: manual ? 'manual' : 'auto',
        source,
        materials,
        unknowns,
        projectRules,
        createdAt: new Date().toISOString(),
      };
      const recheck = typeof approvalId === 'string' ? await recheckFor({ home, root, taskId, approvalId, base, source, materials }) : undefined;
      if (recheck) input.recheck = recheck;
      // A new state invalidates the previous draft and its derived files (input.json is
      // immutable only within one source/material state).
      await Promise.all([paths.draft, paths.check, paths.handoff, paths.answers].map((f) => rm(f, { force: true })));
      await writeJsonAtomic(paths.input, input);
      current = await appendEvent(paths.events, {
        type: 'prepared',
        sourceHash: source.hash,
        attempt: countAttempts(events, source.hash) + 1,
        ...(input.recheck ? { recheckOf: input.recheck.basedOn } : {}),
      });
    }

    // The conversation is not part of the task's state: it grows every turn, and a new
    // message must not make the same code a new handoff. It is frozen next to the input.
    const conversation = await freezeConversation({ home, root, file: paths.conversation });

    const { decisions } = await readRecords(root);
    const changed = input.source.files.map((/** @type {any} */ f) => f.path);
    const relatedRecords = decisions
      .filter((d) => changed.some((/** @type {string} */ f) => matchesAny(f, d.meta.scope)))
      .map((d) => ({ id: d.meta.id, choice: d.meta.choice, scope: d.meta.scope }));

    return {
      taskId,
      state: current,
      alreadyPrepared: Boolean(sameState),
      taskDir: paths.dir,
      inputPath: paths.input,
      draftPath: paths.draft,
      branch: input.branch,
      base: input.base,
      source: { hash: input.source.hash, files: input.source.files.map((/** @type {any} */ f) => ({ path: f.path, status: f.status })) },
      materials: input.materials,
      unknowns: input.unknowns,
      reviewMatchesSource: reviewMatchesSource(input),
      relatedRecords,
      projectRules: input.projectRules,
      recheck: input.recheck ?? null,
      previousJudgment: await previousJudgment(paths, events),
      openPr: openPr(events),
      conversation: { ...conversation, path: paths.conversation },
    };
  });
}

/**
 * The PR of an earlier round that is still open, so a recheck updates it instead of opening
 * another, and marks its paragraph as rechecking (pivot 6.4).
 * @param {import('./events.mjs').TaskEvent[]} events
 */
function openPr(events) {
  const pr = events.filter((e) => e.type === 'pr_created' || e.type === 'expired').at(-1);
  return pr?.type === 'pr_created' && typeof pr.url === 'string' ? { url: pr.url, statusSha: typeof pr.statusSha === 'string' ? pr.statusSha : null } : null;
}

/**
 * The questions the person sent back in the task's last judgment, when that judgment
 * returned the work: the agent fixes them in this round (pivot 6.1). Null otherwise.
 * @param {ReturnType<typeof taskPaths>} paths
 * @param {import('./events.mjs').TaskEvent[]} events
 */
async function previousJudgment(paths, events) {
  const last = events.filter((e) => e.type === 'approved' || e.type === 'returned').at(-1);
  if (last?.type !== 'returned' || typeof last.approvalId !== 'string') return null;
  const record = /** @type {any} */ (await readJson(approvalFiles(paths.approvals, last.approvalId).record));
  const items = (record?.items ?? []).filter((/** @type {any} */ i) => i.verdict === 'revert' || i.verdict === 'split');
  return {
    approvalId: last.approvalId,
    returned: items.map((/** @type {any} */ i) => ({
      id: i.id,
      kind: i.kind,
      prompt: i.prompt,
      answer: i.answer,
      verdict: i.verdict,
      reason: i.reason,
      spec: i.spec ? { choice: i.spec.choice, parts: i.spec.parts.map((/** @type {any} */ p) => ({ ref: p.ref, ...(p.lines ? { lines: p.lines } : {}), ...(p.quote ? { quote: p.quote } : {}) })) } : null,
    })),
  };
}

/**
 * What changed since the last signed judgment of this task. An item approval from before the
 * pivot (schema 1) is not rechecked: the new round is a whole new handoff (undefined).
 * @param {{ home: string, root: string, taskId: string, approvalId: string, base: { mergeBase: string }, source: { files: any[] }, materials: any[] }} options
 */
async function recheckFor({ home, root, taskId, approvalId, base, source, materials }) {
  const record = /** @type {any} */ (await readJson(approvalFiles(taskPaths(home, taskId).approvals, approvalId).record));
  if (record && record.kind !== 'judgment') return undefined;
  const approved = await loadApprovalBaseline({ home, taskId, approvalId });
  return judgmentRecheck({ root, approved, base, source, materials });
}

/**
 * Recheck after a judgment (pivot 6.3): the probes run again on the new head, and questions
 * whose probe outputs stayed the same keep their verdict. Here only the changed files are
 * listed, and the code files no behavior description or open choice of the judged draft
 * points at (`unlinked`): the agent adds probes for them.
 * @param {{ root: string, approved: { approval: any, input: any, draft: any }, base: { mergeBase: string }, source: { files: any[] }, materials: any[] }} options
 */
async function judgmentRecheck({ root, approved, base, source, materials }) {
  const diff = diffStates({
    before: { files: approved.input.source.files, mergeBase: approved.input.base.mergeBase, materials: approved.approval.target.materials },
    after: { files: source.files, mergeBase: base.mergeBase, materials: Object.fromEntries(materials.map((m) => [m.ref, m.sha256])) },
    baseChanged: await filesChangedBetween({ cwd: root, from: approved.input.base.mergeBase, to: base.mergeBase }),
  });
  const draft = approved.draft;
  const linked = [...draft.behaviorDiffs.flatMap((/** @type {any} */ d) => d.codePaths), ...draft.questions.filter((/** @type {any} */ q) => q.kind === 'fork').flatMap((/** @type {any} */ q) => q.codePaths)];
  const code = diff.changes.map((c) => c.path).filter((p) => !isMarkdownCodePath(p));
  return {
    kind: 'probes',
    basedOn: approved.approval.id,
    mergeBaseChanged: diff.mergeBaseChanged,
    changes: diff.changes.map((c) => ({ path: c.path, reason: c.reason })),
    unlinked: code.filter((p) => !matchesAny(p, linked)),
  };
}
