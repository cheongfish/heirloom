// Identifiers: random repository, worktree, task, approval and record ids.
// Note: ids.mjs and store.mjs import each other; both only use the other's exports at call time.

import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from './fsx.mjs';
import { PATTERNS } from './schema.mjs';
import { updateIndex } from './store.mjs';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // lowercase Crockford base32

export const ID_PATTERNS = Object.freeze({
  repo: PATTERNS.repoId,
  worktree: PATTERNS.worktreeId,
  task: PATTERNS.taskId,
  approval: PATTERNS.approvalId,
  decision: /^d-[0-9a-hjkmnp-tv-z]{8}$/,
  axiom: /^a-[0-9a-hjkmnp-tv-z]{8}$/,
});

/** @param {number} length */
export function randomBase32(length) {
  // 256 is a multiple of 32, so masking keeps the distribution uniform.
  return Array.from(randomBytes(length), (b) => ALPHABET[b & 31]).join('');
}

export const newRepoId = () => `r-${randomBase32(10)}`;
export const newWorktreeId = () => `w-${randomBase32(10)}`;
export const newApprovalId = () => `ap-${randomBase32(12)}`;

/**
 * Base32 text derived from a seed: the same seed always gives the same id.
 * @param {string} seed
 * @param {number} length at most 32
 */
export function derivedBase32(seed, length) {
  return Array.from(createHash('sha256').update(seed).digest().subarray(0, length), (b) => ALPHABET[b & 31]).join('');
}

/** @param {'decision' | 'axiom'} kind */
export const newRecordId = (kind) => `${kind === 'axiom' ? 'a' : 'd'}-${randomBase32(8)}`;

/** @param {Date} [now] */
export function newTaskId(now = new Date()) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `t-${day}-${randomBase32(8)}`;
}

/**
 * Read an id file, creating it with `make()` when missing or invalid.
 * Creation uses O_EXCL so concurrent callers agree on one id.
 * @param {string} file
 * @param {() => string} make
 * @param {RegExp} pattern
 * @returns {Promise<string>}
 */
async function readOrCreateId(file, make, pattern) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const value = (await readFile(file, 'utf8')).trim();
      if (pattern.test(value)) return value;
      await writeFileAtomic(file, `${make()}\n`, { mode: 0o644 });
      continue;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
    }
    try {
      await writeFile(file, `${make()}\n`, { flag: 'wx', mode: 0o644 });
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
    }
  }
  return (await readFile(file, 'utf8')).trim();
}

/** @param {string} p */
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Errors that mean the git directory cannot be written (read-only mount, sandbox, permissions). */
const READ_ONLY = new Set(['EROFS', 'EACCES', 'EPERM']);

/**
 * Where an id file goes when the git directory is read-only: under HEIRLOOM_HOME, keyed by
 * the git directory's real path. Such an id does not follow the repository when it moves.
 * @param {string} home
 * @param {string} gitDirectory
 * @param {string} name
 */
async function fallbackIdFile(home, gitDirectory, name) {
  let real = gitDirectory;
  try {
    real = await realpath(gitDirectory);
  } catch {
    // keep the given path
  }
  return path.join(home, 'ids', createHash('sha256').update(real).digest('hex').slice(0, 24), name);
}

/**
 * An id that lives in `<gitDirectory>/<name>`, or under HEIRLOOM_HOME when the git directory
 * cannot be written. An id already in the git directory always wins.
 * @param {string} home
 * @param {string} gitDirectory
 * @param {string} name
 * @param {() => string} make
 * @param {RegExp} pattern
 * @returns {Promise<{ value: string, file: string }>}
 */
async function idIn(home, gitDirectory, name, make, pattern) {
  const file = path.join(gitDirectory, name);
  try {
    return { value: await readOrCreateId(file, make, pattern), file };
  } catch (err) {
    if (!READ_ONLY.has(String(/** @type {NodeJS.ErrnoException} */ (err).code))) throw err;
  }
  const fallback = await fallbackIdFile(home, gitDirectory, name);
  await mkdir(path.dirname(fallback), { recursive: true, mode: 0o700 });
  return { value: await readOrCreateId(fallback, make, pattern), file: fallback };
}

/**
 * Resolve (and register) the repository and worktree ids for a checkout.
 *
 * - Repository id lives in `<commonDir>/heirloom-repo-id`, worktree id in
 *   `<gitDir>/heirloom-worktree-id`. They are separate files because the main
 *   worktree's git dir is the common dir. When the git directory is read-only (for
 *   example in a sandbox that protects `.git`), the id is kept under `<home>/ids/` instead.
 * - If the index already maps this worktree id to another path that still exists,
 *   this checkout is a copy: it gets a new worktree id (and a new repository id when
 *   the whole repository was copied). A moved worktree keeps its ids.
 *
 * @param {string} home
 * @param {{ root: string, gitDir: string, commonDir: string }} info
 * @returns {Promise<{ repoId: string, worktreeId: string }>}
 */
export async function resolveIds(home, info) {
  const repo = await idIn(home, info.commonDir, 'heirloom-repo-id', newRepoId, ID_PATTERNS.repo);
  const worktree = await idIn(home, info.gitDir, 'heirloom-worktree-id', newWorktreeId, ID_PATTERNS.worktree);
  let repoId = repo.value;
  let worktreeId = worktree.value;

  return updateIndex(home, async (index) => {
    const known = index.worktrees[worktreeId];
    if (known && known.path !== info.root && (await exists(known.path))) {
      worktreeId = newWorktreeId();
      await writeFileAtomic(worktree.file, `${worktreeId}\n`, { mode: 0o644 });
      if (info.gitDir === info.commonDir) {
        repoId = newRepoId();
        await writeFileAtomic(repo.file, `${repoId}\n`, { mode: 0o644 });
      }
    }
    const managed = index.worktrees[worktreeId]?.managed;
    index.worktrees[worktreeId] = { repoId, path: info.root, lastSeen: new Date().toISOString(), ...(managed ? { managed } : {}) };
    return { repoId, worktreeId };
  });
}

/**
 * Read existing ids without creating anything. Null when this checkout has never been
 * used with Heirloom. With `home`, ids kept under HEIRLOOM_HOME (read-only `.git`) are found too.
 * @param {{ gitDir: string, commonDir: string }} info
 * @param {string} [home]
 * @returns {Promise<{ repoId: string, worktreeId: string } | null>}
 */
export async function readIds(info, home) {
  /** @param {string} file @param {RegExp} pattern */
  const read = async (file, pattern) => {
    try {
      const value = (await readFile(file, 'utf8')).trim();
      return pattern.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  /** @param {string} dir @param {string} name @param {RegExp} pattern */
  const find = async (dir, name, pattern) => {
    const file = path.join(dir, name);
    if (await exists(file)) return read(file, pattern);
    return home ? read(await fallbackIdFile(home, dir, name), pattern) : null;
  };
  const repoId = await find(info.commonDir, 'heirloom-repo-id', ID_PATTERNS.repo);
  const worktreeId = await find(info.gitDir, 'heirloom-worktree-id', ID_PATTERNS.worktree);
  return repoId && worktreeId ? { repoId, worktreeId } : null;
}
