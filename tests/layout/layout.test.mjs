import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkSkillFrontmatter, checkImports, checkNoDevFiles, checkSignUsage, checkVendoredSeed } from './checks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MVP_SKILLS = ['apply-approval', 'curate-decisions', 'prepare-handoff', 'recall-context', 'using-heirloom'];

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

test('repository: vendored SEED Design CSS is pinned, licensed, unmodified and covers the classes the dashboard uses', async () => {
  assert.deepEqual(await checkVendoredSeed(ROOT), []);
});

test('repository: the MVP skills and curate-decisions exist', async () => {
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

test('repository: the Codex manifest shares skills and hooks with Claude Code through ./ paths', async () => {
  const claude = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const codex = JSON.parse(await readFile(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codex.name, claude.name);
  assert.equal(codex.description, claude.description);
  assert.equal(codex.skills, './skills/');
  assert.equal(codex.hooks, './hooks/hooks.json', 'an explicit path: Codex would otherwise discover hooks/hooks.json on its own');
  for (const rel of [codex.skills, codex.hooks]) {
    assert.match(rel, /^\.\//, 'Codex requires manifest paths to start with ./');
    await readFile(path.join(ROOT, rel, rel.endsWith('/') ? 'using-heirloom/SKILL.md' : ''), 'utf8');
  }
  assert.equal(typeof codex.interface?.displayName, 'string');
  assert.equal(typeof codex.interface?.shortDescription, 'string');
});

test('repository: the Antigravity manifest has only schema fields, and its always-on rule carries the handoff rule', async () => {
  const claude = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.antigravity-plugin', 'plugin.json'), 'utf8'));
  // The schema rejects unknown fields (additionalProperties: false).
  const allowed = ['$schema', 'name', 'displayName', 'description', 'version', 'disabled', 'logo', 'suggestedPrompts', 'skills', 'author', 'homepage', 'repository', 'license', 'keywords', 'extensions'];
  assert.deepEqual(Object.keys(manifest).filter((k) => !allowed.includes(k)), []);
  assert.equal(manifest.name, claude.name);
  assert.equal(manifest.description, claude.description);
  assert.equal(manifest.skills, undefined, 'skills/ at the plugin root is loaded by default');

  // Components are read from the plugin root, never from .antigravity-plugin/.
  assert.deepEqual((await readdir(path.join(ROOT, '.antigravity-plugin'))).sort(), ['plugin.json']);
  const rule = await readFile(path.join(ROOT, 'rules', 'heirloom.md'), 'utf8');
  assert.match(rule, /^---\ntrigger: always_on\n/, 'a rule without a valid trigger is silently dropped');
  assert.ok(Buffer.byteLength(rule) < 24_000, 'rules over 24,000 bytes are truncated');
  const skill = await readFile(path.join(ROOT, 'skills', 'using-heirloom', 'SKILL.md'), 'utf8');
  const core = skill.split('\n').find((line) => line.startsWith('Before you tell the user that the implementation'));
  assert.ok(core && rule.includes(core), 'the rule repeats the convention sentence word for word');
});

test('repository: the Cursor manifest points at Cursor-format hooks and rules, never at the shared ones', async () => {
  const claude = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const cursor = JSON.parse(await readFile(path.join(ROOT, '.cursor-plugin', 'plugin.json'), 'utf8'));
  assert.equal(cursor.name, claude.name);
  assert.equal(cursor.description, claude.description);
  assert.equal(cursor.skills, './skills/');
  // A path in the manifest replaces Cursor's default discovery of hooks/hooks.json (Claude Code
  // format) and rules/ (Antigravity format).
  assert.equal(cursor.hooks, './hooks/hooks-cursor.json');
  assert.equal(cursor.rules, './.cursor-plugin/rules/');
  const rule = await readFile(path.join(ROOT, '.cursor-plugin', 'rules', 'heirloom.mdc'), 'utf8');
  assert.match(rule, /^---\n(?:.*\n)*?alwaysApply: true\n(?:.*\n)*?---\n/, 'an always-applied rule');
  const skill = await readFile(path.join(ROOT, 'skills', 'using-heirloom', 'SKILL.md'), 'utf8');
  const core = skill.split('\n').find((line) => line.startsWith('Before you tell the user that the implementation'));
  assert.ok(core && rule.includes(core), 'the rule repeats the convention sentence word for word');
  const antigravity = await readFile(path.join(ROOT, 'rules', 'heirloom.md'), 'utf8');
  assert.equal(rule.split('\n---\n').slice(1).join('\n---\n'), antigravity.split('\n---\n').slice(1).join('\n---\n'), 'same body as the Antigravity rule');
});

test('repository: hook entry points keep LF line endings on every checkout (.gitattributes)', async () => {
  const { execFileSync } = await import('node:child_process');
  const files = ['hooks/run-hook.cmd', 'hooks/session-start', 'hooks/stop', 'hooks/node-env'];
  const out = execFileSync('git', ['check-attr', 'eol', '--', ...files], { cwd: ROOT, encoding: 'utf8' });
  for (const file of files) assert.match(out, new RegExp(`^${file}: eol: lf$`, 'm'), file);
});

test('repository: the marketplace lists this plugin with the manifest name and version', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(await readFile(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(typeof market.owner?.name, 'string');
  assert.equal(market.plugins.length, 1);
  const [entry] = market.plugins;
  assert.equal(entry.name, manifest.name);
  assert.equal(entry.version, manifest.version);
  assert.equal(entry.source, './', 'the marketplace serves this repository itself');
});
