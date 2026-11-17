// Prediction, reveal and judgment of a schema 2 draft (pivot plan 5.2, 5.4).
//
// The person first answers the questions that ask for a prediction (`predict`, `test-lock`).
// Until those answers are saved, the server sends nothing that shows a result: no probe
// output, no behavior description, no changed test. After the reveal the person judges every
// question. Any `revert` or `split` sends the work back to the agent (`returned`); otherwise
// the task is approved. The judgment is signed like an approval.

import path from 'node:path';

import { canonicalJson, draftDigest, sha256Hex } from '../lib/canonical.mjs';
import { normalize, numbersIn, quotedIn } from '../lib/draft-check.mjs';
import { HeirloomError } from '../lib/errors.mjs';
import { appendEvent, deriveState, readEvents } from '../lib/events.mjs';
import { readJson, writeJsonAtomic } from '../lib/fsx.mjs';
import { tryGit } from '../lib/git.mjs';
import { newApprovalId, newRecordId } from '../lib/ids.mjs';
import { loadApprovalBaseline } from '../lib/baseline.mjs';
import { loadProjectConfig } from '../lib/config.mjs';
import { approvalFiles, taskPaths } from '../lib/paths.mjs';
import { ACCEPTING, assertValid, judgmentSchema } from '../lib/schema.mjs';
import { sign } from '../lib/sign.mjs';
import { AFTER_MERGE, SPEC_CHOICES, citedSpecParts, specRefs, specSourcesOf } from '../lib/spec-handling.mjs';
import { currentSourceState, hashMaterial } from '../lib/state.mjs';
import { withTaskLock } from '../lib/task-lock.mjs';

/** Questions the person answers before anything is revealed. */
const PREDICTED = new Set(['predict', 'test-lock']);
/** Verdicts each question kind takes. */
const VERDICTS_OF = /** @type {Record<string, Set<string>>} */ ({
  predict: new Set(['as-expected', 'my-misunderstanding', 'revert', 'split']),
  'test-lock': new Set(['as-expected', 'my-misunderstanding', 'revert', 'split']),
  intent: new Set(['as-expected', 'my-misunderstanding', 'revert', 'split']),
  fork: new Set(['answered', 'revert', 'split']),
});
const MAX_TEXT = 2000;
/** Characters of a probe output kept in the signed judgment. */
const REVEALED_CHARS = 1000;

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {string} message */
const bad = (message) => new HeirloomError('E_INPUT', message);

/** Whether a draft is judged on this screen rather than approved item by item. @param {any} draft */
export const isJudgedDraft = (draft) => isObject(draft) && draft.schemaVersion === 2;

/**
 * @param {string} home
 * @param {string} taskId
 */
async function loadTask(home, taskId) {
  const paths = taskPaths(home, taskId);
  const input = /** @type {any} */ (await readJson(paths.input));
  const draft = /** @type {any} */ (await readJson(paths.draft));
  const probes = /** @type {any} */ (await readJson(path.join(paths.probes, 'result.json'))) ?? null;
  const answers = /** @type {any} */ (await readJson(paths.answers)) ?? null;
  const events = await readEvents(paths.events);
  return { paths, input, draft, probes, answers, events, state: deriveState(events) };
}

/**
 * Saved predictions that belong to the current draft, or null.
 * @param {any} answers
 * @param {any} draft
 */
const answersFor = (answers, draft) => (answers && draft && answers.draftSha256 === draftDigest(draft) ? answers : null);

/** @param {any} run */
const side = (run) => ({ exitCode: run.exitCode, timedOut: run.timedOut, error: run.error, stdout: run.stdout, stderr: run.stderr });

/**
 * A probe as the screen shows it once revealed.
 * @param {any} p
 */
const probeView = (p) => ({ id: p.id, title: p.title, run: p.run, same: p.base.sha256 === p.head.sha256, base: side(p.base), head: side(p.head) });

/**
 * The probes a question rests on.
 * @param {any} q
 * @returns {string[]}
 */
const probeIdsOf = (q) => (q.kind === 'fork' ? q.probes : q.probe ? [q.probe] : []);

