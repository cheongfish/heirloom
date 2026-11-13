// Add spec location patterns to the project setting .heirloom/config.json (created when
// missing). Run only when the user asked for it. Prints one JSON object. See ../SKILL.md.
// node add-spec-globs.mjs --glob <pattern> [--glob <pattern> ...]

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { addSpecGlobs } from '../../using-heirloom/lib/config.mjs';
import { runScript } from '../../using-heirloom/lib/errors.mjs';
import { repoInfo } from '../../using-heirloom/lib/git.mjs';

await runScript(async () => {
  const args = parseCliArgs({ glob: { type: 'string', multiple: true } });
  const { root } = await repoInfo(process.cwd());
  return addSpecGlobs(root, /** @type {string[]} */ (args.glob ?? []));
});
