// Prediction, reveal and judgment of a schema 2 draft (pivot plan 5.2, 5.4): nothing that
// shows a result reaches the screen before the predictions are saved, predictions are fixed
// once saved, the judgment is signed, and any revert or split sends the work back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CART_HEAD, OBSERVED, SPEC, judgedTask } from '../helpers/judge-fixture.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { approvalFiles, taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { judgmentSchema, validate } from '../../skills/using-heirloom/lib/schema.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';
import { verify } from '../../skills/using-heirloom/lib/sign.mjs';
import { waitForApproval } from '../../skills/using-heirloom/lib/wait-approval.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {number} port
 * @param {{ method?: string, path: string, token?: string, body?: unknown }} o
 * @returns {Promise<{ status: number, body: any, text: string }>}
 */
function request(port, { method = 'GET', path: p, token, body }) {
  return new Promise((resolve, reject) => {
    const headers = { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'x-heirloom-token': token ?? '', origin: `http://127.0.0.1:${port}` }) };
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: /** @type {number} */ (res.statusCode), body: text ? JSON.parse(text) : null, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/** @param {import('node:test').TestContext} t @param {string} home */
async function server(t, home) {
  const s = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => s.close());
  const get = (/** @type {string} */ taskId) => request(s.port, { path: `/api/tasks/${taskId}` });
  const post = (/** @type {string} */ taskId, /** @type {string} */ action, /** @type {unknown} */ body) => request(s.port, { method: 'POST', path: `/api/tasks/${taskId}/${action}`, token: s.token, body });
  return { s, get, post };
}

/** @param {any} task @param {Record<string, any>} [overrides] */
const judgeBody = (task, overrides = {}) => ({
  draftSha256: task.draftSha256,
  sourceHash: task.input.source.hash,
  items: [
    { id: 'q1', verdict: 'my-misunderstanding' },
    { id: 'q2', verdict: 'as-expected' },
    { id: 'q3', verdict: 'as-expected' },
    { id: 'q4', verdict: 'answered', answer: '100으로 한다. 도매 기준이다.' },
  ],
  behaviorDiffs: ['12개를 사면 결제액이 108에서 120으로 오른다'],
  ...overrides,
});

test('before the predictions are saved, the screen gets questions and commands but no observed value', async (t) => {
  const { home, taskId } = await judgedTask();
  const { get, post } = await server(t, home);
  const before = await get(taskId);
  assert.equal(before.status, 200);
  assert.equal(before.body.judge.revealed, false);
  assert.deepEqual(before.body.judge.questions.map((/** @type {any} */ q) => [q.id, q.predictFirst]), [['q1', true], ['q2', true], ['q3', false], ['q4', false]]);
  assert.match(before.body.judge.commands[0].run.join(' '), /qty: 12, unit: 10/, 'the person sees what will run');
  // Hashes, ids and times hold digits too; what is left must not show a result.
  const visible = before.text.replace(/[0-9a-f]{12,}/g, '#').replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '#').replace(/t-\d{8}-\w+/g, '#');
  for (const value of [OBSERVED.base, OBSERVED.head, 'behaviorDiffs', 'stdout', '다른 통화', 'changed']) {
    assert.ok(!visible.includes(value), `no ${value} before the reveal`);
  }
  assert.equal(before.body.draftInitial, null);

  const task = before.body;
  assert.equal((await post(taskId, 'judge', judgeBody(task))).status, 409, 'no judgment before the predictions');
  const missing = await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '108' } });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error.message, /q2: 답은/);
  assert.equal((await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '많이', q2: 'yes' } })).status, 400, 'a number question needs a number');
  assert.equal((await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '108', q2: 'yes', q3: 'x' } })).status, 400, 'only predicted questions');
  const saved = await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '108', q2: 'yes' } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal((await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '120', q2: 'yes' } })).status, 409, 'predictions are fixed');

  const after = (await get(taskId)).body;
  assert.equal(after.judge.revealed, true);
  assert.deepEqual(after.judge.predictions, { q1: '108', q2: 'yes' });
  assert.equal(after.judge.probes[0].head.stdout, `${OBSERVED.head}\n`);
  assert.equal(after.judge.observed.q1.correct, false);
  assert.deepEqual(after.judge.observed.q2.tests.map((/** @type {any} */ x) => [x.name, x.base, x.head]), [['bulk discount for 12', 'pass', 'fail']]);
  assert.equal(after.draft.behaviorDiffs.length, 1);
});

