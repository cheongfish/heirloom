// Temporary git repositories and HEIRLOOM_HOME directories for tests.
// Importing this module isolates git from the user's global/system config.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.env.GIT_AUTHOR_NAME = 'Test';
process.env.GIT_AUTHOR_EMAIL = 'test@example.invalid';
process.env.GIT_COMMITTER_NAME = 'Test';
process.env.GIT_COMMITTER_EMAIL = 'test@example.invalid';

/** @type {string[]} */
const created = [];
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * A new empty directory, removed when the test process exits.
 * @param {string} prefix
 * @returns {Promise<string>} real path
 */
export async function tempDir(prefix) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), `heirloom-${prefix}-`)));
  created.push(dir);
  return dir;
}

/**
 * @typedef {object} Repo
 * @property {string} dir
 * @property {(...args: string[]) => string} git run git in the repo, returns trimmed stdout
 * @property {(rel: string, content: string) => Promise<void>} write
 * @property {(rel: string) => Promise<void>} remove
 * @property {(message: string) => void} commitAll
 * @property {() => Promise<void>} cleanup
 */

/**
 * Create a repository on branch `main` with one initial commit.
 * @param {Record<string, string>} [files] initial files
 * @returns {Promise<Repo>}
 */
export async function makeRepo(files = { 'README.txt': 'hello\n' }) {
  const repo = await wrap(await tempDir('repo'));
  repo.git('init', '-q', '-b', 'main');
  for (const [rel, content] of Object.entries(files)) await repo.write(rel, content);
  repo.commitAll('initial');
  return repo;
}

/**
 * Clone `source` (sets origin and origin/HEAD), so the two share history.
 * @param {Repo} source
 * @returns {Promise<Repo>}
 */
export async function cloneRepo(source) {
  const parent = await tempDir('clone');
  const dir = path.join(parent, 'repo');
  execFileSync('git', ['clone', '-q', source.dir, dir]);
  const repo = await wrap(dir);
  const cleanup = repo.cleanup;
  repo.cleanup = async () => {
    await cleanup();
    await rm(parent, { recursive: true, force: true });
  };
  return repo;
}

/**
 * @param {string} dir
 * @returns {Promise<Repo>}
 */
async function wrap(dir) {
  /** @param {string[]} args */
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  /** @type {Repo} */
  const repo = {
    dir,
    git,
    async write(rel, content) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
    },
    async remove(rel) {
      await rm(path.join(dir, rel), { force: true });
    },
    commitAll(message) {
      git('add', '-A');
      git('commit', '-q', '-m', message);
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
  return repo;
}
