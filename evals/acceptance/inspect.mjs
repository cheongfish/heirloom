// 수용 점검용 상태 보기: HEIRLOOM_HOME의 작업마다 상태, 이벤트 수, 승인, PR을 출력한다.
// 사용법: HEIRLOOM_HOME=<dir> node evals/acceptance/inspect.mjs [--events <taskId>]
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { heirloomHome, taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

const home = heirloomHome();
const i = process.argv.indexOf('--events');
if (i !== -1) {
  for (const e of await readEvents(taskPaths(home, process.argv[i + 1]).events)) console.log(JSON.stringify(e));
  process.exit(0);
}

let ids = [];
try {
  ids = (await readdir(path.join(home, 'tasks'))).filter((n) => n.startsWith('t-')).sort();
} catch {
  console.log(`작업 없음: ${home}`);
  process.exit(0);
}
console.log(`HEIRLOOM_HOME=${home}`);
for (const taskId of ids) {
  const p = taskPaths(home, taskId);
  const events = await readEvents(p.events);
  let input = null;
  try {
    input = JSON.parse(await readFile(p.input, 'utf8'));
  } catch {
    // not prepared yet
  }
  let approvals = 0;
  try {
    approvals = (await readdir(p.approvals)).filter((n) => n.endsWith('.json')).length;
  } catch {
    // none
  }
  const count = (/** @type {string} */ type) => events.filter((e) => e.type === type).length;
  const pr = events.filter((e) => e.type === 'pr_created').at(-1)?.url ?? '-';
  let state;
  try {
    state = deriveState(events);
  } catch (err) {
    state = `잘못된 이벤트: ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(
    [
      `\n${taskId}  상태=${state}`,
      `  브랜치=${input?.branch ?? '-'}  작업트리=${input?.worktree?.path ?? '-'}`,
      `  prepared=${count('prepared')} approved=${count('approved')} approval_received=${count('approval_received')} records_written=${count('records_written')} pr_created=${count('pr_created')} stale=${count('stale')} expired=${count('expired')}`,
      `  승인 파일=${approvals}  PR=${pr}  마지막 이벤트=${events.at(-1)?.type ?? '-'} ${events.at(-1)?.at ?? ''}`,
      `  unknowns=${JSON.stringify(input?.unknowns ?? [])}`,
    ].join('\n'),
  );
}
