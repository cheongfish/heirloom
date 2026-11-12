// Local approval dashboard server. Binds 127.0.0.1 only; rejects foreign
// Host/Origin; state-changing requests need the session token embedded in the page.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { draftDigest } from '../lib/canonical.mjs';
import { loadUserConfig } from '../lib/config.mjs';
import { HeirloomError, classifyError } from '../lib/errors.mjs';
import { appendEvent, deriveState, readEvents } from '../lib/events.mjs';
import { readJson } from '../lib/fsx.mjs';
import { findUnhandedChanges, isStaleTask } from '../lib/overview.mjs';
import { ensureDir, homePaths, taskPaths } from '../lib/paths.mjs';
import { refreshPrExpiry } from '../lib/pr-expiry.mjs';
import { appliedTaskMerged } from '../lib/record-status.mjs';
import { carriedItems } from '../lib/recheck.mjs';
import { readRecords } from '../lib/records.mjs';
import { PATTERNS } from '../lib/schema.mjs';
import { VERSION } from '../lib/version.mjs';
import { approveTask } from './approve.mjs';
import { runCurationStep, startCuration } from './curate.mjs';
import { agentStatusOf } from '../lib/agent-runner.mjs';
import { cleanupCurationWorktrees, curationStatus } from '../lib/curation.mjs';
import { readCurationMeta } from '../lib/curation-worktree.mjs';
import { readIndex } from '../lib/store.mjs';

const MAX_BODY = 1024 * 1024;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..', '..', '..');
const STATIC_DIR = path.join(HERE, 'static');
const SEED_DIR = path.join(HERE, 'vendor', 'seed-design');
const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/**
 * Files served under /assets/: the dashboard's own app.js and app.css, and the vendored
 * SEED CSS listed in VENDOR.json. Nothing else is reachable, so paths cannot escape.
 * @returns {Promise<Map<string, { file: string, type: string }>>}
 */
