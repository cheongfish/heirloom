// Claude Code: hook input/output and transcript lines.

/** @typedef {import('./index.mjs').HookInput} HookInput */
/** @typedef {import('./index.mjs').TranscriptCall} TranscriptCall */

export const name = 'claude-code';

/**
 * @param {Record<string, unknown>} raw
 * @returns {HookInput}
 */
export function readHookInput(raw) {
  return {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
    workspaces: [],
    transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined,
    continuation: raw.stop_hook_active === true,
    // Claude Code runs Stop only when the agent finishes a turn, not after an interrupt.
    normalStop: true,
  };
}

/** Nothing to say: print nothing. */
export const emptyOutput = null;

/** @param {string} text */
export function sessionStartOutput(text) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

/** @param {string} message */
export function stopOutput(message) {
  return { decision: 'block', reason: message };
}

/**
 * A transcript line (`{ type: 'assistant', message: { content: [...] } }`): the files opened
 * with the Read tool. Other tools are not counted as reading.
 * @param {any} entry
 * @returns {TranscriptCall[]}
 */
export function transcriptCalls(entry) {
  const content = entry?.message?.content;
  if (!Array.isArray(content)) return [];
  /** @type {TranscriptCall[]} */
  const calls = [];
  for (const part of content) {
    if (part?.type === 'tool_use' && part.name === 'Read' && typeof part.input?.file_path === 'string') calls.push({ read: part.input.file_path });
  }
  return calls;
}

/**
 * Text the harness puts into user lines: slash command echoes, `!` shell input and output,
 * reminders, background task notifications and interrupt markers. None of it is typed by a
 * person as a message.
 */
const HARNESS_TEXT = /^(?:<(?:command-name|command-message|command-args|local-command-[a-z-]+|bash-[a-z-]+|system-reminder|task-notification)>|\[Request interrupted)/;

/**
 * A transcript line the person typed (`{ type: 'user', message: { content } }`): the text of
 * the message. Lines the harness writes as the user are skipped: `isMeta` (skill bodies),
 * `isCompactSummary`, subagent lines (`isSidechain`), lines with an `origin` (task
 * notifications), tool results and harness text.
 * @param {any} entry
 * @returns {string[]}
 */
export function transcriptUtterances(entry) {
  if (entry?.type !== 'user' || entry.isMeta || entry.isCompactSummary || entry.isSidechain) return [];
  // Newer versions mark typed messages `origin: { kind: 'human' }`; older ones have no origin.
  if (entry.origin !== undefined && entry.origin?.kind !== 'human') return [];
  const content = entry.message?.content;
  const parts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text) : [];
  return parts.filter((text) => text.trim() && !HARNESS_TEXT.test(text.trimStart()));
}
