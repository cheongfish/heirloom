// Decision records since the pivot (pivot 7): a fork answer the person keeps in the repository
// becomes a record with anchors, at least one of them a test that locks it; a record can be
// replaced by a new one or retired, and both remove the old file in the same PR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { judge, judgedTask } from '../helpers/judge-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { applyApproval } from '../../skills/using-heirloom/lib/apply.mjs';
import { writePrBody } from '../../skills/using-heirloom/lib/judgment-pr.mjs';
import { recall } from '../../skills/using-heirloom/lib/recall.mjs';
import { readRecords, serializeRecord } from '../../skills/using-heirloom/lib/records.mjs';

/** A test that passes on base and head, so it can anchor a decision. */
const SMALL_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('small orders pay full price', () => {
  assert.equal(total({ qty: 5, unit: 10 }), 50);
});
`;
const ANCHORS = [
  { file: 'src/cart.mjs', symbol: 'total' },
  { file: 'test/small.test.mjs', test: 'small orders pay full price' },
];
/** The same anchors as a draft writes them: the test anchor says in plain words what it asserts. */
const DRAFT_ANCHORS = ANCHORS.map((a) => ('test' in a ? { ...a, plain: '5개 구매는 정가로 결제된다' } : a));
const OLD_ID = 'd-aaaaaaaa';
/** A schema 2 record already on the target branch. */
const OLD_RECORD = serializeRecord({
  meta: /** @type {any} */ ({
    schemaVersion: 2,
    id: OLD_ID,
    kind: 'decision',
    choice: '할인 경계는 10개다',
    question: '할인 경계는?',
    scope: ['src/cart.mjs'],
    anchors: ANCHORS,
    source: [{ kind: 'fork-answer', approval: 'ap-aaaaaaaaaaaa', question: 'q4' }],
    replaces: null,
    taskId: 't-20260101-aaaaaaaa',
    approval: { id: 'ap-aaaaaaaaaaaa', signer: 'x', approvedAt: '2026-01-01T00:00:00.000Z' },
  }),
  body: '\n## 질문\n\n할인 경계는?\n',
});

/** @param {string} p */
const exists = (p) => access(p).then(() => true, () => false);

/** @param {(fork: any) => void} edit */
const withFork = (edit) => ({
  baseFiles: { 'test/small.test.mjs': SMALL_TEST, [`.heirloom/decisions/${OLD_ID}.md`]: OLD_RECORD },
  editDraft: (/** @type {any} */ d) => edit(d.questions.find((/** @type {any} */ q) => q.kind === 'fork')),
});

test('a decision proposal is checked against the repository and the recorded test run', async () => {
  const refused = await judgedTask(
    withFork((q) => {
      q.decision = {
        scope: ['src/nowhere/**'],
        anchors: [
          { file: 'src/cart.mjs', symbol: 'totals' },
          { file: 'test/cart.test.mjs', test: 'bulk discount for 12' },
          { file: 'test/small.test.mjs', test: 'no such test' },
          { file: 'src/missing.mjs', symbol: 'x' },
        ],
        replaces: 'd-bbbbbbbb',
      };
    }),
  ).catch((e) => e);
  assert.equal(refused.code, 'E_VERIFY');
  const at = '$.questions[3].decision';
  for (const m of [
    `${at}.scope[0]: 저장소에 맞는 파일이 없음 (src/nowhere/**)`,
    `${at}.anchors[0].symbol: src/cart.mjs에 없는 이름 (totals)`,
    `${at}.anchors[1].test: head에서 통과하지 않은 테스트 (bulk discount for 12: fail)`,
    `${at}.anchors[2].test: head 테스트 결과에 없는 테스트 (no such test)`,
    `${at}.anchors[3].file: 저장소에 없는 파일 (src/missing.mjs)`,
    `${at}.replaces: 저장소에 없는 결정 기록 (d-bbbbbbbb)`,
  ]) assert.ok(refused.message.includes(m), `${m}\n${refused.message}`);

  const noTest = await judgedTask(withFork((q) => { q.decision = { scope: ['src/cart.mjs'], anchors: [ANCHORS[0]] }; })).catch((e) => e);
  assert.match(noTest.message, /결정을 잠그는 테스트 앵커\(\{ file, test \}\)가 하나 이상 필요함/);
});

test('keeping a fork answer in the repository writes a record that replaces the old one', async () => {
  const t = await judgedTask(withFork((q) => { q.decision = { scope: ['src/cart.mjs'], anchors: DRAFT_ANCHORS, replaces: OLD_ID }; }));
  const bad = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q3: { verdict: 'as-expected', keep: 'repo' } } }).catch((e) => e.message);
  assert.match(bad, /q3: 저장소에 남기거나 기록을 지우는 것은 답한 열린 선택에서만 고름/);
  const retireBad = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q4: { verdict: 'answered', answer: '100으로 한다', keep: 'retire' } } }).catch((e) => e.message);
  assert.match(retireBad, /q4: 지울 결정 기록\(retires\)을 묻는 질문이 아님/);

  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q4: { verdict: 'answered', answer: '100개부터 할인한다', keep: 'repo' } } });
  const item = judgment.items.find((/** @type {any} */ i) => i.id === 'q4');
  assert.equal(item.keep.action, 'record');
  assert.match(item.keep.id, /^d-[0-9a-z]{8}$/);

  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  const file = `.heirloom/decisions/${item.keep.id}.md`;
  assert.deepEqual(applied.files, [file]);
  assert.ok(applied.removed.includes(`.heirloom/decisions/${OLD_ID}.md`));
  assert.equal(await exists(path.join(t.repo.dir, '.heirloom/decisions', `${OLD_ID}.md`)), false);
  const { decisions, errors } = await readRecords(t.repo.dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(decisions.map((d) => d.meta.id), [item.keep.id]);
  const meta = decisions[0].meta;
  assert.equal(meta.choice, '100개부터 할인한다');
  assert.equal(meta.question, '경계를 100으로 할까요, 50으로 할까요?');
  assert.deepEqual(meta.anchors, ANCHORS, 'the record keeps where the decision is held, not the plain words of the draft');
  assert.equal(meta.replaces, OLD_ID);
  assert.deepEqual(meta.source, [{ kind: 'fork-answer', approval: judgment.id, question: 'q4' }]);
  assert.match(await readFile(path.join(t.repo.dir, file), 'utf8'), /## 사람의 답 \(원문\)\n\n"100개부터 할인한다"/);

  const body = path.join(await tempDir('body'), 'body.md');
  const written = await writePrBody({ home: t.home, taskId: t.taskId, bodyFile: body });
  assert.match(written.section, new RegExp(`- 결정: .*"100개부터 할인한다" \\(저장소에 결정 기록 ${item.keep.id}로 남김, ${OLD_ID} 대체\\)`));
});

