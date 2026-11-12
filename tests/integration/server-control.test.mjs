// ensureServer() against real detached server processes on a free port.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';
import { ensureServer, probeHealth, codeHash } from '../../skills/using-heirloom/lib/server-control.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', () => r(undefined)));
  const { port } = /** @type {net.AddressInfo} */ (srv.address());
  await new Promise((r) => srv.close(() => r(undefined)));
  return port;
}

/** @param {number} pid */
function kill(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

test('codeHash is stable and covers lib/ and dashboard/', async () => {
  const a = await codeHash(ROOT);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await codeHash(ROOT), a);
});

test('probeHealth: nothing listening', async () => {
  assert.deepEqual(await probeHealth(await freePort()), { kind: 'none' });
});

test('ensureServer starts once, then reuses the running server', async (t) => {
  const home = await tempDir('home');
  const port = await freePort();
  const first = await ensureServer({ home, port, pluginRoot: ROOT });
  t.after(() => kill(first.pid));
  assert.equal(first.status, 'started');
  assert.equal(first.url, `http://127.0.0.1:${port}/`);
  const second = await ensureServer({ home, port, pluginRoot: ROOT });
  assert.equal(second.status, 'reused');
  assert.equal(second.pid, first.pid);
});

test('ensureServer restarts a Heirloom server whose code hash differs', async (t) => {
  const home = await tempDir('home');
  const port = await freePort();
  const stale = await ensureServer({ home, port, pluginRoot: ROOT, env: { HEIRLOOM_TEST_CODE_HASH: 'stale' } });
  t.after(() => kill(stale.pid));
  const health = await probeHealth(port);
  assert.equal(health.kind, 'heirloom');
  assert.equal(/** @type {any} */ (health).body.codeHash, 'stale');

  const fresh = await ensureServer({ home, port, pluginRoot: ROOT });
  t.after(() => kill(fresh.pid));
  assert.equal(fresh.status, 'restarted');
  assert.notEqual(fresh.pid, stale.pid);
  assert.equal(/** @type {any} */ (await probeHealth(port)).body.codeHash, await codeHash(ROOT));
});

test('ensureServer refuses to touch a port used by another program', async (t) => {
  const port = await freePort();
  const foreign = http.createServer((_, res) => res.end('hello'));
  await new Promise((r) => foreign.listen(port, '127.0.0.1', () => r(undefined)));
  t.after(() => new Promise((r) => foreign.close(() => r(undefined))));
  await assert.rejects(ensureServer({ home: await tempDir('home'), port, pluginRoot: ROOT }), (err) => {
    const e = /** @type {any} */ (err);
    return e.code === 'E_CONFLICT' && new RegExp(String(port)).test(e.message) && /lsof|ss /.test(e.hint);
  });
});
