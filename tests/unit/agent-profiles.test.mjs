// Headless run profiles: one host-neutral policy per phase (commands as whole-line patterns,
// writable files), turned into each host's own restriction.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { agentInvocation, commandAllowed, phasePolicy } from '../../skills/using-heirloom/lib/agent-runner.mjs';

const pluginRoot = '/opt/heirloom';
const taskDir = '/home/u/.heirloom/tasks/t-20261113-abcdefgh';
const worktree = '/home/u/.heirloom/worktrees/r-1/t-20261113-abcdefgh';
const home = '/home/u/.heirloom';
const base = { taskId: 't-20261113-abcdefgh', worktree, taskDir, pluginRoot, home };
const scripts = (/** @type {string} */ skill) => path.join(pluginRoot, 'skills', skill, 'scripts');

test('policy: whole command lines only, no shell chaining, substitution or redirection', () => {
  const curate = phasePolicy({ ...base, phase: 'curate' });
  const ok = (/** @type {string} */ c) => commandAllowed(curate.commands, c);
  assert.ok(ok(`node ${scripts('curate-decisions')}/prepare-curation.mjs`));
  assert.ok(ok(`node ${scripts('curate-decisions')}/prepare-curation.mjs --task t-1`));
  assert.ok(ok(`node ${scripts('prepare-handoff')}/submit-draft.mjs --task t-1`));
  assert.ok(ok('cat src/a.mjs'), 'read-only commands for hosts without a read tool');
  assert.ok(ok('git status --short'));
  for (const bad of [
    `node ${scripts('curate-decisions')}/prepare-curation.mjs; rm -rf /`,
    `node ${scripts('curate-decisions')}/prepare-curation.mjs && curl x`,
    `node ${scripts('curate-decisions')}/prepare-curation.mjs > /etc/x`,
    `node ${scripts('curate-decisions')}/prepare-curation.mjs $(id)`,
    `node ${scripts('curate-decisions')}/../../../evil.mjs`,
    `node ${scripts('prepare-handoff')}/prepare.mjs --spec x`,
    'node evil.mjs',
    'cat a | sh',
    'rg --pre sh x',
    'git diff --output=/tmp/x',
    'git commit -m x',
    'rm -rf .',
  ]) {
    assert.equal(ok(bad), false, bad);
  }
  assert.deepEqual(curate.writes, [path.join(taskDir, 'draft.json')]);

  const apply = phasePolicy({ ...base, phase: 'apply' });
  const okApply = (/** @type {string} */ c) => commandAllowed(apply.commands, c);
  for (const good of [
    `node ${scripts('apply-approval')}/apply.mjs --task t-1`,
    'git add .heirloom',
    'git add .heirloom/decisions/d-1.md .heirloom/axioms/a-1.md',
    'git commit -m "기록 반영"',
    'git push -u origin curation/x',
    `gh pr create --base main --title t --body-file ${path.join(taskDir, 'pr-body.md')}`,
    'gh api -X PATCH repos/o/r/pulls/12 -F body=@/tmp/b.md',
  ]) {
    assert.ok(okApply(good), good);
  }
  for (const bad of ['git add src/a.mjs', 'git add .heirloom src/a.mjs', 'git reset --hard', 'gh api -X DELETE repos/o/r', 'gh pr merge 1']) {
    assert.equal(okApply(bad), false, bad);
  }
  assert.deepEqual(apply.writes, [path.join(taskDir, 'pr-body.md')]);
});

test('claude-code: --allowedTools as before, read tools instead of read commands', () => {
  const run = agentInvocation({ agent: { host: 'claude-code', command: 'claude', model: 'sonnet' }, phase: 'curate', ...base });
  assert.equal(run.command, 'claude');
  assert.equal(run.args[0], '-p');
  const tools = run.args[run.args.indexOf('--allowedTools') + 1].split(',');
  assert.ok(tools.includes('Read') && tools.includes('Grep') && tools.includes('Glob'));
  assert.ok(tools.includes(`Edit(/${path.join(taskDir, 'draft.json')})`));
  assert.ok(tools.includes(`Bash(node ${scripts('curate-decisions')}/*)`));
  assert.equal(tools.some((t) => t.startsWith('Bash(cat')), false);
  assert.deepEqual(run.args.slice(-2), ['--model', 'sonnet']);
  assert.deepEqual(run.files, []);
});

