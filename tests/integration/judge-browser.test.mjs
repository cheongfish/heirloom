// The prediction and judgment screen in a real browser (pivot step 4): the page shows no
// result before the predictions are saved, then reveals and takes the verdicts.
// Runs only with PLAYWRIGHT_CORE (a playwright-core package directory) and CHROMIUM (the
// browser executable) set, as evals/acceptance/dashboard.mjs uses them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';

import { CART_HEAD, OBSERVED, SPEC, handIn, judgedTask } from '../helpers/judge-fixture.mjs';
import { judgeTask, recordPredictions } from '../../skills/using-heirloom/dashboard/judge.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { createDashboardServer } from '../../skills/using-heirloom/dashboard/server.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { PLAYWRIGHT_CORE, CHROMIUM } = process.env;
const skip = PLAYWRIGHT_CORE && CHROMIUM ? false : 'PLAYWRIGHT_CORE와 CHROMIUM이 없음';

/**
 * Bring a question card into view: the cards sit side by side, one in view at a time.
 * @param {any} page
 * @param {string} id
 */
const on = (page, id) => page.getByRole('button', { name: `${id}로 이동` }).click();

/**
 * Confirm in the page's dialog (an in-page <dialog>, never window.confirm).
 * @param {any} page
 * @param {string} name the confirming button
 */
async function confirmWith(page, name) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name, exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
}

