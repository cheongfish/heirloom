// GitLab (gitlab.com or a self-hosted host glab is logged in to, glab): apply, MR lookup,
// open-mr, complete and expiry, against temporary repositories and a fake `glab`. The real
// glab on this machine is never reached: PATH starts with the fake one,
// or holds git alone when glab must be missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { providerTask } from '../helpers/provider-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { applyApproval, completePr, prTemplateChoice } from '../../skills/using-heirloom/lib/apply.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { openMergeRequest } from '../../skills/using-heirloom/lib/merge-request.mjs';
import { checkPrExpiry } from '../../skills/using-heirloom/lib/pr-expiry.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_GLAB_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-glab');
const FAKE_GH_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-gh');
const PATH0 = process.env.PATH;

// Fetching from the remote must fail fast instead of reaching the network.
process.env.GIT_SSH_COMMAND = 'false';
process.env.GIT_TERMINAL_PROMPT = '0';

const MR_URL = 'https://gitlab.com/group/sub/widgets/-/merge_requests/7';

/**
 * A submitted task on a GitLab-looking remote, approved in the dashboard, with a fake glab.
 * @param {{ remote?: string, glab?: { hosts?: string[], mrs?: any[], fail?: string } | null }} [options]
 */
async function approvedTask({ remote = 'git@gitlab.com:group/sub/widgets.git', glab = {} } = {}) {
  const t = await submittedTask();
  t.repo.git('remote', 'set-url', 'origin', remote);
  const dir = await tempDir('glab');
  const log = path.join(dir, 'log.jsonl');
  const glabState = path.join(dir, 'state.json');
  await writeFile(glabState, JSON.stringify(glab ?? {}));
  process.env.FAKE_GLAB_LOG = log;
  process.env.FAKE_GLAB_STATE = glabState;
  process.env.FAKE_GH_LOG = path.join(dir, 'gh.jsonl');
  process.env.PATH = glab === null ? await gitOnlyPath() : [FAKE_GLAB_DIR, FAKE_GH_DIR, PATH0].join(path.delimiter);

  const paths = taskPaths(t.home, t.taskId);
  const draft = /** @type {any} */ (await readJson(paths.draft));
  const approval = await approveTask({
    home: t.home,
    taskId: t.taskId,
    keystore: 'file',
    request: { kind: 'full', draftSha256: draftDigest(draft), sourceHash: t.sourceHash, summary: ['a를 2로 바꿨다', 'spec을 추가했다'], items: [{ index: 0, decision: 'approved' }] },
  });
  return { ...t, approval, paths, log, glabState };
}

async function gitOnlyPath() {
  const dir = await tempDir('noglab');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  await symlink(real, path.join(dir, 'git'));
  return dir;
}

