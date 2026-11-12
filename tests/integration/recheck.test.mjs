// Incremental recheck end to end against temporary repositories (PLAN 13; PHASE3-PLAN N2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { applyApproval, completePr } from '../../skills/using-heirloom/lib/apply.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { readRecords } from '../../skills/using-heirloom/lib/records.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';

const SPEC = 'docs/superpowers/specs/2026-11-13-r.md';
const SPEC_TEXT = '# R\n\na는 정수로 둔다.\nb는 문자열로 둔다.\n';

/** @param {Promise<unknown>} p @param {string} code */
const rejectsWith = (p, code) => assert.rejects(p, (/** @type {any} */ e) => e instanceof HeirloomError && e.code === code);

/** @param {string} home @param {string} taskId */
const stateOf = async (home, taskId) => deriveState(await readEvents(taskPaths(home, taskId).events));

/** @param {string} id @param {string} file @param {string} quote @param {number} line */
const decisionFor = (id, file, quote, line) => ({
  op: 'add',
  kind: 'decision',
  title: `${id} 결정`,
  body: { problem: 'p', choice: 'c', alternatives: '', scope: '' },
  codePaths: [file],
  topics: [],
  sources: [{ ref: SPEC, lines: [line, line], quote }],
});

/**
 * A task on branch `feat` that changed src/a.mjs and src/b.mjs, with one bullet and one
 * decision per file, approved in the dashboard.
 */
async function approvedTask() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n', 'src/b.mjs': "export const b = '1';\n" });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write(SPEC, SPEC_TEXT);
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  await repo.write('src/b.mjs', "export const b = '2';\n");
  const home = await tempDir('home');
  const prepared = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const paths = taskPaths(home, prepared.taskId);
  await writeFile(
    paths.draft,
    JSON.stringify({
      schemaVersion: 1,
      taskId: prepared.taskId,
      inputSourceHash: prepared.source.hash,
      summary: [
        { text: 'a를 2로 바꿨다', codePaths: ['src/a.mjs'] },
        { text: 'b를 2로 바꿨다', codePaths: ['src/b.mjs'] },
      ],
      records: [decisionFor('a', 'src/a.mjs', 'a는 정수로 둔다.', 3), decisionFor('b', 'src/b.mjs', 'b는 문자열로 둔다.', 4)],
      missing: [],
      conflicts: [],
      notes: '',
    }),
  );
  await submitDraft({ home, taskId: prepared.taskId });
  const approval = await approve(home, prepared.taskId, {
    summary: ['a를 2로 바꿨다 (사람)', 'b를 2로 바꿨다'],
    summaryOrigins: [0, 1],
    items: [
      { index: 0, decision: 'approved', edited: { title: 'a는 정수' } },
      { index: 1, decision: 'approved' },
    ],
  });
  return { upstream, repo, home, taskId: prepared.taskId, paths, approval };
}

/**
 * @param {string} home
 * @param {string} taskId
 * @param {{ kind?: 'full' | 'quick', summary: string[], summaryOrigins?: (number | null)[], items: any[] }} request
 */
async function approve(home, taskId, request) {
  const paths = taskPaths(home, taskId);
  const draft = /** @type {any} */ (await readJson(paths.draft));
  const input = /** @type {any} */ (await readJson(paths.input));
  return approveTask({ home, taskId, keystore: 'file', request: { kind: 'full', draftSha256: draftDigest(draft), sourceHash: input.source.hash, ...request } });
}

/**
 * Prepare again and write a draft that copies the baseline, letting `edit` change it.
 * @param {{ repo: any, home: string, taskId: string, paths: any }} t
 * @param {(draft: any, input: any) => void} [edit]
 */
async function recheckRound(t, edit = () => {}) {
  const prepared = /** @type {any} */ (await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] }));
  assert.equal(prepared.taskId, t.taskId, 'the same task is prepared again');
  const input = /** @type {any} */ (await readJson(t.paths.input));
  const draft = {
    schemaVersion: 1,
    taskId: t.taskId,
    inputSourceHash: input.source.hash,
    summary: input.recheck.baseline.summary.map((/** @type {any} */ s, /** @type {number} */ i) => ({ ...s, baseIndex: i })),
    records: input.recheck.baseline.records.map((/** @type {any} */ r, /** @type {number} */ i) => ({ ...structuredClone(r), baseIndex: i })),
    missing: [],
    conflicts: [],
    notes: '',
  };
  edit(draft, input);
  await writeFile(t.paths.draft, JSON.stringify(draft));
  return { prepared, input, draft };
}

