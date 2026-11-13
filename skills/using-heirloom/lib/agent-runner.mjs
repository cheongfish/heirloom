// Headless agent runs for context curation, started only by the dashboard server after the
// user chose to. The command comes from the user config, never from a request; the prompt
// is fixed text naming the task, the worktree and the skill to follow. What the run may do is
// one host-neutral policy per phase (commands as whole-line patterns, files it may write),
// which each host profile turns into that host's own restriction. Runs are not retried
// automatically.
//
// - Claude Code: `-p` with `--allowedTools` (Read, Grep and Glob for reading).
// - Codex: `codex exec` without the user's config (no other hooks, plugins or MCP servers),
//   with a per-run PreToolUse hook (hook-allowlist.mjs) that denies shell commands and file
//   patches outside the policy. Curation runs in the workspace-write sandbox. Applying runs
//   without the sandbox, because the sandbox keeps `.git` read-only and the run must commit;
//   the hook is then the only boundary, as `--allowedTools` is for Claude Code.
// - Antigravity: `agy -p` in the default agent mode (Auto would approve commands outside the
//   allow list) with per-run permission rules. In print mode a command outside the rules ends
//   the run without output and exit code 0; that is reported as `permission_denied`.
//
// Codex and Antigravity have no read tool that covers everything, so they may also run a few
// read-only commands.

import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadUserConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { appendEvent, readEvents } from './events.mjs';
import { taskPaths } from './paths.mjs';

/** @typedef {'curate' | 'apply'} AgentPhase */
/** @typedef {'claude-code' | 'codex' | 'antigravity'} AgentHost */
/** @typedef {{ host: AgentHost, command: string, model: string | null }} AgentConfig */

export const AGENT_TIMEOUT_MS = 30 * 60_000;

/** Arguments may not chain, substitute, redirect or span lines. */
const SAFE_ARGS = '[^;&|`$<>\\n\\r]*';

/** @param {string} text */
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A command rule: the Claude Code permission rule and the whole-line pattern other hosts use.
 * @typedef {{ claude: string | null, regex: string }} CommandRule
 */

/** `<words>` followed by any safe arguments. @param {string} words @returns {CommandRule} */
const words = (words) => ({ claude: `Bash(${words} *)`, regex: `^${escapeRegex(words)}(?: ${SAFE_ARGS})?$` });

/** `node <dir>/<name>.mjs` with safe arguments. @param {string} dir @returns {CommandRule} */
const scriptIn = (dir) => ({ claude: `Bash(node ${dir}/*)`, regex: `^node ${escapeRegex(dir)}/[A-Za-z0-9_-]+\\.mjs(?: ${SAFE_ARGS})?$` });

/** `node <file>` with safe arguments. @param {string} file @returns {CommandRule} */
const script = (file) => ({ claude: `Bash(node ${file} *)`, regex: `^node ${escapeRegex(file)}(?: ${SAFE_ARGS})?$` });

/**
 * Read-only commands for hosts without a general read tool (not used for Claude Code).
 * Commands with options that write files or run programs (`git diff --output`, `rg --pre`,
 * `git branch -D`) are left out: Antigravity's rules are RE2 patterns, which cannot exclude
 * an option with a lookahead.
 * @type {CommandRule[]}
 */
