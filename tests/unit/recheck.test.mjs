// Incremental recheck after approval (PLAN 13, 5.2; PHASE3-PLAN 5.2-5.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  affectedItems,
  buildBaseline,
  carriedItems,
  checkRecheckDraft,
  diffStates,
} from '../../skills/using-heirloom/lib/recheck.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const MB1 = '1'.repeat(40);
const MB2 = '2'.repeat(40);

/** @param {[string, string][]} entries path, sha */
const files = (entries) => entries.map(([path, sha256]) => ({ path, status: /** @type {'M'} */ ('M'), sha256 }));

const src = (ref = 'docs/spec.md') => ({ ref, lines: [1, 1], quote: 'q', sha256: A });

const addOp = (/** @type {Record<string, unknown>} */ over = {}) => ({
  op: 'add',
  id: 'd-aaaaaaaa',
  kind: 'decision',
  title: '결정',
  body: { problem: 'p', choice: 'c', alternatives: '', scope: '' },
  codePaths: ['src/a.mjs'],
  topics: [],
  sources: [src()],
  ...over,
});

// ------------------------------------------------------------------ diffStates

test('diffStates: committing the same content is no change', () => {
  const before = { files: files([['src/a.mjs', A]]), mergeBase: MB1, materials: { 'docs/spec.md': A } };
  const after = { files: files([['src/a.mjs', A]]), mergeBase: MB1, materials: { 'docs/spec.md': A } };
  assert.deepEqual(diffStates({ before, after }), { mergeBaseChanged: false, changes: [], materials: [] });
});

test('diffStates: edited, added and removed files; changed and dropped materials', () => {
  const before = { files: files([['src/a.mjs', A], ['src/gone.mjs', A]]), mergeBase: MB1, materials: { 'docs/spec.md': A, 'docs/review.md': A } };
  const after = { files: files([['src/a.mjs', B], ['src/new.mjs', C]]), mergeBase: MB1, materials: { 'docs/spec.md': B } };
  const d = diffStates({ before, after });
  assert.equal(d.mergeBaseChanged, false);
  assert.deepEqual(d.changes, [
    { path: 'src/a.mjs', before: A, after: B, reason: 'edited' },
    { path: 'src/gone.mjs', before: A, after: null, reason: 'removed' },
    { path: 'src/new.mjs', before: null, after: C, reason: 'added' },
  ]);
  assert.deepEqual(d.materials, [
    { ref: 'docs/review.md', before: A, after: null },
    { ref: 'docs/spec.md', before: A, after: B },
  ]);
});

test('diffStates: after a rebase a changed task file is a base update; untouched files are not compared', () => {
  const before = { files: files([['src/a.mjs', A], ['src/b.mjs', A]]), mergeBase: MB1, materials: {} };
  // The new diff only holds the task's own changes against the new merge-base.
  const after = { files: files([['src/a.mjs', B], ['src/b.mjs', A]]), mergeBase: MB2, materials: {} };
  const d = diffStates({ before, after });
  assert.equal(d.mergeBaseChanged, true);
  assert.deepEqual(d.changes, [{ path: 'src/a.mjs', before: A, after: B, reason: 'base_updated' }]);
});

test('diffStates: after a rebase only files the target branch also changed are base updates', () => {
  const before = { files: files([['src/a.mjs', A], ['src/b.mjs', A]]), mergeBase: MB1, materials: {} };
  const after = { files: files([['src/a.mjs', B], ['src/b.mjs', B]]), mergeBase: MB2, materials: {} };
  // src/a.mjs changed between the two merge-bases; src/b.mjs was edited by the task alone.
  const d = diffStates({ before, after, baseChanged: new Set(['src/a.mjs']) });
  assert.deepEqual(
    d.changes.map((c) => [c.path, c.reason]),
    [
      ['src/a.mjs', 'base_updated'],
      ['src/b.mjs', 'edited'],
    ],
  );
  // Without the list (the old merge-base is gone) every changed file stays a base update.
  assert.deepEqual(
    diffStates({ before, after }).changes.map((c) => c.reason),
    ['base_updated', 'base_updated'],
  );
});

// ------------------------------------------------------------------ buildBaseline

