// Merge status, anchor check and recall of decision records against temporary repositories
// (pivot 7.3). Records written before the pivot are past records: named, never served.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { appendEvent, deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { checkPrExpiry, refreshPrExpiry } from '../../skills/using-heirloom/lib/pr-expiry.mjs';
import { recall } from '../../skills/using-heirloom/lib/recall.mjs';
import { recordView } from '../../skills/using-heirloom/lib/record-status.mjs';
import { serializeRecord } from '../../skills/using-heirloom/lib/records.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { taskIdFor } from '../../skills/using-heirloom/lib/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'recall-context', 'scripts', 'recall.mjs');

const OTHER_TASK = 't-20261101-77777777';
const ap = (/** @type {string} */ id) => ({ id, signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' });
const ANCHORS = [
  { file: 'src/a.mjs', symbol: 'a' },
  { file: 'test/a.test.mjs', test: 'a is one' },
];

/**
 * A schema 2 decision record.
 * @param {string} id
 * @param {Record<string, any>} [over]
 */
function decisionText(id, over = {}) {
  const meta = {
    schemaVersion: 2,
    id,
    kind: 'decision',
    choice: `${id} 선택`,
    question: '질문',
    scope: ['src/a.mjs'],
    anchors: ANCHORS,
    source: [{ kind: 'fork-answer', approval: 'ap-000000000001', question: 'q1' }],
    replaces: null,
    taskId: OTHER_TASK,
    approval: ap('ap-000000000001'),
    ...over,
  };
  return serializeRecord({ meta: /** @type {any} */ (meta), body: '\n## 질문\n\n질문\n' });
}

/**
 * A record from before the pivot (schema 1).
 * @param {string} id
 * @param {Record<string, any>} [over]
 */
function legacyText(id, over = {}) {
  const kind = id.startsWith('a-') ? 'axiom' : 'decision';
  const meta = {
    schemaVersion: 1,
    id,
    kind,
    title: `${id} 제목`,
    active: true,
    codePaths: [],
    topics: [],
    supersedes: [],
    supersededBy: null,
    relations: [],
    sources: [{ ref: 'docs/spec.md', sha256: 'a'.repeat(64) }],
    taskId: OTHER_TASK,
    approval: ap('ap-000000000001'),
    ...over,
  };
  const body = kind === 'axiom' ? '\n## 유지할 성질\n\n성질\n' : '\n## 문제\n\n문제\n\n## 선택과 이유\n\n선택\n';
  return serializeRecord({ meta: /** @type {any} */ (meta), body });
}

/** @param {string} id */
const recordFile = (id) => `.heirloom/${id.startsWith('a-') ? 'axioms' : 'decisions'}/${id}.md`;

const A_TEST = "import { test } from 'node:test';\ntest('a is one', () => {});\n";

/**
 * upstream main: d-00000001 (schema 2 on src/a.mjs), d-00000009 (schema 1, src/a.mjs, topic
 * money) and a-00000001 (axiom on src/**). The clone works on `feat`.
 */
async function setup() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n', 'test/a.test.mjs': A_TEST });
  await upstream.write(recordFile('d-00000001'), decisionText('d-00000001'));
  await upstream.write(recordFile('d-00000009'), legacyText('d-00000009', { codePaths: ['src/a.mjs'], topics: ['money'] }));
  await upstream.write(recordFile('a-00000001'), legacyText('a-00000001', { codePaths: ['src/**'] }));
  upstream.commitAll('records');
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  const home = await tempDir('home');
  return { upstream, repo, home };
}

/**
 * Register a task of this worktree on `branch` and move it to `state`.
 * @param {string} home
 * @param {string} dir
 * @param {string | null} branch
 * @param {'approved' | 'pr_created' | 'expired'} state
 */
async function ownTask(home, dir, branch, state) {
  const { worktreeId } = await resolveIds(home, await repoInfo(dir));
  const taskId = /** @type {string} */ (await taskIdFor(home, { worktreeId, branch, specRef: null }));
  await driveTo(home, taskId, state);
  return taskId;
}

/**
 * @param {string} home
 * @param {string} taskId
 * @param {'approved' | 'pr_created' | 'expired'} state
 */
async function driveTo(home, taskId, state) {
  const events = taskPaths(home, taskId).events;
  await mkdir(path.dirname(events), { recursive: true });
  /** @type {Record<string, unknown>[]} */
  const steps = [
    { type: 'prepared', sourceHash: `sha256:${'b'.repeat(64)}`, attempt: 1 },
    { type: 'draft_checked', ok: true },
    { type: 'awaiting_approval' },
    { type: 'approved', approvalId: 'ap-000000000077' },
  ];
  if (state !== 'approved') steps.push({ type: 'records_written', approvalId: 'ap-000000000077', files: [] }, { type: 'pr_created', approvalId: 'ap-000000000077', url: `https://github.com/acme/widgets/pull/${taskId}` });
  if (state === 'expired') steps.push({ type: 'expired', reason: 'pr_closed' });
  for (const e of steps) await appendEvent(events, /** @type {any} */ (e));
}


/**
 * A probe run of a task of this repository whose head test results hold `results`.
 * @param {string} home
 * @param {string} taskId
 * @param {Record<string, string>} results name → status
 * @param {string} ranAt
 */
async function testRun(home, taskId, results, ranAt) {
  const dir = taskPaths(home, taskId).probes;
  await mkdir(dir, { recursive: true });
  const head = { parsed: true, results: Object.fromEntries(Object.entries(results).map(([n, status]) => [n, { status, location: null }])) };
  await writeFile(path.join(dir, 'result.json'), JSON.stringify({ ranAt, tests: { head } }));
}

test('schema 2 records are served with their anchors checked; past records are only named', async () => {
  const { repo, home } = await setup();
  const out = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'], topics: ['money'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status, r.anchorCheck, r.choice]), [['d-00000001', 'active', 'active', 'd-00000001 선택']]);
  assert.deepEqual(out.records[0].anchors, [
    { file: 'src/a.mjs', symbol: 'a', found: true },
    { file: 'test/a.test.mjs', test: 'a is one', found: true, lastRun: null },
  ]);
  assert.deepEqual(out.legacy.map((r) => [r.id, r.kind]), [['a-00000001', 'axiom'], ['d-00000009', 'decision']]);
  assert.match(out.records[0].text, /"schemaVersion": 2/);
});

test('a missing anchor or a test that failed on its last run makes a record possibly-stale', async () => {
  const { repo, home } = await setup();
  const own = await ownTask(home, repo.dir, 'feat', 'approved');
  await testRun(home, own, { 'a is one': 'pass' }, '2026-11-10T00:00:00.000Z');
  const passed = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.deepEqual(passed.records[0].anchors[1].lastRun, { status: 'pass', at: '2026-11-10T00:00:00.000Z' });
  assert.equal(passed.records[0].anchorCheck, 'active');

  const other = await ownTask(home, repo.dir, 'other', 'approved');
  await testRun(home, other, { 'a is one': 'fail' }, '2026-11-11T00:00:00.000Z');
  const failed = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.equal(failed.records[0].anchorCheck, 'possibly-stale', 'the newest run counts');

  await rm(path.join(taskPaths(home, other).probes, 'result.json'));
  await repo.write('src/a.mjs', 'export const b = 1;\n');
  const renamed = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.equal(renamed.records[0].anchorCheck, 'possibly-stale');
  assert.equal(renamed.records[0].anchors[0].found, false);
});

test('a record merged after the branch point is active even though the worktree lacks it', async () => {
  const { upstream, repo, home } = await setup();
  await upstream.write(recordFile('d-00000003'), decisionText('d-00000003'));
  upstream.commitAll('later');
  repo.git('fetch', '-q', 'origin');
  const out = await recall({ cwd: repo.dir, home, ids: ['d-00000003'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['d-00000003', 'active']]);
});

test('pending records: served to the task that wrote them, only warned about otherwise', async () => {
  const { repo, home } = await setup();
  const own = await ownTask(home, repo.dir, 'feat', 'approved');
  await repo.write(recordFile('d-00000004'), decisionText('d-00000004', { taskId: own }));
  await repo.write(recordFile('d-00000005'), decisionText('d-00000005'));
  const out = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['d-00000001', 'active'], ['d-00000004', 'pending']]);
  assert.deepEqual(out.pendingWarnings.map((w) => [w.id, w.change, w.taskId, w.seenIn]), [['d-00000005', 'add', OTHER_TASK, 'worktree']]);
});

