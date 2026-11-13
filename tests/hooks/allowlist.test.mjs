// The per-run PreToolUse hook of the Codex headless profile, run as Codex runs it: JSON on
// stdin, a deny decision on stdout or nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, 'skills', 'using-heirloom', 'scripts', 'hook-allowlist.mjs');

/** @param {string} policyFile @param {unknown} input */
function run(policyFile, input) {
  const r = spawnSync(process.execPath, [HOOK, policyFile], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
}

async function policy() {
  const dir = await tempDir('policy');
  const file = path.join(dir, 'agent-curate.policy.json');
  const draft = path.join(dir, 'draft.json');
  await writeFile(file, JSON.stringify({ commands: ['^cat(?: [^;&|`$<>\\n\\r]*)?$'], writes: [draft] }));
  return { dir, file, draft };
}

const denied = (/** @type {any} */ out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('allowlist hook: listed shell commands pass silently, others are denied with a reason', async () => {
  const p = await policy();
  const ok = run(p.file, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat a.txt' }, cwd: p.dir });
  assert.equal(ok.status, 0);
  assert.equal(ok.out, null);
  for (const command of ['ls -la', 'cat a.txt; rm -rf /', 'touch x']) {
    const r = run(p.file, { tool_name: 'Bash', tool_input: { command }, cwd: p.dir });
    assert.equal(r.status, 0);
    assert.ok(denied(r.out), command);
    assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /Heirloom/);
  }
});

test('allowlist hook: patches may touch only the listed files', async () => {
  const p = await policy();
  const patch = (/** @type {string} */ body) => run(p.file, { tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n${body}\n*** End Patch` }, cwd: p.dir });
  assert.equal(patch(`*** Add File: ${p.draft}\n+{}`).out, null);
  assert.equal(patch('*** Update File: draft.json\n@@\n-a\n+b').out, null, 'relative to the cwd');
  assert.ok(denied(patch('*** Add File: notes.txt\n+hi').out));
  assert.ok(denied(patch(`*** Update File: ${p.draft}\n*** Move to: other.json`).out));
  assert.ok(denied(patch('no file headers').out), 'a patch without file headers');
});

test('allowlist hook: other tools pass; a missing or broken policy denies everything', async () => {
  const p = await policy();
  assert.equal(run(p.file, { tool_name: 'update_plan', tool_input: {} }).out, null);
  assert.ok(denied(run(path.join(p.dir, 'missing.json'), { tool_name: 'Bash', tool_input: { command: 'cat a' } }).out));
  await writeFile(p.file, '{ not json');
  assert.ok(denied(run(p.file, { tool_name: 'Bash', tool_input: { command: 'cat a' } }).out));
});
