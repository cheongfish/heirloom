// The person's allowance of probe commands. A probe run starts commands the agent wrote (setup,
// probes, tests) with the user's permissions, so before anything runs the person reads every
// command in the dashboard and allows or denies them. The answer is signed. An allowance
// covers the exact argument vectors in it: the same command in the same repository later runs
// without asking again. It does not cover what a command does with the repository's code; a
// test command that was allowed once runs whatever the tests are at that time.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { openBrowser } from './browser.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';
import { loadProjectConfig, loadUserConfig } from './config.mjs';
import { openDashboard } from './dashboard-open.mjs';
import { HeirloomError, classifyError } from './errors.mjs';
import { appendEvent, deriveState, readEvents } from './events.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { tryGit } from './git.mjs';
import { newApprovalId } from './ids.mjs';
import { ensureDir, homePaths, taskPaths } from './paths.mjs';
import { checkProbeSpec, runProbes } from './probe.mjs';
import { PATTERNS, assertValid, probePermitRequestSchema, probePermitSchema, validate } from './schema.mjs';
import { sign, verify } from './sign.mjs';
import { withTaskLock } from './task-lock.mjs';

/** Default wait for the person's answer in one probe.mjs call. */
export const PERMIT_WAIT_MINUTES = 8;
const MAX_REASON = 2000;
/** States in which probes may run, and so may be allowed. */
const PROBING = new Set(['prepared', 'drafted']);

/**
 * @typedef {object} ProbeCommand
 * @property {'setup' | 'probe' | 'tests'} role
 * @property {string} [id] probe id
 * @property {string} [title] probe title
 * @property {string[]} run
 */

/** @param {string[]} run */
const commandKey = (run) => canonicalJson(run);

/**
 * Every command a probe run of this spec starts, in run order. `setup` is already resolved
 * (the probes file's, or the project's).
 * @param {import('./probe.mjs').ProbeSpec & { setup: string[][] }} spec
 * @returns {ProbeCommand[]}
 */
export function probeCommands(spec) {
  return [
    ...spec.setup.map((run) => ({ role: /** @type {const} */ ('setup'), run })),
    ...spec.probes.map((p) => ({ role: /** @type {const} */ ('probe'), id: p.id, title: p.title, run: p.run })),
    ...(spec.tests ? [{ role: /** @type {const} */ ('tests'), run: spec.tests.command }] : []),
  ];
}

/**
 * @param {string} taskId
 * @param {ProbeCommand[]} commands
 */
const requestDigest = (taskId, commands) => sha256Hex(canonicalJson({ taskId, commands: commands.map(({ role, id, run }) => ({ role, id: id ?? null, run })) }));

/**
 * A signed permit, or null when the file is not one (unsigned, tampered, another key).
 * @param {string} home
 * @param {string} file
 */
async function readPermit(home, file) {
  const record = /** @type {any} */ (await readJson(file).catch(() => undefined));
  if (record === undefined || validate(probePermitSchema, record).length) return null;
  return (await verify(home, record)).ok ? record : null;
}

/**
 * Signed permits of one task.
 * @param {string} home
 * @param {string} taskId
 */
async function taskPermits(home, taskId) {
  const dir = taskPaths(home, taskId).probePermits;
  let names = [];
  try {
    names = (await readdir(dir)).filter((n) => /^ap-[0-9a-z]+\.json$/.test(n));
  } catch {
    return [];
  }
  /** @type {any[]} */
  const out = [];
  for (const n of names) {
    const p = await readPermit(home, path.join(dir, n));
    if (p) out.push(p);
  }
  return out;
}

/**
 * Commands the person allowed in this repository, across its tasks.
 * @param {string} home
 * @param {string} repoId
 * @returns {Promise<Set<string>>}
 */
async function allowedCommands(home, repoId) {
  /** @type {Set<string>} */
  const allowed = new Set();
  let ids = [];
  try {
    ids = (await readdir(homePaths(home).tasks)).filter((n) => PATTERNS.taskId.test(n));
  } catch {
    return allowed;
  }
  for (const id of ids) {
    for (const p of await taskPermits(home, id)) {
      if (p.decision === 'allowed' && p.repoId === repoId) for (const c of p.commands) allowed.add(commandKey(c.run));
    }
  }
  return allowed;
}

/**
 * The person's answer to one request of a task, or null while it waits.
 * @param {string} home
 * @param {string} taskId
 * @param {string} sha256
 */
async function answerTo(home, taskId, sha256) {
  return (await taskPermits(home, taskId)).find((p) => p.requestSha256 === sha256) ?? null;
}

