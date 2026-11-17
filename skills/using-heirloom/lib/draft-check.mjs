// Mechanical checks of an agent-written draft against the frozen input. Content quality is
// the human's job; these checks only verify that what the draft cites exists and that
// related code paths point at real changed code. A source is a repository file, or the
// messages the person typed in the session (`@conversation`), frozen by prepare.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { globToRegExp } from './glob.mjs';
import { ID_PATTERNS, newRecordId } from './ids.mjs';
import { CONVERSATION_REF, findQuote } from './conversation.mjs';
import { checkRecheckDraft } from './recheck.mjs';
import { checkDiscussion } from './discussion.mjs';
import { readRecords } from './records.mjs';
import { draftSchema, draftV2Schema, isMarkdownCodePath, validate } from './schema.mjs';
import { createHash } from 'node:crypto';

/** @param {string} s */
export const normalize = (s) => s.replace(/\s+/g, ' ').trim();

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
 * Check of a cited source: a repository file (the quote must be in the given lines) or the
 * conversation (the quote must be part of one message the person typed). Fills `sha256`.
 * @param {{ root: string, conversation: import('./conversation.mjs').Utterance[] | null, errors: string[] }} options
 * @returns {(source: any, at: string, requireQuote: boolean) => Promise<void>}
 */
