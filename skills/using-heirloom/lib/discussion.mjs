// Decisions settled in a PR or issue discussion (the second way in). The agent cites the
// comment by URL with an exact quote; Heirloom fetches the comment itself with gh or glab and
// checks the quote, so a record never rests on a comment that does not say it.

import { createHash } from 'node:crypto';

import { classifyError } from './errors.mjs';
import { ghApiGet } from './github.mjs';
import { glabApiGet } from './gitlab.mjs';
import { parseRemote, remoteProvider } from './remote.mjs';

/**
 * @typedef {object} DiscussionRef
 * @property {string} host
 * @property {string} repo `owner/repo` or GitLab `group/sub/project`
 * @property {'pull' | 'issue'} on
 * @property {number} number PR, MR or issue number
 * @property {{ kind: 'issue-comment' | 'review-comment' | 'review' | 'note', id: number } | null} comment null: the PR, MR or issue description
 */

const GITHUB = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(pull|issues)\/(\d+)(?:\/[a-z]+)?(?:#(issuecomment|discussion_r|pullrequestreview)-?(\d+))?$/;
const GITLAB = /^https:\/\/([^/\s]+)\/(.+?)\/-\/(merge_requests|issues)\/(\d+)(?:#note_(\d+))?$/;

/**
 * Where a discussion URL points, or null when it is no PR, MR or issue (comment) URL.
 * @param {string} url
 * @returns {DiscussionRef | null}
 */
export function parseDiscussionUrl(url) {
  const g = GITHUB.exec(url);
  if (g) {
    const kind = g[4] === 'issuecomment' ? 'issue-comment' : g[4] === 'discussion_r' ? 'review-comment' : g[4] === 'pullrequestreview' ? 'review' : null;
    if (kind && kind !== 'issue-comment' && g[2] !== 'pull') return null;
    return { host: 'github.com', repo: g[1], on: g[2] === 'pull' ? 'pull' : 'issue', number: Number(g[3]), comment: kind ? { kind, id: Number(g[5]) } : null };
  }
  const l = GITLAB.exec(url);
  if (l) return { host: l[1].toLowerCase(), repo: l[2], on: l[3] === 'merge_requests' ? 'pull' : 'issue', number: Number(l[4]), comment: l[5] ? { kind: 'note', id: Number(l[5]) } : null };
  return null;
}

/**
 * Fetch the text and author of a discussion comment (or a PR, MR or issue description).
 * @param {{ cwd: string, ref: DiscussionRef }} options
 * @returns {Promise<{ body: string, author: string | null }>}
 */
export async function fetchDiscussion({ cwd, ref }) {
  if (ref.host === 'github.com') {
    const base = `repos/${ref.repo}`;
    const path =
      ref.comment?.kind === 'issue-comment'
        ? `${base}/issues/comments/${ref.comment.id}`
        : ref.comment?.kind === 'review-comment'
          ? `${base}/pulls/comments/${ref.comment.id}`
          : ref.comment?.kind === 'review'
            ? `${base}/pulls/${ref.number}/reviews/${ref.comment.id}`
            : `${base}/issues/${ref.number}`;
    const r = await ghApiGet({ cwd, path });
    return { body: String(r?.body ?? ''), author: typeof r?.user?.login === 'string' ? r.user.login : null };
  }
  const kind = ref.on === 'pull' ? 'merge_requests' : 'issues';
  const path = ref.comment ? `/${kind}/${ref.number}/notes/${ref.comment.id}` : `/${kind}/${ref.number}`;
  const r = await glabApiGet({ cwd, host: ref.host, repo: ref.repo, path });
  return { body: String((ref.comment ? r?.body : r?.description) ?? ''), author: typeof r?.author?.username === 'string' ? r.author.username : null };
}

/** @param {string} s */
const flat = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Check a discussion candidate of a draft: the URL points into the task's repository, the
 * comment can be fetched, and the quote is in it. Returns what was fetched, kept in the draft.
 * @param {{ cwd: string, remote: string | null, url: string, quote: string, at: string, errors: string[] }} options
 * @returns {Promise<{ author: string | null, bodySha256: string } | null>}
 */
export async function checkDiscussion({ cwd, remote, url, quote, at, errors }) {
  const ref = parseDiscussionUrl(url);
  if (!ref) {
    errors.push(`${at}.url: GitHub PR·이슈(댓글)나 GitLab MR·이슈(note) URL이 아님 (${url})`);
    return null;
  }
  const own = parseRemote(remote);
  if (!own || own.host !== ref.host || own.path.toLowerCase() !== ref.repo.toLowerCase()) {
    errors.push(`${at}.url: 이 저장소(${own ? `${own.host}/${own.path}` : '원격 없음'})의 토론이 아님`);
    return null;
  }
  if (ref.host !== 'github.com' && (await remoteProvider({ cwd, url: remote })).provider !== 'gitlab') {
    errors.push(`${at}.url: 이 호스트의 토론을 가져올 수 없음. GitLab이면 glab auth login --hostname ${ref.host}`);
    return null;
  }
  let fetched;
  try {
    fetched = await fetchDiscussion({ cwd, ref });
  } catch (err) {
    const e = classifyError(err);
    errors.push(`${at}.url: 토론을 가져오지 못함 (${e.message})`);
    return null;
  }
  if (!flat(quote) || !flat(fetched.body).includes(flat(quote))) {
    errors.push(`${at}.quote: 가져온 토론 원문에서 찾을 수 없음. 댓글의 문장을 그대로 인용한다`);
    return null;
  }
  return { author: fetched.author, bodySha256: createHash('sha256').update(fetched.body).digest('hex') };
}
