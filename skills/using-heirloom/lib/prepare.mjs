// Freeze the handoff input: scope, source state, materials and project rules.
// One run per source/material state: the same state returns the existing task.

import { rm } from 'node:fs/promises';
import path from 'node:path';

import { loadApprovalBaseline } from './baseline.mjs';
import { HeirloomError } from './errors.mjs';
import { loadProjectConfig } from './config.mjs';
import { appendEvent, countAttempts, deriveState, readEvents } from './events.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { matchesAny } from './glob.mjs';
import { filesChangedBetween, repoInfo, resolveBase, tryGit } from './git.mjs';
import { reviewMatchesSource } from './handoff.mjs';
import { resolveIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { findProjectRules } from './project-rules.mjs';
import { affectedItems, buildBaseline, diffStates } from './recheck.mjs';
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
    // A stale task is prepared again even when the content went back to the approved state:
    // the new round is what takes it out of `stale`.
    const sameState = state !== 'stale' && existing && existing.source.hash === source.hash && materialKey(existing.materials) === materialKey(materials);
    const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;

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
      if (approvalId !== undefined) input.recheck = await recheckFor({ home, root, taskId, approvalId, base, source, materials });
      // A new state invalidates the previous draft and its derived files (input.json is
      // immutable only within one source/material state).
      await Promise.all([paths.draft, paths.draftInitial, paths.check, paths.handoff].map((f) => rm(f, { force: true })));
      await writeJsonAtomic(paths.input, input);
      current = await appendEvent(paths.events, {
        type: 'prepared',
        sourceHash: source.hash,
        attempt: countAttempts(events, source.hash) + 1,
        ...(input.recheck ? { recheckOf: input.recheck.basedOn } : {}),
      });
    }

    const { records } = await readRecords(root);
    const changed = input.source.files.map((/** @type {any} */ f) => f.path);
    const relatedRecords = records
      .filter((r) => r.meta.active && changed.some((/** @type {string} */ f) => matchesAny(f, r.meta.codePaths)))
      .map((r) => ({ id: r.meta.id, kind: r.meta.kind, title: r.meta.title, codePaths: r.meta.codePaths }));

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
      recheck: input.recheck ? recheckReport(input.recheck) : null,
    };
  });
}

/**
 * What changed since the last signed approval of this task and which approved items it
 * touches.
 * @param {{ home: string, root: string, taskId: string, approvalId: unknown, base: { mergeBase: string }, source: { files: any[] }, materials: any[] }} options
 */
async function recheckFor({ home, root, taskId, approvalId, base, source, materials }) {
  const approved = await loadApprovalBaseline({ home, taskId, approvalId });
  const baseline = buildBaseline({ draft: approved.draft, approval: approved.approval });
  const diff = diffStates({
    before: { files: approved.input.source.files, mergeBase: approved.input.base.mergeBase, materials: approved.approval.target.materials },
    after: { files: source.files, mergeBase: base.mergeBase, materials: Object.fromEntries(materials.map((m) => [m.ref, m.sha256])) },
    baseChanged: await filesChangedBetween({ cwd: root, from: approved.input.base.mergeBase, to: base.mergeBase }),
  });
  return {
    basedOn: approved.approval.id,
    mergeBaseChanged: diff.mergeBaseChanged,
    changes: diff.changes,
    materials: diff.materials,
    affected: affectedItems({ baseline, changes: diff.changes, materials: diff.materials }),
    baseline: { summary: baseline.summary, records: baseline.records },
  };
}

/**
 * The recheck as the agent needs it from prepare's output. The baseline itself is long and
 * is read from input.json.
 * @param {any} recheck
 */
function recheckReport(recheck) {
  return {
    basedOn: recheck.basedOn,
    mergeBaseChanged: recheck.mergeBaseChanged,
    changes: recheck.changes.map((/** @type {any} */ c) => ({ path: c.path, reason: c.reason })),
    materials: recheck.materials.map((/** @type {any} */ m) => m.ref),
    affected: recheck.affected,
    baseline: { summary: recheck.baseline.summary.length, records: recheck.baseline.records.length, in: 'input.json의 recheck.baseline' },
  };
}