function sourceChecker({ root, conversation, errors }) {
  /** @type {Map<string, string>} */
  const fileCache = new Map();

  /**
   * @param {any} source
   * @param {string} at
   * @param {boolean} requireQuote
   */
  const checkSource = async (source, at, requireQuote) => {
    if (!isObject(source) || typeof source.ref !== 'string') return;
    if (source.ref === CONVERSATION_REF) return checkConversationSource(source, at);
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
      if (requireQuote) errors.push(`${at}.quote: 이 출처에는 원문 인용(quote)이 필요함`);
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

  /**
   * A quote of the conversation must be part of one message the person typed. It always needs
   * the quote: the quoted message is what the record keeps as its source.
   * @param {any} source
   * @param {string} at
   */
  const checkConversationSource = (source, at) => {
    if (source.lines !== undefined) errors.push(`${at}.lines: 대화 출처에는 줄 범위를 쓰지 않음`);
    if (!conversation?.length) {
      errors.push(`${at}.ref: 이 인계에는 고정된 대화가 없음. prepare 결과의 conversation을 확인한다`);
      return;
    }
    if (typeof source.quote !== 'string' || !source.quote.trim()) {
      errors.push(`${at}.quote: 대화 출처에는 사용자 발화의 원문 인용(quote)이 필요함`);
      return;
    }
    const message = findQuote(conversation, source.quote);
    if (!message) {
      errors.push(`${at}.quote: 사용자 발화에서 찾을 수 없음. 에이전트의 답이나 요약이 아닌, 사람이 입력한 문장을 그대로 인용한다`);
      return;
    }
    source.sha256 = message.sha256;
  };

  return checkSource;
}

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
 * @param {import('./conversation.mjs').Utterance[] | null} [options.conversation] the messages
 *   the person typed, frozen for this task; null when the task has none
 * @param {any} [options.probes] the task's last probe run (`probes/result.json`), or null
 * @returns {Promise<CheckResult>}
 */
export async function checkDraft({ root, input, draft, records, repoFiles, conversation = null, probes = null }) {
  if (isObject(draft) && draft.schemaVersion === 2) return checkDraftV2({ root, input, draft, repoFiles, conversation, probes });
  // Drafts of schema 1 (summary and records) are still read until the dashboard and apply
  // take schema 2 (pivot steps 4 and 5).
  const errors = validate(draftSchema, draft);
  /** @type {string[]} */
  const warnings = [];
  const enriched = isObject(draft) ? structuredClone(draft) : {};

  if (enriched.taskId !== input.taskId) errors.push(`$.taskId: 고정된 입력의 작업 ID(${input.taskId})와 다름`);
  if (enriched.inputSourceHash !== input.source.hash) {
    errors.push('$.inputSourceHash: 고정된 입력의 소스 상태와 다름. prepare를 다시 실행하고 그 결과로 초안을 쓴다');
  }
  if (input.recheck?.kind === 'probes') return { errors: ['$.schemaVersion: 판정 이후의 재확인은 스키마 2 초안으로 쓴다'], warnings, draft: enriched };
  if (!input.recheck && enriched.recheck !== undefined) errors.push('$.recheck: 증분 재확인이 아닌 인계에는 쓸 수 없음');
  if (input.recheck && errors.length === 0) errors.push(...checkRecheckDraft({ recheck: input.recheck, draft: enriched }));

  const changed = input.source.files.map((/** @type {{ path: string }} */ f) => f.path);
  if (Array.isArray(enriched.summary)) {
    if ((enriched.summary.length < 2 || enriched.summary.length > 5)) {
      warnings.push(`$.summary: 요약 불릿은 2~5개를 권장함 (현재 ${enriched.summary.length}개)`);
    }
    enriched.summary.forEach((/** @type {any} */ bullet, /** @type {number} */ i) => {
      if (!isObject(bullet) || !Array.isArray(bullet.codePaths)) return;
      bullet.codePaths.forEach((/** @type {unknown} */ cp, /** @type {number} */ j) => {
        if (typeof cp !== 'string' || isMarkdownCodePath(cp)) return; // reported by the schema
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
  const checkSource = sourceChecker({ root, conversation, errors });

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

// ---------------------------------------------------------------- schema 2 (pivot 5.3)

/** Questions per handoff that one person can answer in one sitting (pivot 5.2). */
const QUESTIONS_MAX = 5;

/**
 * Numeric values in a text, so "1,200", "1200" and "1200.0" compare equal. Signs are ignored:
 * a hyphen is as often a range or a separator as a minus.
 * @param {string} text
 */
export function numbersIn(text) {
  return new Set([...text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))));
}

/** Strings in double quotes (straight or curly) or curly single quotes. */
export function quotedIn(/** @type {string} */ text) {
  return [...text.matchAll(/"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/**
 * What a probe shows: its command, title and the outputs on both sides.
 * @param {any} probe a probe of `probes/result.json`
 */
const probeText = (probe) => [probe.title, ...probe.run, probe.base.stdout, probe.base.stderr, probe.head.stdout, probe.head.stderr].join('\n');

/**
 * @param {{ root: string, input: any, draft: any, repoFiles: string[], conversation: import('./conversation.mjs').Utterance[] | null, probes: any }} options
 * @returns {Promise<CheckResult>}
 */
async function checkDraftV2({ root, input, draft, repoFiles, conversation, probes }) {
  const errors = validate(draftV2Schema, draft);
  /** @type {string[]} */
  const warnings = [];
  const enriched = structuredClone(draft);
  const checkSource = sourceChecker({ root, conversation, errors });

  if (enriched.taskId !== input.taskId) errors.push(`$.taskId: 고정된 입력의 작업 ID(${input.taskId})와 다름`);
  if (enriched.inputSourceHash !== input.source.hash) {
    errors.push('$.inputSourceHash: 고정된 입력의 소스 상태와 다름. prepare를 다시 실행하고 그 결과로 초안을 쓴다');
  }

  /** @type {Map<string, any>} */
  const probeById = new Map();
  let usable = false;
  if (!probes) {
    errors.push('$.probeSetHash: 탐침 실행 기록이 없음. probe.mjs로 탐침을 먼저 실행한다');
  } else if (probes.inputSourceHash !== input.source.hash) {
    errors.push('$.probeSetHash: 탐침 실행 기록이 지금 인계 입력의 소스 상태와 다름. prepare를 다시 실행했다면 probe.mjs도 다시 실행한다');
  } else {
    if (enriched.probeSetHash !== probes.probeSetHash) errors.push(`$.probeSetHash: 마지막 탐침 실행(${probes.probeSetHash})과 다름. probe.mjs 결과의 probeSetHash를 쓴다`);
    for (const p of probes.probes) probeById.set(p.id, p);
    usable = true;
  }
  /** @param {unknown} id @param {string} at */
  const probe = (id, at) => {
    if (typeof id !== 'string' || !usable) return null;
    const p = probeById.get(id);
    if (!p) errors.push(`${at}: 실행된 탐침이 아님 (${id})`);
    return p ?? null;
  };

  const changed = input.source.files.map((/** @type {{ path: string }} */ f) => f.path);
  const present = new Set(input.source.files.filter((/** @type {any} */ f) => f.status !== 'D').map((/** @type {any} */ f) => f.path));
  /** @type {Set<string>} */
  const explained = new Set();

  (Array.isArray(enriched.behaviorDiffs) ? enriched.behaviorDiffs : []).forEach((/** @type {any} */ d, /** @type {number} */ i) => {
    const at = `$.behaviorDiffs[${i}]`;
    if (!isObject(d)) return;
    if (Array.isArray(d.codePaths)) {
      d.codePaths.forEach((/** @type {unknown} */ cp, /** @type {number} */ j) => {
        if (typeof cp === 'string' && !isMarkdownCodePath(cp) && !matchesSome(cp, changed)) errors.push(`${at}.codePaths[${j}]: 변경 파일 목록에 없음 (${cp})`);
      });
    }
    const used = (Array.isArray(d.probes) ? d.probes : []).map((/** @type {unknown} */ id, /** @type {number} */ j) => probe(id, `${at}.probes[${j}]`)).filter(Boolean);
    if (!used.length || typeof d.text !== 'string') return;
    for (const p of used) explained.add(p.id);
    // Observed values in the sentence a person reads must come from the runs it cites.
    const haystack = used.map(probeText).join('\n');
    const known = numbersIn(haystack);
    const missingNumbers = [...numbersIn(d.text)].filter((n) => !known.has(n));
    if (missingNumbers.length) errors.push(`${at}.text: 인용한 탐침의 명령과 출력에 없는 값 (${missingNumbers.join(', ')})`);
    const flat = normalize(haystack);
    const missingQuotes = quotedIn(d.text).filter((q) => !flat.includes(normalize(q)));
    if (missingQuotes.length) errors.push(`${at}.text: 인용한 탐침의 명령과 출력에 없는 문자열 (${missingQuotes.map((q) => JSON.stringify(q)).join(', ')})`);
  });

  const questions = Array.isArray(enriched.questions) ? enriched.questions : [];
  const ids = questions.map((/** @type {any} */ q) => q?.id);
  ids.forEach((/** @type {unknown} */ id, /** @type {number} */ i) => {
    if (typeof id === 'string' && ids.indexOf(id) !== i) errors.push(`$.questions[${i}].id: 질문 id가 중복됨 (${id})`);
  });

  const decisionCheck = decisionChecker({ root, repoFiles, probes, errors });
  const changedTests = probes?.tests?.changed ?? [];
  const changedTestNames = new Set(changedTests.map((/** @type {any} */ t) => t.name));
  const changedTestFiles = new Set(changedTests.map((/** @type {any} */ t) => (t.location ? String(t.location).replace(/:\d+$/, '') : null)).filter(Boolean));

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const at = `$.questions[${i}]`;
    if (!isObject(q)) continue;
    const sources = Array.isArray(q.sources) ? q.sources : [];
    for (let k = 0; k < sources.length; k += 1) await checkSource(sources[k], `${at}.sources[${k}]`, true);

    if (q.kind === 'predict') {
      const p = probe(q.probe, `${at}.probe`);
      if (p && q.answerType === 'number' && numbersIn(`${p.head.stdout}\n${p.head.stderr}`).size === 0) {
        warnings.push(`${at}: 숫자로 답하는 질문인데 탐침 ${p.id}의 head 출력에 숫자가 없음`);
      }
    } else if (q.kind === 'intent') {
      probe(q.probe, `${at}.probe`);
    } else if (q.kind === 'fork') {
      (Array.isArray(q.probes) ? q.probes : []).forEach((/** @type {unknown} */ id, /** @type {number} */ j) => probe(id, `${at}.probes[${j}]`));
      (Array.isArray(q.codePaths) ? q.codePaths : []).forEach((/** @type {unknown} */ cp, /** @type {number} */ j) => {
        if (typeof cp === 'string' && !isMarkdownCodePath(cp) && !matchesSome(cp, repoFiles)) errors.push(`${at}.codePaths[${j}]: 저장소에 맞는 파일이 없음 (${cp})`);
      });
      if (isObject(q.decision)) await checkProposal(q.decision, `${at}.decision`, decisionCheck);
      if (typeof q.retires === 'string') await decisionCheck.existing(q.retires, `${at}.retires`);
    } else if (q.kind === 'test-lock' && typeof q.test === 'string') {
      // A test whose result changed, or a place in a test file this change touched.
      if (changedTestNames.has(q.test)) continue;
      const m = /^(.*?)(?::(\d+))?$/.exec(q.test);
      const file = m?.[1] ?? q.test;
      if (!present.has(file) && !changedTestFiles.has(file)) {
        errors.push(`${at}.test: 결과가 달라진 테스트도, 이번 변경이 고친 테스트 파일의 위치도 아님 (${q.test})`);
        continue;
      }
      if (m?.[2]) {
        let lines = 0;
        try {
          lines = (await readFile(path.join(root, file), 'utf8')).split('\n').length;
        } catch {
          // a test file of the base side only: no line check
          lines = Infinity;
        }
        if (Number(m[2]) < 1 || Number(m[2]) > lines) errors.push(`${at}.test: ${file}에 ${m[2]}행이 없음`);
      }
    }
  }

  const discussions = Array.isArray(enriched.discussions) ? enriched.discussions : [];
  for (let i = 0; i < discussions.length; i += 1) {
    const d = discussions[i];
    const at = `$.discussions[${i}]`;
    if (!isObject(d)) continue;
    if (discussions.findIndex((/** @type {any} */ x) => x?.id === d.id) !== i) errors.push(`${at}.id: 토론 id가 중복됨 (${d.id})`);
    await checkProposal(d, at, decisionCheck);
    delete d.fetched;
    if (typeof d.url !== 'string' || typeof d.quote !== 'string') continue;
    const fetched = await checkDiscussion({ cwd: root, remote: input.repo.remote, url: d.url, quote: d.quote, at, errors });
    if (fetched) d.fetched = fetched;
  }

  if (input.recheck?.kind === 'probes') {
    const linked = (Array.isArray(enriched.behaviorDiffs) ? enriched.behaviorDiffs : []).flatMap((/** @type {any} */ d) => (Array.isArray(d?.codePaths) ? d.codePaths : []));
    const open = input.recheck.unlinked.filter((/** @type {string} */ p) => !matchesSome(p, linked) && !linked.some((/** @type {string} */ g) => matchesSome(g, [p])));
    if (open.length) warnings.push(`재확인: 어느 탐침에도 연결되지 않은 변경 (${open.join(', ')}). 이 파일의 동작을 드러내는 탐침과 behaviorDiffs를 더한다`);
  }
  if (questions.length > QUESTIONS_MAX) warnings.push(`$.questions: 질문이 ${questions.length}개. 이 변경은 한 번에 이해하기에 클 수 있음(기본 3~${QUESTIONS_MAX}개)`);
  if (!questions.length) warnings.push('$.questions: 질문이 없음. 사람이 예측해 볼 동작이 없는 변경인지 확인한다');
  for (const p of probeById.values()) {
    if (p.base.sha256 !== p.head.sha256 && !explained.has(p.id)) warnings.push(`탐침 ${p.id}: base와 head의 출력이 다르지만 어느 behaviorDiffs에도 쓰이지 않음`);
  }
  return { errors, warnings, draft: enriched };
}

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whether a symbol appears in a text as a whole name, not as part of a longer identifier.
 * @param {string} text
 * @param {string} symbol
 */
export const hasSymbol = (text, symbol) => new RegExp(`(^|[^\\p{L}\\p{N}_$])${escapeRe(symbol)}(?=$|[^\\p{L}\\p{N}_$])`, 'u').test(text);

/**
 * Checks of what a decision record would rest on (pivot 7.2): its scope matches repository
 * files, its anchor files and symbols exist, its test anchors passed on head in the recorded
 * test run, and a replaced or retired record exists.
 * @param {{ root: string, repoFiles: string[], probes: any, errors: string[] }} options
 */
function decisionChecker({ root, repoFiles, probes, errors }) {
  const files = new Set(repoFiles);
  /** @type {Set<string> | null} */
  let known = null;
  const results = probes?.tests?.head?.parsed ? probes.tests.head.results : null;
  return {
    /** @param {any} a @param {string} at */
    async anchor(a, at) {
      if (!isObject(a) || typeof a.file !== 'string') return;
      if (!files.has(a.file)) return void errors.push(`${at}.file: 저장소에 없는 파일 (${a.file})`);
      if (typeof a.symbol === 'string') {
        const text = await readFile(path.join(root, a.file), 'utf8').catch(() => '');
        if (!hasSymbol(text, a.symbol)) errors.push(`${at}.symbol: ${a.file}에 없는 이름 (${a.symbol})`);
      }
      if (typeof a.test === 'string') {
        if (!results) return void errors.push(`${at}.test: 테스트별 결과가 기록된 탐침 실행이 없음. probes.json의 tests로 테스트를 함께 돌린다`);
        const r = results[a.test];
        if (!r) return void errors.push(`${at}.test: head 테스트 결과에 없는 테스트 (${a.test})`);
        if (r.location && String(r.location).replace(/:\d+$/, '') !== a.file) errors.push(`${at}.file: 테스트 ${a.test}의 위치(${r.location})와 다른 파일`);
        if (r.status !== 'pass') errors.push(`${at}.test: head에서 통과하지 않은 테스트 (${a.test}: ${r.status})`);
      }
    },
    /** @param {string} id @param {string} at */
    async existing(id, at) {
      known ??= new Set((await readRecords(root)).decisions.map((d) => d.meta.id));
      if (!known.has(id)) errors.push(`${at}: 저장소에 없는 결정 기록 (${id}). 이전 형식의 기록은 대체하거나 지울 수 없음`);
    },
    /** @param {unknown} glob @param {string} at */
    scope(glob, at) {
      if (typeof glob === 'string' && !matchesSome(glob, repoFiles)) errors.push(`${at}: 저장소에 맞는 파일이 없음 (${glob})`);
    },
  };
}

/**
 * @param {any} p a decision proposal or discussion candidate
 * @param {string} at
 * @param {ReturnType<typeof decisionChecker>} check
 */
async function checkProposal(p, at, check) {
  (Array.isArray(p.scope) ? p.scope : []).forEach((/** @type {unknown} */ g, /** @type {number} */ j) => check.scope(g, `${at}.scope[${j}]`));
  const anchors = Array.isArray(p.anchors) ? p.anchors : [];
  for (let j = 0; j < anchors.length; j += 1) await check.anchor(anchors[j], `${at}.anchors[${j}]`);
  if (typeof p.replaces === 'string') await check.existing(p.replaces, `${at}.replaces`);
}
