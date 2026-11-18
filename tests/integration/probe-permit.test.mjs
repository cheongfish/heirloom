// The person allows probe commands before they run (pivot plan 11, dangerous probe commands):
// nothing runs until a signed allowance covers every command, a denial comes back with its
// reason, and commands allowed once in a repository run later without asking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { decideProbePermit, permitPending, probePermitView, runPermittedProbes } from '../../skills/using-heirloom/lib/probe-permit.mjs';
import { verify } from '../../skills/using-heirloom/lib/sign.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'probe.mjs');
const READ_A = ['node', '-e', "import('./src/a.mjs').then((m) => console.log(m.a))"];
const P1 = { id: 'p1', title: 'a의 값', run: READ_A };
const SPEC = { probes: [P1], tests: { command: ['node', '--test', '--test-reporter=tap'], parser: /** @type {const} */ ('node-tap') } };

async function preparedTask() {
  const upstream = await makeRepo({ 'package.json': '{ "type": "module" }\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  repo.commitAll('a');
  const home = await tempDir('home');
  await writeFile(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 1, dashboard: { openBrowser: true } }));
  const prepared = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  return { repo, home, taskId: prepared.taskId };
}

/** Dashboard stubs that record what would be opened. */
function screen() {
  /** @type {string[]} */
  const opened = [];
  return {
    opened,
    ensure: async () => ({ status: 'reused', url: 'http://127.0.0.1:1/' }),
    open: async (/** @type {string} */ url) => {
      opened.push(url);
      return { opened: true };
    },
  };
}

/** @param {string} file */
const exists = (file) => access(file).then(() => true, () => false);

/**
 * @param {number} port
 * @param {{ method?: string, path: string, token?: string, body?: unknown }} o
 * @returns {Promise<{ status: number, body: any }>}
 */
function request(port, { method = 'GET', path: p, token, body }) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-heirloom-token': token ?? '', origin: `http://127.0.0.1:${port}` }) };
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: /** @type {number} */ (res.statusCode), body: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('nothing runs before the person answers; the request is shown once with every command', async () => {
  const { home, taskId } = await preparedTask();
  const paths = taskPaths(home, taskId);
  const s = screen();
  const out = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...s }));
  assert.equal(out.permission.state, 'pending');
  assert.equal(out.timedOut, true);
  assert.deepEqual(out.permission.commands, [{ role: 'probe', id: 'p1', run: READ_A }, { role: 'tests', run: SPEC.tests.command }]);
  assert.equal(await exists(path.join(paths.probes, 'result.json')), false, 'no probe ran');
  assert.equal(s.opened.length, 1, 'a new request opens the dashboard');

  const again = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...s }));
  assert.equal(again.permission.requestSha256, out.permission.requestSha256);
  assert.equal(s.opened.length, 1, 'the same request does not open the browser again');
  const events = await readEvents(paths.events);
  assert.equal(events.filter((e) => e.type === 'probe_permit_requested').length, 1);
  assert.equal(permitPending(events), true);
  const view = /** @type {any} */ (await probePermitView({ home, taskId }));
  assert.equal(view.pending, true);
  assert.deepEqual(view.request.commands.map((/** @type {any} */ c) => [c.role, c.known]), [['probe', false], ['tests', false]]);
});

test('a denial needs a reason and comes back to the agent; changed probes ask again', async () => {
  const { home, taskId } = await preparedTask();
  const s = screen();
  const asked = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...s }));
  const sha = asked.permission.requestSha256;
  const decide = (/** @type {unknown} */ body) => decideProbePermit({ home, taskId, request: body }).then(() => 'ok', (/** @type {any} */ e) => `${e.code}: ${e.message}`);
  assert.match(await decide({ requestSha256: sha, decision: 'denied' }), /E_INPUT: 거절할 때는 이유가 필요함/);
  assert.match(await decide({ requestSha256: 'f'.repeat(64), decision: 'allowed' }), /E_CONFLICT: 화면이 보던 탐침 명령이/);
  assert.equal(await decide({ requestSha256: sha, decision: 'denied', reason: '테스트 전체를 돌릴 필요 없음' }), 'ok');
  assert.match(await decide({ requestSha256: sha, decision: 'allowed' }), /E_CONFLICT: 이 탐침 명령에는 이미 답함/);

  await assert.rejects(runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...s }), (/** @type {any} */ e) => e.code === 'E_INPUT' && /테스트 전체를 돌릴 필요 없음/.test(e.message));
  const fixed = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: { probes: [P1] }, timeoutMs: 0, ...s }));
  assert.equal(fixed.permission.state, 'pending', 'a new set of commands is a new request');
  assert.notEqual(fixed.permission.requestSha256, sha);
  assert.equal(s.opened.length, 2);
});

