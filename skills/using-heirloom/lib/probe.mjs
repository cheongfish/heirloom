// Probe runs. The agent proposes commands that show what this change does;
// Heirloom runs them itself on the frozen base (merge-base) and on head (the handed-off source
// state, uncommitted changes included), each in a temporary worktree. Observed values in a
// draft then come from a recorded run, not from the agent's word.
//
// Commands run without a shell, with the worktree as working directory and the user's
// permissions. The network is not limited. The person allows the commands before they run
// (probe-permit.mjs), and they are recorded with their outputs.

import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson, sha256Hex } from './canonical.mjs';
import { loadProjectConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { deriveState, readEvents } from './events.mjs';
import { readJson, writeFileAtomic, writeJsonAtomic } from './fsx.mjs';
import { git, tryGit } from './git.mjs';
import { ensureDir, taskPaths } from './paths.mjs';
import { assertValid, probeSpecSchema } from './schema.mjs';
import { currentSourceState, hashEntry } from './state.mjs';
import { withTaskLock } from './task-lock.mjs';
import { changedTests, parseTestOutput } from './test-results.mjs';

/** Bytes kept per output stream of a probe or setup command. */
const STREAM_LIMIT = 256 * 1024;
/** Bytes kept of a test command's output (the parser reads it whole). */
const TEST_STREAM_LIMIT = 16 * 1024 * 1024;
/** Characters of each stream shown in the script result; the full run is in the result file. */
const PREVIEW = 2000;
/** Changed tests listed in the script result. */
const CHANGED_SHOWN = 100;
/** Default time limit of one probe. */
const PROBE_TIMEOUT_SECONDS = 30;
/** Stands for the worktree path in recorded output, so base, head and reruns compare equal. */
export const ROOT_TOKEN = '<repo>';

/**
 * @typedef {object} CommandRun
 * @property {number | null} exitCode null when the command did not start or was killed
 * @property {string | null} signal
 * @property {boolean} timedOut
 * @property {string | null} error `command_not_found`, or why the command could not start
 * @property {number} durationMs
 * @property {string} stdout
 * @property {string} stderr
 * @property {boolean} truncated part of stdout or stderr was cut at the size limit
 */

/** @param {number} limit */
function collector(limit) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  let truncated = false;
  return {
    /** @param {Buffer} chunk */
    push(chunk) {
      if (size >= limit) {
        truncated = true;
        return;
      }
      const room = limit - size;
      if (chunk.length > room) truncated = true;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      chunks.push(kept);
      size += kept.length;
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    get truncated() {
      return truncated;
    },
  };
}

/**
 * Run one command without a shell. Never throws: a command that cannot start is reported in
 * `error`. On timeout the whole process group is killed.
 * @param {string[]} argv
 * @param {{ cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv, limit?: number }} options
 * @returns {Promise<CommandRun>}
 */
export function runCommand(argv, { cwd, timeoutMs, env = process.env, limit = STREAM_LIMIT }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const out = collector(limit);
    const err = collector(limit);
    let timedOut = false;
    /** @type {string | null} */
    let error = null;
    let settled = false;
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', (e) => {
      error = /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'command_not_found' : e.message;
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A command left running in the background holds no pipe after this; stop it anyway.
      if (!error) kill();
      resolve({
        exitCode: error ? null : code,
        signal: error ? null : signal,
        timedOut,
        error,
        durationMs: Math.round(performance.now() - started),
        stdout: out.text(),
        stderr: err.text(),
        truncated: out.truncated || err.truncated,
      });
    });
  });
}

/**
 * Replace the worktree path in output with a fixed token.
 * @param {string} text
 * @param {string[]} roots
 */
function normalize(text, roots) {
  let out = text;
  for (const root of roots) out = out.split(root).join(ROOT_TOKEN);
  return out;
}

/**
 * The part of a run that is compared and hashed: the outcome and the output, not the time.
 * @param {CommandRun} run
 */