test('browser: predict, reveal, judge', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const { home, taskId } = await judgedTask();
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).waitFor();
  const before = await page.locator('main').innerText();
  assert.ok(!before.includes(OBSERVED.head), 'no head output on the page before the reveal');
  assert.match(before, /qty: 12, unit: 10/, 'the probe command is shown');
  const reveal = page.getByRole('button', { name: '예측 저장하고 결과 보기' });
  assert.equal(await reveal.isDisabled(), true, 'disabled until every prediction is in');
  await page.getByRole('tab', { name: /개요/ }).click();
  const overview = await page.locator('#panel-overview').innerText();
  assert.match(overview, /^동작 차이\s*예측을 저장하면/, 'the overview opens on what changed, held back until the predictions');
  assert.ok(!overview.includes(OBSERVED.head));
  await page.getByRole('tab', { name: /예측/ }).click();

  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.base);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await reveal.click();
  // The confirmation is a dialog in the page: same words, focus on the confirming button,
  // Escape cancels and gives focus back.
  const dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /예측을 저장하고 결과를 볼까요\? 저장한 예측은 바꿀 수 없습니다\./);
  assert.equal(await page.locator(':focus').innerText(), '결과 보기', 'focus starts on the confirming button');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await page.locator(':focus').getAttribute('id'), 'reveal', 'and goes back to the button that asked');
  assert.ok(!(await page.locator('main').innerText()).includes(OBSERVED.head), 'nothing is saved or shown after cancelling');
  await reveal.click();
  await confirmWith(page, '결과 보기');
  await page.getByRole('heading', { name: '질문 판정' }).waitFor();
  const after = await page.locator('main').innerText();
  assert.ok(after.includes(OBSERVED.head), 'the head output is revealed');
  assert.match(after, /틀림/);
  // q1, q3 and q4 all rest on p1: its command and outputs are shown once, and the cards name it.
  assert.equal(after.match(/qty: 12, unit: 10/g)?.length, 1, 'the probe command is shown once');
  const probe = await page.locator('#probe-p1').innerText();
  assert.match(probe, new RegExp(`이전 \\(base\\)\\s*${OBSERVED.base}[\\s\\S]*이후 \\(head\\)\\s*${OBSERVED.head}`));
  for (const id of ['q1', 'q3', 'q4']) {
    const card = await page.locator(`#question-${id}`).innerText();
    assert.match(card, /12개 구매 결제액/, `${id} names the probe it rests on`);
    assert.doesNotMatch(card, /qty: 12/, `${id} does not repeat the command`);
  }
  const q1 = page.getByRole('radiogroup', { name: 'q1 판정' });
  await on(page, 'q1');
  assert.equal(await q1.getByRole('radio', { name: '예상대로' }).isDisabled(), true, 'a wrong prediction cannot be judged as expected');

  await q1.getByRole('radio', { name: '잘못 알았음' }).click();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  const q3 = page.getByRole('radiogroup', { name: 'q3 판정' });
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  const submit = page.getByRole('button', { name: /^판정 저장/ });
  assert.equal(await submit.isDisabled(), true, 'the open choice still needs an answer');
  await page.getByLabel('q4 답').fill('100으로 한다');

  // Sending back q3, which cites the spec, asks what the spec becomes and hides the lifetime.
  await on(page, 'q3');
  await q3.getByRole('radio', { name: '되돌림' }).click();
  await page.getByLabel('q3 이유').fill('경계는 10개로 둔다');
  assert.equal(await page.getByRole('radiogroup', { name: 'spec 수명' }).count(), 0, 'no lifetime while work goes back');
  assert.equal(await submit.isDisabled(), true, 'the spec choice is required');
  const why = page.getByText(/^저장 전에 필요: spec 처리를 고르지 않은 질문: q3$/);
  const [button, reason] = [await submit.boundingBox(), await why.boundingBox()];
  assert.ok(reason.x > button.x + button.width && reason.y < button.y + button.height, 'the reason sits right next to the disabled button');
  await page.getByRole('radiogroup', { name: 'q3 spec 처리' }).getByRole('radio', { name: 'spec이 틀렸다' }).click();
  assert.equal(await submit.isDisabled(), false);

  // Accepting everything instead asks for the spec's lifetime; keeping it needs an owner.
  await q3.getByRole('radio', { name: '의도와 같음' }).click();
  const lifetime = page.getByRole('radiogroup', { name: 'spec 수명' });
  await lifetime.waitFor();
  assert.equal(await lifetime.getByRole('radio', { name: '삭제' }).getAttribute('aria-checked'), 'true', 'the project default is chosen first');
  await lifetime.getByRole('radio', { name: '유지' }).click();
  assert.equal(await submit.isDisabled(), true, 'a kept spec needs an owner');
  await page.getByLabel('spec 소유자').fill('결제팀');
  await submit.click();
  await page.getByText('판정 내용').first().waitFor();
  const done = await page.locator('main').innerText();
  assert.match(done, /모두 수용/);
  assert.match(done, /머지할 때 spec: 유지 \(소유자: 결제팀\)/);
  assert.doesNotMatch(done, /탐침 묶음|ap-[0-9a-z]+/, 'internal ids stay behind 자세히');
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'approved');
  assert.match(done, /다음 단계: 반영 요청\s*에이전트에게 "승인한 작업 반영해 줘"라고 요청하세요/, 'the next step is to ask the agent to apply it');
  await page.goto(`http://127.0.0.1:${server.port}/`);
  await page.getByText('반영 대기', { exact: true }).waitFor();
  assert.match(await page.locator('main').innerText(), /반영 대기[\s\S]*다음 단계: 에이전트에게 "승인한 작업 반영해 줘"라고 요청하세요/);
  assert.deepEqual(errors, []);
});

test('browser: a choice prediction lists its four choices one per line and is scored after the reveal', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const long = '할인이 붙지 않아 정가 그대로 결제되고, 화면에는 대량 할인 조건을 채우지 못했다는 안내가 함께 나온다';
  const choices = [OBSERVED.head, '96', '정가 그대로 결제된다', long];
  const { home, taskId } = await judgedTask({
    editDraft: (d) => {
      d.questions[0] = { ...d.questions[0], answerType: 'choice', choices };
    },
  });
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await on(page, 'q1');
  const group = page.getByRole('radiogroup', { name: 'q1 답' });
  const boxes = await Promise.all(choices.map((c) => group.getByRole('radio', { name: c, exact: true }).boundingBox()));
  for (let i = 1; i < boxes.length; i += 1) {
    assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].height, `choice ${i} is below choice ${i - 1}`);
    assert.equal(boxes[i].x, boxes[0].x, 'choices share the left edge');
  }
  assert.ok(boxes[3].height > boxes[1].height * 1.5, 'the long choice wraps instead of overflowing');

  await group.getByRole('radio', { name: OBSERVED.head, exact: true }).click();
  assert.equal(await group.getByRole('radio', { name: OBSERVED.head, exact: true }).getAttribute('aria-checked'), 'true');
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await confirmWith(page, '결과 보기');
  await page.getByRole('heading', { name: '질문 판정' }).waitFor();
  await on(page, 'q1');
  assert.match(await page.locator('#question-q1').innerText(), /맞음/);
  assert.deepEqual(errors, []);
});

