// Per-test results read from test runner output, and the tests that changed between base and
// head (pivot plan 5.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changedTests, parseJestJson, parseNodeTap, parsePytest, parseTestOutput } from '../../skills/using-heirloom/lib/test-results.mjs';

const ROOTS = ['<repo>'];

// `node --test --test-reporter=tap` (Node 22): a top-level test, a suite with a failing and a
// skipped test.
const NODE_TAP = `TAP version 13
# Subtest: adds
ok 1 - adds
  ---
  duration_ms: 0.469959
  type: 'test'
  ...
# Subtest: cart
    # Subtest: total for 12
    not ok 1 - total for 12
      ---
      duration_ms: 0.598092
      type: 'test'
      location: '<repo>/test/a.test.mjs:5:3'
      failureType: 'testCodeFailure'
      error: '120 == 108'
      stack: |-
        TestContext.<anonymous> (file:///<repo>/test/a.test.mjs:5:37)
      ...
    # Subtest: skipped
    ok 2 - skipped # SKIP
      ---
      duration_ms: 0.067951
      type: 'test'
      ...
    1..2
not ok 2 - cart
  ---
  duration_ms: 1.574815
  type: 'suite'
  location: '<repo>/test/a.test.mjs:4:1'
  failureType: 'subtestsFailed'
  ...
1..2
# tests 3
# pass 1
# fail 1
`;

test('node tap: tests by nested name with status and relative location; suites are not tests', () => {
  assert.deepEqual(parseNodeTap(NODE_TAP, ROOTS), {
    adds: { status: 'pass', location: null },
    'cart > total for 12': { status: 'fail', location: 'test/a.test.mjs:5' },
    'cart > skipped': { status: 'skip', location: null },
  });
});

test('node tap: without a type line (older Node) a result after deeper ones is a suite; repeated names stay apart', () => {
  const text = [
    '# Subtest: /abs/a.test.mjs',
    '    # Subtest: same',
    '    ok 1 - same',
    '    # Subtest: same',
    '    not ok 2 - same',
    '    1..2',
    'not ok 1 - /abs/a.test.mjs',
    '1..1',
  ].join('\n');
  assert.deepEqual(parseNodeTap(text, ['/abs']), {
    '/abs/a.test.mjs > same': { status: 'pass', location: null },
    '/abs/a.test.mjs > same #2': { status: 'fail', location: null },
  });
});

test('node tap: output without results (spec reporter, crash) is not read', () => {
  assert.equal(parseNodeTap('▶ cart\n  ✔ adds (0.4ms)\n', ROOTS), null);
  assert.equal(parseNodeTap('', ROOTS), null);
});

const PYTEST = `============================= test session starts ==============================
collecting ... collected 5 items

tests/test_cart.py::test_total PASSED                                    [ 20%]
tests/test_cart.py::test_bulk FAILED                                     [ 40%]
tests/test_cart.py::test_skip SKIPPED (unconditional skip)               [ 60%]
tests/test_cart.py::test_param[1 2] PASSED                               [ 80%]
tests/test_cart.py::test_x XFAIL (reason)                                [100%]

=========================== short test summary info ============================
PASSED tests/test_cart.py::test_total
FAILED tests/test_cart.py::test_bulk - assert 120 == 108
==================== 1 failed, 3 passed, 1 skipped in 0.02s ====================
`;

test('pytest: verbose lines give every test with its file', () => {
  assert.deepEqual(parsePytest(PYTEST), {
    'tests/test_cart.py::test_total': { status: 'pass', location: 'tests/test_cart.py' },
    'tests/test_cart.py::test_bulk': { status: 'fail', location: 'tests/test_cart.py' },
    'tests/test_cart.py::test_skip': { status: 'skip', location: 'tests/test_cart.py' },
    'tests/test_cart.py::test_param[1 2]': { status: 'pass', location: 'tests/test_cart.py' },
    'tests/test_cart.py::test_x': { status: 'skip', location: 'tests/test_cart.py' },
  });
});

test('pytest: the short summary (-rA) is used without verbose lines; nothing readable is null', () => {
  assert.deepEqual(parsePytest('PASSED tests/t.py::a\nFAILED tests/t.py::b - boom\nSKIPPED [1] tests/t.py:3: why\n'), {
    'tests/t.py::a': { status: 'pass', location: 'tests/t.py' },
    'tests/t.py::b': { status: 'fail', location: 'tests/t.py' },
  });
  assert.equal(parsePytest('ERROR tests/t.py - ImportError\n'), null);
});

test('jest json: file and full name, line with --testLocationInResults, leading noise ignored', () => {
  const report = {
    testResults: [
      {
        name: '<repo>/src/cart.test.js',
        assertionResults: [
          { fullName: 'cart total for 12', status: 'failed', location: { line: 41, column: 3 } },
          { fullName: 'cart adds', status: 'passed' },
          { fullName: 'cart later', status: 'todo' },
        ],
      },
    ],
  };
  assert.deepEqual(parseJestJson(`Determining test suites...\n${JSON.stringify(report)}`, ROOTS), {
    'src/cart.test.js > cart total for 12': { status: 'fail', location: 'src/cart.test.js:41' },
    'src/cart.test.js > cart adds': { status: 'pass', location: 'src/cart.test.js' },
    'src/cart.test.js > cart later': { status: 'skip', location: 'src/cart.test.js' },
  });
  assert.equal(parseJestJson('not json {', ROOTS), null);
  assert.equal(parseJestJson('{"testResults": []}', ROOTS), null);
});

test('exit-code parser reads nothing', () => {
  assert.equal(parseTestOutput('exit-code', NODE_TAP, ROOTS), null);
  assert.notEqual(parseTestOutput('node-tap', NODE_TAP, ROOTS), null);
});

test('changedTests: status changes and tests present on one side only, sorted by name', () => {
  const base = { a: { status: /** @type {const} */ ('pass'), location: 'a.js:1' }, b: { status: /** @type {const} */ ('pass'), location: null }, gone: { status: /** @type {const} */ ('pass'), location: 'g.js:3' } };
  const head = { a: { status: /** @type {const} */ ('fail'), location: 'a.js:2' }, b: { status: /** @type {const} */ ('pass'), location: null }, new: { status: /** @type {const} */ ('pass'), location: null } };
  assert.deepEqual(changedTests(base, head), [
    { name: 'a', base: 'pass', head: 'fail', location: 'a.js:2' },
    { name: 'gone', base: 'pass', head: 'absent', location: 'g.js:3' },
    { name: 'new', base: 'absent', head: 'pass', location: null },
  ]);
});
