import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSkillFrontmatter, checkImports, checkNoDevFiles, checkSignUsage } from './checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MVP_SKILLS = ['apply-approval', 'prepare-handoff', 'recall-context', 'using-heirloom'];

test('repository: SKILL.md frontmatter is valid', async () => {
  assert.deepEqual(await checkSkillFrontmatter(ROOT), []);
});

test('repository: imports under skills/ are relative and resolvable, or node: builtins', async () => {
  assert.deepEqual(await checkImports(ROOT), []);
});

test('repository: no development files inside skills/', async () => {
  assert.deepEqual(await checkNoDevFiles(ROOT), []);
});

test('repository: sign() is only reachable from lib/ and dashboard/', async () => {
  assert.deepEqual(await checkSignUsage(ROOT), []);
});

test('repository: the four MVP skills exist', async () => {
  for (const skill of MVP_SKILLS) {
    await readFile(path.join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
  }
});

test('repository: Claude Code manifest version matches package.json', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'heirloom');
  assert.equal(manifest.version, pkg.version);
  assert.equal(pkg.private, true);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'runtime dependencies are not allowed');
  const { VERSION } = await import('../../skills/using-heirloom/lib/version.mjs');
  assert.equal(VERSION, pkg.version, 'lib/version.mjs matches package.json');
});
