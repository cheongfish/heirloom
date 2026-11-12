// Merge detection and the active/pending status of decision and axiom records
// (PLAN 14.3, MVP-PLAN 5.1 and 7.5).
//
// A record is active when its file on the target base branch says so: the base branch is
// read from the local remote-tracking ref without fetching, so the result is as fresh as
// the last fetch. A record that exists only in this worktree, or a change to a record that
// the base branch does not have yet, is pending. Pending records are served only to the
// task that approved them; for any other task they are only warned about by id and title.
// When the base branch cannot be resolved, the worktree's files are used and every status
// is 'unknown' (미확인).

import { stat } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { readTreeTexts, repoInfo, resolveBase, tryGit } from './git.mjs';
import { readIds } from './ids.mjs';
import { REPO_DIR, taskPaths } from './paths.mjs';
import { parseRecord, readRecords, serializeRecord } from './records.mjs';
import { recordMetaSchema, validate } from './schema.mjs';
import { readIndex } from './store.mjs';

/** @typedef {import('./records.mjs').RecordDoc} RecordDoc */
/** @typedef {import('./records.mjs').RecordMeta} RecordMeta */
/** @typedef {'active' | 'inactive' | 'pending' | 'unknown'} RecordStatus */
/** @typedef {'add' | 'update' | 'supersede' | 'deprecate'} ChangeKind */

/**
 * @typedef {object} ViewRecord
 * @property {string} id
 * @property {RecordDoc} doc content that applies to the current task
 * @property {RecordStatus} status
 * @property {string} file repository-relative path
 * @property {boolean} merged the content comes from the base branch
 */

/**
 * @typedef {object} PendingChange A change approved by another task and not merged yet.
 * @property {string} id the record it creates or changes
 * @property {ChangeKind} change
 * @property {string | null} taskId
 * @property {string} title one-line summary
 * @property {string | null} by superseding record id
 * @property {'worktree' | 'task'} seenIn this worktree's files, or the local task store
 * @property {Pick<RecordMeta, 'codePaths' | 'topics'> | null} scope of an added record, for relevance
 */

/**
 * @typedef {object} MergeCheck
 * @property {'checked' | 'unknown'} status
 * @property {string | null} ref base branch the files were compared with
 * @property {string | null} fetchedAt last fetch of this repository (FETCH_HEAD), if any
 * @property {string | null} reason why the status is unknown
 */

/** States whose approval may still reach the base branch. */
const WAITING = new Set(['approved', 'applied', 'pr_created']);

/**
 * Approval ids a record carries: its current approval, a deprecation and replaced revisions.
 * @param {RecordMeta} meta
 */
export function approvalIds(meta) {
  const ids = new Set([meta.approval.id]);
  if (meta.deprecation) ids.add(meta.deprecation.approval.id);
  for (const r of meta.revisions ?? []) ids.add(r.approval.id);
  return ids;
}

/**
 * The approved change a worktree copy carries on top of the base copy, or null when there
 * is none (same content, the base is newer, or a hand edit without an approval).
 * @param {RecordMeta} work
 * @param {RecordMeta | null} base
 * @param {(id: string) => RecordMeta | undefined} lookup worktree records, for supersede
 * @returns {{ change: ChangeKind, taskId: string | null, by: string | null } | null}
 */
export function pendingChange(work, base, lookup) {
  if (!base) return { change: 'add', taskId: work.taskId, by: null };
  const known = approvalIds(base);
  if (work.deprecation && !known.has(work.deprecation.approval.id)) return { change: 'deprecate', taskId: work.deprecation.taskId, by: null };
  const revision = [...(work.revisions ?? [])].reverse().find((r) => !known.has(r.replacedBy));
  if (revision) return { change: 'update', taskId: revision.taskId, by: null };
  if (work.supersededBy && work.supersededBy !== base.supersededBy) {
    return { change: 'supersede', taskId: lookup(work.supersededBy)?.taskId ?? null, by: work.supersededBy };
  }
  return null;
}

/**
 * Status of a record's content: inactive once superseded or deprecated.
 * @param {RecordMeta} meta
 * @param {RecordStatus} ifActive
 * @returns {RecordStatus}
 */
const statusOf = (meta, ifActive) => (meta.active ? ifActive : 'inactive');

/** @param {string} root @param {string} file */
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

/**
 * Records of the base branch, parsed and validated.
 * @param {string} root
 * @param {string} ref
 */
