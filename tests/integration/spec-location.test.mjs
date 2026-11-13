// Where the project keeps its specs: a handoff whose spec is outside `specGlobs` says so, the
// add-spec-globs script writes the project setting when the user agrees, and the Stop hook
// also counts specs the session read (Claude Code transcript), not only specs changed here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { evaluateStop } from '../../skills/using-heirloom/lib/reminder.mjs';
import { specsReadInTranscript } from '../../skills/using-heirloom/lib/transcript.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADD = path.join(ROOT, 'skills', 'prepare-handoff', 'scripts', 'add-spec-globs.mjs');
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

/** @param {string} cwd @param {string[]} args */
function addGlobs(cwd, args) {
  const r = spawnSync(process.execPath, [ADD, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
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

// ---------------------------------------------------------------- spec outside specGlobs

test('prepare: a spec outside specGlobs is reported with a suggested pattern; one inside is not', async () => {
  const { repo, home } = await workRepo();
  await repo.write('design/rfc/units.md', '# 단위\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const out = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: ['design/rfc/units.md'] }));
  assert.deepEqual(out.specCoverage, { uncovered: ['design/rfc/units.md'], suggested: ['design/rfc/**/*.md'], specGlobs: DEFAULTS });

  const inside = await workRepo();
  await inside.repo.write('docs/superpowers/specs/x.md', '# x\n');
  await inside.repo.write('src/a.mjs', 'export const a = 2;\n');
  const ok = /** @type {any} */ (await prepareHandoff({ cwd: inside.repo.dir, home: inside.home, specs: ['docs/superpowers/specs/x.md'] }));
  assert.equal(ok.specCoverage, null);
});

test('prepare: a spec at the repository root suggests its own path, not every Markdown file', async () => {
  const { repo, home } = await workRepo();
  await repo.write('SPEC.md', '# spec\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const out = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: ['SPEC.md'] }));
  assert.deepEqual(out.specCoverage.suggested, ['SPEC.md']);
});

test('add-spec-globs: creates the project setting with the defaults kept, then only adds', async () => {
  const { repo } = await workRepo();
  const first = addGlobs(repo.dir, ['--glob', 'design/rfc/**/*.md']);
  assert.equal(first.status, 0);
  assert.deepEqual(first.out.data, { file: '.heirloom/config.json', created: true, added: ['design/rfc/**/*.md'], specGlobs: [...DEFAULTS, 'design/rfc/**/*.md'] });
  const config = JSON.parse(await readFile(path.join(repo.dir, '.heirloom', 'config.json'), 'utf8'));
  assert.deepEqual(config, { schemaVersion: 1, specGlobs: [...DEFAULTS, 'design/rfc/**/*.md'] });

  const again = addGlobs(repo.dir, ['--glob', 'design/rfc/**/*.md', '--glob', 'notes/specs/*.md']);
  assert.deepEqual(again.out.data, { file: '.heirloom/config.json', created: false, added: ['notes/specs/*.md'], specGlobs: [...DEFAULTS, 'design/rfc/**/*.md', 'notes/specs/*.md'] });
});

test('add-spec-globs: keeps the other settings and an explicit pattern list', async () => {
  const { repo } = await workRepo();
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, baseBranch: 'main', specGlobs: ['rfcs/*.md'], recall: { maxRecords: 3 } }));
  const r = addGlobs(path.join(repo.dir, 'src'), ['--glob', 'design/**/*.md']);
  assert.equal(r.status, 0, 'runs from a subdirectory: the repository root is found');
  const config = JSON.parse(await readFile(path.join(repo.dir, '.heirloom', 'config.json'), 'utf8'));
  assert.deepEqual(config, { schemaVersion: 1, baseBranch: 'main', specGlobs: ['rfcs/*.md', 'design/**/*.md'], recall: { maxRecords: 3 } });
});

test('add-spec-globs: refuses bad patterns and a broken setting file without writing', async () => {
  const { repo } = await workRepo();
  for (const glob of ['', '/abs/specs/*.md', '../outside/*.md', 'design\\rfc\\*.md']) {
    const r = addGlobs(repo.dir, ['--glob', glob]);
    assert.equal(r.status, 2, glob);
  }
  assert.equal(addGlobs(repo.dir, []).status, 2);
  await assert.rejects(readFile(path.join(repo.dir, '.heirloom', 'config.json')));

  await repo.write('.heirloom/config.json', '{ broken');
  assert.equal(addGlobs(repo.dir, ['--glob', 'design/*.md']).status, 2);
  assert.equal(await readFile(path.join(repo.dir, '.heirloom', 'config.json'), 'utf8'), '{ broken');
});

test('the setting is not part of the work: adding it does not change the handoff state', async () => {
  const { repo, home } = await workRepo();
  await repo.write('design/rfc/units.md', '# 단위\n');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const before = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: ['design/rfc/units.md'] }));
  assert.equal(addGlobs(repo.dir, ['--glob', before.specCoverage.suggested[0]]).status, 0);
  const after = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: ['design/rfc/units.md'] }));
  assert.equal(after.source.hash, before.source.hash);
  assert.equal(after.alreadyPrepared, true);
  assert.equal(after.specCoverage, null, 'the new pattern covers the spec');
});

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
  assert.equal((await evaluateStop({ cwd: repo.dir, home, stopHookActive: false, transcriptPath: other })).reason, 'no_spec');

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
