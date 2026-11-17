// Probe runs (pivot plan 5.1): Heirloom runs the agent's probe commands and the test command
// on base (the frozen merge-base) and head (the handed-off source state) in temporary
// worktrees, records outputs with hashes, and leaves the user's worktree alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloneRepo, makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { submittedTask } from '../helpers/handoff-fixture.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { computeSourceState } from '../../skills/using-heirloom/lib/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'probe.mjs');
const SPEC = 'docs/specs/cart.md';

const CART_BASE = `export function total({ qty, unit }) {
  const sum = qty * unit;
  return qty >= 10 ? sum * 0.9 : sum;
}
`;
const CART_HEAD = `export function total({ qty, unit }) {
  const sum = qty * unit;
  return qty >= 100 ? sum * 0.9 : sum;
}
`;
const CART_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('bulk discount for 12', () => {
  assert.equal(total({ qty: 12, unit: 10 }), 108);
});

test('no discount for 1', () => {
  assert.equal(total({ qty: 1, unit: 10 }), 10);
});
`;

/**
 * A node project on branch feat: the discount threshold moves from 10 to 100 (uncommitted),
 * a committed new module, an untracked new file and a deleted file.
 */
async function nodeTask() {
  const upstream = await makeRepo({
    'package.json': '{ "type": "module" }\n',
    'src/cart.mjs': CART_BASE,
    'src/old.mjs': 'export const old = true;\n',
    'test/cart.test.mjs': CART_TEST,
  });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/label.mjs', "export const label = 'v2';\n");
  repo.commitAll('label');
  await repo.write(SPEC, '# cart\n\n할인 경계를 100개로 바꾼다.\n');
  await repo.write('src/cart.mjs', CART_HEAD);
  await repo.write('src/notes.txt', 'untracked\n');
  await repo.remove('src/old.mjs');
  const home = await tempDir('home');
  const prepared = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  return { repo, home, taskId: prepared.taskId, sourceHash: prepared.source.hash };
}

const total12 = ['node', '-e', "import('./src/cart.mjs').then((m) => console.log(m.total({ qty: 12, unit: 10 })))"];

/** @param {string} dir */
const worktreeCount = (dir) => spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter((l) => l.startsWith('worktree ')).length;

test('node project: probes and tests run on base and head; outputs, changed tests and hashes are recorded', async () => {
  const { repo, home, taskId, sourceHash } = await nodeTask();
  const spec = {
    probes: [
      { id: 'p1', title: '12개 구매 결제액', run: total12 },
      { id: 'p2', title: '새 라벨', run: ['node', '-e', "import('./src/label.mjs').then((m) => console.log(m.label))"] },
      { id: 'p3', title: '지운 모듈과 추적하지 않은 파일', run: ['node', '-e', "const fs = require('fs'); console.log(fs.existsSync('src/old.mjs'), fs.existsSync('src/notes.txt'), process.cwd() === require('path').resolve('.'))"] },
      { id: 'p4', title: '작업 경로', run: ['node', '-e', 'console.log(process.cwd())'] },
    ],
    tests: { command: ['node', '--test', '--test-reporter=tap'], parser: 'node-tap' },
  };
  const out = /** @type {any} */ (await runProbes({ home, taskId, spec }));

  const [p1, p2, p3, p4] = out.probes;
  assert.equal(p1.base.stdout, '108\n');
  assert.equal(p1.head.stdout, '120\n');
  assert.equal(p1.sameOutput, false);
  assert.equal(p2.base.ok, false, 'the new module is missing on base');
  assert.match(p2.base.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/);
  assert.equal(p2.head.stdout, 'v2\n', 'committed changes are on head');
  assert.equal(p3.base.stdout, 'true false true\n');
  assert.equal(p3.head.stdout, 'false true true\n', 'deleted and untracked files follow the source state');
  assert.equal(p4.base.stdout, '<repo>\n', 'the worktree path is replaced');
  assert.equal(p4.sameOutput, true);

  assert.equal(out.tests.comparison, 'tests');
  assert.deepEqual(out.tests.base.counts, { pass: 2, fail: 0, skip: 0 });
  assert.deepEqual(out.tests.head.counts, { pass: 1, fail: 1, skip: 0 });
  assert.deepEqual(out.tests.changed, [{ name: 'bulk discount for 12', base: 'pass', head: 'fail', location: 'test/cart.test.mjs:5' }]);
  assert.doesNotMatch(out.warnings.join('\n'), /탐침 p2/, 'failing on base only is expected for new code');
  assert.match(out.probeSetHash, /^sha256:[0-9a-f]{64}$/);

  const dir = taskPaths(home, taskId).probes;
  assert.deepEqual((await readdir(dir)).sort(), ['result.json', 'spec.json', 'tests-base.log', 'tests-head.log']);
  const result = JSON.parse(await readFile(path.join(dir, 'result.json'), 'utf8'));
  assert.equal(result.probeSetHash, out.probeSetHash);
  assert.equal(result.inputSourceHash, sourceHash);
  assert.match(result.probes[0].head.sha256, /^[0-9a-f]{64}$/);
  assert.notEqual(result.probes[0].base.sha256, result.probes[0].head.sha256);
  assert.equal(typeof result.probes[0].head.durationMs, 'number');
  assert.match(await readFile(path.join(dir, 'tests-head.log'), 'utf8'), /not ok \d+ - bulk discount for 12/);

  // The user's worktree is untouched and the temporary worktrees are gone.
  const after = await computeSourceState({ root: repo.dir, mergeBase: repo.git('merge-base', 'origin/main', 'HEAD') });
  assert.equal(after.hash, sourceHash);
  assert.equal(worktreeCount(repo.dir), 1);

  // The same probes on the same source give the same hash (durations are not part of it).
  const again = /** @type {any} */ (await runProbes({ home, taskId, spec }));
  assert.equal(again.probeSetHash, out.probeSetHash);
});

test('setup runs once per worktree before the probes; the probes file setup replaces the project setting', async () => {
  const { repo, home, taskId } = await nodeTask();
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, probe: { setup: [['node', '-e', "require('fs').appendFileSync('gen.txt', 'config\\n')"]] } }));
  const read = { id: 'p1', title: '준비 결과', run: ['node', '-e', "process.stdout.write(require('fs').readFileSync('gen.txt', 'utf8'))"] };
  const fromConfig = /** @type {any} */ (await runProbes({ home, taskId, spec: { probes: [read] } }));
  assert.equal(fromConfig.probes[0].base.stdout, 'config\n');
  assert.equal(fromConfig.probes[0].head.stdout, 'config\n');

  const own = /** @type {any} */ (await runProbes({ home, taskId, spec: { setup: [['node', '-e', "require('fs').writeFileSync('gen.txt', 'own\\n')"], ['node', '-e', 'process.exit(3)'], ['node', '-e', "require('fs').writeFileSync('gen.txt', 'never\\n')"]], probes: [read] } }));
  assert.equal(own.probes[0].head.stdout, 'own\n', 'setup stops at the first failure');
  assert.equal(own.setup.failed, true);
  assert.match(own.warnings.join('\n'), /base 준비 명령 실패: node -e process\.exit\(3\) \(종료 코드 3\)/);
});

test('timeouts, missing commands and unchanged outputs are reported, not thrown', async () => {
  const { home, taskId } = await nodeTask();
  const out = /** @type {any} */ (
    await runProbes({
      home,
      taskId,
      spec: {
        probes: [
          { id: 'slow', title: '멈춤', run: ['node', '-e', 'setTimeout(() => {}, 60000)'], timeoutSeconds: 1 },
          { id: 'missing', title: '없는 명령', run: ['heirloom-no-such-command'] },
        ],
      },
    })
  );
  assert.equal(out.probes[0].head.timedOut, true);
  assert.equal(out.probes[0].head.exitCode, null);
  assert.equal(out.probes[1].head.error, 'command_not_found');
  const warnings = out.warnings.join('\n');
  assert.match(warnings, /탐침 slow: head에서 실패함\(시간 초과\)/);
  assert.match(warnings, /탐침 missing: 실행 파일을 찾지 못함/);
  assert.match(warnings, /모든 탐침의 출력이 base와 head에서 같음/);
});

test('refused: bad probes files, too many probes, a changed source, a task past drafting', async () => {
  const { repo, home, taskId } = await nodeTask();
  /** @param {unknown} spec */
  const code = async (spec) => runProbes({ home, taskId, spec }).then(() => 'ok', (err) => `${err.code}: ${err.message}`);
  assert.match(await code({ probes: [] }), /^E_INPUT: .*탐침도 tests도 없음/);
  assert.match(await code({ probes: [{ id: 'p1', title: 't', run: 'node -e 1' }] }), /^E_INPUT: .*run: 배열이어야 함/s);
  assert.match(await code({ probes: [{ id: 'P 1', title: 't', run: ['true'] }] }), /^E_INPUT: .*id: 형식이 맞지 않음/s);
  assert.match(await code({ probes: [{ id: 'p1', title: 't', run: ['true'] }, { id: 'p1', title: 't', run: ['true'] }] }), /^E_INPUT: .*중복됨 \(p1\)/);
  assert.match(await code({ probes: [{ id: 'p1', title: 't', run: ['true'] }], tests: { command: ['npm', 'test'], parser: 'mocha' } }), /^E_INPUT: .*parser/s);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, title: 't', run: ['true'] }));
  assert.match(await code({ probes: eleven }), /^E_INPUT: .*상한 10개/);

  await repo.write('src/cart.mjs', `${CART_HEAD}// more\n`);
  assert.match(await code({ probes: [{ id: 'p1', title: 't', run: ['true'] }] }), /^E_CONFLICT: 인계 준비 이후 소스가 바뀜/);

  const submitted = await submittedTask();
  const late = await runProbes({ home: submitted.home, taskId: submitted.taskId, spec: { probes: [{ id: 'p1', title: 't', run: ['true'] }] } }).then(
    () => 'ok',
    (err) => `${err.code}: ${err.message}`,
  );
  assert.match(late, /^E_CONFLICT: 현재 상태\(awaiting_approval\)에서는/);
});

