// Record that the pull request was created. Prints one JSON object. See ../SKILL.md.
// node complete.mjs --task <taskId> --pr-url <url>

import { completePr } from '../../using-heirloom/lib/apply.mjs';
import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, 'pr-url': { type: 'string' } });
  if (!args.task || !args['pr-url']) throw new HeirloomError('E_INPUT', '--task와 --pr-url이 필요함');
  return completePr({ home: heirloomHome(), taskId: args.task, prUrl: args['pr-url'] });
});
