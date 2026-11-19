// Mechanical checks of an agent-written draft against the frozen input. Content quality is
// the human's job; these checks only verify that what the draft cites exists and that
// related code paths point at real changed code. A source is a repository file, or the
// messages the person typed in the session (`@conversation`), frozen by prepare.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { globToRegExp } from './glob.mjs';
import { CONVERSATION_REF, findQuote } from './conversation.mjs';
import { checkDiscussion } from './discussion.mjs';
import { readRecords } from './records.mjs';
import { draftV2Schema, isMarkdownCodePath, validate } from './schema.mjs';
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
 * @property {any} draft enriched copy: source sha256 and fetched discussions filled
 */

/**
 * @param {object} options
 * @param {string} options.root repository root
 * @param {any} options.input frozen input.json
 * @param {any} options.draft agent draft
 * @param {string[]} options.repoFiles tracked and untracked (non-ignored) repository files
 * @param {import('./conversation.mjs').Utterance[] | null} [options.conversation] the messages
 *   the person typed, frozen for this task; null when the task has none
 * @param {any} [options.probes] the task's last probe run (`probes/result.json`), or null
 * @returns {Promise<CheckResult>}
 */
export async function checkDraft({ root, input, draft, repoFiles, conversation = null, probes = null }) {
  if (isObject(draft) && draft.schemaVersion === 2) return checkDraftV2({ root, input, draft, repoFiles, conversation, probes });
  return { errors: ['$.schemaVersion: 2여야 함. prepare-handoff 스킬의 스키마 2 형식으로 쓴다'], warnings: [], draft: isObject(draft) ? structuredClone(draft) : {} };
}

// ---------------------------------------------------------------- schema 2

/** Questions per handoff that one person can answer in one sitting. */
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
 * The choices of a choice prediction that appear in a probe's head output. A prediction is
 * scored by machine only when exactly one appears.
 * @param {string[]} choices
 * @param {any} probe a probe of `probes/result.json`
 */
export function shownChoices(choices, probe) {
  const flat = normalize(`${probe.head.stdout}\n${probe.head.stderr}`);
  return choices.filter((c) => flat.includes(normalize(c)));
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
      if (p && q.answerType === 'choice' && Array.isArray(q.choices) && q.choices.length === 4) {
        const shown = shownChoices(q.choices, p);
        if (shown.length !== 1) {
          const which = shown.length ? ` (${shown.join(', ')})` : '';
          errors.push(`${at}.choices: 탐침 ${p.id}의 head 출력에 보이는 보기가 ${shown.length}개${which}. 정답 보기 하나만 출력에 있어야 채점됨`);
        }
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

  if (usable) {
    (Array.isArray(enriched.testNotes) ? enriched.testNotes : []).forEach((/** @type {any} */ n, /** @type {number} */ i) => {
      if (isObject(n) && typeof n.test === 'string' && !changedTestNames.has(n.test)) errors.push(`$.testNotes[${i}].test: 탐침 실행에서 결과가 바뀐 테스트가 아님 (${n.test})`);
    });
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
 * Checks of what a decision record would rest on: its scope matches repository
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
