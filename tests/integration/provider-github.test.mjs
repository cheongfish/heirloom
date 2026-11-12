// GitHub (github.com, gh): the apply-approval scripts end to end, as the agent runs them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { ROOT, providerTask } from '../helpers/provider-fixture.mjs';

const PR_URL = 'https://github.com/acme/widgets/pull/1';

test('github.com remotes in ssh, scp and https form are GitHub; glab is never asked', async () => {
  for (const remote of ['git@github.com:acme/widgets.git', 'ssh://git@github.com/acme/widgets', 'https://user@github.com/acme/widgets/']) {
    const t = await providerTask({ remote });
    const r = t.run('apply', ['--task', t.taskId]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.out.data.pr.provider, 'github', remote);
    assert.equal(r.out.data.pr.host, 'github.com');
    assert.equal(r.out.data.pr.repo, 'acme/widgets');
    assert.equal(r.out.data.pr.available, true);
    assert.deepEqual(await t.calls('glab'), [], remote);
  }
});

test('apply → gh pr create → apply finds the PR → complete records it with its provider', async () => {
  const t = await providerTask({ remote: 'git@github.com:acme/widgets.git', templates: { '.github/pull_request_template.md': '## 요약\n' } });
  const first = t.run('apply', ['--task', t.taskId]);
  assert.equal(first.status, 0, first.stderr);
  const pr = first.out.data.pr;
  assert.deepEqual([pr.available, pr.reason, pr.base, pr.head, pr.existing, pr.template], [true, null, 'main', 'feat', null, '.github/pull_request_template.md']);
  assert.equal(first.out.data.files.length, 1);
  assert.equal(await t.state(), 'applied');

  // The agent opens the PR itself with gh.
  const body = await t.bodyFile('## 요약\n\n- a를 2로 바꿨다\n- spec을 추가했다\n');
  const env = { ...process.env, FAKE_GH_STATE: t.files.ghState };
  execFileSync(process.execPath, [path.join(ROOT, 'tests', 'helpers', 'fake-gh', 'gh'), 'pr', 'create', '--repo', pr.repo, '--base', pr.base, '--head', pr.head, '--title', 'feat: a', '--body-file', body], { env });

  const again = t.run('apply', ['--task', t.taskId]);
  assert.equal(again.out.data.alreadyApplied, true);
  assert.deepEqual(again.out.data.pr.existing, { number: 1, url: PR_URL, base: 'main' });

  const done = t.run('complete', ['--task', t.taskId, '--pr-url', PR_URL]);
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(done.out.data, { taskId: t.taskId, state: 'pr_created', prUrl: PR_URL, provider: 'github' });
  const event = await t.lastEvent();
  assert.deepEqual([event?.type, event?.provider, event?.url], ['pr_created', 'github', PR_URL]);
  assert.equal(t.run('complete', ['--task', t.taskId, '--pr-url', 'https://github.com/acme/widgets/pull/2']).status, 3, 'another PR URL conflicts');
});

test('gh missing or not logged in: the records are written and the reason is reported', async () => {
  const missing = await providerTask({ remote: 'git@github.com:acme/widgets.git', gh: null });
  const a = missing.run('apply', ['--task', missing.taskId]);
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual([a.out.data.pr.available, a.out.data.pr.provider, a.out.data.pr.reason], [false, 'github', 'gh_missing']);
  assert.equal(a.out.data.files.length, 1);

  const unauth = await providerTask({ remote: 'git@github.com:acme/widgets.git', gh: { authed: false } });
  const b = unauth.run('apply', ['--task', unauth.taskId]);
  assert.deepEqual([b.out.data.pr.available, b.out.data.pr.reason], [false, 'gh_unauthenticated']);
});

test('a PR closed without merge expires the task; an unreachable gh keeps it waiting', async () => {
  const t = await providerTask({ remote: 'git@github.com:acme/widgets.git' });
  t.run('apply', ['--task', t.taskId]);
  assert.equal(t.run('complete', ['--task', t.taskId, '--pr-url', PR_URL]).status, 0);
  const pr = { number: 1, url: PR_URL, headRefName: 'feat', baseRefName: 'main' };

  await t.setFakeState('gh', { prs: [{ ...pr, state: 'CLOSED' }], fail: 'network' });
  assert.equal(t.run('apply', ['--task', t.taskId]).status, 0);
  assert.equal(await t.state(), 'pr_created');

  await t.setFakeState('gh', { prs: [{ ...pr, state: 'CLOSED' }] });
  const closed = t.run('apply', ['--task', t.taskId]);
  assert.equal(closed.status, 3);
  assert.equal(closed.out.error.code, 'E_CONFLICT');
  assert.equal(await t.state(), 'expired');
  assert.ok((await t.calls('gh')).some((a) => a[0] === 'pr' && a[1] === 'view' && a[2] === PR_URL));
});

test('open-mr.mjs refuses a GitHub task: PRs are opened with gh pr create', async () => {
  const t = await providerTask({ remote: 'git@github.com:acme/widgets.git' });
  t.run('apply', ['--task', t.taskId]);
  const r = t.run('open-mr', ['--task', t.taskId, '--title', 't', '--body-file', await t.bodyFile('- x\n')]);
  assert.equal(r.status, 2);
  assert.match(r.out.error.message, /GitLab 원격이 아님/);
  assert.deepEqual(await t.calls('glab'), []);
});
