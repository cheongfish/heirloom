// Context curation: unreviewed decisions, the notice condition, batch selection, the extra
// draft checks for candidates and the review history written to the repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURATION_DEFAULTS,
  buildCurationReview,
  checkCurationDraft,
  curationNotice,
  curationReviewId,
  parseCurationFiles,
  selectBatch,
  unreviewedDecisions,
} from '../../skills/using-heirloom/lib/curation.mjs';
import { curationReviewSchema, draftSchema, inputSchema, validate } from '../../skills/using-heirloom/lib/schema.mjs';

const DAY = 24 * 3600_000;
const T0 = Date.parse('2026-11-01T00:00:00.000Z');
const iso = (/** @type {number} */ days) => new Date(T0 + days * DAY).toISOString();

let n = 0;
/**
 * @param {Partial<import('../../skills/using-heirloom/lib/records.mjs').RecordMeta>} [over]
 * @returns {import('../../skills/using-heirloom/lib/records.mjs').RecordMeta}
 */
function meta(over = {}) {
  n += 1;
  const id = over.id ?? `d-${String(n).padStart(8, '0')}`;
  return {
    schemaVersion: 1,
    id,
    kind: id.startsWith('a-') ? 'axiom' : 'decision',
    title: `기록 ${id}`,
    active: true,
    codePaths: [],
    topics: [],
    supersedes: [],
    supersededBy: null,
    relations: [],
    sources: [],
    taskId: 't-20261101-aaaaaaaa',
    approval: { id: 'ap-aaaaaaaaaaaa', signer: 'SHA256:x', approvedAt: iso(0) },
    ...over,
  };
}

/**
 * @param {Partial<any>} [over]
 * @returns {import('../../skills/using-heirloom/lib/curation.mjs').CurationReview}
 */
function review(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-00000000',
    taskId: 't-20261101-cccccccc',
    approvalId: 'ap-cccccccccccc',
    reviewedAt: iso(5),
    batch: [],
    candidates: [],
    changes: [],
    ...over,
  };
}

test('unreviewed: active decisions in no batch of the target branch history, oldest approval first', () => {
  const a = meta({ id: 'd-0000000a', approval: { id: 'ap-aaaaaaaaaaaa', signer: 's', approvedAt: iso(3) } });
  const b = meta({ id: 'd-0000000b', approval: { id: 'ap-aaaaaaaaaaaa', signer: 's', approvedAt: iso(1) } });
  const c = meta({ id: 'd-0000000c' });
  const inactive = meta({ id: 'd-0000000d', active: false });
  const axiom = meta({ id: 'a-0000000a' });
  const history = [review({ batch: ['d-0000000c'] })];
  assert.deepEqual(
    unreviewedDecisions({ records: [a, b, c, inactive, axiom], history }).map((r) => r.id),
    ['d-0000000b', 'd-0000000a'],
  );
});

test('notice: count threshold, or age threshold with a smaller count; defaults', () => {
  assert.deepEqual(CURATION_DEFAULTS, { minUnreviewed: 10, maxAgeDays: 30, minForAge: 3, batchSize: 20 });
  const many = Array.from({ length: 10 }, () => meta());
  const now = T0 + 2 * DAY;
  assert.equal(curationNotice({ unreviewed: many, history: [], config: CURATION_DEFAULTS, now }).notify, true);
  assert.equal(curationNotice({ unreviewed: many.slice(0, 9), history: [], config: CURATION_DEFAULTS, now }).notify, false);

  // No review yet: the age counts from the oldest unreviewed approval.
  const three = many.slice(0, 3);
  assert.equal(curationNotice({ unreviewed: three, history: [], config: CURATION_DEFAULTS, now: T0 + 29 * DAY }).notify, false);
  const old = curationNotice({ unreviewed: three, history: [], config: CURATION_DEFAULTS, now: T0 + 30 * DAY });
  assert.equal(old.notify, true);
  assert.equal(old.since, iso(0));
  assert.equal(curationNotice({ unreviewed: many.slice(0, 2), history: [], config: CURATION_DEFAULTS, now: T0 + 90 * DAY }).notify, false);

  // With a review: the age counts from the latest review.
  const history = [review({ reviewedAt: iso(20) }), review({ reviewedAt: iso(10) })];
  const recent = curationNotice({ unreviewed: three, history, config: CURATION_DEFAULTS, now: T0 + 40 * DAY });
  assert.equal(recent.notify, false);
  assert.equal(recent.lastReviewedAt, iso(20));
  assert.equal(curationNotice({ unreviewed: three, history, config: CURATION_DEFAULTS, now: T0 + 50 * DAY }).notify, true);

  // Settings change the thresholds.
  const config = { ...CURATION_DEFAULTS, minUnreviewed: 2 };
  assert.equal(curationNotice({ unreviewed: many.slice(0, 2), history: [], config, now }).notify, true);
});