async function assetMap() {
  /** @type {Map<string, { file: string, type: string }>} */
  const map = new Map();
  for (const name of ['app.js', 'app.css']) map.set(name, { file: path.join(STATIC_DIR, name), type: TYPES[name.endsWith('.js') ? '.js' : '.css'] });
  const manifest = /** @type {{ files: Record<string, string> } | undefined} */ (await readJson(path.join(SEED_DIR, 'VENDOR.json')));
  for (const name of Object.keys(manifest?.files ?? {})) {
    if (name.endsWith('.css')) map.set(`seed/${name}`, { file: path.join(SEED_DIR, ...name.split('/')), type: TYPES['.css'] });
  }
  return map;
}

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
 * @property {() => number} [now] clock for the stale-task check (tests)
 * @property {string} [pluginRoot] where the headless curation finds the skills
 * @property {number} [agentTimeoutMs] time limit of one headless run
 */

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
    now = Date.now,
    pluginRoot = PLUGIN_ROOT,
    agentTimeoutMs,
  } = options;
  const template = await readFile(path.join(STATIC_DIR, 'index.html'), 'utf8');
  /** @param {string} token */
  const page = (token) => template.replace('%HEIRLOOM_TOKEN%', token);
  const assets = await assetMap();
  const token = randomBytes(32).toString('base64url');
  const tokenBuf = Buffer.from(token);
  /** @type {Set<http.ServerResponse>} */
  const sseClients = new Set();
  let lastActivity = Date.now();
  /** Curation tasks with a headless run in progress: the server stays up while they run. */
  /** @type {Set<string>} */
  const agents = new Set();
  /** @type {Omit<import('./curate.mjs').RunOptions, 'home' | 'pluginRoot'>} */
  const runHooks = {
    onStart: (id) => void agents.add(id),
    onExit: (id) => {
      agents.delete(id);
      lastActivity = Date.now();
    },
    log,
    timeoutMs: agentTimeoutMs,
  };
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
  /** PR and MR states already asked for, so the list does not call gh or glab on every request. */
  /** @type {Map<string, { pr: string | null, at: number }>} */
  const prCache = new Map();
  let prCheckRunning = false;

  /**
   * Ask gh or glab about PRs and MRs in the background: the list never waits for the network.
   * An `expired` event changes events.jsonl, and the watcher then tells open screens.
   * @param {string[]} taskIds
   */
  function checkClosedPrs(taskIds) {
    if (prCheckRunning || !taskIds.length) return;
    prCheckRunning = true;
    refreshPrExpiry({ home, taskIds, cache: prCache })
      .then((expired) => {
        if (expired.length) log(`PR이 닫혀 만료됨: ${expired.join(', ')}`);
      })
      .catch((err) => log(`PR 상태 확인 실패: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        prCheckRunning = false;
      });
  }

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
      const state = deriveState(events);
      const curation = await readCurationMeta(home, taskId);
      tasks.push({
        taskId,
        state,
        // An applied task without a PR is finished once it reaches its target branch.
        merged: state === 'applied' ? await appliedTaskMerged({ home, taskId }) : null,
        branch: input?.branch ?? null,
        repoRoot: input?.repo.root ?? null,
        repoId: input?.repo.id ?? null,
        worktreeId: input?.worktree.id ?? null,
        createdAt: input?.createdAt ?? events[0].at,
        updatedAt: events[events.length - 1].at,
        curation: curation ? { worktree: curation.worktree, branch: curation.branch, removedAt: curation.removedAt ?? null, removeNote: curation.removeNote ?? null } : null,
        agent: curation ? agentStatusOf(events) : null,
      });
    }
    tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return tasks;
  }

  let cleanupRunning = false;
  /** Remove the worktrees of finished curations in the background. */
  function cleanupCurations() {
    if (cleanupRunning) return;
    cleanupRunning = true;
    cleanupCurationWorktrees({ home })
      .then((removed) => {
        if (removed.length) log(`정리 worktree 삭제: ${removed.join(', ')}`);
      })
      .catch((err) => log(`정리 worktree 삭제 실패: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        cleanupRunning = false;
      });
  }

  /** Curation state of every repository with a registered (non-curation) worktree. */
  async function curations() {
    const index = await readIndex(home);
    const repoIds = [...new Set(Object.values(index.worktrees).filter((w) => !w.managed).map((w) => w.repoId))].sort();
    return Promise.all(repoIds.map((repoId) => curationStatus({ home, repoId, now: now() })));
  }

  async function overview() {
    const { staleDays } = (await loadUserConfig(home)).dashboard;
    const at = now();
    const listed = await listTasks();
    checkClosedPrs(listed.filter((t) => t.state === 'pr_created').map((t) => t.taskId));
    cleanupCurations();
    const tasks = listed.map((t) => ({ ...t, stale: isStaleTask(t, at, staleDays) }));
    const { changes, unchecked } = await findUnhandedChanges({ home });
    return { tasks, unhanded: changes, unchecked, staleDays, curation: await curations() };
  }

  /**
   * Existing records the draft points at (targets, relations, axiom evidence) and the records
   * a curation reviews, for display.
   * @param {string} root
   * @param {any[]} ops
   * @param {any} input
   */
  async function targetsOf(root, ops, input) {
    const wanted = new Set([
      ...ops.filter((op) => op.op !== 'add').map((op) => op.target),
      ...ops.filter((op) => op.op === 'relate').map((op) => op.relation?.id),
      ...ops.flatMap((op) => (Array.isArray(op.evidence) ? op.evidence : [])),
      ...(input?.curation ? [...input.curation.batch, ...input.curation.related, ...input.curation.axioms] : []),
    ]);
    /** @type {Record<string, { kind: string, title: string, active: boolean }>} */
    const out = {};
    if (!wanted.size) return out;
    try {
      for (const r of (await readRecords(root)).records) {
        if (wanted.has(r.meta.id)) out[r.meta.id] = { kind: r.meta.kind, title: r.meta.title, active: r.meta.active };
      }
    } catch {
      // repository gone: show ids only
    }
    return out;
  }

  /**
   * Draft indexes that keep their approval in an incremental handoff, for the screen. Null
   * when the task is not a recheck or the draft is not in shape yet (not submitted).
   * @param {any} input
   * @param {any} draft
   */
  function carriedOf(input, draft) {
    if (!input?.recheck || !draft) return null;
    try {
      return carriedItems({ recheck: input.recheck, draft });
    } catch {
      return null;
    }
  }

  /** @param {string} taskId */
  async function taskDetail(taskId) {
    const paths = taskPaths(home, taskId);
    const events = await readEvents(paths.events);
    const draft = await readJson(paths.draft);
    /** @type {string[]} */
    let approvals = [];
    try {
      approvals = (await readdir(paths.approvals)).filter((n) => /^ap-[0-9a-z]+\.json$/.test(n)).map((n) => n.slice(0, -5)).sort();
    } catch {
      // none yet
    }
    const input = /** @type {any} */ (await readJson(paths.input));
    // Approval ids are random; the event log gives the order.
    const lastApproved = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
    const latest = typeof lastApproved === 'string' && approvals.includes(lastApproved) ? await readJson(path.join(paths.approvals, `${lastApproved}.json`)) : undefined;
    return {
      taskId,
      state: deriveState(events),
      input: input ?? null,
      draft: draft ?? null,
      draftInitial: (await readJson(paths.draftInitial)) ?? null,
      check: (await readJson(paths.check)) ?? null,
      draftSha256: draft === undefined ? null : draftDigest(draft),
      events,
      approvals,
      latestApproval: latest ?? null,
      targets: input ? await targetsOf(input.repo.root, /** @type {any} */ (draft)?.records ?? [], input) : {},
      curation: await readCurationMeta(home, taskId),
      agent: agentStatusOf(events),
      carried: carriedOf(input, draft),
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
      if (pathname.startsWith('/assets/')) {
        const asset = assets.get(pathname.slice('/assets/'.length));
        if (!asset) return fail(res, 404, 'E_NOT_FOUND', '경로가 없음');
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
        return res.end(await readFile(asset.file));
      }
      if (pathname === '/api/tasks') return json(res, 200, { ok: true, ...(await overview()) });
      if (pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return undefined;
      }
      const repoCuration = /^\/api\/repos\/([^/]+)\/curation$/.exec(pathname);
      if (repoCuration) {
        const repoId = decodeURIComponent(repoCuration[1]);
        if (!PATTERNS.repoId.test(repoId)) return fail(res, 404, 'E_NOT_FOUND', '저장소가 없음');
        return json(res, 200, { ok: true, ...(await curationStatus({ home, repoId, now: now() })) });
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
      const curate = /^\/api\/repos\/([^/]+)\/curate$/.exec(pathname);
      if (curate) {
        const repoId = decodeURIComponent(curate[1]);
        if (!PATTERNS.repoId.test(repoId)) return fail(res, 404, 'E_NOT_FOUND', '저장소가 없음');
        // The command always comes from the user config: a request can never choose it.
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
          return fail(res, 400, 'E_INPUT', '정리 실행 요청의 본문은 빈 객체여야 함');
        }
        log(`curate ${repoId} sec-fetch-site=${req.headers['sec-fetch-site'] ?? '-'} origin=${req.headers.origin ?? '-'}`);
        return json(res, 200, { ok: true, ...(await startCuration({ home, pluginRoot, repoId, ...runHooks })) });
      }
      const action = /^\/api\/tasks\/([^/]+)\/(approve|discard|retry-agent)$/.exec(pathname);
      if (!action) return fail(res, 404, 'E_NOT_FOUND', '경로가 없음');
      const taskId = decodeURIComponent(action[1]);
      if (!(await exists(taskPaths(home, taskId).dir))) return fail(res, 404, 'E_NOT_FOUND', '작업이 없음');
      const body = /** @type {any} */ (await readBody(req));
      if (action[2] === 'approve') {
        log(`approve ${taskId} ua=${JSON.stringify(req.headers['user-agent'] ?? '')} sec-fetch-site=${req.headers['sec-fetch-site'] ?? '-'} origin=${req.headers.origin ?? '-'}`);
        const approval = await approveTask({ home, taskId, request: body, keystore });
        // A curation goes on by itself once approved: the approval is the request to apply it.
        /** @type {unknown} */
        let agent = null;
        if (await readCurationMeta(home, taskId)) {
          try {
            agent = (await runCurationStep({ home, pluginRoot, taskId, ...runHooks })).agent;
          } catch (err) {
            const e = classifyError(err);
            agent = { pid: null, error: e.message };
            log(`정리 반영 단계 시작 실패 ${taskId}: ${e.message}`);
          }
        }
        return json(res, 200, { ok: true, approval, agent });
      }
      if (action[2] === 'retry-agent') {
        log(`retry-agent ${taskId}`);
        return json(res, 200, { ok: true, ...(await runCurationStep({ home, pluginRoot, taskId, ...runHooks })) });
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
    if (sseClients.size === 0 && agents.size === 0 && Date.now() - lastActivity >= idleMs) onIdle();
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