test('browser: keep a fork answer in the repository and confirm a discussion', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const fakes = await tempDir('fakes');
  const state = path.join(fakes, 'gh.json');
  await writeFile(state, JSON.stringify({ api: { 'repos/acme/widgets/issues/comments/5': { body: '작은 주문은 할인하지 않는다.', user: { login: 'kim' } } } }));
  process.env.PATH = [path.join(ROOT, 'tests', 'helpers', 'fake-gh'), process.env.PATH].join(path.delimiter);
  process.env.FAKE_GH_STATE = state;
  const anchors = [{ file: 'test/small.test.mjs', test: 'small orders pay full price' }];
  const { home, taskId } = await judgedTask({
    remote: 'https://github.com/acme/widgets.git',
    baseFiles: { 'test/small.test.mjs': "import { test } from 'node:test';\ntest('small orders pay full price', () => {});\n" },
    editDraft: (d) => {
      d.questions[3].decision = { scope: ['src/cart.mjs'], anchors };
      d.discussions = [{ id: 'x1', url: 'https://github.com/acme/widgets/pull/3#issuecomment-5', quote: '작은 주문은 할인하지 않는다.', choice: '작은 주문은 할인하지 않는다', scope: ['src/cart.mjs'], anchors }];
    },
  });
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.base);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await confirmWith(page, '결과 보기');
  await page.getByRole('heading', { name: '질문 판정' }).waitFor();
  await on(page, 'q1');
  await page.getByRole('radiogroup', { name: 'q1 판정' }).getByRole('radio', { name: '잘못 알았음' }).click();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  await on(page, 'q3');
  await page.getByRole('radiogroup', { name: 'q3 판정' }).getByRole('radio', { name: '의도와 같음' }).click();
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  await page.getByLabel('q4 답').fill('100으로 한다');
  const keep = page.getByRole('radiogroup', { name: 'q4 남길 곳' });
  assert.equal(await keep.getByRole('radio', { name: '이 PR에서만' }).getAttribute('aria-checked'), 'true', 'kept in the PR only by default');
  await keep.getByRole('radio', { name: '저장소에 계속 유지' }).click();
  const submit = page.getByRole('button', { name: /^판정 저장/ });
  assert.match(await page.locator('main').innerText(), /확인하지 않은 토론 결정: x1/);
  assert.equal(await submit.isDisabled(), true);
  const tab = page.locator('#tab-judge');
  assert.match(await tab.innerText(), /판정 4\/5/, 'the discussion counts as one more card to judge');
  assert.doesNotMatch(await tab.innerText(), /완료/, 'not done while the discussion is unconfirmed');
  await on(page, 'x1');
  await page.getByRole('radiogroup', { name: 'x1 확인' }).getByRole('radio', { name: '확정된 결정이 맞다' }).click();
  assert.match(await tab.innerText(), /판정 5\/5\s*완료/);
  await submit.click();
  await page.getByText('판정 내용').first().waitFor();
  const summary = await page.locator('main').innerText();
  assert.match(summary, /결정 기록 d-[0-9a-z]{8}로 남김/);
  assert.match(summary, /확정된 결정이 맞다\s*x1 작은 주문은 할인하지 않는다 · 결정 기록 d-[0-9a-z]{8}로 남김/);
  assert.match(summary, /q2 .* · 답: 예/);
  assert.doesNotMatch(summary, /답: yes/);
  const judgment = JSON.parse(await readFile(path.join(taskPaths(home, taskId).approvals, `${(await readEvents(taskPaths(home, taskId).events)).find((e) => e.type === 'approved')?.approvalId}.json`), 'utf8'));
  assert.equal(judgment.items.find((/** @type {any} */ i) => i.id === 'q4').keep.action, 'record');
  assert.equal(judgment.discussions[0].confirmed, true);
  assert.deepEqual(errors, []);
});

