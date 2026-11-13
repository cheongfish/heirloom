// Merge detection, record status and recall against temporary repositories (MVP-PLAN M6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
import { renderBody, serializeRecord } from '../../skills/using-heirloom/lib/records.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { taskIdFor } from '../../skills/using-heirloom/lib/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'recall-context', 'scripts', 'recall.mjs');

const OTHER_TASK = 't-20261101-77777777';
const ap = (/** @type {string} */ id) => ({ id, signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' });

/**
 * Record file text.
 * @param {string} id
 * @param {Record<string, any>} [over]
 */
function recordText(id, over = {}) {
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
  const body = renderBody(kind, kind === 'axiom' ? { property: '성질' } : { problem: '문제', choice: '선택' });
  return serializeRecord({ meta: /** @type {any} */ (meta), body });
}

/** @param {string} id */
const recordFile = (id) => `.heirloom/${id.startsWith('a-') ? 'axioms' : 'decisions'}/${id}.md`;

/**
 * upstream main: d-00000001 (active, src/a.mjs, topic money), d-00000002 (superseded by
 * d-00000001), a-00000001 (axiom on src/**). The clone works on `feat`.
 */
async function setup() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  await upstream.write(recordFile('d-00000001'), recordText('d-00000001', { codePaths: ['src/a.mjs'], topics: ['money'], supersedes: [{ id: 'd-00000002', reason: 'r' }] }));
  await upstream.write(recordFile('d-00000002'), recordText('d-00000002', { codePaths: ['src/a.mjs'], active: false, supersededBy: 'd-00000001' }));
  await upstream.write(recordFile('a-00000001'), recordText('a-00000001', { codePaths: ['src/**'] }));
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

test('active comes from the base branch; superseded records are never served as rules', async () => {
  const { repo, home } = await setup();
  const out = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.equal(out.merge.status, 'checked');
  assert.equal(out.merge.ref, 'origin/main');
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['a-00000001', 'active'], ['d-00000001', 'active']]);
  assert.match(out.records[1].text, /^---json\n/);
  assert.match(out.records[1].text, /## 선택과 이유/);
  assert.deepEqual(out.records[1].reasons, ['path:src/a.mjs']);
  assert.deepEqual(out.inactive, [], 'inactive records only appear when asked for by id');
  assert.deepEqual(out.errors, []);

  const byId = await recall({ cwd: repo.dir, home, ids: ['d-00000002', 'd-zzzzzzzz'] });
  assert.deepEqual(byId.records, []);
  assert.deepEqual(byId.inactive.map((i) => [i.id, i.supersededBy]), [['d-00000002', 'd-00000001']]);
  assert.deepEqual(byId.missing, ['d-zzzzzzzz']);
});

test('a record merged after the branch point is active even though the worktree lacks it', async () => {
  const { upstream, repo, home } = await setup();
  await upstream.write(recordFile('d-00000003'), recordText('d-00000003', { topics: ['money'] }));
  upstream.commitAll('d3');
  // Not fetched yet: unknown to this clone.
  assert.deepEqual((await recall({ cwd: repo.dir, home, topics: ['money'] })).records.map((r) => r.id), ['d-00000001']);
  repo.git('fetch', '-q', 'origin');
  const out = await recall({ cwd: repo.dir, home, topics: ['money'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status, r.file]), [
    ['d-00000001', 'active', recordFile('d-00000001')],
    ['d-00000003', 'active', recordFile('d-00000003')],
  ]);
  assert.ok(out.merge.fetchedAt, 'the last fetch time is reported');
});

test('pending records: served to the task that approved them, only warned about otherwise', async () => {
  const { repo, home } = await setup();
  const own = await ownTask(home, repo.dir, 'feat', 'pr_created');
  // This task added d-00000010; a stacked branch's task added d-00000011 and deprecated d-00000001.
  await repo.write(recordFile('d-00000010'), recordText('d-00000010', { taskId: own, topics: ['money'] }));
  await repo.write(recordFile('d-00000011'), recordText('d-00000011', { topics: ['money'] }));
  await repo.write(
    recordFile('d-00000001'),
    recordText('d-00000001', {
      codePaths: ['src/a.mjs'],
      topics: ['money'],
      supersedes: [{ id: 'd-00000002', reason: 'r' }],
      active: false,
      deprecation: { reason: '안 씀', taskId: OTHER_TASK, approval: ap('ap-000000000005') },
    }),
  );

  const out = await recall({ cwd: repo.dir, home, topics: ['money'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['d-00000001', 'active'], ['d-00000010', 'pending']]);
  assert.deepEqual(
    out.pendingWarnings.map((w) => [w.id, w.change, w.taskId, w.seenIn]),
    [
      ['d-00000001', 'deprecate', OTHER_TASK, 'worktree'],
      ['d-00000011', 'add', OTHER_TASK, 'worktree'],
    ],
  );
  assert.ok(!out.records.some((r) => r.id === 'd-00000011'), 'another task’s pending record is not served');

  // Unrelated queries do not carry unrelated warnings.
  assert.deepEqual((await recall({ cwd: repo.dir, home, topics: ['nothing'] })).pendingWarnings, []);

  const ctx = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: ROOT });
  assert.match(ctx, /d-00000010 \[머지 대기\]: d-00000010 제목/);
  assert.match(ctx, /다른 작업의 머지 대기 변경[\s\S]*d-00000011: 추가 제안/);
  assert.match(ctx, /d-00000001: 폐기 제안/);
  assert.match(ctx, /머지 판정: origin\/main 기준/);
});

