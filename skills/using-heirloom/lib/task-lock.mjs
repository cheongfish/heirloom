// Per-task lock: prepare and submit for the same task never run concurrently (PLAN 8).

import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { withLock } from './fsx.mjs';
import { taskPaths } from './paths.mjs';

/**
 * @template T
 * @param {string} home
 * @param {string} taskId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTaskLock(home, taskId, fn) {
  try {
    return await withLock(path.join(taskPaths(home, taskId).dir, 'task'), fn, { timeoutMs: 0 });
  } catch (err) {
    if (err instanceof HeirloomError && err.code === 'E_TRANSIENT' && /잠금/.test(err.message)) {
      throw new HeirloomError('E_CONFLICT', `같은 작업(${taskId})의 인계 처리가 이미 진행 중임`, {
        hint: '진행 중인 처리가 끝난 뒤 결과를 확인한다. 같은 상태로 다시 실행하지 않는다.',
      });
    }
    throw err;
  }
}
