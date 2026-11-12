// Incremental recheck after approval.
// Pure functions: what changed since the approved state, which approved items it touches,
// and whether a new draft kept every untouched item exactly as approved.

import { canonicalJson } from './canonical.mjs';
import { matchesAny } from './glob.mjs';

/** @typedef {{ path: string, status: string, sha256: string }} FileState */
/** @typedef {{ files: FileState[], mergeBase: string, materials: Record<string, string | null> }} StateSnapshot */
/** @typedef {{ path: string, before: string | null, after: string | null, reason: 'edited' | 'base_updated' | 'added' | 'removed' }} FileChange */
/** @typedef {{ ref: string, before: string | null, after: string | null }} MaterialChange */
/** @typedef {{ index: number, reasons: string[] }} AffectedItem */
/** @typedef {{ summary: { text: string, codePaths: string[] }[], records: any[], pending: number[] }} Baseline */

/** @param {string} a @param {string} b */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Files and materials that differ between the approved state and the current one.
 * `after` is the task's diff against the current merge-base, so changes that came in from
 * the target branch do not appear.
 *
 * After the merge-base moved, a changed file is a base update when the target branch itself
 * changed it between the two merge-bases (`baseChanged`); other changes are ordinary edits.
 * Without `baseChanged` (the old merge-base is no longer available) every changed file
 * counts as a base update, because an edit cannot be told apart from what came in.
 * @param {{ before: StateSnapshot, after: StateSnapshot, baseChanged?: Set<string> | null }} options
 * @returns {{ mergeBaseChanged: boolean, changes: FileChange[], materials: MaterialChange[] }}
 */
export function diffStates({ before, after, baseChanged = null }) {
  const mergeBaseChanged = before.mergeBase !== after.mergeBase;
  const was = new Map(before.files.map((f) => [f.path, f.sha256]));
  const now = new Map(after.files.map((f) => [f.path, f.sha256]));
  /** @type {FileChange[]} */
  const changes = [];
  for (const p of [...new Set([...was.keys(), ...now.keys()])].sort(byString)) {
    const b = was.get(p) ?? null;
    const a = now.get(p) ?? null;
    if (b === a) continue;
    const fromBase = mergeBaseChanged && (baseChanged === null || baseChanged.has(p));
    const reason = b === null ? 'added' : a === null ? 'removed' : fromBase ? 'base_updated' : 'edited';
    changes.push({ path: p, before: b, after: a, reason });
  }
  /** @type {MaterialChange[]} */
  const materials = [];
  for (const ref of [...new Set([...Object.keys(before.materials), ...Object.keys(after.materials)])].sort(byString)) {
    const b = before.materials[ref] ?? null;
    const a = after.materials[ref] ?? null;
    if (b !== a) materials.push({ ref, before: b, after: a });
  }
  return { mergeBaseChanged, changes, materials };
}

/** @param {any} op */
function stripRound(op) {
  const copy = structuredClone(op);
  delete copy.baseIndex;
  return copy;
}

/**
 * The approved result written out in draft form: the human's final summary with the code
 * paths of the bullets it came from, and the records with the dashboard edits applied.
 * Rejected records are dropped; pending ones are kept and listed in `pending`.
 * @param {{ draft: { summary: { text: string, codePaths: string[] }[], records: any[] }, approval: any }} options
 * @returns {Baseline}
 */