/**
 * Changed tests a test-lock question points at: by name, or by the file of its location.
 * @param {any} q
 * @param {any} probes
 */
function testsOf(q, probes) {
  const changed = probes?.tests?.changed ?? [];
  const named = changed.filter((/** @type {any} */ t) => t.name === q.test);
  if (named.length) return named;
  const file = String(q.test).replace(/:\d+$/, '');
  return changed.filter((/** @type {any} */ t) => t.location && String(t.location).replace(/:\d+$/, '') === file);
}

/**
 * Hashes of what a question rests on: base and head output of each probe, and for a
 * test-lock question the base and head results of its tests.
 * @param {any} q
 * @param {any} probes
 * @returns {Record<string, { base: string, head: string }> | null} null when a probe was not run
 */
function hashesFor(q, probes) {
  /** @type {Record<string, { base: string, head: string }>} */
  const out = {};
  for (const id of probeIdsOf(q)) {
    const p = probes?.probes.find((/** @type {any} */ x) => x.id === id);
    if (!p) return null;
    out[id] = { base: p.base.sha256, head: p.head.sha256 };
  }
  if (q.kind === 'test-lock') {
    const tests = testsOf(q, probes);
    out.tests = { base: sha256Hex(canonicalJson(tests.map((/** @type {any} */ t) => [t.name, t.base]))), head: sha256Hex(canonicalJson(tests.map((/** @type {any} */ t) => [t.name, t.head]))) };
  }
  return out;
}

/**
 * Verdicts kept from the judgment this round rechecks (pivot 6.3): a question asked the same
 * way whose probe outputs did not change keeps its accepting verdict and is not asked again.
 * @param {{ home: string, taskId: string, input: any, draft: any, probes: any }} options
 * @returns {Promise<{ basedOn: string | null, carried: Map<string, any> }>}
 */
async function carriedVerdicts({ home, taskId, input, draft, probes }) {
  /** @type {Map<string, any>} */
  const carried = new Map();
  if (input?.recheck?.kind !== 'probes') return { basedOn: null, carried };
  const before = await loadApprovalBaseline({ home, taskId, approvalId: input.recheck.basedOn });
  const asked = new Map(before.draft.questions.map((/** @type {any} */ q) => [q.id, q]));
  for (const q of draft.questions) {
    const item = before.approval.items.find((/** @type {any} */ i) => i.id === q.id);
    const old = asked.get(q.id);
    if (!item || !old || !ACCEPTING.has(item.verdict) || canonicalJson(old) !== canonicalJson(q)) continue;
    const now = hashesFor(q, probes);
    if (now && canonicalJson(now) === canonicalJson(item.probeHashes)) carried.set(q.id, item);
  }
  return { basedOn: input.recheck.basedOn, carried };
}

/**
 * Whether a prediction matches the head result, when that can be told by machine: numbers
 * by value, a choice when exactly one choice appears in the output. Null otherwise; the
 * person decides.
 * @param {any} q
 * @param {string | null} answer
 * @param {any} probes
 * @returns {boolean | null}
 */
export function predictionCorrect(q, answer, probes) {
  if (q.kind !== 'predict' || answer === null) return null;
  const p = probes?.probes.find((/** @type {any} */ x) => x.id === q.probe);
  if (!p) return null;
  const out = `${p.head.stdout}\n${p.head.stderr}`;
  if (q.answerType === 'number') {
    const said = [...numbersIn(answer)];
    if (!said.length) return false;
    const seen = numbersIn(out);
    return said.every((n) => seen.has(n));
  }
  if (q.answerType === 'choice') {
    const flat = normalize(out);
    const shown = (q.choices ?? []).filter((/** @type {string} */ c) => flat.includes(normalize(c)));
    return shown.length === 1 ? shown[0] === answer : null;
  }
  return normalize(out) === normalize(answer) ? true : null;
}

/**
 * The task as the screen may see it. Before the predictions are saved, the draft is cut down
 * to the questions and the probe commands; after, everything is sent with the person's
 * predictions and, per question, what was observed.
 * @param {{ home: string, taskId: string }} options
 */