test('own pending records of an expired task are dropped', async () => {
  const { repo, home } = await setup();
  const own = await ownTask(home, repo.dir, 'feat', 'expired');
  await repo.write(recordFile('d-00000010'), recordText('d-00000010', { taskId: own, topics: ['money'] }));
  const out = await recall({ cwd: repo.dir, home, topics: ['money'] });
  assert.deepEqual(out.records.map((r) => r.id), ['d-00000001']);
  assert.deepEqual(out.pendingWarnings, []);
});

test('another worktree’s approved supersede is warned about until the base branch has it', async () => {
  const { upstream, repo, home } = await setup();
  await resolveIds(home, await repoInfo(repo.dir));
  const otherDir = path.join(await tempDir('wt'), 'other');
  repo.git('worktree', 'add', '-q', '-b', 'other', otherDir, 'origin/main');
  const taskId = await ownTask(home, otherDir, 'other', 'approved');
  const paths = taskPaths(home, taskId);
  const newId = 'd-00000020';
  await writeFile(
    paths.draft,
    JSON.stringify({
      records: [
        { op: 'add', id: newId, kind: 'decision', title: '새 결정', codePaths: ['lib/**'], topics: [] },
        { op: 'supersede', target: 'd-00000001', reason: 'r', with: 0 },
      ],
    }),
  );
  await mkdir(paths.approvals, { recursive: true });
  await writeFile(
    path.join(paths.approvals, 'ap-000000000077.json'),
    JSON.stringify({ id: 'ap-000000000077', items: [{ index: 0, decision: 'approved' }, { index: 1, decision: 'approved' }] }),
  );

  const out = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'] });
  assert.deepEqual(out.pendingWarnings.map((w) => [w.id, w.change, w.by, w.taskId, w.seenIn]), [['d-00000001', 'supersede', newId, taskId, 'task']]);
  assert.deepEqual((await recall({ cwd: repo.dir, home, paths: ['lib/x.mjs'] })).pendingWarnings.map((w) => [w.id, w.change]), [[newId, 'add']]);

  // Merged upstream (any wording): no longer pending.
  await upstream.write(recordFile(newId), recordText(newId, { taskId, approval: ap('ap-000000000077'), title: '리뷰에서 고친 제목' }));
  await upstream.write(
    recordFile('d-00000001'),
    recordText('d-00000001', { codePaths: ['src/a.mjs'], topics: ['money'], supersedes: [{ id: 'd-00000002', reason: 'r' }], active: false, supersededBy: newId }),
  );
  upstream.commitAll('merge other');
  repo.git('fetch', '-q', 'origin');
  const merged = await recall({ cwd: repo.dir, home, paths: ['src/a.mjs'], ids: [newId] });
  assert.deepEqual(merged.pendingWarnings, []);
  assert.deepEqual(merged.records.map((r) => [r.id, r.title]), [[newId, '리뷰에서 고친 제목'], ['a-00000001', 'a-00000001 제목']]);
});

