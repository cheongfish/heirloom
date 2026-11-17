// A node project with a prepared handoff, a probe run and a submitted schema 2 draft
// (state awaiting_approval): the discount threshold moves from 10 to 100.

import { writeFile } from 'node:fs/promises';

import { cloneRepo, makeRepo, tempDir } from './git-fixture.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';

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

export async function judgedTask() {
  const upstream = await makeRepo({ 'package.json': '{ "type": "module" }\n', 'src/cart.mjs': CART_BASE, 'test/cart.test.mjs': CART_TEST });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write(SPEC, '# cart\n\n할인 경계를 100개로 바꾼다.\n');
  await repo.write('src/cart.mjs', CART_HEAD);
  repo.commitAll('threshold');
  const home = await tempDir('home');
  const prepared = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const taskId = prepared.taskId;
  const probes = /** @type {any} */ (
    await runProbes({
      home,
      taskId,
      spec: {
        probes: [{ id: 'p1', title: '12개 구매 결제액', run: ['node', '-e', "import('./src/cart.mjs').then((m) => console.log(m.total({ qty: 12, unit: 10 })))"] }],
        tests: { command: ['node', '--test', '--test-reporter=tap'], parser: 'node-tap' },
      },
    })
  );
  const draft = {
    schemaVersion: 2,
    taskId,
    inputSourceHash: prepared.source.hash,
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
  await writeFile(taskPaths(home, taskId).draft, JSON.stringify(draft));
  await submitDraft({ home, taskId });
  return { repo, home, taskId, sourceHash: prepared.source.hash, probeSetHash: probes.probeSetHash };
}