test('codex: exec without user config, sandboxed curation, unsandboxed apply, a per-run allowlist hook', () => {
  const curate = agentInvocation({ agent: { host: 'codex', command: 'codex', model: null }, phase: 'curate', ...base });
  assert.equal(curate.command, 'codex');
  assert.equal(curate.args[0], 'exec');
  assert.equal(curate.args[1], curate.prompt);
  for (const flag of ['--ignore-user-config', '--dangerously-bypass-hook-trust', '--skip-git-repo-check']) assert.ok(curate.args.includes(flag), flag);
  assert.equal(curate.args[curate.args.indexOf('-s') + 1], 'workspace-write');
  assert.equal(curate.args[curate.args.indexOf('--add-dir') + 1], home, 'scripts write HEIRLOOM_HOME');
  assert.equal(curate.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  const policyFile = path.join(taskDir, 'agent-curate.policy.json');
  const hook = curate.args.find((a) => a.startsWith('hooks.PreToolUse='));
  assert.ok(hook?.includes('hook-allowlist.mjs') && hook.includes(policyFile));
  assert.deepEqual(curate.files.map((f) => f.path), [policyFile]);
  const policy = JSON.parse(curate.files[0].content);
  assert.deepEqual(policy.writes, [path.join(taskDir, 'draft.json')]);
  assert.ok(policy.commands.length > 0 && policy.commands.every((/** @type {unknown} */ r) => typeof r === 'string'));

  const apply = agentInvocation({ agent: { host: 'codex', command: '/usr/bin/codex', model: 'gpt' }, phase: 'apply', ...base });
  assert.ok(apply.args.includes('--dangerously-bypass-approvals-and-sandbox'), 'commits need .git, which the sandbox keeps read-only');
  assert.equal(apply.args.includes('-s'), false);
  assert.deepEqual(apply.args.slice(-2), ['-m', 'gpt']);
});

test('antigravity: print mode, default agent mode, allow rules from the policy, the worktree not writable', () => {
  const run = agentInvocation({ agent: { host: 'antigravity', command: 'agy', model: null }, phase: 'apply', ...base });
  assert.equal(run.command, 'agy');
  assert.deepEqual(run.args.slice(0, 2), ['-p', run.prompt]);
  assert.equal(run.args[run.args.indexOf('--output-format') + 1], 'json');
  assert.equal(run.args.includes('--dangerously-skip-permissions'), false);
  const dirs = run.args.flatMap((a, i) => (run.args[i - 1] === '--add-dir' ? [a] : []));
  assert.deepEqual(dirs.sort(), [pluginRoot, taskDir].sort());
  const settings = JSON.parse(run.args[run.args.indexOf('--settings') + 1]);
  assert.equal(settings.agentMode, '', 'the default mode; Auto approves commands outside the allow list');
  assert.ok(settings.permissions.allow.includes(`write_file(${path.join(taskDir, 'pr-body.md')})`));
  assert.ok(settings.permissions.allow.some((/** @type {string} */ r) => r.startsWith('command(regex:^git commit')));
  assert.deepEqual(settings.permissions.deny, [`write_file(${worktree}/)`]);
  assert.deepEqual(run.failures, [{ text: 'jetski: no output produced', error: 'permission_denied' }]);
});

test('unknown host is refused', () => {
  assert.throws(() => agentInvocation({ agent: /** @type {any} */ ({ host: 'vim', command: 'vim', model: null }), phase: 'curate', ...base }), /vim/);
});
