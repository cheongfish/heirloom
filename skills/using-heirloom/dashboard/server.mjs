// Local approval dashboard server (MVP-PLAN 6). Binds 127.0.0.1 only; rejects foreign
// Host/Origin; state-changing requests need the session token embedded in the page.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import http from 'node:http';

import { draftDigest } from '../lib/canonical.mjs';
import { HeirloomError, classifyError } from '../lib/errors.mjs';
import { appendEvent, deriveState, readEvents } from '../lib/events.mjs';
import { readJson } from '../lib/fsx.mjs';
import { ensureDir, homePaths, taskPaths } from '../lib/paths.mjs';
import { PATTERNS } from '../lib/schema.mjs';
import { VERSION } from '../lib/version.mjs';
import { approveTask } from './approve.mjs';

const MAX_BODY = 1024 * 1024;

/** @param {string} p */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @typedef {object} ServerOptions
 * @property {string} home
 * @property {number} [port] 0 picks a free port (tests)
 * @property {string} [version]
 * @property {string} [codeHash]
 * @property {number} [idleMs]
 * @property {number} [idleCheckMs]
 * @property {() => void} [onIdle]
 * @property {number} [debounceMs]
 * @property {import('../lib/sign.mjs').Keystore} [keystore]
 * @property {(line: string) => void} [log]
 */

/** @param {string} token */
function page(token) {
  return `<!doctype html>
<html lang="ko" data-seed data-seed-color-mode="system">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="heirloom-token" content="${token}">
<title>Heirloom</title>
</head>
<body>
<main><h1>Heirloom 대시보드</h1><p>화면은 M4b에서 구현한다.</p></main>
</body>
</html>
`;
}

/**
 * @param {ServerOptions} options
 */
