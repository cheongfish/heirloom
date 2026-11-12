// Wait until the submitted handoff is approved, discarded or expired. Prints one JSON object.
// Run it in the background after submit-draft.mjs. See ../SKILL.md.
// node wait-approval.mjs --task <taskId> [--timeout-minutes <n>]

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { waitForApproval } from '../../using-heirloom/lib/wait-approval.mjs';

const DEFAULT_MINUTES = 60;

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, 'timeout-minutes': { type: 'string' } });
  if (!args.task) throw new HeirloomError('E_INPUT', '--task가 필요함');
  const minutes = args['timeout-minutes'] === undefined ? DEFAULT_MINUTES : Number(args['timeout-minutes']);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new HeirloomError('E_INPUT', '--timeout-minutes는 0보다 큰 수여야 함');
  return waitForApproval({ home: heirloomHome(), taskId: args.task, timeoutMs: minutes * 60_000 });
});
