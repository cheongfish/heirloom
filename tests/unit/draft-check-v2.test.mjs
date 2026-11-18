// Evidence checks of a schema 2 draft (pivot plan 5.3): behavior descriptions and questions
// must rest on the recorded probe run, quoted specs and messages must match, and claims
// without a probe go to `inferences`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { checkDraft } from '../../skills/using-heirloom/lib/draft-check.mjs';
import { sha256Of } from '../../skills/using-heirloom/lib/conversation.mjs';

const H = 'a'.repeat(64);
const SOURCE_HASH = `sha256:${'b'.repeat(64)}`;
const PROBE_SET = `sha256:${'c'.repeat(64)}`;
const SPEC = ['# 장바구니', '', '## 할인', '10개 이상 구매하면', '대량 할인을 적용한다.', ''].join('\n');
const TEST_FILE = ['import { test } from "node:test";', '', 'test("bulk discount for 12", () => {', '  assert.equal(total(12), 108);', '});', ''].join('\n');

async function fixture() {
  const root = await tempDir('check2');
  for (const [rel, content] of Object.entries({ 'docs/specs/cart.md': SPEC, 'src/cart.mjs': 'export const x = 1;\n', 'test/cart.test.mjs': TEST_FILE, 'src/other.mjs': '' })) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
  return root;
}

function input() {
  return {
    schemaVersion: 1,
    taskId: 't-20261117-3h7k2p9m',
    source: {
      hash: SOURCE_HASH,
      files: [
        { path: 'src/cart.mjs', status: 'M', sha256: H },
        { path: 'test/cart.test.mjs', status: 'M', sha256: H },
        { path: 'docs/specs/cart.md', status: 'A', sha256: H },
      ],
    },
  };
}

/** @param {string} stdout @param {string} [sha] */
const side = (stdout, sha = sha256Of(stdout)) => ({ exitCode: 0, timedOut: false, error: null, stdout, stderr: '', sha256: sha });

/** A recorded probe run (`probes/result.json`). @returns {any} */
function probes() {
  return {
    schemaVersion: 1,
    inputSourceHash: SOURCE_HASH,
    probeSetHash: PROBE_SET,
    probes: [
      { id: 'p1', title: '12개 구매 결제액', run: ['node', '-e', 'console.log(total({ qty: 12, unit: 10 }))'], base: side('108\n'), head: side('120\n') },
      { id: 'p2', title: '라벨', run: ['node', 'label.mjs'], base: side('label: "old"\n'), head: side('label: "new v2"\n') },
      { id: 'p3', title: '변하지 않는 값', run: ['node', 'x.mjs'], base: side('1\n'), head: side('1\n') },
    ],
    tests: {
      comparison: 'tests',
      changed: [{ name: 'bulk discount for 12', base: 'pass', head: 'fail', location: 'test/cart.test.mjs:3' }],
    },
  };
}

/** @returns {any} */
function draft() {
  return {
    schemaVersion: 2,
    taskId: 't-20261117-3h7k2p9m',
    inputSourceHash: SOURCE_HASH,
    probeSetHash: PROBE_SET,
    behaviorDiffs: [
      { text: '12개 구매 결제액이 108에서 120이 된다', probes: ['p1'], codePaths: ['src/cart.mjs'] },
      { text: '라벨이 "old"에서 “new v2”로 바뀐다', probes: ['p2'], codePaths: [] },
    ],
    questions: [
      { id: 'q1', kind: 'predict', probe: 'p1', prompt: '단가 10원으로 12개를 사면 결제액은?', answerType: 'number' },
      { id: 'q2', kind: 'test-lock', test: 'test/cart.test.mjs:3', plain: '12개 구매는 108원이다', prompt: '이 테스트는 12개 구매의 결제액을 확인하나요?' },
      {
        id: 'q3',
        kind: 'intent',
        probe: 'p1',
        sources: [{ ref: 'docs/specs/cart.md', lines: [4, 5], quote: '10개 이상 구매하면 대량 할인을 적용한다.' }],
        prompt: 'spec의 의도와 실제 결과가 같나요?',
      },
      { id: 'q4', kind: 'fork', probes: ['p1'], codePaths: ['src/cart.mjs'], prompt: '12개 구매에 할인을 적용해야 하나요?', whyOpen: '할인 경계를 정한 이유가 코드, 테스트, 커밋에 없다' },
    ],
    inferences: [{ text: '다른 통화에서도 같다', reason: '통화별 탐침이 없다' }],
    notes: '',
  };
}

