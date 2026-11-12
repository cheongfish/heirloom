// GitHub remote detection and the few gh calls apply needs (PLAN 16.2, MVP-PLAN 7.2).
// gh creates nothing here: the agent runs `gh pr create` itself.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { HeirloomError, classifyError, withRetry } from './errors.mjs';

const execFileP = promisify(execFile);

/**
 * owner/repo of a github.com remote URL, or null for any other host or a local path.
 * @param {string | null | undefined} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubRemote(url) {
  if (!url) return null;
  const m =
    /^(?:[\w.-]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url) ??
    /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Split a base ref such as `origin/main` into remote and branch name.
 * @param {string} ref
 * @param {string[]} remotes
 */
export function baseBranchName(ref, remotes) {
  const remote = remotes.find((r) => ref.startsWith(`${r}/`));
  return remote ? { remote, branch: ref.slice(remote.length + 1) } : { remote: null, branch: ref };
}

/**
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs?: number }} options
 */
async function gh(args, { cwd, timeoutMs = 20_000 }) {
  try {
    const { stdout } = await execFileP('gh', args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    return stdout;
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT') throw new HeirloomError('E_INPUT', 'gh 실행 파일을 찾지 못함', { details: { reason: 'gh_missing' } });
    const stderr = (e.stderr ?? '').trim();
    const classified = classifyError(Object.assign(new Error(stderr || e.message), { code: e.code }));
    const transient = classified.code === 'E_TRANSIENT' || /error connecting|timeout|connection/i.test(stderr);
    throw new HeirloomError(transient ? 'E_TRANSIENT' : 'E_INTERNAL', `gh ${args.slice(0, 2).join(' ')} 실패: ${stderr || e.message}`, { cause: err });
  }
}

/**
 * Whether gh can be used here.
 * @param {string} cwd
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'gh_missing' | 'gh_unauthenticated' }>}
 */
export async function ghReady(cwd) {
  try {
    await gh(['--version'], { cwd });
  } catch {
    return { ok: false, reason: 'gh_missing' };
  }
  try {
    await gh(['auth', 'status', '--hostname', 'github.com'], { cwd });
  } catch {
    return { ok: false, reason: 'gh_unauthenticated' };
  }
  return { ok: true };
}

/**
 * The open PR whose head is `head`, or null. Network errors are retried once (PLAN 8).
 * @param {{ cwd: string, repo: string, head: string }} options
 * @returns {Promise<{ number: number, url: string, base: string } | null>}
 */
export async function findOpenPr({ cwd, repo, head }) {
  const text = await withRetry(() =>
    gh(['pr', 'list', '--repo', repo, '--head', head, '--state', 'open', '--json', 'number,url,state,headRefName,baseRefName', '--limit', '10'], { cwd }),
  );
  /** @type {any[]} */
  let prs;
  try {
    prs = JSON.parse(text);
  } catch {
    throw new HeirloomError('E_INTERNAL', 'gh pr list 출력이 JSON이 아님');
  }
  const pr = prs.find((p) => p.headRefName === head);
  return pr ? { number: pr.number, url: pr.url, base: pr.baseRefName } : null;
}

/**
 * State of a pull request by URL: 'OPEN', 'CLOSED' (closed without merge) or 'MERGED'.
 * Network errors are retried once (PLAN 8).
 * @param {{ cwd: string, url: string }} options
 * @returns {Promise<'OPEN' | 'CLOSED' | 'MERGED'>}
 */
export async function prState({ cwd, url }) {
  const text = await withRetry(() => gh(['pr', 'view', url, '--json', 'state'], { cwd }));
  let state;
  try {
    state = JSON.parse(text).state;
  } catch {
    throw new HeirloomError('E_INTERNAL', 'gh pr view 출력이 JSON이 아님');
  }
  if (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED') throw new HeirloomError('E_INTERNAL', `알 수 없는 PR 상태: ${String(state)}`);
  return state;
}
