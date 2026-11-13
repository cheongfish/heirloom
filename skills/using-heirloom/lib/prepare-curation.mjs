// Freeze the input of a context curation in its dedicated worktree: the batch of unreviewed
// decisions, the active records related to them, every active axiom and the review history
// of the target branch. Running it again returns the same frozen input.

import path from 'node:path';

import { loadProjectConfig } from './config.mjs';
import { readCurationTree, selectBatch } from './curation.mjs';
import { readCurationMeta } from './curation-worktree.mjs';
import { HeirloomError } from './errors.mjs';
import { appendEvent, countAttempts, deriveState, readEvents } from './events.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { repoInfo, resolveBase, tryGit } from './git.mjs';
import { readIds } from './ids.mjs';
import { repoPaths, taskPaths } from './paths.mjs';
import { findProjectRules } from './project-rules.mjs';
import { recordPath } from './records.mjs';
import { computeSourceState } from './state.mjs';
import { taskIdFor } from './store.mjs';
import { withTaskLock } from './task-lock.mjs';

/** States in which the frozen input is still the one being worked on. */
const OPEN = new Set(['prepared', 'drafted', 'awaiting_approval', 'approved', 'applied', 'pr_created']);

/**
 * The curation task of a dedicated worktree, or an input error when `cwd` is not one.
 * @param {{ home: string, cwd: string }} options
 */
export async function curationTaskOf({ home, cwd }) {
  const info = await repoInfo(cwd);
  const ids = await readIds(info, home);
  const taskId = ids ? await taskIdFor(home, { worktreeId: ids.worktreeId, branch: info.branch, specRef: null }, { create: false }) : null;
  const meta = taskId ? await readCurationMeta(home, taskId) : null;
  if (!taskId || !meta || meta.worktree !== info.root) {
    throw new HeirloomError('E_INPUT', `맥락 정리 전용 worktree가 아님: ${info.root}`, {
      hint: '정리는 대시보드의 \'정리 실행\'이 만든 worktree(~/.heirloom/worktrees/…)에서만 한다.',
    });
  }
  return { info, taskId, meta };
}

/**
 * @param {{ home: string, cwd: string }} options
 */
export async function prepareCuration({ home, cwd }) {
  const { info, taskId, meta } = await curationTaskOf({ home, cwd });
  const root = info.root;
  const paths = taskPaths(home, taskId);

  return withTaskLock(home, taskId, async () => {
    const events = await readEvents(paths.events);
    const state = deriveState(events);
    if (state === 'discarded' || state === 'expired') {
      throw new HeirloomError('E_CONFLICT', `끝난 정리 작업임 (상태: ${state})`, { hint: '대시보드에서 정리를 새로 실행한다.' });
    }
    if (state === 'stale') {
      throw new HeirloomError('E_CONFLICT', '승인 이후 정리 worktree의 파일이 바뀜', { hint: '정리 worktree에서는 기록 파일 외의 파일을 바꾸지 않는다. 사용자에게 알린다.' });
    }

    let input = /** @type {any} */ (await readJson(paths.input));
    const already = Boolean(input) && OPEN.has(String(state));
    /** @type {string[]} */
    let errors = [];
    if (!already) {
      const base = await resolveBase({ cwd: root, base: meta.base });
      const source = await computeSourceState({ root, mergeBase: base.mergeBase });
      const config = await loadProjectConfig(root);
      const tree = await readCurationTree({ root, ref: base.ref });
      errors = tree.errors;
      const picked = selectBatch({ records: tree.records, history: tree.history, batchSize: config.curation.batchSize });
      if (!picked.batch.length) {
        throw new HeirloomError('E_CONFLICT', `${base.ref}에 검토하지 않은 활성 decision이 없음`, { hint: '정리할 것이 없다. 사용자에게 알리고 작업을 폐기하게 한다.' });
      }
      input = {
        schemaVersion: 1,
        taskId,
        repo: { id: meta.repoId, root, remote: await tryGit(['remote', 'get-url', 'origin'], { cwd: root }) },
        worktree: { id: meta.worktreeId, path: root },
        branch: info.branch,
        base,
        sdlcTaskRef: null,
        trigger: 'curation',
        source,
        materials: [],
        unknowns: [],
        projectRules: await findProjectRules(root),
        createdAt: new Date().toISOString(),
        curation: { ...picked, history: tree.history },
      };
      await writeJsonAtomic(paths.input, input);
      await appendEvent(paths.events, { type: 'prepared', sourceHash: source.hash, attempt: countAttempts(events, source.hash) + 1 });
    }

    const { records } = await readCurationTree({ root, ref: 'HEAD' });
    const byId = new Map(records.map((r) => [r.id, r]));
    /** @param {string} id */
    const describe = (id) => {
      const r = byId.get(id);
      return {
        id,
        title: r?.title ?? null,
        file: r ? path.relative(root, recordPath(root, r)).split(path.sep).join('/') : null,
        codePaths: r?.codePaths ?? [],
        topics: r?.topics ?? [],
      };
    };
    const c = input.curation;
    return {
      taskId,
      state: deriveState(await readEvents(paths.events)),
      alreadyPrepared: already,
      worktree: root,
      branch: input.branch,
      base: input.base,
      taskDir: paths.dir,
      inputPath: paths.input,
      draftPath: paths.draft,
      inputSourceHash: input.source.hash,
      recordsDir: path.relative(root, repoPaths(root).dir),
      batch: c.batch.map(describe),
      related: c.related.map(describe),
      axioms: c.axioms.map(describe),
      closedCandidates: c.history.flatMap((/** @type {any} */ h) =>
        h.candidates.filter((/** @type {any} */ x) => x.decision !== 'accepted').map((/** @type {any} */ x) => ({ review: h.id, title: x.title, evidence: x.evidence, decision: x.decision, reason: x.reason ?? null })),
      ),
      errors,
    };
  });
}
