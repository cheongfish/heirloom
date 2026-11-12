// Approval signing with a per-user ed25519 key (PLAN 11.4, MVP-PLAN 6.6).
// Only lib/ and dashboard/ may import anything but `verify` from this module (layout test).

import { execFile, spawn } from 'node:child_process';
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { canonicalJson } from './canonical.mjs';
import { readJson, writeFileAtomic, writeJsonAtomic } from './fsx.mjs';
import { homePaths } from './paths.mjs';

const execFileP = promisify(execFile);
const SERVICE = 'heirloom-signing-key';
const FINGERPRINT = /^SHA256:[A-Za-z0-9_-]{43}$/;

/** @typedef {'file' | 'macos-keychain' | 'secret-tool'} Keystore */
/** @typedef {{ keystore?: Keystore }} KeyOptions */

/** @param {string} home */
function keyPaths(home) {
  const dir = homePaths(home).keys;
  return {
    dir,
    current: path.join(dir, 'current.json'),
    privateFile: path.join(dir, 'private.key'),
    publicDir: path.join(dir, 'public'),
    /** @param {string} fingerprint */
    publicFile: (fingerprint) => path.join(dir, 'public', `${fingerprint.slice('SHA256:'.length)}.pub`),
  };
}

/** @param {string} command */
function commandExists(command) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, command), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/**
 * Keychain first (macOS `security`, Linux `secret-tool` with a D-Bus session), else a 0600 file.
 * HEIRLOOM_KEYSTORE=file forces the file store.
 * @param {KeyOptions} [options]
 * @param {{ platform: string, env: Record<string, string | undefined>, has: (command: string) => boolean }} [system]
 * @returns {Keystore}
 */
export function chooseKeystore(options = {}, system = { platform: process.platform, env: process.env, has: commandExists }) {
  if (options.keystore) return options.keystore;
  if (system.env.HEIRLOOM_KEYSTORE === 'file') return 'file';
  if (system.platform === 'darwin' && system.has('security')) return 'macos-keychain';
  if (system.platform === 'linux' && system.env.DBUS_SESSION_BUS_ADDRESS && system.has('secret-tool')) return 'secret-tool';
  return 'file';
}

/** @param {import('node:crypto').KeyObject} publicKey */
function fingerprintOf(publicKey) {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64url')}`;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} stdin
 */
function runWithStdin(command, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`${command} exited with ${code}`))));
    child.stdin.end(stdin);
  });
}

/**
 * @param {Keystore} store
 * @param {string} home
 * @param {string} fingerprint
 * @param {string} pem
 * @returns {Promise<Keystore>} where the key actually went
 */
async function storePrivate(store, home, fingerprint, pem) {
  try {
    if (store === 'macos-keychain') {
      await execFileP('security', ['add-generic-password', '-U', '-a', fingerprint, '-s', SERVICE, '-w', pem]);
      return store;
    }
    if (store === 'secret-tool') {
      await runWithStdin('secret-tool', ['store', '--label=Heirloom signing key', 'service', SERVICE, 'account', fingerprint], pem);
      return store;
    }
  } catch {
    // keychain unavailable: fall back to the file store
  }
  await writeFileAtomic(keyPaths(home).privateFile, pem, { mode: 0o600 });
  return 'file';
}

/**
 * @param {string} home
 * @param {{ fingerprint: string, storage: Keystore }} current
 */
async function loadPrivate(home, current) {
  let pem;
  if (current.storage === 'macos-keychain') {
    pem = (await execFileP('security', ['find-generic-password', '-a', current.fingerprint, '-s', SERVICE, '-w'])).stdout.trim();
  } else if (current.storage === 'secret-tool') {
    pem = (await execFileP('secret-tool', ['lookup', 'service', SERVICE, 'account', current.fingerprint])).stdout.trim();
  } else {
    pem = await readFile(keyPaths(home).privateFile, 'utf8');
  }
  return createPrivateKey(pem);
}

/**
 * @param {string} home
 * @param {KeyOptions} options
 */
async function createKey(home, options) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const fingerprint = fingerprintOf(publicKey);
  const paths = keyPaths(home);
  const storage = await storePrivate(chooseKeystore(options), home, fingerprint, /** @type {string} */ (privateKey.export({ type: 'pkcs8', format: 'pem' })));
  await writeFileAtomic(paths.publicFile(fingerprint), /** @type {string} */ (publicKey.export({ type: 'spki', format: 'pem' })), { mode: 0o644 });
  const current = { schemaVersion: 1, fingerprint, storage, createdAt: new Date().toISOString() };
  await writeJsonAtomic(paths.current, current);
  return current;
}

/**
 * The current signing key, created on first use. Never returns the private key.
 * @param {string} home
 * @param {KeyOptions} [options]
 * @returns {Promise<{ fingerprint: string, storage: Keystore }>}
 */
export async function ensureSigningKey(home, options = {}) {
  const current = /** @type {{ fingerprint: string, storage: Keystore } | undefined} */ (await readJson(keyPaths(home).current));
  if (current && FINGERPRINT.test(current.fingerprint)) return { fingerprint: current.fingerprint, storage: current.storage };
  const created = await createKey(home, options);
  return { fingerprint: created.fingerprint, storage: created.storage };
}

/**
 * Replace the current key. Previous public keys stay so past approvals still verify.
 * @param {string} home
 * @param {KeyOptions} [options]
 */
export async function rotateSigningKey(home, options = {}) {
  const created = await createKey(home, options);
  return { fingerprint: created.fingerprint, storage: created.storage };
}

/**
 * Sign an approval record: sets approver.fingerprint and adds `signature` over the
 * canonical JSON of everything else.
 * @template {{ approver: { fingerprint: string } } & Record<string, any>} R
 * @param {string} home
 * @param {R} record
 * @param {KeyOptions} [options]
 * @returns {Promise<R & { signature: string }>}
 */
export async function sign(home, record, options = {}) {
  const current = await ensureSigningKey(home, options);
  const privateKey = await loadPrivate(home, current);
  const { signature: _ignored, ...rest } = /** @type {Record<string, any>} */ (record);
  const unsigned = { ...rest, approver: { ...record.approver, fingerprint: current.fingerprint } };
  const signature = cryptoSign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64');
  return /** @type {R & { signature: string }} */ ({ ...unsigned, signature });
}

/**
 * @param {string} home
 * @param {Record<string, any>} record
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing_signature' | 'unknown_key' | 'bad_signature' }>}
 */
export async function verify(home, record) {
  const { signature, ...rest } = record ?? {};
  if (typeof signature !== 'string' || !signature) return { ok: false, reason: 'missing_signature' };
  const fingerprint = rest.approver?.fingerprint;
  if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) return { ok: false, reason: 'unknown_key' };
  let publicKey;
  try {
    publicKey = createPublicKey(await readFile(keyPaths(home).publicFile(fingerprint), 'utf8'));
  } catch {
    return { ok: false, reason: 'unknown_key' };
  }
  if (fingerprintOf(publicKey) !== fingerprint) return { ok: false, reason: 'unknown_key' };
  let ok = false;
  try {
    ok = cryptoVerify(null, Buffer.from(canonicalJson(rest)), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    ok = false;
  }
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
