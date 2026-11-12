// handoff → approval → apply → PR, against temporary repositories and a fake `gh` (MVP-PLAN M5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { applyApproval, completePr, listPendingApprovals, prTemplateChoice } from '../../skills/using-heirloom/lib/apply.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { readRecords } from '../../skills/using-heirloom/lib/records.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_GH_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-gh');

const PATH0 = process.env.PATH;

// Fetching from github.com must fail fast instead of reaching the network.
process.env.GIT_SSH_COMMAND = 'false';
process.env.GIT_TERMINAL_PROMPT = '0';

/**
 * A submitted task whose origin looks like GitHub, approved in the dashboard, with a fake gh.
 * @param {{ records?: boolean, github?: boolean, gh?: { authed?: boolean, prs?: any[], fail?: string } | null }} [options]
 */
async function approvedTask({ records = true, github = true, gh = {} } = {}) {
  const t = await submittedTask({ records });
  if (github) t.repo.git('remote', 'set-url', 'origin', 'git@github.com:acme/widgets.git');
  const ghDir = await tempDir('gh');
  const log = path.join(ghDir, 'log.jsonl');
  const ghState = path.join(ghDir, 'state.json');
  await writeFile(ghState, JSON.stringify(gh ?? {}));
  process.env.FAKE_GH_LOG = log;
  process.env.FAKE_GH_STATE = ghState;
  // gh: null means "gh is not installed". The PATH then holds git alone, so the real gh
  // on this machine (if any) can never be reached.
  process.env.PATH = gh === null ? await gitOnlyPath() : `${FAKE_GH_DIR}${path.delimiter}${PATH0}`;

  const paths = taskPaths(t.home, t.taskId);
  const draft = /** @type {any} */ (await readJson(paths.draft));
  const approval = await approveTask({
    home: t.home,
    taskId: t.taskId,
    keystore: 'file',
    request: {
      kind: records ? 'full' : 'quick',
      draftSha256: draftDigest(draft),
      sourceHash: t.sourceHash,
      summary: ['a를 2로 바꿨다 (사람이 고침)', 'spec을 추가했다'],
      items: records ? [{ index: 0, decision: 'approved', edited: { title: '반올림하지 않는다' } }] : [],
    },
  });
  return { ...t, approval, paths, draft, log, ghState };
}

async function gitOnlyPath() {
  const dir = await tempDir('nogh');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  await symlink(real, path.join(dir, 'git'));
  return dir;
}

