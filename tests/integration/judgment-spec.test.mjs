// Spec handling of a judgment (pivot 5.6): what the spec becomes when a question citing it is
// sent back, the refusal of a handoff that left those lines as they were, and the spec's
// lifetime once every question is accepted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SPEC, judge, judgedTask } from '../helpers/judge-fixture.mjs';
import { applyApproval } from '../../skills/using-heirloom/lib/apply.mjs';
import { judgeView } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { writePrBody } from '../../skills/using-heirloom/lib/judgment-pr.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';

const REVERT_Q3 = { q3: { verdict: 'revert', reason: '경계는 10개로 둔다' } };

/** @param {string} p */
const exists = (p) => access(p).then(() => true, () => false);

/**
 * Send the fixture's work back with q3 (which cites the spec) reverted, then hand off again
 * after `change`: the same probes and draft, its spec quote following the spec.
 * @param {string | null} choice
 * @param {(t: Awaited<ReturnType<typeof judgedTask>>) => Promise<void>} change
 */
async function returnedThenAgain(choice, change) {
  const t = await judgedTask();
  const returned = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q3: { ...REVERT_Q3.q3, ...(choice ? { spec: choice } : {}) } } });
  const paths = taskPaths(t.home, t.taskId);
  const oldDraft = JSON.parse(await readFile(path.join(paths.approvals, `${returned.id}.draft.json`), 'utf8'));
  const probeSpec = JSON.parse(await readFile(path.join(paths.probes, 'spec.json'), 'utf8'));
  await change(t);
  const prepared = /** @type {any} */ (await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] }));
  const probes = /** @type {any} */ (await runProbes({ home: t.home, taskId: t.taskId, spec: probeSpec }));
  const specLine = (await readFile(path.join(t.repo.dir, SPEC), 'utf8')).split('\n')[2];
  const draft = { ...oldDraft, inputSourceHash: prepared.source.hash, probeSetHash: probes.probeSetHash };
  for (const q of draft.questions) for (const s of q.sources ?? []) {
    delete s.sha256;
    s.quote = specLine;
  }
  await writeFile(paths.draft, JSON.stringify(draft));
  const submitted = await submitDraft({ home: t.home, taskId: t.taskId }).catch((/** @type {any} */ e) => e);
  return { ...t, returned, prepared, submitted, paths, sourceHash: prepared.source.hash };
}

test('a sent-back question citing the spec needs a spec choice; the choice and the cited lines are signed and passed on', async () => {
  const t = await judgedTask();
  const view = /** @type {any} */ (await judgeView({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(view.specs, [SPEC]);
  assert.equal(view.specAfterMergeDefault, 'delete');
  assert.deepEqual(view.questions.map((/** @type {any} */ q) => [q.id, q.citesSpec]), [['q1', false], ['q2', false], ['q3', true], ['q4', false]]);

  const missing = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: REVERT_Q3 }).catch((e) => e.message);
  assert.match(missing, /q3: spec을 인용한 질문을 되돌리거나 분리할 때는 spec 처리\(spec-wrong, defer, snapshot\)를 골라야 함/);
  const misplaced = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { ...REVERT_Q3, q3: { verdict: 'as-expected', spec: 'defer' } } }).catch((e) => e.message);
  assert.match(misplaced, /q3: spec 처리는 spec을 인용한 질문을 되돌리거나 분리할 때만 고름/);

  const returned = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q3: { ...REVERT_Q3.q3, spec: 'spec-wrong' } } });
  assert.equal(returned.outcome, 'returned');
  assert.equal(returned.specAfterMerge, undefined);
  const q3 = returned.items.find((/** @type {any} */ i) => i.id === 'q3');
  assert.equal(q3.spec.choice, 'spec-wrong');
  assert.deepEqual(q3.spec.parts.map((/** @type {any} */ p) => [p.ref, p.lines, p.block]), [[SPEC, [3, 3], '할인 경계를 100개로 바꾼다.']]);
  const event = (await readEvents(taskPaths(t.home, t.taskId).events)).filter((e) => e.type === 'returned').at(-1);
  assert.deepEqual(/** @type {any} */ (event).items, [{ id: 'q3', verdict: 'revert', reason: '경계는 10개로 둔다', spec: 'spec-wrong' }]);

  await t.repo.write('src/cart.mjs', 'export const total = ({ qty, unit }) => (qty >= 10 ? qty * unit * 0.9 : qty * unit);\n');
  const prepared = /** @type {any} */ (await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] }));
  assert.deepEqual(prepared.previousJudgment.returned[0].spec, { choice: 'spec-wrong', parts: [{ ref: SPEC, lines: [3, 3], quote: '할인 경계를 100개로 바꾼다.' }] });
});

test("'spec이 틀렸다' with the cited line left as it was: the next handoff is refused", async () => {
  const r = await returnedThenAgain('spec-wrong', async (t) => {
    await t.repo.write('src/cart.mjs', 'export const total = ({ qty, unit }) => qty * unit;\n');
  });
  assert.equal(r.submitted.code, 'E_VERIFY');
  assert.match(r.submitted.message, new RegExp(`spec ${SPEC}:3-3: 판정 ${r.returned.id}에서 q3을\\(를\\) 되돌리며 'spec이 틀렸다'를 골랐는데 인용한 줄이 그대로임`));
});

