import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { checkDraft } from '../../skills/using-heirloom/lib/draft-check.mjs';
import { ID_PATTERNS } from '../../skills/using-heirloom/lib/ids.mjs';
import { sha256Of } from '../../skills/using-heirloom/lib/conversation.mjs';

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

test('relate: target and related record must be active and different; allowed in any handoff', async () => {
  const root = await fixture();
  const relate = (/** @type {string} */ target, /** @type {string} */ id) => ({ op: 'relate', target, relation: { type: 'exception', id, condition: '환불일 때' } });
  const records = [existing('d-aaaaaaaa', true), existing('d-bbbbbbbb', true), existing('d-cccccccc', false)];
  const d = draft();
  d.records = [relate('d-aaaaaaaa', 'd-bbbbbbbb')];
  assert.deepEqual((await run(root, d, records)).errors, []);

  d.records = [relate('d-aaaaaaaa', 'd-cccccccc'), relate('d-cccccccc', 'd-aaaaaaaa'), relate('d-aaaaaaaa', 'd-aaaaaaaa'), relate('d-aaaaaaaa', 'd-zzzzzzzz')];
  const errors = (await run(root, d, records)).errors.join('\n');
  assert.match(errors, /records\[0\]\.relation\.id: 이미 비활성인 기록임 \(d-cccccccc\)/);
  assert.match(errors, /records\[1\]\.target: 이미 비활성인 기록임/);
  assert.match(errors, /records\[2\]\.relation\.id: 대상 기록 자신/);
  assert.match(errors, /records\[3\]\.relation\.id: 관계 대상 기록이 없음 \(d-zzzzzzzz\)/);
});

test('curation handoff: summary code paths are not checked; candidate checks run', async () => {
  const root = await fixture();
  const curationInput = { ...input(), trigger: 'curation', source: { hash: SOURCE_HASH, files: [] }, materials: [], curation: { batch: ['d-aaaaaaaa', 'd-bbbbbbbb'], related: [], axioms: [], history: [] } };
  const d = draft();
  d.summary = [{ text: '정리', codePaths: ['src/nothing-changed.mjs'] }];
  d.records = [
    {
      op: 'add',
      kind: 'axiom',
      title: '서명은 사용자별 키로 한다',
      body: { property: 'p', scope: 's', exceptions: '', checks: 'c' },
      codePaths: [],
      topics: [],
      sources: [{ ref: 'docs/spec.md', quote: '키는 사용자별로 둔다.' }],
      evidence: ['d-aaaaaaaa'],
    },
  ];
  const result = await checkDraft({ root, input: curationInput, draft: d, records: [existing('d-aaaaaaaa', true), existing('d-bbbbbbbb', true)], repoFiles: REPO_FILES });
  assert.deepEqual(result.errors, ['$.records[0].evidence: 근거 decision이 2개 이상이어야 함']);
});

test('conversation sources: the quote must be part of a message the person typed; its hash is filled', async () => {
  const root = await fixture();
  const typed = '변환 결과는\n반올림하지 않는다. 화면에서만 자른다.';
  const conversation = [{ sha256: sha256Of(typed), text: typed }, { sha256: sha256Of('좋아'), text: '좋아' }];
  /** @param {any} d */
  const check = (d, conv = /** @type {any} */ (conversation)) => checkDraft({ root, input: input(), draft: d, records: [], repoFiles: REPO_FILES, conversation: conv });

  const ok = draft();
  ok.records[0].sources = [{ ref: '@conversation', quote: '변환 결과는 반올림하지 않는다.' }];
  const result = await check(ok);
  assert.deepEqual(result.errors, []);
  assert.equal(result.draft.records[0].sources[0].sha256, sha256Of(typed));

  const mixed = draft();
  mixed.records[0].sources.push({ ref: '@conversation', quote: '화면에서만 자른다.' });
  assert.deepEqual((await check(mixed)).errors, [], 'a document and the conversation together');

  const invented = draft();
  invented.records[0].sources = [{ ref: '@conversation', quote: '반올림은 화면 단위로 한다' }];
  assert.match((await check(invented)).errors.join('\n'), /sources\[0\]\.quote: 사용자 발화에서 찾을 수 없음/);

  const noQuote = draft();
  noQuote.records[0].sources = [{ ref: '@conversation' }];
  assert.match((await check(noQuote)).errors.join('\n'), /sources\[0\]\.quote: .*인용/);

  const lines = draft();
  lines.records[0].sources = [{ ref: '@conversation', lines: [1, 1], quote: '좋아' }];
  assert.match((await check(lines)).errors.join('\n'), /sources\[0\]\.lines: 대화 출처에는 줄 범위를 쓰지 않음/);

  const none = draft();
  none.records[0].sources = [{ ref: '@conversation', quote: '좋아' }];
  assert.match((await check(none, null)).errors.join('\n'), /sources\[0\]\.ref: 이 인계에는 고정된 대화가 없음/);
  assert.match((await check(none, [])).errors.join('\n'), /고정된 대화가 없음/);

  const deprecate = { ...draft(), records: [{ op: 'deprecate', target: 'd-aaaaaaaa', reason: '안 쓴다', sources: [{ ref: '@conversation', quote: '좋아' }] }] };
  const deprecated = await checkDraft({ root, input: input(), draft: deprecate, records: [existing('d-aaaaaaaa', true)], repoFiles: REPO_FILES, conversation: /** @type {any} */ (conversation) });
  assert.deepEqual(deprecated.errors, []);
  assert.equal(deprecated.draft.records[0].sources[0].sha256, sha256Of('좋아'));
});
