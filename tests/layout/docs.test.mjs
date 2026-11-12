// User documentation: English and Korean guides have the same files, every relative link
// resolves, and the local-only planning documents are ignored by git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUIDE = path.join(ROOT, 'docs', 'guide');

test('docs/guide/en and docs/guide/ko contain the same files', async () => {
  assert.deepEqual((await readdir(path.join(GUIDE, 'en'))).sort(), (await readdir(path.join(GUIDE, 'ko'))).sort());
});

test('relative links in README*.md and docs/guide resolve to existing files', async () => {
  const files = ['README.md', 'README.en.md'];
  for (const lang of ['en', 'ko']) for (const name of await readdir(path.join(GUIDE, lang))) files.push(`docs/guide/${lang}/${name}`);
  /** @type {string[]} */
  const broken = [];
  for (const file of files) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
      const rel = target.split('#')[0];
      try {
        await access(path.resolve(path.dirname(path.join(ROOT, file)), rel));
      } catch {
        broken.push(`${file}: ${target}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('planning documents are ignored by git', () => {
  for (const name of ['HEIRLOOM-PLAN.md', 'HEIRLOOM-DESIGN.md', 'HEIRLOOM-MVP-PLAN.md', 'HEIRLOOM-PHASE3-PLAN.md']) {
    const out = execFileSync('git', ['check-ignore', '--no-index', `docs/${name}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.equal(out, `docs/${name}`);
  }
});
