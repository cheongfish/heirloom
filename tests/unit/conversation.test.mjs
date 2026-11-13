// The conversation as a decision source: which session a handoff runs in, the messages the
// person typed, freezing them per task and finding quotes in them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import {
  claimNotice,
  currentSession,
  findQuote,
  freezeConversation,
  readConversation,
  readSessions,
  sha256Of,
  touchSession,
} from '../../skills/using-heirloom/lib/conversation.mjs';
import { utterancesInTranscript } from '../../skills/using-heirloom/lib/transcript.mjs';

const ROOT = '/work/repo';
const at = (/** @type {string} */ hm) => new Date(`2026-11-13T${hm}:00Z`);

/** @param {string} dir @param {string} name @param {string[]} typed */
async function claudeTranscript(dir, name, typed) {
  const file = path.join(dir, name);
  const lines = typed.flatMap((text) => [
    { type: 'user', message: { role: 'user', content: text } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `답: ${text}` }] } },
  ]);
  await writeFile(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

test('sessions: the last active session; none recorded is no_session', async () => {
  const home = await tempDir('home');
  assert.deepEqual(await currentSession({ home, root: ROOT }), { transcriptPath: null, reason: 'no_session' });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:00') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:30') });
  assert.deepEqual(await currentSession({ home, root: ROOT, now: at('10:40') }), { transcriptPath: '/t/a.jsonl', reason: null });
  const [entry] = await readSessions(home, ROOT);
  assert.equal(entry.startedAt, at('10:00').toISOString());
  assert.equal(entry.lastAt, at('10:30').toISOString());
  assert.deepEqual(await currentSession({ home, root: '/other', now: at('10:40') }), { transcriptPath: null, reason: 'no_session' }, 'per worktree');
});

test('sessions: a session that started after the previous one ended is not ambiguous (/clear, a new terminal)', async () => {
  const home = await tempDir('home');
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:00') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:20') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/b.jsonl', now: at('10:21') });
  assert.deepEqual(await currentSession({ home, root: ROOT, now: at('10:25') }), { transcriptPath: '/t/b.jsonl', reason: null });
});

test('sessions: two sessions running at the same time are ambiguous; an old overlap is not', async () => {
  const home = await tempDir('home');
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:00') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/b.jsonl', now: at('10:05') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:10') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/b.jsonl', now: at('10:15') });
  assert.deepEqual(await currentSession({ home, root: ROOT, now: at('10:20') }), { transcriptPath: null, reason: 'ambiguous' });
  // a stopped hours ago; b goes on alone.
  await touchSession({ home, root: ROOT, transcriptPath: '/t/b.jsonl', now: at('13:00') });
  assert.deepEqual(await currentSession({ home, root: ROOT, now: at('13:05') }), { transcriptPath: '/t/b.jsonl', reason: null });
});

test('notice: claimed once per session', async () => {
  const home = await tempDir('home');
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl' });
  assert.equal(await claimNotice({ home, root: ROOT, transcriptPath: '/t/a.jsonl' }), true);
  assert.equal(await claimNotice({ home, root: ROOT, transcriptPath: '/t/a.jsonl' }), false);
  assert.equal(await claimNotice({ home, root: ROOT, transcriptPath: '/t/b.jsonl' }), true, 'another session is told too');
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl' });
  assert.equal(await claimNotice({ home, root: ROOT, transcriptPath: '/t/a.jsonl' }), false, 'touching keeps the mark');
});

test('utterancesInTranscript: typed messages in order from any host; unreadable is null', async () => {
  const dir = await tempDir('t');
  const file = path.join(dir, 'mixed.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '첫 메시지' } }),
    'not json',
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '도구 결과' }] } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: '두 번째' }] } } }),
    JSON.stringify({ step_index: 3, type: 'USER_INPUT', source: 'USER_EXPLICIT', content: '<USER_REQUEST>\n세 번째\n</USER_REQUEST>' }),
  ];
  await writeFile(file, `${lines.join('\n')}\n`);
  assert.deepEqual(await utterancesInTranscript({ transcriptPath: file }), ['첫 메시지', '두 번째', '세 번째']);
  assert.equal(await utterancesInTranscript({ transcriptPath: path.join(dir, 'missing.jsonl') }), null);
});

