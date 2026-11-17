// Session-start context: the handoff convention, two rules, the scope of decision records and
// this worktree's open handoffs.
// Read-only: never creates ids or files.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { deriveState, readEvents } from './events.mjs';
import { repoInfo } from './git.mjs';
import { readJson } from './fsx.mjs';
import { readIds } from './ids.mjs';
import { findProjectRules } from './project-rules.mjs';
import { remoteProvider, taskRemote } from './remote.mjs';
import { taskPaths } from './paths.mjs';
import { appliedTaskMerged, recordView } from './record-status.mjs';
import { readIndex, tasksForWorktree } from './store.mjs';
import { testCadenceBlock } from './test-cadence.mjs';
import { codeMatches } from './judgment-pr.mjs';

const SCOPE_SHOWN = 30;

/** Rules every session gets. The first carried most of the effect in the recall experiments. */
const RULES = [
  '요청이 기존 결정과 충돌하면 임의로 뒤집지 말고, 결정을 지키는 범위까지만 진행한 뒤 충돌을 알려라.',
  'spec 문서는 작성 시점의 의도다. 현재 동작은 코드와 테스트가 정한다. `docs/specs/archive/`는 과거 기록이다.',
];

/**
 * Whether the task's target remote is neither GitHub nor GitLab, so no PR or MR can be opened.
 * @param {string} home
 * @param {string} taskId
 */
async function prImpossible(home, taskId) {
  const input = /** @type {any} */ (await readJson(taskPaths(home, taskId).input));
  if (!input) return false;
  const root = input.repo.root;
  const { url } = await taskRemote(root, input.base.ref);
  return (await remoteProvider({ cwd: root, url })).provider === null;
}

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
  const view = await recordView({ cwd: info.root, home });
  const errors = view.errors;
  // Only the scope of decisions is given, never their titles or text: the agent reads a record
  // with recall-context once it knows which files it will change.
  const decisions = view.records.filter((r) => r.status !== 'inactive' && r.doc.meta.kind === 'decision');
  const scope = [...new Set(decisions.flatMap((d) => d.doc.meta.codePaths))].sort();
  const unscoped = decisions.filter((d) => d.doc.meta.codePaths.length === 0).length;

  const lines = ['## 규칙', ...RULES.map((r) => `- ${r}`)];
  if (scope.length || unscoped) {
    lines.push('', '## 결정 기록 범위 (이 경로를 고치기 전에 recall-context 스킬로 기록을 읽는다)');
    for (const glob of scope.slice(0, SCOPE_SHOWN)) lines.push(`- ${glob}`);
    if (scope.length > SCOPE_SHOWN) lines.push(`- … ${scope.length - SCOPE_SHOWN}개 더 있음.`);
    if (unscoped) lines.push(`- 경로 없는 결정 ${unscoped}개: recall-context 스킬의 --topics로 찾는다.`);
  }
  if (errors.length) lines.push('', `읽지 못한 기록 ${errors.length}개: ${errors.map((e) => e.split(': ')[0]).join(', ')}`);

  const ids = await readIds(info, home);
  if (ids) {
    const index = await readIndex(home);
    /** @type {string[]} */
    const pending = [];
    for (const { taskId } of tasksForWorktree(index, ids.worktreeId)) {
      const events = await readEvents(taskPaths(home, taskId).events);
      const state = deriveState(events);
      if (state === 'approved') pending.push(`- ${taskId}: 승인됨, 아직 반영되지 않음 → 사용자에게 알리고, 요청하면 apply-approval 스킬로 처리한다.`);
      else if (state === 'applied') {
        if (await appliedTaskMerged({ home, taskId })) continue;
        if (await prImpossible(home, taskId)) pending.push(`- ${taskId}: 기록 파일을 썼고 PR·MR은 만들 수 없음(지원하지 않는 원격) → 사용자가 직접 머지한다. 대상 브랜치에 머지되면 이 목록에서 빠진다.`);
        else pending.push(`- ${taskId}: 기록 파일을 썼지만 PR이 아직 없음 → apply-approval 스킬로 이어서 처리한다.`);
      }
      else if (state === 'stale') pending.push(`- ${taskId}: 승인 이후 소스나 자료가 바뀜(재확인 필요) → prepare-handoff를 다시 실행하면 바뀐 부분과 연결된 항목만 다시 승인받는다. 기존 승인은 보존된다.`);
      else if (state === 'awaiting_approval') pending.push(`- ${taskId}: 대시보드에서 사람의 승인을 기다리는 중.`);
      else if (state === 'pr_created') {
        if (await appliedTaskMerged({ home, taskId })) continue;
        // After the PR, new commits are not covered by the judgment (pivot 6.4).
        const pr = /** @type {any} */ (events.filter((e) => e.type === 'pr_created').at(-1));
        const input = /** @type {any} */ (await readJson(taskPaths(home, taskId).input));
        if (typeof pr?.statusSha === 'string' && input && !(await codeMatches({ input, judgedFiles: input.source.files })).ok) {
          pending.push(`- ${taskId}: PR ${pr.url}의 판정은 ${pr.statusSha.slice(0, 7)} 기준인데 그 뒤 코드가 바뀜. 새 커밋에는 heirloom/understood 상태가 없다 → 변경을 마쳤으면 prepare-handoff로 재확인한다.`);
        }
      }
      else if (state === 'returned') {
        const returned = /** @type {any} */ (events.filter((e) => e.type === 'returned').at(-1));
        const why = (returned?.items ?? []).map((/** @type {any} */ i) => `${i.id} ${i.verdict === 'split' ? '분리' : '되돌림'}: ${i.reason}`).join('; ');
        pending.push(`- ${taskId}: 사람이 판정에서 되돌림(${why}) → 코드와 spec을 고친 뒤 prepare-handoff를 다시 실행한다.`);
      }
    }
    if (pending.length) lines.push('', '## 이 작업 트리의 미처리 인계', ...pending);
  }

  const { commitGuides } = await findProjectRules(info.root);
  if (commitGuides.length) lines.push('', '## 커밋 메시지 지침 파일 (내용을 읽고 따른다)', ...commitGuides.map((g) => `- ${g}`));

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
  try {
    const cadence = testCadenceBlock((await loadProjectConfig((await repoInfo(cwd)).root)).testCadence);
    if (cadence) parts.push(cadence);
  } catch {
    // not a repository, or an unreadable setting: no cadence rules (the default)
  }
  return parts.join('\n\n');
}
