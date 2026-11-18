// Per-test results from a test runner's output, so a probe run can say which tests changed
// between base and head. Each parser returns null when the output has no test it can read;
// the caller then compares only the exit code.

/** @typedef {'pass' | 'fail' | 'skip'} TestStatus */
/** @typedef {{ status: TestStatus, location: string | null }} TestResult */
/** @typedef {Record<string, TestResult>} TestResults name → result */

/**
 * Make an absolute location relative to the worktree it ran in.
 * @param {string | null} location
 * @param {string[]} roots the worktree path and its real path
 */
function relativeLocation(location, roots) {
  if (!location) return null;
  for (const root of roots) {
    const prefix = root.endsWith('/') ? root : `${root}/`;
    if (location.startsWith(prefix)) return location.slice(prefix.length);
    if (location.startsWith(`file://${prefix}`)) return location.slice(`file://${prefix}`.length);
  }
  return location;
}

/**
 * Add a result, keeping names unique: a repeated name gets " #2", " #3"... in output order.
 * @param {TestResults} results
 * @param {string} name
 * @param {TestResult} result
 */
function add(results, name, result) {
  let key = name;
  for (let n = 2; key in results; n++) key = `${name} #${n}`;
  results[key] = result;
}

/**
 * `node --test --test-reporter=tap`. Nested subtests are named "suite > test"; suites (`type:
 * 'suite'`, or entries that have subtests) are not tests themselves.
 * @param {string} text
 * @param {string[]} roots
 * @returns {TestResults | null}
 */
export function parseNodeTap(text, roots) {
  const lines = text.split(/\r?\n/);
  /** @type {string[]} subtest names by nesting level */
  const stack = [];
  /** @type {{ name: string, level: number, status: TestStatus, location: string | null, type: string | null }[]} */
  const entries = [];
  /** @type {(typeof entries)[number] | null} */
  let current = null;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const level = Math.floor(indent / 4);
    const body = line.trim();
    const subtest = /^# Subtest: (.*)$/.exec(body);
    if (subtest && indent % 4 === 0) {
      stack.length = level;
      stack[level] = subtest[1];
      current = null;
      continue;
    }
    const result = /^(not ok|ok) \d+(?: - (.*?))?(?: # (SKIP|TODO)\b.*)?$/.exec(body);
    if (result && indent % 4 === 0) {
      const own = result[2] ?? stack[level] ?? '';
      const name = [...stack.slice(0, level), own].join(' > ');
      const status = result[3] ? 'skip' : result[1] === 'ok' ? 'pass' : 'fail';
      current = { name, level, status, location: null, type: null };
      entries.push(current);
      continue;
    }
    if (current) {
      const location = /^location: '(.*):(\d+):\d+'$/.exec(body);
      if (location) current.location = relativeLocation(`${location[1]}:${location[2]}`, roots);
      const type = /^type: '(\w+)'$/.exec(body);
      if (type) current.type = type[1];
    }
  }
  /** @type {TestResults} */
  const results = {};
  entries.forEach((e, i) => {
    if (e.type === 'suite') return;
    // Without a type (older Node), an entry is a suite when deeper results precede it.
    const prev = entries[i - 1];
    if (e.type === null && prev && prev.level > e.level) return;
    add(results, e.name, { status: e.status, location: e.location });
  });
  return Object.keys(results).length ? results : null;
}

const PYTEST_STATUS = /** @type {Record<string, TestStatus>} */ ({ PASSED: 'pass', XPASS: 'pass', FAILED: 'fail', ERROR: 'fail', SKIPPED: 'skip', XFAIL: 'skip' });

/**
 * `pytest -v` (or `-rA`): one line per test with its node id. The verbose lines win; the
 * short summary is used when there are none.
 * @param {string} text
 * @returns {TestResults | null}
 */
export function parsePytest(text) {
  /** @type {TestResults} */
  const verbose = {};
  /** @type {TestResults} */
  const summary = {};
  for (const line of text.split(/\r?\n/)) {
    const v = /^(\S+?::.+?) (PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)(?:\s|$)/.exec(line);
    if (v) {
      verbose[v[1]] = { status: PYTEST_STATUS[v[2]], location: v[1].split('::')[0] };
      continue;
    }
    const s = /^(PASSED|FAILED|ERROR|XFAIL|XPASS) (\S+?::\S+)/.exec(line);
    if (s) summary[s[2]] = { status: PYTEST_STATUS[s[1]], location: s[2].split('::')[0] };
  }
  const results = Object.keys(verbose).length ? verbose : summary;
  return Object.keys(results).length ? results : null;
}

const JEST_STATUS = /** @type {Record<string, TestStatus>} */ ({ passed: 'pass', failed: 'fail', pending: 'skip', skipped: 'skip', todo: 'skip', disabled: 'skip' });

/**
 * `jest --json` (add `--testLocationInResults` for line numbers). Names are "file > full name".
 * @param {string} text
 * @param {string[]} roots
 * @returns {TestResults | null}
 */
export function parseJestJson(text, roots) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let report;
  try {
    report = JSON.parse(text.slice(start));
  } catch {
    return null;
  }
  if (!Array.isArray(report?.testResults)) return null;
  /** @type {TestResults} */
  const results = {};
  for (const file of report.testResults) {
    const rel = relativeLocation(String(file.name ?? ''), roots) ?? '';
    for (const a of file.assertionResults ?? []) {
      const status = JEST_STATUS[a.status];
      if (!status) continue;
      const line = a.location?.line;
      add(results, `${rel} > ${a.fullName ?? a.title}`, { status, location: Number.isInteger(line) ? `${rel}:${line}` : rel || null });
    }
  }
  return Object.keys(results).length ? results : null;
}

/**
 * @param {'node-tap' | 'pytest' | 'jest-json' | 'exit-code'} parser
 * @param {string} text the run's stdout
 * @param {string[]} roots worktree path and real path, to make locations relative
 * @returns {TestResults | null}
 */
export function parseTestOutput(parser, text, roots) {
  if (parser === 'node-tap') return parseNodeTap(text, roots);
  if (parser === 'pytest') return parsePytest(text);
  if (parser === 'jest-json') return parseJestJson(text, roots);
  return null;
}

/**
 * Tests whose status differs between base and head; a test missing on one side is `absent`
 * there. Sorted by name.
 * @param {TestResults} base
 * @param {TestResults} head
 */
export function changedTests(base, head) {
  const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  return names
    .map((name) => ({
      name,
      base: base[name]?.status ?? 'absent',
      head: head[name]?.status ?? 'absent',
      location: head[name]?.location ?? base[name]?.location ?? null,
    }))
    .filter((t) => t.base !== t.head);
}
