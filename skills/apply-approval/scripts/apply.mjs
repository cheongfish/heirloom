// Verify a signed approval and write the approved records. Prints one JSON object. See ../SKILL.md.
// node apply.mjs                 list approved but unfinished handoffs of this worktree
// node apply.mjs --task <taskId> apply one

import { applyApproval, listPendingApprovals } from '../../using-heirloom/lib/apply.mjs';
import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' } });
  const home = heirloomHome();
  if (!args.task) return { pending: await listPendingApprovals({ home, cwd: process.cwd() }) };
  return applyApproval({ home, taskId: args.task });
});
