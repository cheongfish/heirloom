// The few glab calls apply and expiry need. glab creates nothing here: the agent runs
// `glab mr create` itself.
//
// Merge requests are read through `glab api` (GitLab REST API v4) rather than `glab mr list`
// or `glab mr view`: their JSON output flags differ between glab versions, while the API
// response is the same for every glab that has `api --hostname`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { HeirloomError, classifyError, withRetry } from './errors.mjs';

const execFileP = promisify(execFile);

/**
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs?: number }} options
 */
async function glab(args, { cwd, timeoutMs = 20_000 }) {
  try {
    const { stdout } = await execFileP('glab', args, { cwd, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, GLAB_NO_PROMPT: '1', NO_COLOR: '1' } });
    return stdout;
  } catch (err) {
    const e = /** @type {NodeJS.ErrnoException & { stderr?: string }} */ (err);
    if (e.code === 'ENOENT') throw new HeirloomError('E_INPUT', 'glab 실행 파일을 찾지 못함', { details: { reason: 'glab_missing' } });
    const stderr = (e.stderr ?? '').trim();
    const classified = classifyError(Object.assign(new Error(stderr || e.message), { code: e.code }));
    const transient = classified.code === 'E_TRANSIENT' || /dial tcp|timeout|connection|no such host/i.test(stderr);
    throw new HeirloomError(transient ? 'E_TRANSIENT' : 'E_INTERNAL', `glab ${args.slice(0, 2).join(' ')} 실패: ${stderr || e.message}`, { cause: err });
  }
}

/**
 * Whether glab can be used for `host`.
 * @param {{ cwd: string, host: string }} options
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'glab_missing' | 'glab_unauthenticated' }>}
 */
export async function glabReady({ cwd, host }) {
  try {
    await glab(['--version'], { cwd });
  } catch {
    return { ok: false, reason: 'glab_missing' };
  }
  try {
    await glab(['auth', 'status', '--hostname', host], { cwd });
  } catch {
    return { ok: false, reason: 'glab_unauthenticated' };
  }
  return { ok: true };
}

/** @param {string} text @param {string} what */
function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new HeirloomError('E_INTERNAL', `${what} 출력이 JSON이 아님`);
  }
}

/** @param {string} repo `group/sub/project` */
const projectRef = (repo) => `projects/${encodeURIComponent(repo)}`;

/**
 * The open merge request whose source branch is `head`, or null. Network errors are retried once.
 * @param {{ cwd: string, host: string, repo: string, head: string }} options
 * @returns {Promise<{ iid: number, url: string, base: string } | null>}
 */
export async function findOpenMr({ cwd, host, repo, head }) {
  const query = new URLSearchParams({ source_branch: head, state: 'opened', per_page: '20' });
  const text = await withRetry(() => glab(['api', '--hostname', host, `${projectRef(repo)}/merge_requests?${query}`], { cwd }));
  const list = parseJson(text, 'glab api merge_requests');
  if (!Array.isArray(list)) throw new HeirloomError('E_INTERNAL', 'glab api merge_requests 출력이 목록이 아님');
  const mr = list.find((m) => m?.source_branch === head && m?.state === 'opened');
  return mr ? { iid: Number(mr.iid), url: String(mr.web_url), base: String(mr.target_branch) } : null;
}

const MR_URL = /^https:\/\/([^/\s]+)\/((?:[^/\s]+\/)+[^/\s]+)\/-\/merge_requests\/(\d+)$/;

/**
 * Host, project path and number of a GitLab merge request URL, or null.
 * @param {string} url
 * @returns {{ host: string, repo: string, iid: number } | null}
 */
export function parseMrUrl(url) {
  const m = MR_URL.exec(url);
  if (!m) return null;
  return { host: m[1].toLowerCase(), repo: m[2], iid: Number(m[3]) };
}

/**
 * GitLab's merge request state as 'OPEN', 'CLOSED' (closed without merge) or 'MERGED'.
 * A locked merge request is still open.
 * @param {unknown} state
 * @returns {'OPEN' | 'CLOSED' | 'MERGED'}
 */
export function normalizeMrState(state) {
  if (state === 'opened' || state === 'locked') return 'OPEN';
  if (state === 'closed') return 'CLOSED';
  if (state === 'merged') return 'MERGED';
  throw new HeirloomError('E_INTERNAL', `알 수 없는 MR 상태: ${String(state)}`);
}

/**
 * State of a merge request by URL. Network errors are retried once.
 * @param {{ cwd: string, url: string }} options
 * @returns {Promise<'OPEN' | 'CLOSED' | 'MERGED'>}
 */
export async function mrState({ cwd, url }) {
  const mr = parseMrUrl(url);
  if (!mr) throw new HeirloomError('E_INPUT', `GitLab MR URL이 아님: ${url}`);
  const text = await withRetry(() => glab(['api', '--hostname', mr.host, `${projectRef(mr.repo)}/merge_requests/${mr.iid}`], { cwd }));
  return normalizeMrState(parseJson(text, 'glab api merge_request')?.state);
}
