// Specs the current Claude Code session read, from the transcript the Stop hook receives
// (`transcript_path`, JSON lines). A spec that is already on the target branch does not show up
// in the branch's changes, so this is the only trace that the work followed it.
//
// The transcript format belongs to Claude Code and may change: anything unreadable counts as
// "no spec read", which keeps the reminder as it was without the transcript.

import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { matchesAny } from './glob.mjs';

/** Transcripts are read from the end up to this size; older reads of a long session are skipped. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Repository-relative paths of files the session opened with the Read tool that match `globs`.
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
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== 'tool_use' || part.name !== 'Read' || typeof part.input?.file_path !== 'string') continue;
      const rel = relativeTo(roots, part.input.file_path);
      if (rel && matchesAny(rel, globs)) found.add(rel);
    }
  }
  return [...found].sort();
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
