// Recall: the full text of active decisions and axioms related to a query. Read-only.
//
// Relevance uses explicit ids, the record's codePaths against the query paths, and topics.
// A path match is a hint, not proof that the record applies: every result carries the
// reasons it was chosen so the agent can confirm against the original text.

import { loadProjectConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { changedFiles, repoInfo, resolveBase } from './git.mjs';
import { matchesAny } from './glob.mjs';
import { recordView } from './record-status.mjs';
import { serializeRecord } from './records.mjs';
import { isMarkdownCodePath } from './schema.mjs';

/** @typedef {import('./records.mjs').RecordMeta} RecordMeta */
/** @typedef {import('./record-status.mjs').ViewRecord} ViewRecord */
/** @typedef {import('./record-status.mjs').PendingChange} PendingChange */

export const SCORE = Object.freeze({ id: 100, path: 10, topic: 5 });

/**
 * Token estimate: UTF-8 bytes ÷ 3. One Hangul syllable (3 bytes) counts as one token and
 * ASCII text as three characters per token, which errs on the high side for English
 * (a conservative estimate: about one token per Korean character).
 * @param {string} text
 */
export function estimateTokens(text) {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

/** @param {string} p */
const normalizePath = (p) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * The part of a glob before its first wildcard.
 * @param {string} glob
 */
const literalPrefix = (glob) => {
  const i = glob.search(/[*?[{]/);
  return i === -1 ? glob : glob.slice(0, i);
};

/**
 * Whether a query path touches a record's code paths: the file matches a code path, or the
 * query names a directory that contains one.
 * @param {string} query
 * @param {string[]} codePaths
 */
export function pathMatches(query, codePaths) {
  if (!query) return false;
  if (matchesAny(query, codePaths)) return true;
  const dir = `${query}/`;
  return codePaths.some((cp) => literalPrefix(cp).startsWith(dir));
}

/**
 * @param {Pick<RecordMeta, 'id' | 'codePaths' | 'topics'>} meta
 * @param {{ paths: string[], topics: string[], ids: string[] }} query
 * @returns {{ score: number, reasons: string[] }}
 */
export function scoreRecord(meta, query) {
  let score = 0;
  /** @type {string[]} */
  const reasons = [];
  if (query.ids.includes(meta.id)) {
    score += SCORE.id;
    reasons.push('id');
  }
  const paths = query.paths.filter((p) => pathMatches(p, meta.codePaths));
  if (paths.length) {
    score += SCORE.path * paths.length;
    reasons.push(...paths.map((p) => `path:${p}`));
  }
  const own = new Set(meta.topics.map((t) => t.toLowerCase()));
  const topics = query.topics.filter((t) => own.has(t.toLowerCase()));
  if (topics.length) {
    score += SCORE.topic * topics.length;
    reasons.push(...topics.map((t) => `topic:${t}`));
  }
  return { score, reasons };
}

/**
 * Pick the most relevant records within the count and token limits. A record that does not
 * fit the remaining token budget is skipped and later, smaller ones may still fit.
 * @template {{ score: number, kind: string, id: string, tokens: number }} T
 * @param {T[]} candidates
 * @param {{ maxRecords: number, maxTokens: number }} limits
 */
export function selectWithinLimits(candidates, { maxRecords, maxTokens }) {
  const ordered = [...candidates].sort(
    (a, b) => b.score - a.score || (a.kind === b.kind ? 0 : a.kind === 'axiom' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  /** @type {T[]} */
  const chosen = [];
  /** @type {(T & { reason: 'limit' | 'tokens' })[]} */
  const excluded = [];
  let used = 0;
  for (const c of ordered) {
    if (chosen.length >= maxRecords) excluded.push({ ...c, reason: 'limit' });
    else if (used + c.tokens > maxTokens) excluded.push({ ...c, reason: 'tokens' });
    else {
      chosen.push(c);
      used += c.tokens;
    }
  }
  return { chosen, excluded, tokens: used };
}

/** @param {string[] | undefined} values comma-separated or repeated */
export function splitList(values) {
  return [...new Set((values ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean))];
}

/**
 * @param {{ cwd: string, home: string, paths?: string[], topics?: string[], ids?: string[], limit?: number }} options
 */
export async function recall({ cwd, home, paths = [], topics = [], ids = [], limit }) {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new HeirloomError('E_INPUT', `--limit은 1 이상의 정수여야 함: ${limit}`);
  const info = await repoInfo(cwd);
  const config = await loadProjectConfig(info.root);

  /** @type {'args' | 'changed'} */
  let from = 'args';
  let queryPaths = paths.map(normalizePath).filter(Boolean);
  if (!queryPaths.length && !topics.length && !ids.length) {
    // No query: the code files changed against the target branch.
    const base = await resolveBase({ cwd: info.root, configBase: config.baseBranch });
    queryPaths = (await changedFiles({ root: info.root, mergeBase: base.mergeBase })).map((f) => f.path).filter((p) => !isMarkdownCodePath(p));
    from = 'changed';
    // An empty result here would read as "no related records" when nothing was looked up.
    if (!queryPaths.length) {
      throw new HeirloomError('E_INPUT', '조회 조건이 없고 대상 브랜치 대비 변경된 코드 파일도 없음', {
        hint: '앞으로 수정할 코드 경로를 --paths로, 작업 주제를 --topics로 넘긴다.',
      });
    }
  }
  const query = { paths: queryPaths, topics, ids };

  const view = await recordView({ cwd: info.root, home });
  const byId = new Map(view.records.map((r) => [r.id, r]));

  const candidates = [];
  /** @type {{ id: string, kind: string, title: string, status: string, supersededBy: string | null, deprecation: string | null }[]} */
  const inactive = [];
  for (const r of view.records) {
    const { score, reasons } = scoreRecord(r.doc.meta, query);
    if (!score) continue;
    if (r.status === 'inactive') {
      // Never served as a current rule; named only when asked for by id.
      if (reasons.includes('id')) {
        inactive.push({
          id: r.id,
          kind: r.doc.meta.kind,
          title: r.doc.meta.title,
          status: r.merged ? 'inactive' : 'inactive_pending',
          supersededBy: r.doc.meta.supersededBy,
          deprecation: r.doc.meta.deprecation?.reason ?? null,
        });
      }
      continue;
    }
    const text = serializeRecord(r.doc);
    candidates.push({ id: r.id, kind: r.doc.meta.kind, score, reasons, record: r, text, tokens: estimateTokens(text) });
  }
  const limits = { maxRecords: limit ?? config.recall.maxRecords, maxTokens: config.recall.maxTokens };
  const { chosen, excluded, tokens } = selectWithinLimits(candidates, limits);

  // Other tasks' pending changes: only those that touch a relevant record or add a relevant one.
  const relevant = new Set(candidates.map((c) => c.id));
  for (const i of inactive) relevant.add(i.id);
  const warnings = view.pending
    .filter((p) => relevant.has(p.id) || (p.by !== null && relevant.has(p.by)) || (p.scope && scoreRecord({ id: p.id, ...p.scope }, query).score > 0) || ids.includes(p.id))
    .map((p) => ({ id: p.id, change: p.change, title: p.title, taskId: p.taskId, by: p.by, seenIn: p.seenIn }));

  const missing = ids.filter((id) => !byId.has(id) && !view.pending.some((p) => p.id === id));

  return {
    query: { ...query, from },
    merge: view.merge,
    records: chosen.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.record.doc.meta.title,
      status: c.record.status,
      file: c.record.file,
      score: c.score,
      reasons: c.reasons,
      tokens: c.tokens,
      text: c.text,
    })),
    excluded: {
      count: excluded.length,
      byLimit: excluded.filter((e) => e.reason === 'limit').length,
      byTokens: excluded.filter((e) => e.reason === 'tokens').length,
      items: excluded.map((e) => ({ id: e.id, kind: e.kind, title: e.record.doc.meta.title, score: e.score, tokens: e.tokens, reason: e.reason })),
    },
    limits: { ...limits, tokensUsed: tokens },
    inactive,
    pendingWarnings: warnings,
    missing,
    errors: view.errors,
  };
}
