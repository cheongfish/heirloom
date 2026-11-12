// Fetch the full text of active decisions and axioms related to the current work.
// Prints one JSON object. See ../SKILL.md.
// node recall.mjs [--paths <p,...>]... [--topics <t,...>]... [--ids <id,...>]... [--limit <n>]

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { recall, splitList } from '../../using-heirloom/lib/recall.mjs';

await runScript(async () => {
  const args = parseCliArgs({
    paths: { type: 'string', multiple: true },
    topics: { type: 'string', multiple: true },
    ids: { type: 'string', multiple: true },
    limit: { type: 'string' },
  });
  let limit;
  if (args.limit !== undefined) {
    limit = Number(args.limit);
    if (!/^\d+$/.test(args.limit) || limit < 1) throw new HeirloomError('E_INPUT', `--limit은 1 이상의 정수여야 함: ${args.limit}`);
  }
  return recall({
    cwd: process.cwd(),
    home: heirloomHome(),
    paths: splitList(args.paths),
    topics: splitList(args.topics),
    ids: splitList(args.ids),
    limit,
  });
});
