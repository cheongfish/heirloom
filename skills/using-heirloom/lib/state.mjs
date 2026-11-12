// Source and material state hashing. A state is the content of the task's changes, not a
// commit id: committing the same content keeps the state.

import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { changedFiles, git, gitBytes, tryGit } from './git.mjs';
import { REPO_DIR } from './paths.mjs';

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

/**
 * Source state of a commit relative to the merge-base, computed from git objects only.
 * Produces the same hash as computeSourceState for a clean working tree at that commit,
 * so a review that covered `commit` can be compared with the current state.
 * @param {{ root: string, mergeBase: string, commit: string }} options
 * @returns {Promise<{ hash: string, files: FileState[] }>}
 */
export async function computeCommitState({ root, mergeBase, commit }) {
  const resolved = await tryGit(['rev-parse', '--verify', '-q', `${commit}^{commit}`], { cwd: root });
  if (!resolved) throw new HeirloomError('E_INPUT', `커밋을 찾을 수 없음: ${commit}`);
  const diff = (await git(['diff', '--name-status', '-z', '--no-renames', mergeBase, resolved, '--'], { cwd: root })).split('\0');
  /** @type {FileState[]} */
  const files = [];
  for (let i = 0; i + 1 < diff.length; i += 2) {
    const letter = diff[i];
    const file = diff[i + 1];
    if (!letter || !file || file.startsWith(`${REPO_DIR}/`)) continue;
    if (letter === 'D') {
      files.push({ path: file, status: 'D', sha256: 'deleted' });
      continue;
    }
    const entry = (await git(['ls-tree', '-z', resolved, '--', file], { cwd: root })).split('\0')[0];
    const [meta] = entry.split('\t');
    const [mode, , object] = meta.split(' ');
    let digest;
    if (mode === '160000') digest = sha256('directory');
    else {
      const bytes = await gitBytes(['cat-file', 'blob', object], { cwd: root });
      digest = mode === '120000' ? sha256(`symlink\0${bytes.toString('utf8')}`) : sha256(bytes);
    }
    files.push({ path: file, status: letter === 'A' ? 'A' : 'M', sha256: digest });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { hash: hashEntries(files), files };
}

/**
 * Source state against the merge-base as it is now. After a rebase or merge of the target
 * branch the frozen merge-base is no longer the task's base; the task's own changes are
 * what counts. Falls back to the frozen merge-base when the ref is gone.
 * @param {{ root: string, base: { ref: string, mergeBase: string } }} options
 * @returns {Promise<{ mergeBase: string, hash: string, files: FileState[] }>}
 */
export async function currentSourceState({ root, base }) {
  const mergeBase = (await tryGit(['merge-base', base.ref, 'HEAD'], { cwd: root })) ?? base.mergeBase;
  return { mergeBase, ...(await computeSourceState({ root, mergeBase })) };
}
