// Which host the user works in, per repository: the SessionStart hook records the host of each
// session in the worktree's index entry, and a context curation runs with the host of the
// repository's latest session. Without a recorded session it uses the user config.

import path from 'node:path';

import { AGENT_COMMANDS, loadUserConfig } from './config.mjs';
import { repoInfo } from './git.mjs';
import { readIds } from './ids.mjs';
import { readIndex, updateIndex } from './store.mjs';

/** @typedef {import('./agent-runner.mjs').AgentHost} AgentHost */

const HOSTS = /** @type {const} */ (['claude-code', 'codex', 'antigravity']);

/**
 * The host of a session from its SessionStart hook. Antigravity's hooks file names it. Codex
 * and Claude Code share one hooks file, so they are told apart by the transcript: Codex writes
 * `rollout-*.jsonl` files, Claude Code keeps sessions under a `projects` directory. Null when
 * it cannot be told.
 * @param {string | undefined} name host named on the hook's command line
 * @param {Record<string, unknown>} raw hook input
 * @returns {AgentHost | null}
 */
export function sessionHostOf(name, raw) {
  if (name) return HOSTS.includes(/** @type {AgentHost} */ (name)) ? /** @type {AgentHost} */ (name) : null;
  const transcript = typeof raw.transcript_path === 'string' ? raw.transcript_path : '';
  if (!transcript) return null;
  if (path.basename(transcript).startsWith('rollout-')) return 'codex';
  if (transcript.split(/[\\/]/).includes('projects')) return 'claude-code';
  return null;
}

/**
 * Record the session's host on the worktree's index entry. Only for checkouts Heirloom already
 * knows: a session start never creates ids.
 * @param {{ home: string, cwd: string, host: AgentHost, now?: Date }} options
 */
export async function recordSessionHost({ home, cwd, host, now = new Date() }) {
  let ids;
  try {
    ids = await readIds(await repoInfo(cwd), home);
  } catch {
    return;
  }
  if (!ids) return;
  const worktreeId = ids.worktreeId;
  await updateIndex(home, async (index) => {
    const entry = index.worktrees[worktreeId];
    if (entry) index.worktrees[worktreeId] = { ...entry, host, hostAt: now.toISOString() };
  });
}

/**
 * The headless agent for a curation of the repository: the host of its latest session, else
 * the configured one. The configured command and model apply only to the configured host;
 * another host runs its default command.
 * @param {{ home: string, repoId: string }} options
 * @returns {Promise<import('./agent-runner.mjs').AgentConfig & { source: 'session' | 'config' }>}
 */
export async function curationAgent({ home, repoId }) {
  const configured = (await loadUserConfig(home)).curation.agent;
  const index = await readIndex(home);
  /** @type {{ host: string, at: string } | null} */
  let latest = null;
  for (const entry of Object.values(index.worktrees)) {
    if (entry.repoId !== repoId || entry.managed || !entry.host || !entry.hostAt) continue;
    if (!latest || entry.hostAt > latest.at) latest = { host: entry.host, at: entry.hostAt };
  }
  if (!latest) return { ...configured, source: 'config' };
  const host = /** @type {AgentHost} */ (latest.host);
  if (host === configured.host) return { ...configured, source: 'session' };
  return { host, command: AGENT_COMMANDS[host], model: null, source: 'session' };
}
