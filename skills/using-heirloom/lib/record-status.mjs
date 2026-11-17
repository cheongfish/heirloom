// Merge detection and the active/pending status of decision records.
// The target branch is read from the local remote-tracking ref; nothing is fetched here.
//
// A decision record is active when its file is on the target base branch: the base branch is
// read from the local remote-tracking ref without fetching, so the result is as fresh as
// the last fetch. A record that exists only in this worktree, or a removal the base branch
// does not have yet, is pending. Pending records are served only to the task that judged
// them; for any other task they are only warned about by id and title. When the base branch
// cannot be resolved, the worktree's files are used and every status is 'unknown' (미확인).
//
// Records from before the pivot (schema 1 decisions and axioms) are only listed as past
// records: from the base branch when it can be read, else from the worktree.

import { stat } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { readTreeTexts, repoInfo, resolveBase, tryGit } from './git.mjs';
import { readIds } from './ids.mjs';
import { REPO_DIR, taskPaths } from './paths.mjs';
import { planDecisions } from './decisions.mjs';
import { parseRecord, readRecords } from './records.mjs';
import { decisionSchema, recordMetaSchema, validate } from './schema.mjs';
import { readIndex } from './store.mjs';

/** @typedef {import('./records.mjs').RecordDoc} RecordDoc */
/** @typedef {import('./records.mjs').RecordMeta} RecordMeta */
/** @typedef {'active' | 'inactive' | 'pending' | 'unknown'} RecordStatus */
/** @typedef {'add' | 'retire'} ChangeKind */

/**
 * @typedef {object} ViewRecord A record from before the pivot (schema 1), listed only.
 * @property {string} id
 * @property {RecordDoc} doc
 * @property {RecordStatus} status
 * @property {string} file repository-relative path
 * @property {boolean} merged the content comes from the base branch
 */

/**
 * @typedef {object} ViewDecision A decision record since the pivot (schema 2).
 * @property {string} id
 * @property {import('./records.mjs').DecisionDoc} doc
 * @property {'active' | 'pending' | 'unknown'} status
 * @property {string} file repository-relative path
 */