/** @param {string} file */
async function ghCalls(file) {
  try {
    return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/**
 * applyApproval with its result typed loosely: `pr` is null only after the PR was recorded.
 * @param {{ home: string, taskId: string }} options
 * @returns {Promise<any>}
 */
const applyAny = (options) => applyApproval(options);

/** @param {string} home @param {string} taskId */
const stateOf = async (home, taskId) => deriveState(await readEvents(taskPaths(home, taskId).events));

/** @param {Promise<unknown>} p @param {string} code */
const rejectsWith = (p, code) => assert.rejects(p, (/** @type {any} */ e) => e instanceof HeirloomError && e.code === code);

test.afterEach(() => {
  process.env.PATH = PATH0;
});

test('apply: verifies, writes the approved record, reports PR material; complete records the PR', async () => {
  const t = await approvedTask();
  const out = await applyAny({ home: t.home, taskId: t.taskId });

  assert.equal(out.state, 'applied');
  assert.equal(out.approvalId, t.approval.id);
  assert.equal(out.alreadyApplied, false);
  assert.deepEqual(out.summary, ['a를 2로 바꿨다 (사람이 고침)', 'spec을 추가했다']);
  const id = t.draft.records[0].id;
  assert.deepEqual(out.files, [`.heirloom/decisions/${id}.md`]);
  assert.deepEqual(out.records, [{ index: 0, op: 'add', kind: 'decision', id, title: '반올림하지 않는다', decision: 'approved' }]);

  const { records, errors } = await readRecords(t.repo.dir);
  assert.deepEqual(errors, []);
  assert.equal(records.length, 1);
  assert.equal(records[0].meta.title, '반올림하지 않는다', 'the human edit is written');
  assert.equal(records[0].meta.approval.id, t.approval.id);
  assert.equal(records[0].meta.approval.signer, t.approval.approver.fingerprint);

  assert.equal(out.pr.available, true);
  assert.equal(out.pr.reason, null);
  assert.equal(out.pr.base, 'main');
  assert.equal(out.pr.head, 'feat');
  assert.equal(out.pr.repo, 'acme/widgets');
  assert.equal(out.pr.existing, null);
  assert.deepEqual(out.pr.templates, []);
  assert.ok((await ghCalls(t.log)).some((a) => a[0] === 'pr' && a[1] === 'list' && a.includes('feat')));

  const types = (await readEvents(t.paths.events)).map((e) => e.type);
  assert.deepEqual(types.slice(-3), ['approved', 'approval_received', 'records_written']);

  await rejectsWith(completePr({ home: t.home, taskId: t.taskId, prUrl: 'not a url' }), 'E_INPUT');
  const url = 'https://github.com/acme/widgets/pull/7';
  assert.equal((await completePr({ home: t.home, taskId: t.taskId, prUrl: url })).state, 'pr_created');
  assert.equal((await completePr({ home: t.home, taskId: t.taskId, prUrl: url })).state, 'pr_created', 'same URL again is fine');
  await rejectsWith(completePr({ home: t.home, taskId: t.taskId, prUrl: 'https://github.com/acme/widgets/pull/8' }), 'E_CONFLICT');
});

test('apply twice: records are written once; the second run reports the same files', async () => {
  const t = await approvedTask();
  const first = await applyAny({ home: t.home, taskId: t.taskId });
  const file = path.join(t.repo.dir, first.files[0]);
  const before = (await stat(file)).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  const second = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual(second.files, first.files);
  assert.equal((await stat(file)).mtimeMs, before, 'not rewritten');
  const events = await readEvents(t.paths.events);
  assert.equal(events.filter((e) => e.type === 'records_written').length, 1);
  assert.equal(events.filter((e) => e.type === 'approval_received').length, 1);
});

test('a missed approval event is recovered: the pending list and the session start show it', async () => {
  const t = await approvedTask();
  const pending = await listPendingApprovals({ home: t.home, cwd: t.repo.dir });
  assert.deepEqual(pending.map((p) => [p.taskId, p.state, p.approvalId]), [[t.taskId, 'approved', t.approval.id]]);
  const ctx = await buildSessionContext({ cwd: t.repo.dir, home: t.home, pluginRoot: ROOT });
  assert.match(ctx, new RegExp(`${t.taskId}: 승인됨`));

  await applyAny({ home: t.home, taskId: t.taskId });
  assert.deepEqual((await listPendingApprovals({ home: t.home, cwd: t.repo.dir })).map((p) => p.state), ['applied']);
  assert.match(await buildSessionContext({ cwd: t.repo.dir, home: t.home, pluginRoot: ROOT }), /PR이 아직 없음/);

  await completePr({ home: t.home, taskId: t.taskId, prUrl: 'https://github.com/acme/widgets/pull/7' });
  assert.deepEqual(await listPendingApprovals({ home: t.home, cwd: t.repo.dir }), []);
});

test('a forged or altered approval is rejected (E_VERIFY) and nothing is written', async () => {
  const t = await approvedTask();
  const file = path.join(t.paths.approvals, `${t.approval.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.summary.final = ['에이전트가 바꾼 요약'];
  await writeFile(file, JSON.stringify(record));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');

  delete record.signature;
  await writeFile(file, JSON.stringify(record));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');
  assert.deepEqual((await readRecords(t.repo.dir)).records, []);
  assert.equal(await stateOf(t.home, t.taskId), 'approved');
});

test('a draft changed after approval is rejected (E_VERIFY)', async () => {
  const t = await approvedTask();
  const draft = { ...t.draft, notes: '승인 뒤에 고침' };
  await writeFile(t.paths.draft, JSON.stringify(draft));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');
  assert.deepEqual((await readRecords(t.repo.dir)).records, []);
});

test('source changed after approval: stale (E_CONFLICT) and nothing is written', async () => {
  const t = await approvedTask();
  await t.repo.write('src/a.mjs', 'export const a = 3;\n');
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await stateOf(t.home, t.taskId), 'stale');
  assert.deepEqual((await readRecords(t.repo.dir)).records, []);
});

test('another branch checked out: refuses to write records there', async () => {
  const t = await approvedTask();
  t.repo.git('checkout', '-q', '-b', 'other');
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.deepEqual((await readRecords(t.repo.dir)).records, []);
});

test('a PR created before a failure is found on the next run (no duplicate PR)', async () => {
  const t = await approvedTask();
  assert.equal((await applyAny({ home: t.home, taskId: t.taskId })).pr.existing, null);
  // The agent's `gh pr create` succeeded but the session died before complete.mjs.
  const pr = { number: 7, url: 'https://github.com/acme/widgets/pull/7', state: 'OPEN', headRefName: 'feat', baseRefName: 'main' };
  await writeFile(t.ghState, JSON.stringify({ prs: [pr] }));
  const again = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(again.alreadyApplied, true);
  assert.deepEqual(again.pr.existing, { number: 7, url: pr.url, base: 'main' });
});

test('PR step unavailable: records are still written and the reason is reported', async () => {
  const notGithub = await approvedTask({ github: false });
  const a = await applyAny({ home: notGithub.home, taskId: notGithub.taskId });
  assert.equal(a.state, 'applied');
  assert.equal(a.pr.available, false);
  assert.equal(a.pr.reason, 'not_github');
  assert.equal(a.files.length, 1);

  const noGh = await approvedTask({ gh: null });
  const b = await applyAny({ home: noGh.home, taskId: noGh.taskId });
  assert.equal(b.pr.available, false);
  assert.equal(b.pr.reason, 'gh_missing');

  const unauth = await approvedTask({ gh: { authed: false } });
  const c = await applyAny({ home: unauth.home, taskId: unauth.taskId });
  assert.equal(c.pr.available, false);
  assert.equal(c.pr.reason, 'gh_unauthenticated');
});

test('PR templates: one is returned as the template; several are listed without choosing', async () => {
  const t = await submittedTask();
  await t.repo.write('.github/PULL_REQUEST_TEMPLATE/feature.md', '## 요약\n');
  await t.repo.write('.github/PULL_REQUEST_TEMPLATE/bugfix.md', '## 요약\n');
  assert.deepEqual(await prTemplateChoice(t.repo.dir), { template: null, templates: ['.github/PULL_REQUEST_TEMPLATE/bugfix.md', '.github/PULL_REQUEST_TEMPLATE/feature.md'] });
  const single = await tempDir('single');
  await mkdir(path.join(single, '.github'), { recursive: true });
  await writeFile(path.join(single, '.github', 'pull_request_template.md'), '## Summary\n');
  spawnSync('git', ['init', '-q'], { cwd: single });
  assert.deepEqual(await prTemplateChoice(single), { template: '.github/pull_request_template.md', templates: ['.github/pull_request_template.md'] });
});

test('quick approval: nothing to write, PR material only', async () => {
  const t = await approvedTask({ records: false });
  const out = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(out.state, 'applied');
  assert.deepEqual(out.files, []);
  assert.deepEqual(out.records, []);
  assert.equal(out.pr.available, true);
  assert.equal((await readdir(t.repo.dir)).includes('.heirloom'), false);
});

test('apply before approval or on an unknown task', async () => {
  const t = await submittedTask();
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  await rejectsWith(applyAny({ home: t.home, taskId: 't-20261112-zzzzzzzz' }), 'E_INPUT');
});

test('scripts: apply.mjs lists, applies and exits 4 on a bad signature; complete.mjs records the PR', async () => {
  const t = await approvedTask();
  const env = { ...process.env, HEIRLOOM_HOME: t.home };
  const apply = path.join(ROOT, 'skills', 'apply-approval', 'scripts', 'apply.mjs');
  const complete = path.join(ROOT, 'skills', 'apply-approval', 'scripts', 'complete.mjs');

  const list = spawnSync(process.execPath, [apply], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).data.pending[0].taskId, t.taskId);

  const ok = spawnSync(process.execPath, [apply, '--task', t.taskId], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).data.state, 'applied');

  const done = spawnSync(process.execPath, [complete, '--task', t.taskId, '--pr-url', 'https://github.com/acme/widgets/pull/9'], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(done.status, 0, done.stdout);
  assert.equal(JSON.parse(done.stdout).data.state, 'pr_created');

  const forged = await approvedTask();
  const file = path.join(forged.paths.approvals, `${forged.approval.id}.json`);
  const rec = JSON.parse(await readFile(file, 'utf8'));
  rec.items[0].decision = 'rejected';
  await writeFile(file, JSON.stringify(rec));
  const bad = spawnSync(process.execPath, [apply, '--task', forged.taskId], { cwd: forged.repo.dir, env: { ...process.env, HEIRLOOM_HOME: forged.home }, encoding: 'utf8' });
  assert.equal(bad.status, 4);
  assert.equal(JSON.parse(bad.stdout).error.code, 'E_VERIFY');
});

test('a PR closed without merge expires the task; merged or unknown PRs keep it', async () => {
  const t = await approvedTask();
  await applyAny({ home: t.home, taskId: t.taskId });
  const url = 'https://github.com/acme/widgets/pull/7';
  await completePr({ home: t.home, taskId: t.taskId, prUrl: url });
  const pr = { number: 7, url, headRefName: 'feat', baseRefName: 'main' };

  // gh cannot tell (network failure): the task keeps waiting.
  await writeFile(t.ghState, JSON.stringify({ prs: [{ ...pr, state: 'CLOSED' }], fail: 'network' }));
  // withRetry sleeps 2 s before its second attempt; the result must still be "unknown".
  assert.equal((await applyAny({ home: t.home, taskId: t.taskId })).state, 'pr_created');

  await writeFile(t.ghState, JSON.stringify({ prs: [{ ...pr, state: 'MERGED' }] }));
  assert.equal((await applyAny({ home: t.home, taskId: t.taskId })).state, 'pr_created');

  await writeFile(t.ghState, JSON.stringify({ prs: [{ ...pr, state: 'CLOSED' }] }));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await stateOf(t.home, t.taskId), 'expired');
  const events = await readEvents(t.paths.events);
  assert.deepEqual({ ...events.at(-1), at: undefined }, { at: undefined, type: 'expired', reason: 'pr_closed', url });
  assert.ok((await ghCalls(t.log)).some((args) => args[0] === 'pr' && args[1] === 'view' && args[2] === url));
});
