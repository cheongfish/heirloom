// Start (or reuse) the dashboard server and open a task screen or the overview.
// Prints one JSON object. See ../SKILL.md.
// node open-dashboard.mjs [--task <taskId>] [--no-browser]

import { parseCliArgs } from '../lib/args.mjs';
import { runScript } from '../lib/errors.mjs';
import { openDashboard } from '../lib/dashboard-open.mjs';
import { heirloomHome } from '../lib/paths.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, 'no-browser': { type: 'boolean' } });
  const noBrowser = Boolean(args['no-browser']);
  const result = await openDashboard({
    home: heirloomHome(),
    taskId: typeof args.task === 'string' ? args.task : undefined,
    ...(noBrowser ? { open: async () => ({ opened: false, reason: 'no_browser' }) } : {}),
  });
  return result;
});