/** @param {any} permit */
function denied(permit) {
  return new HeirloomError('E_INPUT', `사람이 탐침 명령을 거절함: ${permit.reason ?? '(이유 없음)'}`, {
    hint: '거절 이유에 맞게 탐침 파일을 고친 뒤 probe.mjs를 다시 실행한다. 같은 명령 묶음은 다시 묻지 않고 거절된다.',
  });
}

/**
 * Check the probes file and find the commands the person has not allowed in this repository.
 * Registers a new request for them (replacing an older one of this task) when needed.
 * @param {{ home: string, taskId: string, spec: unknown, specLabel: string, now: Date }} options
 */
async function prepareRequest({ home, taskId, spec: rawSpec, specLabel, now }) {
  const paths = taskPaths(home, taskId);
  return withTaskLock(home, taskId, async () => {
    const input = /** @type {any} */ (await readJson(paths.input));
    if (input === undefined) throw new HeirloomError('E_INPUT', `준비된 인계 입력이 없음: ${taskId}`, { hint: 'prepare를 먼저 실행한다.' });
    const state = deriveState(await readEvents(paths.events));
    if (!PROBING.has(state ?? '')) {
      throw new HeirloomError('E_CONFLICT', `현재 상태(${state ?? '없음'})에서는 탐침을 실행할 수 없음`, { hint: '새 변경을 인계하려면 prepare를 다시 실행한다.' });
    }
    const config = (await loadProjectConfig(input.repo.root)).probe;
    const checked = checkProbeSpec(rawSpec, config, specLabel);
    // The setup is fixed here, so a later change of the project setting cannot slip past the allowance.
    const spec = { ...checked, setup: checked.setup ?? config.setup };
    const commands = probeCommands(spec);
    const allowed = await allowedCommands(home, input.repo.id);
    const sha256 = requestDigest(taskId, commands);
    if (commands.every((c) => allowed.has(commandKey(c.run)))) return { spec, sha256, ready: /** @type {const} */ ('remembered') };
    const answer = await answerTo(home, taskId, sha256);
    if (answer?.decision === 'denied') throw denied(answer);
    if (answer) return { spec, sha256, ready: /** @type {const} */ ('allowed'), permitId: /** @type {string} */ (answer.id) };

    const known = commands.map((c) => ({ ...c, known: allowed.has(commandKey(c.run)) }));
    const current = /** @type {any} */ (await readJson(paths.probePermitRequest));
    const fresh = current?.sha256 !== sha256;
    if (fresh) {
      const request = { schemaVersion: 1, taskId, repoId: input.repo.id, sha256, requestedAt: now.toISOString(), commands: known };
      assertValid(probePermitRequestSchema, request, 'probe permit request');
      await writeJsonAtomic(paths.probePermitRequest, request);
      await appendEvent(paths.events, { type: 'probe_permit_requested', requestSha256: sha256, newCommands: known.filter((c) => !c.known).length });
    }
    return { spec, sha256, ready: null, fresh, unknown: known.filter((c) => !c.known) };
  });
}

/**
 * probe.mjs: run the probes once the person has allowed every command. Commands allowed
 * before in this repository run right away. Otherwise the request is shown in the dashboard
 * and this waits up to `timeoutMs` for the answer: allowed runs, denied fails with the reason,
 * and no answer yet returns `permission.state: "pending"` (run the same command again).
 * @param {{ home: string, taskId: string, spec: unknown, specLabel?: string, timeoutMs: number, pollMs?: number, now?: Date }
 *   & Pick<import('./dashboard-open.mjs').OpenOptions, 'ensure' | 'open'>} options
 */
export async function runPermittedProbes({ home, taskId, spec: rawSpec, specLabel = 'probes', timeoutMs, pollMs = 1000, now = new Date(), ensure, open = openBrowser }) {
  const prepared = await prepareRequest({ home, taskId, spec: rawSpec, specLabel, now });
  const run = async (/** @type {string | null} */ permitId) => ({
    ...(await runProbes({ home, taskId, spec: prepared.spec, specLabel, permit: { permitId }, now })),
    permission: { state: 'allowed', permitId },
  });
  if (prepared.ready === 'remembered') return run(null);
  if (prepared.ready === 'allowed') return run(/** @type {string} */ (prepared.permitId));

  // Show the request. The browser opens only for a new request and when the user allows it.
  /** @type {{ url: string | null, opened: boolean, error: { code: string, message: string, hint: string | null } | null }} */
  let screen = { url: null, opened: false, error: null };
  try {
    const openNow = prepared.fresh && (await loadUserConfig(home)).dashboard.openBrowser;
    const d = await openDashboard({ home, taskId, ensure, open: openNow ? open : async () => ({ opened: false }) });
    screen = { url: d.url, opened: d.opened, error: null };
  } catch (err) {
    const e = classifyError(err);
    screen = { url: null, opened: false, error: { code: e.code, message: e.message, hint: e.hint ?? null } };
  }

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const answer = await answerTo(home, taskId, prepared.sha256);
    if (answer?.decision === 'denied') throw denied(answer);
    if (answer) return run(answer.id);
    if (Date.now() >= deadline) {
      return {
        taskId,
        permission: {
          state: 'pending',
          requestSha256: prepared.sha256,
          commands: (prepared.unknown ?? []).map(({ role, id, run: argv }) => ({ role, ...(id ? { id } : {}), run: argv })),
          dashboardUrl: screen.url,
          browserOpened: screen.opened,
          dashboardError: screen.error,
        },
        timedOut: true,
      };
    }
    await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
  }
}

