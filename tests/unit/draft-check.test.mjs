import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { checkDraft } from '../../skills/using-heirloom/lib/draft-check.mjs';
import { ID_PATTERNS } from '../../skills/using-heirloom/lib/ids.mjs';

const H = 'a'.repeat(64);
const SOURCE_HASH = `sha256:${'b'.repeat(64)}`;
const SPEC = ['# Spec', '', '## 결정', '승인 기록에는 ed25519 서명을', '포함한다. 키는 사용자별로 둔다.', ''].join('\n');

async function fixture() {
  const root = await tempDir('check');
  for (const [rel, content] of Object.entries({
    'docs/spec.md': SPEC,
    'src/a.mjs': 'export const a = 1;\n',
    'src/b.mjs': 'export const b = 1;\n',
  })) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
  return root;
}

function input() {
  return {
    schemaVersion: 1,
    taskId: 't-20261112-3h7k2p9m',
    repo: { id: 'r-0000000000', root: '/r', remote: null },
    worktree: { id: 'w-0000000000', path: '/r' },
    branch: 'feat',
    base: { ref: 'origin/main', mergeBase: 'f'.repeat(40) },
    sdlcTaskRef: null,
    trigger: 'auto',
    source: {
      hash: SOURCE_HASH,
      files: [
        { path: 'src/a.mjs', status: 'M', sha256: H },
        { path: 'docs/spec.md', status: 'A', sha256: H },
      ],
    },
    materials: [{ role: 'spec', ref: 'docs/spec.md', sha256: H }],
    unknowns: [],
    projectRules: { prTemplates: [], commitGuides: [] },
    createdAt: '2026-11-12T00:00:00Z',
  };
}

/** @returns {any} */
function draft() {
  return {
    schemaVersion: 1,
    taskId: 't-20261112-3h7k2p9m',
    inputSourceHash: SOURCE_HASH,
    summary: [
      { text: '서명 추가', codePaths: ['src/a.mjs'] },
      { text: '테스트 추가', codePaths: ['src/*.mjs'] },
    ],
    records: [
      {
        op: 'add',
        kind: 'decision',
        title: '승인 기록 서명',
        body: { problem: 'p', choice: 'c', alternatives: '', scope: '' },
        codePaths: ['src/a.mjs'],
        topics: ['approval'],
        sources: [{ ref: 'docs/spec.md', lines: [4, 5], quote: '승인 기록에는 ed25519 서명을 포함한다.' }],
      },
    ],
    missing: [],
    conflicts: [],
    notes: '',
  };
}

/** @param {string} id @param {boolean} active */
function existing(id, active) {
  return /** @type {any} */ ({ meta: { id, kind: id.startsWith('a-') ? 'axiom' : 'decision', active, title: id } });
}

const REPO_FILES = ['docs/spec.md', 'src/a.mjs', 'src/b.mjs'];

/** @param {string} root @param {any} d @param {any[]} [records] */
const run = (root, d, records = []) => checkDraft({ root, input: input(), draft: d, records, repoFiles: REPO_FILES });

test('a valid draft passes; ids, source hashes are filled; quote matches across a line wrap', async () => {
  const root = await fixture();
  const result = await run(root, draft());
  assert.deepEqual(result.errors, []);
  const add = result.draft.records[0];
  assert.match(add.id, ID_PATTERNS.decision);
  assert.match(add.sources[0].sha256, /^[0-9a-f]{64}$/);
});

test('markdown in code paths is an error (schema)', async () => {
  const root = await fixture();
  const d = draft();
  d.summary[0].codePaths = ['docs/spec.md'];
  d.records[0].codePaths = ['docs/**/*.md'];
  const { errors } = await run(root, d);
  assert.match(errors.join('\n'), /\$\.summary\[0\]\.codePaths\[0\]: .*마크다운/);
  assert.match(errors.join('\n'), /\$\.records\[0\]\.codePaths\[0\]: .*마크다운/);
});

test('summary code paths must point at changed files', async () => {
  const root = await fixture();
  const d = draft();
  d.summary[1].codePaths = ['src/b.mjs'];
  assert.match((await run(root, d)).errors.join('\n'), /\$\.summary\[1\]\.codePaths\[0\]: .*변경 파일/);
});

