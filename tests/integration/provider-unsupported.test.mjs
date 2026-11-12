// Unsupported remotes (a local path, GitHub Enterprise, a host glab is not logged in to): the
// records are written, no PR or MR is opened, and neither gh nor glab is used for one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROOT, providerTask } from '../helpers/provider-fixture.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';

test('a local path remote: records written, unsupported_remote, no gh or glab call at all', async () => {
  const t = await providerTask({ remote: '/srv/git/widgets.git' });
  const r = t.run('apply', ['--task', t.taskId]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.out.data.pr.available, r.out.data.pr.provider, r.out.data.pr.reason, r.out.data.pr.repo, r.out.data.pr.host], [false, null, 'unsupported_remote', null, null]);
  assert.equal(r.out.data.files.length, 1);
  assert.deepEqual(await t.calls('gh'), []);
  assert.deepEqual(await t.calls('glab'), []);

  const ctx = await buildSessionContext({ cwd: t.repo.dir, home: t.home, pluginRoot: ROOT });
  assert.match(ctx, /PR·MR은 만들 수 없음\(지원하지 않는 원격\)/);
});

test('GitHub Enterprise is not GitHub: it counts as GitLab only if glab is logged in there', async () => {
  const t = await providerTask({ remote: 'git@github.example.com:acme/widgets.git', glab: { hosts: ['gitlab.com'] } });
  const r = t.run('apply', ['--task', t.taskId]);
  assert.deepEqual([r.out.data.pr.provider, r.out.data.pr.reason], [null, 'unsupported_remote']);
  assert.deepEqual(await t.calls('gh'), [], 'gh is used for github.com only');
  assert.ok((await t.calls('glab')).some((a) => a[0] === 'auth' && a.includes('github.example.com')));
});

test('a self-hosted host without glab: unsupported; complete and open-mr refuse its MR URL', async () => {
  const t = await providerTask({ remote: 'ssh://git@git.example.com:2222/team/widgets.git', glab: null });
  const r = t.run('apply', ['--task', t.taskId]);
  assert.deepEqual([r.out.data.pr.provider, r.out.data.pr.reason], [null, 'unsupported_remote']);

  const done = t.run('complete', ['--task', t.taskId, '--pr-url', 'https://git.example.com/team/widgets/-/merge_requests/1']);
  assert.equal(done.status, 2);
  assert.equal(done.out.error.code, 'E_INPUT');
  assert.equal(await t.state(), 'applied', 'nothing is recorded');

  const mr = t.run('open-mr', ['--task', t.taskId, '--title', 't', '--body-file', await t.bodyFile('- x\n')]);
  assert.equal(mr.status, 2);
  assert.match(mr.out.error.message, /GitLab 원격이 아님/);
});