test('script: prints one JSON object; the probes file path is relative to the working directory', async () => {
  const { repo, home, taskId } = await nodeTask();
  const dir = await tempDir('probes');
  await writeFile(path.join(dir, 'probes.json'), JSON.stringify({ probes: [{ id: 'p1', title: '12개 구매 결제액', run: total12 }] }));
  const run = (/** @type {string[]} */ args, /** @type {string} */ cwd) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HEIRLOOM_HOME: home } });
  const ok = run(['--task', taskId, '--file', 'probes.json'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  const data = JSON.parse(ok.stdout).data;
  assert.equal(data.probes[0].head.stdout, '120\n');
  const missing = run(['--task', taskId, '--file', 'nope.json'], repo.dir);
  assert.equal(missing.status, 2);
  assert.match(JSON.parse(missing.stdout).error.message, /탐침 파일을 읽지 못함/);
});

// ---------------------------------------------------------------- pytest

/** A Python with pytest: HEIRLOOM_TEST_PYTHON, else python3 when it has pytest. */
function pythonWithPytest() {
  for (const python of [process.env.HEIRLOOM_TEST_PYTHON, 'python3'].filter(Boolean)) {
    const r = spawnSync(/** @type {string} */ (python), ['-m', 'pytest', '--version'], { encoding: 'utf8' });
    if (r.status === 0) return /** @type {string} */ (python);
  }
  return null;
}
const python = pythonWithPytest();

