// prepare → draft → submit against temporary git repositories (MVP-PLAN M3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';
import { readEvents, deriveState, appendEvent } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { validate, inputSchema } from '../../skills/using-heirloom/lib/schema.mjs';
import { computeSourceState, computeCommitState } from '../../skills/using-heirloom/lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = 'docs/superpowers/specs/2026-11-12-x.md';
const SPEC_TEXT = '# X\n\n## 결정\n변환 결과는 반올림하지 않는다.\n';

async function setup() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write(SPEC, SPEC_TEXT);
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const home = await tempDir('home');
  return { upstream, repo, home };
}

/** @param {string} taskId @param {string} sourceHash */
function validDraft(taskId, sourceHash) {
  return {
    schemaVersion: 1,
    taskId,
    inputSourceHash: sourceHash,
    summary: [
      { text: 'a를 2로 바꿨다', codePaths: ['src/a.mjs'] },
      { text: 'spec을 추가했다', codePaths: ['src/a.mjs'] },
    ],
    records: [
      {
        op: 'add',
        kind: 'decision',
        title: '변환 결과는 반올림하지 않는다',
        body: { problem: '표시 형식', choice: '반올림하지 않음', alternatives: '소수 둘째 자리 반올림', scope: '변환 함수' },
        codePaths: ['src/a.mjs'],
        topics: ['format'],
        sources: [{ ref: SPEC, lines: [4, 4], quote: '변환 결과는 반올림하지 않는다.' }],
      },
    ],
    missing: ['리뷰 문서 없음'],
    conflicts: [],
    notes: '',
  };
}

/** @param {string} home @param {string} taskId @param {unknown} draft */
async function writeDraft(home, taskId, draft) {
  const file = taskPaths(home, taskId).draft;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(draft, null, 2));
}

/** @param {string} home @param {string} taskId */
async function stateOf(home, taskId) {
  return deriveState(await readEvents(taskPaths(home, taskId).events));
}

test('prepare freezes a valid input and reports unknowns', async () => {
  const { repo, home } = await setup();
  const result = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC], reviews: [] });
  assert.equal(result.alreadyPrepared, false);
  assert.equal(result.state, 'prepared');
  assert.equal(result.base.ref, 'origin/main');
  assert.deepEqual(result.source.files.map((/** @type {any} */ f) => f.path), [SPEC, 'src/a.mjs']);

  const input = await readJson(taskPaths(home, result.taskId).input);
  assert.deepEqual(validate(inputSchema, input), []);
  assert.deepEqual(result.unknowns.sort(), ['review', 'sdlcTaskRef']);
  assert.equal(/** @type {any} */ (input).materials[0].role, 'spec');
});

test('prepare runs once per state: the same state returns the existing task', async () => {
  const { repo, home } = await setup();
  const first = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  repo.commitAll('commit only');
  const second = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.alreadyPrepared, true);
  const prepared = (await readEvents(taskPaths(home, first.taskId).events)).filter((e) => e.type === 'prepared');
  assert.equal(prepared.length, 1);
});

test('auto handoff requires a spec; manual handoff does not', async () => {
  const { repo, home } = await setup();
  await assert.rejects(prepareHandoff({ cwd: repo.dir, home, specs: [] }), (err) => /** @type {any} */ (err).code === 'E_INPUT');
  const manual = await prepareHandoff({ cwd: repo.dir, home, specs: [], manual: true });
  assert.equal(manual.state, 'prepared');
  assert.ok(manual.unknowns.includes('spec'));
});

test('a held task lock means the same work is in progress (E_CONFLICT)', async () => {
  const { repo, home } = await setup();
  const { taskId } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await mkdir(path.join(taskPaths(home, taskId).dir, 'task.lock'));
  await repo.write('src/a.mjs', 'export const a = 3;\n');
  await assert.rejects(prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] }), (err) => /** @type {any} */ (err).code === 'E_CONFLICT');
});

test('submit: valid draft → awaiting approval, handoff.md, initial copy, record ids', async () => {
  const { repo, home } = await setup();
  const { taskId, source } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await writeDraft(home, taskId, validDraft(taskId, source.hash));

  const result = await submitDraft({ home, taskId });
  assert.equal(result.state, 'awaiting_approval');
  assert.equal(result.recordIds.length, 1);
  assert.equal(await stateOf(home, taskId), 'awaiting_approval');

  const paths = taskPaths(home, taskId);
  const handoff = await readFile(paths.handoff, 'utf8');
  assert.match(handoff, /a를 2로 바꿨다/);
  assert.match(handoff, new RegExp(result.recordIds[0]));
  assert.match(handoff, /리뷰 문서 없음/);
  await access(paths.draftInitial);
  assert.equal(/** @type {any} */ (await readJson(paths.check)).ok, true);
});

