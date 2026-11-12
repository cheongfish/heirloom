// Turn a verified approval into decision/axiom record changes (PLAN 14.2, MVP-PLAN 5.1).
// Pure: takes the draft, the approval and the existing records; returns the files to write.
// Running it again for the same approval yields the same files (crash recovery).

import { HeirloomError } from './errors.mjs';
import { SECTIONS, renderBody } from './records.mjs';

/** @typedef {import('./records.mjs').RecordDoc} RecordDoc */
/** @typedef {import('./records.mjs').RecordMeta} RecordMeta */

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replace the text of one `## heading` section, keeping every other section. A missing
 * section is appended at the end.
 * @param {string} body
 * @param {string} heading
 * @param {string} text
 */
export function replaceSection(body, heading, text) {
  const re = new RegExp(`(^|\\n)## ${escapeRe(heading)}\\n[\\s\\S]*?(?=\\n## |$)`);
  const section = `## ${heading}\n\n${text.trim()}\n`;
  if (re.test(body)) return body.replace(re, (_m, lead) => `${lead}${section}`);
  return `${body}${body.endsWith('\n') ? '' : '\n'}\n${section}`;
}

/**
 * @param {{ id: string, approver: { fingerprint: string }, approvedAt: string }} approval
 * @returns {import('./records.mjs').RecordApproval}
 */
const stamp = (approval) => ({ id: approval.id, signer: approval.approver.fingerprint, approvedAt: approval.approvedAt });

/** @param {RecordDoc} doc @returns {RecordDoc} */
const clone = (doc) => ({ meta: structuredClone(doc.meta), body: doc.body });

/**
 * @param {{ draft: { records: any[] }, approval: any, existing: Map<string, RecordDoc> }} options
 * @returns {{ writes: RecordDoc[] }}
 */
export function planRecordChanges({ draft, approval, existing }) {
  const ops = draft.records;
  /** @type {Map<number, any>} */
  const items = new Map(approval.items.map((/** @type {any} */ i) => [i.index, i]));
  const approved = (/** @type {number} */ i) => items.get(i)?.decision === 'approved';
  const signed = stamp(approval);

  /** @type {Map<string, RecordDoc>} */
  const out = new Map();

  /**
   * The current record a supersede/deprecate/update points at.
   * @param {string} id
   * @param {(meta: RecordMeta) => boolean} doneByThis already changed by this approval (rerun)
   */
  const target = (id, doneByThis) => {
    const found = out.get(id) ?? existing.get(id);
    if (!found) throw new HeirloomError('E_CONFLICT', `대상 기록 ${id}가 이 작업 트리에 없음`, { hint: '기록 파일이 옮겨졌거나 지워졌다. 다시 인계해야 한다.' });
    if (!found.meta.active && !doneByThis(found.meta)) {
      throw new HeirloomError('E_CONFLICT', `대상 기록 ${id}가 이미 비활성임`, { hint: '다른 작업이 먼저 대체·폐기했다. 다시 인계해야 한다.' });
    }
    return clone(found);
  };

  // 1. New records.
  ops.forEach((op, index) => {
    if (op.op !== 'add' || !approved(index)) return;
    const edited = items.get(index)?.edited ?? {};
    /** @type {RecordMeta} */
    const meta = {
      schemaVersion: 1,
      id: op.id,
      kind: op.kind,
      title: edited.title ?? op.title,
      active: true,
      codePaths: [...op.codePaths],
      topics: [...op.topics],
      supersedes: [],
      supersededBy: null,
      relations: structuredClone(op.relations ?? []),
      sources: structuredClone(op.sources),
      taskId: approval.taskId,
      approval: signed,
    };
    out.set(op.id, { meta, body: renderBody(op.kind, edited.body ?? op.body) });
  });

  // 2. Changes to existing records.
  ops.forEach((op, index) => {
    if (op.op === 'add' || !approved(index)) return;
    if (op.op === 'supersede') {
      const replacement = ops[op.with];
      const doc = target(op.target, (m) => m.supersededBy === replacement.id);
      doc.meta.active = false;
      doc.meta.supersededBy = replacement.id;
      out.set(op.target, doc);
      const created = out.get(replacement.id);
      if (created && !created.meta.supersedes.some((s) => s.id === op.target)) created.meta.supersedes.push({ id: op.target, reason: op.reason });
    } else if (op.op === 'deprecate') {
      const doc = target(op.target, (m) => m.deprecation?.approval.id === approval.id);
      doc.meta.active = false;
      doc.meta.deprecation = { reason: op.reason, taskId: approval.taskId, approval: signed };
      out.set(op.target, doc);
    } else if (op.op === 'update') {
      const current = out.get(op.target) ?? existing.get(op.target);
      if (current?.meta.approval.id === approval.id) return; // already applied
      const doc = target(op.target, () => false);
      const { meta } = doc;
      if (op.title !== undefined) meta.title = op.title;
      if (op.codePaths !== undefined) meta.codePaths = [...op.codePaths];
      if (op.topics !== undefined) meta.topics = [...op.topics];
      if (op.body !== undefined) {
        for (const [key, heading] of SECTIONS[meta.kind]) {
          if (typeof op.body[key] === 'string') doc.body = replaceSection(doc.body, heading, op.body[key]);
        }
      }
      meta.revisions = [...(meta.revisions ?? []), { approval: meta.approval, replacedBy: approval.id, taskId: approval.taskId, reason: op.reason }];
      meta.approval = signed;
      out.set(op.target, doc);
    }
  });

  return { writes: [...out.values()] };
}