test('retiring a record removes it; an answer kept in the PR only writes nothing', async () => {
  const t = await judgedTask(withFork((q) => { q.retires = OLD_ID; }));
  const keepBad = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q4: { verdict: 'answered', answer: 'x', keep: 'repo' } } }).catch((e) => e.message);
  assert.match(keepBad, /q4: 에이전트가 결정 기록안\(decision\)을 붙이지 않은 질문은 저장소에 남길 수 없음/);
  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q4: { verdict: 'answered', answer: '이제 경계는 100개다', keep: 'retire' } } });
  assert.deepEqual(judgment.items.find((/** @type {any} */ i) => i.id === 'q4').keep, { action: 'retire', id: OLD_ID });
  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(applied.files, []);
  assert.ok(applied.removed.includes(`.heirloom/decisions/${OLD_ID}.md`));
  assert.equal(await exists(path.join(t.repo.dir, '.heirloom/decisions', `${OLD_ID}.md`)), false);

  const u = await judgedTask(withFork((q) => { q.decision = { scope: ['src/cart.mjs'], anchors: ANCHORS }; }));
  await judge({ home: u.home, taskId: u.taskId, sourceHash: u.sourceHash });
  const plain = /** @type {any} */ (await applyApproval({ home: u.home, taskId: u.taskId }));
  assert.deepEqual(plain.files, []);
  assert.equal((await readRecords(u.repo.dir)).decisions.length, 1, 'only the record of the target branch');
});

test('recall: a record this task retires is no longer served to it; another branch sees the unmerged change as pending', async () => {
  const t = await judgedTask(withFork((q) => { q.decision = { scope: ['src/cart.mjs'], anchors: ANCHORS, replaces: OLD_ID }; }));
  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts: { q4: { verdict: 'answered', answer: '100개부터 할인한다', keep: 'repo' } } });
  const id = judgment.items.find((/** @type {any} */ i) => i.id === 'q4').keep.id;
  await applyApproval({ home: t.home, taskId: t.taskId });
  const own = await recall({ cwd: t.repo.dir, home: t.home, paths: ['src/cart.mjs'] });
  assert.deepEqual(own.records.map((r) => [r.id, r.status]), [[id, 'pending']]);

  t.repo.commitAll('records');
  t.repo.git('checkout', '-q', '-b', 'other', 'origin/main');
  const other = await recall({ cwd: t.repo.dir, home: t.home, paths: ['src/cart.mjs'] });
  assert.deepEqual(other.records.map((r) => [r.id, r.status]), [[OLD_ID, 'active']]);
  assert.deepEqual(other.pendingWarnings.map((w) => [w.id, w.change, w.seenIn, w.by]).sort(), [[OLD_ID, 'retire', 'task', id], [id, 'add', 'task', null]].sort());
});
