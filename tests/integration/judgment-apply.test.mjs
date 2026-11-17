// Applying a judgment (pivot 5.5, 6.2): no records yet, the PR paragraph comes from the
// signed judgment only, the status goes on the commit that holds exactly the judged code,
// and only a code change (not Markdown) after the judgment stops the apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';
import { CART_HEAD, judge, judgedTask } from '../helpers/judge-fixture.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { SECTION_END, SECTION_START, mergeSection } from '../../skills/using-heirloom/lib/judgment-pr.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = (/** @type {string} */ name) => path.join(ROOT, 'skills', 'apply-approval', 'scripts', `${name}.mjs`);

/**
 * A judged task on a GitHub or GitLab remote, with the fake gh or glab on PATH.
 * @param {{ provider?: 'github' | 'gitlab', commit?: boolean, verdicts?: any }} [options]
 */
async function setup({ provider = 'github', commit = true, verdicts } = {}) {
  const t = await judgedTask({ commit });
  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash, verdicts });
  t.repo.git('remote', 'set-url', 'origin', provider === 'github' ? 'https://github.com/acme/widgets.git' : 'https://gitlab.com/acme/tools/widgets.git');
  const dir = await tempDir('fakes');
  const state = path.join(dir, 'state.json');
  await writeFile(state, JSON.stringify(provider === 'github' ? {} : { hosts: ['gitlab.com'] }));
  const bin = await tempDir('bin');
  await symlink(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));
  await symlink(process.execPath, path.join(bin, 'node'));
  const env = {
    ...process.env,
    PATH: [path.join(ROOT, 'tests', 'helpers', provider === 'github' ? 'fake-gh' : 'fake-glab'), bin].join(path.delimiter),
    HEIRLOOM_HOME: t.home,
    HEIRLOOM_KEYSTORE: 'file',
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND: 'false',
    [provider === 'github' ? 'FAKE_GH_STATE' : 'FAKE_GLAB_STATE']: state,
  };
  /** @param {string} name @param {string[]} args */
  const run = (name, args) => {
    const r = spawnSync(process.execPath, [script(name), ...args], { cwd: t.repo.dir, env, encoding: 'utf8' });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
  };
  const fake = async () => JSON.parse(await readFile(state, 'utf8'));
  return { ...t, judgment, run, fake, dir };
}