test('approved, then edited: only the touched bullet and decision are rechecked; the rest keep their approval', async () => {
  const t = await approvedTask();
  await t.repo.write('src/b.mjs', "export const b = '3';\n");

  const { prepared, input } = await recheckRound(t, (d) => {
    d.summary[1].text = 'b를 3으로 바꿨다';
  });
  assert.equal(prepared.recheck.basedOn, t.approval.id);
  assert.deepEqual(prepared.recheck.changes, [{ path: 'src/b.mjs', reason: 'edited' }]);
  assert.deepEqual(input.recheck.affected.summary, [{ index: 1, reasons: ['src/b.mjs'] }]);
  assert.deepEqual(input.recheck.affected.records, [{ index: 1, reasons: ['src/b.mjs'] }]);
  assert.equal(input.recheck.baseline.summary[0].text, 'a를 2로 바꿨다 (사람)', 'the baseline is the approved text');
  assert.equal(input.recheck.baseline.records[0].title, 'a는 정수', 'with the dashboard edit');
  const events = await readEvents(t.paths.events);
  assert.equal(events.at(-1)?.recheckOf, t.approval.id);

  await submitDraft({ home: t.home, taskId: t.taskId });
  assert.match(await readFile(t.paths.handoff, 'utf8'), /## 증분 재확인[\s\S]*src\/b\.mjs: 수정[\s\S]*승인이 유지되는 항목: 요약 1개, 기록 1개/);

  // A decision for a carried item is refused; the open item must be decided.
  await rejectsWith(approve(t.home, t.taskId, { summary: ['x'], items: [{ index: 0, decision: 'approved' }, { index: 1, decision: 'approved' }] }), 'E_INPUT');
  await rejectsWith(approve(t.home, t.taskId, { summary: ['x'], items: [] }), 'E_INPUT');

  const second = await approve(t.home, t.taskId, {
    summary: ['a를 2로 바꿨다 (사람)', 'b를 3으로 바꿨다'],
    summaryOrigins: [0, 1],
    items: [{ index: 1, decision: 'approved' }],
  });
  assert.equal(second.kind, 'incremental');
  assert.equal(second.basedOn, t.approval.id);
  assert.deepEqual(second.items, [
    { index: 0, decision: 'approved', carried: true },
    { index: 1, decision: 'approved' },
  ]);

  const out = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(out.state, 'applied');
  assert.deepEqual(out.summary, ['a를 2로 바꿨다 (사람)', 'b를 3으로 바꿨다']);
  const { records } = await readRecords(t.repo.dir);
  assert.deepEqual(records.map((r) => [r.meta.title, r.meta.approval.id]).sort(), [
    ['a는 정수', second.id],
    ['b 결정', second.id],
  ]);
});

test('an incremental draft that changes a carried item is refused', async () => {
  const t = await approvedTask();
  await t.repo.write('src/b.mjs', "export const b = '3';\n");
  await recheckRound(t, (d) => {
    d.records[0].title = '몰래 고친 제목';
  });
  await rejectsWith(submitDraft({ home: t.home, taskId: t.taskId }), 'E_VERIFY');
});

test('after the records were written: stale, recheck, and the rejected record is taken back out', async () => {
  const t = await approvedTask();
  const first = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(first.files.length, 2);
  t.repo.git('add', '-A');
  t.repo.git('commit', '-q', '-m', 'work and records');

  await t.repo.write('src/b.mjs', "export const b = '3';\n");
  await rejectsWith(applyApproval({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await stateOf(t.home, t.taskId), 'stale');

  await recheckRound(t);
  await submitDraft({ home: t.home, taskId: t.taskId });
  const second = await approve(t.home, t.taskId, {
    summary: ['a를 2로 바꿨다 (사람)', 'b를 3으로 바꿨다'],
    items: [{ index: 1, decision: 'rejected' }],
  });

  const out = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(out.alreadyApplied, false);
  const bFile = first.files.find((/** @type {string} */ f) => !out.files.includes(f));
  assert.ok(bFile, 'the b decision is no longer written');
  const { records } = await readRecords(t.repo.dir);
  assert.deepEqual(records.map((r) => r.meta.title), ['a는 정수'], 'the rejected record is removed, not left behind');
  assert.equal(records[0].meta.approval.id, second.id);
  assert.equal(records[0].meta.revisions, undefined, 'an unmerged record is rewritten in place');
  const written = (await readEvents(t.paths.events)).filter((e) => e.type === 'records_written').at(-1);
  assert.deepEqual(written?.removed, [bFile]);
  assert.deepEqual(out.removed, [bFile]);

  // Running apply again changes nothing.
  const again = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(again.alreadyApplied, true);
});

test('after the PR: a change makes the task stale; the PR body is updated and completed with the same URL', async () => {
  const t = await approvedTask();
  await applyApproval({ home: t.home, taskId: t.taskId });
  const url = 'https://github.com/acme/widgets/pull/7';
  await completePr({ home: t.home, taskId: t.taskId, prUrl: url });

  await t.repo.write('src/a.mjs', 'export const a = 3;\n');
  await rejectsWith(applyApproval({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  assert.equal(await stateOf(t.home, t.taskId), 'stale');

  await recheckRound(t, (d) => {
    d.summary[0].text = 'a를 3으로 바꿨다';
  });
  await submitDraft({ home: t.home, taskId: t.taskId });
  await approve(t.home, t.taskId, { summary: ['a를 3으로 바꿨다', 'b를 2로 바꿨다'], items: [{ index: 0, decision: 'approved' }] });
  const out = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(out.previousPrUrl, url);
  assert.equal(out.prUrl, null);
  assert.equal((await completePr({ home: t.home, taskId: t.taskId, prUrl: url })).state, 'pr_created');
});

test('a change during review: the stale screen is refused and the next round is based on the same approval', async () => {
  const t = await approvedTask();
  await t.repo.write('src/b.mjs', "export const b = '3';\n");
  await recheckRound(t);
  await submitDraft({ home: t.home, taskId: t.taskId });

  await t.repo.write('src/b.mjs', "export const b = '4';\n");
  await rejectsWith(approve(t.home, t.taskId, { summary: ['x'], items: [{ index: 1, decision: 'approved' }] }), 'E_CONFLICT');

  const { input } = await recheckRound(t);
  assert.equal(input.recheck.basedOn, t.approval.id);
  assert.deepEqual(input.recheck.changes.map((/** @type {any} */ c) => c.path), ['src/b.mjs']);
});

test('after a rebase: unchanged task files are not rechecked; a changed one is a base update', async () => {
  const t = await approvedTask();
  t.repo.git('add', '-A');
  t.repo.git('commit', '-q', '-m', 'work');
  await t.upstream.write('other.txt', 'someone else\n');
  t.upstream.commitAll('other work');
  t.repo.git('fetch', '-q', 'origin');
  t.repo.git('rebase', '-q', 'origin/main');

  const quiet = /** @type {any} */ (await prepareHandoff({ cwd: t.repo.dir, home: t.home, specs: [SPEC] }));
  assert.equal(quiet.alreadyPrepared, true, 'the upstream file is not part of the task: nothing to recheck');
  assert.equal(quiet.recheck, null);

  await t.repo.write('src/a.mjs', 'export const a = 5;\n');
  const changed = await recheckRound(t);
  assert.equal(changed.input.recheck.mergeBaseChanged, true);
  assert.deepEqual(changed.input.recheck.changes.map((/** @type {any} */ c) => [c.path, c.reason]), [['src/a.mjs', 'base_updated']]);
});

test('apply after a rebase with the same content keeps the approval', async () => {
  const t = await approvedTask();
  t.repo.git('add', '-A');
  t.repo.git('commit', '-q', '-m', 'work');
  await t.upstream.write('other.txt', 'someone else\n');
  t.upstream.commitAll('other work');
  t.repo.git('fetch', '-q', 'origin');
  t.repo.git('rebase', '-q', 'origin/main');
  const out = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.equal(out.state, 'applied');
});

test('stale, then the change is undone: the round carries everything and a quick approval finishes it', async () => {
  const t = await approvedTask();
  const original = await readFile(path.join(t.repo.dir, 'src/b.mjs'), 'utf8');
  await t.repo.write('src/b.mjs', "export const b = '3';\n");
  await rejectsWith(applyApproval({ home: t.home, taskId: t.taskId }), 'E_CONFLICT');
  await t.repo.write('src/b.mjs', original);

  const { input } = await recheckRound(t);
  assert.deepEqual(input.recheck.changes, []);
  await submitDraft({ home: t.home, taskId: t.taskId });
  const second = await approve(t.home, t.taskId, { kind: 'quick', summary: ['a를 2로 바꿨다 (사람)', 'b를 2로 바꿨다'], items: [] });
  assert.ok(second.items.every((/** @type {any} */ i) => i.carried === true));
  assert.equal((/** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }))).state, 'applied');
});

test('a carried item reopened by the human takes the human decision (wrong impact classification)', async () => {
  const t = await approvedTask();
  await t.repo.write('src/b.mjs', "export const b = '3';\n");
  await recheckRound(t);
  await submitDraft({ home: t.home, taskId: t.taskId });
  await rejectsWith(approve(t.home, t.taskId, { summary: ['x'], items: [{ index: 1, decision: 'approved', reopen: true }] }), 'E_INPUT');
  const second = await approve(t.home, t.taskId, {
    summary: ['a를 2로 바꿨다 (사람)', 'b를 3으로 바꿨다'],
    items: [
      { index: 0, decision: 'rejected', reopen: true },
      { index: 1, decision: 'approved' },
    ],
  });
  assert.deepEqual(second.items, [
    { index: 0, decision: 'rejected' },
    { index: 1, decision: 'approved' },
  ]);
  await applyApproval({ home: t.home, taskId: t.taskId });
  const { records } = await readRecords(t.repo.dir);
  assert.deepEqual(records.map((r) => r.meta.title), ['b 결정']);
});