export function buildBaseline({ draft, approval }) {
  const final = /** @type {string[]} */ (approval.summary.final);
  /** @type {(number | null)[]} */
  const origins = Array.isArray(approval.summary.origins)
    ? approval.summary.origins
    : final.map((_, i) => (final.length === draft.summary.length ? i : null));
  const summary = final.map((text, i) => {
    const origin = origins[i];
    const from = origin === null || origin === undefined ? undefined : draft.summary[origin];
    return { text, codePaths: from ? [...from.codePaths] : [] };
  });

  /** @type {Map<number, any>} */
  const items = new Map(approval.items.map((/** @type {any} */ i) => [i.index, i]));
  const keep = draft.records.map((op, i) => {
    const decision = items.get(i)?.decision;
    if (decision !== 'approved' && decision !== 'pending') return false;
    if (op.op === 'supersede') {
      const by = items.get(op.with)?.decision;
      return by === 'approved' || by === 'pending';
    }
    return true;
  });
  /** @type {Map<number, number>} */
  const newIndex = new Map();
  draft.records.forEach((_, i) => {
    if (keep[i]) newIndex.set(i, newIndex.size);
  });

  /** @type {any[]} */
  const records = [];
  /** @type {number[]} */
  const pending = [];
  draft.records.forEach((op, i) => {
    if (!keep[i]) return;
    const copy = stripRound(op);
    const edited = items.get(i)?.edited;
    if (copy.op === 'add' && edited) {
      if (typeof edited.title === 'string') copy.title = edited.title;
      if (edited.body) copy.body = { ...copy.body, ...edited.body };
      if (edited.codePaths) copy.codePaths = [...edited.codePaths];
      if (edited.topics) copy.topics = [...edited.topics];
    }
    if (copy.op === 'supersede') copy.with = newIndex.get(copy.with);
    if (items.get(i)?.decision === 'pending') pending.push(records.length);
    records.push(copy);
  });
  return { summary, records, pending };
}

/**
 * Approved items touched by the changes: bullets and
 * records whose code paths match a changed file, records citing a changed material or
 * file, pending records, and supersedes whose replacement is touched. A change linked to
 * nothing puts the whole summary up for recheck.
 * @param {{ baseline: { summary: { codePaths: string[] }[], records: any[], pending?: number[] }, changes: { path: string, [k: string]: unknown }[], materials: { ref: string, [k: string]: unknown }[] }} options
 * @returns {{ summary: AffectedItem[], records: AffectedItem[], unlinked: string[] }}
 */
export function affectedItems({ baseline, changes, materials }) {
  const paths = changes.map((c) => c.path);
  const changedMaterials = new Set(materials.map((m) => m.ref));
  const linked = new Set();

  /** @param {string[]} codePaths */
  const pathHits = (codePaths) => {
    const hits = codePaths.length ? paths.filter((p) => matchesAny(p, codePaths)) : [];
    for (const p of hits) linked.add(p);
    return hits;
  };

  /** @type {Map<number, string[]>} */
  const summary = new Map();
  baseline.summary.forEach((b, i) => {
    const hits = pathHits(b.codePaths);
    if (hits.length) summary.set(i, hits);
  });

  /** @type {Map<number, string[]>} */
  const records = new Map();
  /** @param {number} i @param {string} reason */
  const mark = (i, reason) => {
    const list = records.get(i) ?? [];
    if (!list.includes(reason)) list.push(reason);
    records.set(i, list);
  };
  baseline.records.forEach((op, i) => {
    for (const p of pathHits(op.codePaths ?? [])) mark(i, p);
    for (const s of op.sources ?? []) {
      if (changedMaterials.has(s.ref)) mark(i, `material:${s.ref}`);
      if (paths.includes(s.ref)) {
        linked.add(s.ref);
        mark(i, s.ref);
      }
    }
    if (baseline.pending?.includes(i)) mark(i, 'pending');
  });
  baseline.records.forEach((op, i) => {
    if (op.op === 'supersede' && records.has(op.with)) mark(i, `with:${op.with}`);
  });
  for (const ref of changedMaterials) linked.add(ref);

  const unlinked = paths.filter((p) => !linked.has(p));
  if (unlinked.length) baseline.summary.forEach((_, i) => summary.set(i, [...(summary.get(i) ?? []), 'unlinked']));

  /** @param {Map<number, string[]>} m */
  const list = (m) => [...m].sort((a, b) => a[0] - b[0]).map(([index, reasons]) => ({ index, reasons }));
  return { summary: list(summary), records: list(records), unlinked };
}

/**
 * @param {any} recheck input.recheck
 * @param {any} draft
 * @param {'summary' | 'record'} kind
 */
function rechecked(recheck, draft, kind) {
  const affected = kind === 'summary' ? recheck.affected.summary : recheck.affected.records;
  const set = new Set(affected.map((/** @type {AffectedItem} */ a) => a.index));
  for (const e of draft.recheck?.extra ?? []) if (e.kind === kind) set.add(e.baseIndex);
  return set;
}

/**
 * Draft indexes of the items that keep their approval: copied from the baseline and
 * neither affected nor added for recheck by the agent.
 * @param {{ recheck: any, draft: any }} options
 * @returns {{ summary: number[], records: number[] }}
 */
