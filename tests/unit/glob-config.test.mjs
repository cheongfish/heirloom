import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { globToRegExp, matchesAny } from '../../skills/using-heirloom/lib/glob.mjs';
import { loadProjectConfig, loadUserConfig, DEFAULT_SPEC_GLOBS } from '../../skills/using-heirloom/lib/config.mjs';

test('globToRegExp: *, **, ? and braces', () => {
  /** @type {[string, string, boolean][]} */
  const cases = [
    ['docs/superpowers/specs/**', 'docs/superpowers/specs/a.md', true],
    ['docs/superpowers/specs/**', 'docs/superpowers/specs/x/y.md', true],
    ['docs/superpowers/specs/**', 'docs/superpowers/plans/a.md', false],
    ['**/specs/**/*.md', 'specs/a.md', true],
    ['**/specs/**/*.md', 'a/b/specs/c/d.md', true],
    ['**/specs/**/*.md', 'a/specs.md', false],
    ['src/**/*.mjs', 'src/a.mjs', true],
    ['src/**/*.mjs', 'src/x/y/a.mjs', true],
    ['*.md', 'a/b.md', false],
    ['*.md', 'b.md', true],
    ['src/?.mjs', 'src/a.mjs', true],
    ['src/?.mjs', 'src/ab.mjs', false],
    ['src/*.{mjs,cjs}', 'src/a.cjs', true],
    ['src/*.{mjs,cjs}', 'src/a.js', false],
    ['a.b+c(d)', 'a.b+c(d)', true],
    ['a.b', 'axb', false],
  ];
  for (const [glob, file, expected] of cases) {
    assert.equal(globToRegExp(glob).test(file), expected, `${glob} vs ${file}`);
  }
});

test('matchesAny', () => {
  assert.equal(matchesAny('src/a.mjs', ['docs/**', 'src/*.mjs']), true);
  assert.equal(matchesAny('src/a.mjs', []), false);
});

test('loadProjectConfig: defaults without a file, merges and validates a file', async () => {
  const root = await tempDir('cfg');
  const defaults = await loadProjectConfig(root);
  assert.equal(defaults.baseBranch, null);
  assert.deepEqual(defaults.specGlobs, DEFAULT_SPEC_GLOBS);
  assert.equal(defaults.sessionIndex.maxDecisions, 30);
  assert.equal(defaults.recall.maxRecords, 8);

  await mkdir(path.join(root, '.heirloom'));
  await writeFile(
    path.join(root, '.heirloom', 'config.json'),
    JSON.stringify({ schemaVersion: 1, baseBranch: 'develop', specGlobs: ['spec/**'], sessionIndex: { maxDecisions: 5 } }),
  );
  const merged = await loadProjectConfig(root);
  assert.equal(merged.baseBranch, 'develop');
  assert.deepEqual(merged.specGlobs, ['spec/**']);
  assert.equal(merged.sessionIndex.maxDecisions, 5);
  assert.equal(merged.recall.maxTokens, 6000);

  await writeFile(path.join(root, '.heirloom', 'config.json'), JSON.stringify({ schemaVersion: 1, baseBranch: 3 }));
  await assert.rejects(loadProjectConfig(root), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('loadUserConfig: dashboard and curation agent defaults', async () => {
  const home = await tempDir('home');
  assert.deepEqual(await loadUserConfig(home), {
    schemaVersion: 1,
    dashboard: { idleMinutes: 30, openBrowser: true, staleDays: 7, port: 17380 },
    curation: { agent: { host: 'claude-code', command: 'claude', model: null } },
  });
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, dashboard: { idleMinutes: 5, staleDays: 3 } }));
  assert.deepEqual((await loadUserConfig(home)).dashboard, { idleMinutes: 5, openBrowser: true, staleDays: 3, port: 17380 });
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { command: '/opt/claude', model: 'sonnet' } } }));
  assert.deepEqual((await loadUserConfig(home)).curation.agent, { host: 'claude-code', command: '/opt/claude', model: 'sonnet' });
  for (const [host, command] of [['codex', 'codex'], ['antigravity', 'agy']]) {
    await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { host } } }));
    assert.deepEqual((await loadUserConfig(home)).curation.agent, { host, command, model: null }, 'each profile has its own default command');
  }
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { host: 'vim' } } }));
  await assert.rejects(loadUserConfig(home), /host/);
});

test('loadProjectConfig: curation thresholds default and override one by one', async () => {
  const root = await tempDir('repo');
  assert.deepEqual((await loadProjectConfig(root)).curation, { minUnreviewed: 10, maxAgeDays: 30, minForAge: 3, batchSize: 20 });
  await mkdir(path.join(root, '.heirloom'), { recursive: true });
  await writeFile(path.join(root, '.heirloom', 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { batchSize: 5 } }));
  assert.deepEqual((await loadProjectConfig(root)).curation, { minUnreviewed: 10, maxAgeDays: 30, minForAge: 3, batchSize: 5 });
});
