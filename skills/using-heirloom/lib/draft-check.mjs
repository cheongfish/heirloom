// Mechanical checks of an agent-written draft against the frozen input. Content quality is
// the human's job; these checks only verify that what the draft cites exists and that
// related code paths point at real changed code.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { globToRegExp } from './glob.mjs';
import { ID_PATTERNS, newRecordId } from './ids.mjs';
import { checkCurationDraft } from './curation.mjs';
import { checkRecheckDraft } from './recheck.mjs';
import { draftSchema, isMarkdownCodePath, validate } from './schema.mjs';
import { createHash } from 'node:crypto';

/** @param {string} s */
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * @param {string} pattern code path or glob
 * @param {readonly string[]} files
 */
const matchesSome = (pattern, files) => {
  const re = globToRegExp(pattern);
  return files.some((f) => f === pattern || re.test(f));
};

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @typedef {object} CheckResult
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {any} draft enriched copy: record ids issued, source sha256 filled
 */

/**
 * @param {object} options
 * @param {string} options.root repository root
 * @param {any} options.input frozen input.json
 * @param {any} options.draft agent draft
 * @param {{ meta: { id: string, kind: string, active: boolean, supersededBy?: string | null, deprecation?: { taskId: string } } }[]} options.records existing records
 * @param {string[]} options.repoFiles tracked and untracked (non-ignored) repository files
 * @returns {Promise<CheckResult>}
 */