const runDigest = (run) => sha256Hex(canonicalJson({ exitCode: run.exitCode, signal: run.signal, timedOut: run.timedOut, error: run.error, stdout: run.stdout, stderr: run.stderr }));

/** Environment of every probe command. */
function probeEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  // A probe started from inside `node --test` must not report to that runner.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/**
 * @param {string} root repository the worktree belongs to
 * @param {string} dir
 * @param {string} commit
 */
async function addWorktree(root, dir, commit) {
  await git(['worktree', 'add', '--detach', '--quiet', dir, commit], { cwd: root, timeoutMs: 300_000 });
}

/** @param {string} root @param {string} dir */
async function removeWorktree(root, dir) {
  await tryGit(['worktree', 'remove', '--force', dir], { cwd: root });
  await rm(dir, { recursive: true, force: true });
}

/**
 * Turn a worktree checked out at the merge-base into the handed-off source state: copy every
 * changed file from the user's worktree and delete the deleted ones, then check each copy
 * against the frozen hash.
 * @param {{ root: string, dir: string, files: { path: string, status: 'A' | 'M' | 'D', sha256: string }[] }} options
 * @returns {Promise<string[]>} warnings
 */
async function overlaySource({ root, dir, files }) {
  /** @type {string[]} */
  const warnings = [];
  const changed = () =>
    new HeirloomError('E_CONFLICT', '탐침 준비 중에 소스가 바뀜', { hint: '파일을 고치는 중이라면 끝낸 뒤 prepare를 다시 실행하고 탐침을 다시 돌린다.' });
  for (const f of files) {
    const dst = path.join(dir, f.path);
    await rm(dst, { recursive: true, force: true });
    if (f.status === 'D') continue;
    const src = path.join(root, f.path);
    let info;
    try {
      info = await lstat(src);
    } catch {
      throw changed();
    }
    await mkdir(path.dirname(dst), { recursive: true });
    if (info.isDirectory()) {
      warnings.push(`${f.path}: 디렉터리(서브모듈)는 head worktree에 옮기지 않음`);
      continue;
    }
    if (info.isSymbolicLink()) await symlink(await readlink(src), dst);
    else {
      await copyFile(src, dst);
      await chmod(dst, info.mode & 0o777);
    }
    if ((await hashEntry(dst)) !== f.sha256) throw changed();
  }
  return warnings;
}

/**
 * Check the probes file against the schema and the project limits.
 * @param {unknown} spec
 * @param {{ maxProbes: number }} limits
 * @param {string} label
 * @returns {ProbeSpec}
 */
