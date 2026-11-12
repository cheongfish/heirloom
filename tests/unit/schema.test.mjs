import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validate,
  assertValid,
  recordMetaSchema,
  inputSchema,
  draftSchema,
  approvalSchema,
  eventSchema,
  indexSchema,
  projectConfigSchema,
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

function draft() {
  return {
    schemaVersion: 1,
    taskId: 't-20261112-3h7k2p9m',
    inputSourceHash: `sha256:${H}`,
    summary: [{ text: 's', codePaths: ['src/a.mjs'] }],
    records: [
      {
        op: 'add',
        kind: 'decision',
        title: 't',
        body: { problem: 'p', choice: 'c', alternatives: 'a', scope: 's' },
        codePaths: ['src/a.mjs'],
        topics: [],
        sources: [{ ref: 'docs/spec.md', lines: [1, 2], quote: 'q' }],
      },
      { op: 'supersede', target: 'd-2b8n4k1q', reason: 'r', with: 0 },
      { op: 'deprecate', target: 'd-2b8n4k1q', reason: 'r', sources: [] },
    ],
    missing: [],
    conflicts: [],
    notes: '',
  };
}

test('valid documents pass', () => {
  assert.deepEqual(validate(recordMetaSchema, recordMeta()), []);
  assert.deepEqual(validate(inputSchema, input()), []);
  assert.deepEqual(validate(draftSchema, draft()), []);
  assert.deepEqual(
    validate(approvalSchema, {
      schemaVersion: 1,
      id: 'ap-000000000000',
      taskId: 't-20261112-3h7k2p9m',
      kind: 'quick',
      target: { sourceHash: `sha256:${H}`, materials: { 'docs/spec.md': H }, draftSha256: H },
      summary: { initial: ['a'], final: ['b'] },
      items: [{ index: 0, decision: 'approved', edited: { title: 'x' } }],
      approver: { fingerprint: 'SHA256:x', gitUser: 'T <t@e>' },
      approvedAt: '2026-11-12T00:00:00Z',
      signature: 'c2ln',
    }),
    [],
  );
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

test('draft: markdown in summary code paths is rejected', () => {
  const d = draft();
  d.summary[0].codePaths = ['README.md'];
  assert.match(validate(draftSchema, d).join('\n'), /\$\.summary\[0\]\.codePaths\[0\]: .*마크다운/);
});

test('draft: unknown op and missing fields are reported with paths', () => {
  const d = /** @type {any} */ (draft());
  d.records.push({ op: 'explode' });
  delete d.records[0].title;
  const errors = validate(draftSchema, d).join('\n');
  assert.match(errors, /\$\.records\[0\]\.title: 필수 필드/);
  assert.match(errors, /\$\.records\[3\]/);
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
