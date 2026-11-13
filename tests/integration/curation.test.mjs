// Context curation through the dashboard server: run → dedicated worktree → headless draft →
// approval with reasons → headless apply → merge → worktree removed. The headless agent is a
// fake `claude` (tests/helpers/fake-claude) that follows the skills by script; it never
// reaches a real model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { renderBody, serializeRecord } from '../../skills/using-heirloom/lib/records.mjs';
import { codeHash } from '../../skills/using-heirloom/lib/server-control.mjs';
import { readIndex } from '../../skills/using-heirloom/lib/store.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { evaluateStop } from '../../skills/using-heirloom/lib/reminder.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_CLAUDE_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-claude');
const PATH0 = process.env.PATH;

const DOC = 'docs/money.md';
const DOC_TEXT = '# 금액\n\n금액 계산 결과를 반올림하면 합계가 맞지 않는다.\n';
const sha = (/** @type {string} */ t) => createHash('sha256').update(t).digest('hex');

/** @param {string} id @param {string} title @param {string} approvedAt */
function decision(id, title, approvedAt) {
  const meta = {
    schemaVersion: /** @type {1} */ (1),
    id,
    kind: /** @type {'decision'} */ ('decision'),
    title,
    active: true,
    codePaths: ['src/money/**'],
    topics: ['rounding'],
    supersedes: [],
    supersededBy: null,
    relations: [],
    sources: [{ ref: DOC, sha256: sha(DOC_TEXT), quote: '금액 계산 결과를 반올림하면 합계가 맞지 않는다.' }],
    taskId: 't-20261101-aaaaaaaa',
    approval: { id: 'ap-aaaaaaaaaaaa', signer: 'SHA256:x', approvedAt },
  };
  return serializeRecord({ meta, body: renderBody('decision', { problem: '금액 계산 결과를 반올림하면 합계가 맞지 않는다.', choice: title, alternatives: '', scope: '' }) });
}

const IDS = ['d-00000001', 'd-00000002', 'd-00000003'];

/**
 * A repository whose main branch holds three unreviewed decisions, cloned into the user's
 * working tree (registered with Heirloom) with an uncommitted change of its own.
 */
async function fixture() {
  const upstream = await makeRepo({
    'README.txt': 'hello\n',
    [DOC]: DOC_TEXT,
    'src/money/sum.mjs': 'export const sum = (a, b) => a + b;\n',
    '.heirloom/config.json': JSON.stringify({ schemaVersion: 1, curation: { minUnreviewed: 3 } }),
    [`.heirloom/decisions/${IDS[0]}.md`]: decision(IDS[0], '합계는 반올림하지 않는다', '2026-11-01T00:00:00.000Z'),
    [`.heirloom/decisions/${IDS[1]}.md`]: decision(IDS[1], '단가는 반올림하지 않는다', '2026-11-02T00:00:00.000Z'),
    [`.heirloom/decisions/${IDS[2]}.md`]: decision(IDS[2], '환불은 원 단위로 자른다', '2026-11-03T00:00:00.000Z'),
  });
  const user = await cloneRepo(upstream);
  user.git('checkout', '-q', '-b', 'feat');
  await user.write('src/money/sum.mjs', 'export const sum = (a, b) => a + b; // wip\n');
  const home = await tempDir('home');
  const ids = await resolveIds(home, await repoInfo(user.dir));
  const log = path.join(await tempDir('claude'), 'log.jsonl');
  process.env.FAKE_CLAUDE_LOG = log;
  delete process.env.FAKE_CLAUDE_EXIT;
  process.env.PATH = `${FAKE_CLAUDE_DIR}${path.delimiter}${PATH0}`;

  const server = await createDashboardServer({ home, port: 0, keystore: 'file', codeHash: await codeHash(ROOT), agentTimeoutMs: 60_000 });
  // The headless submit finds this server instead of starting one.
  process.env.HEIRLOOM_PORT = String(server.port);
  const base = `http://127.0.0.1:${server.port}`;
  /** @param {string} p @param {RequestInit} [init] */
  const call = async (p, init = {}) => {
    const res = await fetch(`${base}${p}`, init);
    return { status: res.status, body: /** @type {any} */ (await res.json()) };
  };
  /** @param {string} p @param {unknown} body @param {Record<string, string>} [headers] */
  const post = (p, body, headers = { 'x-heirloom-token': server.token }) =>
    call(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { upstream, user, home, repoId: ids.repoId, server, call, post, log };
}

/**
 * Wait until the n-th headless run of the phase has finished.
 * @param {string} home @param {string} taskId @param {string} phase @param {number} [n]
 */
async function agentFinished(home, taskId, phase, n = 1) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const events = await readEvents(taskPaths(home, taskId).events);
    const finished = events.filter((e) => e.type === 'agent_finished' && e.phase === phase);
    const done = finished[n - 1];
    if (done) return { done, events };
    if (Date.now() > deadline) throw new Error(`headless ${phase} did not finish`);
    await new Promise((r) => setTimeout(r, 100));
  }
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

