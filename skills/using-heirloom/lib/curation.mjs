// Context curation: which decisions are still unreviewed, when to suggest a curation run,
// which records one run looks at, the extra checks for axiom candidates and the review
// history written to the consumer repository.
//
// Everything is computed from the target branch tree (the local remote-tracking ref, never
// fetched here): a review counts once its history file is merged.

import { readdir } from 'node:fs/promises';

import { REPO_DIR, homePaths } from './paths.mjs';
import { CURATION_DEFAULTS, loadProjectConfig } from './config.mjs';
import { curationBase, readCurationMeta, removeCurationWorktree } from './curation-worktree.mjs';
import { deriveState, readEvents } from './events.mjs';
import { readTreeTexts, tryGit } from './git.mjs';
import { globToRegExp } from './glob.mjs';
import { derivedBase32 } from './ids.mjs';
import { parseRecord } from './records.mjs';
import { PATTERNS, curationReviewSchema, recordMetaSchema, validate } from './schema.mjs';
import { curationAgent } from './session-host.mjs';
import { taskPaths } from './paths.mjs';

export { CURATION_DEFAULTS };

/** @typedef {import('./records.mjs').RecordMeta} RecordMeta */
/** @typedef {import('./config.mjs').CurationConfig} CurationConfig */

/**
 * @typedef {object} CurationReview
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} taskId
 * @property {string} approvalId
 * @property {string} reviewedAt
 * @property {string[]} batch
 * @property {{ title: string, evidence: string[], decision: 'accepted' | 'held' | 'rejected', axiomId?: string, reason?: string }[]} candidates
 * @property {{ op: string, target: string, decision: 'approved' | 'rejected' | 'pending', reason?: string }[]} changes
 */

const DAY = 24 * 3600_000;
const CURATION_DIR = `${REPO_DIR}/curation`;

/** @param {string} a @param {string} b */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * File name of the review history of an approval. Derived from the approval id (itself
 * random), so parallel curations never collide and applying the same approval again
 * rewrites the same file.
 * @param {string} approvalId
 */
export const curationReviewId = (approvalId) => `c-${derivedBase32(`curation:${approvalId}`, 8)}`;

/** @param {string} id */
export const curationReviewPath = (id) => `${CURATION_DIR}/${id}.json`;

/**
 * Review history files among repository texts. Invalid files are reported, not used.
 * @param {Map<string, string>} texts repository-relative path → text
 * @returns {{ history: CurationReview[], errors: string[] }}
 */
export function parseCurationFiles(texts) {
  /** @type {CurationReview[]} */
  const history = [];
  /** @type {string[]} */
  const errors = [];
  for (const [file, text] of texts) {
    if (!file.startsWith(`${CURATION_DIR}/`) || !file.endsWith('.json')) continue;
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      errors.push(`${file}: JSON이 올바르지 않음`);
      continue;
    }
    const problems = validate(curationReviewSchema, value);
    if (problems.length) errors.push(`${file}: ${problems.join('; ')}`);
    else history.push(/** @type {CurationReview} */ (value));
  }
  history.sort((a, b) => byString(a.reviewedAt, b.reviewedAt));
  return { history, errors };
}

/**
 * Records and review history of a tree (the target branch).
 * @param {{ root: string, ref: string }} options
 * @returns {Promise<{ records: RecordMeta[], history: CurationReview[], errors: string[] }>}
 */
