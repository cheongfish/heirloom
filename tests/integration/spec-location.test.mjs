// The Stop hook counts specs the session read (from the host's transcript), not only specs
// changed on this branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { evaluateStop } from '../../skills/using-heirloom/lib/reminder.mjs';
import { specsReadInTranscript } from '../../skills/using-heirloom/lib/transcript.mjs';

const DEFAULTS = ['docs/superpowers/specs/**', '**/specs/**/*.md'];

/**
 * A clone on branch feat. `files` go to upstream main; the work changes src/a.mjs.
 * @param {Record<string, string>} [files]
 */
async function workRepo(files = {}) {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n', ...files });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  const home = await tempDir('home');
  return { upstream, repo, home };
}

/** A Claude Code transcript (JSON lines) with the given tool uses. */
async function transcript(/** @type {{ name: string, input: object }[]} */ uses) {
  const file = path.join(await tempDir('transcript'), 'session.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '구현해 줘' } }),
    ...uses.map((u, i) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '읽는다' }, { type: 'tool_use', id: `t${i}`, name: u.name, input: u.input }] } })),
    'not json',
  ];
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

// ---------------------------------------------------------------- specs read in the session

test('transcript: Read calls on spec files inside the repository, relative to the root', async () => {
  const { repo } = await workRepo();
  const file = await transcript([
    { name: 'Read', input: { file_path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } },
    { name: 'Read', input: { file_path: path.join(repo.dir, 'src/a.mjs') } },
    { name: 'Read', input: { file_path: '/elsewhere/docs/superpowers/specs/other.md' } },
    { name: 'Edit', input: { file_path: path.join(repo.dir, 'specs/x/y.md') } },
    { name: 'Read', input: { file_path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } },
  ]);
  assert.deepEqual(await specsReadInTranscript({ transcriptPath: file, root: repo.dir, globs: DEFAULTS }), ['docs/superpowers/specs/units.md']);
  assert.deepEqual(await specsReadInTranscript({ transcriptPath: path.join(repo.dir, 'missing.jsonl'), root: repo.dir, globs: DEFAULTS }), []);
  assert.deepEqual(await specsReadInTranscript({ transcriptPath: undefined, root: repo.dir, globs: DEFAULTS }), []);
});

/** A Codex rollout (JSON lines) with the given response items. */
async function codexTranscript(/** @type {object[]} */ items) {
  const file = path.join(await tempDir('transcript'), 'rollout.jsonl');
  const lines = [
    JSON.stringify({ timestamp: 't', type: 'session_meta', payload: { id: 's1', cwd: '/w' } }),
    ...items.map((payload) => JSON.stringify({ timestamp: 't', type: 'response_item', payload })),
    'not json',
  ];
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

/** The shape Codex records: shell commands inside the JavaScript `exec` tool. */
const codexExec = (/** @type {string} */ cmd, /** @type {string} */ workdir) => ({
  type: 'custom_tool_call',
  name: 'exec',
  status: 'completed',
  input: `const r = await tools.exec_command({cmd:${JSON.stringify(cmd)},workdir:${JSON.stringify(workdir)}});\ntext(r)`,
});

test('transcript (Codex): spec paths in shell commands that exist in the repository, relative to the root', async () => {
  const { repo } = await workRepo({
    'docs/superpowers/specs/units.md': '# 단위\n',
    'docs/superpowers/specs/abs.md': '# 절대\n',
    'docs/superpowers/specs/sub.md': '# 하위\n',
    'docs/superpowers/specs/told.md': '# 말함\n',
  });
  const file = await codexTranscript([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'docs/superpowers/specs/told.md를 구현해 줘' }] },
    codexExec('sed -n 1,80p docs/superpowers/specs/units.md && cat src/a.mjs', repo.dir),
    { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: `cat '${path.join(repo.dir, 'docs/superpowers/specs/abs.md')}'` }) },
    codexExec('cat superpowers/specs/sub.md', path.join(repo.dir, 'docs')),
    codexExec('cat docs/superpowers/specs/missing.md /elsewhere/docs/superpowers/specs/other.md && ls docs/superpowers/specs/', repo.dir),
    { type: 'function_call', name: 'send_message_to_user_async', arguments: JSON.stringify({ message: 'docs/superpowers/specs/told.md 읽음' }) },
  ]);
  assert.deepEqual(await specsReadInTranscript({ transcriptPath: file, root: repo.dir, globs: DEFAULTS }), [
    'docs/superpowers/specs/abs.md',
    'docs/superpowers/specs/sub.md',
    'docs/superpowers/specs/units.md',
  ]);
});