test('batch: at most batchSize unreviewed, related active records by path, topic or relation, all active axioms', () => {
  const d1 = meta({ id: 'd-00000001', codePaths: ['src/money/**'], topics: ['rounding'], approval: { id: 'ap-aaaaaaaaaaaa', signer: 's', approvedAt: iso(1) } });
  const d2 = meta({ id: 'd-00000002', codePaths: ['src/ui/a.mjs'], approval: { id: 'ap-aaaaaaaaaaaa', signer: 's', approvedAt: iso(2) } });
  const d3 = meta({ id: 'd-00000003', approval: { id: 'ap-aaaaaaaaaaaa', signer: 's', approvedAt: iso(3) } });
  const byPath = meta({ id: 'd-0000000p', codePaths: ['src/money/round.mjs'] });
  const byTopic = meta({ id: 'd-0000000t', topics: ['rounding'] });
  const byRelation = meta({ id: 'd-0000000r', relations: [{ type: 'coexist', id: 'd-00000002', condition: 'c' }] });
  const unrelated = meta({ id: 'd-0000000u', codePaths: ['lib/other.mjs'] });
  const inactive = meta({ id: 'd-0000000i', active: false, topics: ['rounding'] });
  const axiom = meta({ id: 'a-00000001' });
  const oldAxiom = meta({ id: 'a-00000002', active: false });
  const history = [review({ batch: ['d-0000000p', 'd-0000000t', 'd-0000000r', 'd-0000000u', 'd-0000000i'] })];
  const records = [d3, d2, d1, byPath, byTopic, byRelation, unrelated, inactive, axiom, oldAxiom];

  const picked = selectBatch({ records, history, batchSize: 2 });
  assert.deepEqual(picked.batch, ['d-00000001', 'd-00000002']);
  assert.deepEqual(picked.related, ['d-0000000p', 'd-0000000r', 'd-0000000t']);
  assert.deepEqual(picked.axioms, ['a-00000001']);
});

test('history: review files parsed and validated; broken ones reported', () => {
  const good = review({ id: 'c-0000000g' });
  const texts = new Map([
    ['.heirloom/curation/c-0000000g.json', JSON.stringify(good)],
    ['.heirloom/curation/c-0000000b.json', '{"schemaVersion":1}'],
    ['.heirloom/curation/notes.txt', 'x'],
  ]);
  const parsed = parseCurationFiles(texts);
  assert.deepEqual(parsed.history.map((h) => h.id), ['c-0000000g']);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0], /c-0000000b/);
});

const SRC = [{ ref: '.heirloom/decisions/d-00000001.md', quote: 'q' }];
const axiomOp = (/** @type {string[]} */ evidence, over = {}) => ({
  op: 'add',
  kind: 'axiom',
  title: '금액은 반올림하지 않는다',
  body: { property: 'p', scope: 's', exceptions: '', checks: 'c' },
  codePaths: [],
  topics: [],
  sources: SRC,
  evidence,
  ...over,
});

/** @param {any[]} history */
const curationInput = (history = []) => ({ trigger: 'curation', curation: { batch: ['d-00000001', 'd-00000002', 'd-00000003'], related: ['d-0000000p'], axioms: [], history } });

test('candidate checks: evidence size and membership', () => {
  const input = curationInput();
  assert.deepEqual(checkCurationDraft({ input, draft: { records: [axiomOp(['d-00000001', 'd-0000000p'])] } }), []);
  assert.match(checkCurationDraft({ input, draft: { records: [axiomOp(['d-00000001'])] } }).join('\n'), /2개 이상/);
  assert.match(checkCurationDraft({ input, draft: { records: [axiomOp(['d-00000001', 'd-0000000x'])] } }).join('\n'), /묶음·관련 기록에 없는.*d-0000000x/);
  assert.match(checkCurationDraft({ input, draft: { records: [axiomOp(['d-00000001', 'd-00000001'])] } }).join('\n'), /중복/);
  const { evidence: _drop, ...noEvidence } = axiomOp([]);
  assert.match(checkCurationDraft({ input, draft: { records: [noEvidence] } }).join('\n'), /evidence/);
  // A decision added during curation (merging duplicates) needs no evidence.
  const decision = { ...axiomOp([]), kind: 'decision', body: { problem: 'p', choice: 'c', alternatives: '', scope: '' } };
  delete (/** @type {any} */ (decision)).evidence;
  assert.deepEqual(checkCurationDraft({ input, draft: { records: [decision] } }), []);
});

test('candidate checks: no new evidence after a held or rejected candidate is an error', () => {
  const history = [
    review({
      candidates: [
        { title: 'x', evidence: ['d-00000001', 'd-00000002'], decision: 'rejected', reason: '상황마다 다름' },
        { title: 'y', evidence: ['d-0000000p', 'd-00000003'], decision: 'held', reason: '더 지켜본다' },
        { title: 'z', evidence: ['d-00000002', 'd-00000003'], decision: 'accepted', axiomId: 'a-00000001' },
      ],
    }),
  ];
  const input = curationInput(history);
  const errors = (/** @type {string[]} */ evidence) => checkCurationDraft({ input, draft: { records: [axiomOp(evidence)] } });
  assert.match(errors(['d-00000002', 'd-00000001']).join('\n'), /새 근거 없음.*거절/);
  assert.match(errors(['d-00000003', 'd-0000000p']).join('\n'), /새 근거 없음.*보류/);
  assert.deepEqual(errors(['d-00000001', 'd-00000002', 'd-00000003']), [], 'a new decision is new evidence');
  assert.deepEqual(errors(['d-00000002', 'd-00000003']), [], 'an accepted candidate does not block');
});

