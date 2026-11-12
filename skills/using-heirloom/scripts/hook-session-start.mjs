// SessionStart hook (startup, resume, clear, compact): inject the convention and project index.
// Never fails the session: any error degrades to a shorter context.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emit, readStdinJson } from '../lib/hook-io.mjs';
import { heirloomHome } from '../lib/paths.mjs';
import { buildSessionContext } from '../lib/session-context.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const input = await readStdinJson();
const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();

let context;
try {
  context = await buildSessionContext({ cwd, home: heirloomHome(), pluginRoot });
} catch (err) {
  context = `Heirloom: 세션 맥락을 만들지 못했다: ${err instanceof Error ? err.message : String(err)}`;
}
emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