test('browser: discarding the task is a destructive button at the bottom of the overview tab', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const { home, taskId } = await judgedTask();
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByRole('heading', { name: '결과 예측' }).waitFor();
  const discard = page.getByRole('button', { name: '작업 폐기' });
  assert.equal(await discard.count(), 0, 'not by the title, nor on the questions');
  await page.getByRole('tab', { name: /개요/ }).click();
  const panel = page.locator('#panel-overview');
  assert.equal(await panel.getByRole('button', { name: '작업 폐기' }).count(), 1, 'it is on the overview tab');
  assert.equal(await panel.locator('> :last-child').getByRole('button', { name: '작업 폐기' }).count(), 1, 'at its bottom');
  assert.match(await discard.getAttribute('class') ?? '', /variant_criticalSolid/, 'in the destructive style');
  await discard.click();
  assert.match(await page.getByRole('dialog').innerText(), /이 인계를 폐기할까요\? 폐기한 작업은 판정하거나 반영할 수 없습니다\./);
  await confirmWith(page, '폐기');
  await page.getByText('폐기됨').first().waitFor();
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'discarded');
  assert.equal(await discard.count(), 0, 'a discarded task cannot be discarded again');
  assert.deepEqual(errors, []);
});

test('browser: a judgment that sends work back says the kept answer is not recorded', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const anchors = [{ file: 'test/small.test.mjs', test: 'small orders pay full price' }];
  const { home, taskId, sourceHash } = await judgedTask({
    baseFiles: { 'test/small.test.mjs': "import { test } from 'node:test';\ntest('small orders pay full price', () => {});\n" },
    editDraft: (d) => {
      d.questions[3].decision = { scope: ['src/cart.mjs'], anchors };
    },
  });
  const draft = /** @type {any} */ (await readJson(taskPaths(home, taskId).draft));
  await recordPredictions({ home, taskId, request: { draftSha256: draftDigest(draft), answers: { q1: OBSERVED.head, q2: 'yes' } } });
  await judgeTask({
    home,
    taskId,
    keystore: 'file',
    request: {
      draftSha256: draftDigest(draft),
      sourceHash,
      items: [
        { id: 'q1', verdict: 'revert', reason: '12개에도 할인이 붙어야 한다' },
        { id: 'q2', verdict: 'as-expected' },
        { id: 'q3', verdict: 'as-expected' },
        { id: 'q4', verdict: 'answered', answer: '100', keep: 'repo' },
      ],
    },
  });
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByRole('tab', { name: '판정 내용' }).click();
  const summary = await page.locator('#panel-approval').innerText();
  assert.match(summary, /q4 .*되돌려서 결정 기록을 남기지 않음/);
  assert.doesNotMatch(summary, /로 남김/, 'a sent-back judgment writes no record');
  assert.deepEqual(errors, []);
});