test('candidate checks: evidence outside a curation handoff is an error', () => {
  const input = { trigger: 'auto' };
  assert.match(checkCurationDraft({ input, draft: { records: [axiomOp(['d-00000001', 'd-00000002'])] } }).join('\n'), /정리 작업/);
  assert.deepEqual(checkCurationDraft({ input, draft: { records: [{ ...axiomOp([]), evidence: undefined }] } }), []);
});

test('review history: candidates accepted, held and rejected with reasons, other changes listed', () => {
  const input = { taskId: 't-20261112-aaaaaaaa', ...curationInput() };
  const draft = {
    records: [
      { ...axiomOp(['d-00000001', 'd-00000002']), id: 'a-0000000x' },
      { ...axiomOp(['d-00000002', 'd-00000003']), id: 'a-0000000y', title: '두 번째' },
      { ...axiomOp(['d-00000001', 'd-00000003']), id: 'a-0000000z', title: '세 번째' },
      { op: 'deprecate', target: 'd-00000003', reason: '중복', sources: [] },
      { op: 'relate', target: 'd-00000001', relation: { type: 'exception', id: 'd-00000002', condition: '환불일 때' } },
    ],
  };
  const approval = {
    id: 'ap-dddddddddddd',
    approvedAt: iso(9),
    items: [
      { index: 0, decision: 'approved', edited: { title: '고친 제목' } },
      { index: 1, decision: 'pending', reason: '사례가 더 필요함' },
      { index: 2, decision: 'rejected', reason: '우연한 일치' },
      { index: 3, decision: 'approved' },
      { index: 4, decision: 'rejected' },
    ],
  };
  const doc = buildCurationReview({ input, draft, approval });
  assert.deepEqual(doc, {
    schemaVersion: 1,
    id: curationReviewId('ap-dddddddddddd'),
    taskId: 't-20261112-aaaaaaaa',
    approvalId: 'ap-dddddddddddd',
    reviewedAt: iso(9),
    batch: ['d-00000001', 'd-00000002', 'd-00000003'],
    candidates: [
      { title: '고친 제목', evidence: ['d-00000001', 'd-00000002'], decision: 'accepted', axiomId: 'a-0000000x' },
      { title: '두 번째', evidence: ['d-00000002', 'd-00000003'], decision: 'held', reason: '사례가 더 필요함' },
      { title: '세 번째', evidence: ['d-00000001', 'd-00000003'], decision: 'rejected', reason: '우연한 일치' },
    ],
    changes: [
      { op: 'deprecate', target: 'd-00000003', decision: 'approved' },
      { op: 'relate', target: 'd-00000001', decision: 'rejected' },
    ],
  });
  assert.deepEqual(validate(curationReviewSchema, doc), []);
  assert.match(doc.id, /^c-[0-9a-hjkmnp-tv-z]{8}$/);
  assert.equal(curationReviewId('ap-dddddddddddd'), doc.id, 'the same approval always gives the same file');
  assert.notEqual(curationReviewId('ap-eeeeeeeeeeee'), doc.id);
});

test('schemas: relate op, evidence, curation input', () => {
  const draft = {
    schemaVersion: 1,
    taskId: 't-20261112-aaaaaaaa',
    inputSourceHash: `sha256:${'0'.repeat(64)}`,
    summary: [{ text: '정리', codePaths: [] }],
    records: [
      { op: 'relate', target: 'd-00000001', relation: { type: 'exception', id: 'd-00000002', condition: '환불일 때' } },
      axiomOp(['d-00000001', 'd-00000002']),
    ],
    missing: [],
    conflicts: [],
    notes: '',
  };
  assert.deepEqual(validate(draftSchema, draft), []);
  const noCondition = /** @type {any} */ (structuredClone(draft));
  noCondition.records[0].relation.condition = ' ';
  assert.match(validate(draftSchema, noCondition).join('\n'), /condition: 비어 있으면 안 됨/);

  const input = {
    schemaVersion: 1,
    taskId: 't-20261112-aaaaaaaa',
    repo: { id: 'r-aaaaaaaaaa', root: '/w', remote: null },
    worktree: { id: 'w-aaaaaaaaaa', path: '/w' },
    branch: 'heirloom/curate-20261112-abcd',
    base: { ref: 'origin/main', mergeBase: 'a'.repeat(40) },
    sdlcTaskRef: null,
    trigger: 'curation',
    source: { hash: `sha256:${'0'.repeat(64)}`, files: [] },
    materials: [],
    unknowns: [],
    projectRules: { prTemplates: [], commitGuides: [] },
    createdAt: iso(0),
    curation: { batch: ['d-00000001'], related: [], axioms: [], history: [review()] },
  };
  assert.deepEqual(validate(inputSchema, input), []);
});
