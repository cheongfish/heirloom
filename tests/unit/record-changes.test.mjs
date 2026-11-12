// Turning a verified approval into record file changes (PLAN 14.2, MVP-PLAN 5.1, M5).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planRecordChanges, replaceSection } from '../../skills/using-heirloom/lib/record-changes.mjs';
import { recordMetaSchema, validate } from '../../skills/using-heirloom/lib/schema.mjs';
import { renderBody } from '../../skills/using-heirloom/lib/records.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';

const TASK = 't-20261113-aaaaaaaa';
const OLD_TASK = 't-20261101-bbbbbbbb';
const SHA = 'a'.repeat(64);
const src = { ref: 'docs/specs/x.md', lines: /** @type {[number, number]} */ ([1, 1]), quote: 'q', sha256: SHA };

/** @param {Partial<import('../../skills/using-heirloom/lib/records.mjs').RecordMeta>} [over] */
function existing(over = {}) {
  /** @type {import('../../skills/using-heirloom/lib/records.mjs').RecordMeta} */
  const meta = {
    schemaVersion: 1,
    id: 'd-0dd0dd0d',
    kind: 'decision',
    title: '예전 결정',
    active: true,
    codePaths: ['src/a.mjs'],
    topics: ['old'],
    supersedes: [],
    supersededBy: null,
    relations: [],
    sources: [src],
    taskId: OLD_TASK,
    approval: { id: 'ap-0dd0dd0dd0dd', signer: 'SHA256:old', approvedAt: '2026-11-01T00:00:00.000Z' },
    ...over,
  };
  return { meta, body: renderBody(meta.kind, { problem: '예전 문제', choice: '예전 선택', alternatives: '', scope: '' }) };
}

const add = (/** @type {Record<string, unknown>} */ over = {}) => ({
  op: 'add',
  kind: 'decision',
  id: 'd-newnewne',
  title: '새 결정',
  body: { problem: 'p', choice: 'c', alternatives: 'a', scope: 's' },
  codePaths: ['src/b.mjs'],
  topics: ['t'],
  sources: [src],
  ...over,
});

/** @param {any[]} records @param {any[]} items */
function approval(records, items) {
  return {
    draft: { records },
    approval: {
      id: 'ap-newnewnewnew',
      taskId: TASK,
      approver: { fingerprint: 'SHA256:new', gitUser: 'Test <t@example.invalid>' },
      approvedAt: '2026-11-13T00:00:00.000Z',
      items,
    },
  };
}

/** @param {ReturnType<typeof planRecordChanges>} plan @param {string} id */
const byId = (plan, id) => plan.writes.find((w) => w.meta.id === id);

test('approved add becomes an active record signed by this approval; rejected and pending write nothing', () => {
  const { draft, approval: a } = approval(
    [add(), add({ id: 'd-rejected', title: '거절' }), add({ id: 'd-pendng00', title: '보류' })],
    [
      { index: 0, decision: 'approved' },
      { index: 1, decision: 'rejected' },
      { index: 2, decision: 'pending' },
    ],
  );
  const plan = planRecordChanges({ draft, approval: a, existing: new Map() });
  assert.deepEqual(plan.writes.map((w) => w.meta.id), ['d-newnewne']);
  const rec = plan.writes[0];
  assert.deepEqual(validate(recordMetaSchema, rec.meta), []);
  assert.equal(rec.meta.active, true);
  assert.equal(rec.meta.taskId, TASK);
  assert.deepEqual(rec.meta.approval, { id: 'ap-newnewnewnew', signer: 'SHA256:new', approvedAt: '2026-11-13T00:00:00.000Z' });
  assert.equal(rec.body, renderBody('decision', { problem: 'p', choice: 'c', alternatives: 'a', scope: 's' }));
});

