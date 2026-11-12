// Storage locations: ~/.heirloom (HEIRLOOM_HOME) for local state, <repo>/.heirloom for records.

import { chmod, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';

/** Directory inside the consumer repository. Always excluded from state hashing. */
export const REPO_DIR = '.heirloom';

const TASK_ID = /^t-\d{8}-[0-9a-hjkmnp-tv-z]{8}$/;

/**
 * User-level storage root: $HEIRLOOM_HOME or ~/.heirloom.
 * @param {Record<string, string | undefined>} [env]
 */
export function heirloomHome(env = process.env) {
  return env.HEIRLOOM_HOME ? path.resolve(env.HEIRLOOM_HOME) : path.join(os.homedir(), '.heirloom');
}

/** @param {string} home */
export function homePaths(home) {
  return {
    home,
    index: path.join(home, 'index.json'),
    config: path.join(home, 'config.json'),
    tasks: path.join(home, 'tasks'),
    keys: path.join(home, 'keys'),
    server: path.join(home, 'server'),
    worktrees: path.join(home, 'worktrees'),
  };
}

/**
 * @param {string} home
 * @param {string} taskId
 */
export function taskPaths(home, taskId) {
  if (!TASK_ID.test(taskId)) throw new HeirloomError('E_INPUT', `올바른 작업 ID가 아님: ${JSON.stringify(taskId)}`);
  const dir = path.join(home, 'tasks', taskId);
  return {
    dir,
    input: path.join(dir, 'input.json'),
    draft: path.join(dir, 'draft.json'),
    draftInitial: path.join(dir, 'draft.initial.json'),
    check: path.join(dir, 'check.json'),
    handoff: path.join(dir, 'handoff.md'),
    approvals: path.join(dir, 'approvals'),
    events: path.join(dir, 'events.jsonl'),
    curation: path.join(dir, 'curation.json'),
    prBody: path.join(dir, 'pr-body.md'),
    /** @param {'curate' | 'apply'} phase */
    agentLog: (phase) => path.join(dir, `agent-${phase}.log`),
  };
}

/**
 * Files of one approval: the signed record and the input and draft it was given
 * (the baseline survives a new prepare).
 * @param {string} approvalsDir taskPaths().approvals
 * @param {string} approvalId
 */
export function approvalFiles(approvalsDir, approvalId) {
  return {
    record: path.join(approvalsDir, `${approvalId}.json`),
    input: path.join(approvalsDir, `${approvalId}.input.json`),
    draft: path.join(approvalsDir, `${approvalId}.draft.json`),
  };
}

/** @param {string} root consumer repository root */
export function repoPaths(root) {
  const dir = path.join(root, REPO_DIR);
  return {
    dir,
    decisions: path.join(dir, 'decisions'),
    axioms: path.join(dir, 'axioms'),
    config: path.join(dir, 'config.json'),
    curation: path.join(dir, 'curation'),
  };
}

/**
 * Create a directory (and parents). The leaf gets `mode` even if umask is looser.
 * @param {string} dir
 * @param {number} [mode]
 */
export async function ensureDir(dir, mode = 0o700) {
  await mkdir(dir, { recursive: true, mode });
  if (process.platform !== 'win32') await chmod(dir, mode);
}
