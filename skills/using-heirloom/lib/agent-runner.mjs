// Headless agent runs for context curation, started only by the dashboard server after the
// user chose to. The command comes from the user config, never from a request; the prompt
// is fixed text naming the task, the worktree and the skill to follow; the allowed tools
// are limited per phase. Runs are not retried automatically.

import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';

import { loadUserConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { appendEvent, readEvents } from './events.mjs';
import { taskPaths } from './paths.mjs';

/** @typedef {'curate' | 'apply'} AgentPhase */
/** @typedef {{ host: 'claude-code', command: string, model: string | null }} AgentConfig */

export const AGENT_TIMEOUT_MS = 30 * 60_000;

/**
 * Permission rule for one absolute file (Claude Code writes absolute paths as `//path`).
 * @param {string} file
 */
const absolute = (file) => `/${file.split(path.sep).join('/')}`;

/**
 * Command, arguments and prompt of one headless run.
 * @param {{ agent: AgentConfig, phase: AgentPhase, taskId: string, worktree: string, taskDir: string, pluginRoot: string }} options
 */
export function agentInvocation({ agent, phase, taskId, worktree, taskDir, pluginRoot }) {
  if (agent.host !== 'claude-code') throw new HeirloomError('E_INPUT', `지원하지 않는 헤드리스 실행 프로필: ${agent.host}`);
  const skills = path.join(pluginRoot, 'skills');
  const read = ['Read', 'Grep', 'Glob'];
  const draft = path.join(taskDir, 'draft.json');
  const body = path.join(taskDir, 'pr-body.md');
  /** @type {string[]} */
  let tools;
  /** @type {string} */
  let prompt;
  if (phase === 'curate') {
    tools = [
      ...read,
      // Claude Code checks every file write against Edit(...) rules; a Write(...) rule is ignored.
      `Edit(${absolute(draft)})`,
      `Bash(node ${path.join(skills, 'curate-decisions', 'scripts')}/*)`,
      `Bash(node ${path.join(skills, 'prepare-handoff', 'scripts', 'submit-draft.mjs')} *)`,
    ];
    prompt = [
      `Heirloom context curation, task ${taskId}.`,
      `The current directory is its dedicated worktree: ${worktree}`,
      `Read ${path.join(skills, 'curate-decisions', 'SKILL.md')} and follow it exactly.`,
      `Write the draft only to ${draft}, submit it, and stop. Do not change any other file.`,
      'Nobody can answer questions during this run: when the skill says to ask the user, stop and report instead.',
    ].join('\n');
  } else {
    tools = [
      ...read,
      `Edit(${absolute(body)})`,
      `Bash(node ${path.join(skills, 'apply-approval', 'scripts')}/*)`,
      'Bash(git status *)',
      'Bash(git add .heirloom*)',
      'Bash(git commit *)',
      'Bash(git push *)',
      'Bash(gh pr create *)',
      // PR bodies are updated through the REST API: `gh pr edit` fails on some gh versions.
      'Bash(gh api -X PATCH repos/*/pulls/*)',
    ];
    prompt = [
      `Heirloom context curation, task ${taskId}: the human approved it in the dashboard.`,
      `The current directory is its dedicated worktree: ${worktree}`,
      `Read ${path.join(skills, 'apply-approval', 'SKILL.md')} and follow it for task ${taskId}: apply, commit the record files, push, open the pull request and record it with complete.mjs.`,
      `Write the pull request body to ${body}.`,
      'Nobody can answer questions during this run: when the skill says to ask the user, stop and report instead.',
    ].join('\n');
  }
  const args = ['-p', prompt, '--allowedTools', tools.join(','), '--add-dir', taskDir, '--add-dir', pluginRoot];
  if (agent.model) args.push('--model', agent.model);
  return { command: agent.command, args, prompt, tools };
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
  const run = agentInvocation({ agent, phase, taskId, worktree, taskDir: paths.dir, pluginRoot });
  const logFile = paths.agentLog(phase);
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
  child.once('exit', (code) => {
    clearTimeout(timer);
    void finish({ pid, exitCode: code, ...(timedOut ? { timedOut: true } : {}) });
  });
  child.unref();
  return { pid, log: logFile, error: null };
}
