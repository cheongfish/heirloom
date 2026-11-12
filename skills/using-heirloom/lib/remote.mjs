// Which hosting service a git remote belongs to: github.com is GitHub (gh), gitlab.com is
// GitLab (glab), and any other host is GitLab only when glab is logged in to it. Everything
// else (local paths, GitHub Enterprise, other services) is an unsupported remote: records
// are still written, but no PR or MR is opened.

import { glabReady } from './gitlab.mjs';
import { listRemotes, tryGit } from './git.mjs';

/**
 * Host and project path of a remote URL, or null for a local path or an URL without a
 * project. The host is lowercased and has no port (an SSH port is never the web port).
 * The path keeps GitLab subgroups (`group/sub/project`) and drops `.git`.
 * @param {string | null | undefined} url
 * @returns {{ host: string, path: string } | null}
 */
export function parseRemote(url) {
  if (!url) return null;
  const m =
    /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/([^\s]+)$/.exec(url) ??
    /^(?:[\w.-]+@)?([\w.-]+\.[\w-]+):(?!\/)([^\s]+)$/.exec(url);
  if (!m) return null;
  const repoPath = m[2].replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = repoPath.split('/');
  if (parts.length < 2 || parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return { host: m[1].toLowerCase(), path: repoPath };
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
 * The remote a task's target branch lives on (`origin` when the base is a local branch),
 * the branch name on it, and its URL.
 * @param {string} root
 * @param {string} baseRef
 */
export async function taskRemote(root, baseRef) {
  const { remote, branch } = baseBranchName(baseRef, await listRemotes(root).catch(() => []));
  const url = await tryGit(['remote', 'get-url', remote ?? 'origin'], { cwd: root });
  return { remote, branch, url };
}

/** @typedef {'github' | 'gitlab'} Provider */

/**
 * @param {{ cwd: string, url: string | null | undefined }} options
 * @returns {Promise<{ provider: Provider | null, host: string | null, repo: string | null }>}
 */
export async function remoteProvider({ cwd, url }) {
  const parsed = parseRemote(url);
  if (!parsed) return { provider: null, host: null, repo: null };
  const { host, path: repo } = parsed;
  if (host === 'github.com') return { provider: repo.split('/').length === 2 ? 'github' : null, host, repo };
  if (host === 'gitlab.com') return { provider: 'gitlab', host, repo };
  const ready = await glabReady({ cwd, host });
  return { provider: ready.ok ? 'gitlab' : null, host, repo };
}
