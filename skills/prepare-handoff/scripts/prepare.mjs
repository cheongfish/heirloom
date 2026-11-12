// Freeze the handoff input. Prints one JSON object. See ../SKILL.md.
// node prepare.mjs --spec <path> [--spec ...] [--review <path>] [--reviewed-commit <sha>]
//   [--material <role>:<path>] [--sdlc-ref <id>] [--base <branch>] [--manual]

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../using-heirloom/lib/prepare.mjs';

await runScript(async () => {
  const args = parseCliArgs({
    spec: { type: 'string', multiple: true },
    review: { type: 'string', multiple: true },
    material: { type: 'string', multiple: true },
    'reviewed-commit': { type: 'string' },
    'sdlc-ref': { type: 'string' },
    base: { type: 'string' },
    manual: { type: 'boolean' },
  });
  const materials = (args.material ?? []).map((m) => {
    const at = m.indexOf(':');
    if (at <= 0) throw new HeirloomError('E_INPUT', `--material은 <역할>:<경로> 형식이어야 함: ${m}`);
    return { role: m.slice(0, at), ref: m.slice(at + 1) };
  });
  return prepareHandoff({
    cwd: process.cwd(),
    home: heirloomHome(),
    base: args.base ?? null,
    specs: args.spec ?? [],
    reviews: args.review ?? [],
    materials,
    sdlcRef: args['sdlc-ref'] ?? null,
    reviewedCommit: args['reviewed-commit'] ?? null,
    manual: args.manual ?? false,
  });
});
