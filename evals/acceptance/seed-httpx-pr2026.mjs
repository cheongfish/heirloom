// 회수 효과 실험용: 실제 HTTPX PR #2026(머지됨)의 결정을 Heirloom 기록으로 옮겨 시딩한다.
// 결정 내용은 PR 본문에서 가져오며, 실험 작업 요청이나 결과를 보기 전에 정해 둔 것이다.
// 승인 서명은 실제 사람이 아니라 이 스크립트의 파일 키스토어가 붙인다(한계로 보고서에 적는다).
//
// 사용법: HEIRLOOM_HOME=<home> node seed-httpx-pr2026.mjs <fixture 디렉터리> <httpx 전체 clone 경로>
//   <fixture>/upstream  7f0d43d^ 에서 시작한 main (원격 역할)
//   <fixture>/work      upstream clone. PR #2026 커밋 + 출처 문서 + 승인된 기록이 main에 머지된다.
// 결과 main = 7f0d43d(PR #2026 머지 시점 코드) + docs/ 출처 문서 + .heirloom/ 기록

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { applyApproval } from '../../skills/using-heirloom/lib/apply.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { heirloomHome, taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!process.argv[3]) {
  console.error('usage: HEIRLOOM_HOME=<dir> node seed-httpx-pr2026.mjs <fixture> <httpx clone>');
  process.exit(2);
}
const fixture = path.resolve(process.argv[2]);
const source = path.resolve(process.argv[3]);
const upstream = path.join(fixture, 'upstream');
const work = path.join(fixture, 'work');
const home = heirloomHome();
process.env.HEIRLOOM_KEYSTORE = 'file';

const PR_COMMIT = '7f0d43daad60b37d07f7734a83986e9dade59bf7';

/**
 * @param {string} cwd
 * @param {...string} args
 */
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

// 1. 저장소: upstream은 PR 직전 커밋에서 시작한다.
await mkdir(fixture, { recursive: true });
git(fixture, 'clone', '-q', source, 'upstream');
git(upstream, 'checkout', '-q', '-B', 'main', `${PR_COMMIT}^`);
git(fixture, 'clone', '-q', upstream, 'work');
git(work, 'checkout', '-q', '-B', 'seed/pr-2026', 'origin/main');
git(work, 'fetch', '-q', source, PR_COMMIT);
git(work, 'cherry-pick', PR_COMMIT);

// 2. 출처 문서: PR 제목·본문을 그대로 옮긴다. 본문은 gh로 받는다.
const pr = JSON.parse(
  execFileSync('gh', ['pr', 'view', '2026', '-R', 'encode/httpx', '--json', 'title,body,mergedAt,url'], { encoding: 'utf8' }),
);
const bodyLines = pr.body.replace(/\r\n/g, '\n').split('\n');
const header = [
  `# ${pr.title}`,
  '',
  `출처: ${pr.url} (머지 ${pr.mergedAt}). 아래 본문은 PR 본문을 그대로 옮긴 것이다.`,
  '',
];
const specRel = 'docs/superpowers/specs/2022-01-13-httpx-pr-2026.md';
const docLines = [...header, ...bodyLines];
await mkdir(path.join(work, path.dirname(specRel)), { recursive: true });
await writeFile(path.join(work, specRel), `${docLines.join('\n')}\n`);
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'docs: PR #2026 본문을 출처 문서로 추가');

/**
 * 본문에서 주어진 문장을 포함하는 줄(1부터)과 그 줄 전체를 찾는다.
 * @param {string} needle
 */
function locate(needle) {
  const index = docLines.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`본문에서 찾지 못함: ${needle}`);
  return { ref: specRel, lines: [index + 1, index + 1], quote: docLines[index] };
}

const prepared = await prepareHandoff({ cwd: work, home, specs: [specRel] });
const records = [
  {
    op: 'add',
    kind: 'decision',
    title: '클라이언트가 소멸될 때(__del__) 암묵적 close나 경고를 하지 않는다',
    body: {
      problem:
        '닫지 않은 채 소멸된 클라이언트에 대해 동기 클라이언트는 __del__에서 자동 close, 비동기 클라이언트는 경고를 내는 안전장치가 있었다.',
      choice:
        '__del__에서 암묵적으로 close()하거나 경고를 내지 않는다. 누수를 알리는 일은 파이썬 수준의 경고에 맡기고 라이브러리가 더하지 않는다.',
      alternatives:
        '__del__에서 close/경고(기존 동작): atexit 시점에는 stdlib 일부를 쓸 수 없어 warnings.warn조차 신뢰할 수 없고, 사용자에게 예외나 미정의 동작을 주므로 폐기했다.',
      scope: 'httpx/_client.py의 Client, AsyncClient',
    },
    codePaths: ['httpx/_client.py'],
    topics: ['client', 'lifecycle', 'resource-leak', 'warning'],
    sources: [
      locate("So. Let's just *not do this anymore*."),
      locate('Better that we stick with the current status-quo'),
    ],
  },
];
const draft = {
  schemaVersion: 1,
  taskId: prepared.taskId,
  inputSourceHash: prepared.source.hash,
  summary: [{ text: 'Client.__del__의 암묵적 close/경고를 제거했다', codePaths: ['httpx/_client.py'] }],
  records,
  missing: [],
  conflicts: [],
  notes: '',
};
const draftFile = taskPaths(home, prepared.taskId).draft;
await mkdir(path.dirname(draftFile), { recursive: true });
await writeFile(draftFile, JSON.stringify(draft, null, 2));
await submitDraft({ home, taskId: prepared.taskId });
const submitted = /** @type {any} */ (await readJson(draftFile));
await approveTask({
  home,
  taskId: prepared.taskId,
  keystore: 'file',
  request: {
    kind: 'full',
    draftSha256: draftDigest(submitted),
    sourceHash: prepared.source.hash,
    summary: ['Client.__del__의 암묵적 close/경고를 제거했다'],
    items: records.map((_, index) => ({ index, decision: 'approved' })),
  },
});
const applied = /** @type {any} */ (await applyApproval({ home, taskId: prepared.taskId }));
git(work, 'add', ...applied.files);
git(work, 'commit', '-q', '-m', 'docs: PR #2026 결정 기록');
execFileSync(path.join(HERE, 'merge-local.sh'), [fixture, 'seed/pr-2026'], { stdio: ['ignore', 'ignore', 'inherit'] });
git(work, 'checkout', '-q', '-B', 'main', 'origin/main');
console.log(`시딩 완료: 결정 ${applied.records[0].id}, main ${git(work, 'rev-parse', '--short', 'HEAD')}`);
