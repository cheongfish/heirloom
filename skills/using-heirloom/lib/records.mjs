// decision/axiom record files: one Markdown file per record with a `---json` front matter.
// See docs/HEIRLOOM-MVP-PLAN.md section 5.1.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { writeFileAtomic } from './fsx.mjs';
import { repoPaths } from './paths.mjs';
import { recordMetaSchema, validate } from './schema.mjs';

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
 * @property {{ id: string, signer: string, approvedAt: string }} approval
 */

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

/** @type {Record<'decision' | 'axiom', [string, string][]>} */
const SECTIONS = {
  decision: [
    ['problem', '문제'],
    ['choice', '선택과 이유'],
    ['alternatives', '버린 대안'],
    ['scope', '적용 범위'],
  ],
  axiom: [
    ['property', '유지할 성질'],
    ['scope', '적용 범위와 조건'],
    ['exceptions', '예외'],
    ['checks', '점검 지침'],
  ],
};

/**
 * Render the Markdown body of a record from draft body fields (PLAN 14.1, 15.1).
 * @param {'decision' | 'axiom'} kind
 * @param {Record<string, string>} body
 */
export function renderBody(kind, body) {
  return `\n${SECTIONS[kind].map(([key, heading]) => `## ${heading}\n\n${(body[key] ?? '').trim()}\n`).join('\n')}`;
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
 * Read and validate all records under .heirloom/. Invalid files are reported, not thrown.
 * @param {string} root
 * @returns {Promise<{ records: (RecordDoc & { file: string })[], errors: string[] }>}
 */
export async function readRecords(root) {
  const paths = repoPaths(root);
  /** @type {(RecordDoc & { file: string })[]} */
  const records = [];
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
        const problems = validate(recordMetaSchema, parsed.meta);
        if (problems.length) {
          errors.push(`${rel}: ${problems.join('; ')}`);
          continue;
        }
        records.push({ ...parsed, file });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `${rel}: ${String(err)}`);
      }
    }
  }
  return { records, errors };
}