export async function judgeView({ home, taskId }) {
  const { input, draft, probes, answers } = await loadTask(home, taskId);
  if (!isJudgedDraft(draft)) return null;
  const saved = answersFor(answers, draft);
  const commands = (probes?.probes ?? []).map((/** @type {any} */ p) => ({ id: p.id, title: p.title, run: p.run }));
  const { basedOn, carried } = await carriedVerdicts({ home, taskId, input, draft, probes });
  const questions = draft.questions.map((/** @type {any} */ q) => {
    const kept = carried.get(q.id);
    return {
      ...q,
      predictFirst: PREDICTED.has(q.kind) && !kept,
      citesSpec: specSourcesOf(q, input).length > 0,
      carried: kept ? { verdict: kept.verdict, answer: kept.answer, correct: kept.correct, judgedIn: basedOn } : null,
    };
  });
  const base = {
    revealed: Boolean(saved),
    specs: specRefs(input),
    specAfterMergeDefault: input ? (await loadProjectConfig(input.repo.root)).spec.afterMerge : 'delete',
    basedOn,
    unlinked: input?.recheck?.kind === 'probes' ? input.recheck.unlinked : [],
    questions,
    commands,
    probeSetHash: draft.probeSetHash,
    setupFailed: Boolean(probes?.setup && [...(probes.setup.base ?? []), ...(probes.setup.head ?? [])].some((/** @type {any} */ s) => s.exitCode !== 0)),
  };
  if (!saved) return base;
  return {
    ...base,
    predictions: saved.answers,
    predictedAt: saved.answeredAt,
    behaviorDiffs: draft.behaviorDiffs,
    discussions: draft.discussions ?? [],
    inferences: draft.inferences,
    notes: draft.notes,
    probes: (probes?.probes ?? []).map(probeView),
    tests: probes?.tests ? { comparison: probes.tests.comparison, changed: probes.tests.changed, base: { exitCode: probes.tests.base.exitCode, counts: probes.tests.base.counts }, head: { exitCode: probes.tests.head.exitCode, counts: probes.tests.head.counts } } : null,
    observed: Object.fromEntries(
      draft.questions.map((/** @type {any} */ q) => [
        q.id,
        { probes: probeIdsOf(q), tests: q.kind === 'test-lock' ? testsOf(q, probes) : [], correct: predictionCorrect(q, saved.answers[q.id] ?? null, probes) },
      ]),
    ),
  };
}

/**
 * The draft without anything that shows a result, for a screen that has not revealed yet.
 * @param {any} draft
 */
export function redactedDraft(draft) {
  return { schemaVersion: draft.schemaVersion, taskId: draft.taskId, inputSourceHash: draft.inputSourceHash, probeSetHash: draft.probeSetHash, questions: draft.questions };
}

/**
 * Check one answer against its question.
 * @param {any} q
 * @param {unknown} answer
 */
function checkAnswer(q, answer) {
  if (typeof answer !== 'string' || !answer.trim() || answer.length > MAX_TEXT) throw bad(`${q.id}: 답은 ${MAX_TEXT}자 이하의 비어 있지 않은 문자열이어야 함`);
  if (q.kind === 'test-lock' && answer !== 'yes' && answer !== 'no') throw bad(`${q.id}: 답은 yes 또는 no여야 함`);
  if (q.kind === 'predict' && q.answerType === 'choice' && !q.choices.includes(answer)) throw bad(`${q.id}: 보기 중 하나를 골라야 함`);
  if (q.kind === 'predict' && q.answerType === 'number' && numbersIn(answer).size === 0) throw bad(`${q.id}: 숫자로 답해야 함`);
}

/**
 * Save the person's predictions and reveal the results. Predictions cannot be changed once
 * saved for a draft.
 * @param {{ home: string, taskId: string, request: unknown, now?: Date }} options
 */
