// What happens to the spec of a judged task.
//
// When the person sends back a question that cites spec lines, they also say what the spec
// should become: wrong (the agent fixes or removes those lines), deferred (the agent marks them
// as on hold) or a snapshot (the spec stays; the PR says the cited part is not implemented).
// For the first two, the next handoff is refused while the cited lines are still there word for
// word.
//
// When every question is accepted, the person chooses the spec's lifetime: delete it, move it
// to the archive or keep it. `apply` carries that choice out in the repository.

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { verifiedApprovalRecord } from './baseline.mjs';
import { sha256Hex } from './canonical.mjs';
import { readJson } from './fsx.mjs';
import { git, tryGit } from './git.mjs';
import { approvalFiles, taskPaths } from './paths.mjs';
import { isMarkdownCodePath } from './schema.mjs';

/** What the spec becomes when a question citing it is sent back. */
export const SPEC_CHOICES = /** @type {const} */ (['spec-wrong', 'defer', 'snapshot']);
/** Choices that require the agent to change the cited lines before the next handoff. */
export const SPEC_EDITING = new Set(['spec-wrong', 'defer']);
/** The spec's lifetime once the work is accepted. */
export const AFTER_MERGE = /** @type {const} */ (['delete', 'archive', 'keep']);
/** Where archived specs go. The session rule reads it as past record. */
export const ARCHIVE_DIR = 'docs/specs/archive';

/** @param {any} input @returns {string[]} specs inside the repository the handoff was given */
export function specRefs(input) {
  return (input?.materials ?? [])
    .filter((/** @type {any} */ m) => m.role === 'spec' && m.sha256 && !path.isAbsolute(m.ref))
    .map((/** @type {any} */ m) => m.ref);
}

/**
 * The sources of a question that cite a spec of this handoff.
 * @param {any} q
 * @param {any} input
 */
export function specSourcesOf(q, input) {
  const refs = new Set(specRefs(input));
  return (q.sources ?? []).filter((/** @type {any} */ s) => refs.has(s.ref));
}

/**
 * The cited part of a spec as it is now: the cited lines, or the quote when no lines are
 * given; null when the source names the whole file.
 * @param {string} content
 * @param {any} source
 * @returns {string | null}
 */
function blockOf(content, source) {
  if (Array.isArray(source.lines) && source.lines.length === 2) {
    const [from, to] = source.lines;
    return content.split('\n').slice(from - 1, to).join('\n');
  }
  return typeof source.quote === 'string' && source.quote.trim() ? source.quote : null;
}

/**
 * What the judgment keeps of each cited spec part, so the next handoff can tell whether the
 * agent changed it.
 * @param {string} root
 * @param {any[]} sources
 */
export async function citedSpecParts(root, sources) {
  return Promise.all(
    sources.map(async (/** @type {any} */ s) => {
      const content = await readFile(path.join(root, s.ref), 'utf8');
      return {
        ref: s.ref,
        ...(s.lines ? { lines: s.lines } : {}),
        ...(s.quote ? { quote: s.quote } : {}),
        block: blockOf(content, s),
        fileSha256: sha256Hex(content),
      };
    }),
  );
}

/**
 * Whether a cited spec part is still in the file word for word. A part moved elsewhere in the
 * file still counts; a part edited inside the cited lines, or a removed file, does not.
 * @param {string} root
 * @param {{ ref: string, lines?: number[], block: string | null, fileSha256: string }} part
 */
async function stillThere(root, part) {
  let content;
  try {
    content = await readFile(path.join(root, part.ref), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return false;
    throw err;
  }
  if (part.block === null) return sha256Hex(content) === part.fileSha256;
  if (!part.lines) return content.includes(part.block);
  // Cited lines count as unchanged only as whole lines: text added to a cited line changes it.
  const want = part.block.split('\n');
  const have = content.split('\n');
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((line, k) => have[i + k] === line)) return true;
  }
  return false;
}

/**
 * The judgments of a task that sent work back, oldest first, read as stored. Used as a guard,
 * not to act on: a forged record could only refuse more handoffs.
 * @param {string} home
 * @param {string} taskId
 * @param {import('./events.mjs').TaskEvent[]} events
 */
async function returnedJudgments(home, taskId, events) {
  const ids = events.filter((e) => e.type === 'returned' && typeof e.approvalId === 'string').map((e) => /** @type {string} */ (e.approvalId));
  const paths = taskPaths(home, taskId);
  const records = await Promise.all([...new Set(ids)].map((id) => readJson(approvalFiles(paths.approvals, id).record)));
  return /** @type {any[]} */ (records.filter(Boolean));
}

/**
 * Errors for spec lines the person said were wrong or deferred, which the agent has not
 * changed yet. Empty when nothing is left.
 * @param {{ home: string, taskId: string, root: string, events: import('./events.mjs').TaskEvent[] }} options
 * @returns {Promise<string[]>}
 */