/**
 * @param {string} root
 * @param {any} d
 * @param {{ probes?: any, conversation?: any }} [o]
 */
const run = (root, d, o = {}) =>
  checkDraft({ root, input: input(), draft: d, repoFiles: ['docs/specs/cart.md', 'src/cart.mjs', 'src/other.mjs', 'test/cart.test.mjs'], conversation: o.conversation ?? null, probes: 'probes' in o ? o.probes : probes() });

test('v2: a draft backed by the probe run passes; spec quotes get their hash', async () => {
  const root = await fixture();
  const result = await run(root, draft());
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.match(result.draft.questions[2].sources[0].sha256, /^[0-9a-f]{64}$/);
});

test('v2: an observed value or quoted string that no cited probe shows is refused', async () => {
  const root = await fixture();
  const d = draft();
  d.behaviorDiffs[0].text = '12개 구매 결제액이 108에서 130이 된다';
  d.behaviorDiffs[1].text = '라벨이 "old"에서 "new"로 바뀐다 (1,200건)';
  const { errors } = await run(root, d);
  assert.deepEqual(errors, [
    '$.behaviorDiffs[0].text: 인용한 탐침의 명령과 출력에 없는 값 (130)',
    '$.behaviorDiffs[1].text: 인용한 탐침의 명령과 출력에 없는 값 (1200)',
  ]);
  // "new" is part of the output "new v2", so only the number fails; a value from another probe
  // does not count either.
  d.behaviorDiffs[1].text = '라벨이 "old"에서 "v3"으로 바뀐다';
  d.behaviorDiffs[0].text = '결제액이 108에서 120이 된다';
  d.behaviorDiffs[0].probes = ['p3'];
  const again = (await run(root, d)).errors;
  assert.ok(again.includes('$.behaviorDiffs[0].text: 인용한 탐침의 명령과 출력에 없는 값 (108, 120)'), again.join('\n'));
  assert.ok(again.includes('$.behaviorDiffs[1].text: 인용한 탐침의 명령과 출력에 없는 문자열 ("v3")'), again.join('\n'));
});

test('v2: numbers compare by value: 108.0 in the output matches 108 in the text', async () => {
  const root = await fixture();
  const p = probes();
  p.probes[0].base = side('108.0\n');
  assert.deepEqual((await run(root, draft(), { probes: p })).errors, []);
});

test('v2: probes that were not run, a stale or missing probe run and a wrong probe set hash are refused', async () => {
  const root = await fixture();
  const d = draft();
  d.behaviorDiffs[0].probes = ['p9'];
  d.questions[0].probe = 'p8';
  d.questions[3].probes = ['p1', 'p7'];
  assert.deepEqual((await run(root, d)).errors, [
    '$.behaviorDiffs[0].probes[0]: 실행된 탐침이 아님 (p9)',
    '$.questions[0].probe: 실행된 탐침이 아님 (p8)',
    '$.questions[3].probes[1]: 실행된 탐침이 아님 (p7)',
  ]);

  assert.deepEqual((await run(root, draft(), { probes: null })).errors, ['$.probeSetHash: 탐침 실행 기록이 없음. probe.mjs로 탐침을 먼저 실행한다']);
  const stale = probes();
  stale.inputSourceHash = `sha256:${'d'.repeat(64)}`;
  assert.deepEqual((await run(root, draft(), { probes: stale })).errors, ['$.probeSetHash: 탐침 실행 기록이 지금 인계 입력의 소스 상태와 다름. prepare를 다시 실행했다면 probe.mjs도 다시 실행한다']);
  const other = probes();
  other.probeSetHash = `sha256:${'e'.repeat(64)}`;
  assert.match((await run(root, draft(), { probes: other })).errors.join('\n'), /^\$\.probeSetHash: 마지막 탐침 실행\(sha256:e+\)과 다름/);
});

test('v2: a behavior claim without a probe is refused by the schema; it belongs in inferences', async () => {
  const root = await fixture();
  const d = draft();
  d.behaviorDiffs.push({ text: '다른 통화에서도 같다', probes: [], codePaths: [] });
  assert.deepEqual((await run(root, d)).errors, ['$.behaviorDiffs[2].probes: 항목이 1개 이상이어야 함']);
});

