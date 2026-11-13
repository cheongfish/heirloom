// Check and register the agent's draft.

import { access } from 'node:fs/promises';

import { readConversation } from './conversation.mjs';
import { openDashboard } from './dashboard-open.mjs';
import { checkDraft } from './draft-check.mjs';
import { HeirloomError, classifyError } from './errors.mjs';
import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson, writeFileAtomic, writeJsonAtomic } from './fsx.mjs';
import { git } from './git.mjs';
import { renderHandoff } from './handoff.mjs';
import { taskPaths } from './paths.mjs';
import { readRecords } from './records.mjs';
import { assertValid, inputSchema } from './schema.mjs';
import { currentSourceState, hashMaterial } from './state.mjs';
import { withTaskLock } from './task-lock.mjs';

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
 * @param {{ home: string, taskId: string }} options
 */
export async function submitDraft({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  return withTaskLock(home, taskId, async () => {
    const input = /** @type {any} */ (await readJson(paths.input));
    if (input === undefined) {
      throw new HeirloomError('E_INPUT', `준비된 인계 입력이 없음: ${taskId}`, { hint: 'prepare를 먼저 실행한다.' });
    }
    assertValid(inputSchema, input, paths.input);

    const state = deriveState(await readEvents(paths.events));
    if (state !== 'prepared' && state !== 'drafted' && state !== 'awaiting_approval') {
      throw new HeirloomError('E_CONFLICT', `현재 상태(${state ?? '없음'})에서는 초안을 제출할 수 없음`, {
        hint: '새 변경을 인계하려면 prepare를 다시 실행한다.',
      });
    }

    const root = input.repo.root;
    const current = await currentSourceState({ root, base: input.base });
    if (current.hash !== input.source.hash) {
      throw new HeirloomError('E_CONFLICT', '인계 준비 이후 소스가 바뀜', {
        hint: 'prepare를 다시 실행하고, 새 결과로 초안을 다시 쓴 뒤 제출한다.',
      });
    }
    for (const m of input.materials) {
      if (!m.sha256) continue;
      let now = null;
      try {
        now = await hashMaterial(root, m.ref);
      } catch {
        // deleted
      }
      if (now !== m.sha256) {
        throw new HeirloomError('E_CONFLICT', `인계 준비 이후 자료가 바뀜: ${m.ref}`, { hint: 'prepare를 다시 실행한다.' });
      }
    }

    const draft = await readJson(paths.draft);
    if (draft === undefined) {
      throw new HeirloomError('E_INPUT', `초안 파일이 없음: ${paths.draft}`, { hint: 'prepare-handoff 스킬의 형식대로 draft.json을 쓴다.' });
    }

    const { records } = await readRecords(root);
    const repoFiles = (await git(['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root })).split('\0').filter(Boolean);
    const conversation = await readConversation(paths.conversation);
    const result = await checkDraft({ root, input, draft, records, repoFiles, conversation });
    const ok = result.errors.length === 0;
    await writeJsonAtomic(paths.check, {
      schemaVersion: 1,
      ok,
      errors: result.errors,
      warnings: result.warnings,
      checkedAt: new Date().toISOString(),
    });
    await appendEvent(paths.events, { type: 'draft_checked', ok, errors: result.errors.length });
    if (!ok) {
      throw new HeirloomError('E_VERIFY', `초안 검사 오류 ${result.errors.length}개:\n${result.errors.map((e) => `- ${e}`).join('\n')}`, {
        hint: `오류를 고쳐 ${paths.draft}를 다시 쓰고 submit-draft를 다시 실행한다.`,
        details: { errors: result.errors, warnings: result.warnings },
      });
    }

    await writeJsonAtomic(paths.draft, result.draft);
    if (!(await exists(paths.draftInitial))) await writeJsonAtomic(paths.draftInitial, result.draft);
    await writeFileAtomic(paths.handoff, renderHandoff({ input, draft: result.draft, warnings: result.warnings }));
    const newState = await appendEvent(paths.events, { type: 'awaiting_approval' });

    return {
      taskId,
      state: newState,
      recordIds: result.draft.records.filter((/** @type {any} */ r) => r.op === 'add').map((/** @type {any} */ r) => r.id),
      warnings: result.warnings,
      handoffPath: paths.handoff,
      quickApproval: result.draft.records.length === 0,
      dashboardUrl: null,
    };
  });
}

/**
 * submit-draft.mjs: register the draft, then make sure the dashboard runs and open it once
 * per task. A dashboard problem never fails the submit: the draft and the waiting state are
 * kept and the hint tells the user how to reach the screen.
 * @param {{ home: string, taskId: string } & Pick<import('./dashboard-open.mjs').OpenOptions, 'ensure' | 'open'>} options
 */
export async function submitAndOpen({ home, taskId, ensure, open }) {
  const result = await submitDraft({ home, taskId });
  try {
    const d = await openDashboard({ home, taskId, once: true, ensure, open });
    return { ...result, dashboardUrl: d.url, browserOpened: d.opened, browserNote: d.reason, dashboardError: null };
  } catch (err) {
    const e = classifyError(err);
    return {
      ...result,
      dashboardUrl: null,
      browserOpened: false,
      browserNote: null,
      dashboardError: { code: e.code, message: e.message, hint: e.hint ?? null },
    };
  }
}
