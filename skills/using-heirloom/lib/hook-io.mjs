// Hook stdin/stdout helpers.

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { tryGit } from './git.mjs';
import { hostAdapter } from './hosts/index.mjs';

/**
 * The folder the hook works in: the hook's cwd when it is inside a git repository, else the
 * first of the session's other folders that is, else the cwd as given. Antigravity reports a
 * folder added with `--add-dir` as cwd when it comes first, which would hide the repository.
 * @param {import('./hosts/index.mjs').HookInput} input
 */
export async function hookCwd(input) {
  const first = input.cwd ?? process.cwd();
  for (const dir of [...new Set([first, ...input.workspaces])]) {
    if (await tryGit(['rev-parse', '--show-toplevel'], { cwd: dir })) return dir;
  }
  return first;
}

/**
 * Read the hook input JSON from stdin. Returns {} for a TTY, empty or invalid input,
 * or when nothing arrives within `timeoutMs`.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStdinJson({ timeoutMs = 1000 } = {}) {
  if (process.stdin.isTTY) return {};
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  await Promise.race([
    new Promise((resolve) => {
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.once('end', resolve);
      process.stdin.once('error', resolve);
    }),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  process.stdin.destroy();
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** @param {unknown} value */
export function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Development aid: with HEIRLOOM_HOOK_LOG=1, append what a hook received and printed to
 * `<home>/hook-log.jsonl`. It shows the input each host really sends. Never throws.
 * @param {{ home: string, hook: string, host: string, input: unknown, output: unknown }} entry
 */
export async function logHook({ home, hook, host, input, output }) {
  if (process.env.HEIRLOOM_HOOK_LOG !== '1') return;
  try {
    await mkdir(home, { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), hook, host, input, output: output ?? null });
    await appendFile(path.join(home, 'hook-log.jsonl'), `${line}\n`);
  } catch (err) {
    process.stderr.write(`heirloom hook log: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * The host named on the hook's command line; Claude Code when missing or unknown (with a note
 * on stderr, since an unknown name is a packaging mistake and the hook must still not fail).
 * @param {string | undefined} name
 */
export function hookHost(name) {
  try {
    return hostAdapter(name);
  } catch (err) {
    process.stderr.write(`heirloom hook: ${err instanceof Error ? err.message : String(err)}, Claude Code 형식으로 처리\n`);
    return hostAdapter(undefined);
  }
}