/**
 * The request the screen shows, with the person's answer if there is one. Null when the task
 * never asked.
 * @param {{ home: string, taskId: string }} options
 */
export async function probePermitView({ home, taskId }) {
  const paths = taskPaths(home, taskId);
  const request = /** @type {any} */ (await readJson(paths.probePermitRequest));
  if (request === undefined || validate(probePermitRequestSchema, request).length) return null;
  const answer = await answerTo(home, taskId, request.sha256);
  const state = deriveState(await readEvents(paths.events));
  return {
    request,
    pending: !answer && PROBING.has(state ?? ''),
    answer: answer ? { id: answer.id, decision: answer.decision, reason: answer.reason ?? null, decidedAt: answer.decidedAt } : null,
  };
}

/**
 * Whether a task waits for the person's allowance, from its event log alone (for the list).
 * @param {import('./events.mjs').TaskEvent[]} events
 */
export function permitPending(events) {
  const state = deriveState(events);
  if (!PROBING.has(state ?? '')) return false;
  const asked = events.filter((e) => e.type === 'probe_permit_requested').at(-1);
  if (!asked) return false;
  return !events.some((e) => e.type === 'probe_permit_decided' && e.requestSha256 === asked.requestSha256);
}

/**
 * Sign the person's answer to the task's current request.
 * @param {{ home: string, taskId: string, request: unknown, keystore?: import('./sign.mjs').Keystore, now?: Date }} options
 */
export async function decideProbePermit({ home, taskId, request: body, keystore, now = new Date() }) {
  const paths = taskPaths(home, taskId);
  return withTaskLock(home, taskId, async () => {
    const b = /** @type {any} */ (body);
    if (typeof b !== 'object' || b === null || typeof b.requestSha256 !== 'string' || (b.decision !== 'allowed' && b.decision !== 'denied')) {
      throw new HeirloomError('E_INPUT', 'requestSha256과 decision(allowed 또는 denied)이 필요함');
    }
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length > MAX_REASON) throw new HeirloomError('E_INPUT', `이유는 ${MAX_REASON}자 이하여야 함`);
    if (b.decision === 'denied' && !reason) throw new HeirloomError('E_INPUT', '거절할 때는 이유가 필요함');
    const state = deriveState(await readEvents(paths.events));
    if (!PROBING.has(state ?? '')) throw new HeirloomError('E_CONFLICT', `탐침 실행을 허락할 수 있는 상태가 아님 (현재: ${state ?? '없음'})`);
    const request = /** @type {any} */ (await readJson(paths.probePermitRequest));
    if (request === undefined) throw new HeirloomError('E_CONFLICT', '허락을 기다리는 탐침 명령이 없음');
    if (request.sha256 !== b.requestSha256) throw new HeirloomError('E_CONFLICT', '화면이 보던 탐침 명령이 현재 요청과 다름. 화면을 새로 고친다.');
    if (await answerTo(home, taskId, request.sha256)) throw new HeirloomError('E_CONFLICT', '이 탐침 명령에는 이미 답함');
    const ident = await tryGit(['var', 'GIT_AUTHOR_IDENT'], { cwd: (/** @type {any} */ (await readJson(paths.input)))?.repo.root ?? process.cwd() });
    const record = {
      schemaVersion: 1,
      id: newApprovalId(),
      kind: 'probe-permit',
      taskId,
      repoId: request.repoId,
      requestSha256: request.sha256,
      commands: request.commands.map((/** @type {any} */ { known: _known, ...c }) => c),
      decision: b.decision,
      ...(reason ? { reason } : {}),
      decidedAt: now.toISOString(),
      approver: { fingerprint: '', gitUser: ident ? ident.replace(/\s+\d+\s+[+-]\d{4}$/, '') : null },
    };
    const signed = await sign(home, record, { keystore });
    assertValid(probePermitSchema, signed, 'probe permit');
    await ensureDir(paths.probePermits);
    await writeJsonAtomic(path.join(paths.probePermits, `${signed.id}.json`), signed);
    await appendEvent(paths.events, { type: 'probe_permit_decided', requestSha256: request.sha256, decision: signed.decision, permitId: signed.id });
    return signed;
  });
}