test('python project: pytest results compared per test', { skip: python ? false : 'pytest가 없음 (HEIRLOOM_TEST_PYTHON으로 지정)' }, async () => {
  const upstream = await makeRepo({
    'cart.py': 'def total(qty, unit):\n    s = qty * unit\n    return s * 0.9 if qty >= 10 else s\n',
    'tests/test_cart.py': 'from cart import total\n\ndef test_bulk():\n    assert total(12, 10) == 108\n\ndef test_single():\n    assert total(1, 10) == 10\n',
    'tests/conftest.py': 'import sys, os\nsys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))\n',
  });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write(SPEC, '# cart\n');
  await repo.write('cart.py', 'def total(qty, unit):\n    s = qty * unit\n    return s * 0.9 if qty >= 100 else s\n');
  await repo.write('tests/test_new.py', 'def test_new():\n    assert True\n');
  const home = await tempDir('home');
  const { taskId } = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const py = /** @type {string} */ (python);
  const out = /** @type {any} */ (
    await runProbes({
      home,
      taskId,
      spec: {
        probes: [{ id: 'p1', title: '12개 구매 결제액', run: [py, '-c', 'from cart import total; print(total(12, 10))'] }],
        tests: { command: [py, '-m', 'pytest', '-v', '-p', 'no:cacheprovider'], parser: 'pytest' },
      },
    })
  );
  assert.equal(out.probes[0].base.stdout, '108.0\n');
  assert.equal(out.probes[0].head.stdout, '120\n');
  assert.equal(out.tests.comparison, 'tests');
  assert.deepEqual(out.tests.changed, [
    { name: 'tests/test_cart.py::test_bulk', base: 'pass', head: 'fail', location: 'tests/test_cart.py' },
    { name: 'tests/test_new.py::test_new', base: 'absent', head: 'pass', location: 'tests/test_new.py' },
  ]);
  assert.equal(worktreeCount(repo.dir), 1);
});
