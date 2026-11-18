// A node project with a prepared handoff, a probe run and a submitted schema 2 draft
// (state awaiting_approval): the discount threshold moves from 10 to 100.

import { writeFile } from 'node:fs/promises';

import { cloneRepo, makeRepo, tempDir } from './git-fixture.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';
import { judgeTask, recordPredictions } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';

export const SPEC = 'docs/specs/cart.md';
export const CART_HEAD = 'export function total({ qty, unit }) {\n  const sum = qty * unit;\n  return qty >= 100 ? sum * 0.9 : sum;\n}\n';
const CART_BASE = 'export function total({ qty, unit }) {\n  const sum = qty * unit;\n  return qty >= 10 ? sum * 0.9 : sum;\n}\n';
const CART_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('bulk discount for 12', () => {
  assert.equal(total({ qty: 12, unit: 10 }), 108);
});
`;

/** Observed values of the fixture: base and head output of probe p1. */
export const OBSERVED = { base: '108', head: '120' };

/**
 * @param {{ commit?: boolean, config?: object, baseFiles?: Record<string, string>, editDraft?: (draft: any) => void, remote?: string }} [options]
 *   commit: false leaves the judged change uncommitted; config is written as the project's
 *   .heirloom/config.json; baseFiles are added to the target branch; editDraft changes the
 *   draft before it is submitted; remote replaces the origin URL before the handoff
 */
export async function judgedTask({ commit = true, config, baseFiles = {}, editDraft = () => {}, remote } = {}) {
  const upstream = await makeRepo({ 'package.json': '{ "type": "module" }\n', 'src/cart.mjs': CART_BASE, 'test/cart.test.mjs': CART_TEST, ...baseFiles });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  if (remote) repo.git('remote', 'set-url', 'origin', remote);
  await repo.write(SPEC, '# cart\n\n할인 경계를 100개로 바꾼다.\n');
  await repo.write('src/cart.mjs', CART_HEAD);
  if (config) await repo.write('.heirloom/config.json', `${JSON.stringify(config)}\n`);
  if (commit) repo.commitAll('threshold');
  const home = await tempDir('home');
  const prepared = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const taskId = prepared.taskId;
  const { probeSetHash } = await handIn({ home, taskId, sourceHash: prepared.source.hash, editDraft });
  return { upstream, repo, home, taskId, sourceHash: prepared.source.hash, probeSetHash };
}

/** Probes file of the fixture. */
export const PROBE_SPEC = {
  probes: [{ id: 'p1', title: '12개 구매 결제액', run: ['node', '-e', "import('./src/cart.mjs').then((m) => console.log(m.total({ qty: 12, unit: 10 })))"] }],
  tests: { command: ['node', '--test', '--test-reporter=tap'], parser: 'node-tap' },
};

/**
 * Run the fixture's probes for a prepared task, write the fixture's draft and submit it.
 * @param {{ home: string, taskId: string, sourceHash: string, editDraft?: (draft: any) => void }} options
 */
export async function handIn({ home, taskId, sourceHash, editDraft = () => {} }) {
  const probes = /** @type {any} */ (await runProbes({ home, taskId, spec: PROBE_SPEC }));
  const draft = {
    schemaVersion: 2,
    taskId,
    inputSourceHash: sourceHash,
    probeSetHash: probes.probeSetHash,
    behaviorDiffs: [{ text: '12개 구매 결제액이 108에서 120이 된다', probes: ['p1'], codePaths: ['src/cart.mjs'] }],
    questions: [
      { id: 'q1', kind: 'predict', probe: 'p1', prompt: '단가 10원으로 12개를 사면 결제액은?', answerType: 'number' },
      { id: 'q2', kind: 'test-lock', test: 'bulk discount for 12', plain: '12개 구매에 대량 할인이 붙는지 본다', prompt: '이 테스트는 이번 변경의 동작을 막나요?' },
      { id: 'q3', kind: 'intent', probe: 'p1', sources: [{ ref: SPEC, lines: [3, 3], quote: '할인 경계를 100개로 바꾼다.' }], prompt: 'spec의 의도와 같나요?' },
      { id: 'q4', kind: 'fork', probes: ['p1'], codePaths: ['src/cart.mjs'], prompt: '경계를 100으로 할까요, 50으로 할까요?', whyOpen: '경계를 정한 이유가 코드와 커밋에 없다' },
    ],
    inferences: [{ text: '다른 통화에서도 같다', reason: '통화별 탐침이 없다' }],
    notes: '',
  };
  editDraft(draft);
  await writeFile(taskPaths(home, taskId).draft, JSON.stringify(draft));
  await submitDraft({ home, taskId });
  return { probeSetHash: probes.probeSetHash };
}

/**
 * Predict and judge the fixture's questions as the dashboard would, every verdict accepting
 * unless `verdicts` says otherwise. `lifetime` is the spec lifetime sent with the judgment.
 * Predictions already saved for the draft are kept, so a refused judgment can be sent again.
 * @param {{ home: string, taskId: string, sourceHash: string, verdicts?: Record<string, { verdict: string, reason?: string, answer?: string, spec?: string, keep?: string }>, lifetime?: { action: string, owner?: string } }} options
 */
export async function judge({ home, taskId, sourceHash, verdicts = {}, lifetime }) {
  const draft = /** @type {any} */ (await readJson(taskPaths(home, taskId).draft));
  const draftSha256 = draftDigest(draft);
  const predicted = draft.questions.filter((/** @type {any} */ q) => q.kind === 'predict' || q.kind === 'test-lock');
  /** @type {Record<string, string>} */
  const answers = Object.fromEntries(predicted.map((/** @type {any} */ q) => [q.id, q.kind === 'predict' ? '108' : 'yes']));
  await recordPredictions({ home, taskId, request: { draftSha256, answers } }).catch((/** @type {any} */ e) => {
    if (!/이미 저장/.test(e.message)) throw e;
  });
  /** @type {Record<string, any>} */
  const defaults = { predict: { verdict: 'my-misunderstanding' }, 'test-lock': { verdict: 'as-expected' }, intent: { verdict: 'as-expected' }, fork: { verdict: 'answered', answer: '100으로 한다' } };
  const items = draft.questions.map((/** @type {any} */ q) => ({ id: q.id, ...(verdicts[q.id] ?? defaults[q.kind]) }));
  return judgeTask({ home, taskId, keystore: 'file', request: { draftSha256, sourceHash, items, ...(lifetime ? { specAfterMerge: lifetime } : {}) } });
}
