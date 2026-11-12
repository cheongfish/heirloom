// Open a URL in the user's browser. Never throws: on failure the caller
// prints the URL instead.

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';

/**
 * @param {{ platform?: NodeJS.Platform, env?: Record<string, string | undefined>, release?: string }} [options]
 */
export function isWsl({ platform = process.platform, env = process.env, release = os.release() } = {}) {
  if (platform !== 'linux') return false;
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP) || /microsoft/i.test(release);
}

/**
 * Candidate commands, tried in order.
 * @param {string} url
 * @param {{ platform?: NodeJS.Platform, wsl?: boolean }} [options]
 * @returns {string[][]}
 */
export function browserCommands(url, { platform = process.platform, wsl = isWsl() } = {}) {
  // `start` treats its first quoted argument as the window title, hence the empty "".
  if (platform === 'win32') return [['cmd', '/c', 'start', '""', url]];
  if (platform === 'darwin') return [['open', url]];
  if (wsl) return [['wslview', url], ['cmd.exe', '/c', 'start', '""', url]];
  return [['xdg-open', url]];
}

/**
 * Run one command and wait for it to exit (at most `timeoutMs`; a launcher that keeps
 * running is treated as success).
 * @param {string[]} command
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runCommand([file, ...args], { timeoutMs = 5000 } = {}) {
  // cmd.exe warns about UNC working directories when started from a WSL path.
  const cwd = file === 'cmd.exe' && (await access('/mnt/c').then(() => true, () => false)) ? '/mnt/c' : undefined;
  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(file, args, { cwd, stdio: 'ignore', detached: process.platform !== 'win32', windowsVerbatimArguments: file === 'cmd' });
    } catch (err) {
      resolve({ ok: false, reason: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      resolve({ ok: true });
    }, timeoutMs);
    child.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: /** @type {NodeJS.ErrnoException} */ (err).code ?? err.message });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, reason: `exit ${code}` });
    });
  });
}

/**
 * @param {string} url
 * @param {{ commands?: string[][], run?: (command: string[]) => Promise<{ ok: boolean, reason?: string }> }} [options]
 * @returns {Promise<{ opened: true, command: string } | { opened: false, reason: string }>}
 */
export async function openBrowser(url, { commands = browserCommands(url), run = runCommand } = {}) {
  /** @type {string[]} */
  const failures = [];
  for (const command of commands) {
    const result = await run(command);
    if (result.ok) return { opened: true, command: command[0] };
    failures.push(`${command[0]}: ${result.reason ?? 'failed'}`);
  }
  return { opened: false, reason: failures.join('; ') || 'no browser command' };
}
