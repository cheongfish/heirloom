// handoff → judgment → apply → PR, against temporary repositories and a fake `gh` (MVP-PLAN M5).
// What a judgment adds on top (the PR paragraph, the commit status) is in judgment-apply.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPEC, approvedTask as judgedAndAccepted, submittedTask } from '../helpers/handoff-fixture.mjs';
import { CART_HEAD } from '../helpers/judge-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { applyApproval, completePr, listPendingApprovals, prTemplateChoice } from '../../skills/using-heirloom/lib/apply.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { sign } from '../../skills/using-heirloom/lib/sign.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_GH_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-gh');

const PATH0 = process.env.PATH;

// Fetching from github.com must fail fast instead of reaching the network.
process.env.GIT_SSH_COMMAND = 'false';
process.env.GIT_TERMINAL_PROMPT = '0';

/**
 * A task whose origin looks like GitHub, judged in the dashboard with every question accepted,
 * with a fake gh.
 * @param {{ github?: boolean, gh?: { authed?: boolean, prs?: any[], fail?: string } | null }} [options]
 */
async function approvedTask({ github = true, gh = {} } = {}) {
  // The probes run node: the PATH of an earlier task in the same test may lack it.
  process.env.PATH = PATH0;
  const t = await judgedAndAccepted();
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
  return { ...t, approval: t.judgment, paths, draft: /** @type {any} */ (await readJson(paths.draft)), log, ghState };
}

/** Whether the judged spec is still in the working tree (apply deletes it by default). @param {{ repo: { dir: string } }} t */
const specKept = (t) => access(path.join(t.repo.dir, SPEC)).then(() => true, () => false);

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

test('apply: verifies, carries out the spec lifetime, reports PR material; complete records the PR', async () => {
  const t = await approvedTask();
  const out = await applyAny({ home: t.home, taskId: t.taskId });

  assert.equal(out.state, 'applied');
  assert.equal(out.kind, 'judgment');
  assert.equal(out.outcome, 'accepted');
  assert.equal(out.approvalId, t.approval.id);
  assert.equal(out.alreadyApplied, false);
  assert.deepEqual(out.files, [], 'no decision record was kept');
  assert.deepEqual(out.removed, [SPEC]);
  assert.equal(await specKept(t), false);

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

test('apply twice: the judgment is applied once; the second run reports the same files', async () => {
  const t = await approvedTask();
  const first = await applyAny({ home: t.home, taskId: t.taskId });
  const second = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(second.alreadyApplied, true);
  assert.deepEqual([second.files, second.removed], [first.files, first.removed]);
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

test('a forged or altered judgment is rejected (E_VERIFY) and nothing is done', async () => {
  const t = await approvedTask();
  const file = path.join(t.paths.approvals, `${t.approval.id}.json`);
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.behaviorDiffs.final = ['에이전트가 바꾼 설명'];
  await writeFile(file, JSON.stringify(record));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');

  delete record.signature;
  await writeFile(file, JSON.stringify(record));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');
  assert.equal(await specKept(t), true);
  assert.equal(await stateOf(t.home, t.taskId), 'approved');
});

test('a draft changed after the judgment is rejected (E_VERIFY)', async () => {
  const t = await approvedTask();
  const draft = { ...t.draft, notes: '판정 뒤에 고침' };
  await writeFile(t.paths.draft, JSON.stringify(draft));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_VERIFY');
  assert.equal(await specKept(t), true);
});

test('an item approval from before the pivot is refused (E_VERIFY); prepare starts a new handoff instead of a recheck', async () => {
  const t = await approvedTask();
  const file = path.join(t.paths.approvals, `${t.approval.id}.json`);
  const judgment = JSON.parse(await readFile(file, 'utf8'));
  // A validly signed schema 1 approval, as 0.3 wrote it.
  const legacy = await sign(
    t.home,
    {
      schemaVersion: 1,
      id: judgment.id,
      taskId: judgment.taskId,
      kind: 'full',
      target: { sourceHash: judgment.target.sourceHash, materials: judgment.target.materials, draftSha256: judgment.target.draftSha256 },
      summary: { initial: ['요약'], final: ['요약'] },
      items: [],
      approver: judgment.approver,
      approvedAt: judgment.judgedAt,
    },
    { keystore: 'file' },
  );
  await writeFile(file, JSON.stringify(legacy));
  await assert.rejects(applyAny({ home: t.home, taskId: t.taskId }), (/** @type {any} */ e) => {
    assert.equal(e.code, 'E_VERIFY');
    assert.match(e.message, /이전 형식\(항목별 승인\)/);
    assert.match(String(e.hint), /prepare-handoff로 다시 인계/);
    return true;
  });
  assert.equal(await specKept(t), true);

  const again = await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] });
  assert.deepEqual([again.taskId, again.alreadyPrepared, again.state, again.recheck], [t.taskId, false, 'prepared', null]);
});

test('code changed after the judgment: stale (E_CONFLICT) and nothing is done', async () => {
  const t = await approvedTask();
  await t.repo.write('src/cart.mjs', `${CART_HEAD}// later\n`);
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await stateOf(t.home, t.taskId), 'stale');
  assert.equal(await specKept(t), true);
});

test('another branch checked out: refuses to apply there', async () => {
  const t = await approvedTask();
  t.repo.git('checkout', '-q', '-b', 'other');
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await specKept(t), true);
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

test('a transient failure after the judgment is applied says so; the retry continues at the PR step', async () => {
  const t = await approvedTask({ gh: { fail: 'network' } });
  await assert.rejects(applyAny({ home: t.home, taskId: t.taskId }), (/** @type {any} */ e) => {
    assert.ok(e instanceof HeirloomError);
    assert.equal(e.code, 'E_TRANSIENT');
    assert.match(e.message, /기록 파일은 이미 씀/);
    assert.match(e.message, /쓸 기록 없음/);
    assert.match(e.message, /gh pr list 실패/);
    assert.match(String(e.hint), /기록을 다시 쓰지 않고 PR 단계부터/);
    return true;
  });
  assert.equal(await stateOf(t.home, t.taskId), 'applied');

  await writeFile(t.ghState, '{}');
  const again = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(again.alreadyApplied, true);
  assert.equal(again.pr.available, true);
});

test('PR step unavailable: the judgment is still applied and the reason is reported', async () => {
  const notGithub = await approvedTask({ github: false });
  const a = await applyAny({ home: notGithub.home, taskId: notGithub.taskId });
  assert.equal(a.state, 'applied');
  assert.equal(a.pr.available, false);
  assert.equal(a.pr.reason, 'unsupported_remote');
  assert.deepEqual(a.removed, [SPEC]);

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
  rec.items[0].verdict = 'revert';
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