async function baseRecords(root, ref) {
  const texts = await readTreeTexts({ cwd: root, ref, dirs: [`${REPO_DIR}/decisions`, `${REPO_DIR}/axioms`] });
  /** @type {Map<string, RecordDoc & { file: string }>} */
  const out = new Map();
  /** @type {string[]} */
  const errors = [];
  for (const [file, text] of texts) {
    if (!file.endsWith('.md')) continue;
    try {
      const doc = parseRecord(text, `${ref}:${file}`);
      const problems = validate(recordMetaSchema, doc.meta);
      if (problems.length) errors.push(`${ref}:${file}: ${problems.join('; ')}`);
      else out.set(doc.meta.id, { ...doc, file });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { records: out, errors };
}

/** @param {string} commonDir */
async function lastFetch(commonDir) {
  try {
    return (await stat(path.join(commonDir, 'FETCH_HEAD'))).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Tasks of this worktree on the checked-out branch (the "same task" of PLAN 14.3), and the
 * other tasks of the same repository with their state.
 * @param {string} home
 * @param {import('./git.mjs').RepoInfo} info
 */
async function taskScope(home, info) {
  const ids = await readIds(info);
  /** @type {Set<string>} */
  const own = new Set();
  /** @type {Map<string, string | null>} taskId → state */
  const states = new Map();
  /** @type {string[]} */
  const others = [];
  if (!ids) return { own, others, states };
  const index = await readIndex(home);
  const prefix = `${ids.worktreeId}|${info.branch ?? ''}|`;
  for (const [key, taskId] of Object.entries(index.tasks)) {
    const worktreeId = key.split('|')[0];
    if (index.worktrees[worktreeId]?.repoId !== ids.repoId && worktreeId !== ids.worktreeId) continue;
    let state = null;
    try {
      state = deriveState(await readEvents(taskPaths(home, taskId).events));
    } catch {
      // unreadable log: treat as unknown state
    }
    states.set(taskId, state);
    if (key.startsWith(prefix)) own.add(taskId);
    else others.push(taskId);
  }
  return { own, others, states };
}

/**
 * Whether an approved record change is already on the base branch.
 * @param {any} op the draft record operation
 * @param {any[]} ops all draft record operations (for supersede's `with`)
 * @param {string} approvalId
 * @param {RecordMeta | undefined} merged the base branch copy of the record it touches
 */
function changeMerged(op, ops, approvalId, merged) {
  if (!merged) return false;
  if (op.op === 'add' || op.op === 'update') return approvalIds(merged).has(approvalId);
  if (op.op === 'deprecate') return merged.deprecation?.approval.id === approvalId;
  if (op.op === 'supersede') return merged.supersededBy === ops[op.with]?.id;
  return false;
}

/**
 * Whether an applied task has reached its target branch, so it needs nothing more even
 * without a PR (decision 2026-11-12: a task whose PR cannot be opened ends at merge).
 * Merged means every approved record change is on the base branch (squash merges too), or,
 * with no approved records, that the task branch has commits and the base contains them.
 * Reads the local remote-tracking ref without fetching. Returns null when it cannot tell.
 * @param {{ home: string, taskId: string }} options
 * @returns {Promise<boolean | null>}
 */
export async function appliedTaskMerged({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  try {
    const input = /** @type {any} */ (await readJson(paths.input));
    const events = await readEvents(paths.events);
    const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
    if (!input || typeof approvalId !== 'string') return null;
    const approval = /** @type {any} */ (await readJson(path.join(paths.approvals, `${approvalId}.json`)));
    const draft = /** @type {any} */ (await readJson(paths.draft));
    if (!approval || !Array.isArray(approval.items) || !Array.isArray(draft?.records)) return null;
    const root = input.repo.root;
    const ref = input.base.ref;
    const approved = approval.items.filter((/** @type {any} */ i) => i.decision === 'approved').map((/** @type {any} */ i) => draft.records[i.index]).filter(Boolean);
    if (approved.length) {
      const { records } = await baseRecords(root, ref);
      return approved.every((/** @type {any} */ op) => changeMerged(op, draft.records, approvalId, records.get(op.op === 'add' ? op.id : op.target)?.meta));
    }
    if (!input.branch) return null;
    const tip = await tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${input.branch}^{commit}`], { cwd: root });
    if (!tip || tip === input.base.mergeBase) return false;
    return (await tryGit(['merge-base', '--is-ancestor', tip, ref], { cwd: root })) !== null;
  } catch {
    return null;
  }
}

/**
 * Approved, not yet merged changes of another task, read from its draft and approval.
 * @param {string} home
 * @param {string} taskId
 * @param {Map<string, RecordDoc>} base null-safe: an empty map when merge state is unknown
 * @param {boolean} checked whether `base` is meaningful
 * @returns {Promise<PendingChange[]>}
 */
async function taskChanges(home, taskId, base, checked) {
  const paths = taskPaths(home, taskId);
  const events = await readEvents(paths.events);
  const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
  if (typeof approvalId !== 'string') return [];
  const approval = /** @type {any} */ (await readJson(path.join(paths.approvals, `${approvalId}.json`)));
  const draft = /** @type {any} */ (await readJson(paths.draft));
  if (!approval || !Array.isArray(approval.items) || !Array.isArray(draft?.records)) return [];
  /** @type {PendingChange[]} */
  const out = [];
  for (const item of approval.items) {
    if (item.decision !== 'approved') continue;
    const op = draft.records[item.index];
    if (!op) continue;
    const id = op.op === 'add' ? op.id : op.target;
    if (typeof id !== 'string') continue;
    if (checked && changeMerged(op, draft.records, approval.id, base.get(id)?.meta)) continue;
    const title = item.edited?.title ?? op.title ?? base.get(id)?.meta.title ?? id;
    out.push({
      id,
      change: op.op,
      taskId,
      title,
      by: op.op === 'supersede' ? (draft.records[op.with]?.id ?? null) : null,
      seenIn: 'task',
      scope: op.op === 'add' ? { codePaths: op.codePaths ?? [], topics: op.topics ?? [] } : null,
    });
  }
  return out;
}

/**
 * The records that apply to the current task, with merge status, and the pending changes
 * of other tasks.
 * @param {{ cwd: string, home: string, includeTaskStore?: boolean }} options
 * @returns {Promise<{ root: string, merge: MergeCheck, records: ViewRecord[], pending: PendingChange[], errors: string[] }>}
 */
export async function recordView({ cwd, home, includeTaskStore = true }) {
  const info = await repoInfo(cwd);
  const root = info.root;
  const config = await loadProjectConfig(root);
  const fetchedAt = await lastFetch(info.commonDir);

  const work = await readRecords(root);
  const errors = [...work.errors];
  /** @type {Map<string, RecordDoc & { file: string }>} */
  const workMap = new Map(work.records.map((r) => [r.meta.id, r]));

  /** @type {MergeCheck} */
  let merge;
  /** @type {Map<string, RecordDoc & { file: string }>} */
  let base = new Map();
  try {
    const resolved = await resolveBase({ cwd: root, configBase: config.baseBranch });
    const read = await baseRecords(root, resolved.ref);
    base = read.records;
    errors.push(...read.errors);
    merge = { status: 'checked', ref: resolved.ref, fetchedAt, reason: null };
  } catch (err) {
    merge = { status: 'unknown', ref: null, fetchedAt, reason: err instanceof Error ? err.message : String(err) };
  }

  const scope = await taskScope(home, info);
  /** @param {string | null} taskId */
  const abandoned = (taskId) => {
    const state = taskId ? scope.states.get(taskId) : undefined;
    return state === 'expired' || state === 'discarded';
  };

  /** @type {ViewRecord[]} */
  const records = [];
  /** @type {PendingChange[]} */
  const pending = [];

  if (merge.status === 'unknown') {
    for (const r of work.records) {
      records.push({ id: r.meta.id, doc: { meta: r.meta, body: r.body }, status: statusOf(r.meta, 'unknown'), file: rel(root, r.file), merged: false });
    }
  } else {
    const ids = new Set([...base.keys(), ...workMap.keys()]);
    for (const id of [...ids].sort()) {
      const b = base.get(id) ?? null;
      const w = workMap.get(id) ?? null;
      const change = w && (!b || serializeRecord(w) !== serializeRecord(b)) ? pendingChange(w.meta, b?.meta ?? null, (x) => workMap.get(x)?.meta) : null;
      if (w && change && change.taskId && scope.own.has(change.taskId) && !abandoned(change.taskId)) {
        records.push({ id, doc: { meta: w.meta, body: w.body }, status: statusOf(w.meta, 'pending'), file: rel(root, w.file), merged: false });
        continue;
      }
      if (w && change && !abandoned(change.taskId)) {
        pending.push({
          id,
          change: change.change,
          taskId: change.taskId,
          title: b?.meta.title ?? w.meta.title,
          by: change.by,
          seenIn: 'worktree',
          scope: change.change === 'add' ? { codePaths: w.meta.codePaths, topics: w.meta.topics } : null,
        });
      }
      if (b) records.push({ id, doc: { meta: b.meta, body: b.body }, status: statusOf(b.meta, 'active'), file: b.file, merged: true });
    }
  }

  if (includeTaskStore) {
    const seen = new Set(pending.map((p) => `${p.taskId}|${p.id}|${p.change}`));
    for (const taskId of scope.others) {
      if (!WAITING.has(String(scope.states.get(taskId)))) continue;
      try {
        for (const p of await taskChanges(home, taskId, base, merge.status === 'checked')) {
          const key = `${p.taskId}|${p.id}|${p.change}`;
          if (!seen.has(key)) {
            seen.add(key);
            pending.push(p);
          }
        }
      } catch (err) {
        errors.push(`작업 ${taskId}의 승인을 읽지 못함: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { root, merge, records, pending, errors };
}