test('quotes must exist in the cited lines of the source', async () => {
  const root = await fixture();
  const outside = draft();
  outside.records[0].sources[0].lines = [1, 2];
  assert.match((await run(root, outside)).errors.join('\n'), /sources\[0\]\.quote: .*찾을 수 없음/);

  const invented = draft();
  invented.records[0].sources[0] = { ref: 'docs/spec.md', quote: '키는 팀 단위로 공유한다' };
  assert.match((await run(root, invented)).errors.join('\n'), /찾을 수 없음/);

  const noLines = draft();
  noLines.records[0].sources[0] = { ref: 'docs/spec.md', quote: '키는 사용자별로 둔다' };
  assert.deepEqual((await run(root, noLines)).errors, []);
});

test('added records must quote their sources; missing source files are errors', async () => {
  const root = await fixture();
  const noQuote = draft();
  delete noQuote.records[0].sources[0].quote;
  assert.match((await run(root, noQuote)).errors.join('\n'), /sources\[0\]\.quote: .*인용/);

  const missing = draft();
  missing.records[0].sources[0].ref = 'docs/nope.md';
  assert.match((await run(root, missing)).errors.join('\n'), /sources\[0\]\.ref: .*없음/);
});

test('task id and input source hash must match the frozen input', async () => {
  const root = await fixture();
  const d = draft();
  d.taskId = 't-20261112-zzzzzzzz';
  d.inputSourceHash = `sha256:${'c'.repeat(64)}`;
  const errors = (await run(root, d)).errors.join('\n');
  assert.match(errors, /\$\.taskId/);
  assert.match(errors, /\$\.inputSourceHash: .*prepare/);
});

test('supersede/deprecate/update targets must be existing active records; with must point at an add', async () => {
  const root = await fixture();
  const records = [existing('d-aaaaaaaa', true), existing('d-bbbbbbbb', false)];
  const d = draft();
  d.records.push(
    { op: 'supersede', target: 'd-aaaaaaaa', reason: 'r', with: 0 },
    { op: 'supersede', target: 'd-bbbbbbbb', reason: 'r', with: 0 },
    { op: 'deprecate', target: 'd-cccccccc', reason: 'r', sources: [] },
    { op: 'supersede', target: 'd-aaaaaaaa', reason: 'r', with: 2 },
  );
  const errors = (await run(root, d, records)).errors.join('\n');
  assert.doesNotMatch(errors, /\$\.records\[1\]/);
  assert.match(errors, /\$\.records\[2\]\.target: .*비활성/);
  assert.match(errors, /\$\.records\[3\]\.target: .*없음/);
  assert.match(errors, /\$\.records\[4\]\.with: .*add/);
});

test('warnings: unmatched decision globs and summary size', async () => {
  const root = await fixture();
  const d = draft();
  d.records[0].codePaths = ['lib/**/*.mjs'];
  d.summary = [d.summary[0]];
  const { errors, warnings } = await run(root, d);
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /\$\.records\[0\]\.codePaths\[0\]: .*맞는 파일이 없음/);
  assert.match(warnings.join('\n'), /\$\.summary: .*2~5개/);
});

test('a valid record id from a previous submission is kept; a colliding one is replaced', async () => {
  const root = await fixture();
  const keep = draft();
  keep.records[0].id = 'd-kept0000';
  assert.equal((await run(root, keep)).draft.records[0].id, 'd-kept0000');

  const clash = draft();
  clash.records[0].id = 'd-aaaaaaaa';
  const replaced = (await run(root, clash, [existing('d-aaaaaaaa', true)])).draft.records[0].id;
  assert.notEqual(replaced, 'd-aaaaaaaa');
  assert.match(replaced, ID_PATTERNS.decision);
});

test('schema errors are reported without crashing the other checks', async () => {
  const root = await fixture();
  const { errors } = await run(root, { schemaVersion: 1, summary: 'nope' });
  assert.ok(errors.length > 0);
  assert.match(errors.join('\n'), /\$\.summary/);
});