test('stop (Codex): a spec already on the target branch counts once a shell command read it', async () => {
  const { repo, home } = await workRepo({ 'docs/superpowers/specs/units.md': '# 단위\n' });
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const read = await codexTranscript([codexExec('cat docs/superpowers/specs/units.md', repo.dir)]);
  const decision = await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: read });
  assert.equal(decision.remind, true);
  assert.match(String(decision.message), /docs\/superpowers\/specs\/units\.md \(이번 세션에서 읽음\)/);
});

test('transcript (Antigravity): read_file paths and run_command lines, as transcript_full.jsonl records them', async () => {
  const { repo } = await workRepo({ 'docs/superpowers/specs/units.md': '# 단위\n', 'docs/superpowers/specs/ran.md': '# 실행\n', 'docs/superpowers/specs/told.md': '# 말함\n' });
  const file = path.join(await tempDir('transcript'), 'transcript_full.jsonl');
  const steps = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', status: 'DONE', content: 'docs/superpowers/specs/told.md를 구현해 줘' },
    { step_index: 2, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'run_command', args: { CommandLine: 'ls -la docs/superpowers/specs && cat docs/superpowers/specs/ran.md', WaitMsBeforeAsync: 5000 } }] },
    { step_index: 4, source: 'MODEL', type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'read_file', args: { Path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } }, { name: 'read_file', args: { Path: path.join(repo.dir, 'src/a.mjs') } }] },
    { step_index: 5, source: 'MODEL', type: 'GENERIC', status: 'DONE', content: 'Showing lines 1-1 of 1' },
  ];
  await writeFile(file, `${steps.map((s) => JSON.stringify(s)).join('\n')}\n`);
  assert.deepEqual(await specsReadInTranscript({ transcriptPath: file, root: repo.dir, globs: DEFAULTS }), ['docs/superpowers/specs/ran.md', 'docs/superpowers/specs/units.md']);
});

test('stop: a spec already on the target branch counts once the session read it', async () => {
  const { repo, home } = await workRepo({ 'docs/superpowers/specs/units.md': '# 단위\n' });
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false })).reason, 'no_spec', 'unchanged spec, no transcript');

  const other = await transcript([{ name: 'Read', input: { file_path: path.join(repo.dir, 'README.txt') } }]);
  // Without a spec this session gets the once-per-session notice that it can hand off.
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: other })).reason, 'notice');

  const read = await transcript([{ name: 'Read', input: { file_path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } }]);
  const decision = await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: read });
  assert.equal(decision.remind, true);
  assert.match(String(decision.message), /docs\/superpowers\/specs\/units\.md/);
  assert.match(String(decision.message), /이번 세션에서 읽음/);
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: read })).reason, 'already_reminded');
});

test('stop: Markdown-only work is still not a handoff even when a spec was read', async () => {
  const { repo, home } = await workRepo({ 'docs/superpowers/specs/units.md': '# 단위\n' });
  await repo.write('docs/superpowers/plans/units.md', '# 계획\n');
  const read = await transcript([{ name: 'Read', input: { file_path: path.join(repo.dir, 'docs/superpowers/specs/units.md') } }]);
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: read })).reason, 'no_code_changes');
});
