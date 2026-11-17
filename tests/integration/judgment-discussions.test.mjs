// Decisions settled in a PR or issue discussion (pivot 7.1): the agent cites the comment, Heirloom
// fetches it with gh or glab and checks the quote, and the person confirms it before it becomes
// a decision record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { judge, judgedTask } from '../helpers/judge-fixture.mjs';
import { tempDir } from '../helpers/git-fixture.mjs';
import { judgeTask, judgeView } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { applyApproval } from '../../skills/using-heirloom/lib/apply.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { parseDiscussionUrl } from '../../skills/using-heirloom/lib/discussion.mjs';
import { writePrBody } from '../../skills/using-heirloom/lib/judgment-pr.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { readRecords } from '../../skills/using-heirloom/lib/records.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SMALL_TEST = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('small orders pay full price', () => {
  assert.equal(total({ qty: 5, unit: 10 }), 50);
});
`;
const ANCHORS = [{ file: 'test/small.test.mjs', test: 'small orders pay full price' }];
const COMMENT = '논의 끝에 정리합니다.\n5개 미만 주문에는   할인을 적용하지 않는다. 이건 영업팀과 합의한 사항입니다.';
const QUOTE = '5개 미만 주문에는 할인을 적용하지 않는다.';

const fakes = await tempDir('fakes');
const ghState = path.join(fakes, 'gh.json');
const glabState = path.join(fakes, 'glab.json');
process.env.PATH = [path.join(ROOT, 'tests', 'helpers', 'fake-gh'), path.join(ROOT, 'tests', 'helpers', 'fake-glab'), process.env.PATH].join(path.delimiter);
process.env.FAKE_GH_STATE = ghState;
process.env.FAKE_GLAB_STATE = glabState;
await writeFile(ghState, JSON.stringify({ api: { 'repos/acme/widgets/pulls/comments/77': { body: COMMENT, user: { login: 'kim' } }, 'repos/other/repo/issues/comments/1': { body: COMMENT } } }));
await writeFile(glabState, JSON.stringify({ hosts: ['gitlab.com'], api: { '/projects/acme/tools/widgets/merge_requests/5/notes/9': { body: COMMENT, author: { username: 'lee' } } } }));

/**
 * @param {any[]} discussions
 * @param {string} [remote]
 */
const task = (discussions, remote = 'https://github.com/acme/widgets.git') =>
  judgedTask({ remote, baseFiles: { 'test/small.test.mjs': SMALL_TEST }, editDraft: (d) => { d.discussions = discussions; } });

const candidate = (/** @type {Record<string, any>} */ over = {}) => ({ id: 'x1', url: 'https://github.com/acme/widgets/pull/42#discussion_r77', quote: QUOTE, choice: '5개 미만 주문은 할인하지 않는다', scope: ['src/cart.mjs'], anchors: ANCHORS, ...over });

test('discussion URLs: GitHub comments, reviews and descriptions; GitLab notes', () => {
  assert.deepEqual(parseDiscussionUrl('https://github.com/a/b/pull/4#issuecomment-12'), { host: 'github.com', repo: 'a/b', on: 'pull', number: 4, comment: { kind: 'issue-comment', id: 12 } });
  assert.deepEqual(parseDiscussionUrl('https://github.com/a/b/pull/4/files#discussion_r9')?.comment, { kind: 'review-comment', id: 9 });
  assert.deepEqual(parseDiscussionUrl('https://github.com/a/b/pull/4#pullrequestreview-3')?.comment, { kind: 'review', id: 3 });
  assert.deepEqual(parseDiscussionUrl('https://github.com/a/b/issues/7'), { host: 'github.com', repo: 'a/b', on: 'issue', number: 7, comment: null });
  assert.equal(parseDiscussionUrl('https://github.com/a/b/issues/7#discussion_r9'), null);
  assert.deepEqual(parseDiscussionUrl('https://gitlab.com/g/sub/p/-/merge_requests/5#note_9'), { host: 'gitlab.com', repo: 'g/sub/p', on: 'pull', number: 5, comment: { kind: 'note', id: 9 } });
  assert.equal(parseDiscussionUrl('https://example.com/x'), null);
});

test('a candidate is refused when the comment is elsewhere, missing, or does not say the quote', async () => {
  const refused = await task([
    candidate({ id: 'x1', url: 'https://github.com/other/repo/issues/3#issuecomment-1' }),
    candidate({ id: 'x2', url: 'https://github.com/acme/widgets/pull/42#discussion_r404' }),
    candidate({ id: 'x3', quote: '5개 미만도 할인한다.' }),
    candidate({ id: 'x4', url: 'https://example.com/thread/1' }),
    candidate({ id: 'x5', anchors: [{ file: 'src/cart.mjs', symbol: 'total' }] }),
  ]).catch((e) => e);
  assert.equal(refused.code, 'E_VERIFY');
  for (const m of [
    '$.discussions[0].url: 이 저장소(github.com/acme/widgets)의 토론이 아님',
    '$.discussions[1].url: 토론을 가져오지 못함',
    '$.discussions[2].quote: 가져온 토론 원문에서 찾을 수 없음',
    '$.discussions[3].url: GitHub PR·이슈(댓글)나 GitLab MR·이슈(note) URL이 아님',
    '$.discussions[4].anchors: 결정을 잠그는 테스트 앵커',
  ]) assert.ok(refused.message.includes(m), `${m}\n${refused.message}`);
});

test('github: a confirmed discussion becomes a record with its source; an unconfirmed one is dropped', async () => {
  const t = await task([candidate(), candidate({ id: 'x2', choice: '다른 결정' })]);
  const paths = taskPaths(t.home, t.taskId);
  const draft = JSON.parse(await readFile(paths.draft, 'utf8'));
  assert.equal(draft.discussions[0].fetched.author, 'kim');
  assert.match(draft.discussions[0].fetched.bodySha256, /^[0-9a-f]{64}$/);

  const missing = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash }).catch((e) => e.message);
  assert.match(missing, /discussions는 \{ id, confirmed \} 배열이어야 함/);
  const draftSha256 = draftDigest(draft);
  const items = [{ id: 'q1', verdict: 'my-misunderstanding' }, { id: 'q2', verdict: 'as-expected' }, { id: 'q3', verdict: 'as-expected' }, { id: 'q4', verdict: 'answered', answer: '100으로 한다' }];
  const partial = await judgeTask({ home: t.home, taskId: t.taskId, keystore: 'file', request: { draftSha256, sourceHash: t.sourceHash, items, discussions: [{ id: 'x1', confirmed: true }] } }).catch((e) => e.message);
  assert.match(partial, /x2: 토론에서 확정된 결정인지 확인해야 함/);
  const view = /** @type {any} */ (await judgeView({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(view.discussions.map((/** @type {any} */ d) => d.id), ['x1', 'x2']);

  const judgment = await judgeTask({ home: t.home, taskId: t.taskId, keystore: 'file', request: { draftSha256, sourceHash: t.sourceHash, items, discussions: [{ id: 'x1', confirmed: true }, { id: 'x2', confirmed: false }] } });
  assert.equal(judgment.outcome, 'accepted');
  const recordId = /** @type {any} */ (judgment.discussions)?.[0].recordId;
  assert.match(recordId, /^d-/);
  assert.deepEqual(judgment.discussions?.[1], { id: 'x2', confirmed: false });

  const applied = /** @type {any} */ (await applyApproval({ home: t.home, taskId: t.taskId }));
  assert.deepEqual(applied.files, [`.heirloom/decisions/${recordId}.md`]);
  const { decisions } = await readRecords(t.repo.dir);
  assert.deepEqual(decisions.map((d) => [d.meta.id, d.meta.choice]), [[recordId, '5개 미만 주문은 할인하지 않는다']]);
  assert.deepEqual(decisions[0].meta.source, [{ kind: 'discussion', approval: judgment.id, url: 'https://github.com/acme/widgets/pull/42#discussion_r77', quote: QUOTE, author: 'kim' }]);

  const body = path.join(await tempDir('body'), 'body.md');
  const section = (await writePrBody({ home: t.home, taskId: t.taskId, bodyFile: body })).section;
  assert.match(section, new RegExp(`- 토론에서 확정한 결정: 5개 미만 주문은 할인하지 않는다 — https://github\\.com/acme/widgets/pull/42#discussion_r77 \\(저장소에 결정 기록 ${recordId}로 남김\\)`));
  assert.doesNotMatch(section, /다른 결정/);
});

test('gitlab: a merge request note is fetched with glab', async () => {
  const t = await task([candidate({ url: 'https://gitlab.com/acme/tools/widgets/-/merge_requests/5#note_9' })], 'https://gitlab.com/acme/tools/widgets.git');
  const draft = JSON.parse(await readFile(taskPaths(t.home, t.taskId).draft, 'utf8'));
  assert.equal(draft.discussions[0].fetched.author, 'lee');
});
