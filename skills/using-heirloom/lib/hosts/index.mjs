// Host adapters. The hook logic (when to remind, what to inject) is host-neutral; an adapter
// only reads a host's hook input, writes its hook output and reads its transcript lines (tool
// calls, and the messages the person typed).
//
// A host's hooks file names the host after the hook name (`run-hook.cmd stop <host>`). Codex
// shares the Claude Code hooks file, so its hooks run without a name; that works because the
// two take the same input and output. Antigravity and Cursor have their own hooks files and
// name themselves.
// Transcript lines are recognized by their shape, so a transcript is read the same way
// whichever hooks file ran.

import * as antigravity from './antigravity.mjs';
import * as claudeCode from './claude-code.mjs';
import * as codex from './codex.mjs';
import * as cursor from './cursor.mjs';

/**
 * @typedef {object} HookInput
 * @property {string | undefined} cwd
 * @property {string[]} workspaces the other folders of the session, in the host's order. A host
 *   may report a folder that is not the repository as cwd (Antigravity puts a folder added with
 *   `--add-dir` first); the hooks then use the first of these that is a git repository.
 * @property {string | undefined} transcriptPath the host's session transcript, when it gives one
 * @property {boolean} continuation true while the agent is already continuing because a Stop hook asked
 * @property {boolean} normalStop false when the host says the turn ended by an interrupt, an error,
 *   a limit or with work still running; then the Stop hook does not remind
 */

/**
 * One tool call from a transcript: a file the host's read tool opened, or the text of a shell
 * command that may name files.
 * @typedef {{ read: string, text?: undefined } | { text: string, read?: undefined }} TranscriptCall
 */

/**
 * @typedef {object} HostAdapter
 * @property {string} name
 * @property {(raw: Record<string, unknown>) => HookInput} readHookInput
 * @property {(text: string) => unknown} sessionStartOutput
 * @property {(message: string) => unknown} stopOutput
 * @property {unknown} emptyOutput what to print when there is nothing to say (null: print nothing)
 * @property {(entry: unknown) => TranscriptCall[]} transcriptCalls
 * @property {(entry: unknown) => string[]} transcriptUtterances what the person typed, without
 *   the text the harness adds as the user
 * @property {(env: Record<string, string | undefined>) => string | null} [transcriptFromEnv] the
 *   transcript of the session a script runs in, when the host puts it in the agent's environment
 */

/** @type {Record<string, HostAdapter>} */
const ADAPTERS = { 'claude-code': claudeCode, codex, antigravity, cursor };

export const HOSTS = Object.freeze(Object.keys(ADAPTERS));

/**
 * @param {string | undefined} name empty or missing means Claude Code
 * @returns {HostAdapter}
 */
export function hostAdapter(name) {
  if (!name) return claudeCode;
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`알 수 없는 호스트: ${name}`);
  return adapter;
}

/**
 * The tool calls in one parsed transcript line, whichever host wrote it.
 * @param {unknown} entry
 * @returns {TranscriptCall[]}
 */
export function transcriptCalls(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return Object.values(ADAPTERS).flatMap((adapter) => adapter.transcriptCalls(entry));
}

/**
 * The messages the person typed in one parsed transcript line, whichever host wrote it.
 * @param {unknown} entry
 * @returns {string[]}
 */
export function transcriptUtterances(entry) {
  if (!entry || typeof entry !== 'object') return [];
  return Object.values(ADAPTERS).flatMap((adapter) => adapter.transcriptUtterances(entry));
}

/**
 * The transcript of the session a script runs in, when the host names it in the environment
 * (Cursor). Null otherwise; the hooks' session records are used then.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function transcriptFromEnv(env) {
  for (const adapter of Object.values(ADAPTERS)) {
    const found = adapter.transcriptFromEnv?.(env);
    if (found) return found;
  }
  return null;
}
