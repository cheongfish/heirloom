// Narrow decision records (pivot 7): what a judgment keeps in the repository.
//
// A record comes in only two ways: a `fork` answer the person chose to keep in the repository,
// or a decision settled in a PR or issue discussion that the person confirmed. Each record
// names where the code holds the decision now (anchors), with at least one test that locks it.
// Records are never edited in place: a new record replaces an old one, and a record that no
// longer holds is removed. Records written before the pivot (schema 1, axioms) are only read.

import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { readTreeTexts } from './git.mjs';
import { writeRecord } from './records.mjs';
import { repoPaths } from './paths.mjs';

/** @param {string} s */
const quoteText = (s) => `"${s.replace(/\s+/g, ' ').trim()}"`;

/** Repository-relative file of a decision record. @param {string} id */
export const decisionFile = (id) => `.heirloom/decisions/${id}.md`;

/**
 * The record a kept fork answer or a confirmed discussion becomes.
 * @param {{ id: string, choice: string, question: string, proposal: { scope: string[], anchors: any[], replaces?: string }, source: any, taskId: string, approval: any, body: string }} o
 */
function decisionDoc({ id, choice, question, proposal, source, taskId, approval, body }) {
  return {
    meta: {
      schemaVersion: 2,
      id,
      kind: 'decision',
      choice,
      question,
      scope: proposal.scope,
      anchors: proposal.anchors,
      source: [source],
      replaces: proposal.replaces ?? null,
      taskId,
      approval: { id: approval.id, signer: approval.approver.fingerprint, approvedAt: approval.judgedAt },
    },
    body,
  };
}

/**
 * What an accepted judgment writes and removes: a record per fork answer kept in the
 * repository and per confirmed discussion; the records they replace and the records the person
 * retired are removed.
 * @param {{ judgment: any, draft: any }} options
 * @returns {{ writes: { meta: any, body: string }[], removes: string[] }}
 */
export function planDecisions({ judgment, draft }) {
  /** @type {{ meta: any, body: string }[]} */
  const writes = [];
  /** @type {Set<string>} */
  const removes = new Set();
  if (judgment.outcome !== 'accepted') return { writes, removes: [] };
  const questions = new Map((draft.questions ?? []).map((/** @type {any} */ q) => [q.id, q]));
  for (const item of judgment.items) {
    if (!item.keep) continue;
    const q = /** @type {any} */ (questions.get(item.id));
    if (item.keep.action === 'retire') {
      removes.add(item.keep.id);
      continue;
    }
    if (!q?.decision) continue;
    writes.push(
      decisionDoc({
        id: item.keep.id,
        choice: item.answer,
        question: q.prompt,
        proposal: q.decision,
        source: { kind: 'fork-answer', approval: judgment.id, question: item.id },
        taskId: judgment.taskId,
        approval: judgment,
        body: `\n## 질문\n\n${q.prompt.trim()}\n\n## 사람의 답 (원문)\n\n${quoteText(item.answer)}\n`,
      }),
    );
    if (q.decision.replaces) removes.add(q.decision.replaces);
  }
  const discussions = new Map((draft.discussions ?? []).map((/** @type {any} */ d) => [d.id, d]));
  for (const c of judgment.discussions ?? []) {
    const d = /** @type {any} */ (discussions.get(c.id));
    if (!c.confirmed || !d) continue;
    writes.push(
      decisionDoc({
        id: c.recordId,
        choice: d.choice,
        question: d.choice,
        proposal: d,
        source: { kind: 'discussion', approval: judgment.id, url: d.url, quote: d.quote, author: d.fetched?.author ?? null },
        taskId: judgment.taskId,
        approval: judgment,
        body: `\n## 토론에서 확정한 결정\n\n${d.choice.trim()}\n\n## 원문 (${d.url})\n\n> ${d.quote.trim().replace(/\n/g, '\n> ')}\n`,
      }),
    );
    if (d.replaces) removes.add(d.replaces);
  }
  return { writes, removes: [...removes] };
}

/**
 * Write the records of an accepted judgment. Files written for an earlier judgment of this task
 * are not merged yet, so they first go back to their merge-base version; the same judgment
 * always yields the same files.
 * @param {{ root: string, mergeBase: string, judgment: any, draft: any, prior: string[] }} options
 * @returns {Promise<{ written: string[], removed: string[] }>}
 */
export async function writeDecisions({ root, mergeBase, judgment, draft, prior }) {
  const { writes, removes } = planDecisions({ judgment, draft });
  const touched = [...new Set([...prior, ...removes.map(decisionFile)])];
  const baseTexts = touched.length ? await readTreeTexts({ cwd: root, ref: mergeBase, dirs: ['.heirloom'] }) : new Map();
  // Back to the merge-base for what an earlier round wrote or removed.
  for (const file of prior) {
    const text = baseTexts.get(file);
    if (text === undefined) await rm(path.join(root, file), { force: true });
    else await writeFile(path.join(root, file), text);
  }
  /** @type {string[]} */
  const written = [];
  for (const doc of writes) {
    await writeRecord(root, doc);
    written.push(decisionFile(doc.meta.id));
  }
  /** @type {string[]} */
  const removed = [];
  for (const id of removes) {
    await rm(path.join(repoPaths(root).decisions, `${id}.md`), { force: true });
    removed.push(decisionFile(id));
  }
  for (const file of prior) if (!written.includes(file) && !removed.includes(file)) removed.push(file);
  return { written: written.sort(), removed: [...new Set(removed)].sort() };
}