export async function readCurationTree({ root, ref }) {
  const texts = await readTreeTexts({ cwd: root, ref, dirs: [`${REPO_DIR}/decisions`, `${REPO_DIR}/axioms`, CURATION_DIR] });
  /** @type {RecordMeta[]} */
  const records = [];
  /** @type {string[]} */
  const errors = [];
  for (const [file, text] of texts) {
    if (file.startsWith(`${CURATION_DIR}/`) || !file.endsWith('.md')) continue;
    try {
      const { meta } = parseRecord(text, `${ref}:${file}`);
      const problems = validate(recordMetaSchema, meta);
      if (problems.length) errors.push(`${ref}:${file}: ${problems.join('; ')}`);
      else records.push(meta);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const parsed = parseCurationFiles(texts);
  return { records, history: parsed.history, errors: [...errors, ...parsed.errors] };
}

/**
 * Active decisions that no merged review batch contains, oldest approval first.
 * @param {{ records: RecordMeta[], history: CurationReview[] }} options
 */
export function unreviewedDecisions({ records, history }) {
  const reviewed = new Set(history.flatMap((h) => h.batch));
  return records
    .filter((r) => r.kind === 'decision' && r.active && !reviewed.has(r.id))
    .sort((a, b) => byString(a.approval.approvedAt, b.approval.approvedAt) || byString(a.id, b.id));
}

/**
 * Whether to suggest a curation run: many unreviewed decisions, or a few that have waited
 * long since the last review (or, with no review yet, since the oldest of them was approved).
 * @param {{ unreviewed: RecordMeta[], history: CurationReview[], config: CurationConfig, now: number }} options
 */
export function curationNotice({ unreviewed, history, config, now }) {
  const lastReviewedAt = history.map((h) => h.reviewedAt).sort(byString).at(-1) ?? null;
  const since = lastReviewedAt ?? unreviewed.map((r) => r.approval.approvedAt).sort(byString)[0] ?? null;
  const count = unreviewed.length;
  const old = since !== null && now - Date.parse(since) >= config.maxAgeDays * DAY;
  return { notify: count >= config.minUnreviewed || (count >= config.minForAge && old), unreviewed: count, lastReviewedAt, since };
}

/**
 * Whether two code paths or globs can name the same file.
 * @param {string} a
 * @param {string} b
 */
function pathsMeet(a, b) {
  return a === b || globToRegExp(a).test(b) || globToRegExp(b).test(a);
}

/**
 * The records one curation run looks at: the oldest unreviewed decisions up to the batch
 * size, the active decisions linked to them by code path, topic or relation, and every
 * active axiom.
 * @param {{ records: RecordMeta[], history: CurationReview[], batchSize: number }} options
 * @returns {{ batch: string[], related: string[], axioms: string[] }}
 */
export function selectBatch({ records, history, batchSize }) {
  const batch = unreviewedDecisions({ records, history }).slice(0, batchSize);
  const inBatch = new Set(batch.map((r) => r.id));
  const topics = new Set(batch.flatMap((r) => r.topics));
  const paths = batch.flatMap((r) => r.codePaths);
  const related = records.filter((r) => {
    if (r.kind !== 'decision' || !r.active || inBatch.has(r.id)) return false;
    if (r.topics.some((t) => topics.has(t))) return true;
    if (r.codePaths.some((p) => paths.some((q) => pathsMeet(p, q)))) return true;
    if (r.relations.some((x) => inBatch.has(x.id))) return true;
    return batch.some((b) => b.relations.some((x) => x.id === r.id));
  });
  return {
    batch: batch.map((r) => r.id),
    related: related.map((r) => r.id).sort(byString),
    axioms: records.filter((r) => r.kind === 'axiom' && r.active).map((r) => r.id).sort(byString),
  };
}

/** @type {Record<string, string>} */
const HELD_LABEL = { held: '보류', rejected: '거절' };

/**
 * Checks of axiom candidates that need the frozen curation input: at least two evidence
 * decisions from the batch or its related records, and new evidence compared with every
 * candidate held or rejected before. `evidence` belongs to curation handoffs only.
 * @param {{ input: any, draft: any }} options
 * @returns {string[]} errors
 */
export function checkCurationDraft({ input, draft }) {
  /** @type {string[]} */
  const errors = [];
  const ops = Array.isArray(draft?.records) ? draft.records : [];
  const curation = input.trigger === 'curation' ? input.curation : null;
  const known = new Set([...(curation?.batch ?? []), ...(curation?.related ?? [])]);
  /** @type {{ evidence: string[], decision: string, title: string, review: string }[]} */
  const closed = (curation?.history ?? []).flatMap((/** @type {CurationReview} */ h) =>
    h.candidates.filter((c) => c.decision !== 'accepted').map((c) => ({ evidence: c.evidence, decision: c.decision, title: c.title, review: h.id })),
  );

  ops.forEach((/** @type {any} */ op, /** @type {number} */ i) => {
    const at = `$.records[${i}]`;
    if (op?.op !== 'add') return;
    if (!curation) {
      if (op.evidence !== undefined) errors.push(`${at}.evidence: 근거 목록은 정리 작업의 axiom 후보에만 쓴다`);
      return;
    }
    if (op.kind !== 'axiom') return;
    const evidence = Array.isArray(op.evidence) ? op.evidence : null;
    if (!evidence) return void errors.push(`${at}.evidence: axiom 후보에는 근거 decision ID 목록(evidence)이 필요함`);
    const unique = new Set(evidence);
    if (unique.size !== evidence.length) errors.push(`${at}.evidence: 같은 ID가 중복됨`);
    if (unique.size < 2) errors.push(`${at}.evidence: 근거 decision이 2개 이상이어야 함`);
    for (const id of unique) {
      if (!known.has(id)) errors.push(`${at}.evidence: 묶음·관련 기록에 없는 ID (${id})`);
    }
    for (const c of closed) {
      if ([...unique].every((id) => c.evidence.includes(id))) {
        errors.push(`${at}.evidence: 새 근거 없음. 이전에 ${HELD_LABEL[c.decision]}된 후보 "${c.title}"(${c.review})의 근거에 모두 포함됨`);
      }
    }
  });
  return errors;
}

/** @type {Record<string, 'accepted' | 'held' | 'rejected'>} */
const CANDIDATE = { approved: 'accepted', pending: 'held', rejected: 'rejected' };

/**
 * The review history file of an approved curation: the batch it covered, each axiom
 * candidate with the human's decision and reason, and the other proposed changes.
 * Decisions are copies; the signature is in the approval.
 * @param {{ input: any, draft: { records: any[] }, approval: { id: string, approvedAt: string, items: any[] } }} options
 * @returns {CurationReview}
 */
export function buildCurationReview({ input, draft, approval }) {
  /** @type {Map<number, any>} */
  const items = new Map(approval.items.map((i) => [i.index, i]));
  /** @type {CurationReview['candidates']} */
  const candidates = [];
  /** @type {CurationReview['changes']} */
  const changes = [];
  draft.records.forEach((op, index) => {
    const item = items.get(index);
    if (!item) return;
    const reason = typeof item.reason === 'string' && item.reason.trim() ? { reason: item.reason.trim() } : {};
    if (op.op === 'add' && op.kind === 'axiom' && Array.isArray(op.evidence)) {
      const decision = CANDIDATE[item.decision];
      candidates.push({
        title: item.edited?.title ?? op.title,
        evidence: [...op.evidence],
        decision,
        ...(decision === 'accepted' ? { axiomId: op.id } : {}),
        ...reason,
      });
    } else {
      changes.push({ op: op.op, target: op.op === 'add' ? op.id : op.target, decision: item.decision, ...reason });
    }
  });
  return {
    schemaVersion: 1,
    id: curationReviewId(approval.id),
    taskId: input.taskId,
    approvalId: approval.id,
    reviewedAt: approval.approvedAt,
    batch: [...input.curation.batch],
    candidates,
    changes,
  };
}

/**
 * Whether a draft record is an axiom candidate of a curation (its hold or rejection needs
 * a reason).
 * @param {any} input
 * @param {any} op
 */
export const isCandidate = (input, op) => input?.trigger === 'curation' && op?.op === 'add' && op.kind === 'axiom';

// ---------------------------------------------------------------- curation tasks

/**
 * @typedef {object} CurationTask
 * @property {string} taskId
 * @property {import('./curation-worktree.mjs').CurationMeta} meta
 * @property {import('./events.mjs').TaskState | null} state
 * @property {import('./events.mjs').TaskEvent[]} events
 */

/**
 * Every curation task in the local store.
 * @param {{ home: string }} options
 * @returns {Promise<CurationTask[]>}
 */
export async function listCurationTasks({ home }) {
  let ids = [];
  try {
    ids = (await readdir(homePaths(home).tasks)).filter((n) => PATTERNS.taskId.test(n)).sort();
  } catch {
    return [];
  }
  /** @type {CurationTask[]} */
  const out = [];
  for (const taskId of ids) {
    const meta = await readCurationMeta(home, taskId);
    if (!meta) continue;
    const events = await readEvents(taskPaths(home, taskId).events);
    out.push({ taskId, meta, state: deriveState(events), events });
  }
  return out;
}

/**
 * Whether the review history of the task's latest approval is on the target branch, which
 * is when the curation is merged (squash and rebase merges included). Null when unknown.
 * @param {CurationTask} task
 * @returns {Promise<boolean | null>}
 */
export async function curationMerged({ meta, events }) {
  const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
  if (typeof approvalId !== 'string') return false;
  const cwd = meta.removedAt ? meta.checkout : meta.worktree;
  const ref = await tryGit(['rev-parse', '--verify', '-q', `${meta.base}^{commit}`], { cwd });
  if (!ref) return null;
  return (await tryGit(['cat-file', '-e', `${ref}:${curationReviewPath(curationReviewId(approvalId))}`], { cwd })) !== null;
}

/**
 * A curation task needs nothing more once it was discarded, expired or merged.
 * @param {CurationTask} task
 */
export async function curationFinished(task) {
  if (task.state === 'discarded' || task.state === 'expired') return true;
  if (task.state === null) return Boolean(task.meta.removedAt);
  return (await curationMerged(task)) === true;
}

/**
 * Remove the worktrees of finished curations. Returns the task ids whose worktree was
 * removed in this call; worktrees with uncommitted changes are kept (the reason is noted in
 * the task).
 * @param {{ home: string }} options
 */
export async function cleanupCurationWorktrees({ home }) {
  /** @type {string[]} */
  const removed = [];
  for (const task of await listCurationTasks({ home })) {
    if (task.meta.removedAt || !(await curationFinished(task))) continue;
    const result = await removeCurationWorktree({ home, taskId: task.taskId });
    if (result.removed) removed.push(task.taskId);
  }
  return removed;
}

/**
 * Curation state of one repository for the dashboard and the session start: unreviewed
 * count, whether to suggest a run, and the curations in progress. A run in progress
 * replaces the suggestion.
 * @param {{ home: string, repoId: string, now?: number }} options
 */
export async function curationStatus({ home, repoId, now = Date.now() }) {
  /** @type {{ taskId: string, state: string | null, branch: string, worktree: string, createdAt: string }[]} */
  const inProgress = [];
  for (const task of await listCurationTasks({ home })) {
    if (task.meta.repoId !== repoId || (await curationFinished(task))) continue;
    inProgress.push({ taskId: task.taskId, state: task.state, branch: task.meta.branch, worktree: task.meta.worktree, createdAt: task.meta.createdAt });
  }
  // The host a new curation of this repository would run with.
  const { host, source } = await curationAgent({ home, repoId });
  const empty = { repoId, root: null, base: null, notify: false, unreviewed: 0, lastReviewedAt: null, since: null, inProgress, unreadable: 0, agent: { host, source } };
  let base;
  try {
    base = await curationBase({ home, repoId });
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    const config = await loadProjectConfig(base.checkout.root);
    const tree = await readCurationTree({ root: base.checkout.root, ref: base.ref });
    const notice = curationNotice({ unreviewed: unreviewedDecisions(tree), history: tree.history, config: config.curation, now });
    return { ...empty, root: base.checkout.root, base: base.ref, ...notice, notify: notice.notify && !inProgress.length, unreadable: tree.errors.length, error: null };
  } catch (err) {
    return { ...empty, root: base.checkout.root, base: base.ref, error: err instanceof Error ? err.message : String(err) };
  }
}