test('buildBaseline: final summary with linked code paths, edits applied, rejected dropped, pending kept', () => {
  const draft = {
    summary: [
      { text: '초안 1', codePaths: ['src/a.mjs'] },
      { text: '초안 2', codePaths: ['src/b.mjs'] },
    ],
    records: [
      addOp({ id: 'd-aaaaaaaa', baseIndex: 4 }),
      addOp({ id: 'd-bbbbbbbb', title: '거절됨' }),
      { op: 'supersede', target: 'd-cccccccc', reason: 'r', with: 0 },
      { op: 'deprecate', target: 'd-dddddddd', reason: 'r', sources: [] },
    ],
  };
  const approval = {
    summary: { initial: ['초안 1', '초안 2'], final: ['고친 1', '사람이 더함'], origins: [0, null] },
    items: [
      { index: 0, decision: 'approved', edited: { title: '고친 제목', body: { problem: 'p2', choice: 'c2', alternatives: '', scope: '' } } },
      { index: 1, decision: 'rejected' },
      { index: 2, decision: 'approved' },
      { index: 3, decision: 'pending' },
    ],
  };
  const b = buildBaseline({ draft, approval });
  assert.deepEqual(b.summary, [
    { text: '고친 1', codePaths: ['src/a.mjs'] },
    { text: '사람이 더함', codePaths: [] },
  ]);
  assert.equal(b.records.length, 3);
  assert.equal(b.records[0].title, '고친 제목');
  assert.equal(b.records[0].body.problem, 'p2');
  assert.equal('baseIndex' in b.records[0], false, 'baseIndex of an older round is dropped');
  assert.deepEqual(b.records[1], { op: 'supersede', target: 'd-cccccccc', reason: 'r', with: 0 });
  assert.equal(b.records[2].op, 'deprecate');
  assert.deepEqual(b.pending, [2]);
});

test('buildBaseline: without origins the summary pairs by position only when the counts match', () => {
  const draft = { summary: [{ text: 'x', codePaths: ['src/a.mjs'] }], records: [] };
  assert.deepEqual(buildBaseline({ draft, approval: { summary: { initial: ['x'], final: ['y'] }, items: [] } }).summary, [{ text: 'y', codePaths: ['src/a.mjs'] }]);
  assert.deepEqual(buildBaseline({ draft, approval: { summary: { initial: ['x'], final: ['y', 'z'] }, items: [] } }).summary, [
    { text: 'y', codePaths: [] },
    { text: 'z', codePaths: [] },
  ]);
});

test('buildBaseline: a supersede whose replacement was rejected is dropped', () => {
  const draft = { summary: [], records: [addOp(), { op: 'supersede', target: 'd-cccccccc', reason: 'r', with: 0 }] };
  const approval = { summary: { initial: [], final: ['s'] }, items: [{ index: 0, decision: 'rejected' }, { index: 1, decision: 'pending' }] };
  assert.deepEqual(buildBaseline({ draft, approval }).records, []);
});

// ------------------------------------------------------------------ affectedItems

const baseline = () => ({
  summary: [
    { text: 'a 바꿈', codePaths: ['src/a.mjs'] },
    { text: 'lib 정리', codePaths: ['lib/**'] },
  ],
  records: [
    addOp({ id: 'd-aaaaaaaa', codePaths: ['src/a.mjs'], sources: [src('docs/spec.md')] }),
    addOp({ id: 'd-bbbbbbbb', codePaths: ['lib/x.mjs'], sources: [src('docs/other.md')] }),
    { op: 'supersede', target: 'd-cccccccc', reason: 'r', with: 0 },
  ],
  pending: /** @type {number[]} */ ([]),
});

test('affectedItems: code path matches select bullets and records; a supersede follows its replacement', () => {
  const changes = [{ path: 'src/a.mjs', before: A, after: B, reason: 'edited' }];
  const out = affectedItems({ baseline: baseline(), changes, materials: [] });
  assert.deepEqual(out.summary, [{ index: 0, reasons: ['src/a.mjs'] }]);
  assert.deepEqual(out.records, [
    { index: 0, reasons: ['src/a.mjs'] },
    { index: 2, reasons: ['with:0'] },
  ]);
  assert.deepEqual(out.unlinked, []);
});

test('affectedItems: globs match; a changed material affects only the records citing it', () => {
  const out = affectedItems({
    baseline: baseline(),
    changes: [{ path: 'lib/deep/y.mjs', before: A, after: B, reason: 'edited' }],
    materials: [{ ref: 'docs/other.md', before: A, after: B }],
  });
  assert.deepEqual(out.summary, [{ index: 1, reasons: ['lib/deep/y.mjs'] }]);
  assert.deepEqual(out.records, [{ index: 1, reasons: ['material:docs/other.md'] }]);
  assert.deepEqual(out.unlinked, []);
});

test('affectedItems: a change linked to nothing is unlinked and puts the whole summary up for recheck', () => {
  const out = affectedItems({ baseline: baseline(), changes: [{ path: 'src/new.mjs', before: null, after: C, reason: 'added' }], materials: [] });
  assert.deepEqual(out.unlinked, ['src/new.mjs']);
  assert.deepEqual(out.summary, [
    { index: 0, reasons: ['unlinked'] },
    { index: 1, reasons: ['unlinked'] },
  ]);
  assert.deepEqual(out.records, []);
});

test('affectedItems: an unlinked change adds its reason to bullets that were already hit', () => {
  const out = affectedItems({
    baseline: baseline(),
    changes: [
      { path: 'src/a.mjs', before: A, after: B, reason: 'edited' },
      { path: 'src/new.mjs', before: null, after: C, reason: 'added' },
    ],
    materials: [],
  });
  assert.deepEqual(out.summary, [
    { index: 0, reasons: ['src/a.mjs', 'unlinked'] },
    { index: 1, reasons: ['unlinked'] },
  ]);
});