export function carriedItems({ recheck, draft }) {
  /** @param {any[]} list @param {'summary' | 'record'} kind */
  const carried = (list, kind) => {
    const open = rechecked(recheck, draft, kind);
    /** @type {number[]} */
    const out = [];
    list.forEach((item, i) => {
      if (Number.isInteger(item.baseIndex) && !open.has(item.baseIndex)) out.push(i);
    });
    return out;
  };
  return { summary: carried(draft.summary, 'summary'), records: carried(draft.records, 'record') };
}

/**
 * Comparable form of a record op: no round marker, no source digests (the check refills
 * them), and a supersede's replacement named by its baseline position.
 * @param {any} op
 * @param {(i: number) => unknown} withKey
 */
function comparable(op, withKey) {
  const copy = stripRound(op);
  for (const s of copy.sources ?? []) delete s.sha256;
  if (copy.op === 'supersede') copy.with = withKey(copy.with);
  return canonicalJson(copy);
}

/**
 * Rules for an incremental draft: every untouched baseline item is
 * present once and unchanged; base indexes are valid; extras are in range.
 * @param {{ recheck: any, draft: any }} options
 * @returns {string[]} errors
 */
export function checkRecheckDraft({ recheck, draft }) {
  /** @type {string[]} */
  const errors = [];
  const base = recheck.baseline;

  /** @param {any[]} list @param {string} at @param {number} size */
  const positions = (list, at, size) => {
    /** @type {Map<number, number>} */
    const found = new Map();
    list.forEach((item, i) => {
      if (item.baseIndex === undefined) return;
      if (!Number.isInteger(item.baseIndex) || item.baseIndex < 0 || item.baseIndex >= size) {
        errors.push(`$.${at}[${i}].baseIndex ${item.baseIndex}: baseline 범위를 벗어남 (0~${size - 1})`);
      } else if (found.has(item.baseIndex)) {
        errors.push(`$.${at}[${i}].baseIndex ${item.baseIndex}: 중복됨 ($.${at}[${found.get(item.baseIndex)}]와 같음)`);
      } else {
        found.set(item.baseIndex, i);
      }
    });
    return found;
  };
  const summaryAt = positions(draft.summary, 'summary', base.summary.length);
  const recordAt = positions(draft.records, 'records', base.records.length);

  (draft.recheck?.extra ?? []).forEach((/** @type {any} */ e, /** @type {number} */ i) => {
    const size = e.kind === 'summary' ? base.summary.length : base.records.length;
    if (!Number.isInteger(e.baseIndex) || e.baseIndex < 0 || e.baseIndex >= size) {
      errors.push(`$.recheck.extra[${i}].baseIndex: baseline 범위를 벗어남`);
    }
  });

  const openSummary = rechecked(recheck, draft, 'summary');
  base.summary.forEach((/** @type {any} */ b, /** @type {number} */ k) => {
    if (openSummary.has(k)) return;
    const i = summaryAt.get(k);
    if (i === undefined) return void errors.push(`$.summary: 재확인 대상이 아닌 baseline 요약 ${k}이(가) 빠짐`);
    const d = draft.summary[i];
    if (d.text !== b.text || canonicalJson(d.codePaths) !== canonicalJson(b.codePaths)) {
      errors.push(`$.summary[${i}]: 재확인 대상이 아닌 baseline ${k}을(를) 바꿈. 승인된 내용을 그대로 둔다`);
    }
  });

  const openRecords = rechecked(recheck, draft, 'record');
  base.records.forEach((/** @type {any} */ b, /** @type {number} */ k) => {
    if (openRecords.has(k)) return;
    const i = recordAt.get(k);
    if (i === undefined) return void errors.push(`$.records: 재확인 대상이 아닌 baseline 기록 ${k}이(가) 빠짐`);
    const d = draft.records[i];
    const draftWith = (/** @type {number} */ w) => draft.records[w]?.baseIndex ?? `new:${w}`;
    if (comparable(d, draftWith) !== comparable(b, (w) => w)) {
      errors.push(`$.records[${i}]: 재확인 대상이 아닌 baseline ${k}을(를) 바꿈. 승인된 내용을 그대로 둔다`);
    }
  });
  return errors;
}