export async function unchangedSpecLines({ home, taskId, root, events }) {
  /** @type {string[]} */
  const errors = [];
  for (const judgment of await returnedJudgments(home, taskId, events)) {
    for (const item of judgment.items ?? []) {
      if (!SPEC_EDITING.has(item.spec?.choice)) continue;
      for (const part of item.spec.parts ?? []) {
        if (!(await stillThere(root, part))) continue;
        const where = part.lines ? `${part.ref}:${part.lines[0]}-${part.lines[1]}` : part.ref;
        const what = item.spec.choice === 'spec-wrong' ? "'spec이 틀렸다'" : "'미룬다'";
        const todo = item.spec.choice === 'spec-wrong' ? '인용한 줄을 고치거나 지우고 "거절: <이유>" 한 줄을 남긴다' : '인용한 줄 안에 "보류: <후속 이슈>"를 표시한다';
        errors.push(`spec ${where}: 판정 ${judgment.id}에서 ${item.id}을(를) 되돌리며 ${what}를 골랐는데 인용한 줄이 그대로임. ${todo}`);
      }
    }
  }
  return errors;
}

/**
 * What the person decided about spec parts in the judgments that sent this task back, for
 * the PR paragraph. Only signed judgments count.
 * @param {{ home: string, taskId: string, events: import('./events.mjs').TaskEvent[] }} options
 * @returns {Promise<{ judgmentId: string, id: string, prompt: string, verdict: string, reason: string, choice: string, parts: any[] }[]>}
 */
export async function specDecisions({ home, taskId, events }) {
  const ids = [...new Set(events.filter((e) => e.type === 'returned' && typeof e.approvalId === 'string').map((e) => /** @type {string} */ (e.approvalId)))];
  const out = [];
  for (const approvalId of ids) {
    const judgment = await verifiedApprovalRecord({ home, taskId, approvalId });
    for (const item of judgment.items) {
      if (!item.spec) continue;
      out.push({ judgmentId: judgment.id, id: item.id, prompt: item.prompt, verdict: item.verdict, reason: item.reason, choice: item.spec.choice, parts: item.spec.parts });
    }
  }
  return out;
}

/** @param {string} p */
async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Carry out the spec lifetime the person chose. Runs on every apply and does
 * nothing twice. A spec with changes not committed yet is left alone (`uncommitted`): deleting
 * it would lose the only copy, so the agent commits first and applies again. Only Markdown
 * specs are moved or removed, so the judged code stays the same.
 * @param {{ root: string, afterMerge: { action: string, specs: string[] } | undefined }} options
 * @returns {Promise<{ action: string, owner?: string, specs: { ref: string, status: string, to?: string }[], files: string[], removed: string[], pending: boolean } | null>}
 */
export async function applySpecLifecycle({ root, afterMerge }) {
  if (!afterMerge) return null;
  /** @type {{ ref: string, status: string, to?: string }[]} */
  const specs = [];
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const removed = [];
  for (const ref of afterMerge.specs) {
    const to = `${ARCHIVE_DIR}/${path.posix.basename(ref)}`;
    if (afterMerge.action === 'keep') {
      specs.push({ ref, status: 'kept' });
      continue;
    }
    if (!isMarkdownCodePath(ref)) {
      specs.push({ ref, status: 'not_markdown' });
      continue;
    }
    if (afterMerge.action === 'archive' && ref.startsWith(`${ARCHIVE_DIR}/`)) {
      specs.push({ ref, status: 'archived', to: ref });
      continue;
    }
    const abs = path.join(root, ref);
    if (!(await exists(abs))) {
      if (afterMerge.action === 'delete') {
        specs.push({ ref, status: 'deleted' });
        removed.push(ref);
      } else if (await exists(path.join(root, to))) {
        specs.push({ ref, status: 'archived', to });
        files.push(to);
        removed.push(ref);
      } else specs.push({ ref, status: 'missing' });
      continue;
    }
    const dirty = await tryGit(['status', '--porcelain', '--', ref], { cwd: root });
    if (dirty === null || dirty.trim()) {
      specs.push({ ref, status: 'uncommitted' });
      continue;
    }
    if (afterMerge.action === 'delete') {
      await git(['rm', '-q', '--', ref], { cwd: root });
      specs.push({ ref, status: 'deleted' });
      removed.push(ref);
    } else if (await exists(path.join(root, to))) {
      specs.push({ ref, status: 'archive_taken', to });
    } else {
      await mkdir(path.join(root, ARCHIVE_DIR), { recursive: true });
      await git(['mv', '--', ref, to], { cwd: root });
      specs.push({ ref, status: 'archived', to });
      files.push(to);
      removed.push(ref);
    }
  }
  return {
    action: afterMerge.action,
    ...(/** @type {any} */ (afterMerge).owner ? { owner: /** @type {any} */ (afterMerge).owner } : {}),
    specs,
    files,
    removed,
    pending: specs.some((s) => s.status === 'uncommitted' || s.status === 'archive_taken'),
  };
}
