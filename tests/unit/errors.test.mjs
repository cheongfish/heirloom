import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HeirloomError, classifyError, withRetry, toFailure, EXIT } from '../../skills/using-heirloom/lib/errors.mjs';

test('HeirloomError maps codes to exit codes and retryability', () => {
  assert.equal(new HeirloomError('E_INPUT', 'x').exitCode, EXIT.INPUT);
  assert.equal(new HeirloomError('E_CONFLICT', 'x').exitCode, 3);
  assert.equal(new HeirloomError('E_VERIFY', 'x').exitCode, 4);
  assert.equal(new HeirloomError('E_TRANSIENT', 'x').exitCode, 75);
  assert.equal(new HeirloomError('E_INTERNAL', 'x').exitCode, 1);
  assert.equal(new HeirloomError('E_TRANSIENT', 'x').retryable, true);
  assert.equal(new HeirloomError('E_INPUT', 'x').retryable, false);
});

test('classifyError: network errno and git lock contention are transient', () => {
  for (const code of ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
    const err = Object.assign(new Error('boom'), { code });
    assert.equal(classifyError(err).code, 'E_TRANSIENT', code);
  }
  const lock = new Error("fatal: Unable to create '/r/.git/index.lock': File exists.");
  assert.equal(classifyError(lock).code, 'E_TRANSIENT');
  assert.equal(classifyError(new Error('HTTP 502: Bad Gateway')).code, 'E_TRANSIENT');
  assert.equal(classifyError(new Error('API rate limit exceeded')).code, 'E_TRANSIENT');
});

test('classifyError: other errors are internal, HeirloomError passes through', () => {
  assert.equal(classifyError(new Error('unexpected')).code, 'E_INTERNAL');
  assert.equal(classifyError('a string').code, 'E_INTERNAL');
  const original = new HeirloomError('E_INPUT', 'bad');
  assert.equal(classifyError(original), original);
});

test('withRetry: retries a transient failure exactly once', async () => {
  let calls = 0;
  /** @type {number[]} */
  const sleeps = [];
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return 'ok';
    },
    { delayMs: 2000, sleep: async (ms) => void sleeps.push(ms) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('withRetry: gives up after the second transient failure', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      },
      { sleep: async () => {} },
    ),
    (err) => err instanceof HeirloomError && err.code === 'E_TRANSIENT',
  );
  assert.equal(calls, 2);
});

test('withRetry: does not retry non-transient failures', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw new HeirloomError('E_INPUT', 'bad input');
      },
      { sleep: async () => {} },
    ),
    /bad input/,
  );
  assert.equal(calls, 1);
});

test('toFailure: builds the stdout payload and exit code', () => {
  const { payload, exitCode } = toFailure(new HeirloomError('E_CONFLICT', 'stale', { hint: 'run prepare again' }));
  assert.equal(exitCode, 3);
  assert.deepEqual(payload, {
    ok: false,
    error: { code: 'E_CONFLICT', message: 'stale', retryable: false, hint: 'run prepare again' },
  });
});