test('human edits to title and body win over the draft', () => {
  const { draft, approval: a } = approval([add()], [
    { index: 0, decision: 'approved', edited: { title: '사람이 고친 제목', body: { problem: '고친 문제', choice: 'c', alternatives: 'a', scope: 's' } } },
  ]);
  const rec = planRecordChanges({ draft, approval: a, existing: new Map() }).writes[0];
  assert.equal(rec.meta.title, '사람이 고친 제목');
  assert.match(rec.body, /## 문제\n\n고친 문제\n/);
});

test('supersede: old record inactive with supersededBy, new record lists what it supersedes', () => {
  const old = existing();
  const { draft, approval: a } = approval(
    [add(), { op: 'supersede', target: 'd-0dd0dd0d', reason: '정책이 바뀜', with: 0 }],
    [
      { index: 0, decision: 'approved' },
      { index: 1, decision: 'approved' },
    ],
  );
  const plan = planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) });
  const oldOut = byId(plan, 'd-0dd0dd0d');
  const newOut = byId(plan, 'd-newnewne');
  assert.equal(oldOut?.meta.active, false);
  assert.equal(oldOut?.meta.supersededBy, 'd-newnewne');
  assert.equal(oldOut?.body, old.body, 'the old body is kept');
  assert.deepEqual(newOut?.meta.supersedes, [{ id: 'd-0dd0dd0d', reason: '정책이 바뀜' }]);
  for (const w of plan.writes) assert.deepEqual(validate(recordMetaSchema, w.meta), []);
});

test('a rejected supersede leaves the old record alone even if the new record is approved', () => {
  const old = existing();
  const { draft, approval: a } = approval(
    [add(), { op: 'supersede', target: 'd-0dd0dd0d', reason: 'r', with: 0 }],
    [
      { index: 0, decision: 'approved' },
      { index: 1, decision: 'rejected' },
    ],
  );
  const plan = planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) });
  assert.deepEqual(plan.writes.map((w) => w.meta.id), ['d-newnewne']);
  assert.deepEqual(byId(plan, 'd-newnewne')?.meta.supersedes, []);
});

test('deprecate: inactive with a deprecation note; the file is kept', () => {
  const old = existing();
  const { draft, approval: a } = approval([{ op: 'deprecate', target: 'd-0dd0dd0d', reason: '더 이상 쓰지 않음', sources: [] }], [{ index: 0, decision: 'approved' }]);
  const out = planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) }).writes[0];
  assert.equal(out.meta.active, false);
  assert.equal(out.meta.supersededBy, null);
  assert.deepEqual(out.meta.deprecation, {
    reason: '더 이상 쓰지 않음',
    taskId: TASK,
    approval: { id: 'ap-newnewnewnew', signer: 'SHA256:new', approvedAt: '2026-11-13T00:00:00.000Z' },
  });
  assert.deepEqual(validate(recordMetaSchema, out.meta), []);
});

test('update: changed fields only, latest approval, previous approval kept in revisions', () => {
  const old = existing();
  const { draft, approval: a } = approval(
    [{ op: 'update', target: 'd-0dd0dd0d', reason: '범위를 넓힘', sources: [src], title: '새 제목', body: { scope: '전체 모듈' }, topics: ['new'] }],
    [{ index: 0, decision: 'approved' }],
  );
  const out = planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) }).writes[0];
  assert.equal(out.meta.title, '새 제목');
  assert.deepEqual(out.meta.topics, ['new']);
  assert.deepEqual(out.meta.codePaths, ['src/a.mjs'], 'not in the update: unchanged');
  assert.equal(out.meta.taskId, OLD_TASK, 'the creating task stays');
  assert.equal(out.meta.approval.id, 'ap-newnewnewnew');
  assert.deepEqual(out.meta.revisions, [
    { approval: { id: 'ap-0dd0dd0dd0dd', signer: 'SHA256:old', approvedAt: '2026-11-01T00:00:00.000Z' }, replacedBy: 'ap-newnewnewnew', taskId: TASK, reason: '범위를 넓힘' },
  ]);
  assert.match(out.body, /## 적용 범위\n\n전체 모듈\n/);
  assert.match(out.body, /## 문제\n\n예전 문제\n/, 'other sections kept');
  assert.deepEqual(validate(recordMetaSchema, out.meta), []);
});

test('replaceSection keeps unknown sections and appends a missing one', () => {
  const body = '\n## 문제\n\n옛 문제\n\n## 사람이 추가한 절\n\n메모\n';
  assert.equal(replaceSection(body, '문제', '새 문제'), '\n## 문제\n\n새 문제\n\n## 사람이 추가한 절\n\n메모\n');
  assert.equal(replaceSection(body, '적용 범위', '전부'), `${body}\n## 적용 범위\n\n전부\n`);
});

