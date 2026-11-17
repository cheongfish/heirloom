// In-process dashboard server: security checks, task API, SSE, idle shutdown. Prediction and
// judgment are covered in judge.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { judge } from '../helpers/judge-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { readEvents, deriveState, appendEvent } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

/**
 * @param {number} port
 * @param {{ method?: string, path?: string, headers?: Record<string, string>, body?: unknown }} [options]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: any, text: string }>}
 */
function request(port, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = undefined;
          }
          resolve({ status: /** @type {number} */ (res.statusCode), headers: res.headers, body: parsed, text });
        });
      },
    );
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** @param {string} home @param {Partial<Parameters<typeof createDashboardServer>[0]>} [extra] */
async function start(home, extra = {}) {
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file', ...extra });
  return server;
}

/**
 * @param {{ port: number, token: string }} s
 * @param {string} p
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
const post = (s, p, body, headers = {}) =>
  request(s.port, {
    method: 'POST',
    path: p,
    headers: { 'content-type': 'application/json', 'x-heirloom-token': s.token, origin: `http://127.0.0.1:${s.port}`, ...headers },
    body,
  });

test('health identifies the server; no CORS headers; security headers present', async (t) => {
  const s = await start(await tempDir('home'));
  t.after(() => s.close());
  const r = await request(s.port, { path: '/__heirloom/health' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'heirloom');
  assert.equal(r.body.version, '0.0.0-test');
  assert.equal(r.body.codeHash, 'test');
  assert.equal(r.body.pid, process.pid);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('requests with a foreign Host or Origin are rejected', async (t) => {
  const s = await start(await tempDir('home'));
  t.after(() => s.close());
  assert.equal((await request(s.port, { path: '/api/tasks', headers: { host: 'evil.example:80' } })).status, 403);
  assert.equal((await request(s.port, { path: '/api/tasks', headers: { host: `attacker.localhost:${s.port}` } })).status, 403);
  assert.equal((await request(s.port, { path: '/api/tasks', headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await request(s.port, { path: '/api/tasks', headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(s.port, { path: '/api/tasks', headers: { host: `localhost:${s.port}` } })).status, 200);
});

test('state-changing requests need the session token and JSON', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home);
  t.after(() => s.close());
  const p = `/api/tasks/${taskId}/discard`;
  assert.equal((await post(s, p, {}, { 'x-heirloom-token': '' })).status, 403);
  assert.equal((await post(s, p, {}, { 'x-heirloom-token': 'x'.repeat(s.token.length) })).status, 403);
  assert.equal((await post(s, p, 'reason=x', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'awaiting_approval');
});

test('the page carries the session token; the API never returns it', async (t) => {
  const s = await start(await tempDir('home'));
  t.after(() => s.close());
  const page = await request(s.port, { path: '/' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'] ?? '', /text\/html/);
  assert.ok(page.text.includes(s.token));
  assert.match(String(page.headers['content-security-policy'] ?? ''), /default-src 'self'/);
  const list = await request(s.port, { path: '/api/tasks' });
  assert.ok(!list.text.includes(s.token));
});

test('task list and detail', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home);
  t.after(() => s.close());
  const list = await request(s.port, { path: '/api/tasks' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.tasks.map((/** @type {any} */ x) => [x.taskId, x.state]), [[taskId, 'awaiting_approval']]);

  const detail = await request(s.port, { path: `/api/tasks/${taskId}` });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.state, 'awaiting_approval');
  assert.match(detail.body.draftSha256, /^[0-9a-f]{64}$/);
  assert.equal(detail.body.judge.revealed, false);
  assert.equal(detail.body.draft.questions.length, 4);
  assert.equal(detail.body.latestApproval, null);

  assert.equal((await request(s.port, { path: '/api/tasks/t-20261112-zzzzzzzz' })).status, 404);
  assert.equal((await request(s.port, { path: '/api/tasks/..%2F..%2Fetc' })).status, 400);
});

test('item approval (before the pivot) is gone: /approve is not a route', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home);
  t.after(() => s.close());
  const task = (await request(s.port, { path: `/api/tasks/${taskId}` })).body;
  const r = await post(s, `/api/tasks/${taskId}/approve`, { kind: 'full', draftSha256: task.draftSha256, sourceHash: task.input.source.hash, summary: ['x'], items: [] });
  assert.equal(r.status, 404);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'awaiting_approval');
});

test('discard moves the task to discarded', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home);
  t.after(() => s.close());
  assert.equal((await post(s, `/api/tasks/${taskId}/discard`, { reason: '필요 없음' })).status, 200);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'discarded');
});

test('SSE announces task updates', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home, { debounceMs: 20 });
  t.after(() => s.close());

  const received = new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: s.port, path: '/api/events', headers: { host: `127.0.0.1:${s.port}` } }, (res) => {
      assert.match(res.headers['content-type'] ?? '', /text\/event-stream/);
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: task-updated') && buf.includes(taskId)) {
          req.destroy();
          resolve(true);
        }
      });
    });
    req.on('error', (err) => (/** @type {any} */ (err).code === 'ECONNRESET' ? undefined : reject(err)));
    setTimeout(() => reject(new Error('no task-updated event')), 3000).unref();
  });
  await new Promise((r) => setTimeout(r, 100));
  await appendEvent(taskPaths(home, taskId).events, { type: 'dashboard_opened' });
  assert.equal(await received, true);
});

