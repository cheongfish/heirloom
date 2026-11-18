// decision/axiom record files: one Markdown file per record with a `---json` front matter.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { writeFileAtomic } from './fsx.mjs';
import { repoPaths } from './paths.mjs';
import { decisionSchema, recordMetaSchema, validate } from './schema.mjs';

export { isMarkdownCodePath } from './schema.mjs';

/**
 * @typedef {object} RecordMeta
 * @property {1} schemaVersion
 * @property {string} id
 * @property {'decision' | 'axiom'} kind
 * @property {string} title
 * @property {boolean} active
 * @property {string[]} codePaths
 * @property {string[]} topics
 * @property {{ id: string, reason: string }[]} supersedes
 * @property {string | null} supersededBy
 * @property {{ type: 'exception' | 'coexist', id: string, condition?: string }[]} relations
 * @property {{ ref: string, lines?: [number, number], sha256: string, quote?: string }[]} sources
 * @property {string} taskId
 * @property {RecordApproval} approval
 * @property {{ reason: string, taskId: string, approval: RecordApproval }} [deprecation] set when a deprecation was approved
 * @property {{ approval: RecordApproval, replacedBy: string, taskId: string, reason: string }[]} [revisions]
 *   approvals replaced by approved updates, oldest first
 */

/** @typedef {{ id: string, signer: string, approvedAt: string }} RecordApproval */

/** @typedef {{ meta: RecordMeta, body: string }} RecordDoc */

const OPEN = '---json\n';
const CLOSE = '\n---\n';

/**
 * @param {string} text
 * @param {string} [file] used in error messages
 * @returns {{ meta: RecordMeta, body: string }} meta is parsed but not schema-validated
 */
export function parseRecord(text, file = '기록 파일') {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith(OPEN)) throw new HeirloomError('E_INPUT', `${file}: 첫 줄이 ---json이 아님`);
  const end = normalized.indexOf(CLOSE, OPEN.length - 1);
  if (end === -1) throw new HeirloomError('E_INPUT', `${file}: 앞머리를 닫는 --- 줄이 없음`);
  let meta;
  try {
    meta = JSON.parse(normalized.slice(OPEN.length, end));
  } catch (err) {
    throw new HeirloomError('E_INPUT', `${file}: 앞머리 JSON이 올바르지 않음`, { cause: err });
  }
  return { meta, body: normalized.slice(end + CLOSE.length) };
}

/** @param {RecordDoc} record */
export function serializeRecord({ meta, body }) {
  return `${OPEN}${JSON.stringify(meta, null, 2)}${CLOSE}${body}`;
}

/**
 * @param {string} root repository root
 * @param {RecordMeta} meta
 */
export function recordPath(root, meta) {
  const paths = repoPaths(root);
  return path.join(meta.kind === 'axiom' ? paths.axioms : paths.decisions, `${meta.id}.md`);
}

/**
 * Write a record into the consumer repository with ordinary file permissions.
 * @param {string} root
 * @param {RecordDoc} record
 * @returns {Promise<string>} written file path
 */
export async function writeRecord(root, record) {
  const file = recordPath(root, record.meta);
  await writeFileAtomic(file, serializeRecord(record), { mode: 0o644, dirMode: 0o755 });
  return file;
}

/**
 * A decision record since 0.4.
 * @typedef {object} DecisionMeta
 * @property {2} schemaVersion
 * @property {string} id
 * @property {'decision'} kind
 * @property {string} choice
 * @property {string} question
 * @property {string[]} scope
 * @property {{ file: string, symbol?: string, test?: string }[]} anchors
 * @property {any[]} source
 * @property {string | null} replaces
 * @property {string} taskId
 * @property {RecordApproval} approval
 */

/** @typedef {{ meta: DecisionMeta, body: string }} DecisionDoc */

/**
 * Read and validate all records under .heirloom/. Invalid files are reported, not thrown.
 * `records` are the records written before 0.4 (schema 1: decisions and axioms), read
 * only as past records; `decisions` are the decision records since (schema 2).
 * @param {string} root
 * @returns {Promise<{ records: (RecordDoc & { file: string })[], decisions: (DecisionDoc & { file: string })[], errors: string[] }>}
 */
export async function readRecords(root) {
  const paths = repoPaths(root);
  /** @type {(RecordDoc & { file: string })[]} */
  const records = [];
  /** @type {(DecisionDoc & { file: string })[]} */
  const decisions = [];
  /** @type {string[]} */
  const errors = [];
  for (const dir of [paths.axioms, paths.decisions]) {
    let names;
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') continue;
      throw err;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const rel = path.relative(root, file).split(path.sep).join('/');
      try {
        const parsed = parseRecord(await readFile(file, 'utf8'), rel);
        const v2 = /** @type {any} */ (parsed.meta)?.schemaVersion === 2 && dir === paths.decisions;
        const problems = validate(v2 ? decisionSchema : recordMetaSchema, parsed.meta);
        if (problems.length) {
          errors.push(`${rel}: ${problems.join('; ')}`);
          continue;
        }
        if (v2) decisions.push({ meta: /** @type {any} */ (parsed.meta), body: parsed.body, file });
        else records.push({ ...parsed, file });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${rel}: ${String(err)}`);
      }
    }
  }
  return { records, decisions, errors };
}
