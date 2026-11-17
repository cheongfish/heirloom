// Write the "사람이 확인한 동작" paragraph of the task's judgment into a PR body file.
// Prints one JSON object. See ../SKILL.md.
// node pr-body.mjs --task <taskId> --body-file <file> [--rechecking]

import path from 'node:path';

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { writePrBody } from '../../using-heirloom/lib/judgment-pr.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, 'body-file': { type: 'string' }, rechecking: { type: 'boolean' } });
  if (!args.task || !args['body-file']) throw new HeirloomError('E_INPUT', '--task와 --body-file이 필요함');
  return writePrBody({ home: heirloomHome(), taskId: String(args.task), bodyFile: path.resolve(String(args['body-file'])), rechecking: Boolean(args.rechecking) });
});