test('v2: test-lock points at a changed test or a line of a changed test file', async () => {
  const root = await fixture();
  /** @param {string} t */
  const errorsFor = async (t) => {
    const d = draft();
    d.questions[1].test = t;
    return (await run(root, d)).errors;
  };
  assert.deepEqual(await errorsFor('bulk discount for 12'), [], 'by name');
  assert.deepEqual(await errorsFor('test/cart.test.mjs'), [], 'a changed test file');
  assert.deepEqual(await errorsFor('test/cart.test.mjs:40'), ['$.questions[1].test: test/cart.test.mjs에 40행이 없음']);
  assert.deepEqual(await errorsFor('test/other.test.mjs:3'), ['$.questions[1].test: 결과가 달라진 테스트도, 이번 변경이 고친 테스트 파일의 위치도 아님 (test/other.test.mjs:3)']);
  assert.deepEqual(await errorsFor('some other test'), ['$.questions[1].test: 결과가 달라진 테스트도, 이번 변경이 고친 테스트 파일의 위치도 아님 (some other test)']);
});

test('v2: spec and conversation quotes must match exactly what was written', async () => {
  const root = await fixture();
  const d = draft();
  d.questions[2].sources = [{ ref: 'docs/specs/cart.md', lines: [4, 5], quote: '5개 이상 구매하면 대량 할인을 적용한다.' }];
  d.questions[3].sources = [{ ref: 'docs/specs/cart.md', lines: [1, 2] }, { ref: '@conversation', quote: '할인은 도매 고객만' }];
  const typed = '대량 할인은 도매 계약 고객에게만 적용해 줘.';
  assert.deepEqual((await run(root, d, { conversation: [{ sha256: sha256Of(typed), text: typed }] })).errors, [
    '$.questions[2].sources[0].quote: 원문에서 찾을 수 없음 (docs/specs/cart.md 4-5행)',
    '$.questions[3].sources[0].quote: 이 출처에는 원문 인용(quote)이 필요함',
    '$.questions[3].sources[1].quote: 사용자 발화에서 찾을 수 없음. 에이전트의 답이나 요약이 아닌, 사람이 입력한 문장을 그대로 인용한다',
  ]);
  d.questions[3].sources = [{ ref: '@conversation', quote: '도매 계약 고객에게만' }];
  d.questions[2].sources[0].quote = '10개 이상 구매하면 대량 할인을';
  assert.deepEqual((await run(root, d, { conversation: [{ sha256: sha256Of(typed), text: typed }] })).errors, []);
});

test('conversation sources: the quote must be part of one message the person typed; its hash is filled', async () => {
  const root = await fixture();
  const typed = '할인은\n도매 고객만 받는다. 소매는 정가다.';
  const conversation = [{ sha256: sha256Of(typed), text: typed }, { sha256: sha256Of('좋아'), text: '좋아' }];
  /** @param {any[]} sources @param {any} [conv] */
  const check = (sources, conv = conversation) => {
    const d = draft();
    d.questions[3].sources = sources;
    return run(root, d, { conversation: conv });
  };

  const ok = await check([{ ref: '@conversation', quote: '할인은 도매 고객만 받는다.' }]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.draft.questions[3].sources[0].sha256, sha256Of(typed));
  assert.deepEqual((await check([{ ref: 'docs/specs/cart.md', lines: [4, 5], quote: '10개 이상 구매하면' }, { ref: '@conversation', quote: '소매는 정가다.' }])).errors, [], 'a document and the conversation together');

  assert.match((await check([{ ref: '@conversation' }])).errors.join('\n'), /sources\[0\]\.quote: .*인용/);
  assert.match((await check([{ ref: '@conversation', lines: [1, 1], quote: '좋아' }])).errors.join('\n'), /sources\[0\]\.lines: 대화 출처에는 줄 범위를 쓰지 않음/);
  assert.match((await check([{ ref: '@conversation', quote: '좋아' }], null)).errors.join('\n'), /sources\[0\]\.ref: 이 인계에는 고정된 대화가 없음/);
  assert.match((await check([{ ref: '@conversation', quote: '좋아' }], [])).errors.join('\n'), /고정된 대화가 없음/);
});

test('a draft of another schema version is refused (schema 1 drafts are no longer written)', async () => {
  const root = await fixture();
  const result = await run(root, { schemaVersion: 1, summary: [], records: [] });
  assert.deepEqual(result.errors, ['$.schemaVersion: 2여야 함. prepare-handoff 스킬의 스키마 2 형식으로 쓴다']);
  assert.deepEqual((await run(root, 'nope')).errors, result.errors);
});

