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
