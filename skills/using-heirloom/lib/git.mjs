// Thin git wrapper: repository info, target branch resolution, changed files.
// See docs/HEIRLOOM-MVP-PLAN.md section 7.3 and docs/HEIRLOOM-PLAN.md section 5.

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { HeirloomError, classifyError } from './errors.mjs';
import { REPO_DIR } from './paths.mjs';

const execFileP = promisify(execFile);

/**
 * Run git and return stdout.
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs?: number }} options
 * @returns {Promise<string>}
 */
export async function git(args, { cwd, timeoutMs = 60_000 }) {
  try {
    const { stdout } = await execFileP('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    });
    return stdout;
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT' && e.path === 'git') {
      throw new HeirloomError('E_INPUT', 'git 실행 파일을 찾지 못함', { hint: 'git을 설치하고 PATH에 추가한다.' });
    }
    const stderr = (e.stderr ?? '').trim();
    if (/not a git repository/i.test(stderr)) {
      throw new HeirloomError('E_INPUT', `git 저장소가 아님: ${cwd}`, { cause: err });
    }
    const classified = classifyError(err);
    throw new HeirloomError(classified.code, `git ${args.join(' ')} 실패: ${stderr || e.message}`, { cause: err });
  }
}

/**
 * Like `git` but returns null instead of throwing (for probing refs).
 * @param {string[]} args
 * @param {{ cwd: string }} options
 */
export async function tryGit(args, options) {
  try {
    return (await git(args, options)).trim();
  } catch {
    return null;
  }
}

/**
 * @typedef {object} RepoInfo
 * @property {string} root worktree root
 * @property {string} gitDir per-worktree git dir (absolute)
 * @property {string} commonDir shared git dir (absolute)
 * @property {string | null} branch null when detached
 * @property {string | null} head null in an empty repository
 */

/**
 * @param {string} cwd
 * @returns {Promise<RepoInfo>}
 */
export async function repoInfo(cwd) {
  const [root, gitDir, commonDir] = (await git(['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'], { cwd }))
    .trim()
    .split('\n');
  return {
    root,
    gitDir,
    commonDir: path.resolve(cwd, commonDir),
    branch: await tryGit(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd }),
    head: await tryGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd }),
  };
}

/** @param {string} cwd */
export async function listRemotes(cwd) {
  return (await git(['remote'], { cwd })).split('\n').filter(Boolean);
}

/**
 * @param {string} cwd
 * @param {string} ref
 */
async function refExists(cwd, ref) {
  return (await tryGit(['rev-parse', '--verify', '-q', `${ref}^{commit}`], { cwd })) !== null;
}

/**
 * Decide the target branch without guessing (PLAN 5.1):
 * explicit base, then config baseBranch (origin/<b>, else local <b>), then origin/HEAD.
 * @param {{ cwd: string, base?: string | null, configBase?: string | null }} options
 * @returns {Promise<{ ref: string, mergeBase: string }>}
 */
export async function resolveBase({ cwd, base, configBase }) {
  /** @type {string} */
  let ref;
  if (base) {
    if (!(await refExists(cwd, base))) {
      throw new HeirloomError('E_INPUT', `대상 브랜치를 찾을 수 없음: ${base}`, { hint: '--base에 존재하는 브랜치나 원격 브랜치를 지정한다.' });
    }
    ref = base;
  } else if (configBase) {
    const candidates = [`origin/${configBase}`, configBase];
    const found = [];
    for (const c of candidates) if (await refExists(cwd, c)) found.push(c);
    if (!found.length) {
      throw new HeirloomError('E_INPUT', `.heirloom/config.json의 baseBranch를 찾을 수 없음: ${configBase}`, {
        hint: 'git fetch로 원격 브랜치를 가져오거나 --base를 지정한다.',
      });
    }
    ref = found[0];
  } else {
    const remotes = await listRemotes(cwd);
    if (!remotes.includes('origin')) {
      throw new HeirloomError(
        'E_INPUT',
        remotes.length ? `origin이 없고 원격이 여러 개라 대상 브랜치를 정할 수 없음: ${remotes.join(', ')}` : '원격이 없어 대상 브랜치를 정할 수 없음',
        { hint: '--base로 대상 브랜치를 지정하거나 .heirloom/config.json에 baseBranch를 둔다.' },
      );
    }
    const head = await tryGit(['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd });
    if (!head) {
      throw new HeirloomError('E_INPUT', 'origin/HEAD가 설정되지 않아 대상 브랜치를 정할 수 없음', {
        hint: '`git remote set-head origin --auto`를 실행하거나 --base를 지정한다.',
      });
    }
    ref = head.replace(/^refs\/remotes\//, '');
  }
  const mergeBase = await tryGit(['merge-base', ref, 'HEAD'], { cwd });
  if (!mergeBase) throw new HeirloomError('E_INPUT', `${ref}와 HEAD의 공통 조상이 없음`);
  return { ref, mergeBase };
}

/** @typedef {{ path: string, status: 'A' | 'M' | 'D' }} ChangedFile */

/**
 * Files changed between the merge-base and the working tree, including staged,
 * unstaged and untracked (non-ignored) files. Renames count as delete + add.
 * Untracked files are reported as 'A' so that committing them keeps the state (PLAN 5.2).
 * The Heirloom directory is excluded.
 * @param {{ root: string, mergeBase: string }} options
 * @returns {Promise<ChangedFile[]>}
 */
export async function changedFiles({ root, mergeBase }) {
  /** @type {Map<string, 'A' | 'M' | 'D'>} */
  const files = new Map();
  const diff = (await git(['diff', '--name-status', '-z', '--no-renames', mergeBase, '--'], { cwd: root })).split('\0');
  for (let i = 0; i + 1 < diff.length; i += 2) {
    const letter = diff[i];
    const file = diff[i + 1];
    if (!letter || !file) continue;
    files.set(file, letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M');
  }
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root })).split('\0');
  for (const file of untracked) if (file) files.set(file, 'A');

  const prefix = `${REPO_DIR}/`;
  return [...files]
    .filter(([file]) => !file.startsWith(prefix))
    .map(([file, status]) => ({ path: file, status }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