/** @param {string} file */
async function calls(file) {
  try {
    return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** @param {{ home: string, taskId: string }} options @returns {Promise<any>} */
const applyAny = (options) => applyApproval(options);

/** @param {Promise<unknown>} p @param {string} code */
const rejectsWith = (p, code) => assert.rejects(p, (/** @type {any} */ e) => e instanceof HeirloomError && e.code === code);

/** @param {any} mr */
const openMr = (mr = {}) => ({ iid: 7, web_url: MR_URL, state: 'opened', source_branch: 'feat', target_branch: 'main', project: 'group/sub/widgets', ...mr });

test.afterEach(() => {
  process.env.PATH = PATH0;
});

test('gitlab.com: apply reports MR material; complete records the MR with its provider', async () => {
  const t = await approvedTask();
  const out = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(out.state, 'applied');
  assert.equal(out.files.length, 1);
  assert.equal(out.pr.available, true);
  assert.equal(out.pr.reason, null);
  assert.equal(out.pr.provider, 'gitlab');
  assert.equal(out.pr.host, 'gitlab.com');
  assert.equal(out.pr.repo, 'group/sub/widgets');
  assert.equal(out.pr.base, 'main');
  assert.equal(out.pr.head, 'feat');
  assert.equal(out.pr.existing, null);
  const api = (await calls(t.log)).find((a) => a[0] === 'api');
  assert.ok(api?.includes('gitlab.com'));
  assert.ok(api?.some((/** @type {string} */ a) => a.startsWith('projects/group%2Fsub%2Fwidgets/merge_requests?') && a.includes('source_branch=feat')));
  assert.deepEqual(await calls(String(process.env.FAKE_GH_LOG)), [], 'gh is not asked about a GitLab remote');

  // A merge request URL of another service is not a GitLab MR.
  await rejectsWith(completePr({ home: t.home, taskId: t.taskId, prUrl: 'https://git.other.example/g/p/-/merge_requests/1' }), 'E_INPUT');
  await rejectsWith(completePr({ home: t.home, taskId: t.taskId, prUrl: 'https://gitlab.com/group/sub/widgets/merge_requests/7' }), 'E_INPUT');
  assert.equal((await completePr({ home: t.home, taskId: t.taskId, prUrl: MR_URL })).state, 'pr_created');
  assert.equal((await completePr({ home: t.home, taskId: t.taskId, prUrl: MR_URL })).state, 'pr_created', 'same URL again is fine');
  const event = (await readEvents(t.paths.events)).at(-1);
  assert.equal(event?.type, 'pr_created');
  assert.equal(event?.provider, 'gitlab');
  assert.equal(event?.url, MR_URL);
});

test('an MR created before a failure is found on the next run (no duplicate MR)', async () => {
  const t = await approvedTask();
  assert.equal((await applyAny({ home: t.home, taskId: t.taskId })).pr.existing, null);
  await writeFile(t.glabState, JSON.stringify({ mrs: [openMr({ iid: 8, source_branch: 'other' }), openMr()] }));
  const again = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(again.alreadyApplied, true);
  assert.deepEqual(again.pr.existing, { iid: 7, url: MR_URL, base: 'main' });
});

test('an MR closed without merge expires the task; merged or unknown MRs keep it', async () => {
  const t = await approvedTask();
  await applyAny({ home: t.home, taskId: t.taskId });
  await completePr({ home: t.home, taskId: t.taskId, prUrl: MR_URL });

  await writeFile(t.glabState, JSON.stringify({ mrs: [openMr({ state: 'closed' })], fail: 'network' }));
  assert.equal((await checkPrExpiry({ home: t.home, taskId: t.taskId })).state, 'pr_created', 'unknown keeps waiting');

  await writeFile(t.glabState, JSON.stringify({ mrs: [openMr({ state: 'merged' })] }));
  assert.equal((await applyAny({ home: t.home, taskId: t.taskId })).state, 'pr_created');

  await writeFile(t.glabState, JSON.stringify({ mrs: [openMr({ state: 'closed' })] }));
  await rejectsWith(applyAny({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(deriveState(await readEvents(t.paths.events)), 'expired');
  assert.ok((await calls(t.log)).some((a) => a[0] === 'api' && a.includes('projects/group%2Fsub%2Fwidgets/merge_requests/7')));
});

test('glab missing or not logged in: records are written and the reason is reported', async () => {
  const missing = await approvedTask({ glab: null });
  const a = await applyAny({ home: missing.home, taskId: missing.taskId });
  assert.equal(a.state, 'applied');
  assert.equal(a.pr.available, false);
  assert.equal(a.pr.provider, 'gitlab');
  assert.equal(a.pr.reason, 'glab_missing');

  const unauth = await approvedTask({ glab: { hosts: [] } });
  const b = await applyAny({ home: unauth.home, taskId: unauth.taskId });
  assert.equal(b.pr.available, false);
  assert.equal(b.pr.reason, 'glab_unauthenticated');
});

test('self-hosted GitLab counts only when glab is logged in to the host', async () => {
  const remote = 'ssh://git@git.example.com:2222/team/widgets.git';
  const known = await approvedTask({ remote, glab: { hosts: ['git.example.com'] } });
  const a = await applyAny({ home: known.home, taskId: known.taskId });
  assert.equal(a.pr.available, true);
  assert.equal(a.pr.provider, 'gitlab');
  assert.equal(a.pr.host, 'git.example.com');
  assert.equal(a.pr.repo, 'team/widgets');
  const url = 'https://git.example.com/team/widgets/-/merge_requests/3';
  assert.equal((await completePr({ home: known.home, taskId: known.taskId, prUrl: url })).state, 'pr_created');

  const unknown = await approvedTask({ remote, glab: { hosts: ['gitlab.com'] } });
  const b = await applyAny({ home: unknown.home, taskId: unknown.taskId });
  assert.equal(b.pr.available, false);
  assert.equal(b.pr.provider, null);
  assert.equal(b.pr.reason, 'unsupported_remote');
  await rejectsWith(completePr({ home: unknown.home, taskId: unknown.taskId, prUrl: url }), 'E_INPUT');
  const ctx = await buildSessionContext({ cwd: unknown.repo.dir, home: unknown.home, pluginRoot: ROOT });
  assert.match(ctx, /지원하지 않는 원격/);
});

test('GitHub PRs record their provider too', async () => {
  const t = await approvedTask({ remote: 'git@github.com:acme/widgets.git' });
  const out = await applyAny({ home: t.home, taskId: t.taskId });
  assert.equal(out.pr.provider, 'github');
  await completePr({ home: t.home, taskId: t.taskId, prUrl: 'https://github.com/acme/widgets/pull/7' });
  assert.equal((await readEvents(t.paths.events)).at(-1)?.provider, 'github');
  assert.deepEqual(await calls(t.log), [], 'glab is not asked about a GitHub remote');
});

test('MR templates: one is used, Default.md wins among several, otherwise they are listed', async () => {
  const dir = await tempDir('mrtpl');
  const tpl = path.join(dir, '.gitlab', 'merge_request_templates');
  await mkdir(tpl, { recursive: true });
  await writeFile(path.join(tpl, 'Feature.md'), '## Summary\n');
  assert.deepEqual(await prTemplateChoice(dir, 'gitlab'), { template: '.gitlab/merge_request_templates/Feature.md', templates: ['.gitlab/merge_request_templates/Feature.md'] });

  await writeFile(path.join(tpl, 'Bug.md'), '## Summary\n');
  assert.deepEqual(await prTemplateChoice(dir, 'gitlab'), { template: null, templates: ['.gitlab/merge_request_templates/Bug.md', '.gitlab/merge_request_templates/Feature.md'] });

  await writeFile(path.join(tpl, 'Default.md'), '## Summary\n');
  await writeFile(path.join(tpl, 'notes.txt'), 'not a template\n');
  const many = await prTemplateChoice(dir, 'gitlab');
  assert.equal(many.template, '.gitlab/merge_request_templates/Default.md');
  assert.equal(many.templates.length, 3);

  // GitHub templates are not MR templates, and the other way round.
  await mkdir(path.join(dir, '.github'), { recursive: true });
  await writeFile(path.join(dir, '.github', 'pull_request_template.md'), '## Summary\n');
  assert.deepEqual(await prTemplateChoice(dir, 'github'), { template: '.github/pull_request_template.md', templates: ['.github/pull_request_template.md'] });
  assert.equal((await prTemplateChoice(dir, 'gitlab')).templates.includes('.github/pull_request_template.md'), false);
});

test('open-mr: creates the MR from a body file without a shell; a second run finds it instead of creating another', async () => {
  const t = await approvedTask();
  await applyAny({ home: t.home, taskId: t.taskId });
  const dir = await tempDir('body');
  const bodyFile = path.join(dir, 'body.md');
  const body = "## 요약\n\n- a를 2로 바꿨다\n- spec을 추가했다 (\"따옴표\", 'apostrophe', `code`, $HOME)\n\n## 테스트\n";
  await writeFile(bodyFile, body);

  const first = await openMergeRequest({ home: t.home, taskId: t.taskId, title: 'feat: a 변경', bodyFile });
  assert.deepEqual(first, { action: 'created', iid: 1, url: 'https://gitlab.com/group/sub/widgets/-/merge_requests/1' });
  const state = JSON.parse(await readFile(t.glabState, 'utf8'));
  assert.equal(state.mrs.length, 1);
  assert.equal(state.mrs[0].description, body, 'the body arrives byte for byte');
  assert.equal(state.mrs[0].source_branch, 'feat');
  assert.equal(state.mrs[0].target_branch, 'main');
  const create = (await calls(t.log)).find((a) => a[0] === 'mr' && a[1] === 'create');
  assert.ok(create?.includes('https://gitlab.com/group/sub/widgets'), 'the project is named with its host');

  const again = await openMergeRequest({ home: t.home, taskId: t.taskId, title: 'feat: a 변경', bodyFile });
  assert.deepEqual(again, { action: 'found', iid: 1, url: first.url });
  assert.equal(JSON.parse(await readFile(t.glabState, 'utf8')).mrs.length, 1);

  await writeFile(bodyFile, '## 요약\n\n- 새 요약\n');
  const updated = await openMergeRequest({ home: t.home, taskId: t.taskId, bodyFile, iid: 1 });
  assert.deepEqual(updated, { action: 'updated', iid: 1, url: first.url });
  assert.equal(JSON.parse(await readFile(t.glabState, 'utf8')).mrs[0].description, '## 요약\n\n- 새 요약\n');

  // After the MR is recorded its body can still be updated, but no new MR is created.
  await completePr({ home: t.home, taskId: t.taskId, prUrl: first.url });
  assert.equal((await openMergeRequest({ home: t.home, taskId: t.taskId, bodyFile, iid: 1 })).action, 'updated');
  await rejectsWith(openMergeRequest({ home: t.home, taskId: t.taskId, title: 't', bodyFile }), 'E_CONFLICT');
});

test('open-mr: refuses before the records are written, on a GitHub remote, and without glab', async () => {
  const dir = await tempDir('body');
  const bodyFile = path.join(dir, 'body.md');
  await writeFile(bodyFile, '- 요약\n');

  const early = await approvedTask();
  await rejectsWith(openMergeRequest({ home: early.home, taskId: early.taskId, title: 't', bodyFile }), 'E_CONFLICT');

  const github = await approvedTask({ remote: 'git@github.com:acme/widgets.git' });
  await applyAny({ home: github.home, taskId: github.taskId });
  await rejectsWith(openMergeRequest({ home: github.home, taskId: github.taskId, title: 't', bodyFile }), 'E_INPUT');

  const noGlab = await approvedTask({ glab: null });
  await applyAny({ home: noGlab.home, taskId: noGlab.taskId });
  await rejectsWith(openMergeRequest({ home: noGlab.home, taskId: noGlab.taskId, title: 't', bodyFile }), 'E_INPUT');

  const t = await approvedTask();
  await applyAny({ home: t.home, taskId: t.taskId });
  await rejectsWith(openMergeRequest({ home: t.home, taskId: t.taskId, title: 't', bodyFile: path.join(dir, 'missing.md') }), 'E_INPUT');
  await rejectsWith(openMergeRequest({ home: t.home, taskId: t.taskId, bodyFile }), 'E_INPUT');
});

test('open-mr.mjs script: prints one JSON object and records nothing by itself', async () => {
  const t = await approvedTask();
  await applyAny({ home: t.home, taskId: t.taskId });
  const dir = await tempDir('body');
  const bodyFile = path.join(dir, 'body.md');
  await writeFile(bodyFile, '- 요약\n');
  const script = path.join(ROOT, 'skills', 'apply-approval', 'scripts', 'open-mr.mjs');
  const env = { ...process.env, HEIRLOOM_HOME: t.home };
  const ok = spawnSync(process.execPath, [script, '--task', t.taskId, '--title', 'feat: x', '--body-file', bodyFile], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).data.action, 'created');
  assert.equal(deriveState(await readEvents(t.paths.events)), 'applied', 'complete.mjs still records the MR');
  const bad = spawnSync(process.execPath, [script, '--task', t.taskId], { cwd: t.repo.dir, env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

// ---------------------------------------------------------------- scripts, as the agent runs them

test('scripts: gitlab.com subgroups over ssh and https, and a logged-in self-hosted host, are GitLab', async () => {
  const cases = [
    ['git@gitlab.com:group/sub/widgets.git', {}, 'gitlab.com', 'group/sub/widgets'],
    ['https://gitlab.com/group/widgets.git', {}, 'gitlab.com', 'group/widgets'],
    ['ssh://git@git.example.com:2222/team/sub/widgets.git', { hosts: ['git.example.com'] }, 'git.example.com', 'team/sub/widgets'],
  ];
  for (const [remote, glab, host, repo] of cases) {
    const t = await providerTask({ remote: String(remote), glab: /** @type {object} */ (glab), gh: null });
    const r = t.run('apply', ['--task', t.taskId]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual([r.out.data.pr.provider, r.out.data.pr.host, r.out.data.pr.repo, r.out.data.pr.available], ['gitlab', host, repo, true], String(remote));
  }
});

test('scripts: apply → open-mr creates the MR with the template body unchanged → complete; the body can be updated later', async () => {
  const t = await providerTask({
    remote: 'git@gitlab.com:group/widgets.git',
    gh: null,
    templates: { '.gitlab/merge_request_templates/Default.md': '## 요약\n', '.gitlab/merge_request_templates/Bug.md': '## 버그\n' },
  });
  const applied = t.run('apply', ['--task', t.taskId]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.out.data.pr.template, '.gitlab/merge_request_templates/Default.md');
  assert.equal(applied.out.data.pr.templates.length, 2);

  const text = '## 요약\n\n- a를 2로 바꿨다\n- spec을 추가했다\n\n## 테스트\n\n"따옴표", \'작은따옴표\', `code`, $(echo no)\n';
  const body = await t.bodyFile(text);
  const created = t.run('open-mr', ['--task', t.taskId, '--title', 'feat: a 변경', '--body-file', body]);
  assert.equal(created.status, 0, created.stderr);
  const url = 'https://gitlab.com/group/widgets/-/merge_requests/1';
  assert.deepEqual(created.out.data, { action: 'created', iid: 1, url });
  assert.equal((await t.fakeState('glab')).mrs[0].description, text, 'the body reaches glab unchanged, no shell in between');

  // A second run (for example after a lost session) finds the MR and creates nothing.
  assert.equal(t.run('open-mr', ['--task', t.taskId, '--title', 'feat: a 변경', '--body-file', body]).out.data.action, 'found');
  assert.deepEqual(t.run('apply', ['--task', t.taskId]).out.data.pr.existing, { iid: 1, url, base: 'main' });

  const done = t.run('complete', ['--task', t.taskId, '--pr-url', url]);
  assert.deepEqual(done.out.data, { taskId: t.taskId, state: 'pr_created', prUrl: url, provider: 'gitlab' });
  assert.equal((await t.lastEvent())?.provider, 'gitlab');

  const update = t.run('open-mr', ['--task', t.taskId, '--iid', '1', '--body-file', await t.bodyFile('- 새 요약\n')]);
  assert.equal(update.out.data.action, 'updated');
  assert.equal((await t.fakeState('glab')).mrs[0].description, '- 새 요약\n');
  assert.equal(t.run('open-mr', ['--task', t.taskId, '--iid', 'x', '--body-file', body]).status, 2);
  assert.equal((await t.fakeState('glab')).mrs.length, 1);
  assert.deepEqual(await t.calls('gh'), []);
});

test('scripts: glab missing or not logged in; open-mr refuses before apply', async () => {
  const missing = await providerTask({ remote: 'git@gitlab.com:group/widgets.git', glab: null, gh: null });
  assert.equal(missing.run('open-mr', ['--task', missing.taskId, '--title', 't', '--body-file', await missing.bodyFile('- x\n')]).status, 3, 'not applied yet');
  const a = missing.run('apply', ['--task', missing.taskId]);
  assert.deepEqual([a.status, a.out.data.pr.provider, a.out.data.pr.reason], [0, 'gitlab', 'glab_missing']);
  assert.equal(missing.run('open-mr', ['--task', missing.taskId, '--title', 't', '--body-file', await missing.bodyFile('- x\n')]).status, 2);

  const unauth = await providerTask({ remote: 'git@gitlab.com:group/widgets.git', glab: { hosts: [] }, gh: null });
  assert.equal(unauth.run('apply', ['--task', unauth.taskId]).out.data.pr.reason, 'glab_unauthenticated');
});

test('scripts: an MR closed without merge expires the task', async () => {
  const t = await providerTask({ remote: 'git@gitlab.com:group/widgets.git', gh: null });
  t.run('apply', ['--task', t.taskId]);
  t.run('open-mr', ['--task', t.taskId, '--title', 't', '--body-file', await t.bodyFile('- x\n')]);
  const url = 'https://gitlab.com/group/widgets/-/merge_requests/1';
  assert.equal(t.run('complete', ['--task', t.taskId, '--pr-url', url]).status, 0);
  const state = await t.fakeState('glab');
  state.mrs[0].state = 'closed';
  await t.setFakeState('glab', state);
  const r = t.run('apply', ['--task', t.taskId]);
  assert.equal(r.status, 3);
  assert.equal(await t.state(), 'expired');
  assert.equal((await t.lastEvent())?.reason, 'pr_closed');
});