export async function recordPredictions({ home, taskId, request, now = new Date() }) {
  return withTaskLock(home, taskId, async () => {
    const { paths, input, draft, probes, answers, state } = await loadTask(home, taskId);
    if (state !== 'awaiting_approval') throw new HeirloomError('E_CONFLICT', `판정 대기 상태가 아님 (현재: ${state})`);
    if (!isJudgedDraft(draft)) throw new HeirloomError('E_CONFLICT', '예측을 받는 초안이 아님');
    const { carried } = await carriedVerdicts({ home, taskId, input, draft, probes });
    if (!isObject(request) || typeof request.draftSha256 !== 'string' || !isObject(request.answers)) throw bad('draftSha256과 answers가 필요함');
    const digest = draftDigest(draft);
    if (request.draftSha256 !== digest) throw new HeirloomError('E_CONFLICT', '화면이 보던 초안이 현재와 다름. 화면을 새로 고친다.');
    if (answersFor(answers, draft)) throw new HeirloomError('E_CONFLICT', '이 초안의 예측은 이미 저장되어 결과가 공개됨. 예측은 바꿀 수 없음.');
    const predicted = draft.questions.filter((/** @type {any} */ q) => PREDICTED.has(q.kind) && !carried.has(q.id));
    /** @type {Record<string, string>} */
    const saved = {};
    for (const q of predicted) {
      const answer = request.answers[q.id];
      checkAnswer(q, answer);
      saved[q.id] = /** @type {string} */ (answer).trim();
    }
    const extra = Object.keys(request.answers).filter((id) => !predicted.some((/** @type {any} */ q) => q.id === id));
    if (extra.length) throw bad(`예측하는 질문이 아님: ${extra.join(', ')}`);
    await writeJsonAtomic(paths.answers, { schemaVersion: 1, draftSha256: digest, answeredAt: now.toISOString(), answers: saved });
    return { revealed: true };
  });
}

/**
 * Sign the judgment. All accepted: `approved`. Any revert or split: `returned`, with the
 * reasons in the event for the waiting agent.
 * @param {{ home: string, taskId: string, request: unknown, keystore?: import('../lib/sign.mjs').Keystore, now?: Date }} options
 */
