// SessionStart hook (startup, resume, clear, compact): inject the convention and project index.
// Never fails the session: any error degrades to a shorter context.
// Usage: hook-session-start.mjs [<host>]   (the host's hooks file names it; Claude Code by default)
// HEIRLOOM_DISABLE_CONVENTION=1 injects nothing. It is for evaluations that check whether the
// Stop reminder alone leads to a handoff; it is not a user setting.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordSession } from '../lib/conversation.mjs';
import { emit, hookCwd, hookHost, logHook, readStdinJson } from '../lib/hook-io.mjs';
import { heirloomHome } from '../lib/paths.mjs';
import { buildSessionContext } from '../lib/session-context.mjs';
import { recordSessionHost, sessionHostOf } from '../lib/session-host.mjs';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const host = hookHost(process.argv[2]);
const raw = await readStdinJson();
const input = host.readHookInput(raw);
const cwd = await hookCwd(input);
const home = heirloomHome();

/** @type {unknown} */
let output = host.emptyOutput;
if (process.env.HEIRLOOM_DISABLE_CONVENTION !== '1') {
  let context;
  try {
    context = await buildSessionContext({ cwd, home, pluginRoot });
  } catch (err) {
    context = `Heirloom: 세션 맥락을 만들지 못했다: ${err instanceof Error ? err.message : String(err)}`;
  }
  output = host.sessionStartOutput(context);
}
if (output !== null) emit(output);
// Context curation of this repository runs with the host of its latest session.
const sessionHost = sessionHostOf(process.argv[2], raw);
if (sessionHost) {
  try {
    await recordSessionHost({ home, cwd, host: sessionHost });
  } catch (err) {
    process.stderr.write(`heirloom session-start: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
// A handoff quotes the messages of the session it runs in; prepare finds the session here.
await recordSession({ home, cwd, transcriptPath: input.transcriptPath });
await logHook({ home, hook: 'session-start', host: host.name, input: raw, output });