test('missing or already inactive targets are a conflict; reapplying the same approval is idempotent', () => {
  const ops = [add(), { op: 'supersede', target: 'd-0dd0dd0d', reason: 'r', with: 0 }];
  const items = [
    { index: 0, decision: 'approved' },
    { index: 1, decision: 'approved' },
  ];
  const { draft, approval: a } = approval(ops, items);
  assert.throws(
    () => planRecordChanges({ draft, approval: a, existing: new Map() }),
    (/** @type {any} */ e) => e instanceof HeirloomError && e.code === 'E_CONFLICT' && /d-0dd0dd0d/.test(e.message),
  );
  const inactive = existing({ active: false, supersededBy: 'd-someone' });
  assert.throws(() => planRecordChanges({ draft, approval: a, existing: new Map([[inactive.meta.id, inactive]]) }), /비활성/);

  // A crash after writing: the target already points at this approval's record.
  const done = existing({ active: false, supersededBy: 'd-newnewne' });
  const plan = planRecordChanges({ draft, approval: a, existing: new Map([[done.meta.id, done]]) });
  assert.equal(byId(plan, 'd-0dd0dd0d')?.meta.supersededBy, 'd-newnewne');

  const updated = existing({ approval: { id: 'ap-newnewnewnew', signer: 'SHA256:new', approvedAt: '2026-11-13T00:00:00.000Z' } });
  const upd = approval([{ op: 'update', target: 'd-0dd0dd0d', reason: 'r', sources: [], title: 'x' }], [{ index: 0, decision: 'approved' }]);
  assert.deepEqual(planRecordChanges({ draft: upd.draft, approval: upd.approval, existing: new Map([[updated.meta.id, updated]]) }).writes, [], 'update already applied');
});

test('relate: the relation is added to the target once, as a revision signed by this approval', () => {
  const op = { op: 'relate', target: 'd-0dd0dd0d', relation: { type: 'exception', id: 'd-0ther000', condition: '환불일 때' } };
  const { draft, approval: a } = approval([op, { ...op, relation: { type: 'coexist', id: 'd-0ther111', condition: '조회만 할 때' } }], [
    { index: 0, decision: 'approved' },
    { index: 1, decision: 'approved' },
  ]);
  const old = existing();
  const plan = planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) });
  const doc = /** @type {any} */ (byId(plan, 'd-0dd0dd0d'));
  assert.deepEqual(doc.meta.relations, [
    { type: 'exception', id: 'd-0ther000', condition: '환불일 때' },
    { type: 'coexist', id: 'd-0ther111', condition: '조회만 할 때' },
  ]);
  assert.equal(doc.meta.approval.id, 'ap-newnewnewnew');
  assert.equal(doc.meta.revisions.length, 1, 'one revision per approval');
  assert.equal(doc.meta.revisions[0].approval.id, 'ap-0dd0dd0dd0dd');
  assert.equal(doc.body, old.body);
  assert.deepEqual(validate(recordMetaSchema, doc.meta), []);

  // Applying the same approval to its own output changes nothing.
  const again = planRecordChanges({ draft, approval: a, existing: new Map([[doc.meta.id, doc]]) });
  assert.deepEqual(byId(again, 'd-0dd0dd0d') ?? doc, doc);

  // A rejected relate writes nothing.
  const rejected = approval([op], [{ index: 0, decision: 'rejected' }]);
  assert.deepEqual(planRecordChanges({ draft: rejected.draft, approval: rejected.approval, existing: new Map([[old.meta.id, old]]) }).writes, []);
});

test('update and relate on the same record in one approval: both applied, one revision', () => {
  const ops = [
    { op: 'relate', target: 'd-0dd0dd0d', relation: { type: 'coexist', id: 'd-0ther000', condition: 'c' } },
    { op: 'update', target: 'd-0dd0dd0d', reason: '범위 보완', sources: [], topics: ['new'] },
  ];
  const { draft, approval: a } = approval(ops, [
    { index: 0, decision: 'approved' },
    { index: 1, decision: 'approved' },
  ]);
  const old = existing();
  const doc = /** @type {any} */ (byId(planRecordChanges({ draft, approval: a, existing: new Map([[old.meta.id, old]]) }), 'd-0dd0dd0d'));
  assert.deepEqual(doc.meta.topics, ['new']);
  assert.equal(doc.meta.relations.length, 1);
  assert.equal(doc.meta.revisions.length, 1);
  assert.equal(doc.meta.revisions[0].reason, '관계 추가: coexist d-0ther000; 범위 보완');
});