export async function judgeTask({ home, taskId, request, keystore, now = new Date() }) {
  return withTaskLock(home, taskId, async () => {
    const { paths, input, draft, probes, answers, state } = await loadTask(home, taskId);
    if (state !== 'awaiting_approval') throw new HeirloomError('E_CONFLICT', `판정 대기 상태가 아님 (현재: ${state})`);
    if (!input || !isJudgedDraft(draft)) throw new HeirloomError('E_CONFLICT', '판정할 초안이 없음');
    const saved = answersFor(answers, draft);
    if (!saved) throw new HeirloomError('E_CONFLICT', '예측을 먼저 저장해야 판정할 수 있음');
    if (!probes || probes.probeSetHash !== draft.probeSetHash) throw new HeirloomError('E_CONFLICT', '초안이 가리키는 탐침 실행 기록이 없음. 에이전트가 다시 인계해야 함');
    if (!isObject(request) || typeof request.draftSha256 !== 'string' || typeof request.sourceHash !== 'string' || !Array.isArray(request.items)) {
      throw bad('draftSha256, sourceHash, items가 필요함');
    }
    const digest = draftDigest(draft);
    if (request.draftSha256 !== digest || request.sourceHash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '화면이 보던 초안이나 소스 상태가 현재와 다름. 화면을 새로 고친 뒤 다시 판정한다.');
    }

    /** @type {Map<string, any>} */
    const sent = new Map();
    for (const item of request.items) {
      if (!isObject(item) || typeof item.id !== 'string') throw bad('items의 각 항목에는 id가 필요함');
      if (sent.has(item.id)) throw bad(`질문 id가 중복됨: ${item.id}`);
      sent.set(item.id, item);
    }
    const probeById = new Map(probes.probes.map((/** @type {any} */ p) => [p.id, p]));
    const { basedOn, carried } = await carriedVerdicts({ home, taskId, input, draft, probes });
    const items = draft.questions.map((/** @type {any} */ q) => {
      const kept = carried.get(q.id);
      if (kept) {
        if (sent.has(q.id)) throw bad(`${q.id}: 이전 판정이 유지되는 질문은 다시 판정하지 않음`);
        return { ...kept, carried: true };
      }
      const item = sent.get(q.id);
      if (!item) throw bad(`${q.id}: 판정이 없음. 모든 질문을 판정해야 함`);
      if (!VERDICTS_OF[q.kind]?.has(item.verdict)) throw bad(`${q.id}: ${q.kind} 질문의 판정은 ${[...VERDICTS_OF[q.kind]].join(', ')} 중 하나여야 함`);
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      if (reason.length > MAX_TEXT) throw bad(`${q.id}: 이유는 ${MAX_TEXT}자 이하여야 함`);
      if (!ACCEPTING.has(item.verdict) && !reason) throw bad(`${q.id}: 되돌리거나 분리할 때는 이유가 필요함`);
      let answer = PREDICTED.has(q.kind) ? saved.answers[q.id] ?? null : null;
      if (q.kind === 'fork' && item.verdict === 'answered') {
        if (typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > MAX_TEXT) throw bad(`${q.id}: 열린 선택에 대한 답이 필요함`);
        answer = item.answer.trim();
      }
      const keep = keptAs(q, item);
      const cited = specSourcesOf(q, input);
      const specChoice = item.spec === undefined || item.spec === null ? null : item.spec;
      if (specChoice !== null && (ACCEPTING.has(item.verdict) || !cited.length)) throw bad(`${q.id}: spec 처리는 spec을 인용한 질문을 되돌리거나 분리할 때만 고름`);
      if (!ACCEPTING.has(item.verdict) && cited.length && !SPEC_CHOICES.includes(specChoice)) {
        throw bad(`${q.id}: spec을 인용한 질문을 되돌리거나 분리할 때는 spec 처리(${SPEC_CHOICES.join(', ')})를 골라야 함`);
      }
      const correct = predictionCorrect(q, answer, probes);
      if (correct === false && item.verdict === 'as-expected') throw bad(`${q.id}: 예측이 결과와 달라 '예상대로'로 판정할 수 없음`);
      if (correct === true && item.verdict === 'my-misunderstanding') throw bad(`${q.id}: 예측이 결과와 같아 '내가 잘못 알았음'으로 판정할 수 없음`);
      /** @type {Record<string, { base: string, head: string }>} */
      const probeHashes = {};
      /** @type {Record<string, { base: string, head: string }>} */
      const outputs = {};
      for (const id of probeIdsOf(q)) {
        const p = /** @type {any} */ (probeById.get(id));
        if (!p) throw new HeirloomError('E_CONFLICT', `${q.id}: 탐침 ${id}의 실행 기록이 없음`);
        probeHashes[id] = { base: p.base.sha256, head: p.head.sha256 };
        outputs[id] = { base: p.base.stdout.slice(0, REVEALED_CHARS), head: p.head.stdout.slice(0, REVEALED_CHARS) };
      }
      const tests = q.kind === 'test-lock' ? testsOf(q, probes) : [];
      if (q.kind === 'test-lock') probeHashes.tests = /** @type {any} */ (hashesFor(q, probes)).tests;
      return {
        id: q.id,
        kind: q.kind,
        prompt: q.prompt,
        answer,
        correct,
        revealed: { probes: outputs, ...(q.kind === 'test-lock' ? { tests } : {}) },
        probeHashes,
        verdict: item.verdict,
        ...(reason ? { reason } : {}),
        ...(specChoice !== null ? { spec: { choice: specChoice, cited } } : {}),
        ...(keep ? { keep } : {}),
      };
    });
    const extra = [...sent.keys()].filter((id) => !draft.questions.some((/** @type {any} */ q) => q.id === id));
    if (extra.length) throw bad(`초안에 없는 질문: ${extra.join(', ')}`);
    const discussions = confirmedDiscussions(draft, request.discussions);

    // The person may reword a behavior description, never the observed values in it.
    const initial = draft.behaviorDiffs.map((/** @type {any} */ d) => d.text);
    const final = request.behaviorDiffs === undefined ? initial : request.behaviorDiffs;
    if (!Array.isArray(final) || final.length !== initial.length) throw bad('behaviorDiffs는 초안과 개수가 같은 문자열 배열이어야 함');
    final.forEach((/** @type {unknown} */ text, /** @type {number} */ i) => {
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw bad(`behaviorDiffs[${i}]: 비어 있지 않은 ${MAX_TEXT}자 이하의 문자열이어야 함`);
      const values = (/** @type {string} */ t) => canonicalJson({ n: [...numbersIn(t)].sort((a, b) => a - b), q: quotedIn(t).sort() });
      if (values(text) !== values(initial[i])) throw bad(`behaviorDiffs[${i}]: 관측값(숫자, 따옴표 친 문자열)은 고칠 수 없음`);
    });

    const current = await currentSourceState({ root: input.repo.root, base: input.base });
    if (current.hash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '인계 이후 소스가 바뀌어 판정할 수 없음. 에이전트가 prepare-handoff를 다시 실행해야 한다.');
    }
    const root = input.repo.root;
    for (const m of input.materials) {
      if (m.role !== 'spec' || !m.sha256 || path.isAbsolute(m.ref)) continue;
      const now = await hashMaterial(root, m.ref).catch(() => null);
      if (now !== m.sha256) throw new HeirloomError('E_CONFLICT', `인계 이후 spec이 바뀌어 판정할 수 없음: ${m.ref}. 에이전트가 prepare-handoff를 다시 실행해야 한다.`);
    }
    for (const i of items) if (i.spec?.cited) i.spec = { choice: i.spec.choice, parts: await citedSpecParts(root, i.spec.cited) };
    const outcome = items.every((/** @type {any} */ i) => ACCEPTING.has(i.verdict)) ? 'accepted' : 'returned';
    const specs = specRefs(input);
    const afterMerge = outcome === 'accepted' && specs.length ? await chosenAfterMerge(request, root, specs) : null;
    if (outcome === 'returned' && request.specAfterMerge !== undefined) throw bad('spec 수명은 모든 질문을 수용할 때만 고름');
    const headSha = await tryGit(['rev-parse', 'HEAD'], { cwd: input.repo.root });
    const ident = await tryGit(['var', 'GIT_AUTHOR_IDENT'], { cwd: input.repo.root });
    const record = {
      schemaVersion: 2,
      id: newApprovalId(),
      taskId,
      kind: 'judgment',
      ...(basedOn ? { basedOn } : {}),
      target: {
        sourceHash: input.source.hash,
        headSha: headSha || null,
        draftSha256: digest,
        probeSetHash: draft.probeSetHash,
        materials: Object.fromEntries(input.materials.map((/** @type {any} */ m) => [m.ref, m.sha256])),
      },
      behaviorDiffs: { initial, final: final.map((/** @type {string} */ t) => t.trim()) },
      items,
      outcome,
      ...(afterMerge ? { specAfterMerge: afterMerge } : {}),
      ...(discussions.length ? { discussions } : {}),
      predictedAt: saved.answeredAt,
      judgedAt: now.toISOString(),
      approver: { fingerprint: '', gitUser: ident ? ident.replace(/\s+\d+\s+[+-]\d{4}$/, '') : null },
    };
    const signed = await sign(home, record, { keystore });
    assertValid(judgmentSchema, signed, 'judgment');
    const files = approvalFiles(paths.approvals, signed.id);
    await writeJsonAtomic(files.input, input);
    await writeJsonAtomic(files.draft, draft);
    await writeJsonAtomic(path.join(paths.approvals, `${signed.id}.probes.json`), probes);
    await writeJsonAtomic(files.record, signed);
    if (outcome === 'accepted') await appendEvent(paths.events, { type: 'approved', approvalId: signed.id });
    else {
      await appendEvent(paths.events, {
        type: 'returned',
        approvalId: signed.id,
        items: items.filter((/** @type {any} */ i) => !ACCEPTING.has(i.verdict)).map((/** @type {any} */ i) => ({ id: i.id, verdict: i.verdict, reason: i.reason, ...(i.spec ? { spec: i.spec.choice } : {}) })),
      });
    }
    return signed;
  });
}

