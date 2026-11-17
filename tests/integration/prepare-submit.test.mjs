// prepare → draft → submit against temporary git repositories (MVP-PLAN M3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { serializeRecord } from '../../skills/using-heirloom/lib/records.mjs';
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

/**
 * Run the task's one probe (the value of `a` on base and head) and return a schema 2 draft
 * for it.
 * @param {string} home
 * @param {string} taskId
 * @param {string} sourceHash
 */
async function validDraft(home, taskId, sourceHash) {
  const probes = /** @type {any} */ (
    await runProbes({ home, taskId, spec: { probes: [{ id: 'p1', title: 'a의 값', run: ['node', '-e', "import('./src/a.mjs').then((m) => console.log(m.a))"] }] } })
  );
  const [base, head] = [probes.probes[0].base.stdout.trim(), probes.probes[0].head.stdout.trim()];
  return {
    schemaVersion: 2,
    taskId,
    inputSourceHash: sourceHash,
    probeSetHash: probes.probeSetHash,
    behaviorDiffs: [{ text: `a의 값이 ${base}에서 ${head}가 된다`, probes: ['p1'], codePaths: ['src/a.mjs'] }],
    questions: [
      { id: 'q1', kind: 'predict', probe: 'p1', prompt: '이제 a의 값은?', answerType: 'number' },
      { id: 'q2', kind: 'intent', probe: 'p1', sources: [{ ref: SPEC, lines: [4, 4], quote: '변환 결과는 반올림하지 않는다.' }], prompt: 'spec의 의도와 같나요?' },
    ],
    inferences: [{ text: '다른 모듈은 a를 읽지 않는다', reason: '호출부를 실행해 보지 않았다' }],
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

test('submit: valid draft → awaiting approval and a handoff.md without observed values', async () => {
  const { repo, home } = await setup();
  const { taskId, source } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await writeDraft(home, taskId, await validDraft(home, taskId, source.hash));

  const result = await submitDraft({ home, taskId });
  assert.equal(result.state, 'awaiting_approval');
  assert.equal(await stateOf(home, taskId), 'awaiting_approval');

  const paths = taskPaths(home, taskId);
  const handoff = await readFile(paths.handoff, 'utf8');
  assert.match(handoff, /## 질문 \(2\)/);
  assert.match(handoff, /이제 a의 값은\?/);
  assert.match(handoff, /다른 모듈은 a를 읽지 않는다/);
  assert.doesNotMatch(handoff, /1에서 2가 된다/, 'behavior descriptions are revealed in the dashboard only');
  assert.equal(/** @type {any} */ (await readJson(paths.check)).ok, true);
});

test('submit: a schema 1 draft is refused (E_VERIFY)', async () => {
  const { repo, home } = await setup();
  const { taskId, source } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await writeDraft(home, taskId, { schemaVersion: 1, taskId, inputSourceHash: source.hash, summary: [], records: [], missing: [], conflicts: [], notes: '' });
  await assert.rejects(submitDraft({ home, taskId }), (err) => {
    const e = /** @type {any} */ (err);
    return e.code === 'E_VERIFY' && /\$\.schemaVersion: 2여야 함/.test(e.message);
  });
});

test('submit: errors keep the task in prepared and are written to check.json (E_VERIFY)', async () => {
  const { repo, home } = await setup();
  const { taskId, source } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const bad = await validDraft(home, taskId, source.hash);
  bad.behaviorDiffs[0].codePaths = [SPEC];
  await writeDraft(home, taskId, bad);

  await assert.rejects(submitDraft({ home, taskId }), (err) => {
    const e = /** @type {any} */ (err);
    return e.code === 'E_VERIFY' && /마크다운/.test(e.message);
  });
  assert.equal(await stateOf(home, taskId), 'prepared');
  const check = /** @type {any} */ (await readJson(taskPaths(home, taskId).check));
  assert.equal(check.ok, false);
  await assert.rejects(access(taskPaths(home, taskId).handoff));
});

test('submit: a missing draft is an input error', async () => {
  const { repo, home } = await setup();
  const { taskId } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  await assert.rejects(submitDraft({ home, taskId }), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('source changed after prepare: submit refuses; re-prepare starts a new state and drops the old draft', async () => {
  const { repo, home } = await setup();
  const first = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const stale = await validDraft(home, first.taskId, first.source.hash);
  await writeDraft(home, first.taskId, stale);
  await repo.write('src/a.mjs', 'export const a = 3;\n');

  await assert.rejects(submitDraft({ home, taskId: first.taskId }), (err) => /** @type {any} */ (err).code === 'E_CONFLICT');

  const second = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.alreadyPrepared, false);
  assert.notEqual(second.source.hash, first.source.hash);
  await assert.rejects(access(taskPaths(home, first.taskId).draft));
  await writeDraft(home, first.taskId, stale);
  await assert.rejects(submitDraft({ home, taskId: first.taskId }), /inputSourceHash/);
});

test('prepare lists the schema 2 decision records whose scope covers a changed file', async () => {
  const { repo, home } = await setup();
  const ap = { id: 'ap-000000000001', signer: 'SHA256:x', approvedAt: '2026-11-12T00:00:00Z' };
  /** @param {string} id @param {string[]} scope */
  const decision = (id, scope) =>
    serializeRecord({
      meta: /** @type {any} */ ({
        schemaVersion: 2,
        id,
        kind: 'decision',
        choice: `${id} 선택`,
        question: '질문',
        scope,
        anchors: [{ file: 'src/a.mjs', symbol: 'a' }, { file: 'src/a.mjs', test: 'a' }],
        source: [{ kind: 'fork-answer', approval: ap.id, question: 'q1' }],
        replaces: null,
        taskId: 't-20261101-77777777',
        approval: ap,
      }),
      body: '\n## 질문\n\n질문\n',
    });
  await repo.write('.heirloom/decisions/d-00000001.md', decision('d-00000001', ['src/**']));
  await repo.write('.heirloom/decisions/d-00000002.md', decision('d-00000002', ['lib/**']));
  const result = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  assert.deepEqual(result.relatedRecords, [{ id: 'd-00000001', choice: 'd-00000001 선택', scope: ['src/**'] }]);
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
  await writeDraft(home, changed.taskId, await validDraft(home, changed.taskId, changed.source.hash));
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
