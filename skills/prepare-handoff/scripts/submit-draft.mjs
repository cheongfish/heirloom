// Check the draft and register it for approval. Prints one JSON object. See ../SKILL.md.
// node submit-draft.mjs --task <taskId>

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { submitDraft } from '../../using-heirloom/lib/submit.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' } });
  if (!args.task) throw new HeirloomError('E_INPUT', '--task가 필요함');
  return submitDraft({ home: heirloomHome(), taskId: args.task });
});
