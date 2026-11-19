import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validate,
  assertValid,
  recordMetaSchema,
  inputSchema,
  eventSchema,
  indexSchema,
  projectConfigSchema,
  draftV2Schema,
  decisionSchema,
} from '../../skills/using-heirloom/lib/schema.mjs';

const H = 'a'.repeat(64);

function recordMeta() {
  return {
    schemaVersion: 1,
    id: 'd-7k3q9m2x',
    kind: 'decision',
    title: 't',
    active: true,
    codePaths: ['src/a.mjs', 'src/**/*.mjs'],
    topics: [],
    supersedes: [{ id: 'd-2b8n4k1q', reason: 'r' }],
    supersededBy: null,
    relations: [{ type: 'exception', id: 'd-2b8n4k1q', condition: 'c' }],
    sources: [{ ref: 'docs/spec.md', lines: [1, 2], sha256: H, quote: 'q' }],
    taskId: 't-20261112-3h7k2p9m',
    approval: { id: 'ap-000000000000', signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' },
  };
}

function input() {
  return {
    schemaVersion: 1,
    taskId: 't-20261112-3h7k2p9m',
    repo: { id: 'r-0000000000', root: '/r', remote: null },
    worktree: { id: 'w-0000000000', path: '/r' },
    branch: 'feat/x',
    base: { ref: 'origin/main', mergeBase: 'f'.repeat(40) },
    sdlcTaskRef: null,
    trigger: 'auto',
    source: { hash: `sha256:${H}`, files: [{ path: 'src/a.mjs', status: 'M', sha256: H }] },
    materials: [{ role: 'spec', ref: 'docs/spec.md', sha256: H }],
    unknowns: ['sdlcTaskRef'],
    projectRules: { prTemplates: [], commitGuides: [] },
    createdAt: '2026-11-12T00:00:00Z',
  };
}

test('valid documents pass', () => {
  assert.deepEqual(validate(recordMetaSchema, recordMeta()), []);
  assert.deepEqual(validate(inputSchema, input()), []);
  assert.deepEqual(validate(eventSchema, { at: '2026-11-12T00:00:00Z', type: 'approved', approvalId: 'ap-000000000000' }), []);
  assert.deepEqual(validate(indexSchema, { schemaVersion: 1, worktrees: {}, tasks: {}, reminders: {}, lastFetch: {} }), []);
  assert.deepEqual(validate(projectConfigSchema, { schemaVersion: 1, baseBranch: 'main' }), []);
});

test('record meta: markdown code paths are rejected with a pointed message', () => {
  const errors = validate(recordMetaSchema, { ...recordMeta(), codePaths: ['src/a.mjs', 'docs/**/*.md'] });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^\$\.codePaths\[1\]: .*마크다운/);
});

test('record meta: absolute and parent-escaping code paths are rejected', () => {
  assert.equal(validate(recordMetaSchema, { ...recordMeta(), codePaths: ['/etc/passwd'] }).length, 1);
  assert.equal(validate(recordMetaSchema, { ...recordMeta(), codePaths: ['../x.mjs'] }).length, 1);
});

test('record meta: id prefix must match kind, unknown fields rejected', () => {
  assert.match(validate(recordMetaSchema, { ...recordMeta(), kind: 'axiom' }).join('\n'), /\$\.id/);
  assert.match(validate(recordMetaSchema, { ...recordMeta(), extra: 1 }).join('\n'), /\$\.extra: 허용되지 않는 필드/);
  assert.match(validate(recordMetaSchema, { ...recordMeta(), schemaVersion: 2 }).join('\n'), /\$\.schemaVersion/);
});

test('input: unknown trigger and bad hash are rejected', () => {
  assert.match(validate(inputSchema, { ...input(), trigger: 'magic' }).join('\n'), /\$\.trigger/);
  assert.match(validate(inputSchema, { ...input(), source: { hash: 'x', files: [] } }).join('\n'), /\$\.source\.hash/);
});

test('event: unknown type is rejected, extra fields allowed', () => {
  assert.equal(validate(eventSchema, { at: '2026-11-12T00:00:00Z', type: 'prepared', sourceHash: `sha256:${H}`, attempt: 1 }).length, 0);
  assert.equal(validate(eventSchema, { at: '2026-11-12T00:00:00Z', type: 'exploded' }).length, 1);
});

