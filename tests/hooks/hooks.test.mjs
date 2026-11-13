// Runs the real hook entry points (run-hook.cmd → bash script → Node) as Claude Code would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_HOOK = path.join(ROOT, 'hooks', 'run-hook.cmd');
const skip = process.platform === 'win32';
const BASH = skip ? '' : execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();

/**
 * @param {'session-start' | 'stop'} hook
 * @param {{ input?: unknown, env?: Record<string, string | undefined>, cwd?: string, host?: string }} [options]
 *   `host`: the host argument a host's hooks file passes after the hook name
 */
function runHook(hook, { input = {}, env = {}, cwd = ROOT, host } = {}) {
  const started = Date.now();
  const result = spawnSync(BASH, [RUN_HOOK, hook, ...(host ? [host] : [])], {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ms: Date.now() - started };
}

/** @param {string} version */
async function fakeNode(version) {
  const dir = await tempDir('fakenode');
  const file = path.join(dir, 'node');
  await writeFile(file, `#!/bin/sh\necho ${version}\n`);
  await chmod(file, 0o755);
  return file;
}

test('hooks.json wires SessionStart (startup|resume|clear|compact) and Stop through run-hook.cmd', { skip }, async () => {
  const config = JSON.parse(await readFile(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(config.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.match(config.hooks.SessionStart[0].hooks[0].command, /run-hook\.cmd" session-start$/);
  assert.match(config.hooks.Stop[0].hooks[0].command, /run-hook\.cmd" stop$/);
});

test('session-start without Node injects a one-line notice and exits 0', { skip }, () => {
  const r = runHook('session-start', { env: { PATH: '', HEIRLOOM_NODE: undefined } });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /Node 20 이상이 필요합니다/);
});

test('session-start with Node older than 20 injects the same notice', { skip }, async () => {
  const r = runHook('session-start', { env: { HEIRLOOM_NODE: await fakeNode('v18.19.0') } });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Node 20 이상/);
});

test('stop without Node, or with old Node, prints nothing and exits 0', { skip }, async () => {
  for (const env of [{ PATH: '', HEIRLOOM_NODE: undefined }, { HEIRLOOM_NODE: await fakeNode('v16.0.0') }]) {
    const r = runHook('stop', { env, input: { stop_hook_active: false } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('session-start with Node injects the convention and project index', { skip }, async () => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  const home = await tempDir('home');
  const r = runHook('session-start', {
    input: { hook_event_name: 'SessionStart', source: 'compact', cwd: repo.dir },
    env: { HEIRLOOM_HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const context = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /<heirloom-convention>[\s\S]*prepare-handoff[\s\S]*<\/heirloom-convention>/);
  assert.match(context, /<heirloom-project>[\s\S]*활성 axiom/);
});

test('session-start tolerates invalid stdin', { skip }, async () => {
  const home = await tempDir('home');
  const r = runHook('session-start', { input: 'not json', env: { HEIRLOOM_HOME: home }, cwd: await tempDir('plain') });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /<heirloom-convention>/);
});

test('stop blocks once per state with a reminder, and never when stop_hook_active', { skip }, async () => {
  const upstream = await makeRepo({ 'README.txt': 'hello\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('docs/superpowers/specs/x.md', 'spec\n');
  await repo.write('src/a.mjs', 'export {};\n');
  const home = await tempDir('home');
  const env = { HEIRLOOM_HOME: home };

  const active = runHook('stop', { input: { stop_hook_active: true, cwd: repo.dir }, env });
  assert.equal(active.status, 0);
  assert.equal(active.stdout, '');

  const first = runHook('stop', { input: { stop_hook_active: false, cwd: repo.dir }, env });
  assert.equal(first.status, 0, first.stderr);
  const out = JSON.parse(first.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /prepare-handoff/);

  const second = runHook('stop', { input: { stop_hook_active: false, cwd: repo.dir }, env });
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');
});

test('stop passes the transcript on: a spec already on main counts once the session read it', { skip }, async () => {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'docs/superpowers/specs/units.md': '# 단위\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 1;\n');
  const env = { HEIRLOOM_HOME: await tempDir('home') };

  assert.equal(runHook('stop', { input: { stop_hook_active: false, cwd: repo.dir }, env }).stdout, '', 'without a transcript the unchanged spec is not seen');

  const transcriptPath = path.join(await tempDir('transcript'), 'session.jsonl');
  const read = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } }] } };
  await writeFile(transcriptPath, `${JSON.stringify(read)}\n`);
  const r = runHook('stop', { input: { stop_hook_active: false, cwd: repo.dir, transcript_path: transcriptPath }, env });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /docs\/superpowers\/specs\/units\.md \(이번 세션에서 읽음\)/);
});

test('codex: the shared hooks.json gives the same SessionStart and Stop output, and a Codex transcript counts', { skip }, async () => {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'docs/superpowers/specs/units.md': '# 단위\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 1;\n');
  const env = { HEIRLOOM_HOME: await tempDir('home') };

  // Codex hook input: same field names as Claude Code, plus a few of its own.
  const start = runHook('session-start', { input: { session_id: 's', hook_event_name: 'SessionStart', source: 'compact', cwd: repo.dir, model: 'm', transcript_path: null }, env });
  assert.equal(start.status, 0, start.stderr);
  assert.match(JSON.parse(start.stdout).hookSpecificOutput.additionalContext, /prepare-handoff/);

  const transcriptPath = path.join(await tempDir('transcript'), 'rollout.jsonl');
  const exec = { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: `await tools.exec_command({cmd:"cat docs/superpowers/specs/units.md",workdir:${JSON.stringify(repo.dir)}})` } };
  await writeFile(transcriptPath, `${JSON.stringify(exec)}\n`);
  const stop = runHook('stop', { input: { session_id: 's', turn_id: 'u', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '끝', cwd: repo.dir, transcript_path: transcriptPath }, env });
  assert.equal(stop.status, 0, stop.stderr);
  const out = JSON.parse(stop.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /units\.md \(이번 세션에서 읽음\)/);
});

test('host argument: codex is accepted; an unknown host falls back to Claude Code output with a note on stderr', { skip }, async () => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  const env = { HEIRLOOM_HOME: await tempDir('home') };
  const codex = runHook('session-start', { host: 'codex', input: { cwd: repo.dir }, env });
  assert.equal(codex.status, 0, codex.stderr);
  assert.equal(JSON.parse(codex.stdout).hookSpecificOutput.hookEventName, 'SessionStart');

  const unknown = runHook('session-start', { host: 'vim', input: { cwd: repo.dir }, env });
  assert.equal(unknown.status, 0);
  assert.equal(JSON.parse(unknown.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(unknown.stderr, /vim/);
});

test('HEIRLOOM_HOOK_LOG=1 records each hook input and output in HEIRLOOM_HOME/hook-log.jsonl', { skip }, async () => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  const home = await tempDir('home');
  runHook('session-start', { host: 'codex', input: { cwd: repo.dir, source: 'startup' }, env: { HEIRLOOM_HOME: home, HEIRLOOM_HOOK_LOG: '1' } });
  runHook('stop', { input: { cwd: repo.dir, stop_hook_active: true }, env: { HEIRLOOM_HOME: home, HEIRLOOM_HOOK_LOG: '1' } });
  const lines = (await readFile(path.join(home, 'hook-log.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.hook, l.host]), [['session-start', 'codex'], ['stop', 'claude-code']]);
  assert.equal(lines[0].input.source, 'startup');
  assert.equal(typeof lines[0].output.hookSpecificOutput.additionalContext, 'string');
  assert.equal(lines[1].output, null, 'nothing was printed');
  assert.match(lines[0].at, /^\d{4}-/);

  const quiet = await tempDir('home');
  runHook('session-start', { input: { cwd: repo.dir }, env: { HEIRLOOM_HOME: quiet } });
  await assert.rejects(readFile(path.join(quiet, 'hook-log.jsonl'), 'utf8'), 'no log without the variable');
});

test('stop gives up silently when the time budget is exceeded', { skip }, async () => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  await repo.write('docs/superpowers/specs/x.md', 'spec\n');
  const r = runHook('stop', {
    input: { stop_hook_active: false, cwd: repo.dir },
    env: { HEIRLOOM_HOME: await tempDir('home'), HEIRLOOM_HOOK_TIMEOUT_MS: '1' },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('stop finishes within the 2 second budget on a small repository', { skip }, async () => {
  const upstream = await makeRepo();
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('docs/superpowers/specs/x.md', 'spec\n');
  const r = runHook('stop', { input: { stop_hook_active: false, cwd: repo.dir }, env: { HEIRLOOM_HOME: await tempDir('home') } });
  assert.equal(r.status, 0);
  assert.ok(r.ms < 2000, `took ${r.ms}ms`);
});
