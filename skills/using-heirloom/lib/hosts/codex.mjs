// Codex: hook input/output and transcript (rollout) lines.
//
// Codex hooks take the same input fields and the same output format as Claude Code
// (`hookSpecificOutput.additionalContext`, `decision: "block"`, `stop_hook_active`), so the
// plugin shares hooks/hooks.json with Claude Code. The transcript differs: Codex has no file
// reading tool. Files are read with shell commands, recorded as text, often inside the
// JavaScript `exec` tool (`tools.exec_command({cmd:"cat …",workdir:"…"})`).

import * as claude from './claude-code.mjs';

/** @typedef {import('./index.mjs').TranscriptCall} TranscriptCall */

export const name = 'codex';
export const readHookInput = claude.readHookInput;
export const sessionStartOutput = claude.sessionStartOutput;
export const stopOutput = claude.stopOutput;
export const emptyOutput = claude.emptyOutput;

/** Tools that run shell commands. Messages, subagent and wait tools are not reads. */
const SHELL_TOOLS = new Set(['exec', 'exec_command', 'shell', 'shell_command', 'container.exec']);

/**
 * A rollout line (`{ type: 'response_item', payload: {...} }`): the text of shell calls.
 * @param {any} entry
 * @returns {TranscriptCall[]}
 */
export function transcriptCalls(entry) {
  if (entry?.type !== 'response_item') return [];
  const item = entry.payload;
  if (item?.type === 'custom_tool_call' && SHELL_TOOLS.has(item.name) && typeof item.input === 'string') return [{ text: item.input }];
  if (item?.type === 'function_call' && SHELL_TOOLS.has(item.name) && typeof item.arguments === 'string') return [{ text: item.arguments }];
  if (item?.type === 'local_shell_call' && Array.isArray(item.action?.command)) {
    const command = item.action.command.filter((/** @type {unknown} */ part) => typeof part === 'string').join(' ');
    const workdir = typeof item.action.working_directory === 'string' ? ` workdir:${JSON.stringify(item.action.working_directory)}` : '';
    return [{ text: `${command}${workdir}` }];
  }
  return [];
}
