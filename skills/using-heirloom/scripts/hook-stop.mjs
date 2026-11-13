// Stop hook: remind the agent once per source state when every mechanical condition holds.
// Never blocks twice in a row, never fails, gives up after the time budget.
// Usage: hook-stop.mjs [<host>]   (the host's hooks file names it; Claude Code by default)

import { evaluateStop } from '../lib/reminder.mjs';
import { emit, hookHost, logHook, readStdinJson } from '../lib/hook-io.mjs';
import { heirloomHome } from '../lib/paths.mjs';

const budgetMs = Number(process.env.HEIRLOOM_HOOK_TIMEOUT_MS) || 2000;
const timer = setTimeout(() => process.exit(0), budgetMs);

const host = hookHost(process.argv[2]);
const raw = await readStdinJson();
const input = host.readHookInput(raw);
const home = heirloomHome();
/** @type {unknown} */
let output = host.emptyOutput;
try {
  const decision = !input.normalStop ? null : await evaluateStop({
    cwd: input.cwd ?? process.cwd(),
    home,
    stopHookActive: input.continuation,
    transcriptPath: input.transcriptPath,
  });
  if (decision?.remind) output = host.stopOutput(String(decision.message));
} catch (err) {
  process.stderr.write(`heirloom stop hook: ${err instanceof Error ? err.message : String(err)}\n`);
} finally {
  if (output !== null) emit(output);
  await logHook({ home, hook: 'stop', host: host.name, input: raw, output });
  clearTimeout(timer);
}
