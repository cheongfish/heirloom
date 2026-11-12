// Stop-hook decision: remind the agent once about handing off, only when every
// mechanical condition holds. Never infers completion from the conversation.

import { matchesAny } from './glob.mjs';
import { isMarkdownCodePath } from './schema.mjs';
import { loadProjectConfig } from './config.mjs';
import { countAttempts, deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { diffStates } from './recheck.mjs';
import { repoInfo, resolveBase } from './git.mjs';
import { readIds, resolveIds } from './ids.mjs';
import { approvalFiles, taskPaths } from './paths.mjs';
import { computeSourceState, currentSourceState, hashMaterial } from './state.mjs';
import { readIndex, tasksForWorktree, updateIndex } from './store.mjs';

/**
 * @typedef {object} StopDecision
 * @property {boolean} remind
 * @property {'stop_hook_active' | 'not_git' | 'no_base' | 'no_changes' | 'no_code_changes' | 'no_spec' | 'already_reminded' | 'handoff_requested' | 'remind' | 'recheck' | 'recheck_not_needed'} reason
 * @property {string} [message] text for the agent when `remind` is true
 */

/** @param {string[]} specs */
export function reminderMessage(specs) {
  return [
    'Heirloom 인계 확인: 이 작업 트리에 spec이 연결된 변경이 있지만, 현재 상태에 대한 인계 요청이 없다.',
    `연결된 spec: ${specs.join(', ')}`,
    'spec 기반 작업의 구현과 최종 리뷰를 마쳤다면, 사용자에게 완료를 보고하기 전에 prepare-handoff 스킬을 실행한다.',
    '아직 작업 중이거나, 사용자 입력을 기다리거나, 중단·오류로 멈춘 상태라면 인계하지 않고 그대로 종료한다.',
    '이 안내는 같은 상태에서 다시 나오지 않는다.',
  ].join('\n');
}

/** @param {string} taskId @param {string[]} paths */
export function recheckMessage(taskId, paths) {
  return [
    `Heirloom 재확인 안내: 승인된 작업 ${taskId}의 코드나 자료가 승인 이후 바뀌었다.`,
    `바뀐 파일: ${paths.slice(0, 10).join(', ')}${paths.length > 10 ? ` 외 ${paths.length - 10}개` : ''}`,
    '이 변경을 마쳤다면, 사용자에게 완료를 보고하기 전에 prepare-handoff 스킬을 다시 실행해 증분 재확인을 시작한다. 바뀐 부분과 연결된 항목만 다시 승인받는다.',
    '아직 작업 중이거나, 사용자 입력을 기다리거나, 중단·오류로 멈춘 상태라면 그대로 종료한다.',
    '이 안내는 같은 상태에서 다시 나오지 않는다.',
  ].join('\n');
}

/**
 * An approved task of this branch, and what changed since its approval. Only the input of an approved, applied or PR-created task is still the
 * approved one.
 * @param {{ home: string, taskIds: string[], branch: string | null }} options
 */
async function approvedTaskChange({ home, taskIds, branch }) {
  for (const taskId of taskIds) {
    const paths = taskPaths(home, taskId);
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    if (state !== 'approved' && state !== 'applied' && state !== 'pr_created') continue;
    const input = /** @type {any} */ (await readJson(paths.input));
    const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
    if (!input || input.branch !== branch || typeof approvalId !== 'string') continue;
    const approval = /** @type {any} */ (await readJson(approvalFiles(paths.approvals, approvalId).record));
    if (!approval) continue;
    const current = await currentSourceState({ root: input.repo.root, base: input.base });
    /** @type {Record<string, string | null>} */
    const materials = {};
    for (const ref of Object.keys(approval.target.materials)) {
      try {
        materials[ref] = await hashMaterial(input.repo.root, ref);
      } catch {
        materials[ref] = null;
      }
    }
    const diff = diffStates({
      before: { files: input.source.files, mergeBase: input.base.mergeBase, materials: approval.target.materials },
      after: { files: current.files, mergeBase: current.mergeBase, materials },
    });
    const code = diff.changes.map((c) => c.path).filter((p) => !isMarkdownCodePath(p));
    return { taskId, events, hash: current.hash, paths: [...code, ...diff.materials.map((m) => m.ref)] };
  }
  return null;
}

/**
 * @param {{ cwd: string, home: string, stopHookActive: boolean }} options
 * @returns {Promise<StopDecision>}
 */
export async function evaluateStop({ cwd, home, stopHookActive }) {
  if (stopHookActive) return { remind: false, reason: 'stop_hook_active' };

  let info;
  try {
    info = await repoInfo(cwd);
  } catch {
    return { remind: false, reason: 'not_git' };
  }
  const config = await loadProjectConfig(info.root);
  let base;
  try {
    base = await resolveBase({ cwd: info.root, configBase: config.baseBranch });
  } catch {
    return { remind: false, reason: 'no_base' };
  }

  const state = await computeSourceState({ root: info.root, mergeBase: base.mergeBase });
  if (!state.files.length) return { remind: false, reason: 'no_changes' };
  // Work changes are non-Markdown files: a phase that only wrote spec/plan documents is not
  // ready to hand off (same criterion as related code paths).
  if (!state.files.some((f) => !isMarkdownCodePath(f.path))) return { remind: false, reason: 'no_code_changes' };

  const known = await readIds(info);
  const index = known ? await readIndex(home) : null;
  if (known && index) {
    const approved = await approvedTaskChange({ home, taskIds: tasksForWorktree(index, known.worktreeId).map((t) => t.taskId), branch: info.branch });
    if (approved) {
      if (!approved.paths.length) return { remind: false, reason: countAttempts(approved.events, approved.hash) > 0 ? 'handoff_requested' : 'recheck_not_needed' };
      if (index.reminders[known.worktreeId]?.sourceHash === approved.hash) return { remind: false, reason: 'already_reminded' };
      if (countAttempts(approved.events, approved.hash) > 0) return { remind: false, reason: 'handoff_requested' };
      await updateIndex(home, (ix) => {
        ix.reminders[known.worktreeId] = { sourceHash: approved.hash, at: new Date().toISOString() };
      });
      return { remind: true, reason: 'recheck', message: recheckMessage(approved.taskId, approved.paths) };
    }
  }

  const specs = state.files.filter((f) => f.status !== 'D' && matchesAny(f.path, config.specGlobs)).map((f) => f.path);
  if (!specs.length) return { remind: false, reason: 'no_spec' };

  if (known && index) {
    if (index.reminders[known.worktreeId]?.sourceHash === state.hash) return { remind: false, reason: 'already_reminded' };
    for (const { taskId } of tasksForWorktree(index, known.worktreeId)) {
      if (countAttempts(await readEvents(taskPaths(home, taskId).events), state.hash) > 0) {
        return { remind: false, reason: 'handoff_requested' };
      }
    }
  }

  const { worktreeId } = await resolveIds(home, info);
  await updateIndex(home, (index) => {
    index.reminders[worktreeId] = { sourceHash: state.hash, at: new Date().toISOString() };
  });
  return { remind: true, reason: 'remind', message: reminderMessage(specs) };
}
