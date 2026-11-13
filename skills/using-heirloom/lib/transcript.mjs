// Specs the current session read, from the transcript the Stop hook receives (JSON lines).
// A spec that is already on the target branch does not show up in the branch's changes, so
// this is the only trace that the work followed it.
//
// Claude Code and Antigravity record file reads as read tool calls with a path. Codex has no
// read tool: a spec counts as read when a shell command names it (absolute, or relative to the
// command's working directory or the repository root) and the file exists. Shell commands in
// an Antigravity transcript are read the same way. A path in a command is a
// strong hint, not proof; it only decides whether to remind about handing off.
//
// Transcript formats belong to the hosts and may change: anything unreadable counts as
// "no spec read", which keeps the reminder as it was without the transcript.

import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { matchesAny } from './glob.mjs';
import { transcriptCalls } from './hosts/index.mjs';

/** Transcripts are read from the end up to this size; older reads of a long session are skipped. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Repository-relative paths of spec files (matching `globs`) the session read.
 * @param {{ transcriptPath: string | undefined, root: string, globs: string[], maxBytes?: number }} options
 * @returns {Promise<string[]>}
 */
export async function specsReadInTranscript({ transcriptPath, root, globs, maxBytes = MAX_BYTES }) {
  if (!transcriptPath) return [];
  let text;
  try {
    const size = (await stat(transcriptPath)).size;
    const start = Math.max(0, size - maxBytes);
    const handle = await open(transcriptPath, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      text = buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
  const roots = [root];
  try {
    const real = await realpath(root);
    if (real !== root) roots.push(real);
  } catch {
    // keep the given root
  }
  /** @type {Set<string>} */
  const found = new Set();
  /** @type {Map<string, Promise<boolean>>} */
  const exists = new Map();
  const isFile = (/** @type {string} */ rel) => {
    let result = exists.get(rel);
    if (!result) {
      result = stat(path.join(root, rel)).then((s) => s.isFile(), () => false);
      exists.set(rel, result);
    }
    return result;
  };
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"response_item"') && !line.includes('"tool_calls"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    for (const call of transcriptCalls(entry)) {
      if (call.read !== undefined) {
        const rel = relativeTo(roots, call.read);
        if (rel && matchesAny(rel, globs)) found.add(rel);
        continue;
      }
      for (const rel of pathsInCommand(call.text, roots)) {
        if (!found.has(rel) && matchesAny(rel, globs) && (await isFile(rel))) found.add(rel);
      }
    }
  }
  return [...found].sort();
}

/** Characters that separate words in a shell command or the code around it. */
const SEPARATORS = /[\s"'`(),;{}[\]<>|&=]+/;

/**
 * Repository-relative paths that a shell command (or the tool-call text around it) names.
 * Relative words are resolved against each `workdir` the text gives and against the root.
 * @param {string} text
 * @param {string[]} roots the repository root as given and as resolved
 * @returns {Set<string>}
 */
export function pathsInCommand(text, roots) {
  const plain = text.replace(/\\"/g, '"').replace(/\\[nt]/g, ' ');
  const workdirs = [...plain.matchAll(/workdir"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]).filter((dir) => path.isAbsolute(dir));
  const bases = [...workdirs, roots[0]];
  /** @type {Set<string>} */
  const paths = new Set();
  for (const word of plain.split(SEPARATORS)) {
    if (!word || /[*?]/.test(word) || word.startsWith('-') || !/[\w.]/.test(word)) continue;
    const candidates = path.isAbsolute(word) ? [word] : bases.map((base) => path.resolve(base, word));
    for (const file of candidates) {
      const rel = relativeTo(roots, file);
      if (rel) paths.add(rel);
    }
  }
  return paths;
}

/**
 * @param {string[]} roots the repository root as given and as resolved
 * @param {string} file
 */
function relativeTo(roots, file) {
  if (!path.isAbsolute(file)) return null;
  for (const root of roots) {
    const rel = path.relative(root, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).join('/');
  }
  return null;
}
