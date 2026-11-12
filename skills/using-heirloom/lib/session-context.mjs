// Session-start context: the handoff convention plus a short project index
// (PLAN 14.4, MVP-PLAN 7.4). Read-only: never creates ids or files.

import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { deriveState, readEvents } from './events.mjs';
import { changedFiles, repoInfo, resolveBase, tryGit } from './git.mjs';
import { matchesAny } from './glob.mjs';
import { readIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { readRecords } from './records.mjs';
import { readIndex, tasksForWorktree } from './store.mjs';

/** @param {string} text */
function stripFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return normalized.trim();
  const end = normalized.indexOf('\n---\n', 4);
  return end === -1 ? normalized.trim() : normalized.slice(end + 5).trim();
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
  const { records, errors } = await readRecords(info.root);
  const active = records.filter((r) => r.meta.active);
  const axioms = active.filter((r) => r.meta.kind === 'axiom');
  const decisions = active.filter((r) => r.meta.kind === 'decision');

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
    ...decisions.filter((d) => related(d.meta.codePaths)),
    ...decisions.filter((d) => !related(d.meta.codePaths)),
  ];
  const shown = ordered.slice(0, config.sessionIndex.maxDecisions);

  const lines = ['## 활성 axiom'];
  lines.push(...(axioms.length ? axioms.map((a) => `- ${a.meta.id}: ${a.meta.title}`) : ['- 없음']));
  lines.push('', '## decision 색인 (현재 변경과 관련된 항목이 위)');
  if (shown.length) {
    for (const d of shown) {
      const mark = related(d.meta.codePaths) ? ' [관련]' : '';
      lines.push(`- ${d.meta.id}${mark}: ${d.meta.title} — ${d.meta.codePaths.join(', ') || '(경로 없음)'}`);
    }
    if (ordered.length > shown.length) lines.push(`- … ${ordered.length - shown.length}개 더 있음. 원문은 recall-context 스킬로 조회한다.`);
  } else {
    lines.push('- 없음');
  }
  if (errors.length) lines.push('', `형식 오류로 읽지 못한 기록 ${errors.length}개: ${errors.map((e) => e.split(':')[0]).join(', ')}`);

  const ids = await readIds(info);
  if (ids) {
    const index = await readIndex(home);
    /** @type {string[]} */
    const pending = [];
    for (const { taskId } of tasksForWorktree(index, ids.worktreeId)) {
      const state = deriveState(await readEvents(taskPaths(home, taskId).events));
      if (state === 'approved') pending.push(`- ${taskId}: 승인됨, 아직 반영되지 않음 → apply-approval 스킬로 처리한다.`);
      else if (state === 'awaiting_approval') pending.push(`- ${taskId}: 대시보드에서 사람의 승인을 기다리는 중.`);
    }
    if (pending.length) lines.push('', '## 이 작업 트리의 미처리 인계', ...pending);
  }

  /** @type {string[]} */
  const guides = [];
  const template = await tryGit(['config', '--get', 'commit.template'], { cwd: info.root });
  if (template) guides.push(`${template} (git commit.template)`);
  for (const name of ['.gitmessage', 'CONTRIBUTING.md']) {
    if (name !== template && (await exists(path.join(info.root, name)))) guides.push(name);
  }
  if (guides.length) lines.push('', '## 커밋 메시지 지침 파일 (내용을 읽고 따른다)', ...guides.map((g) => `- ${g}`));

  let fetched = '기록 없음';
  try {
    fetched = (await stat(path.join(info.commonDir, 'FETCH_HEAD'))).mtime.toISOString();
  } catch {
    // never fetched
  }
  lines.push(
    '',
    `마지막 fetch: ${fetched}. 머지 여부는 확인하지 않았으며, 위 목록은 이 작업 트리의 기록 파일 기준이다.`,
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
