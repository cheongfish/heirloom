import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { evaluateStop } from '../../skills/using-heirloom/lib/reminder.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { resolveIds } from '../../skills/using-heirloom/lib/ids.mjs';
import { taskIdFor } from '../../skills/using-heirloom/lib/store.mjs';
import { appendEvent } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { computeSourceState } from '../../skills/using-heirloom/lib/state.mjs';
import { writeRecord, renderBody } from '../../skills/using-heirloom/lib/records.mjs';
import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A clone of an upstream repo (so origin/HEAD exists) on branch feat. */
async function workRepo() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  const home = await tempDir('home');
  return { upstream, repo, home };
}

test('stop: stop_hook_active short-circuits before touching git', async () => {
  const result = await evaluateStop({ cwd: '/nonexistent', home: '/nonexistent', stopHookActive: true });
  assert.deepEqual(result, { remind: false, reason: 'stop_hook_active' });
});

test('stop: not a git repository, or no changes', async () => {
  const dir = await tempDir('plain');
  assert.equal((await evaluateStop({ cwd: dir, home: dir, stopHookActive: false })).reason, 'not_git');
  const { repo, home } = await workRepo();
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_changes');
});

test('stop: no target branch means no reminder (never guess)', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  await repo.write('docs/superpowers/specs/x.md', 'spec\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_base');
});

test('stop: changes without a linked spec do not remind', async () => {
  const { repo, home } = await workRepo();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  await repo.write('docs/notes.md', 'not a spec\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_spec');
});

test('stop: code changes without a spec get one notice per session that they can be handed off', async () => {
  const { repo, home } = await workRepo();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_spec', 'no transcript: the session is unknown');

  const first = await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: '/t/a.jsonl' });
  assert.equal(first.reason, 'notice');
  assert.equal(first.remind, true);
  assert.match(String(first.message), /prepare-handoff/);
  assert.match(String(first.message), /--manual/);
  assert.match(String(first.message), /사용자가 요청할 때만/);
  assert.match(String(first.message), /이 세션에서 다시 나오지 않는다/);

  await repo.write('src/a.mjs', 'export const a = 3;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: '/t/a.jsonl' })).reason, 'already_noticed', 'not again after more changes');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: '/t/b.jsonl' })).reason, 'notice', 'a new session is told');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: true, transcriptPath: '/t/c.jsonl' })).reason, 'stop_hook_active');
});

test('stop: no notice once the user handed this state off', async () => {
  const { repo, home } = await workRepo();
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const info = await repoInfo(repo.dir);
  const { worktreeId } = await resolveIds(home, info);
  const taskId = /** @type {string} */ (await taskIdFor(home, { worktreeId, branch: 'feat', specRef: null }));
  const state = await computeSourceState({ root: repo.dir, mergeBase: repo.git('merge-base', 'origin/main', 'HEAD') });
  await appendEvent(taskPaths(home, taskId).events, { type: 'prepared', sourceHash: state.hash, attempt: 1 });
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: '/t/a.jsonl' })).reason, 'no_spec');
});

test('stop: reminds once per source state, again after the state changes', async () => {
  const { repo, home } = await workRepo();
  await repo.write('docs/superpowers/specs/2026-11-12-x.md', 'spec\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');

  const first = await evaluateStop({ cwd: repo.dir, home, stopHookActive: false });
  assert.equal(first.remind, true);
  assert.match(/** @type {string} */ (first.message), /prepare-handoff/);
  assert.match(/** @type {string} */ (first.message), /docs\/superpowers\/specs\/2026-11-12-x\.md/);

  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'already_reminded');
  repo.commitAll('work');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'already_reminded', 'commit only');

  await repo.write('src/a.mjs', 'export const a = 3;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).remind, true);
});

test('stop: no reminder when a handoff was already requested for this state', async () => {
  const { repo, home } = await workRepo();
  await repo.write('specs/x.md', 'spec\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');

  const info = await repoInfo(repo.dir);
  const { worktreeId } = await resolveIds(home, info);
  const taskId = /** @type {string} */ (await taskIdFor(home, { worktreeId, branch: 'feat', specRef: 'specs/x.md' }));
  const state = await computeSourceState({ root: repo.dir, mergeBase: repo.git('merge-base', 'origin/main', 'HEAD') });
  await appendEvent(taskPaths(home, taskId).events, { type: 'prepared', sourceHash: state.hash, attempt: 1 });

  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'handoff_requested');
});

test('stop: spec and plan documents alone are not work changes (brainstorming/planning phase)', async () => {
  const { repo, home } = await workRepo();
  await repo.write('docs/superpowers/specs/2026-11-12-x.md', 'spec\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_code_changes');
  await repo.write('docs/superpowers/plans/2026-11-12-x.md', 'plan\n');
  repo.commitAll('spec and plan');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_code_changes');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).remind, true);
});

