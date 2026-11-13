// PreToolUse hook of the Codex headless curation profile, given to `codex exec` for one run.
// Usage: hook-allowlist.mjs <policy file>
//
// The policy file ({ commands: [whole-line patterns], writes: [absolute files] }) is written by
// the dashboard before the run. Shell commands must match a pattern; file patches may touch
// only the listed files; other tools pass. Anything unreadable denies, so a broken policy never
// widens the run. A denial is printed as Codex's `permissionDecision: "deny"`; an allowed call
// prints nothing.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { commandAllowed } from '../lib/agent-runner.mjs';
import { readStdinJson } from '../lib/hook-io.mjs';

/** Tools that run a shell command (`tool_input.command`). */
const SHELL_TOOLS = new Set(['Bash', 'shell', 'exec_command', 'local_shell', 'container.exec']);
/** Tools that write files with a patch (`tool_input.command` is the patch text). */
const PATCH_TOOLS = new Set(['apply_patch', 'Edit', 'Write']);

/** @param {string} reason */
function deny(reason) {
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Heirloom: ${reason}` } })}\n`);
}

/**
 * Files a patch adds, updates, deletes or moves to.
 * @param {string} patch
 */
function patchedFiles(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((m) => m[1].trim());
}

const input = /** @type {any} */ (await readStdinJson());
const tool = String(input.tool_name ?? '');
const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : Array.isArray(input.tool_input?.command) ? input.tool_input.command.join(' ') : '';

if (SHELL_TOOLS.has(tool) || PATCH_TOOLS.has(tool)) {
  /** @type {{ commands: string[], writes: string[] } | null} */
  let policy = null;
  try {
    const raw = JSON.parse(await readFile(String(process.argv[2]), 'utf8'));
    if (Array.isArray(raw.commands) && Array.isArray(raw.writes)) policy = raw;
  } catch {
    // denied below
  }
  if (!policy) {
    deny('이 실행의 허용 목록을 읽지 못해 모든 명령과 파일 쓰기를 거부함');
  } else if (SHELL_TOOLS.has(tool)) {
    if (!commandAllowed(policy.commands, command)) {
      deny(`허용되지 않은 명령: ${command}. 스킬이 적은 명령을 하나씩, ;·&&·|·리다이렉트 없이 실행한다. 읽기는 cat·head·grep·ls만 쓸 수 있다.`);
    }
  } else {
    const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
    const files = patchedFiles(command).map((f) => path.resolve(cwd, f));
    const outside = files.filter((f) => !policy?.writes.includes(f));
    if (files.length === 0) deny('파일을 알 수 없는 패치');
    else if (outside.length > 0) deny(`이 실행에서 쓸 수 없는 파일: ${outside.join(', ')}. 쓸 수 있는 파일: ${policy.writes.join(', ')}`);
  }
}