export function checkProbeSpec(spec, { maxProbes }, label) {
  assertValid(probeSpecSchema, spec, label);
  const s = /** @type {ProbeSpec} */ (spec);
  const ids = s.probes.map((p) => p.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new HeirloomError('E_INPUT', `${label}: 탐침 id가 중복됨 (${dup})`);
  if (s.probes.length > maxProbes) {
    throw new HeirloomError('E_INPUT', `${label}: 탐침이 ${s.probes.length}개로 상한 ${maxProbes}개를 넘음`, {
      hint: '이번 변경의 동작 차이를 가장 잘 드러내는 탐침만 남긴다. 상한은 프로젝트 설정 probe.maxProbes다.',
    });
  }
  if (!s.probes.length && !s.tests) throw new HeirloomError('E_INPUT', `${label}: 탐침도 tests도 없음`);
  return s;
}

/**
 * @typedef {object} ProbeSpec
 * @property {{ id: string, title: string, run: string[], timeoutSeconds?: number }[]} probes
 * @property {string[][]} [setup]
 * @property {{ command: string[], parser: 'node-tap' | 'pytest' | 'jest-json' | 'exit-code', timeoutSeconds?: number }} [tests]
 */

/** @typedef {CommandRun & { sha256: string }} RecordedRun */

/**
 * @typedef {object} TestSide
 * @property {number | null} exitCode
 * @property {string | null} signal
 * @property {boolean} timedOut
 * @property {string | null} error
 * @property {number} durationMs
 * @property {boolean} truncated
 * @property {boolean} parsed per-test results could be read
 * @property {{ pass: number, fail: number, skip: number }} counts
 * @property {import('./test-results.mjs').TestResults} results
 * @property {string} log file with the run's stdout and stderr, relative to the probes directory
 */

/**
 * @param {string[][]} commands
 * @param {{ cwd: string, timeoutMs: number, roots: string[] }} options
 */
async function runSetup(commands, { cwd, timeoutMs, roots }) {
  const runs = [];
  for (const run of commands) {
    const r = await runCommand(run, { cwd, timeoutMs, env: probeEnv() });
    runs.push({ run, exitCode: r.exitCode, timedOut: r.timedOut, error: r.error, durationMs: r.durationMs, stderr: normalize(r.stderr, roots).slice(-PREVIEW) });
    if (r.exitCode !== 0) break;
  }
  return runs;
}

/** @param {CommandRun} r @param {string[]} roots @returns {RecordedRun} */
function record(r, roots) {
  const run = { ...r, stdout: normalize(r.stdout, roots), stderr: normalize(r.stderr, roots) };
  return { ...run, sha256: runDigest(run) };
}

/** @param {RecordedRun} r */
const preview = (r) => ({
  ok: r.exitCode === 0 && !r.timedOut,
  exitCode: r.exitCode,
  timedOut: r.timedOut,
  error: r.error,
  stdout: r.stdout.length > PREVIEW ? `${r.stdout.slice(0, PREVIEW)}…` : r.stdout,
  stderr: r.stderr.length > PREVIEW ? `${r.stderr.slice(0, PREVIEW)}…` : r.stderr,
  truncated: r.truncated || r.stdout.length > PREVIEW || r.stderr.length > PREVIEW,
});

/**
 * Run the probes of a prepared handoff on base and head and record the result in the task's
 * `probes/` directory, replacing an earlier run. `probe.mjs` reaches this only through the
 * person's allowance (probe-permit.mjs); `permit` records which one.
 * @param {{ home: string, taskId: string, spec: unknown, specLabel?: string, permit?: { permitId: string | null }, now?: Date }} options
 */
export async function runProbes({ home, taskId, spec: rawSpec, specLabel = 'probes', permit, now = new Date() }) {
  const paths = taskPaths(home, taskId);
  return withTaskLock(home, taskId, async () => {
    const input = /** @type {any} */ (await readJson(paths.input));
    if (input === undefined) throw new HeirloomError('E_INPUT', `준비된 인계 입력이 없음: ${taskId}`, { hint: 'prepare를 먼저 실행한다.' });
    const state = deriveState(await readEvents(paths.events));
    if (state !== 'prepared' && state !== 'drafted') {
      throw new HeirloomError('E_CONFLICT', `현재 상태(${state ?? '없음'})에서는 탐침을 실행할 수 없음`, { hint: '새 변경을 인계하려면 prepare를 다시 실행한다.' });
    }
    const root = input.repo.root;
    const config = (await loadProjectConfig(root)).probe;
    const spec = checkProbeSpec(rawSpec, config, specLabel);

    const current = await currentSourceState({ root, base: input.base });
    if (current.hash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '인계 준비 이후 소스가 바뀜', { hint: 'prepare를 다시 실행하고 그 결과로 탐침을 다시 돌린다.' });
    }

    /** @type {string[]} */
    const warnings = [];
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'heirloom-probe-'));
    const dirs = { base: path.join(tmp, 'base'), head: path.join(tmp, 'head') };
    /** @type {Record<'base' | 'head', string[]>} */
    const roots = { base: [], head: [] };
    const setupCommands = spec.setup ?? config.setup;
    /** @type {Record<'base' | 'head', Awaited<ReturnType<typeof runSetup>>>} */
    const setup = { base: [], head: [] };
    /** @type {{ id: string, title: string, run: string[], timeoutSeconds: number, base: RecordedRun, head: RecordedRun }[]} */
    const probes = [];
    /** @type {Partial<Record<'base' | 'head', TestSide>>} */
    const tests = {};
    /** @type {Record<string, string>} */
    const logs = {};
    try {
      await addWorktree(root, dirs.base, input.base.mergeBase);
      await addWorktree(root, dirs.head, current.mergeBase);
      warnings.push(...(await overlaySource({ root, dir: dirs.head, files: current.files })));
      for (const side of /** @type {const} */ (['base', 'head'])) {
        roots[side] = [...new Set([dirs[side], await realpath(dirs[side])])];
        setup[side] = await runSetup(setupCommands, { cwd: dirs[side], timeoutMs: config.setupTimeoutSeconds * 1000, roots: roots[side] });
        const failed = setup[side].find((s) => s.exitCode !== 0);
        if (failed) warnings.push(`${side} 준비 명령 실패: ${failed.run.join(' ')} (${failed.error ?? (failed.timedOut ? '시간 초과' : `종료 코드 ${failed.exitCode}`)})`);
      }
      for (const p of spec.probes) {
        const timeoutSeconds = p.timeoutSeconds ?? PROBE_TIMEOUT_SECONDS;
        /** @type {Partial<Record<'base' | 'head', RecordedRun>>} */
        const sides = {};
        for (const side of /** @type {const} */ (['base', 'head'])) {
          sides[side] = record(await runCommand(p.run, { cwd: dirs[side], timeoutMs: timeoutSeconds * 1000, env: probeEnv() }), roots[side]);
        }
        probes.push({ id: p.id, title: p.title, run: p.run, timeoutSeconds, base: /** @type {RecordedRun} */ (sides.base), head: /** @type {RecordedRun} */ (sides.head) });
      }
      if (spec.tests) {
        const timeoutMs = (spec.tests.timeoutSeconds ?? config.testTimeoutSeconds) * 1000;
        for (const side of /** @type {const} */ (['base', 'head'])) {
          const r = await runCommand(spec.tests.command, { cwd: dirs[side], timeoutMs, env: probeEnv(), limit: TEST_STREAM_LIMIT });
          const stdout = normalize(r.stdout, roots[side]);
          // Parsed after normalizing, so names and locations that hold the worktree path match.
          const results = parseTestOutput(spec.tests.parser, stdout, [ROOT_TOKEN]);
          const counts = { pass: 0, fail: 0, skip: 0 };
          for (const t of Object.values(results ?? {})) counts[t.status]++;
          const log = `tests-${side}.log`;
          logs[log] = `$ ${spec.tests.command.join(' ')}\n--- stdout\n${stdout}\n--- stderr\n${normalize(r.stderr, roots[side])}\n`;
          tests[side] = { exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, error: r.error, durationMs: r.durationMs, truncated: r.truncated, parsed: results !== null, counts, results: results ?? {}, log };
        }
      }
    } finally {
      for (const dir of Object.values(dirs)) await removeWorktree(root, dir);
      await rm(tmp, { recursive: true, force: true });
      await tryGit(['worktree', 'prune'], { cwd: root });
    }

    /** @type {any} */
    let testsRecord = null;
    if (spec.tests) {
      const base = /** @type {TestSide} */ (tests.base);
      const head = /** @type {TestSide} */ (tests.head);
      const parsed = base.parsed && head.parsed;
      if (spec.tests.parser !== 'exit-code' && !parsed) {
        warnings.push(`테스트 출력을 ${spec.tests.parser}로 읽지 못함(${[!base.parsed && 'base', !head.parsed && 'head'].filter(Boolean).join(', ')}): 전체 종료 코드만 비교함`);
      }
      testsRecord = {
        command: spec.tests.command,
        parser: spec.tests.parser,
        comparison: parsed ? 'tests' : 'exit-code',
        changed: parsed ? changedTests(base.results, head.results) : [],
        base,
        head,
      };
    }

    for (const p of probes) {
      if (p.head.error === 'command_not_found') warnings.push(`탐침 ${p.id}: 실행 파일을 찾지 못함 (${p.run[0]})`);
      else if (p.head.exitCode !== 0 || p.head.timedOut) warnings.push(`탐침 ${p.id}: head에서 실패함(${p.head.timedOut ? '시간 초과' : `종료 코드 ${p.head.exitCode}`}). 이번 변경의 결과가 실패라면 그대로 둔다.`);
    }
    if (probes.length && probes.every((p) => p.base.sha256 === p.head.sha256)) {
      warnings.push('모든 탐침의 출력이 base와 head에서 같음: 이번 변경의 동작 차이를 드러내지 못함. 바뀐 경로를 지나는 입력으로 탐침을 고친다.');
    }

    const probeSetHash = `sha256:${sha256Hex(
      canonicalJson({
        inputSourceHash: input.source.hash,
        base: input.base.mergeBase,
        probes: probes.map((p) => ({ id: p.id, run: p.run, base: p.base.sha256, head: p.head.sha256 })),
        tests: testsRecord && { command: testsRecord.command, parser: testsRecord.parser, comparison: testsRecord.comparison, changed: testsRecord.changed, base: testsRecord.base.exitCode, head: testsRecord.head.exitCode },
      }),
    )}`;
    const result = {
      schemaVersion: 1,
      taskId,
      inputSourceHash: input.source.hash,
      probeSetHash,
      ranAt: now.toISOString(),
      base: { commit: input.base.mergeBase },
      head: { mergeBase: current.mergeBase, sourceHash: current.hash },
      setup: { commands: setupCommands, base: setup.base, head: setup.head },
      probes,
      tests: testsRecord,
      ...(permit ? { permit } : {}),
      warnings,
    };

    await rm(paths.probes, { recursive: true, force: true });
    await ensureDir(paths.probes);
    await writeJsonAtomic(path.join(paths.probes, 'spec.json'), spec);
    for (const [name, text] of Object.entries(logs)) await writeFileAtomic(path.join(paths.probes, name), text);
    const resultPath = path.join(paths.probes, 'result.json');
    await writeJsonAtomic(resultPath, result);

    return {
      taskId,
      probeSetHash,
      resultPath,
      probes: probes.map((p) => ({ id: p.id, title: p.title, run: p.run, sameOutput: p.base.sha256 === p.head.sha256, base: preview(p.base), head: preview(p.head) })),
      tests: testsRecord && {
        command: testsRecord.command,
        comparison: testsRecord.comparison,
        base: { exitCode: testsRecord.base.exitCode, timedOut: testsRecord.base.timedOut, counts: testsRecord.base.counts },
        head: { exitCode: testsRecord.head.exitCode, timedOut: testsRecord.head.timedOut, counts: testsRecord.head.counts },
        // The full list is in the result file.
        changed: testsRecord.changed.slice(0, CHANGED_SHOWN),
        changedCount: testsRecord.changed.length,
      },
      setup: { commands: setupCommands, failed: [...setup.base, ...setup.head].some((s) => s.exitCode !== 0) },
      ...(permit ? { permit } : {}),
      warnings,
    };
  });
}

/**
 * Read the probes file the agent wrote.
 * @param {string} file
 */
export async function readProbeSpec(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    throw new HeirloomError('E_INPUT', `탐침 파일을 읽지 못함: ${file}`, { cause: err });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new HeirloomError('E_INPUT', `탐침 파일이 JSON이 아님: ${file}`, { cause: err });
  }
}
