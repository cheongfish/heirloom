// Dashboard server process, started detached by lib/server-control.mjs.
// Writes ~/.heirloom/server/server.json while running and exits when idle (MVP-PLAN 6.2).

import { appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadUserConfig } from '../lib/config.mjs';
import { readJson, writeJsonAtomic } from '../lib/fsx.mjs';
import { ensureDir, heirloomHome, homePaths } from '../lib/paths.mjs';
import { codeHash, resolvePort } from '../lib/server-control.mjs';
import { VERSION } from '../lib/version.mjs';
import { createDashboardServer } from './server.mjs';

const home = heirloomHome();
const serverDir = homePaths(home).server;
const serverJson = path.join(serverDir, 'server.json');
const logFile = path.join(serverDir, 'server.log');
await ensureDir(serverDir);

/** @param {string} line */
const log = (line) => void appendFile(logFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }).catch(() => {});

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const hash = process.env.HEIRLOOM_TEST_CODE_HASH || (await codeHash(pluginRoot));
const config = await loadUserConfig(home);

/** @type {Awaited<ReturnType<typeof createDashboardServer>> | undefined} */
let server;
let stopping = false;
/** @param {string} reason */
async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  log(`shutdown: ${reason}`);
  await server?.close();
  const info = /** @type {{ pid?: number } | undefined} */ (await readJson(serverJson).catch(() => undefined));
  if (info?.pid === process.pid) await rm(serverJson, { force: true });
  process.exit(0);
}

try {
  server = await createDashboardServer({
    home,
    port: await resolvePort(home),
    version: VERSION,
    codeHash: hash,
    idleMs: config.dashboard.idleMinutes * 60_000,
    onIdle: () => void shutdown('idle'),
    log,
  });
} catch (err) {
  log(`start failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
await writeJsonAtomic(serverJson, {
  schemaVersion: 1,
  pid: process.pid,
  port: server.port,
  version: VERSION,
  codeHash: hash,
  startedAt: new Date().toISOString(),
});
log(`started pid=${process.pid} port=${server.port} version=${VERSION}`);
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
