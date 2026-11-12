// Open or update the GitLab merge request of an applied task.
//
// GitHub PRs are created by the agent with `gh pr create --body-file`. glab has no body-file
// option, and a body handed over on the command line (`--description "$(cat …)"` or a quoted
// multi-line literal) cannot be checked by the agent's permission rules, so a run nobody can
// confirm refuses it. This script reads the body file and calls glab without a shell instead.
// It only talks to GitLab: the agent still records the MR with complete.mjs.

import { readFile } from 'node:fs/promises';

import { HeirloomError } from './errors.mjs';
import { deriveState, readEvents } from './events.mjs';
import { readJson } from './fsx.mjs';
import { createMr, findOpenMr, glabReady, updateMrBody } from './gitlab.mjs';
import { taskPaths } from './paths.mjs';
import { remoteProvider, taskRemote } from './remote.mjs';

/**
 * @param {{ home: string, taskId: string, bodyFile: string, title?: string, iid?: number }} options
 *   without `iid` the MR is created (or found when it already exists); with `iid` its body is replaced
 * @returns {Promise<{ action: 'created' | 'found' | 'updated', iid: number, url: string }>}
 */
export async function openMergeRequest({ home, taskId, bodyFile, title, iid }) {
  const paths = taskPaths(home, taskId);
  const input = /** @type {any} */ (await readJson(paths.input));
  if (!input) throw new HeirloomError('E_INPUT', `작업이 없음: ${taskId}`);
  const state = deriveState(await readEvents(paths.events));
  // Creating needs the written records; a body can also be updated after the MR was recorded.
  if (state !== 'applied' && !(iid !== undefined && state === 'pr_created')) {
    throw new HeirloomError('E_CONFLICT', `기록 반영 뒤에만 MR을 만들거나 고칠 수 있음 (현재 상태: ${state ?? '없음'})`, { hint: 'apply.mjs를 먼저 실행한다.' });
  }
  if (iid === undefined && !title?.trim()) throw new HeirloomError('E_INPUT', 'MR을 만들려면 --title이 필요함');
  let body;
  try {
    body = await readFile(bodyFile, 'utf8');
  } catch {
    throw new HeirloomError('E_INPUT', `본문 파일을 읽지 못함: ${bodyFile}`);
  }

  const root = input.repo.root;
  const { branch: base, url } = await taskRemote(root, input.base.ref);
  const { provider, host, repo } = await remoteProvider({ cwd: root, url });
  if (provider !== 'gitlab' || !host || !repo) throw new HeirloomError('E_INPUT', 'GitLab 원격이 아님. GitHub는 gh pr create --body-file로 만든다.');
  const ready = await glabReady({ cwd: root, host });
  if (!ready.ok) {
    throw new HeirloomError('E_INPUT', ready.reason === 'glab_missing' ? 'glab 실행 파일을 찾지 못함' : `glab이 ${host}에 로그인되어 있지 않음`, {
      hint: ready.reason === 'glab_missing' ? undefined : `사용자가 glab auth login --hostname ${host}를 실행해야 한다.`,
    });
  }
  const head = input.branch;
  if (!head) throw new HeirloomError('E_INPUT', 'MR을 만들 브랜치가 없음(분리된 HEAD)');

  if (iid !== undefined) {
    await updateMrBody({ cwd: root, host, repo, iid, body });
    const mr = await findOpenMr({ cwd: root, host, repo, head });
    return { action: 'updated', iid, url: mr?.iid === iid ? mr.url : `https://${host}/${repo}/-/merge_requests/${iid}` };
  }
  const existing = await findOpenMr({ cwd: root, host, repo, head });
  if (existing) return { action: 'found', iid: existing.iid, url: existing.url };
  const created = await createMr({ cwd: root, host, repo, head, base, title: /** @type {string} */ (title).trim(), body });
  const mr = await findOpenMr({ cwd: root, host, repo, head }).catch(() => null);
  if (mr) return { action: 'created', iid: mr.iid, url: mr.url };
  const n = created ? Number(/merge_requests\/(\d+)$/.exec(created)?.[1]) : NaN;
  if (!created || !Number.isInteger(n)) throw new HeirloomError('E_INTERNAL', 'glab mr create가 MR URL을 알려 주지 않음', { hint: '다시 실행하면 이미 만든 MR을 찾아 돌려준다.' });
  return { action: 'created', iid: n, url: created };
}