test("'미룬다' with text added to the cited line itself: the line counts as changed", async () => {
  const r = await returnedThenAgain('defer', async (t) => {
    await t.repo.write(SPEC, '# cart\n\n할인 경계를 100개로 바꾼다. 보류: #12\n');
  });
  assert.ok(!(r.submitted instanceof Error), r.submitted?.message);
  assert.equal(r.submitted.state, 'awaiting_approval');
});

test("'미룬다' with a marker added only next to the cited line: still refused", async () => {
  const r = await returnedThenAgain('defer', async (t) => {
    await t.repo.write(SPEC, '# cart\n\n할인 경계를 100개로 바꾼다.\n보류: #12\n');
  });
  assert.equal(r.submitted.code, 'E_VERIFY');
  assert.match(r.submitted.message, /'미룬다'를 골랐는데 인용한 줄이 그대로임/);
});

test("'spec은 스냅샷': the spec stays, the handoff goes through and the PR paragraph says the part is not implemented", async () => {
  const r = await returnedThenAgain('snapshot', async (t) => {
    await t.repo.write('src/label.mjs', "export const label = 'v2';\n");
  });
  assert.ok(!(r.submitted instanceof Error), r.submitted?.message);
  const accepted = await judge({ home: r.home, taskId: r.taskId, sourceHash: r.sourceHash });
  assert.equal(accepted.outcome, 'accepted');
  const body = path.join(await tempDir('body'), 'body.md');
  const written = await writePrBody({ home: r.home, taskId: r.taskId, bodyFile: body });
  assert.match(written.section, new RegExp(`- spec \`${SPEC}:3-3\` "할인 경계를 100개로 바꾼다\\.": 구현하지 않음\\. spec은 작성 시점의 스냅샷이라 고치지 않음\\. 이유: "경계는 10개로 둔다"`));
  assert.match(written.section, new RegExp(`- spec \`${SPEC}\`: 머지 뒤 삭제\\(git 이력과 이 PR에 남음\\)\\.`));
});

test('lifetime: the default deletes the spec on apply, without making the judgment stale', async () => {
  const t = await judgedTask();
  const accepted = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash });
  assert.deepEqual(accepted.specAfterMerge, { action: 'delete', specs: [SPEC] });
  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(applied.spec, { action: 'delete', specs: [{ ref: SPEC, status: 'deleted' }], pending: false });
  assert.deepEqual(applied.removed, [SPEC]);
  assert.equal(await exists(path.join(t.repo.dir, SPEC)), false);
  assert.match(t.repo.git('status', '--porcelain'), new RegExp(`^D  ${SPEC}`, 'm'));
  assert.equal(applied.status.reason, null);
  const again = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(again.spec.specs, [{ ref: SPEC, status: 'deleted' }]);
});

test('lifetime: archive moves the spec; a spec with uncommitted changes waits for a commit', async () => {
  const t = await judgedTask({ commit: false });
  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, lifetime: { action: 'archive' } });
  assert.deepEqual(judgment.specAfterMerge, { action: 'archive', specs: [SPEC] });
  const first = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(first.spec, { action: 'archive', specs: [{ ref: SPEC, status: 'uncommitted' }], pending: true });
  assert.equal(await exists(path.join(t.repo.dir, SPEC)), true);
  t.repo.commitAll('work');
  const second = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(second.spec.specs, [{ ref: SPEC, status: 'archived', to: 'docs/specs/archive/cart.md' }]);
  assert.deepEqual(second.files, ['docs/specs/archive/cart.md']);
  assert.equal(await exists(path.join(t.repo.dir, 'docs/specs/archive/cart.md')), true);
  assert.equal(await exists(path.join(t.repo.dir, SPEC)), false);
});

test('lifetime: keep needs an owner; a returned judgment takes no lifetime; the project default applies', async () => {
  const t = await judgedTask();
  const noOwner = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, lifetime: { action: 'keep' } }).catch((e) => e.message);
  assert.match(noOwner, /spec을 유지하려면 소유자\(owner\)를 적어야 함/);
  const onReturn = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q1: { verdict: 'revert', reason: '틀림' } }, lifetime: { action: 'delete' } }).catch((e) => e.message);
  assert.match(onReturn, /spec 수명은 모든 질문을 수용할 때만 고름/);
  const kept = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, lifetime: { action: 'keep', owner: '결제팀' } });
  assert.deepEqual(kept.specAfterMerge, { action: 'keep', specs: [SPEC], owner: '결제팀' });
  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(applied.spec, { action: 'keep', owner: '결제팀', specs: [{ ref: SPEC, status: 'kept' }], pending: false });

  const u = await judgedTask({ config: { schemaVersion: 1, spec: { afterMerge: 'archive' } } });
  const view = /** @type {any} */ (await judgeView({ home: u.home, taskId: u.taskId }));
  assert.equal(view.specAfterMergeDefault, 'archive');
  const byDefault = await judge({ home: u.home, taskId: u.taskId, sourceHash: u.sourceHash });
  assert.equal(byDefault.specAfterMerge?.action, 'archive');
});