test('assertValid throws E_INPUT with all errors', () => {
  assert.throws(
    () => assertValid(projectConfigSchema, { schemaVersion: 1, baseBranch: 3, recall: { maxRecords: -1 } }, 'config.json'),
    (err) => {
      const e = /** @type {any} */ (err);
      return e.code === 'E_INPUT' && /config\.json/.test(e.message) && /baseBranch/.test(e.message) && /maxRecords/.test(e.message);
    },
  );
});

/** A schema 2 draft with a fork decision proposal and a discussion, each anchored by a test. */
function draft() {
  const anchors = [
    { file: 'src/cart.mjs', symbol: 'total' },
    { file: 'test/cart.test.mjs', test: 'small orders pay full price', plain: '5개 구매는 정가로 결제된다' },
  ];
  return {
    schemaVersion: 2,
    taskId: 't-20261112-3h7k2p9m',
    inputSourceHash: `sha256:${H}`,
    probeSetHash: `sha256:${H}`,
    summary: '대량 할인 경계를 10개에서 100개로 올림',
    behaviorDiffs: [],
    questions: [
      { id: 'q1', kind: 'fork', probes: ['p1'], codePaths: ['src/cart.mjs'], prompt: '경계는?', whyOpen: '이유가 없다', decision: { scope: ['src/cart.mjs'], anchors } },
    ],
    inferences: [],
    notes: '',
    discussions: [{ id: 'x1', url: 'https://example.com/pull/1', quote: 'q', choice: 'c', scope: ['src/cart.mjs'], anchors }],
    testNotes: [{ test: 'bulk discount for 12', plain: '12개 구매에 대량 할인이 붙는다' }],
  };
}

test('draft v2: summary, plain words on test anchors and testNotes are accepted, and all three are optional', () => {
  assert.deepEqual(validate(draftV2Schema, draft()), []);
  const bare = /** @type {any} */ (draft());
  delete bare.summary;
  delete bare.testNotes;
  for (const a of [...bare.questions[0].decision.anchors, ...bare.discussions[0].anchors]) delete a.plain;
  assert.deepEqual(validate(draftV2Schema, bare), [], 'drafts written before these fields still read');
});

test('draft v2: an empty or multi-line summary, plain words on a symbol anchor and a malformed test note are refused', () => {
  const d = /** @type {any} */ (draft());
  d.summary = '할인 경계를 올림\n그리고 테스트를 고침';
  d.questions[0].decision.anchors[0].plain = 'total이 결제액을 계산한다';
  d.discussions[0].anchors[1].plain = '';
  d.testNotes = [{ test: 'bulk discount for 12' }, { test: 'x', plain: 'y', extra: 1 }];
  const errors = validate(draftV2Schema, d);
  assert.ok(errors.includes('$.summary: 한 줄로 쓴다'), errors.join('\n'));
  assert.ok(errors.includes('$.questions[0].decision.anchors[0]: plain은 테스트 앵커에만 쓴다'), errors.join('\n'));
  assert.ok(errors.includes('$.discussions[0].anchors[1].plain: 비어 있으면 안 됨'), errors.join('\n'));
  assert.ok(errors.includes('$.testNotes[0].plain: 필수 필드가 없음'), errors.join('\n'));
  assert.ok(errors.includes('$.testNotes[1].extra: 허용되지 않는 필드'), errors.join('\n'));
  assert.ok(validate(draftV2Schema, { ...draft(), summary: ' ' }).includes('$.summary: 비어 있으면 안 됨'));
});

test('decision record: the plain words of a draft anchor do not belong in the record', () => {
  const record = /** @type {any} */ ({
    schemaVersion: 2,
    id: 'd-7k3q9m2x',
    kind: 'decision',
    choice: 'c',
    question: 'q',
    scope: ['src/cart.mjs'],
    anchors: [{ file: 'test/cart.test.mjs', test: 'small orders pay full price' }],
    source: [{ kind: 'fork-answer', approval: 'ap-000000000000', question: 'q1' }],
    replaces: null,
    taskId: 't-20261112-3h7k2p9m',
    approval: { id: 'ap-000000000000', signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' },
  });
  assert.deepEqual(validate(decisionSchema, record), []);
  record.anchors[0] = { ...record.anchors[0], plain: 'p' };
  assert.deepEqual(validate(decisionSchema, record), ['$.anchors[0].plain: 허용되지 않는 필드']);
});