test('without a resolvable base branch the merge state is unknown and worktree files are used', async () => {
  const repo = await makeRepo({ 'src/a.mjs': '1\n' });
  await repo.write(recordFile('d-00000001'), recordText('d-00000001', { topics: ['money'] }));
  await repo.write(recordFile('d-00000002'), recordText('d-00000002', { topics: ['money'], active: false }));
  const home = await tempDir('home');
  const view = await recordView({ cwd: repo.dir, home });
  assert.equal(view.merge.status, 'unknown');
  assert.match(String(view.merge.reason), /원격이 없어/);
  const out = await recall({ cwd: repo.dir, home, topics: ['money'] });
  assert.deepEqual(out.records.map((r) => [r.id, r.status]), [['d-00000001', 'unknown']]);
  assert.match(await buildSessionContext({ cwd: repo.dir, home, pluginRoot: ROOT }), /머지 판정: 미확인/);
});

test('limits: --limit and the token budget, with what was left out', async () => {
  const { repo, home } = await setup();
  const limited = await recall({ cwd: repo.dir, home, paths: ['src'], limit: 1 });
  assert.deepEqual(limited.records.map((r) => r.id), ['a-00000001']);
  assert.equal(limited.excluded.count, 1);
  assert.equal(limited.excluded.byLimit, 1);
  assert.deepEqual(limited.excluded.items.map((e) => [e.id, e.reason]), [['d-00000001', 'limit']]);

  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, recall: { maxTokens: 10 } }));
  const tight = await recall({ cwd: repo.dir, home, paths: ['src'] });
  assert.deepEqual(tight.records, []);
  assert.equal(tight.excluded.byTokens, 2);
  assert.equal(tight.limits.maxTokens, 10);
});

test('no query: the changed code files are used', async () => {
  const { repo, home } = await setup();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  await repo.write('docs/note.md', '# n\n');
  const out = await recall({ cwd: repo.dir, home });
  assert.deepEqual(out.query.paths, ['src/a.mjs']);
  assert.equal(out.query.from, 'changed');
  assert.deepEqual(out.records.map((r) => r.id), ['a-00000001', 'd-00000001']);
});

test('no query and no changed code files: an input error, not an empty result', async () => {
  const { repo, home } = await setup();
  // Only a Markdown file changed: there is still nothing to look up by.
  await repo.write('docs/note.md', '# n\n');
  await assert.rejects(recall({ cwd: repo.dir, home }), (/** @type {any} */ e) => {
    assert.equal(e.code, 'E_INPUT');
    assert.match(e.hint, /--paths/);
    return true;
  });
  const run = spawnSync(process.execPath, [SCRIPT], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, HEIRLOOM_HOME: home } });
  assert.equal(run.status, 2);
  assert.equal(JSON.parse(run.stdout).ok, false);
});

test('recall.mjs prints one JSON object; a bad --limit exits 2', async () => {
  const { repo, home } = await setup();
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo.dir, encoding: 'utf8', env: { ...process.env, HEIRLOOM_HOME: home } });
  const ok = run(['--paths', 'src/a.mjs', '--topics', 'money,other', '--ids', 'd-00000002']);
  assert.equal(ok.status, 0, ok.stderr);
  const body = JSON.parse(ok.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.data.query.topics, ['money', 'other']);
  assert.deepEqual(body.data.records.map((/** @type {any} */ r) => r.id), ['d-00000001', 'a-00000001']);
  assert.deepEqual(body.data.inactive.map((/** @type {any} */ r) => r.id), ['d-00000002']);
  const bad = run(['--limit', '0']);
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).ok, false);
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
