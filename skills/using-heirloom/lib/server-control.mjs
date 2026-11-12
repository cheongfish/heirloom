// Start, reuse or restart the single per-user dashboard server.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUserConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { readJson } from './fsx.mjs';
import { homePaths } from './paths.mjs';
import { VERSION } from './version.mjs';

export const DEFAULT_PORT = 17380;
const MAIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'main.mjs');

/**
 * Dashboard port: HEIRLOOM_PORT (development and tests), then the user config
 * `dashboard.port`, then 17380.
 * @param {string} home
 * @param {Record<string, string | undefined>} [env]
 */
export async function resolvePort(home, env = process.env) {
  const n = Number(env.HEIRLOOM_PORT);
  if (env.HEIRLOOM_PORT && Number.isInteger(n) && n > 0 && n < 65536) return n;
  return (await loadUserConfig(home)).dashboard.port;
}

/**
 * Hash of the code the server runs (lib/ and dashboard/). A running server with another
 * hash is stale after an update or a local edit and gets restarted.
 * @param {string} pluginRoot
 */
export async function codeHash(pluginRoot) {
  const base = path.join(pluginRoot, 'skills', 'using-heirloom');
  /** @type {string[]} */
  const files = [];
  /** @param {string} dir */
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else files.push(abs);
    }
  }
  await walk(path.join(base, 'lib'));
  await walk(path.join(base, 'dashboard'));
  const h = createHash('sha256');
  for (const file of files.map((f) => path.relative(base, f).split(path.sep).join('/')).sort()) {
    h.update(`${file}\0`);
    h.update(await readFile(path.join(base, file)));
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<{ kind: 'none' } | { kind: 'foreign' } | { kind: 'heirloom', body: { name: string, version: string, codeHash: string, pid: number } }>}
 */
export function probeHealth(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/__heirloom/health', headers: { host: `127.0.0.1:${port}` }, timeout: timeoutMs },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          try {
            const body = JSON.parse(text);
            resolve(body && body.name === 'heirloom' ? { kind: 'heirloom', body } : { kind: 'foreign' });
          } catch {
            resolve({ kind: 'foreign' });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ kind: 'foreign' });
    });
    req.on('error', (err) => resolve(/** @type {NodeJS.ErrnoException} */ (err).code === 'ECONNREFUSED' ? { kind: 'none' } : { kind: 'foreign' }));
  });
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ home: string, port?: number, pluginRoot: string, env?: Record<string, string>, startTimeoutMs?: number }} options
 * @returns {Promise<{ status: 'reused' | 'started' | 'restarted', url: string, pid: number }>}
 */
export async function ensureServer({ home, port: requested, pluginRoot, env = {}, startTimeoutMs = 5000 }) {
  const port = requested ?? (await resolvePort(home));
  const url = `http://127.0.0.1:${port}/`;
  const expected = await codeHash(pluginRoot);
  const health = await probeHealth(port);
  /** @type {'started' | 'restarted'} */
  let status = 'started';
  let oldPid = -1;

  if (health.kind === 'foreign') {
    throw new HeirloomError('E_CONFLICT', `대시보드 포트 ${port}를 다른 프로그램이 쓰고 있어 대시보드를 시작하지 않음`, {
      hint: `\`lsof -i :${port}\` 또는 \`ss -ltnp 'sport = :${port}'\`로 프로세스를 확인한다. 초안과 승인 대기 상태는 그대로 보존된다.`,
    });
  }
  if (health.kind === 'heirloom') {
    if (health.body.version === VERSION && health.body.codeHash === expected) return { status: 'reused', url, pid: health.body.pid };
    // Only stop a server this home started: the pid must match our server.json.
    const info = /** @type {{ pid?: number } | undefined} */ (await readJson(path.join(homePaths(home).server, 'server.json')));
    if (info?.pid !== health.body.pid) {
      throw new HeirloomError('E_CONFLICT', `포트 ${port}의 Heirloom 서버가 다른 버전이지만 이 사용자 저장소가 띄운 서버가 아님`, {
        hint: `\`lsof -i :${port}\`로 프로세스를 확인하고 직접 종료한다.`,
      });
    }
    oldPid = health.body.pid;
    try {
      process.kill(oldPid, 'SIGTERM');
    } catch {
      // already gone
    }
    const deadline = Date.now() + 3000;
    while ((await probeHealth(port, 300)).kind !== 'none') {
      if (Date.now() > deadline) throw new HeirloomError('E_CONFLICT', `이전 대시보드 서버(pid ${oldPid})가 종료되지 않음`);
      await sleep(100);
    }
    status = 'restarted';
  }

  const child = spawn(process.execPath, [MAIN], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, HEIRLOOM_HOME: home, HEIRLOOM_PORT: String(port) },
  });
  child.unref();

  const deadline = Date.now() + startTimeoutMs;
  for (;;) {
    const now = await probeHealth(port, 300);
    if (now.kind === 'heirloom' && now.body.pid !== oldPid) return { status, url, pid: now.body.pid };
    if (Date.now() > deadline) {
      throw new HeirloomError('E_INTERNAL', '대시보드 서버가 시작되지 않음', {
        hint: `${path.join(homePaths(home).server, 'server.log')}를 확인한다.`,
      });
    }
    await sleep(100);
  }
}