test('judgment: verdicts are checked, then signed; all accepted approves the task', async (t) => {
  const { repo, home, taskId, probeSetHash } = await judgedTask();
  const { get, post } = await server(t, home);
  let task = (await get(taskId)).body;
  await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '108', q2: 'yes' } });
  task = (await get(taskId)).body;

  /** @param {Record<string, any>} overrides */
  const refused = async (overrides) => (await post(taskId, 'judge', judgeBody(task, overrides))).body.error.message;
  const items = judgeBody(task).items;
  assert.match(await refused({ items: [{ id: 'q1', verdict: 'as-expected' }, ...items.slice(1)] }), /q1: 예측이 결과와 달라/);
  assert.match(await refused({ items: [{ id: 'q1', verdict: 'revert' }, ...items.slice(1)] }), /q1: 되돌리거나 분리할 때는 이유가 필요함/);
  assert.match(await refused({ items: [...items.slice(0, 3), { id: 'q4', verdict: 'answered' }] }), /q4: 열린 선택에 대한 답이 필요함/);
  assert.match(await refused({ items: [...items.slice(0, 3), { id: 'q4', verdict: 'as-expected' }] }), /q4: fork 질문의 판정은 answered, revert, split/);
  assert.match(await refused({ items: items.slice(0, 3) }), /q4: 판정이 없음/);
  assert.match(await refused({ behaviorDiffs: ['12개를 사면 결제액이 108에서 130으로 오른다'] }), /관측값.*고칠 수 없음/);
  assert.match(await refused({ behaviorDiffs: [] }), /개수가 같은/);
  assert.equal((await post(taskId, 'approve', { kind: 'full', draftSha256: task.draftSha256, sourceHash: task.input.source.hash, summary: ['x'], items: [] })).status, 409, 'item approval does not take a schema 2 draft');

  const ok = await post(taskId, 'judge', judgeBody(task));
  assert.equal(ok.status, 200, ok.text);
  const judgment = ok.body.judgment;
  assert.deepEqual(validate(judgmentSchema, judgment), []);
  assert.deepEqual(await verify(home, judgment), { ok: true });
  assert.equal(judgment.outcome, 'accepted');
  assert.equal(judgment.target.headSha, repo.git('rev-parse', 'HEAD'));
  assert.equal(judgment.target.probeSetHash, probeSetHash);
  assert.deepEqual(judgment.behaviorDiffs.final, ['12개를 사면 결제액이 108에서 120으로 오른다']);
  const q1 = judgment.items[0];
  assert.deepEqual([q1.answer, q1.correct, q1.verdict, q1.revealed.probes.p1.head], ['108', false, 'my-misunderstanding', '120\n']);
  assert.match(q1.probeHashes.p1.head, /^[0-9a-f]{64}$/);
  assert.equal(judgment.items[3].answer, '100으로 한다. 도매 기준이다.');
  assert.deepEqual(Object.keys(judgment.items[1].probeHashes), ['tests']);

  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'approved');
  const files = approvalFiles(taskPaths(home, taskId).approvals, judgment.id);
  assert.deepEqual(JSON.parse(await readFile(files.record, 'utf8')), judgment);
  assert.equal(JSON.parse(await readFile(path.join(taskPaths(home, taskId).approvals, `${judgment.id}.probes.json`), 'utf8')).probeSetHash, probeSetHash);
  assert.equal((await get(taskId)).body.latestApproval.id, judgment.id);
});

test('a revert returns the work: the waiting agent and the next session get the reasons; prepare carries them into the next round', async (t) => {
  const { repo, home, taskId } = await judgedTask();
  const { get, post } = await server(t, home);
  let task = (await get(taskId)).body;
  await post(taskId, 'predict', { draftSha256: task.draftSha256, answers: { q1: '108', q2: 'no' } });
  task = (await get(taskId)).body;
  /** @type {any[]} */
  const items = judgeBody(task).items;
  items[0] = { id: 'q1', verdict: 'revert', reason: '12개 구매에도 할인이 붙어야 한다' };
  const res = await post(taskId, 'judge', judgeBody(task, { items }));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.judgment.outcome, 'returned');

  const waited = await waitForApproval({ home, taskId, timeoutMs: 1000 });
  assert.deepEqual(waited, { taskId, state: 'returned', approvalId: res.body.judgment.id, timedOut: false, returned: [{ id: 'q1', verdict: 'revert', reason: '12개 구매에도 할인이 붙어야 한다' }] });
  assert.match(await buildSessionContext({ cwd: repo.dir, home, pluginRoot: ROOT }), new RegExp(`${taskId}: 사람이 판정에서 되돌림\\(q1 되돌림: 12개 구매에도 할인이 붙어야 한다\\)`));
  assert.equal((await get(taskId)).body.latestApproval.outcome, 'returned');

  const same = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] }));
  assert.equal(same.alreadyPrepared, true, 'nothing changed since the return');
  assert.equal(same.state, 'returned');
  assert.equal(same.previousJudgment.returned[0].reason, '12개 구매에도 할인이 붙어야 한다');

  await repo.write('src/cart.mjs', CART_HEAD.replace('qty >= 100', 'qty >= 10'));
  const next = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] }));
  assert.equal(next.state, 'prepared');
  assert.equal(next.taskId, taskId);
  assert.deepEqual(next.previousJudgment.returned.map((/** @type {any} */ i) => [i.id, i.verdict, i.answer]), [['q1', 'revert', '108']]);
});
