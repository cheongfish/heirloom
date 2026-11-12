import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

import { tempDir } from '../helpers/git-fixture.mjs';
import {
  parseRecord,
  serializeRecord,
  renderBody,
  isMarkdownCodePath,
  writeRecord,
  readRecords,
} from '../../skills/using-heirloom/lib/records.mjs';

/** @returns {import('../../skills/using-heirloom/lib/records.mjs').RecordMeta} */
function meta() {
  return {
    schemaVersion: 1,
    id: 'd-7k3q9m2x',
    kind: 'decision',
    title: '승인 기록은 ed25519로 서명한다',
    active: true,
    codePaths: ['skills/using-heirloom/lib/sign.mjs'],
    topics: ['approval'],
    supersedes: [],
    supersededBy: null,
    relations: [],
    sources: [{ ref: 'docs/specs/approval.md', lines: [40, 52], sha256: 'a'.repeat(64), quote: '서명을 포함한다' }],
    taskId: 't-20261112-3h7k2p9m',
    approval: { id: 'ap-000000000000', signer: 'SHA256:abc', approvedAt: '2026-11-12T05:10:00Z' },
  };
}

test('serializeRecord/parseRecord round trip exactly', () => {
  const body = '\n## 문제\n\n본문에 --- 가 있어도 된다.\n---\n';
  const text = serializeRecord({ meta: meta(), body });
  assert.ok(text.startsWith('---json\n{\n'));
  const parsed = parseRecord(text);
  assert.deepEqual(parsed.meta, meta());
  assert.equal(parsed.body, body);
  assert.equal(serializeRecord(parsed), text);
});

test('parseRecord accepts CRLF and rejects missing or broken frontmatter', () => {
  const text = serializeRecord({ meta: meta(), body: '\n## 문제\n' }).replace(/\n/g, '\r\n');
  assert.equal(parseRecord(text).meta.id, 'd-7k3q9m2x');
  for (const bad of ['# no frontmatter\n', '---json\n{"a":1}\n', '---json\n{oops}\n---\n']) {
    assert.throws(() => parseRecord(bad, 'x.md'), (err) => /** @type {any} */ (err).code === 'E_INPUT');
  }
});

test('renderBody produces the PLAN 14.1 / 15.1 sections', () => {
  const decision = renderBody('decision', { problem: 'P', choice: 'C', alternatives: 'A', scope: 'S' });
  assert.equal(decision, '\n## 문제\n\nP\n\n## 선택과 이유\n\nC\n\n## 버린 대안\n\nA\n\n## 적용 범위\n\nS\n');
  const axiom = renderBody('axiom', { property: 'P', scope: 'S', exceptions: 'E', checks: 'K' });
  assert.match(axiom, /## 유지할 성질\n\nP/);
  assert.match(axiom, /## 점검 지침\n\nK\n$/);
});

test('isMarkdownCodePath catches markdown files and markdown-only globs', () => {
  for (const p of ['README.md', 'docs/specs/a.md', 'x/Y.MDX', 'notes.markdown', 'docs/**/*.md', 'docs/*.{md,mdx}']) {
    assert.equal(isMarkdownCodePath(p), true, p);
  }
  for (const p of ['src/a.mjs', 'docs/**', 'src/**/*.{mjs,md}', 'md/index.js', 'a.md.js']) {
    assert.equal(isMarkdownCodePath(p), false, p);
  }
});

test('writeRecord/readRecords use .heirloom/decisions and .heirloom/axioms', async (t) => {
  const root = await tempDir('records');
  t.after(() => rm(root, { recursive: true, force: true }));
  const decision = { meta: meta(), body: renderBody('decision', { problem: 'P', choice: 'C', alternatives: 'A', scope: 'S' }) };
  const axiom = {
    meta: { ...meta(), id: 'a-2n5v8c1r', kind: /** @type {const} */ ('axiom') },
    body: renderBody('axiom', { property: 'P', scope: 'S', exceptions: 'E', checks: 'K' }),
  };
  const file = await writeRecord(root, decision);
  assert.ok(file.endsWith('.heirloom/decisions/d-7k3q9m2x.md'));
  await writeRecord(root, axiom);

  const { records, errors } = await readRecords(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(records.map((r) => r.meta.id), ['a-2n5v8c1r', 'd-7k3q9m2x']);
});

test('readRecords reports invalid files without failing the rest', async (t) => {
  const root = await tempDir('records');
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeRecord(root, { meta: meta(), body: '\n' });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${root}/.heirloom/decisions/d-broken00.md`, '# nope\n');
  await writeFile(`${root}/.heirloom/decisions/d-mdpath00.md`, serializeRecord({ meta: { ...meta(), id: 'd-mdpath00', codePaths: ['docs/a.md'] }, body: '\n' }));
  const { records, errors } = await readRecords(root);
  assert.deepEqual(records.map((r) => r.meta.id), ['d-7k3q9m2x']);
  assert.equal(errors.length, 2);
  assert.match(errors.join('\n'), /d-broken00\.md/);
  assert.match(errors.join('\n'), /d-mdpath00\.md.*마크다운/);
});