test('submit: errors keep the task in prepared and are written to check.json (E_VERIFY)', async () => {
  const { repo, home } = await setup();
  const { taskId, source } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const bad = validDraft(taskId, source.hash);
  bad.summary[0].codePaths = [SPEC];
  await writeDraft(home, taskId, bad);

  await assert.rejects(submitDraft({ home, taskId }), (err) => {
    const e = /** @type {any} */ (err);
    return e.code === 'E_VERIFY' && /마크다운/.test(e.message);
  });
  assert.equal(await stateOf(home, taskId), 'prepared');
  const check = /** @type {any} */ (await readJson(taskPaths(home, taskId).check));
  assert.equal(check.ok, false);
  await assert.rejects(access(taskPaths(home, taskId).draftInitial));
});

test('submit: a missing draft is an input error', async () => {
  const { repo, home } = await setup();
  const { taskId } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await assert.rejects(submitDraft({ home, taskId }), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('source changed after prepare: submit refuses; re-prepare starts a new state and drops the old draft', async () => {
  const { repo, home } = await setup();
  const first = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await writeDraft(home, first.taskId, validDraft(first.taskId, first.source.hash));
  await repo.write('src/a.mjs', 'export const a = 3;\n');

  await assert.rejects(submitDraft({ home, taskId: first.taskId }), (err) => /** @type {any} */ (err).code === 'E_CONFLICT');

  const second = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.alreadyPrepared, false);
  assert.notEqual(second.source.hash, first.source.hash);
  await assert.rejects(access(taskPaths(home, first.taskId).draft));
  await writeDraft(home, first.taskId, validDraft(first.taskId, first.source.hash));
  await assert.rejects(submitDraft({ home, taskId: first.taskId }), /inputSourceHash/);
});

test('parallel worktrees get separate tasks', async () => {
  const { repo, home } = await setup();
  repo.commitAll('work');
  const wtDir = path.join(await tempDir('wt'), 'other');
  repo.git('worktree', 'add', '-q', '-b', 'feat-2', wtDir, 'origin/main');
  await writeFile(path.join(wtDir, 'src', 'a.mjs'), 'export const a = 9;\n');
  await mkdir(path.join(wtDir, 'docs', 'superpowers', 'specs'), { recursive: true });
  await writeFile(path.join(wtDir, SPEC), SPEC_TEXT);

  const a = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const b = await prepareHandoff({ cwd: wtDir, home, specs: [SPEC] });
  assert.notEqual(a.taskId, b.taskId);
  assert.notEqual(a.source.hash, b.source.hash);
});

test('a discarded task is not reused', async () => {
  const { repo, home } = await setup();
  const first = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await appendEvent(taskPaths(home, first.taskId).events, { type: 'discarded', reason: 'user' });
  await repo.write('src/a.mjs', 'export const a = 4;\n');
  const second = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  assert.notEqual(second.taskId, first.taskId);
});

test('reviewed commit: matches the current state until the source changes', async () => {
  const { repo, home } = await setup();
  await repo.write('docs/review.md', '# review\nLGTM\n');
  repo.commitAll('work');
  const head = repo.git('rev-parse', 'HEAD');

  const same = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC], reviews: ['docs/review.md'], reviewedCommit: head });
  assert.equal(same.reviewMatchesSource, true);
  assert.ok(!same.unknowns.includes('reviewedSourceHash'));

  await repo.write('src/a.mjs', 'export const a = 5;\n');
  const changed = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC], reviews: ['docs/review.md'], reviewedCommit: head });
  assert.equal(changed.reviewMatchesSource, false);
  await writeDraft(home, changed.taskId, validDraft(changed.taskId, changed.source.hash));
  await submitDraft({ home, taskId: changed.taskId });
  assert.match(await readFile(taskPaths(home, changed.taskId).handoff, 'utf8'), /리뷰 이후 소스가 바뀜/);
});

test('computeCommitState equals computeSourceState for a clean tree at that commit', async () => {
  const { repo } = await setup();
  repo.commitAll('work');
  const mergeBase = repo.git('merge-base', 'origin/main', 'HEAD');
  const worktree = await computeSourceState({ root: repo.dir, mergeBase });
  const commit = await computeCommitState({ root: repo.dir, mergeBase, commit: 'HEAD' });
  assert.deepEqual(commit, worktree);
});

test('scripts print one JSON object and use the exit code convention', async () => {
  const { repo, home } = await setup();
  const env = { ...process.env, HEIRLOOM_HOME: home };
  const script = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'prepare.mjs');

  const ok = spawnSync(process.execPath, [script, '--spec', SPEC], { cwd: repo.dir, env, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.ok, true);
  assert.match(out.data.draftPath, /draft\.json$/);

  const bad = spawnSync(process.execPath, [script, '--spec', SPEC, '--base', 'nope'], { cwd: repo.dir, env, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).error.code, 'E_INPUT');

  const unknownFlag = spawnSync(process.execPath, [script, '--frobnicate'], { cwd: repo.dir, env, encoding: 'utf8' });
  assert.equal(unknownFlag.status, 2);

  const submit = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'submit-draft.mjs');
  const missing = spawnSync(process.execPath, [submit, '--task', out.data.taskId], { cwd: repo.dir, env, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).ok, false);
});