test('idle shutdown fires without requests or SSE clients, not while an SSE client is connected', async (t) => {
  const home = await tempDir('home');
  let idleA = 0;
  const a = await start(home, { idleMs: 150, idleCheckMs: 25, onIdle: () => void (idleA += 1) });
  t.after(() => a.close());
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(idleA >= 1, 'idle callback fired');

  let idleB = 0;
  const b = await start(home, { idleMs: 150, idleCheckMs: 25, onIdle: () => void (idleB += 1) });
  t.after(() => b.close());
  const req = http.get({ host: '127.0.0.1', port: b.port, path: '/api/events', headers: { host: `127.0.0.1:${b.port}` } });
  req.on('error', () => {});
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(idleB, 0, 'an open SSE connection keeps the server alive');
  req.destroy();
});

test('static assets: page links the vendored SEED CSS, app.css and app.js; only listed files are served', async (t) => {
  const s = await start(await tempDir('home'));
  t.after(() => s.close());
  const page = await request(s.port, { path: '/r/r-x/w/w-y/t/t-20261112-abcdefgh' });
  assert.equal(page.status, 200);
  const hrefs = [...page.text.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.includes('/assets/seed/base.min.css'));
  assert.ok(hrefs.includes('/assets/seed/recipes/action-button.css'));
  assert.ok(hrefs.includes('/assets/app.css'));
  assert.ok(hrefs.includes('/assets/app.js'));
  for (const href of hrefs) {
    const r = await request(s.port, { path: href });
    assert.equal(r.status, 200, href);
    assert.match(String(r.headers['content-type']), href.endsWith('.js') ? /text\/javascript/ : /text\/css/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal((await request(s.port, { path: '/assets/seed/VENDOR.json' })).status, 404);
  assert.equal((await request(s.port, { path: '/assets/seed/LICENSE' })).status, 404);
  assert.equal((await request(s.port, { path: '/assets/../server.mjs' })).status, 404);
  assert.equal((await request(s.port, { path: '/assets/%2e%2e/server.mjs' })).status, 404);
});

test('task list: stale flag and the overview sections', async (t) => {
  const { home, taskId } = await submittedTask();
  const s = await start(home, { now: () => Date.now() + 8 * 24 * 3600_000 });
  t.after(() => s.close());
  const list = await request(s.port, { path: '/api/tasks' });
  assert.equal(list.status, 200);
  assert.equal(list.body.staleDays, 7);
  assert.equal(list.body.tasks[0].taskId, taskId);
  assert.equal(list.body.tasks[0].stale, true);
  assert.deepEqual(list.body.unhanded, []);
  assert.deepEqual(list.body.unchecked, []);
});

test('task detail: the latest judgment', async (t) => {
  const { home, taskId, sourceHash } = await submittedTask();
  const s = await start(home);
  t.after(() => s.close());
  const judgment = await judge({ home, taskId, sourceHash });
  const after = (await request(s.port, { path: `/api/tasks/${taskId}` })).body;
  assert.equal(after.state, 'approved');
  assert.deepEqual([after.latestApproval.id, after.latestApproval.kind, after.latestApproval.outcome], [judgment.id, 'judgment', 'accepted']);
  assert.deepEqual(after.approvals, [judgment.id]);
  assert.ok(!JSON.stringify(after).includes(s.token));
});

test('the overview checks PRs in the background and a closed one expires its task', async (t) => {
  const home = await tempDir('home');
  const taskId = 't-20261112-qqqqqqqq';
  const url = 'https://github.com/acme/widgets/pull/3';
  const events = taskPaths(home, taskId).events;
  await mkdir(path.dirname(events), { recursive: true });
  for (const e of [
    { type: 'prepared', sourceHash: `sha256:${'b'.repeat(64)}`, attempt: 1 },
    { type: 'draft_checked', ok: true },
    { type: 'awaiting_approval' },
    { type: 'approved', approvalId: 'ap-000000000001' },
    { type: 'records_written', approvalId: 'ap-000000000001', files: [] },
    { type: 'pr_created', approvalId: 'ap-000000000001', url },
  ]) {
    await appendEvent(events, /** @type {any} */ (e));
  }
  const ghDir = await tempDir('gh');
  await writeFile(path.join(ghDir, 'state.json'), JSON.stringify({ prs: [{ number: 3, url, state: 'CLOSED', headRefName: 'feat', baseRefName: 'main' }] }));
  const saved = { PATH: process.env.PATH, FAKE_GH_STATE: process.env.FAKE_GH_STATE };
  const fakeGh = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'fake-gh');
  process.env.PATH = `${fakeGh}${path.delimiter}${saved.PATH}`;
  process.env.FAKE_GH_STATE = path.join(ghDir, 'state.json');
  t.after(() => {
    process.env.PATH = saved.PATH;
    if (saved.FAKE_GH_STATE === undefined) delete process.env.FAKE_GH_STATE;
    else process.env.FAKE_GH_STATE = saved.FAKE_GH_STATE;
  });

  const s = await start(home);
  t.after(() => s.close());
  const first = await request(s.port, { path: '/api/tasks' });
  assert.equal(first.body.tasks.find((/** @type {any} */ x) => x.taskId === taskId).state, 'pr_created', 'the list does not wait for gh');
  let state = 'pr_created';
  for (let i = 0; i < 50 && state !== 'expired'; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    state = /** @type {string} */ (deriveState(await readEvents(events)));
  }
  assert.equal(state, 'expired');
  const after = await request(s.port, { path: '/api/tasks' });
  assert.equal(after.body.tasks.find((/** @type {any} */ x) => x.taskId === taskId).state, 'expired');
});
