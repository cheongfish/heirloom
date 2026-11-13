// Cursor CLI (`agent`): hook input/output and transcript lines.
//
// Hooks come from `.cursor-plugin/plugin.json` → `hooks/hooks-cursor.json` (Cursor's own format,
// separate from the Claude Code hooks file). Cursor runs a hook with the plugin root as its
// working directory and gives no cwd; the workspace is in `workspace_roots`. The CLI runs
// `sessionStart` and `sessionEnd` but no `stop` hook, so there is no reminder at stop; the
// convention comes from the always-applied rule and the sessionStart context.
//
// `transcript_path` is empty at sessionStart. The agent's shell has `CURSOR_CONVERSATION_ID` and
// `AGENT_TRANSCRIPTS`, so a script the agent runs knows its own transcript exactly
// (`transcriptFromEnv`).
//
// Transcript lines are `{ role, message: { content: [...] } }`. What the person typed is the
// text inside `<user_query>` of a user line, after a `<timestamp>`.

/** @typedef {import('./index.mjs').HookInput} HookInput */
/** @typedef {import('./index.mjs').TranscriptCall} TranscriptCall */

import path from 'node:path';

export const name = 'cursor';

/**
 * @param {Record<string, unknown>} raw
 * @returns {HookInput}
 */
export function readHookInput(raw) {
  const workspaces = Array.isArray(raw.workspace_roots) ? raw.workspace_roots.filter((p) => typeof p === 'string') : [];
  const status = raw.status;
  return {
    cwd: workspaces[0],
    workspaces,
    transcriptPath: typeof raw.transcript_path === 'string' && raw.transcript_path ? raw.transcript_path : undefined,
    // A stop follow-up runs as a new turn with loop_count > 0.
    continuation: typeof raw.loop_count === 'number' && raw.loop_count > 0,
    normalStop: status === undefined || status === 'completed',
  };
}

/** @param {string} text */
export function sessionStartOutput(text) {
  return { additional_context: text };
}

/** @param {string} message */
export function stopOutput(message) {
  return { followup_message: message };
}

/** Nothing to say: an empty object. */
export const emptyOutput = Object.freeze({});

const READ_TOOLS = new Set(['Read', 'ReadFile', 'read_file']);
const SHELL_TOOLS = new Set(['Shell', 'run_terminal_cmd', 'Bash']);

/**
 * @param {any} entry
 * @returns {TranscriptCall[]}
 */
export function transcriptCalls(entry) {
  if (entry?.role !== 'assistant' || !Array.isArray(entry.message?.content)) return [];
  /** @type {TranscriptCall[]} */
  const calls = [];
  for (const part of entry.message.content) {
    if (part?.type !== 'tool_use' || !part.input || typeof part.input !== 'object') continue;
    if (READ_TOOLS.has(part.name)) {
      const file = [part.input.path, part.input.file_path, part.input.target_file].find((v) => typeof v === 'string');
      if (file) calls.push({ read: file });
    } else if (SHELL_TOOLS.has(part.name) && typeof part.input.command === 'string') {
      const dir = part.input.working_directory ?? part.input.cwd;
      calls.push({ text: `${part.input.command}${typeof dir === 'string' ? ` workdir:${JSON.stringify(dir)}` : ''}` });
    }
  }
  return calls;
}

const USER_QUERY = /<user_query>\n?([\s\S]*?)\n?<\/user_query>/g;

/**
 * @param {any} entry
 * @returns {string[]}
 */
export function transcriptUtterances(entry) {
  if (entry?.role !== 'user' || !Array.isArray(entry.message?.content)) return [];
  return entry.message.content
    .filter((/** @type {any} */ p) => p?.type === 'text' && typeof p.text === 'string')
    .flatMap((/** @type {any} */ p) => [...p.text.matchAll(USER_QUERY)].map((m) => m[1]))
    .filter((/** @type {string} */ text) => text.trim());
}

/** An id the host gives is one path segment; anything else is not trusted as one. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * The transcript of the session a script runs in, from the agent shell's environment.
 * @param {Record<string, string | undefined>} env
 * @returns {string | null}
 */
export function transcriptFromEnv(env) {
  const id = env.CURSOR_CONVERSATION_ID;
  const dir = env.AGENT_TRANSCRIPTS;
  if (!id || !dir || !SEGMENT.test(id) || !path.isAbsolute(dir)) return null;
  return path.join(dir, id, `${id}.jsonl`);
}
