import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { canonicalJson } from '../../skills/using-heirloom/lib/canonical.mjs';
import { ensureSigningKey, rotateSigningKey, sign, verify, chooseKeystore } from '../../skills/using-heirloom/lib/sign.mjs';

const opts = { keystore: /** @type {const} */ ('file') };

function record() {
  return {
    schemaVersion: 1,
    id: 'ap-000000000001',
    taskId: 't-20261112-00000000',
    kind: 'full',
    target: { sourceHash: `sha256:${'a'.repeat(64)}`, materials: {}, draftSha256: 'b'.repeat(64) },
    summary: { initial: ['a'], final: ['b'] },
    items: [{ index: 0, decision: 'approved' }],
    approver: { fingerprint: '', gitUser: 'Test <t@e>' },
    approvedAt: '2026-11-12T00:00:00Z',
  };
}

test('canonicalJson sorts keys recursively and has no whitespace', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});

test('ensureSigningKey creates one key, stores the private key 0600 and keeps the public key', async () => {
  const home = await tempDir('keys');
  const first = await ensureSigningKey(home, opts);
  const second = await ensureSigningKey(home, opts);
  assert.equal(second.fingerprint, first.fingerprint);
  assert.match(first.fingerprint, /^SHA256:[A-Za-z0-9_-]{43}$/);
  const current = JSON.parse(await readFile(path.join(home, 'keys', 'current.json'), 'utf8'));
  assert.equal(current.fingerprint, first.fingerprint);
  assert.equal(current.storage, 'file');
  if (process.platform !== 'win32') {
    assert.equal((await stat(path.join(home, 'keys', 'private.key'))).mode & 0o777, 0o600);
  }
  assert.deepEqual(await readdir(path.join(home, 'keys', 'public')), [`${first.fingerprint.slice(7)}.pub`]);
});

test('sign fills the approver fingerprint; verify accepts the round trip', async () => {
  const home = await tempDir('keys');
  const signed = await sign(home, record(), opts);
  assert.match(signed.signature, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(signed.approver.fingerprint, (await ensureSigningKey(home, opts)).fingerprint);
  assert.deepEqual(await verify(home, signed), { ok: true });
  assert.deepEqual(await verify(home, JSON.parse(JSON.stringify(signed))), { ok: true }, 'survives JSON round trip');
});

test('verify rejects tampering, missing signatures and unknown keys', async () => {
  const home = await tempDir('keys');
  const signed = await sign(home, record(), opts);

  const tampered = structuredClone(signed);
  tampered.summary.final = ['changed'];
  assert.deepEqual(await verify(home, tampered), { ok: false, reason: 'bad_signature' });

  const retargeted = structuredClone(signed);
  retargeted.target.sourceHash = `sha256:${'c'.repeat(64)}`;
  assert.equal((await verify(home, retargeted)).ok, false);

  const unsigned = /** @type {any} */ (structuredClone(signed));
  delete unsigned.signature;
  assert.deepEqual(await verify(home, unsigned), { ok: false, reason: 'missing_signature' });

  const otherHome = await tempDir('keys');
  assert.deepEqual(await verify(otherHome, signed), { ok: false, reason: 'unknown_key' });

  const garbage = { ...signed, signature: 'AAAA' };
  assert.deepEqual(await verify(home, garbage), { ok: false, reason: 'bad_signature' });
});

test('after key rotation, old approvals still verify and new ones use the new key', async () => {
  const home = await tempDir('keys');
  const old = await sign(home, record(), opts);
  const rotated = await rotateSigningKey(home, opts);
  assert.notEqual(rotated.fingerprint, old.approver.fingerprint);
  const fresh = await sign(home, { ...record(), id: 'ap-000000000002' }, opts);
  assert.equal(fresh.approver.fingerprint, rotated.fingerprint);
  assert.deepEqual(await verify(home, old), { ok: true });
  assert.deepEqual(await verify(home, fresh), { ok: true });
  assert.equal((await readdir(path.join(home, 'keys', 'public'))).length, 2);
});

test('chooseKeystore: explicit/env file wins; keychains only where available', () => {
  assert.equal(chooseKeystore({ keystore: 'file' }, { platform: 'darwin', env: {}, has: () => true }), 'file');
  assert.equal(chooseKeystore({}, { platform: 'darwin', env: { HEIRLOOM_KEYSTORE: 'file' }, has: () => true }), 'file');
  assert.equal(chooseKeystore({}, { platform: 'darwin', env: {}, has: (c) => c === 'security' }), 'macos-keychain');
  assert.equal(chooseKeystore({}, { platform: 'linux', env: {}, has: () => true }), 'file', 'no D-Bus session');
  assert.equal(
    chooseKeystore({}, { platform: 'linux', env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' }, has: (c) => c === 'secret-tool' }),
    'secret-tool',
  );
  assert.equal(chooseKeystore({}, { platform: 'win32', env: {}, has: () => true }), 'file');
});