/**
 * The spec lifetime of an accepted judgment: what the person chose, or the project default
 * when the request names none (pivot 5.6.2). Keeping a spec needs its owner.
 * @param {any} request
 * @param {string} root
 * @param {string[]} specs
 */
async function chosenAfterMerge(request, root, specs) {
  const chosen = request.specAfterMerge;
  if (chosen !== undefined && !isObject(chosen)) throw bad('specAfterMerge는 { action, owner? } 객체여야 함');
  const action = chosen?.action ?? (await loadProjectConfig(root)).spec.afterMerge;
  if (!(/** @type {readonly string[]} */ (AFTER_MERGE)).includes(action)) throw bad(`spec 수명은 ${AFTER_MERGE.join(', ')} 중 하나여야 함`);
  if (action !== 'keep') {
    if (chosen?.owner !== undefined) throw bad('owner는 spec을 유지할 때만 적음');
    return { action, specs };
  }
  const owner = typeof chosen?.owner === 'string' ? chosen.owner.trim() : '';
  if (!owner || owner.length > MAX_TEXT) throw bad('spec을 유지하려면 소유자(owner)를 적어야 함');
  return { action, specs, owner };
}

/**
 * Whether the person keeps a fork answer in the repository as a decision record, or retires the
 * record the question asked about (pivot 7.1, 7.4). Without a choice the answer stays in the PR
 * only.
 * @param {any} q
 * @param {any} item
 * @returns {{ action: 'record' | 'retire', id: string } | null}
 */
