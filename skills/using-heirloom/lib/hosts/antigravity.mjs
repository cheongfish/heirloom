// Antigravity: hook input/output.
//
// Hook input uses camelCase keys (`cwd`, `workspacePaths`, `transcriptPath`, and on Stop
// `continuationActive`, `terminationReason`, `fullyIdle`, `error`). A SessionStart hook injects
// context as a system message step; a Stop hook keeps the agent going with
// `decision: "continue"`. Command hooks must print a JSON object, so "nothing to say" is `{}`.
//
// Stop also runs when the user cancels, on errors and at limits. Only a normal end of the turn
// (`NO_TOOL_CALL`, nothing still running) may remind: the agent must not resume work the user
// interrupted.
//
// The transcript (`transcriptPath`, `…/brain/<conversation>/.system_generated/logs/
// transcript_full.jsonl`) is not documented. Each line is a step; a model step lists its tool
// calls as `tool_calls: [{ name, args }]`. File reads are `read_file`/`view_file` with an
// absolute path, commands are `run_command` with `CommandLine`. Anything else is ignored.
// What the person typed is a `USER_INPUT` step from `USER_EXPLICIT`, its text wrapped in
// `<USER_REQUEST>` next to harness metadata (local time, setting changes).

/** @typedef {import('./index.mjs').HookInput} HookInput */
/** @typedef {import('./index.mjs').TranscriptCall} TranscriptCall */

export const name = 'antigravity';

/**
 * @param {Record<string, unknown>} raw
 * @returns {HookInput}
 */
export function readHookInput(raw) {
  const workspace = Array.isArray(raw.workspacePaths) && typeof raw.workspacePaths[0] === 'string' ? raw.workspacePaths[0] : undefined;
  const reason = raw.terminationReason;
  const erred = typeof raw.error === 'string' && raw.error !== '';
  return {
    cwd: typeof raw.cwd === 'string' ? raw.cwd : workspace,
    transcriptPath: typeof raw.transcriptPath === 'string' ? raw.transcriptPath : undefined,
    // `continuation_active` is the name the release notes used when the field was added.
    continuation: raw.continuationActive === true || raw.continuation_active === true,
    normalStop: (reason === undefined || reason === 'NO_TOOL_CALL') && !erred && raw.fullyIdle !== false,
  };
}

/** @param {string} text */
export function sessionStartOutput(text) {
  return { injectSteps: [{ systemMessage: { systemMessage: text } }] };
}

/** @param {string} message */
export function stopOutput(message) {
  return { decision: 'continue', reason: message };
}

/** Nothing to say: an empty object. */
export const emptyOutput = Object.freeze({});

const READ_TOOLS = new Set(['read_file', 'view_file']);

/**
 * @param {any} entry
 * @returns {TranscriptCall[]}
 */
export function transcriptCalls(entry) {
  if (typeof entry?.step_index !== 'number' || !Array.isArray(entry.tool_calls)) return [];
  /** @type {TranscriptCall[]} */
  const calls = [];
  for (const call of entry.tool_calls) {
    const args = call?.args;
    if (!args || typeof args !== 'object') continue;
    if (READ_TOOLS.has(call.name)) {
      const file = [args.Path, args.AbsolutePath, args.path].find((v) => typeof v === 'string');
      if (file) calls.push({ read: file });
    } else if (call.name === 'run_command' && typeof args.CommandLine === 'string') {
      const workdir = typeof args.Cwd === 'string' ? ` workdir:${JSON.stringify(args.Cwd)}` : '';
      calls.push({ text: `${args.CommandLine}${workdir}` });
    }
  }
  return calls;
}

const USER_REQUEST = /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/g;

/**
 * The text inside `<USER_REQUEST>` of a step the person typed. Slash commands such as
 * `/compact` are commands, not messages.
 * @param {any} entry
 * @returns {string[]}
 */
export function transcriptUtterances(entry) {
  if (typeof entry?.step_index !== 'number' || entry.type !== 'USER_INPUT' || entry.source !== 'USER_EXPLICIT' || typeof entry.content !== 'string') return [];
  return [...entry.content.matchAll(USER_REQUEST)].map((m) => m[1]).filter((text) => text.trim() && !/^\/\S+\s*$/.test(text.trim()));
}
