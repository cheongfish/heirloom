// What changed since a judged state (the recheck after a judgment reads it).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffStates } from '../../skills/using-heirloom/lib/recheck.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const MB1 = '1'.repeat(40);
const MB2 = '2'.repeat(40);

/** @param {[string, string][]} entries path, sha */
const files = (entries) => entries.map(([path, sha256]) => ({ path, status: /** @type {'M'} */ ('M'), sha256 }));

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