test('browser: sending the same question back a second time recommends agreeing on the design', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const { repo, home, taskId, sourceHash } = await judgedTask();
  // First round, judged without the screen: q1 goes back.
  const draft = /** @type {any} */ (await readJson(taskPaths(home, taskId).draft));
  await recordPredictions({ home, taskId, request: { draftSha256: draftDigest(draft), answers: { q1: OBSERVED.head, q2: 'yes' } } });
  await judgeTask({
    home,
    taskId,
    keystore: 'file',
    request: {
      draftSha256: draftDigest(draft),
      sourceHash,
      items: [
        { id: 'q1', verdict: 'revert', reason: '12개에도 할인이 붙어야 한다' },
        { id: 'q2', verdict: 'as-expected' },
        { id: 'q3', verdict: 'as-expected' },
        { id: 'q4', verdict: 'answered', answer: '100' },
      ],
    },
  });
  await repo.write('src/cart.mjs', CART_HEAD.replace('qty >= 100', 'qty >= 50'));
  const round2 = /** @type {any} */ (await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] }));
  await handIn({ home, taskId, sourceHash: round2.source.hash });

  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.head);
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await confirmWith(page, '결과 보기');
  await page.getByRole('heading', { name: '질문 판정' }).waitFor();
  await on(page, 'q2');
  await page.getByRole('radiogroup', { name: 'q2 판정' }).getByRole('radio', { name: '예상대로' }).click();
  await on(page, 'q3');
  await page.getByRole('radiogroup', { name: 'q3 판정' }).getByRole('radio', { name: '의도와 같음' }).click();
  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  await page.getByLabel('q4 답').fill('100');
  const card = page.locator('#question-q1');
  assert.match(await card.innerText(), /이전에 1번 되돌린 질문[\s\S]*1차: 12개에도 할인이 붙어야 한다/);
  await on(page, 'q1');
  await page.getByRole('radiogroup', { name: 'q1 판정' }).getByRole('radio', { name: '되돌림' }).click();
  assert.match(await card.innerText(), /설계부터 다시 합의하세요[\s\S]*이번이 2번째 되돌림입니다/);
  await page.getByLabel('q1 이유').fill('여전히 할인이 없다');
  await page.getByRole('button', { name: /^판정 저장/ }).click();
  assert.match(await page.getByRole('dialog').innerText(), /되돌림이나 분리가 있어 작업이 에이전트에게 되돌아갑니다\. PR은 열리지 않습니다\. 저장할까요\?/);
  await confirmWith(page, '저장');
  await page.getByText('판정 내용').first().waitFor();
  await page.getByRole('tab', { name: /개요/ }).click();
  assert.match(await page.locator('main').innerText(), /설계부터 다시 합의하세요[\s\S]*q1을 2번 되돌렸습니다[\s\S]*2차: 여전히 할인이 없다/);
  assert.equal(deriveState(await readEvents(taskPaths(home, taskId).events)), 'returned');
  assert.deepEqual(errors, []);
});