export async function checkDraft({ root, input, draft, records, repoFiles }) {
  const errors = validate(draftSchema, draft);
  /** @type {string[]} */
  const warnings = [];
  const enriched = isObject(draft) ? structuredClone(draft) : {};

  if (enriched.taskId !== input.taskId) errors.push(`$.taskId: 고정된 입력의 작업 ID(${input.taskId})와 다름`);
  if (enriched.inputSourceHash !== input.source.hash) {
    errors.push('$.inputSourceHash: 고정된 입력의 소스 상태와 다름. prepare를 다시 실행하고 그 결과로 초안을 쓴다');
  }
  if (!input.recheck && enriched.recheck !== undefined) errors.push('$.recheck: 증분 재확인이 아닌 인계에는 쓸 수 없음');
  if (input.recheck && errors.length === 0) errors.push(...checkRecheckDraft({ recheck: input.recheck, draft: enriched }));

  if (errors.length === 0) errors.push(...checkCurationDraft({ input, draft: enriched }));

  const changed = input.source.files.map((/** @type {{ path: string }} */ f) => f.path);
  // A curation changes no code: its summary describes the record changes for the PR body.
  const curation = input.trigger === 'curation';
  if (Array.isArray(enriched.summary)) {
    if (!curation && (enriched.summary.length < 2 || enriched.summary.length > 5)) {
      warnings.push(`$.summary: 요약 불릿은 2~5개를 권장함 (현재 ${enriched.summary.length}개)`);
    }
    enriched.summary.forEach((/** @type {any} */ bullet, /** @type {number} */ i) => {
      if (!isObject(bullet) || !Array.isArray(bullet.codePaths)) return;
      bullet.codePaths.forEach((/** @type {unknown} */ cp, /** @type {number} */ j) => {
        if (curation || typeof cp !== 'string' || isMarkdownCodePath(cp)) return; // reported by the schema
        if (!matchesSome(cp, changed)) errors.push(`$.summary[${i}].codePaths[${j}]: 변경 파일 목록에 없음 (${cp})`);
      });
    });
  }

  if (!Array.isArray(enriched.records)) return { errors, warnings, draft: enriched };

  const byId = new Map(records.map((r) => [r.meta.id, r.meta]));
  // Records this task already wrote in an earlier round keep their ids, and the records it
  // already superseded or deprecated may still be targeted.
  const own = new Set(
    (input.recheck?.baseline.records ?? []).filter((/** @type {any} */ r) => r.op === 'add').map((/** @type {any} */ r) => r.id),
  );
  const usedIds = new Set([...byId.keys()].filter((id) => !own.has(id)));
  /** @type {Map<string, string>} */
  const fileCache = new Map();

  /**
   * @param {any} source
   * @param {string} at
   * @param {boolean} requireQuote
   */
  const checkSource = async (source, at, requireQuote) => {
    if (!isObject(source) || typeof source.ref !== 'string') return;
    const abs = path.resolve(root, source.ref);
    let text = fileCache.get(abs);
    if (text === undefined) {
      try {
        text = await readFile(abs, 'utf8');
      } catch {
        errors.push(`${at}.ref: 출처 파일이 없음 (${source.ref})`);
        return;
      }
      fileCache.set(abs, text);
    }
    source.sha256 = createHash('sha256').update(text).digest('hex');
    if (typeof source.quote !== 'string' || !source.quote.trim()) {
      if (requireQuote) errors.push(`${at}.quote: add 항목의 출처에는 원문 인용(quote)이 필요함`);
      return;
    }
    let region = text.replace(/\r\n/g, '\n');
    let where = source.ref;
    if (Array.isArray(source.lines) && source.lines.length === 2) {
      const [from, to] = source.lines;
      region = region.split('\n').slice(from - 1, to).join('\n');
      where = `${source.ref} ${from}-${to}행`;
    }
    if (!normalize(region).includes(normalize(source.quote))) errors.push(`${at}.quote: 원문에서 찾을 수 없음 (${where})`);
  };

  /** @param {any} op @param {string} at */
  const checkTarget = (op, at) => {
    if (typeof op.target !== 'string') return;
    const target = byId.get(op.target);
    if (!target) errors.push(`${at}.target: 대상 기록이 없음 (${op.target})`);
    else if (!target.active && !(target.deprecation?.taskId === input.taskId || (target.supersededBy && own.has(target.supersededBy)))) {
      errors.push(`${at}.target: 이미 비활성인 기록임 (${op.target})`);
    }
  };

  for (let i = 0; i < enriched.records.length; i += 1) {
    const op = enriched.records[i];
    const at = `$.records[${i}]`;
    if (!isObject(op)) continue;
    const sources = Array.isArray(op.sources) ? op.sources : [];

    if (op.op === 'add') {
      for (let k = 0; k < sources.length; k += 1) await checkSource(sources[k], `${at}.sources[${k}]`, true);
      if (Array.isArray(op.codePaths)) {
        op.codePaths.forEach((/** @type {unknown} */ cp, /** @type {number} */ j) => {
          if (typeof cp === 'string' && !isMarkdownCodePath(cp) && !matchesSome(cp, repoFiles)) {
            warnings.push(`${at}.codePaths[${j}]: 저장소에 맞는 파일이 없음 (${cp})`);
          }
        });
      }
      const kind = op.kind === 'axiom' ? 'axiom' : 'decision';
      const pattern = kind === 'axiom' ? ID_PATTERNS.axiom : ID_PATTERNS.decision;
      if (typeof op.id !== 'string' || !pattern.test(op.id) || usedIds.has(op.id)) {
        let id;
        do id = newRecordId(kind);
        while (usedIds.has(id));
        op.id = id;
      }
      usedIds.add(op.id);
    } else if (op.op === 'update' || op.op === 'deprecate') {
      checkTarget(op, at);
      for (let k = 0; k < sources.length; k += 1) await checkSource(sources[k], `${at}.sources[${k}]`, false);
    } else if (op.op === 'relate') {
      checkTarget(op, at);
      const id = op.relation?.id;
      if (typeof id === 'string') {
        const other = byId.get(id);
        if (id === op.target) errors.push(`${at}.relation.id: 대상 기록 자신과는 관계를 맺을 수 없음`);
        else if (!other) errors.push(`${at}.relation.id: 관계 대상 기록이 없음 (${id})`);
        else if (!other.active) errors.push(`${at}.relation.id: 이미 비활성인 기록임 (${id})`);
      }
    } else if (op.op === 'supersede') {
      checkTarget(op, at);
      const replacement = Number.isInteger(op.with) ? enriched.records[op.with] : undefined;
      if (!isObject(replacement) || replacement.op !== 'add') errors.push(`${at}.with: 같은 초안의 add 항목 번호를 가리켜야 함`);
    }
  }
  return { errors, warnings, draft: enriched };
}