test('allowed in the dashboard: the waiting run starts, records the permit, and the same commands later run without asking', async (t) => {
  const { home, taskId } = await preparedTask();
  const paths = taskPaths(home, taskId);
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const s = screen();
  const waiting = runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 60_000, pollMs: 50, ...s });

  /** @type {any} */
  let detail;
  for (let i = 0; i < 100 && !detail?.probePermit?.pending; i++) {
    detail = (await request(server.port, { path: `/api/tasks/${taskId}` })).body;
    if (!detail.probePermit?.pending) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(detail.probePermit.pending, true);
  const listed = (await request(server.port, { path: '/api/tasks' })).body.tasks.find((/** @type {any} */ x) => x.taskId === taskId);
  assert.equal(listed.permitPending, true);
  const res = await request(server.port, { method: 'POST', path: `/api/tasks/${taskId}/probe-permit`, token: server.token, body: { requestSha256: detail.probePermit.request.sha256, decision: 'allowed' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(await verify(home, res.body.permit), { ok: true });

  const out = /** @type {any} */ (await waiting);
  assert.deepEqual(out.permission, { state: 'allowed', permitId: res.body.permit.id });
  assert.equal(out.probes[0].head.stdout, '2\n');
  assert.deepEqual((/** @type {any} */ (await readJson(path.join(paths.probes, 'result.json')))).permit, { permitId: res.body.permit.id });
  assert.equal((await request(server.port, { path: `/api/tasks/${taskId}` })).body.probePermit.pending, false);

  // Every command allowed: no request. A subset is allowed too.
  const subset = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: { probes: [P1] }, timeoutMs: 0, ...s }));
  assert.deepEqual(subset.permission, { state: 'allowed', permitId: null });
  // One new command asks again, and the screen marks which commands were allowed before.
  const more = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: { probes: [P1, { id: 'p2', title: '버전', run: ['node', '--version'] }] }, timeoutMs: 0, ...s }));
  assert.equal(more.permission.state, 'pending');
  assert.deepEqual(more.permission.commands.map((/** @type {any} */ c) => c.id), ['p2']);
  const view = /** @type {any} */ (await probePermitView({ home, taskId }));
  assert.deepEqual(view.request.commands.map((/** @type {any} */ c) => [c.id, c.known]), [['p1', true], ['p2', false]]);
});

test('a permit file without a valid signature allows nothing', async () => {
  const { home, taskId } = await preparedTask();
  const paths = taskPaths(home, taskId);
  const asked = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...screen() }));
  const signed = await decideProbePermit({ home, taskId, request: { requestSha256: asked.permission.requestSha256, decision: 'denied', reason: '아직' } });
  // Turn the signed denial into an allowance by hand.
  await writeFile(path.join(paths.probePermits, `${signed.id}.json`), JSON.stringify({ ...signed, decision: 'allowed', reason: undefined }));
  const out = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: SPEC, timeoutMs: 0, ...screen() }));
  assert.equal(out.permission.state, 'pending');
  assert.equal(await exists(path.join(paths.probes, 'result.json')), false);
});

test('probe.mjs runs only commands the person allowed; an unreadable file fails first', async () => {
  const { repo, home, taskId } = await preparedTask();
  const dir = await tempDir('probes');
  await writeFile(path.join(dir, 'probes.json'), JSON.stringify({ probes: [P1] }));
  const asked = /** @type {any} */ (await runPermittedProbes({ home, taskId, spec: { probes: [P1] }, timeoutMs: 0, ...screen() }));
  await decideProbePermit({ home, taskId, request: { requestSha256: asked.permission.requestSha256, decision: 'allowed' } });
  const run = (/** @type {string[]} */ args, /** @type {string} */ cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HEIRLOOM_HOME: home } });
  const ok = run(['--task', taskId, '--file', 'probes.json', '--timeout-minutes', '0'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  const data = JSON.parse(ok.stdout).data;
  assert.equal(data.probes[0].head.stdout, '2\n');
  assert.equal(data.permission.state, 'allowed');
  const missing = run(['--task', taskId, '--file', 'nope.json'], repo.dir);
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).error.message, /탐침 파일을 읽지 못함/);
});