const READ_COMMANDS = ['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'grep', 'git status', 'git rev-parse'].map((w) => ({ claude: null, regex: words(w).regex }));

/**
 * What a headless run of the phase may do: the commands it may run and the files it may
 * write (other than through the Heirloom scripts).
 * @param {{ phase: AgentPhase, taskDir: string, pluginRoot: string }} options
 * @returns {{ commands: CommandRule[], writes: string[] }}
 */
export function phasePolicy({ phase, taskDir, pluginRoot }) {
  const skills = path.join(pluginRoot, 'skills');
  if (phase === 'curate') {
    return {
      commands: [scriptIn(path.join(skills, 'curate-decisions', 'scripts')), script(path.join(skills, 'prepare-handoff', 'scripts', 'submit-draft.mjs')), ...READ_COMMANDS],
      writes: [path.join(taskDir, 'draft.json')],
    };
  }
  return {
    commands: [
      scriptIn(path.join(skills, 'apply-approval', 'scripts')),
      { claude: 'Bash(git status *)', regex: words('git status').regex },
      { claude: 'Bash(git add .heirloom*)', regex: '^git add(?: \\.heirloom[^\\s;&|`$<>]*)+$' },
      words('git commit'),
      words('git push'),
      words('gh pr create'),
      // PR bodies are updated through the REST API: `gh pr edit` fails on some gh versions.
      { claude: 'Bash(gh api -X PATCH repos/*/pulls/*)', regex: `^gh api -X PATCH repos/[^/\\s]+/[^/\\s]+/pulls/[0-9]+(?: ${SAFE_ARGS})?$` },
      ...READ_COMMANDS,
    ],
    writes: [path.join(taskDir, 'pr-body.md')],
  };
}

/**
 * Whether a whole command line matches one of the rules.
 * @param {Array<CommandRule | string>} rules rules, or their patterns
 * @param {string} command
 */
export function commandAllowed(rules, command) {
  return rules.some((r) => new RegExp(typeof r === 'string' ? r : r.regex).test(command.trim()));
}

/**
 * Permission rule for one absolute file (Claude Code writes absolute paths as `//path`).
 * @param {string} file
 */
const absolute = (file) => `/${file.split(path.sep).join('/')}`;

/**
 * @param {AgentPhase} phase
 * @param {{ taskId: string, worktree: string, taskDir: string, pluginRoot: string }} options
 */
function phasePrompt(phase, { taskId, worktree, taskDir, pluginRoot }) {
  const skills = path.join(pluginRoot, 'skills');
  const tail = [
    'Run commands one at a time, exactly as the skill writes them, without ;, &&, | or redirection. Only the skill scripts, git and gh commands of the skill, and read-only commands are allowed.',
    'Nobody can answer questions during this run: when the skill says to ask the user, stop and report instead.',
  ];
  if (phase === 'curate') {
    const draft = path.join(taskDir, 'draft.json');
    return [
      `Heirloom context curation, task ${taskId}.`,
      `The current directory is its dedicated worktree: ${worktree}`,
      `Read ${path.join(skills, 'curate-decisions', 'SKILL.md')} and follow it exactly.`,
      `Write the draft only to ${draft}, submit it, and stop. Do not change any other file.`,
      ...tail,
    ].join('\n');
  }
  return [
    `Heirloom context curation, task ${taskId}: the human approved it in the dashboard.`,
    `The current directory is its dedicated worktree: ${worktree}`,
    `Read ${path.join(skills, 'apply-approval', 'SKILL.md')} and follow it for task ${taskId}: apply, commit the record files, push, open the pull request and record it with complete.mjs.`,
    `Write the pull request body to ${path.join(taskDir, 'pr-body.md')}.`,
    ...tail,
  ].join('\n');
}

/**
 * Command, arguments and prompt of one headless run, the files to write before it starts
 * (`files`), and log texts that mean the run failed although it exited with 0 (`failures`).
 * @param {{ agent: AgentConfig, phase: AgentPhase, taskId: string, worktree: string, taskDir: string, pluginRoot: string, home: string }} options
 * @returns {{ command: string, args: string[], prompt: string, files: { path: string, content: string }[], failures: { text: string, error: string }[] }}
 */
export function agentInvocation({ agent, phase, taskId, worktree, taskDir, pluginRoot, home }) {
  const policy = phasePolicy({ phase, taskDir, pluginRoot });
  const prompt = phasePrompt(phase, { taskId, worktree, taskDir, pluginRoot });
  if (agent.host === 'claude-code') {
    const tools = [
      'Read',
      'Grep',
      'Glob',
      // Claude Code checks every file write against Edit(...) rules; a Write(...) rule is ignored.
      ...policy.writes.map((f) => `Edit(${absolute(f)})`),
      ...policy.commands.flatMap((r) => (r.claude ? [r.claude] : [])),
    ];
    const args = ['-p', prompt, '--allowedTools', tools.join(','), '--add-dir', taskDir, '--add-dir', pluginRoot];
    if (agent.model) args.push('--model', agent.model);
    return { command: agent.command, args, prompt, files: [], failures: [] };
  }
  if (agent.host === 'codex') {
    const policyFile = path.join(taskDir, `agent-${phase}.policy.json`);
    const hookScript = path.join(pluginRoot, 'skills', 'using-heirloom', 'scripts', 'hook-allowlist.mjs');
    const hookCommand = [process.execPath, hookScript, policyFile].map((a) => JSON.stringify(a)).join(' ');
    const hooks = `hooks.PreToolUse=[{matcher=".*",hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=10}]}]`;
    const sandbox = phase === 'curate' ? ['-s', 'workspace-write', '--add-dir', home] : ['--dangerously-bypass-approvals-and-sandbox'];
    const args = ['exec', prompt, '--ignore-user-config', '--dangerously-bypass-hook-trust', '--skip-git-repo-check', ...sandbox, '-c', hooks];
    if (agent.model) args.push('-m', agent.model);
    const content = `${JSON.stringify({ commands: policy.commands.map((r) => r.regex), writes: policy.writes }, null, 2)}\n`;
    return { command: agent.command, args, prompt, files: [{ path: policyFile, content }], failures: [] };
  }
  if (agent.host === 'antigravity') {
    const settings = {
      agentMode: '',
      permissions: {
        allow: [...policy.commands.map((r) => `command(regex:${r.regex})`), ...policy.writes.map((f) => `write_file(${f})`)],
        deny: [`write_file(${worktree}/)`],
      },
    };
    const args = ['-p', prompt, '--output-format', 'json', '--add-dir', taskDir, '--add-dir', pluginRoot, '--settings', JSON.stringify(settings)];
    if (agent.model) args.push('--model', agent.model);
    return { command: agent.command, args, prompt, files: [], failures: [{ text: 'jetski: no output produced', error: 'permission_denied' }] };
  }
  throw new HeirloomError('E_INPUT', `지원하지 않는 헤드리스 실행 프로필: ${/** @type {any} */ (agent).host}`);
}

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return /** @type {NodeJS.ErrnoException} */ (err).code === 'EPERM';
  }
}