/**
 * @typedef {object} PendingChange A decision change another task's judgment makes, not merged yet.
 * @property {string} id the record it creates or changes
 * @property {ChangeKind} change
 * @property {string | null} taskId
 * @property {string} title one-line summary
 * @property {string | null} by replacing record id
 * @property {'worktree' | 'task'} seenIn this worktree's files, or the local task store
 * @property {{ codePaths: string[], topics: string[] } | null} scope of an added record, for relevance
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
  /** @type {Map<string, import('./records.mjs').DecisionDoc & { file: string }>} */
  const decisions = new Map();
  /** @type {string[]} */
  const errors = [];
  for (const [file, text] of texts) {
    if (!file.endsWith('.md')) continue;
    try {
      const doc = parseRecord(text, `${ref}:${file}`);
      const v2 = /** @type {any} */ (doc.meta)?.schemaVersion === 2 && file.startsWith(`${REPO_DIR}/decisions/`);
      const problems = validate(v2 ? decisionSchema : recordMetaSchema, doc.meta);
      if (problems.length) errors.push(`${ref}:${file}: ${problems.join('; ')}`);
      else if (v2) decisions.set(doc.meta.id, { meta: /** @type {any} */ (doc.meta), body: doc.body, file });
      else out.set(doc.meta.id, { ...doc, file });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { records: out, decisions, errors };
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
 * Tasks of this worktree on the checked-out branch (the task a pending record belongs to), and the
 * other tasks of the same repository with their state.
 * @param {string} home
 * @param {import('./git.mjs').RepoInfo} info
 */
async function taskScope(home, info) {
  const ids = await readIds(info, home);
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
 * Whether an applied task has reached its target branch, so it needs nothing more even
 * without a PR (a task whose PR cannot be opened ends when its branch is merged). A judgment
 * writes no record the base branch could be checked for: the task branch has commits and the
 * base contains them. Reads the local remote-tracking ref without fetching. Returns null when
 * it cannot tell.
 * @param {{ home: string, taskId: string }} options
 * @returns {Promise<boolean | null>}
 */
export async function appliedTaskMerged({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  try {
    const input = /** @type {any} */ (await readJson(paths.input));
    const events = await readEvents(paths.events);
    const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
    if (!input || typeof approvalId !== 'string' || !input.branch) return null;
    const root = input.repo.root;
    const tip = await tryGit(['rev-parse', '--verify', '--quiet', `refs/heads/${input.branch}^{commit}`], { cwd: root });
    if (!tip || tip === input.base.mergeBase) return false;
    return (await tryGit(['merge-base', '--is-ancestor', tip, input.base.ref], { cwd: root })) !== null;
  } catch {
    return null;
  }
}

/**
 * The changes of a task's latest accepted judgment, or none when its latest approval is not a
 * judgment (an approval from before the pivot changes nothing that is read now).
 * @param {string} home
 * @param {string} taskId
 * @param {Map<string, any>} decisions
 * @param {boolean} checked
 */
async function judgmentChangesOf(home, taskId, decisions, checked) {
  const paths = taskPaths(home, taskId);
  const approvalId = (await readEvents(paths.events)).filter((e) => e.type === 'approved').at(-1)?.approvalId;
  if (typeof approvalId !== 'string') return [];
  const approval = /** @type {any} */ (await readJson(path.join(paths.approvals, `${approvalId}.json`)));
  return approval?.kind === 'judgment' ? judgmentChanges(home, taskId, approval, decisions, checked) : [];
}

/**
 * Decision records an accepted judgment of another task adds or removes, while the base
 * branch does not have that change yet.
 * @param {string} home
 * @param {string} taskId
 * @param {any} judgment
 * @param {Map<string, any>} decisions schema 2 records of the base branch
 * @param {boolean} checked
 * @returns {Promise<PendingChange[]>}
 */
async function judgmentChanges(home, taskId, judgment, decisions, checked) {
  const draft = /** @type {any} */ (await readJson(path.join(taskPaths(home, taskId).approvals, `${judgment.id}.draft.json`)));
  const { writes, removes } = planDecisions({ judgment, draft: draft ?? { questions: [] } });
  /** @type {PendingChange[]} */
  const out = [];
  for (const w of writes) {
    if (checked && decisions.has(w.meta.id)) continue;
    out.push({ id: w.meta.id, change: 'add', taskId, title: w.meta.choice, by: null, seenIn: 'task', scope: { codePaths: w.meta.scope, topics: [] } });
  }
  for (const id of removes) {
    if (checked && !decisions.has(id)) continue;
    out.push({ id, change: 'retire', taskId, title: decisions.get(id)?.meta.choice ?? id, by: writes.find((w) => w.meta.replaces === id)?.meta.id ?? null, seenIn: 'task', scope: null });
  }
  return out;
}

/**
 * The records that apply to the current task, with merge status, and the pending changes
 * of other tasks.
 * @param {{ cwd: string, home: string, includeTaskStore?: boolean }} options
 * `records` are the records from before the pivot (past records); `decisions` the schema 2
 * decision records that apply.
 * @returns {Promise<{ root: string, merge: MergeCheck, records: ViewRecord[], decisions: ViewDecision[], pending: PendingChange[], errors: string[] }>}
 */
export async function recordView({ cwd, home, includeTaskStore = true }) {
  const info = await repoInfo(cwd);
  const root = info.root;
  const config = await loadProjectConfig(root);
  const fetchedAt = await lastFetch(info.commonDir);

  const work = await readRecords(root);
  const errors = [...work.errors];

  /** @type {MergeCheck} */
  let merge;
  /** @type {Map<string, RecordDoc & { file: string }>} */
  let base = new Map();
  /** @type {Map<string, import('./records.mjs').DecisionDoc & { file: string }>} */
  let baseDecisions = new Map();
  try {
    const resolved = await resolveBase({ cwd: root, configBase: config.baseBranch });
    const read = await baseRecords(root, resolved.ref);
    base = read.records;
    baseDecisions = read.decisions;
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
  const records =
    merge.status === 'unknown'
      ? work.records.map((r) => ({ id: r.meta.id, doc: { meta: r.meta, body: r.body }, status: statusOf(r.meta, 'unknown'), file: rel(root, r.file), merged: false }))
      : [...base.values()].sort((x, y) => (x.meta.id < y.meta.id ? -1 : 1)).map((b) => ({ id: b.meta.id, doc: { meta: b.meta, body: b.body }, status: statusOf(b.meta, 'active'), file: b.file, merged: true }));
  /** @type {PendingChange[]} */
  const pending = [];

  // Schema 2 decisions are never edited in place: a worktree copy the base lacks is an add;
  // a base record the worktree no longer has is being retired or replaced.
  /** @type {ViewDecision[]} */
  const decisions = [];
  /** @type {Set<string>} */
  const ownRemoved = new Set();
  for (const taskId of scope.own) {
    if (abandoned(taskId) || !WAITING.has(String(scope.states.get(taskId)))) continue;
    try {
      for (const p of await judgmentChangesOf(home, taskId, new Map(), false)) if (p.change === 'retire') ownRemoved.add(p.id);
    } catch {
      // unreadable judgment: the base record stays a rule
    }
  }
  if (merge.status === 'unknown') {
    for (const d of work.decisions) decisions.push({ id: d.meta.id, doc: { meta: d.meta, body: d.body }, status: 'unknown', file: rel(root, d.file) });
  } else {
    const workDecisions = new Map(work.decisions.map((d) => [d.meta.id, d]));
    for (const id of [...new Set([...baseDecisions.keys(), ...workDecisions.keys()])].sort()) {
      const b = baseDecisions.get(id);
      const w = workDecisions.get(id);
      if (b) {
        // Retired or replaced by this worktree's own judgment: no longer a rule for it.
        if (!w && ownRemoved.has(id)) continue;
        decisions.push({ id, doc: { meta: b.meta, body: b.body }, status: 'active', file: b.file });
      } else if (w) {
        if (scope.own.has(w.meta.taskId) && !abandoned(w.meta.taskId)) decisions.push({ id, doc: { meta: w.meta, body: w.body }, status: 'pending', file: rel(root, w.file) });
        else if (!abandoned(w.meta.taskId)) pending.push({ id, change: 'add', taskId: w.meta.taskId, title: w.meta.choice, by: null, seenIn: 'worktree', scope: { codePaths: w.meta.scope, topics: [] } });
      }
    }
  }

  if (includeTaskStore) {
    const seen = new Set(pending.map((p) => `${p.taskId}|${p.id}|${p.change}`));
    for (const taskId of scope.others) {
      if (!WAITING.has(String(scope.states.get(taskId)))) continue;
      try {
        for (const p of await judgmentChangesOf(home, taskId, baseDecisions, merge.status === 'checked')) {
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

  return { root, merge, records, decisions, pending, errors };
}