test('own pending records of an expired task are dropped', async () => {
  const { repo, home } = await setup();
  const own = await ownTask(home, repo.dir, 'feat', 'expired');
  await repo.write(recordFile('d-00000004'), decisionText('d-00000004', { taskId: own }));
  const out = await recall({ cwd: repo.dir, home, ids: ['d-00000004'] });
  assert.deepEqual(out.records, []);
});

test('without a resolvable base branch the merge state is unknown and worktree files are used', async () => {
  const repo = await makeRepo({ 'src/a.mjs': 'export const a = 1;\n', 'test/a.test.mjs': A_TEST });
  await repo.write(recordFile('d-00000001'), decisionText('d-00000001'));
  const home = await tempDir('home');
  const view = await recordView({ cwd: repo.dir, home });
  assert.equal(view.merge.status, 'unknown');
  assert.match(String(view.merge.reason), /원격이 없어/);
  const out = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['d-00000001', 'unknown']]);
});

test('limits: --limit and the token budget, with what was left out', async () => {
  const { upstream, repo, home } = await setup();
  await upstream.write(recordFile('d-00000002'), decisionText('d-00000002'));
  upstream.commitAll('second');
  repo.git('fetch', '-q', 'origin');
  const limited = await recall({ cwd: repo.dir, home, paths: ['src'], limit: 1 });
  assert.deepEqual(limited.records.map((r) => r.id), ['d-00000001']);
  assert.deepEqual(limited.excluded.items.map((e) => [e.id, e.reason]), [['d-00000002', 'limit']]);

  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, recall: { maxTokens: 10 } }));
  const tight = await recall({ cwd: repo.dir, home, paths: ['src'] });
  assert.deepEqual(tight.records, []);
  assert.equal(tight.excluded.byTokens, 2);
});