test('browser: the work summary titles the task, and tests read in plain words with their code location behind 자세히', { skip, timeout: 120_000 }, async (t) => {
  const pw = await import(pathToFileURL(path.join(/** @type {string} */ (PLAYWRIGHT_CORE), 'index.mjs')).href);
  const { chromium } = pw.default ?? pw;
  const fakes = await tempDir('fakes');
  const state = path.join(fakes, 'gh.json');
  await writeFile(state, JSON.stringify({ api: { 'repos/acme/widgets/issues/comments/5': { body: '작은 주문은 할인하지 않는다.', user: { login: 'kim' } } } }));
  process.env.PATH = [path.join(ROOT, 'tests', 'helpers', 'fake-gh'), process.env.PATH].join(path.delimiter);
  process.env.FAKE_GH_STATE = state;
  const summary = '대량 할인 경계를 10개에서 100개로 올림';
  const plain = '5개 구매는 정가로 결제된다';
  const note = '12개 구매에 대량 할인이 붙는지 본다';
  const anchors = [{ file: 'src/cart.mjs', symbol: 'total' }, { file: 'test/small.test.mjs', test: 'small orders pay full price', plain }];
  const { repo, home, taskId } = await judgedTask({
    remote: 'https://github.com/acme/widgets.git',
    baseFiles: { 'test/small.test.mjs': "import { test } from 'node:test';\ntest('small orders pay full price', () => {});\n" },
    editDraft: (d) => {
      d.summary = summary;
      d.testNotes = [{ test: 'bulk discount for 12', plain: note }];
      d.questions[3].decision = { scope: ['src/cart.mjs'], anchors };
      d.discussions = [{ id: 'x1', url: 'https://github.com/acme/widgets/pull/3#issuecomment-5', quote: '작은 주문은 할인하지 않는다.', choice: '작은 주문은 할인하지 않는다', scope: ['src/cart.mjs'], anchors }];
    },
  });
  const server = await createDashboardServer({ home, port: 0, version: '0.0.0-test', codeHash: 'test', keystore: 'file' });
  t.after(() => server.close());
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (/** @type {Error} */ err) => errors.push(err.message));
  page.on('dialog', (/** @type {any} */ d) => void d.dismiss().then(() => errors.push(`native dialog: ${d.message()}`)));

  await page.goto(`http://127.0.0.1:${server.port}/`);
  const row = page.getByRole('link', { name: new RegExp(summary) });
  await row.waitFor();
  const rowText = await row.innerText();
  assert.ok(rowText.includes(path.basename(repo.dir)), 'the row names the repository');
  assert.ok(!rowText.includes(repo.dir), 'by its folder name, not its full path');
  assert.ok(!rowText.includes(taskId), 'the task id stays on the task screen');

  await page.goto(`http://127.0.0.1:${server.port}/r/-/w/-/t/${taskId}`);
  await page.getByRole('heading', { level: 1, name: summary }).waitFor();
  assert.equal(await page.title(), `${summary} · Heirloom`);
  await on(page, 'q1');
  await page.getByLabel('q1 예측').fill(OBSERVED.base);
  await on(page, 'q2');
  const lock = page.locator('#question-q2');
  assert.equal(await lock.getByText(note).isVisible(), true, 'a test-lock question reads in plain words');
  assert.equal(await lock.getByText('bulk discount for 12').isVisible(), false, 'its test name stays behind 자세히');
  await page.getByRole('radiogroup', { name: 'q2 답' }).getByRole('radio', { name: '예' }).click();
  await page.getByRole('button', { name: '예측 저장하고 결과 보기' }).click();
  await confirmWith(page, '결과 보기');
  await page.getByRole('heading', { name: '질문 판정' }).waitFor();
  await on(page, 'q2');
  assert.match(await lock.innerText(), /결과: 통과 → 실패/);
  assert.equal(await lock.getByText('bulk discount for 12').isVisible(), false);

  const tests = page.locator('details', { hasText: '결과가 바뀐 테스트' });
  assert.match(await tests.locator('summary').innerText(), /^테스트: 통과 2 → 통과 1·실패 1, 결과가 바뀐 테스트 1개$/);
  await tests.locator('summary').click();
  const changed = await tests.locator('ul').innerText();
  assert.match(changed, new RegExp(`${note} · 통과 → 실패`));
  assert.doesNotMatch(changed, /bulk discount for 12/, 'the test name gives way to its note');

  await on(page, 'x1');
  const card = page.locator('#discussion-x1');
  assert.equal(await card.getByText(plain).isVisible(), true, 'the test reads in plain words');
  const where = card.getByText('test/small.test.mjs');
  assert.equal(await where.isVisible(), false, 'the test file stays out of sight');
  await card.getByText('자세히').click();
  assert.equal(await where.isVisible(), true, 'and shows on 자세히');

  await on(page, 'q4');
  await page.getByRole('radiogroup', { name: 'q4 판정' }).getByRole('radio', { name: '답함' }).click();
  const fork = page.locator('#question-q4');
  assert.equal(await fork.getByText(plain).isVisible(), true);
  assert.equal(await fork.getByText('test/small.test.mjs').isVisible(), false);

  await page.getByRole('tab', { name: /개요/ }).click();
  const overview = await page.locator('#panel-overview').innerText();
  assert.match(overview, /^동작 차이\s*12개 구매 결제액이 108에서 120이 된다/, 'the overview opens on what changed');
  assert.ok(!overview.includes(repo.dir), 'where the handoff came from stays behind 자세히');
  assert.match(overview, /인계에 빠진 자료\s*최종 리뷰 자료 없음/, 'what is missing reads in plain words');
  assert.doesNotMatch(overview, /sdlcTaskRef/, 'with no internal field names');
  assert.deepEqual(errors, []);
});
