// Stop-hook decision: remind the agent once about handing off, only when every
// mechanical condition holds (PLAN 7.3, 7.5; MVP-PLAN 7.4). Never infers completion
// from the conversation.

import { matchesAny } from './glob.mjs';
import { isMarkdownCodePath } from './schema.mjs';
import { loadProjectConfig } from './config.mjs';
import { countAttempts, readEvents } from './events.mjs';
import { repoInfo, resolveBase } from './git.mjs';
import { readIds, resolveIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { computeSourceState } from './state.mjs';
import { readIndex, tasksForWorktree, updateIndex } from './store.mjs';

/**
 * @typedef {object} StopDecision
 * @property {boolean} remind
 * @property {'stop_hook_active' | 'not_git' | 'no_base' | 'no_changes' | 'no_code_changes' | 'no_spec' | 'already_reminded' | 'handoff_requested' | 'remind'} reason
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
  // ready to hand off (same criterion as related code paths, PLAN 9).
  if (!state.files.some((f) => !isMarkdownCodePath(f.path))) return { remind: false, reason: 'no_code_changes' };
  const specs = state.files.filter((f) => f.status !== 'D' && matchesAny(f.path, config.specGlobs)).map((f) => f.path);
  if (!specs.length) return { remind: false, reason: 'no_spec' };

  const known = await readIds(info);
  if (known) {
    const index = await readIndex(home);
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
