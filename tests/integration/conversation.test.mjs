// A chat-only task: no spec, a decision made in the conversation. The hooks record the session,
// a manual handoff freezes what the person typed, and a question of the draft quotes it as its
// source: only what the person typed can be quoted, and the quote keeps the message's hash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, cloneRepo, tempDir } from '../helpers/git-fixture.mjs';
import { sha256Of, touchSession } from '../../skills/using-heirloom/lib/conversation.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';
import { readJson, writeJsonAtomic } from '../../skills/using-heirloom/lib/fsx.mjs';
import { repoInfo } from '../../skills/using-heirloom/lib/git.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { runProbes } from '../../skills/using-heirloom/lib/probe.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';
process.env.GIT_SSH_COMMAND = 'false';
process.env.GIT_TERMINAL_PROMPT = '0';

const DECIDED = '온도 변환 결과는 반올림하지 말고 그대로 돌려줘. 화면에서만 소수 둘째 자리로 자르자.';

/** A clone on branch feat with a code change and a Claude Code transcript of the chat. */
async function chatTask() {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const home = await tempDir('home');
  const transcript = path.join(await tempDir('t'), 'session.jsonl');
  const lines = [
    { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: DECIDED } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '반올림은 화면 단위로 하겠습니다.' }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: '테스트 통과' }] } },
    { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '인계해 줘' } },
  ];
  await writeFile(transcript, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  await touchSession({ home, root: (await repoInfo(repo.dir)).root, transcriptPath: transcript });
  return { repo, home, transcript };
}

/**
 * Run the one probe of the chat task: the value of `a` on base and head.
 * @param {string} home
 * @param {string} taskId
 */
const probe = (home, taskId) =>
  /** @type {Promise<any>} */ (runProbes({ home, taskId, spec: { probes: [{ id: 'p1', title: 'a의 값', run: ['node', '-e', "import('./src/a.mjs').then((m) => console.log(m.a))"] }] } }));

/** A schema 2 draft whose open choice rests on the given sources. @param {any} prepared @param {any} probes @param {any[]} sources */
const draftOf = (prepared, probes, sources) => ({
  schemaVersion: 2,
  taskId: prepared.taskId,
  inputSourceHash: prepared.source.hash,
  probeSetHash: probes.probeSetHash,
  behaviorDiffs: [{ text: 'a의 값이 1에서 2가 된다', probes: ['p1'], codePaths: ['src/a.mjs'] }],
  questions: [
    {
      id: 'q1',
      kind: 'fork',
      probes: ['p1'],
      codePaths: ['src/a.mjs'],
      prompt: '변환 결과를 반올림하지 않고 그대로 돌려줄까요?',
      whyOpen: '반올림 위치가 코드에 드러나지 않는다',
      sources,
    },
  ],
  inferences: [],
  notes: '',
});

/** @param {Promise<unknown>} p @param {string} code */
const rejectsWith = (p, code) => assert.rejects(p, (/** @type {any} */ e) => e instanceof HeirloomError && e.code === code);

test('chat handoff: prepare freezes the typed messages; a question quoting them is submitted with the message hash', async () => {
  const { repo, home, transcript } = await chatTask();
  const prepared = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  assert.deepEqual(prepared.conversation, {
    available: true,
    utterances: 2,
    transcriptPath: transcript,
    reason: null,
    path: taskPaths(home, prepared.taskId).conversation,
  });
  const frozen = /** @type {any} */ (await readJson(prepared.conversation.path));
  assert.deepEqual(frozen.utterances.map((/** @type {any} */ u) => u.text), [DECIDED, '인계해 줘'], 'no agent replies or tool results');

  const paths = taskPaths(home, prepared.taskId);
  const probes = await probe(home, prepared.taskId);
  // Quoting the agent's own reply is refused.
  await writeJsonAtomic(paths.draft, draftOf(prepared, probes, [{ ref: '@conversation', quote: '반올림은 화면 단위로 하겠습니다.' }]));
  await rejectsWith(submitDraft({ home, taskId: prepared.taskId }), 'E_VERIFY');

  await writeJsonAtomic(paths.draft, draftOf(prepared, probes, [{ ref: '@conversation', quote: '반올림하지 말고 그대로 돌려줘.' }]));
  const submitted = /** @type {any} */ (await submitDraft({ home, taskId: prepared.taskId }));
  assert.equal(submitted.state, 'awaiting_approval');
  assert.match(await readFile(paths.handoff, 'utf8'), /근거: 대화 \(사용자 발화\) — "반올림하지 말고 그대로 돌려줘\."/);

  const draft = /** @type {any} */ (await readJson(paths.draft));
  assert.deepEqual(draft.questions[0].sources, [{ ref: '@conversation', quote: '반올림하지 말고 그대로 돌려줘.', sha256: sha256Of(DECIDED) }]);
});

test('chat handoff: without a known session the conversation is unavailable and cannot be quoted', async () => {
  const upstream = await makeRepo({ 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const home = await tempDir('home');

  const prepared = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  assert.equal(prepared.conversation.available, false);
  assert.equal(prepared.conversation.reason, 'no_session');
  const probes = await probe(home, prepared.taskId);
  await writeJsonAtomic(taskPaths(home, prepared.taskId).draft, draftOf(prepared, probes, [{ ref: '@conversation', quote: '반올림하지 말고' }]));
  await rejectsWith(submitDraft({ home, taskId: prepared.taskId }), 'E_VERIFY');
});

test('chat handoff: a new message does not make the same code a new handoff', async () => {
  const { repo, home, transcript } = await chatTask();
  const first = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  await writeFile(transcript, `${JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '캐시는 쓰지 않는다' } })}\n`, { flag: 'a' });
  const again = await prepareHandoff({ cwd: repo.dir, home, manual: true });
  assert.equal(again.taskId, first.taskId);
  assert.equal(again.alreadyPrepared, true);
  assert.equal(again.conversation.utterances, 3, 'the new message is added to the frozen conversation');
});