test('no query: the changed code files are used', async () => {
  const { repo, home } = await setup();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  await repo.write('docs/note.md', '# n\n');
  const out = await recall({ cwd: repo.dir, home });
  assert.deepEqual(out.query.paths, ['src/a.mjs']);
  assert.equal(out.query.from, 'changed');
  assert.deepEqual(out.records.map((r) => r.id), ['d-00000001']);
});

test('no query and no changed code files: an input error, not an empty result', async () => {
  const { repo, home } = await setup();
  await repo.write('docs/note.md', '# n\n');
  await assert.rejects(recall({ cwd: repo.dir, home }), (/** @type {any} */ e) => {
    assert.equal(e.code, 'E_INPUT');
    assert.match(e.hint, /--paths/);
    return true;
  });
});

test('recall.mjs prints one JSON object; a bad --limit exits 2', async () => {
  const { repo, home } = await setup();
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, HEIRLOOM_HOME: home } });
  const ok = run(['--paths', 'src/a.mjs', '--ids', 'd-00000009']);
  assert.equal(ok.status, 0, ok.stderr);
  const body = JSON.parse(ok.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.records.map((/** @type {any} */ r) => r.id), ['d-00000001']);
  assert.deepEqual(body.data.legacy.map((/** @type {any} */ r) => r.id), ['a-00000001', 'd-00000009']);
  const bad = run(['--limit', '0']);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

test('session context lists only the scope of schema 2 decisions', async () => {
  const { repo, home } = await setup();
  const text = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: ROOT });
  assert.match(text, /## 결정 기록 범위[^\n]*\n- src\/a\.mjs\n/);
  assert.ok(!text.includes('src/**'), 'an axiom gives no scope');
  assert.ok(!text.includes('선택'), 'no record text');
});

test('PR expiry: closed expires, merged and unknown keep waiting; the list cache skips merged PRs', async () => {
  const { repo, home } = await setup();
  const closed = await ownTask(home, repo.dir, 'a', 'pr_created');
  const merged = await ownTask(home, repo.dir, 'b', 'pr_created');
  const unknown = await ownTask(home, repo.dir, 'c', 'pr_created');
  /** @type {Record<string, 'OPEN' | 'CLOSED' | 'MERGED' | Error>} */
  const answers = { [closed]: 'CLOSED', [merged]: 'MERGED', [unknown]: new Error('gh 실행 파일을 찾지 못함') };
  /** @type {string[]} */
  const asked = [];
  const lookup = async (/** @type {{ cwd: string, url: string }} */ { url }) => {
    const taskId = /** @type {string} */ (url.split('/').at(-1));
    asked.push(taskId);
    const a = answers[taskId];
    if (a instanceof Error) throw a;
    return a;
  };
  const check = (/** @type {string} */ taskId) => checkPrExpiry({ home, taskId, lookup });
  assert.deepEqual(await check(unknown), { state: 'pr_created', pr: null, reason: 'gh 실행 파일을 찾지 못함' });
  assert.deepEqual(await check(merged), { state: 'pr_created', pr: 'MERGED', reason: null });
  assert.deepEqual(await check(closed), { state: 'expired', pr: 'CLOSED', reason: null });
  assert.deepEqual(await check(closed), { state: 'expired', pr: null, reason: 'not_pr_created' });
  assert.deepEqual((await readEvents(taskPaths(home, closed).events)).at(-1)?.reason, 'pr_closed');

  /** @type {Map<string, { pr: string | null, at: number }>} */
  const cache = new Map();
  asked.length = 0;
  const refresh = (/** @type {number} */ now) => refreshPrExpiry({ home, taskIds: [merged, unknown], cache, now, lookup });
  assert.deepEqual(await refresh(0), []);
  await refresh(60_000);
  assert.deepEqual(asked.sort(), [merged, unknown].sort(), 'each asked once within the TTL');
  await refresh(10 * 60_000);
  assert.deepEqual(asked.slice(2), [unknown], 'a merged PR is never asked again; an unknown one is after the TTL');
  assert.equal(deriveState(await readEvents(taskPaths(home, merged).events)), 'pr_created');
});
