// Identifiers. See docs/HEIRLOOM-MVP-PLAN.md section 4.
// Note: ids.mjs and store.mjs import each other; both only use the other's exports at call time.

import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
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

/**
 * Resolve (and register) the repository and worktree ids for a checkout.
 *
 * - Repository id lives in `<commonDir>/heirloom-repo-id`, worktree id in
 *   `<gitDir>/heirloom-worktree-id`. They are separate files because the main
 *   worktree's git dir is the common dir.
 * - If the index already maps this worktree id to another path that still exists,
 *   this checkout is a copy: it gets a new worktree id (and a new repository id when
 *   the whole repository was copied). A moved worktree keeps its ids.
 *
 * @param {string} home
 * @param {{ root: string, gitDir: string, commonDir: string }} info
 * @returns {Promise<{ repoId: string, worktreeId: string }>}
 */
export async function resolveIds(home, info) {
  const repoFile = path.join(info.commonDir, 'heirloom-repo-id');
  const worktreeFile = path.join(info.gitDir, 'heirloom-worktree-id');
  let repoId = await readOrCreateId(repoFile, newRepoId, ID_PATTERNS.repo);
  let worktreeId = await readOrCreateId(worktreeFile, newWorktreeId, ID_PATTERNS.worktree);

  return updateIndex(home, async (index) => {
    const known = index.worktrees[worktreeId];
    if (known && known.path !== info.root && (await exists(known.path))) {
      worktreeId = newWorktreeId();
      await writeFileAtomic(worktreeFile, `${worktreeId}\n`, { mode: 0o644 });
      if (info.gitDir === info.commonDir) {
        repoId = newRepoId();
        await writeFileAtomic(repoFile, `${repoId}\n`, { mode: 0o644 });
      }
    }
    index.worktrees[worktreeId] = { repoId, path: info.root, lastSeen: new Date().toISOString() };
    return { repoId, worktreeId };
  });
}