test('v2: schema shape: kinds, choices, ids, code paths', async () => {
  const root = await fixture();
  const d = draft();
  d.questions.push({ id: 'q1', kind: 'predict', probe: 'p2', prompt: '라벨은?', answerType: 'choice' });
  d.questions.push({ id: 'q6', kind: 'guess', prompt: '?' });
  d.questions[3].codePaths = ['src/missing.mjs'];
  d.behaviorDiffs[0].codePaths = ['src/other.mjs'];
  const { errors } = await run(root, d);
  assert.ok(errors.includes('$.questions[4]: answerType이 choice일 때만, 그리고 반드시 choices를 쓴다'), errors.join('\n'));
  assert.ok(errors.includes('$.questions[5].kind: predict, test-lock, intent, fork 중 하나여야 함'), errors.join('\n'));
  assert.ok(errors.includes('$.questions[4].id: 질문 id가 중복됨 (q1)'), errors.join('\n'));
  assert.ok(errors.includes('$.questions[3].codePaths[0]: 저장소에 맞는 파일이 없음 (src/missing.mjs)'), errors.join('\n'));
  assert.ok(errors.includes('$.behaviorDiffs[0].codePaths[0]: 변경 파일 목록에 없음 (src/other.mjs)'), errors.join('\n'));
});

test('v2: a choice prediction needs exactly four choices, exactly one of them in the head output', async () => {
  const root = await fixture();
  /** @param {string[]} choices */
  const withChoices = (choices) => {
    const d = draft();
    d.questions.push({ id: 'q5', kind: 'predict', probe: 'p2', prompt: '라벨은?', answerType: 'choice', choices });
    return d;
  };
  assert.deepEqual((await run(root, withChoices(['new v2', 'old v1', 'v3', '빈 문자열']))).errors, []);
  assert.deepEqual((await run(root, withChoices(['new v2', 'old v1', 'v3']))).errors, ['$.questions[4].choices: 항목이 4개 이상이어야 함']);
  assert.deepEqual((await run(root, withChoices(['old v1', 'v3', 'v4', '빈 문자열']))).errors, [
    '$.questions[4].choices: 탐침 p2의 head 출력에 보이는 보기가 0개. 정답 보기 하나만 출력에 있어야 채점됨',
  ]);
  // "new" is part of "new v2": a distractor cut from the answer makes the question unscorable.
  assert.deepEqual((await run(root, withChoices(['new v2', 'new', 'v3', '빈 문자열']))).errors, [
    '$.questions[4].choices: 탐침 p2의 head 출력에 보이는 보기가 2개 (new v2, new). 정답 보기 하나만 출력에 있어야 채점됨',
  ]);
});

test('v2: a free-text prediction is no longer accepted', async () => {
  const root = await fixture();
  const d = draft();
  d.questions.push({ id: 'q5', kind: 'predict', probe: 'p2', prompt: '라벨은?', answerType: 'text' });
  assert.deepEqual((await run(root, d)).errors, ['$.questions[4].answerType: "number", "choice" 중 하나여야 함']);
});

test('v2: warnings: too many questions, none, an unexplained changed probe, a number question without a number', async () => {
  const root = await fixture();
  const d = draft();
  for (let i = 5; i <= 6; i += 1) d.questions.push({ id: `q${i}`, kind: 'predict', probe: 'p2', prompt: '?', answerType: 'number' });
  d.behaviorDiffs.pop();
  const p = probes();
  p.probes[1].head = side('label: "new"\n');
  const { errors, warnings } = await run(root, d, { probes: p });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    '$.questions[4]: 숫자로 답하는 질문인데 탐침 p2의 head 출력에 숫자가 없음',
    '$.questions[5]: 숫자로 답하는 질문인데 탐침 p2의 head 출력에 숫자가 없음',
    '$.questions: 질문이 6개. 이 변경은 한 번에 이해하기에 클 수 있음(기본 3~5개)',
    '탐침 p2: base와 head의 출력이 다르지만 어느 behaviorDiffs에도 쓰이지 않음',
  ]);
  d.questions = [];
  assert.ok((await run(root, d, { probes: p })).warnings.includes('$.questions: 질문이 없음. 사람이 예측해 볼 동작이 없는 변경인지 확인한다'));
});