test('freeze: messages of the current session, kept across rounds; reasons when there is none', async () => {
  const home = await tempDir('home');
  const dir = await tempDir('t');
  const file = path.join(home, 'tasks', 't-20261113-00000000', 'conversation.json');

  assert.deepEqual(await freezeConversation({ home, root: ROOT, file }), { available: false, utterances: 0, transcriptPath: null, reason: 'no_session' });
  assert.equal(await readConversation(file), null, 'nothing written without messages');

  const a = await claudeTranscript(dir, 'a.jsonl', ['반올림하지 말자', '테스트는 tests/unit에 둔다']);
  await touchSession({ home, root: ROOT, transcriptPath: a, now: at('10:00') });
  const first = await freezeConversation({ home, root: ROOT, file, now: at('10:01') });
  assert.deepEqual(first, { available: true, utterances: 2, transcriptPath: a, reason: null });
  assert.deepEqual((await readConversation(file))?.map((u) => u.text), ['반올림하지 말자', '테스트는 tests/unit에 둔다']);
  assert.equal((await readConversation(file))?.[0].sha256, sha256Of('반올림하지 말자'));

  // A later round in a new session keeps what was frozen and adds the new messages once.
  const b = await claudeTranscript(dir, 'b.jsonl', ['반올림하지 말자', '캐시는 쓰지 않는다']);
  await touchSession({ home, root: ROOT, transcriptPath: b, now: at('11:00') });
  const second = await freezeConversation({ home, root: ROOT, file, now: at('11:01') });
  assert.equal(second.utterances, 3);
  assert.deepEqual((await readConversation(file))?.map((u) => u.text), ['반올림하지 말자', '테스트는 tests/unit에 둔다', '캐시는 쓰지 않는다']);

  const empty = await claudeTranscript(dir, 'c.jsonl', []);
  await touchSession({ home, root: ROOT, transcriptPath: empty, now: at('12:00') });
  assert.deepEqual(await freezeConversation({ home, root: ROOT, file, now: at('12:01') }), { available: true, utterances: 3, transcriptPath: empty, reason: 'empty' });

  await touchSession({ home, root: ROOT, transcriptPath: path.join(dir, 'gone.jsonl'), now: at('13:00') });
  assert.equal((await freezeConversation({ home, root: ROOT, file, now: at('13:01') })).reason, 'unreadable');
});

test('findQuote: part of one message, whitespace-insensitive; never across messages', () => {
  const u = [
    { sha256: sha256Of('a'), text: '변환 결과는\n반올림하지 않는다. 대신 문자열로 보여 준다.' },
    { sha256: sha256Of('b'), text: '테스트는 tests/unit에 둔다' },
  ];
  assert.equal(findQuote(u, '변환 결과는 반올림하지 않는다.')?.sha256, sha256Of('a'));
  assert.equal(findQuote(u, '보여 준다. 테스트는'), undefined);
  assert.equal(findQuote(u, '  '), undefined);
});

test('sessions: a transcript the host names in the environment (Cursor) wins over hook records and ambiguity', async () => {
  const home = await tempDir('home');
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:00') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/b.jsonl', now: at('10:05') });
  await touchSession({ home, root: ROOT, transcriptPath: '/t/a.jsonl', now: at('10:10') });
  const env = { CURSOR_CONVERSATION_ID: 'c1', AGENT_TRANSCRIPTS: '/cursor/agent-transcripts' };
  assert.deepEqual(await currentSession({ home, root: ROOT, now: at('10:11'), env }), { transcriptPath: '/cursor/agent-transcripts/c1/c1.jsonl', reason: null });
  assert.equal((await currentSession({ home, root: ROOT, now: at('10:11'), env: {} })).reason, 'ambiguous');
});
