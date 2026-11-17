// Recall: the full text of the decision records related to a query, with their anchors
// checked (pivot 7.3). Read-only.
//
// Relevance uses explicit ids and the record's scope against the query paths. A path match is a
// hint, not proof that the record applies: every result carries the reasons it was chosen.
// Records written before the pivot (schema 1 decisions, axioms) are past records: they are
// named, never served as rules.

import { loadProjectConfig } from './config.mjs';
import { HeirloomError } from './errors.mjs';
import { changedFiles, repoInfo, resolveBase } from './git.mjs';
import { matchesAny } from './glob.mjs';
import { checkAnchors, lastTestRuns } from './anchors.mjs';
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
        hint: '앞으로 수정할 코드 경로를 --paths로 넘긴다.',
      });
    }
  }
  const query = { paths: queryPaths, topics, ids };

  const view = await recordView({ cwd: info.root, home });
  const runs = await lastTestRuns(home, info);

  const candidates = [];
  for (const d of view.decisions) {
    const { score, reasons } = scoreRecord({ id: d.id, codePaths: d.doc.meta.scope, topics: [] }, query);
    if (!score) continue;
    const text = serializeRecord(/** @type {any} */ (d.doc));
    candidates.push({ id: d.id, kind: 'decision', score, reasons, record: d, text, tokens: estimateTokens(text) });
  }
  const limits = { maxRecords: limit ?? config.recall.maxRecords, maxTokens: config.recall.maxTokens };
  const { chosen, excluded, tokens } = selectWithinLimits(candidates, limits);

  const records = [];
  for (const c of chosen) {
    const check = await checkAnchors({ root: info.root, anchors: c.record.doc.meta.anchors, runs });
    records.push({
      id: c.id,
      choice: c.record.doc.meta.choice,
      status: c.record.status,
      anchorCheck: check.result,
      anchors: check.anchors,
      replaces: c.record.doc.meta.replaces,
      file: c.record.file,
      score: c.score,
      reasons: c.reasons,
      tokens: c.tokens,
      text: c.text,
    });
  }

  // Past records: named so the agent knows they exist, never served as rules.
  const legacy = view.records
    .map((r) => ({ r, ...scoreRecord(r.doc.meta, query) }))
    .filter((x) => x.score)
    .map(({ r, reasons }) => ({ id: r.id, kind: r.doc.meta.kind, title: r.doc.meta.title, file: r.file, reasons }));

  // Other tasks' pending changes that touch a relevant record or add a relevant one.
  const relevant = new Set(candidates.map((c) => c.id));
  const warnings = view.pending
    .filter((p) => relevant.has(p.id) || (p.by !== null && relevant.has(p.by)) || (p.scope && scoreRecord({ id: p.id, ...p.scope }, query).score > 0) || ids.includes(p.id))
    .map((p) => ({ id: p.id, change: p.change, title: p.title, taskId: p.taskId, by: p.by, seenIn: p.seenIn }));

  const known = new Set([...view.decisions.map((d) => d.id), ...view.records.map((r) => r.id), ...view.pending.map((p) => p.id)]);
  const missing = ids.filter((id) => !known.has(id));

  return {
    query: { ...query, from },
    merge: view.merge,
    records,
    excluded: {
      count: excluded.length,
      byLimit: excluded.filter((e) => e.reason === 'limit').length,
      byTokens: excluded.filter((e) => e.reason === 'tokens').length,
      items: excluded.map((e) => ({ id: e.id, choice: e.record.doc.meta.choice, score: e.score, tokens: e.tokens, reason: e.reason })),
    },
    limits: { ...limits, tokensUsed: tokens },
    legacy,
    pendingWarnings: warnings,
    missing,
    errors: view.errors,
  };
}
