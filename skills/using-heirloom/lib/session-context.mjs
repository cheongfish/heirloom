// Session-start context: the handoff convention plus a short project index
// (PLAN 14.4, MVP-PLAN 7.4). Read-only: never creates ids or files.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { deriveState, readEvents } from './events.mjs';
import { changedFiles, repoInfo, resolveBase } from './git.mjs';
import { matchesAny } from './glob.mjs';
import { readIds } from './ids.mjs';
import { findProjectRules } from './project-rules.mjs';
import { taskPaths } from './paths.mjs';
import { recordView } from './record-status.mjs';
import { readIndex, tasksForWorktree } from './store.mjs';

const PENDING_SHOWN = 10;

/** @type {Record<import('./record-status.mjs').ChangeKind, string>} */
const CHANGE_LABEL = { add: '추가 제안', update: '수정 제안', supersede: '대체 제안', deprecate: '폐기 제안' };

/** @param {string} text */
function stripFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized.trim();
  const end = normalized.indexOf('\n---\n', 4);
  return end === -1 ? normalized.trim() : normalized.slice(end + 5).trim();
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() => clearTimeout(timer));
}

/**
 * @param {string} cwd
 * @param {string} home
 * @returns {Promise<string | null>}
 */
async function projectSection(cwd, home) {
  let info;
  try {
    info = await repoInfo(cwd);
  } catch {
    return null;
  }
  const config = await loadProjectConfig(info.root);
  const view = await recordView({ cwd: info.root, home });
  const errors = view.errors;
  const current = view.records.filter((r) => r.status !== 'inactive');
  /** @param {import('./record-status.mjs').ViewRecord} r */
  const label = (r) => (r.status === 'pending' ? ' [머지 대기]' : '');
  const axioms = current.filter((r) => r.doc.meta.kind === 'axiom');
  const decisions = current.filter((r) => r.doc.meta.kind === 'decision');

  /** @type {string[]} */
  let changed = [];
  try {
    const base = await resolveBase({ cwd: info.root, configBase: config.baseBranch });
    changed = (await changedFiles({ root: info.root, mergeBase: base.mergeBase })).map((f) => f.path);
  } catch {
    // no target branch: keep the index unordered
  }
  /** @param {string[]} globs */
  const related = (globs) => changed.some((file) => matchesAny(file, globs));
  const ordered = [
    ...decisions.filter((d) => related(d.doc.meta.codePaths)),
    ...decisions.filter((d) => !related(d.doc.meta.codePaths)),
  ];
  const shown = ordered.slice(0, config.sessionIndex.maxDecisions);

  const lines = ['## 활성 axiom'];
  lines.push(...(axioms.length ? axioms.map((a) => `- ${a.id}${label(a)}: ${a.doc.meta.title}`) : ['- 없음']));
  lines.push('', '## decision 색인 (현재 변경과 관련된 항목이 위)');
  if (shown.length) {
    for (const d of shown) {
      const mark = related(d.doc.meta.codePaths) ? ' [관련]' : '';
      lines.push(`- ${d.id}${mark}${label(d)}: ${d.doc.meta.title} — ${d.doc.meta.codePaths.join(', ') || '(경로 없음)'}`);
    }
    if (ordered.length > shown.length) lines.push(`- … ${ordered.length - shown.length}개 더 있음. 원문은 recall-context 스킬로 조회한다.`);
  } else {
    lines.push('- 없음');
  }
  if (view.pending.length) {
    lines.push('', '## 다른 작업의 머지 대기 변경 (현재 규칙이 아님, 원문은 제공하지 않음)');
    for (const p of view.pending.slice(0, PENDING_SHOWN)) {
      lines.push(`- ${p.id}: ${CHANGE_LABEL[p.change]}${p.by ? ` → ${p.by}` : ''} (작업 ${p.taskId ?? '알 수 없음'}) — ${p.title}`);
    }
    if (view.pending.length > PENDING_SHOWN) lines.push(`- … ${view.pending.length - PENDING_SHOWN}건 더 있음.`);
  }
  if (errors.length) lines.push('', `읽지 못한 기록 ${errors.length}개: ${errors.map((e) => e.split(': ')[0]).join(', ')}`);

  const ids = await readIds(info);
  if (ids) {
    const index = await readIndex(home);
    /** @type {string[]} */
    const pending = [];
    for (const { taskId } of tasksForWorktree(index, ids.worktreeId)) {
      const state = deriveState(await readEvents(taskPaths(home, taskId).events));
      if (state === 'approved') pending.push(`- ${taskId}: 승인됨, 아직 반영되지 않음 → 사용자에게 알리고, 요청하면 apply-approval 스킬로 처리한다.`);
      else if (state === 'applied') pending.push(`- ${taskId}: 기록 파일을 썼지만 PR이 아직 없음 → apply-approval 스킬로 이어서 처리한다.`);
      else if (state === 'stale') pending.push(`- ${taskId}: 승인 이후 소스가 바뀌어 반영하지 못함 → prepare-handoff로 다시 인계해야 한다.`);
      else if (state === 'awaiting_approval') pending.push(`- ${taskId}: 대시보드에서 사람의 승인을 기다리는 중.`);
    }
    if (pending.length) lines.push('', '## 이 작업 트리의 미처리 인계', ...pending);
  }

  const { commitGuides } = await findProjectRules(info.root);
  if (commitGuides.length) lines.push('', '## 커밋 메시지 지침 파일 (내용을 읽고 따른다)', ...commitGuides.map((g) => `- ${g}`));

  const fetched = view.merge.fetchedAt ?? '기록 없음';
  lines.push(
    '',
    view.merge.status === 'checked'
      ? `머지 판정: ${view.merge.ref} 기준, 마지막 fetch ${fetched}. fetch하지 않았으므로 그 뒤의 머지는 반영되지 않았다. [머지 대기]는 이 작업이 승인했지만 아직 머지되지 않은 기록이다.`
      : `머지 판정: 미확인(${view.merge.reason}). 마지막 fetch ${fetched}. 위 목록은 이 작업 트리의 기록 파일 기준이다.`,
  );
  return lines.join('\n');
}

/**
 * @param {{ cwd: string, home: string, pluginRoot: string, budgetMs?: number }} options
 * @returns {Promise<string>}
 */
export async function buildSessionContext({ cwd, home, pluginRoot, budgetMs = 2500 }) {
  let convention;
  try {
    convention = stripFrontmatter(await readFile(path.join(pluginRoot, 'skills', 'using-heirloom', 'SKILL.md'), 'utf8'));
  } catch {
    convention = 'Heirloom 규약 파일(skills/using-heirloom/SKILL.md)을 읽지 못했다.';
  }
  const parts = [`<heirloom-convention>\n${convention}\n</heirloom-convention>`];
  try {
    const project = await withTimeout(projectSection(cwd, home), budgetMs);
    if (project) parts.push(`<heirloom-project>\n${project}\n</heirloom-project>`);
  } catch (err) {
    parts.push(`<heirloom-project>\n프로젝트 맥락을 읽지 못했다: ${err instanceof Error ? err.message : String(err)}\n</heirloom-project>`);
  }
  return parts.join('\n\n');
}
