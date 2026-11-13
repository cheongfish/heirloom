// Opt-in test cadence: with the project setting `testCadence.mode: "phase"` the session start
// adds rules that run focused tests per task and the full suite only at phase gates. The
// default ("off") adds nothing, so projects that do not opt in see no change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeRepo, tempDir } from '../helpers/git-fixture.mjs';
import { loadProjectConfig } from '../../skills/using-heirloom/lib/config.mjs';
import { projectConfigSchema, validate } from '../../skills/using-heirloom/lib/schema.mjs';
import { buildSessionContext } from '../../skills/using-heirloom/lib/session-context.mjs';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('config: testCadence.mode defaults to off and accepts only off or phase', async () => {
  const repo = await makeRepo();
  assert.deepEqual((await loadProjectConfig(repo.dir)).testCadence, { mode: 'off' });
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, testCadence: { mode: 'phase' } }));
  assert.deepEqual((await loadProjectConfig(repo.dir)).testCadence, { mode: 'phase' });

  assert.deepEqual(validate(projectConfigSchema, { schemaVersion: 1, testCadence: {} }), []);
  assert.notDeepEqual(validate(projectConfigSchema, { schemaVersion: 1, testCadence: { mode: 'task' } }), []);
  assert.notDeepEqual(validate(projectConfigSchema, { schemaVersion: 1, testCadence: { mode: 'phase', command: 'npm test' } }), [], 'no test command: the plan decides it');
});

test('session context: no cadence block unless the project opted in', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  const off = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  assert.doesNotMatch(off, /<heirloom-test-cadence>/);

  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, testCadence: { mode: 'off' } }));
  assert.doesNotMatch(await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT }), /<heirloom-test-cadence>/);
});

test('session context: phase mode adds the cadence rules', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  await repo.write('.heirloom/config.json', JSON.stringify({ schemaVersion: 1, testCadence: { mode: 'phase' } }));
  const context = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  const block = /<heirloom-test-cadence>\n([\s\S]*?)\n<\/heirloom-test-cadence>/.exec(context)?.[1] ?? '';
  assert.ok(block, 'the block is present');
  // The rules the behavior depends on; wording may change, these points may not.
  assert.match(block, /testCadence\.mode/);
  assert.match(block, /phase/i);
  assert.match(block, /full test suite/i);
  assert.match(block, /subagent/i, 'implementer subagents must receive the rules through their briefs');
  assert.match(block, /handoff/i, 'the full suite still runs before a handoff');
  assert.match(block, /\*\*Reviewing a task\.\*\*[^\n]*implementer's reported/, 'reviewers rely on the reported runs instead of running tests again');
  assert.match(block, /\*\*Phase gate\.\*\*[^\n]*not a task[^\n]*you run it yourself[^\n]*Never skip/, 'the controller runs every gate itself, before the next phase starts');
});

test('session context: a broken setting file does not break the session start', async () => {
  const repo = await makeRepo();
  const home = await tempDir('home');
  await repo.write('.heirloom/config.json', '{ broken');
  const context = await buildSessionContext({ cwd: repo.dir, home, pluginRoot: PLUGIN_ROOT });
  assert.match(context, /<heirloom-convention>/);
  assert.doesNotMatch(context, /<heirloom-test-cadence>/);
});