/**
 * @typedef {object} AgentStatus
 * @property {{ phase: AgentPhase, pid: number, log: string, at: string } | null} running
 * @property {{ phase: AgentPhase, exitCode: number | null, timedOut: boolean, error: string | null, at: string, log: string | null } | null} last
 *   the last finished run; a run whose process is gone without a finish notice counts as
 *   finished with error `interrupted`
 */

/**
 * @param {import('./events.mjs').TaskEvent[]} events
 * @returns {AgentStatus}
 */
export function agentStatusOf(events) {
  /** @type {AgentStatus} */
  const status = { running: null, last: null };
  /** @type {Map<number, any>} */
  const open = new Map();
  for (const e of events) {
    if (e.type === 'agent_started' && typeof e.pid === 'number') open.set(e.pid, e);
    if (e.type === 'agent_finished') {
      const started = typeof e.pid === 'number' ? open.get(e.pid) : undefined;
      if (typeof e.pid === 'number') open.delete(e.pid);
      status.last = {
        phase: /** @type {AgentPhase} */ (e.phase),
        exitCode: typeof e.exitCode === 'number' ? e.exitCode : null,
        timedOut: e.timedOut === true,
        error: typeof e.error === 'string' ? e.error : null,
        at: e.at,
        log: typeof started?.log === 'string' ? started.log : null,
      };
    }
  }
  for (const e of open.values()) {
    if (alive(e.pid)) status.running = { phase: e.phase, pid: e.pid, log: e.log, at: e.at };
    else if (!status.last || status.last.at < e.at) status.last = { phase: e.phase, exitCode: null, timedOut: false, error: 'interrupted', at: e.at, log: e.log };
  }
  return status;
}

/**
 * Start a headless run for a curation task. Refuses when a run of the task is still going.
 * The finish notice is recorded when the process exits (or is stopped at the time limit).
 * @param {{ home: string, taskId: string, phase: AgentPhase, worktree: string, pluginRoot: string, timeoutMs?: number, onExit?: () => void, log?: (line: string) => void }} options
 * @returns {Promise<{ pid: number | null, log: string, error: string | null }>}
 */
export async function startAgent({ home, taskId, phase, worktree, pluginRoot, timeoutMs = AGENT_TIMEOUT_MS, onExit = () => {}, log = () => {} }) {
  const paths = taskPaths(home, taskId);
  if (agentStatusOf(await readEvents(paths.events)).running) {
    throw new HeirloomError('E_CONFLICT', '이 작업의 헤드리스 실행이 아직 진행 중임');
  }
  const { agent } = (await loadUserConfig(home)).curation;
  const run = agentInvocation({ agent, phase, taskId, worktree, taskDir: paths.dir, pluginRoot, home });
  for (const file of run.files) await writeFile(file.path, file.content, { mode: 0o600 });
  const logFile = paths.agentLog(phase);
  /** Log size before this run, so a failure text of an earlier run is not taken for this one. */
  let logStart = 0;
  try {
    logStart = (await readFile(logFile)).length;
  } catch {
    // no log yet
  }
  const fd = openSync(logFile, 'a', 0o600);
  /** @type {import('node:child_process').ChildProcess} */
  let child;
  try {
    child = spawn(run.command, run.args, {
      cwd: worktree,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, HEIRLOOM_HOME: home },
    });
  } finally {
    closeSync(fd);
  }

  /** @param {Record<string, unknown>} fields */
  const finish = (fields) =>
    appendEvent(paths.events, { type: 'agent_finished', phase, ...fields })
      .catch((err) => log(`agent_finished 기록 실패 ${taskId}: ${err instanceof Error ? err.message : String(err)}`))
      .finally(onExit);

  if (child.pid === undefined) {
    const error = await new Promise((resolve) => child.once('error', (err) => resolve(/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT' ? 'command_missing' : err.message)));
    await finish({ exitCode: null, error });
    return { pid: null, log: logFile, error: /** @type {string} */ (error) };
  }
  const pid = child.pid;
  await appendEvent(paths.events, { type: 'agent_started', phase, pid, log: logFile });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }, timeoutMs);
  timer.unref();
  child.once('exit', async (code) => {
    clearTimeout(timer);
    let error = null;
    if (run.failures.length > 0) {
      try {
        const text = (await readFile(logFile)).subarray(logStart).toString('utf8');
        error = run.failures.find((f) => text.includes(f.text))?.error ?? null;
      } catch {
        // no log
      }
    }
    void finish({ pid, exitCode: code, ...(timedOut ? { timedOut: true } : {}), ...(error ? { error } : {}) });
  });
  child.unref();
  return { pid, log: logFile, error: null };
}
