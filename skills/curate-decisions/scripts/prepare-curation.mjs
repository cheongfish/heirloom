// Freeze the input of a context curation. Prints one JSON object. See ../SKILL.md.
// node prepare-curation.mjs [--worktree <path>]   run in (or point at) the dedicated worktree

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { prepareCuration } from '../../using-heirloom/lib/prepare-curation.mjs';

await runScript(async () => {
  const args = parseCliArgs({ worktree: { type: 'string' } });
  return prepareCuration({ home: heirloomHome(), cwd: args.worktree ?? process.cwd() });
});
