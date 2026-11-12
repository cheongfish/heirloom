import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { nextState, deriveState, appendEvent, readEvents, countAttempts } from '../../skills/using-heirloom/lib/events.mjs';

/** @param {string} type @param {Record<string, unknown>} [extra] */
const ev = (type, extra = {}) => /** @type {any} */ ({ at: '2026-11-12T00:00:00Z', type, ...extra });

const HAPPY = [
  ev('prepared', { sourceHash: 'sha256:1', attempt: 1 }),
  ev('draft_checked', { ok: false, errors: 2 }),
  ev('draft_checked', { ok: true }),
  ev('awaiting_approval'),
  ev('dashboard_opened'),
  ev('approved', { approvalId: 'ap-1' }),
  ev('approval_received', { approvalId: 'ap-1' }),
  ev('records_written', { approvalId: 'ap-1' }),
  ev('approval_received', { approvalId: 'ap-1' }),
  ev('pr_created', { approvalId: 'ap-1', url: 'u' }),
];

test('happy path follows MVP-PLAN 5.6', () => {
  const states = [];
  /** @type {any} */
  let state = null;
  for (const e of HAPPY) {
    state = nextState(state, e);
    states.push(state);
  }
  assert.deepEqual(states, [
    'prepared',
    'prepared',
    'drafted',
    'awaiting_approval',
    'awaiting_approval',
    'approved',
    'approved',
    'applied',
    'applied',
    'pr_created',
  ]);
  assert.equal(deriveState(HAPPY), 'pr_created');
});

test('human approval, agent receipt and PR completion are separate states', () => {
  const upToApproved = HAPPY.slice(0, 6);
  assert.equal(deriveState(upToApproved), 'approved');
  assert.equal(deriveState([...upToApproved, ev('approval_received')]), 'approved', 'receipt is not application');
  assert.throws(() => deriveState([...upToApproved, ev('pr_created')]), /pr_created/);
});

test('invalid transitions are rejected', () => {
  assert.throws(() => nextState(null, ev('approved')), (err) => /** @type {any} */ (err).code === 'E_CONFLICT');
  assert.throws(() => nextState('prepared', ev('approved')));
  assert.throws(() => nextState('prepared', ev('awaiting_approval')), 'needs a passing draft check first');
  assert.throws(() => nextState('awaiting_approval', ev('records_written')));
  assert.throws(() => nextState(null, ev('dashboard_opened')));
});

test('terminal states accept nothing', () => {
  for (const terminal of ['discarded', 'expired']) {
    for (const type of ['prepared', 'discarded', 'expired', 'dashboard_opened']) {
      assert.throws(() => nextState(/** @type {any} */ (terminal), ev(type)), `${terminal} -> ${type}`);
    }
  }
});

test('re-preparing a new state is allowed from any live state, including after PR and stale', () => {
  for (const from of ['prepared', 'drafted', 'awaiting_approval', 'approved', 'applied', 'pr_created', 'failed', 'stale']) {
    assert.equal(nextState(/** @type {any} */ (from), ev('prepared', { sourceHash: 'sha256:2' })), 'prepared', from);
  }
});

test('failure, staleness, discard and expiry', () => {
  assert.equal(nextState('prepared', ev('failed', { retryable: true })), 'failed');
  assert.equal(nextState('approved', ev('stale')), 'stale');
  assert.equal(nextState('applied', ev('stale')), 'stale');
  assert.equal(nextState('pr_created', ev('stale')), 'stale', 'a change after the PR is rechecked too (PHASE3-PLAN 5.5)');
  assert.throws(() => nextState('awaiting_approval', ev('stale')));
  assert.equal(nextState('awaiting_approval', ev('discarded', { reason: 'user' })), 'discarded');
  assert.equal(nextState('pr_created', ev('expired', { reason: 'pr_closed' })), 'expired');
});

test('appendEvent validates against the log and stamps time', async (t) => {
  const dir = await tempDir('events');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'events.jsonl');

  assert.equal(await appendEvent(file, { type: 'prepared', sourceHash: 'sha256:1', attempt: 1 }), 'prepared');
  await assert.rejects(appendEvent(file, { type: 'approved' }), (err) => /** @type {any} */ (err).code === 'E_CONFLICT');
  assert.equal(await appendEvent(file, { type: 'draft_checked', ok: true }), 'drafted');

  const events = await readEvents(file);
  assert.equal(events.length, 2, 'rejected event was not written');
  assert.match(events[0].at, /^\d{4}-\d\d-\d\dT/);
  await assert.rejects(appendEvent(file, /** @type {any} */ ({ type: 'bogus' })), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('appendEvent is safe under concurrency', async (t) => {
  const dir = await tempDir('events');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'events.jsonl');
  await appendEvent(file, { type: 'prepared', sourceHash: 'sha256:1', attempt: 1 });
  await Promise.all(Array.from({ length: 10 }, () => appendEvent(file, { type: 'draft_checked', ok: false })));
  assert.equal((await readEvents(file)).length, 11);
});

test('countAttempts counts prepare runs per source state', () => {
  const events = [
    ev('prepared', { sourceHash: 'sha256:1', attempt: 1 }),
    ev('failed', { retryable: true }),
    ev('prepared', { sourceHash: 'sha256:1', attempt: 2 }),
    ev('prepared', { sourceHash: 'sha256:2', attempt: 1 }),
  ];
  assert.equal(countAttempts(events, 'sha256:1'), 2);
  assert.equal(countAttempts(events, 'sha256:2'), 1);
  assert.equal(countAttempts(events, 'sha256:3'), 0);
});