test('affectedItems: a cited source file that changed is linked; pending records are presented again', () => {
  const b = baseline();
  b.pending = [1];
  const out = affectedItems({ baseline: b, changes: [{ path: 'docs/spec.md', before: A, after: B, reason: 'edited' }], materials: [] });
  assert.deepEqual(out.unlinked, []);
  assert.deepEqual(out.records, [
    { index: 0, reasons: ['docs/spec.md'] },
    { index: 1, reasons: ['pending'] },
    { index: 2, reasons: ['with:0'] },
  ]);
});

// ------------------------------------------------------------------ draft rules

/** @param {{ summary?: number[], records?: number[] }} affected */
const recheckOf = (affected) => {
  const b = baseline();
  return {
    affected: {
      summary: (affected.summary ?? []).map((index) => ({ index, reasons: ['x'] })),
      records: (affected.records ?? []).map((index) => ({ index, reasons: ['x'] })),
      unlinked: [],
    },
    baseline: { summary: b.summary, records: b.records },
  };
};

/** A draft that copies the baseline and marks every item with its baseIndex. */
const copyDraft = () => {
  const b = baseline();
  return {
    summary: b.summary.map((s, i) => ({ ...s, baseIndex: i })),
    records: b.records.map((r, i) => ({ ...structuredClone(r), baseIndex: i })),
  };
};

test('checkRecheckDraft: a faithful copy passes; carried items are the unaffected ones', () => {
  const recheck = recheckOf({ summary: [0], records: [0, 2] });
  const draft = copyDraft();
  draft.summary[0].text = 'a를 다시 바꿈';
  assert.deepEqual(checkRecheckDraft({ recheck, draft }), []);
  assert.deepEqual(carriedItems({ recheck, draft }), { summary: [1], records: [1] });
});

test('checkRecheckDraft: a source sha256 refilled by the check does not count as a change', () => {
  const recheck = recheckOf({});
  const draft = copyDraft();
  /** @type {any} */ (draft.records[1]).sources[0].sha256 = B;
  assert.deepEqual(checkRecheckDraft({ recheck, draft }), []);
});

test('checkRecheckDraft: changing or dropping an unaffected item is an error', () => {
  const recheck = recheckOf({ records: [0] });
  const changed = copyDraft();
  changed.summary[1].text = '몰래 고침';
  /** @type {any} */ (changed.records[1]).title = '몰래 고침';
  const errors = checkRecheckDraft({ recheck, draft: changed });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /summary.*baseline 1/);
  assert.match(errors[1], /records.*baseline 1/);

  const dropped = copyDraft();
  dropped.summary.splice(1, 1);
  assert.match(checkRecheckDraft({ recheck, draft: dropped }).join('\n'), /baseline 요약 1.*빠짐/);
});

test('checkRecheckDraft: an affected item may be dropped or rewritten; an extra with a reason is not carried', () => {
  const recheck = recheckOf({ summary: [0], records: [0, 2] });
  const draft = /** @type {any} */ (copyDraft());
  draft.summary.splice(0, 1);
  draft.records = [draft.records[1]];
  draft.recheck = { extra: [{ kind: 'record', baseIndex: 1, reason: '의미상 관련이 불확실함' }] };
  assert.deepEqual(checkRecheckDraft({ recheck, draft }), []);
  assert.deepEqual(carriedItems({ recheck, draft }), { summary: [0], records: [] });
});

test('checkRecheckDraft: a supersede keeps pointing at the same replacement after reordering', () => {
  const recheck = recheckOf({});
  const draft = copyDraft();
  draft.records = [draft.records[2], draft.records[1], draft.records[0]];
  /** @type {any} */ (draft.records[0]).with = 2;
  assert.deepEqual(checkRecheckDraft({ recheck, draft }), []);
  /** @type {any} */ (draft.records[0]).with = 1;
  assert.match(checkRecheckDraft({ recheck, draft }).join('\n'), /records.*baseline 2/);
});

test('checkRecheckDraft: duplicate or out-of-range baseIndex and bad extras are errors', () => {
  const recheck = recheckOf({});
  const dup = copyDraft();
  dup.summary.push({ ...dup.summary[0] });
  assert.match(checkRecheckDraft({ recheck, draft: dup }).join('\n'), /baseIndex 0.*중복/);

  const range = copyDraft();
  range.records[0].baseIndex = 9;
  assert.match(checkRecheckDraft({ recheck, draft: range }).join('\n'), /baseIndex 9.*범위/);

  const extra = /** @type {any} */ (copyDraft());
  extra.recheck = { extra: [{ kind: 'summary', baseIndex: 7, reason: 'r' }] };
  assert.match(checkRecheckDraft({ recheck, draft: extra }).join('\n'), /extra\[0\].*범위/);
});
