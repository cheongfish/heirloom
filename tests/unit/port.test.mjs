// Dashboard port: HEIRLOOM_PORT, then ~/.heirloom/config.json dashboard.port, then 17380.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { DEFAULT_PORT, resolvePort } from '../../skills/using-heirloom/lib/server-control.mjs';
import { loadUserConfig } from '../../skills/using-heirloom/lib/config.mjs';

/** @param {string} home @param {unknown} dashboard */
const writeConfig = (home, dashboard) => writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, dashboard }));

test('default port without config or environment', async () => {
  const home = await tempDir('home');
  assert.equal(DEFAULT_PORT, 17380);
  assert.equal(await resolvePort(home, {}), 17380);
});

test('dashboard.port from the user config', async () => {
  const home = await tempDir('home');
  await writeConfig(home, { port: 18555 });
  assert.equal(await resolvePort(home, {}), 18555);
  assert.equal((await loadUserConfig(home)).dashboard.port, 18555);
});

test('HEIRLOOM_PORT wins over the config; an invalid value is ignored', async () => {
  const home = await tempDir('home');
  await writeConfig(home, { port: 18555 });
  assert.equal(await resolvePort(home, { HEIRLOOM_PORT: '19000' }), 19000);
  assert.equal(await resolvePort(home, { HEIRLOOM_PORT: 'abc' }), 18555);
  assert.equal(await resolvePort(home, { HEIRLOOM_PORT: '70000' }), 18555);
});

test('a port outside 1024-65535 in the config is an input error', async () => {
  const home = await tempDir('home');
  await writeConfig(home, { port: 80 });
  await assert.rejects(resolvePort(home, {}), (/** @type {any} */ e) => e.code === 'E_INPUT');
  await writeConfig(home, { port: 70000 });
  await assert.rejects(resolvePort(home, {}), (/** @type {any} */ e) => e.code === 'E_INPUT');
});
