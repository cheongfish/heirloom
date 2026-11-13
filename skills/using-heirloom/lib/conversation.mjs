// The conversation as a decision source. A decision made in the chat has no document to quote,
// so a handoff freezes the messages the person typed in the session and the draft may quote
// them (`ref: "@conversation"`). Only the person's own messages count: the agent's replies and
// the text the harness adds as the user are left out, so the agent cannot cite itself.
//
// prepare runs as a command of the agent. When the host names the session's transcript in the
// agent's environment (Cursor), prepare uses it. Otherwise the SessionStart and Stop hooks
// record each session's transcript per worktree, and prepare takes the session that was active
// last. When two sessions of the same worktree overlapped recently it cannot tell which one
// asks, and leaves the conversation out instead of guessing.

import { createHash } from 'node:crypto';
import path from 'node:path';

import { readJson, withLock, writeJsonAtomic } from './fsx.mjs';
import { repoInfo } from './git.mjs';
import { transcriptFromEnv } from './hosts/index.mjs';
import { homePaths } from './paths.mjs';
import { utterancesInTranscript } from './transcript.mjs';

/** The `ref` of a source that quotes the conversation. Not a valid repository file path. */
export const CONVERSATION_REF = '@conversation';

/** Sessions seen within this time count as running when sessions overlap. */
const ACTIVE_MS = 2 * 60 * 60 * 1000;
/** Sessions not seen for this long are dropped from the list. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

/**
 * @typedef {object} SessionEntry
 * @property {string} transcriptPath
 * @property {string} startedAt first hook seen for the session
 * @property {string} lastAt last hook seen for the session
 * @property {boolean} [noticed] the session was told once that work without a spec can be handed off
 */

/** @param {string} text */
export const sha256Of = (text) => createHash('sha256').update(text).digest('hex');

/** @param {string} s */
const normalize = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * @param {string} home
 * @param {string} root worktree root as git reports it
 */
function sessionsFile(home, root) {
  return path.join(homePaths(home).sessions, `${sha256Of(root).slice(0, 16)}.json`);
}

/**
 * @param {string} home
 * @param {string} root
 * @returns {Promise<SessionEntry[]>}
 */
export async function readSessions(home, root) {
  const data = /** @type {any} */ (await readJson(sessionsFile(home, root)).catch(() => undefined));
  return Array.isArray(data?.sessions) ? data.sessions.filter((/** @type {any} */ s) => typeof s?.transcriptPath === 'string') : [];
}

/**
 * @param {string} home
 * @param {string} root
 * @param {(sessions: SessionEntry[]) => SessionEntry[]} fn
 */
async function updateSessions(home, root, fn) {
  const file = sessionsFile(home, root);
  await withLock(file, async () => {
    const sessions = fn(await readSessions(home, root));
    await writeJsonAtomic(file, { schemaVersion: 1, root, sessions });
  }, { timeoutMs: 1000 });
}

/**
 * Record that a session of this worktree is active. Called by the SessionStart and Stop hooks.
 * @param {{ home: string, root: string, transcriptPath: string, now?: Date }} options
 */
export async function touchSession({ home, root, transcriptPath, now = new Date() }) {
  const at = now.toISOString();
  await updateSessions(home, root, (sessions) => {
    const kept = sessions.filter((s) => s.transcriptPath !== transcriptPath && now.getTime() - Date.parse(s.lastAt) < KEEP_MS);
    const entry = sessions.find((s) => s.transcriptPath === transcriptPath);
    return [...kept, { ...entry, transcriptPath, startedAt: entry?.startedAt ?? at, lastAt: at }]
      .sort((a, b) => a.lastAt.localeCompare(b.lastAt))
      .slice(-MAX_SESSIONS);
  });
}

/**
 * The hooks' entry: record the session of the worktree `cwd` is in. Outside a git repository,
 * or without a transcript, it does nothing; it never throws.
 * @param {{ home: string, cwd: string, transcriptPath: string | undefined }} options
 */
