// examples/*.example.json: valid against the schemas and showing the real defaults, so a
// user can copy one and change only what they need.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';
import { loadProjectConfig, loadUserConfig } from '../../skills/using-heirloom/lib/config.mjs';

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples');

test('user config example: every setting, each at its default', async () => {
  const home = await tempDir('home');
  await copyFile(path.join(EXAMPLES, 'user-config.example.json'), path.join(home, 'config.json'));
  const empty = await tempDir('home');
  assert.deepEqual(await loadUserConfig(home), await loadUserConfig(empty));
});

test('project config example: every setting; all but baseBranch at their defaults', async () => {
  const root = await tempDir('repo');
  await mkdir(path.join(root, '.heirloom'));
  await copyFile(path.join(EXAMPLES, 'project-config.example.json'), path.join(root, '.heirloom', 'config.json'));
  const loaded = await loadProjectConfig(root);
  const defaults = await loadProjectConfig(await tempDir('repo'));
  assert.equal(loaded.baseBranch, 'main');
  assert.deepEqual({ ...loaded, baseBranch: null }, defaults);
});