test('github: apply a judgment, write the paragraph into the body, record the PR and post the status on the judged commit', async () => {
  const t = await setup();
  const head = t.repo.git('rev-parse', 'HEAD');
  const applied = t.run('apply', ['--task', t.taskId]);
  assert.equal(applied.status, 0, applied.stderr);
  const data = applied.out.data;
  assert.equal(data.kind, 'judgment');
  assert.equal(data.state, 'applied');
  assert.deepEqual(data.files, []);
  assert.deepEqual(data.status, { sha: head, reason: null });
  assert.equal(data.pr.available, true);
  assert.equal(data.pr.repo, 'acme/widgets');

  const body = path.join(t.dir, 'body.md');
  await writeFile(body, '## 요약\n\n템플릿 내용\n');
  const written = t.run('pr-body', ['--task', t.taskId, '--body-file', body]);
  assert.equal(written.status, 0, written.stderr);
  const text = await readFile(body, 'utf8');
  assert.ok(text.startsWith('## 요약\n\n템플릿 내용\n\n<!-- heirloom:understood:start -->'), text);
  assert.match(text, /### 사람이 확인한 동작/);
  assert.match(text, /- 12개 구매 결제액이 108에서 120이 된다/);
  assert.match(text, /- 단가 10원으로 12개를 사면 결제액은\? 예측 108\(틀림\) → 예측과 달랐지만 의도대로 확인함/);
  assert.match(text, /- 테스트 `bulk discount for 12`\(12개 구매에 대량 할인이 붙는지 본다\): 이 변경의 동작을 막는다고 예측 → 예상대로 확인함/);
  assert.match(text, /- 결정: 경계를 100으로 할까요, 50으로 할까요\? — "100으로 한다"/);
  assert.match(text, /- 실행 증거 없음: 다른 통화에서도 같다/);
  assert.match(text, new RegExp(`<sub>Heirloom 판정 ${t.judgment.id} · 탐침 p1 · head ${head.slice(0, 7)}</sub>`));
  // Running it again replaces the paragraph instead of adding a second one.
  assert.equal(t.run('pr-body', ['--task', t.taskId, '--body-file', body]).status, 0);
  assert.equal((await readFile(body, 'utf8')).split(SECTION_START).length, 2);

  const url = 'https://github.com/acme/widgets/pull/7';
  const done = t.run('complete', ['--task', t.taskId, '--pr-url', url]);
  assert.equal(done.status, 0, done.stderr);
  assert.deepEqual(done.out.data.status, { sha: head, context: 'heirloom/understood', posted: true, error: null });
  assert.deepEqual((await t.fake()).statuses, [{ repo: 'acme/widgets', sha: head, state: 'success', context: 'heirloom/understood', description: `Heirloom 판정 ${t.judgment.id}` }]);
  const events = await readEvents(taskPaths(t.home, t.taskId).events);
  assert.equal(deriveState(events), 'pr_created');
  assert.equal(events.at(-1)?.statusSha, head);

  // A Markdown change after the judgment does not stop anything; a code change does.
  await t.repo.write('docs/notes.md', '# 메모\n');
  assert.equal(t.run('apply', ['--task', t.taskId]).status, 0);
  await t.repo.write('src/cart.mjs', `${CART_HEAD}// more\n`);
  const stale = t.run('apply', ['--task', t.taskId]);
  assert.equal(stale.status, 3);
  assert.match(stale.out.error.message, /판정 이후 코드가 바뀜/);
  assert.equal(deriveState(await readEvents(taskPaths(t.home, t.taskId).events)), 'stale');
});

test('uncommitted judged code: no status commit until it is committed; then the status goes on that commit', async () => {
  const t = await setup({ commit: false });
  const applied = t.run('apply', ['--task', t.taskId]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(applied.out.data.status, { sha: null, reason: 'uncommitted' });
  const url = 'https://github.com/acme/widgets/pull/8';
  const early = t.run('complete', ['--task', t.taskId, '--pr-url', url]);
  assert.equal(early.status, 3);
  assert.match(early.out.error.message, /판정한 코드가 아직 커밋되지 않음/);

  t.repo.commitAll('judged change');
  const head = t.repo.git('rev-parse', 'HEAD');
  assert.deepEqual(t.run('apply', ['--task', t.taskId]).out.data.status, { sha: head, reason: null });
  const done = t.run('complete', ['--task', t.taskId, '--pr-url', url]);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.out.data.status.sha, head);
});

test('gitlab: the status is posted on the project of the merge request', async () => {
  const t = await setup({ provider: 'gitlab' });
  const head = t.repo.git('rev-parse', 'HEAD');
  assert.equal(t.run('apply', ['--task', t.taskId]).status, 0);
  const done = t.run('complete', ['--task', t.taskId, '--pr-url', 'https://gitlab.com/acme/tools/widgets/-/merge_requests/3']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.out.data.status.posted, true);
  assert.deepEqual((await t.fake()).statuses, [{ project: 'acme/tools/widgets', sha: head, state: 'success', name: 'heirloom/understood', description: `Heirloom 판정 ${t.judgment.id}` }]);
});

test('a status that cannot be posted is reported; the PR is still recorded', async () => {
  const t = await setup();
  await writeFile(path.join(t.dir, 'state.json'), JSON.stringify({ fail: 'status' }));
  assert.equal(t.run('apply', ['--task', t.taskId]).status, 0);
  const done = t.run('complete', ['--task', t.taskId, '--pr-url', 'https://github.com/acme/widgets/pull/9']);
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.out.data.status.posted, false);
  assert.match(done.out.data.status.error, /HTTP 403/);
  assert.equal(done.out.data.state, 'pr_created');
});

test('a returned judgment has nothing to apply and no paragraph', async () => {
  const t = await setup({ verdicts: { q1: { verdict: 'revert', reason: '할인이 붙어야 한다' } } });
  const r = t.run('apply', ['--task', t.taskId]);
  assert.equal(r.status, 3);
  assert.match(r.out.error.message, /반영할 승인이 없음 \(현재 상태: returned\)/);
  assert.equal(t.run('pr-body', ['--task', t.taskId, '--body-file', path.join(t.dir, 'b.md')]).status, 3);
});

test('mergeSection: replaces only the marked paragraph', () => {
  const section = `${SECTION_START}\nnew\n${SECTION_END}`;
  assert.equal(mergeSection('', section), `${section}\n`);
  assert.equal(mergeSection(`위\n\n${SECTION_START}\nold\n${SECTION_END}\n\n아래\n`, section), `위\n\n${section}\n\n아래\n`);
});