export async function recordSession({ home, cwd, transcriptPath }) {
  if (!transcriptPath) return;
  try {
    const { root } = await repoInfo(cwd);
    await touchSession({ home, root, transcriptPath });
  } catch (err) {
    process.stderr.write(`heirloom: 세션 기록 경로를 남기지 못함: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * The session prepare runs in: the one active last. Null with a reason when no session was
 * recorded, or when another session of the worktree ran at the same time recently.
 * A transcript the host names in the agent's environment (Cursor) is the session itself and
 * comes first.
 * @param {{ home: string, root: string, now?: Date, env?: Record<string, string | undefined> }} options
 * @returns {Promise<{ transcriptPath: string, reason: null } | { transcriptPath: null, reason: 'no_session' | 'ambiguous' }>}
 */
export async function currentSession({ home, root, now = new Date(), env = process.env }) {
  const named = transcriptFromEnv(env);
  if (named) return { transcriptPath: named, reason: null };
  const sessions = await readSessions(home, root);
  if (!sessions.length) return { transcriptPath: null, reason: 'no_session' };
  const latest = sessions.reduce((a, b) => (b.lastAt > a.lastAt ? b : a));
  const overlapping = sessions.some(
    (s) => s !== latest && s.lastAt > latest.startedAt && now.getTime() - Date.parse(s.lastAt) < ACTIVE_MS,
  );
  if (overlapping) return { transcriptPath: null, reason: 'ambiguous' };
  return { transcriptPath: latest.transcriptPath, reason: null };
}

/**
 * Mark the session as told about handing off work without a spec. True only for the call that
 * marked it, so the notice comes once per session.
 * @param {{ home: string, root: string, transcriptPath: string, now?: Date }} options
 */
export async function claimNotice({ home, root, transcriptPath, now = new Date() }) {
  let claimed = false;
  const at = now.toISOString();
  await updateSessions(home, root, (sessions) => {
    const entry = sessions.find((s) => s.transcriptPath === transcriptPath);
    if (entry?.noticed) return sessions;
    claimed = true;
    if (entry) return sessions.map((s) => (s === entry ? { ...s, noticed: true } : s));
    return [...sessions, { transcriptPath, startedAt: at, lastAt: at, noticed: true }];
  });
  return claimed;
}

/**
 * @typedef {{ sha256: string, text: string }} Utterance
 * @typedef {{ available: boolean, utterances: number, transcriptPath: string | null, reason: 'no_session' | 'ambiguous' | 'unreadable' | 'empty' | null }} ConversationStatus
 */

/**
 * Freeze the messages of the current session into the task's conversation file. Messages
 * frozen in an earlier round of the task stay: a recheck copies quotes that were approved then.
 * @param {{ home: string, root: string, file: string, now?: Date }} options
 * @returns {Promise<ConversationStatus>}
 */
export async function freezeConversation({ home, root, file, now = new Date() }) {
  const previous = (await readConversation(file)) ?? [];
  const session = await currentSession({ home, root, now });
  /** @type {ConversationStatus['reason']} */
  let reason = session.reason;
  /** @type {string[]} */
  let typed = [];
  if (session.transcriptPath) {
    const read = await utterancesInTranscript({ transcriptPath: session.transcriptPath });
    if (read === null) reason = 'unreadable';
    else if (!read.length) reason = 'empty';
    else typed = read;
  }
  const seen = new Set(previous.map((u) => u.sha256));
  const utterances = [...previous];
  for (const text of typed) {
    const sha256 = sha256Of(text);
    if (seen.has(sha256)) continue;
    seen.add(sha256);
    utterances.push({ sha256, text });
  }
  if (utterances.length !== previous.length) {
    const transcripts = new Set(/** @type {any} */ (await readJson(file).catch(() => undefined))?.transcripts ?? []);
    if (session.transcriptPath) transcripts.add(session.transcriptPath);
    await writeJsonAtomic(file, { schemaVersion: 1, updatedAt: now.toISOString(), transcripts: [...transcripts], utterances });
  }
  return { available: utterances.length > 0, utterances: utterances.length, transcriptPath: session.transcriptPath, reason };
}

/**
 * @param {string} file the task's conversation file
 * @returns {Promise<Utterance[] | null>} null when the task has no frozen conversation
 */
export async function readConversation(file) {
  const data = /** @type {any} */ (await readJson(file).catch(() => undefined));
  if (!Array.isArray(data?.utterances)) return null;
  return data.utterances.filter((/** @type {any} */ u) => typeof u?.text === 'string' && typeof u?.sha256 === 'string');
}

/**
 * The frozen message that contains the quote (whitespace-insensitive), if any.
 * @param {Utterance[]} utterances
 * @param {string} quote
 */
export function findQuote(utterances, quote) {
  const wanted = normalize(quote);
  if (!wanted) return undefined;
  return utterances.find((u) => normalize(u.text).includes(wanted));
}