function keptAs(q, item) {
  if (item.keep === undefined || item.keep === null || item.keep === 'pr') return null;
  if (q.kind !== 'fork' || item.verdict !== 'answered') throw bad(`${q.id}: 저장소에 남기거나 기록을 지우는 것은 답한 열린 선택에서만 고름`);
  if (item.keep === 'repo') {
    if (!q.decision) throw bad(`${q.id}: 에이전트가 결정 기록안(decision)을 붙이지 않은 질문은 저장소에 남길 수 없음`);
    return { action: 'record', id: newRecordId('decision') };
  }
  if (item.keep === 'retire') {
    if (!q.retires) throw bad(`${q.id}: 지울 결정 기록(retires)을 묻는 질문이 아님`);
    return { action: 'retire', id: q.retires };
  }
  throw bad(`${q.id}: keep은 pr, repo, retire 중 하나여야 함`);
}

/**
 * The person's answer to each discussion candidate (pivot 7.1): confirmed ones become decision
 * records when the work is accepted; the others are dropped without sending the work back.
 * @param {any} draft
 * @param {unknown} sent
 * @returns {{ id: string, confirmed: boolean, recordId?: string }[]}
 */
function confirmedDiscussions(draft, sent) {
  const candidates = draft.discussions ?? [];
  if (sent === undefined && !candidates.length) return [];
  if (!Array.isArray(sent)) throw bad('discussions는 { id, confirmed } 배열이어야 함');
  /** @type {Map<string, boolean>} */
  const answers = new Map();
  for (const d of sent) {
    if (!isObject(d) || typeof d.id !== 'string' || typeof d.confirmed !== 'boolean') throw bad('discussions의 각 항목은 { id, confirmed: true|false }여야 함');
    if (!candidates.some((/** @type {any} */ c) => c.id === d.id)) throw bad(`초안에 없는 토론 후보: ${d.id}`);
    answers.set(d.id, d.confirmed);
  }
  return candidates.map((/** @type {any} */ c) => {
    const confirmed = answers.get(c.id);
    if (confirmed === undefined) throw bad(`${c.id}: 토론에서 확정된 결정인지 확인해야 함`);
    return confirmed ? { id: c.id, confirmed, recordId: newRecordId('decision') } : { id: c.id, confirmed };
  });
}