test('stop: an approved task whose code changed is reminded of the incremental recheck, once per state', async () => {
  const t = await submittedTask();
  const paths = taskPaths(t.home, t.taskId);
  const draft = /** @type {any} */ (await readJson(paths.draft));
  await approveTask({
    home: t.home,
    taskId: t.taskId,
    keystore: 'file',
    request: { kind: 'full', draftSha256: draftDigest(draft), sourceHash: t.sourceHash, summary: ['s'], items: [{ index: 0, decision: 'approved' }] },
  });
  assert.equal((await evaluateStop({ cwd: t.repo.dir, home: t.home, stopHookActive: false })).reason, 'handoff_requested', 'the approved state itself');

  await t.repo.write('docs/notes.md', 'only a document\n');
  assert.deepEqual(await evaluateStop({ cwd: t.repo.dir, home: t.home, stopHookActive: false }), { remind: false, reason: 'recheck_not_needed' }, 'a document alone does not ask for a recheck');

  await t.repo.write('src/a.mjs', 'export const a = 3;\n');
  const first = await evaluateStop({ cwd: t.repo.dir, home: t.home, stopHookActive: false });
  assert.equal(first.reason, 'recheck');
  assert.equal(first.remind, true);
  assert.match(first.message ?? '', new RegExp(`${t.taskId}[\\s\\S]*prepare-handoff`));
  assert.equal((await evaluateStop({ cwd: t.repo.dir, home: t.home, stopHookActive: false })).reason, 'already_reminded');
});

test('stop: respects project specGlobs', async () => {
  const { repo, home } = await workRepo();
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, specGlobs: ['design/**'] }));
  await repo.write('specs/x.md', 'spec\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_spec');
  await repo.write('design/y.md', 'design\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).remind, true);
});

/**
 * @param {string} root
 * @param {string} id
 * @param {'decision' | 'axiom'} kind
 * @param {string} title
 * @param {string[]} codePaths
 */
async function record(root, id, kind, title, codePaths, active = true) {
  const body =
    kind === 'axiom'
      ? renderBody('axiom', { property: 'P', scope: 'S', exceptions: '', checks: '' })
      : renderBody('decision', { problem: 'P', choice: 'C', alternatives: '', scope: '' });
  await writeRecord(root, {
    meta: {
      schemaVersion: 1,
      id,
      kind,
      title,
      active,
      codePaths,
      topics: [],
      supersedes: [],
      supersededBy: null,
      relations: [],
      sources: [{ ref: 'docs/spec.md', sha256: 'a'.repeat(64) }],
      taskId: 't-20261112-00000000',
      approval: { id: 'ap-000000000000', signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' },
    },
    body,
  });
}

test('session context: convention only outside a git repository', async () => {
  const dir = await tempDir('plain');
  const context = await buildSessionContext({ cwd: dir, home: dir, pluginRoot: PLUGIN_ROOT });
  assert.match(context, /<heirloom-convention>/);
  assert.doesNotMatch(context, /^name: using-heirloom/m, 'front matter is stripped');
  assert.doesNotMatch(context, /^<heirloom-project>$/m);
});

test('session context: axioms, decision index with related ones first, cap, pending tasks', async () => {
  const { upstream, repo, home } = await workRepo();
  // Records merged on the base branch are active (PLAN 14.3).
  await record(upstream.dir, 'a-00000001', 'axiom', '승인은 사람만 한다', ['skills/**']);
  await record(upstream.dir, 'a-00000002', 'axiom', '비활성 axiom', [], false);
  await record(upstream.dir, 'd-00000001', 'decision', '무관한 결정', ['lib/other.mjs']);
  await record(upstream.dir, 'd-00000002', 'decision', '관련 결정', ['src/**/*.mjs']);
  await record(upstream.dir, 'd-00000003', 'decision', '또 다른 무관한 결정', ['lib/x.mjs']);
  await record(upstream.dir, 'd-00000004', 'decision', '폐기된 결정', ['src/a.mjs'], false);
  upstream.commitAll('records');
  repo.git('fetch', '-q', 'origin');
  repo.git('merge', '-q', 'origin/main');
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, sessionIndex: { maxDecisions: 2 } }));
  repo.commitAll('config');
  await repo.write('src/a.mjs', 'export const a = 2;\n');

  const info = await repoInfo(repo.dir);
  const { worktreeId } = await resolveIds(home, info);
  const taskId = /** @type {string} */ (await taskIdFor(home, { worktreeId, branch: 'feat', specRef: null }));
  const events = taskPaths(home, taskId).events;
  for (const e of [
    { type: 'prepared', sourceHash: `sha256:${'b'.repeat(64)}`, attempt: 1 },
    { type: 'draft_checked', ok: true },
    { type: 'awaiting_approval' },
    { type: 'approved', approvalId: 'ap-000000000001' },
  ]) {
    await appendEvent(events, /** @type {any} */ (e));
  }

  const context = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  assert.match(context, /a-00000001: 승인은 사람만 한다/);
  assert.doesNotMatch(context, /비활성 axiom/);
  assert.doesNotMatch(context, /폐기된 결정/);
  const related = context.indexOf('d-00000002');
  const unrelated = context.indexOf('d-00000001');
  assert.ok(related !== -1 && unrelated !== -1 && related < unrelated, 'related decision listed first');
  assert.doesNotMatch(context, /d-00000003/, 'capped at maxDecisions');
  assert.match(context, /1개 더 있음/);
  assert.match(context, new RegExp(`${taskId}.*승인됨`));
  assert.match(context, /apply-approval/);
  assert.match(context, /fetch/);
});

test('session context: does not create id files in a repository never used with Heirloom', async () => {
  const { repo, home } = await workRepo();
  await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  await assert.rejects(access(path.join(repo.dir, '.git', 'heirloom-repo-id')));
});

test('session context: lists commit message guides', async () => {
  const { repo, home } = await workRepo();
  await repo.write('.gitmessage', '# template\n');
  await repo.write('CONTRIBUTING.md', '# contributing\n');
  repo.git('config', 'commit.template', '.gitmessage');
  const context = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  assert.match(context, /\.gitmessage/);
  assert.match(context, /CONTRIBUTING\.md/);
});
