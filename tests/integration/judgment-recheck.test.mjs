// Recheck after a judgment (pivot 6.3): the same probes run on the new head; a question asked
// the same way whose probe outputs did not change keeps its verdict, the others are asked
// again; changed code no behavior description points at is reported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CART_HEAD, SPEC, judge, judgedTask } from '../helpers/judge-fixture.mjs';
import { judgeTask, judgeView, recordPredictions } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';

/** A judged and accepted task, then a change, prepared again with the same probes. */
async function recheck(/** @type {(t: Awaited<ReturnType<typeof judgedTask>>) => Promise<void>} */ change, /** @type {(d: any) => void} */ editDraft = () => {}) {
  const t = await judgedTask();
  const first = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash });
  const paths = taskPaths(t.home, t.taskId);
  const oldDraft = JSON.parse(await readFile(path.join(paths.approvals, `${first.id}.draft.json`), 'utf8'));
  const spec = JSON.parse(await readFile(path.join(paths.probes, 'spec.json'), 'utf8'));
  await change(t);
  const prepared = /** @type {any} */ (await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] }));
  const probes = /** @type {any} */ (await runProbes({ home: t.home, taskId: t.taskId, spec }));
  const draft = { ...oldDraft, inputSourceHash: prepared.source.hash, probeSetHash: probes.probeSetHash };
  for (const q of draft.questions) for (const s of q.sources ?? []) delete s.sha256;
  editDraft(draft);
  await writeFile(paths.draft, JSON.stringify(draft));
  const submitted = /** @type {any} */ (await submitDraft({ home: t.home, taskId: t.taskId }));
  const view = /** @type {any} */ (await judgeView({ home: t.home, taskId: t.taskId }));
  return { ...t, first, prepared, submitted, view, paths };
}

test('unchanged outputs: every verdict is kept; the unlinked change is reported; the new judgment builds on the old', async () => {
  const r = await recheck(async (t) => {
    await t.repo.write('src/label.mjs', "export const label = 'v2';\n");
  });
  assert.deepEqual(r.prepared.recheck, { kind: 'probes', basedOn: r.first.id, mergeBaseChanged: false, changes: [{ path: 'src/label.mjs', reason: 'added' }], unlinked: ['src/label.mjs'] });
  assert.ok(r.submitted.warnings.some((/** @type {string} */ w) => /어느 탐침에도 연결되지 않은 변경 \(src\/label\.mjs\)/.test(w)), r.submitted.warnings.join('\n'));
  assert.equal(r.view.basedOn, r.first.id);
  assert.deepEqual(r.view.unlinked, ['src/label.mjs']);
  assert.deepEqual(r.view.questions.map((/** @type {any} */ q) => [q.id, q.predictFirst, q.carried?.verdict]), [
    ['q1', false, 'my-misunderstanding'],
    ['q2', false, 'as-expected'],
    ['q3', false, 'as-expected'],
    ['q4', false, 'answered'],
  ]);

  const draft = JSON.parse(await readFile(r.paths.draft, 'utf8'));
  const draftSha256 = draftDigest(draft);
  assert.equal((await recordPredictions({ home: r.home, taskId: r.taskId, request: { draftSha256, answers: { q1: '120' } } }).catch((e) => e.message)), '예측하는 질문이 아님: q1');
  await recordPredictions({ home: r.home, taskId: r.taskId, request: { draftSha256, answers: {} } });
  const refused = await judgeTask({ home: r.home, taskId: r.taskId, keystore: 'file', request: { draftSha256, sourceHash: r.prepared.source.hash, items: [{ id: 'q1', verdict: 'as-expected' }] } }).catch((e) => e.message);
  assert.match(refused, /q1: 이전 판정이 유지되는 질문은 다시 판정하지 않음/);
  const second = await judgeTask({ home: r.home, taskId: r.taskId, keystore: 'file', request: { draftSha256, sourceHash: r.prepared.source.hash, items: [] } });
  assert.equal(second.outcome, 'accepted');
  assert.equal(second.basedOn, r.first.id);
  assert.deepEqual(second.items.map((/** @type {any} */ i) => [i.id, i.verdict, i.carried, i.answer]), [
    ['q1', 'my-misunderstanding', true, '108'],
    ['q2', 'as-expected', true, 'yes'],
    ['q3', 'as-expected', true, null],
    ['q4', 'answered', true, '100으로 한다'],
  ]);
});

test('a changed output asks again every question resting on it', async () => {
  const r = await recheck(
    async (t) => {
      await t.repo.write('src/cart.mjs', CART_HEAD.replace('qty >= 100', 'qty >= 12'));
    },
    (d) => {
      // The agent rewrites what no longer holds: 12 items now get the discount on both sides,
      // and the test no longer changes.
      d.behaviorDiffs = [{ text: '12개 구매 결제액은 108로 그대로다', probes: ['p1'], codePaths: ['src/cart.mjs'] }];
      d.questions.splice(1, 1);
    },
  );
  assert.deepEqual(r.prepared.recheck.unlinked, [], 'the change is in a file a behavior description points at');
  assert.deepEqual(r.view.questions.map((/** @type {any} */ q) => [q.id, q.predictFirst, q.carried]), [
    ['q1', true, null],
    ['q3', false, null],
    ['q4', false, null],
  ]);
});

test('a question asked differently is asked again even when its output did not change', async () => {
  const r = await recheck(
    async (t) => {
      await t.repo.write('src/label.mjs', "export const label = 'v2';\n");
    },
    (d) => {
      d.questions[2].prompt = 'spec이 말한 경계와 실제 경계가 같나요?';
    },
  );
  assert.deepEqual(r.view.questions.map((/** @type {any} */ q) => [q.id, Boolean(q.carried)]), [['q1', true], ['q2', true], ['q3', false], ['q4', true]]);
});
