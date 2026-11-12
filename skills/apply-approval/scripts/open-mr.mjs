// Create or update the GitLab merge request of an applied task. Prints one JSON object.
// See ../SKILL.md.
// node open-mr.mjs --task <taskId> --title <title> --body-file <file>
// node open-mr.mjs --task <taskId> --iid <n> --body-file <file>

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { openMergeRequest } from '../../using-heirloom/lib/merge-request.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, title: { type: 'string' }, 'body-file': { type: 'string' }, iid: { type: 'string' } });
  if (!args.task || !args['body-file']) throw new HeirloomError('E_INPUT', '--task와 --body-file이 필요함');
  const iid = args.iid === undefined ? undefined : Number(args.iid);
  if (iid !== undefined && !(Number.isInteger(iid) && iid > 0)) throw new HeirloomError('E_INPUT', `--iid가 MR 번호가 아님: ${args.iid}`);
  return openMergeRequest({ home: heirloomHome(), taskId: args.task, title: args.title, bodyFile: args['body-file'], iid });
});