/** @param {string} file */
async function calls(file) {
  try {
    return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test('curation: run, headless draft, approval with reasons, headless apply, merge, worktree removed', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  const userHead = f.user.git('rev-parse', 'HEAD');
  const userStatus = f.user.git('status', '--porcelain');

  // 1. The overview suggests a curation for the repository.
  const overview = await f.call('/api/tasks');
  const repo = overview.body.curation.find((/** @type {any} */ c) => c.repoId === f.repoId);
  assert.equal(repo.notify, true);
  assert.equal(repo.unreviewed, 3);
  assert.equal((await f.call(`/api/repos/${f.repoId}/curation`)).body.notify, true);
  assert.match(await buildSessionContext({ cwd: f.user.dir, home: f.home, pluginRoot: ROOT }), /맥락 정리 안내: 검토하지 않은 decision이 3개/);

  // 2. Requests can not pick the command, and need the session token.
  assert.equal((await f.post(`/api/repos/${f.repoId}/curate`, { command: 'rm' })).status, 400);
  assert.equal((await f.post(`/api/repos/${f.repoId}/curate`, {}, {})).status, 403);
  assert.equal((await f.post(`/api/repos/${f.repoId}/curate`, {}, { 'x-heirloom-token': f.server.token, origin: 'http://evil.example' })).status, 403);

  // 3. Run: a dedicated worktree on its own branch, and a headless curation in it.
  const started = await f.post(`/api/repos/${f.repoId}/curate`, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const { taskId, worktree, branch } = started.body;
  assert.ok(worktree.startsWith(path.join(f.home, 'worktrees', f.repoId)));
  assert.match(branch, /^heirloom\/curate-\d{8}-[0-9a-z]{4}$/);
  assert.equal((await f.post(`/api/repos/${f.repoId}/curate`, {})).status, 409, 'one curation at a time');

  await agentFinished(f.home, taskId, 'curate');
  const [curateCall] = await calls(f.log);
  assert.equal(curateCall.cwd, worktree);
  const tools = curateCall.args[curateCall.args.indexOf('--allowedTools') + 1].split(',');
  // Claude Code checks file writes against Edit(...) rules only; a Write(...) rule is ignored.
  assert.ok(tools.includes(`Edit(/${path.join(taskPaths(f.home, taskId).dir, 'draft.json')})`));
  assert.ok(!tools.some((/** @type {string} */ x) => x.startsWith('Write(')), 'no Write(...) rules');
  assert.ok(!tools.some((/** @type {string} */ x) => /git|gh |Bash\(\*/.test(x)), 'the curate step can not run git or gh');

  const detail = (await f.call(`/api/tasks/${taskId}`)).body;
  assert.equal(detail.state, 'awaiting_approval');
  assert.equal(detail.input.trigger, 'curation');
  assert.deepEqual(detail.input.curation.batch, IDS);
  assert.equal(detail.targets[IDS[0]].title, '합계는 반올림하지 않는다');
  assert.equal(detail.events.filter((/** @type {any} */ e) => e.type === 'dashboard_opened').length, 1, 'the browser is not opened again');
  const sessionNote = await buildSessionContext({ cwd: f.user.dir, home: f.home, pluginRoot: ROOT });
  assert.match(sessionNote, /맥락 정리: 진행 중/);
  assert.equal((await evaluateStop({ cwd: worktree, home: f.home, stopHookActive: false })).reason, 'managed');
  const index = await readIndex(f.home);
  assert.equal(Object.values(index.worktrees).filter((w) => w.managed).length, 1);
  assert.deepEqual((await f.call('/api/tasks')).body.unhanded.map((/** @type {any} */ u) => u.path), [f.user.dir], 'the curation worktree is not unhanded work');

  // 4. Holding a candidate needs a reason.
  const request = {
    kind: 'full',
    draftSha256: detail.draftSha256,
    sourceHash: detail.input.source.hash,
    summary: ['반올림 결정 두 개를 axiom 후보로 묶었다'],
    items: /** @type {{ index: number, decision: string, reason?: string }[]} */ ([
      { index: 0, decision: 'pending' },
      { index: 1, decision: 'approved' },
    ]),
  };
  assert.equal((await f.post(`/api/tasks/${taskId}/approve`, request)).status, 400);
  request.items[0] = { index: 0, decision: 'pending', reason: '사례가 더 필요함' };
  const approved = await f.post(`/api/tasks/${taskId}/approve`, request);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(typeof approved.body.agent.pid, 'number', 'the approval starts the apply step');

  // 5. Headless apply: records and review history committed on the curation branch, pushed.
  const { done } = await agentFinished(f.home, taskId, 'apply');
  assert.equal(done.exitCode, 0, await readFile(taskPaths(f.home, taskId).agentLog('apply'), 'utf8'));
  const applyCall = (await calls(f.log))[1];
  const applyTools = applyCall.args[applyCall.args.indexOf('--allowedTools') + 1].split(',');
  for (const tool of ['Bash(git add .heirloom*)', 'Bash(git commit *)', 'Bash(git push *)', 'Bash(gh pr create *)', 'Bash(gh api -X PATCH repos/*/pulls/*)']) assert.ok(applyTools.includes(tool), tool);
  // `gh pr edit` fails on some gh versions (GraphQL error about Projects classic); bodies are updated through the REST API.
  assert.ok(!applyTools.some((/** @type {string} */ x) => x.startsWith('Write(') || x.includes('gh pr edit')), 'no Write(...) rules and no gh pr edit');
  const files = f.upstream.git('ls-tree', '-r', '--name-only', branch, '.heirloom').split('\n');
  const reviewFile = files.find((x) => x.startsWith('.heirloom/curation/'));
  assert.ok(reviewFile, 'review history pushed');
  const review = JSON.parse(f.upstream.git('show', `${branch}:${reviewFile}`));
  assert.deepEqual(review.batch, IDS);
  assert.deepEqual(review.candidates, [{ title: '금액은 반올림하지 않는다', evidence: [IDS[0], IDS[1]], decision: 'held', reason: '사례가 더 필요함' }]);
  assert.deepEqual(review.changes, [{ op: 'relate', target: IDS[0], decision: 'approved' }]);
  assert.ok(!files.some((x) => x.startsWith('.heirloom/axioms/')), 'a held candidate writes no axiom');
  assert.match(f.upstream.git('show', `${branch}:.heirloom/decisions/${IDS[0]}.md`), /"condition": "환불 계산일 때"/);

  // The user's working tree never moved.
  assert.equal(f.user.git('rev-parse', 'HEAD'), userHead);
  assert.equal(f.user.git('status', '--porcelain'), userStatus);
  assert.equal(f.user.git('branch', '--show-current'), 'feat');

  // 6. Merged: the batch counts as reviewed and the worktree goes away.
  f.upstream.git('merge', '-q', '--no-ff', '-m', 'merge curation', branch);
  f.user.git('fetch', '-q', 'origin');
  const deadline = Date.now() + 10_000;
  for (;;) {
    await f.call('/api/tasks');
    if ((/** @type {any} */ (await readJson(taskPaths(f.home, taskId).curation)))?.removedAt) break;
    if (Date.now() > deadline) throw new Error('worktree not removed');
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await exists(worktree), false);
  assert.equal(f.user.git('branch', '--list', branch), '');
  const after = (await f.call(`/api/repos/${f.repoId}/curation`)).body;
  assert.equal(after.unreviewed, 0);
  assert.deepEqual(after.inProgress, []);
  assert.equal(after.notify, false);
});

test('curation: a missing command and a failed run stay put, show why, and run again on request', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  await writeFile(path.join(f.home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { command: 'heirloom-no-such-claude' } } }));

  const started = await f.post(`/api/repos/${f.repoId}/curate`, {});
  assert.equal(started.status, 200);
  assert.equal(started.body.agent.error, 'command_missing');
  const { taskId } = started.body;
  let detail = (await f.call(`/api/tasks/${taskId}`)).body;
  assert.equal(detail.state, 'prepared');
  assert.equal(detail.agent.last.error, 'command_missing');
  assert.equal(detail.agent.running, null);

  // A run that fails.
  await writeFile(path.join(f.home, 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  process.env.FAKE_CLAUDE_EXIT = '1';
  const retried = await f.post(`/api/tasks/${taskId}/retry-agent`, {});
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.phase, 'curate');
  await agentFinished(f.home, taskId, 'curate', 2);
  detail = (await f.call(`/api/tasks/${taskId}`)).body;
  assert.equal(detail.agent.last.exitCode, 1);
  assert.equal(detail.state, 'prepared');

  // Run again: it goes through.
  delete process.env.FAKE_CLAUDE_EXIT;
  assert.equal((await f.post(`/api/tasks/${taskId}/retry-agent`, {})).status, 200);
  const deadline = Date.now() + 30_000;
  while (deadline > Date.now() && deriveState(await readEvents(taskPaths(f.home, taskId).events)) !== 'awaiting_approval') await new Promise((r) => setTimeout(r, 100));
  assert.equal(deriveState(await readEvents(taskPaths(f.home, taskId).events)), 'awaiting_approval');
  assert.equal((await f.post(`/api/tasks/${taskId}/retry-agent`, {})).status, 409, 'nothing to run while waiting for the human');
});

test('curation: Codex and Antigravity profiles run the same flow; an Antigravity permission stop is reported', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());

  // Codex: the policy file the per-run hook reads is written before the run.
  await writeFile(path.join(f.home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { host: 'codex' } } }));
  const started = await f.post(`/api/repos/${f.repoId}/curate`, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const { taskId, worktree } = started.body;
  const { done } = await agentFinished(f.home, taskId, 'curate');
  assert.equal(done.exitCode, 0);
  const [codexCall] = await calls(f.log);
  assert.equal(codexCall.cwd, worktree);
  assert.equal(codexCall.args[0], 'exec');
  assert.ok(codexCall.args.includes('--ignore-user-config'));
  const policy = JSON.parse(await readFile(path.join(f.home, 'tasks', taskId, 'agent-curate.policy.json'), 'utf8'));
  assert.deepEqual(policy.writes, [path.join(f.home, 'tasks', taskId, 'draft.json')]);
  assert.equal(deriveState(await readEvents(taskPaths(f.home, taskId).events)), 'awaiting_approval');

  // Antigravity: a run stopped by a missing permission exits with 0 but is a failure.
  const g = await fixture();
  t.after(() => g.server.close());
  await writeFile(path.join(g.home, 'config.json'), JSON.stringify({ schemaVersion: 1, curation: { agent: { host: 'antigravity' } } }));
  process.env.FAKE_AGY_DENY = '1';
  t.after(() => delete process.env.FAKE_AGY_DENY);
  const denied = await g.post(`/api/repos/${g.repoId}/curate`, {});
  assert.equal(denied.status, 200, JSON.stringify(denied.body));
  const first = await agentFinished(g.home, denied.body.taskId, 'curate');
  assert.equal(first.done.exitCode, 0);
  assert.equal(first.done.error, 'permission_denied');
  assert.equal((await g.call(`/api/tasks/${denied.body.taskId}`)).body.agent.last.error, 'permission_denied');
  const [agyCall] = await calls(g.log);
  assert.equal(agyCall.args[0], '-p');
  assert.equal(JSON.parse(agyCall.args[agyCall.args.indexOf('--settings') + 1]).agentMode, '');

  // Run again with the permission: it goes through, and the earlier notice in the same log is not taken for this run.
  delete process.env.FAKE_AGY_DENY;
  assert.equal((await g.post(`/api/tasks/${denied.body.taskId}/retry-agent`, {})).status, 200);
  const second = await agentFinished(g.home, denied.body.taskId, 'curate', 2);
  assert.equal(second.done.error, undefined);
  assert.equal(deriveState(second.events), 'awaiting_approval');
});

test('curation: an unclear target branch refuses to start and creates nothing', async (t) => {
  const f = await fixture();
  t.after(() => f.server.close());
  f.user.git('remote', 'set-head', 'origin', '--delete');
  const status = (await f.call(`/api/repos/${f.repoId}/curation`)).body;
  assert.match(status.error, /origin\/HEAD/);
  assert.equal(status.notify, false);
  const res = await f.post(`/api/repos/${f.repoId}/curate`, {});
  assert.equal(res.status, 400);
  assert.equal(await exists(path.join(f.home, 'worktrees')), false);
});
