// Recall relevance and limits (MVP-PLAN M6).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateTokens, pathMatches, scoreRecord, selectWithinLimits, splitList } from '../../skills/using-heirloom/lib/recall.mjs';

test('estimateTokens: UTF-8 bytes ÷ 3, so one Hangul syllable is about one token', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abc'), 1);
  assert.equal(estimateTokens('abcd'), 2);
  assert.equal(estimateTokens('가나다라'), 4);
  assert.equal(estimateTokens('가a'), 2);
});

test('pathMatches: file against literal and glob code paths, and a directory query', () => {
  assert.equal(pathMatches('src/a.mjs', ['src/a.mjs']), true);
  assert.equal(pathMatches('src/x/y.mjs', ['src/**/*.mjs']), true);
  assert.equal(pathMatches('src/a.mjs', ['lib/**']), false);
  assert.equal(pathMatches('src', ['src/a.mjs']), true, 'directory containing the code path');
  assert.equal(pathMatches('src', ['src/**']), true);
  assert.equal(pathMatches('sr', ['src/a.mjs']), false, 'not a path prefix match');
  assert.equal(pathMatches('src', ['**/*.mjs']), false, 'no literal directory to compare');
  assert.equal(pathMatches('', ['**']), false);
});

test('scoreRecord: ids, paths and topics add up and are explained', () => {
  const meta = { id: 'd-00000001', codePaths: ['src/**'], topics: ['Money', 'rounding'] };
  assert.deepEqual(scoreRecord(meta, { paths: [], topics: [], ids: [] }), { score: 0, reasons: [] });
  assert.deepEqual(scoreRecord(meta, { paths: ['src/a.mjs', 'src/b.mjs', 'lib/c.mjs'], topics: ['money'], ids: ['d-00000001'] }), {
    score: 100 + 20 + 5,
    reasons: ['id', 'path:src/a.mjs', 'path:src/b.mjs', 'topic:money'],
  });
});

test('selectWithinLimits: score order, axioms first on ties, count and token limits', () => {
  const c = (/** @type {string} */ id, /** @type {string} */ kind, /** @type {number} */ score, /** @type {number} */ tokens) => ({ id, kind, score, tokens });
  const candidates = [c('d-1', 'decision', 10, 10), c('a-1', 'axiom', 10, 10), c('d-2', 'decision', 50, 100), c('d-3', 'decision', 5, 10), c('d-4', 'decision', 1, 10)];
  const { chosen, excluded, tokens } = selectWithinLimits(candidates, { maxRecords: 3, maxTokens: 50 });
  // d-2 does not fit the token budget; smaller ones after it still do.
  assert.deepEqual(chosen.map((x) => x.id), ['a-1', 'd-1', 'd-3']);
  assert.equal(tokens, 30);
  assert.deepEqual(excluded.map((x) => [x.id, x.reason]), [['d-2', 'tokens'], ['d-4', 'limit']]);
});

test('splitList: comma-separated and repeated values, trimmed and unique', () => {
  assert.deepEqual(splitList(['a, b', 'c', 'a', ' ']), ['a', 'b', 'c']);
  assert.deepEqual(splitList(undefined), []);
});
