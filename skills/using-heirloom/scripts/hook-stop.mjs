// Stop hook: remind the agent once per source state when every mechanical condition holds
// (PLAN 7.5). Never blocks twice in a row, never fails, gives up after the time budget.

import { evaluateStop } from '../lib/reminder.mjs';
import { emit, readStdinJson } from '../lib/hook-io.mjs';
import { heirloomHome } from '../lib/paths.mjs';

const budgetMs = Number(process.env.HEIRLOOM_HOOK_TIMEOUT_MS) || 2000;
const timer = setTimeout(() => process.exit(0), budgetMs);

const input = await readStdinJson();
try {
  const decision = await evaluateStop({
    cwd: typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    home: heirloomHome(),
    stopHookActive: input.stop_hook_active === true,
  });
  if (decision.remind) emit({ decision: 'block', reason: decision.message });
} catch (err) {
  process.stderr.write(`heirloom stop hook: ${err instanceof Error ? err.message : String(err)}\n`);
} finally {
  clearTimeout(timer);
}