export async function createDashboardServer(options) {
  const {
    home,
    port = 17380,
    version = VERSION,
    codeHash = '',
    idleMs = 30 * 60_000,
    idleCheckMs = 60_000,
    onIdle = () => {},
    debounceMs = 500,
    keystore,
    log = () => {},
  } = options;
  const token = randomBytes(32).toString('base64url');
  const tokenBuf = Buffer.from(token);
  /** @type {Set<http.ServerResponse>} */
  const sseClients = new Set();
  let lastActivity = Date.now();
  let actualPort = port;

  /**
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {unknown} body
   */
  const json = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };
  /**
   * @param {http.ServerResponse} res
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  const fail = (res, status, code, message) => json(res, status, { ok: false, error: { code, message } });

  /** @param {http.IncomingMessage} req */
  const allowedOrigin = (req) => {
    const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
    if (!hosts.includes(req.headers.host ?? '')) return false;
    const origin = req.headers.origin;
    if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) return false;
    return req.headers['sec-fetch-site'] !== 'cross-site';
  };

  /** @param {http.IncomingMessage} req */
  const hasToken = (req) => {
    const given = Buffer.from(String(req.headers['x-heirloom-token'] ?? ''));
    return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
  };

  /** @param {http.IncomingMessage} req @returns {Promise<unknown>} */
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new HeirloomError('E_INPUT', '요청 본문이 너무 큼'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new HeirloomError('E_INPUT', 'JSON 본문이 올바르지 않음'));
        }
      });
      req.on('error', reject);
    });

  const tasksDir = homePaths(home).tasks;

  async function listTasks() {
    let ids = [];
    try {
      ids = (await readdir(tasksDir)).filter((n) => PATTERNS.taskId.test(n));
    } catch {
      return [];
    }
    const tasks = [];
    for (const taskId of ids) {
      const paths = taskPaths(home, taskId);
      const events = await readEvents(paths.events);
      if (!events.length) continue;
      const input = /** @type {any} */ (await readJson(paths.input));
      tasks.push({
        taskId,
        state: deriveState(events),
        branch: input?.branch ?? null,
        repoRoot: input?.repo.root ?? null,
        repoId: input?.repo.id ?? null,
        worktreeId: input?.worktree.id ?? null,
        createdAt: input?.createdAt ?? events[0].at,
        updatedAt: events[events.length - 1].at,
      });
    }
    return tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  /** @param {string} taskId */
  async function taskDetail(taskId) {
    const paths = taskPaths(home, taskId);
    const events = await readEvents(paths.events);
    const draft = await readJson(paths.draft);
    /** @type {string[]} */
    let approvals = [];
    try {
      approvals = (await readdir(paths.approvals)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
    } catch {
      // none yet
    }
    return {
      taskId,
      state: deriveState(events),
      input: (await readJson(paths.input)) ?? null,
      draft: draft ?? null,
      draftInitial: (await readJson(paths.draftInitial)) ?? null,
      check: (await readJson(paths.check)) ?? null,
      draftSha256: draft === undefined ? null : draftDigest(draft),
      events,
      approvals,
    };
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   */
  async function handle(req, res) {
    lastActivity = Date.now();
    if (!allowedOrigin(req)) return fail(res, 403, 'E_FORBIDDEN', '허용되지 않은 Host 또는 Origin');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname } = url;

    if (req.method === 'GET') {
      if (pathname === '/__heirloom/health') return json(res, 200, { name: 'heirloom', version, codeHash, pid: process.pid });
      if (pathname === '/' || pathname.startsWith('/r/')) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        return res.end(page(token));
      }
      if (pathname === '/api/tasks') return json(res, 200, { ok: true, tasks: await listTasks() });
      if (pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return undefined;
      }
      const detail = /^\/api\/tasks\/([^/]+)$/.exec(pathname);
      if (detail) {
        const taskId = decodeURIComponent(detail[1]);
        if (!(await exists(taskPaths(home, taskId).dir))) return fail(res, 404, 'E_NOT_FOUND', '작업이 없음');
        return json(res, 200, { ok: true, ...(await taskDetail(taskId)) });
      }
      return fail(res, 404, 'E_NOT_FOUND', '경로가 없음');
    }

    if (req.method === 'POST') {
      if (!hasToken(req)) return fail(res, 403, 'E_FORBIDDEN', '세션 토큰이 없거나 맞지 않음');
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return fail(res, 415, 'E_INPUT', 'application/json 본문만 받음');
      }
      const action = /^\/api\/tasks\/([^/]+)\/(approve|discard)$/.exec(pathname);
      if (!action) return fail(res, 404, 'E_NOT_FOUND', '경로가 없음');
      const taskId = decodeURIComponent(action[1]);
      if (!(await exists(taskPaths(home, taskId).dir))) return fail(res, 404, 'E_NOT_FOUND', '작업이 없음');
      const body = /** @type {any} */ (await readBody(req));
      if (action[2] === 'approve') {
        log(`approve ${taskId} ua=${JSON.stringify(req.headers['user-agent'] ?? '')} sec-fetch-site=${req.headers['sec-fetch-site'] ?? '-'} origin=${req.headers.origin ?? '-'}`);
        const approval = await approveTask({ home, taskId, request: body, keystore });
        return json(res, 200, { ok: true, approval });
      }
      const state = await appendEvent(taskPaths(home, taskId).events, {
        type: 'discarded',
        reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'user',
      });
      return json(res, 200, { ok: true, state });
    }
    return fail(res, 405, 'E_INPUT', '허용되지 않은 메서드');
  }

  const server = http.createServer((req, res) => {
    handle(req, res)
      .catch((err) => {
        const e = classifyError(err);
        const status = e.code === 'E_INPUT' ? 400 : e.code === 'E_CONFLICT' ? 409 : e.code === 'E_TRANSIENT' ? 503 : 500;
        if (status === 500) log(`error ${req.method} ${req.url}: ${e.message}`);
        if (!res.headersSent) fail(res, status, e.code, e.message);
        else res.end();
      })
      .finally(() => {
        if (!sseClients.has(res)) log(`${req.method} ${req.url} ${res.statusCode}`);
      });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  actualPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

  await ensureDir(tasksDir);
  /** @type {Map<string, NodeJS.Timeout>} */
  const pending = new Map();
  const watcher = watch(tasksDir, { recursive: true }, (_event, filename) => {
    const taskId = String(filename ?? '').split(/[\\/]/)[0];
    if (!PATTERNS.taskId.test(taskId) || pending.has(taskId)) return;
    pending.set(
      taskId,
      setTimeout(() => {
        pending.delete(taskId);
        for (const client of sseClients) client.write(`event: task-updated\ndata: ${JSON.stringify({ taskId })}\n\n`);
      }, debounceMs),
    );
  });
  watcher.on('error', (err) => log(`watch error: ${err.message}`));

  const keepalive = setInterval(() => {
    for (const client of sseClients) client.write(': keepalive\n\n');
  }, 25_000);
  keepalive.unref();
  const idleTimer = setInterval(() => {
    if (sseClients.size === 0 && Date.now() - lastActivity >= idleMs) onIdle();
  }, idleCheckMs);
  idleTimer.unref();

  return {
    port: actualPort,
    token,
    url: `http://127.0.0.1:${actualPort}/`,
    async close() {
      clearInterval(keepalive);
      clearInterval(idleTimer);
      for (const t of pending.values()) clearTimeout(t);
      watcher.close();
      for (const client of sseClients) client.end();
      sseClients.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}
