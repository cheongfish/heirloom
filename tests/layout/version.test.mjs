// One version everywhere: the plugin manifests users install, the development package files,
// and an entry for it in CHANGELOG.md. The version is bumped only in the PR to main, and the
// git tag on main uses the same number.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @param {string} rel */
const json = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), 'utf8'));

test('plugin manifests, package files and lib/version.mjs carry the same version', async () => {
  const plugin = (await json('.claude-plugin/plugin.json')).version;
  const marketplace = (await json('.claude-plugin/marketplace.json')).plugins.find((/** @type {any} */ p) => p.name === 'heirloom')?.version;
  const codex = (await json('.codex-plugin/plugin.json')).version;
  const pkg = (await json('package.json')).version;
  const lock = await json('package-lock.json');
  const { VERSION } = await import('../../skills/using-heirloom/lib/version.mjs');
  assert.match(plugin, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(
    { marketplace, codex, pkg, lock: lock.version, lockRoot: lock.packages?.['']?.version, runtime: VERSION },
    { marketplace: plugin, codex: plugin, pkg: plugin, lock: plugin, lockRoot: plugin, runtime: plugin },
  );
});

test('CHANGELOG.md has an entry for the current version', async () => {
  const version = (await json('.claude-plugin/plugin.json')).version;
  const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});
