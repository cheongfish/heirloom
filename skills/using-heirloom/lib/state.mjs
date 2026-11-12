// Source and material state hashing. See docs/HEIRLOOM-PLAN.md section 5.2 and
// docs/HEIRLOOM-MVP-PLAN.md section 7.3.

import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { changedFiles } from './git.mjs';

/** @typedef {{ path: string, status: 'A' | 'M' | 'D', sha256: string }} FileState */

/**
 * Hash of the file list: `path\0status\0sha256\n` sorted by path.
 * @param {FileState[]} files
 * @returns {string} "sha256:<hex>"
 */
export function hashEntries(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = createHash('sha256');
  for (const f of sorted) h.update(`${f.path}\0${f.status}\0${f.sha256}\n`);
  return `sha256:${h.digest('hex')}`;
}

/** @param {string | Uint8Array} data */
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Content hash of one working-tree entry. Raw bytes for files, the link target for
 * symlinks, and a marker for directories (submodules). Null when the entry is gone.
 * @param {string} abs
 * @returns {Promise<string | null>}
 */
async function hashEntry(abs) {
  let info;
  try {
    info = await lstat(abs);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  if (info.isSymbolicLink()) return sha256(`symlink\0${await readlink(abs)}`);
  if (info.isDirectory()) return sha256('directory');
  return sha256(await readFile(abs));
}

/**
 * @param {{ root: string, mergeBase: string }} options
 * @returns {Promise<{ hash: string, files: FileState[] }>}
 */
export async function computeSourceState({ root, mergeBase }) {
  /** @type {FileState[]} */
  const files = [];
  for (const file of await changedFiles({ root, mergeBase })) {
    const digest = file.status === 'D' ? null : await hashEntry(path.join(root, file.path));
    files.push(digest === null ? { path: file.path, status: 'D', sha256: 'deleted' } : { ...file, sha256: digest });
  }
  return { hash: hashEntries(files), files };
}

/**
 * Hash of a material (spec, design, review...) given relative to the repository root
 * or as an absolute path.
 * @param {string} root
 * @param {string} ref
 * @returns {Promise<string>} hex sha256
 */
export async function hashMaterial(root, ref) {
  const abs = path.resolve(root, ref);
  try {
    return sha256(await readFile(abs));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      throw new HeirloomError('E_INPUT', `자료 파일을 찾을 수 없음: ${ref}`, { cause: err });
    }
    throw err;
  }
}
