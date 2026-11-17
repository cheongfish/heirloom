// 회수 효과 실험용 일반 시더: <case>/case.json의 실제 머지 PR 결정을 Heirloom 기록으로 옮겨 시딩한다.
// seed-httpx-pr2026.mjs를 case.json 기반으로 일반화한 것이다. 승인 서명은 스크립트의 파일 키스토어가 붙인다.
//
// 사용법: HEIRLOOM_HOME=<home> node seed-case.mjs <case 디렉터리> <fixture 디렉터리>
//   <case>/src      전체 이력 clone (base_sha에 체크아웃). 결정 커밋은 squash 머지여야 한다.
//   <fixture>/upstream  decision_commit^ 에서 시작한 main (원격 역할)
//   <fixture>/work      upstream clone. 결정 PR 커밋 + 출처 문서 + 승인된 기록이 main에 머지된다.
//
// 토론 모드: case.json의 decision_commit이 null이면 결정을 담은 머지 커밋이 없는 경우다(거절된 PR, "의도된 동작" 답변만 있는 이슈).
//   upstream main은 base_sha에서 시작하고 체리픽은 없다. 출처 문서는 <case>/decision-source.md(토론 원문)를 그대로 쓰고,
//   문서 이름은 decision.source_doc_name, codePaths는 base_sha에 있는 code_paths다.

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
  console.error('usage: HEIRLOOM_HOME=<dir> node seed-case.mjs <case dir> <fixture dir>');
  process.exit(2);
}
const caseDir = path.resolve(process.argv[2]);
const fixture = path.resolve(process.argv[3]);
const source = path.join(caseDir, 'src');
const upstream = path.join(fixture, 'upstream');
const work = path.join(fixture, 'work');
const home = heirloomHome();
process.env.HEIRLOOM_KEYSTORE = 'file';

const spec = JSON.parse(await readFile(path.join(caseDir, 'case.json'), 'utf8'));
const dec = spec.decision;
const PR_COMMIT = spec.decision_commit;
const threadMode = PR_COMMIT == null;

/**
 * @param {string} cwd
 * @param {...string} args
 */
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();

// 부모가 둘이면 머지 커밋이다. 첫 번째 부모 기준 diff가 PR 전체이므로 -m 1로 옮긴다.
const parents = threadMode ? 0 : git(source, 'rev-list', '--parents', '-n', '1', PR_COMMIT).split(' ').length - 1;
if (!threadMode && parents !== 1 && parents !== 2) throw new Error(`결정 커밋의 부모 수가 이상하다: ${PR_COMMIT} 부모 ${parents}개`);

await mkdir(fixture, { recursive: true });
git(fixture, 'clone', '-q', '--single-branch', '--branch', 'main', '--no-tags', `file://${source}`, 'upstream');
git(upstream, 'checkout', '-q', '-B', 'main', threadMode ? spec.base_sha : `${PR_COMMIT}^1`);
git(fixture, 'clone', '-q', upstream, 'work');
git(work, 'checkout', '-q', '-B', 'seed/decision', 'origin/main');
if (!threadMode) {
  git(work, 'fetch', '-q', source, PR_COMMIT);
  git(work, 'cherry-pick', ...(parents === 2 ? ['-m', '1'] : []), PR_COMMIT);
}

// 결정 이유가 PR 본문이 아니라 토론(PR 댓글, 연결된 이슈)에만 있으면 <case>/decision-source.md에 원문을 옮겨 두고 그것을 출처 문서로 쓴다.
const threadDoc = await readFile(path.join(caseDir, 'decision-source.md'), 'utf8').catch(() => null);
if (threadMode && !threadDoc) throw new Error('토론 모드에는 <case>/decision-source.md가 필요하다');
/** @type {string[]} */
let docLines;
let specRel;
let label;
if (threadMode) {
  docLines = /** @type {string} */ (threadDoc).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  specRel = `docs/superpowers/specs/${dec.source_doc_name}.md`;
  label = dec.source_label;
} else {
  const pr = JSON.parse(
    execFileSync('gh', ['pr', 'view', String(dec.pr_number), '-R', spec.repo, '--json', 'title,body,mergedAt,url'], { encoding: 'utf8' }),
  );
  docLines = threadDoc
    ? threadDoc.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
    : [`# ${pr.title}`, '', `출처: ${pr.url} (머지 ${pr.mergedAt}). 아래 본문은 PR 본문을 그대로 옮긴 것이다.`, '', ...pr.body.replace(/\r\n/g, '\n').split('\n')];
  specRel = `docs/superpowers/specs/${pr.mergedAt.slice(0, 10)}-pr-${dec.pr_number}.md`;
  label = `PR #${dec.pr_number}`;
}
await mkdir(path.join(work, path.dirname(specRel)), { recursive: true });
await writeFile(path.join(work, specRel), `${docLines.join('\n')}\n`);
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', `docs: ${label} 토론을 출처 문서로 추가`);

/** @param {string} quote */
function locate(quote) {
  const index = docLines.findIndex((line) => line === quote);
  if (index < 0) throw new Error(`본문에서 한 줄 전체로 찾지 못함: ${quote}`);
  return { ref: specRel, lines: [index + 1, index + 1], quote };
}

// codePaths는 결정 PR이 실제로 바꾼 코드 파일이어야 하고 마크다운은 안 된다. case.json 값을 그 교집합으로 거른다.
// 토론 모드에는 결정 PR이 없으므로 base_sha에 실제로 있는 코드 파일로 거른다.
const changed = new Set(
  threadMode
    ? git(source, 'ls-tree', '-r', '--name-only', spec.base_sha).split('\n')
    : git(source, 'diff', '--name-only', `${PR_COMMIT}^1`, PR_COMMIT).split('\n'),
);
const codePaths = dec.code_paths.filter((p) => changed.has(p) && !/\.(md|rst|txt)$/i.test(p));
if (codePaths.length === 0) throw new Error(`PR 변경 파일과 겹치는 code_paths가 없음: ${dec.code_paths.join(', ')}`);
console.log(`codePaths: ${codePaths.join(', ')}`);

const prepared = await prepareHandoff({ cwd: work, home, specs: [specRel] });
const records = [
  {
    op: 'add',
    kind: 'decision',
    title: dec.title,
    body: { problem: dec.problem, choice: dec.choice, alternatives: dec.alternatives, scope: dec.scope },
    codePaths,
    topics: dec.topics,
    sources: dec.quotes.map(locate),
  },
];
const summaryText = `${label}의 결정을 기록했다`;
const draft = {
  schemaVersion: 1,
  taskId: prepared.taskId,
  inputSourceHash: prepared.source.hash,
  // 토론 모드에는 코드 변경이 없으므로 요약에는 코드 경로가 없다(마크다운 출처 문서는 넣을 수 없다).
  summary: [{ text: summaryText, codePaths: threadMode ? [] : codePaths }],
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
    summary: [summaryText],
    items: records.map((_, index) => ({ index, decision: 'approved' })),
  },
});
const applied = /** @type {any} */ (await applyApproval({ home, taskId: prepared.taskId }));
git(work, 'add', '-f', ...applied.files);
git(work, 'commit', '-q', '-m', `docs: ${label} 결정 기록`);
execFileSync(path.join(HERE, 'merge-local.sh'), [fixture, 'seed/decision'], { stdio: ['ignore', 'ignore', 'inherit'] });
git(work, 'checkout', '-q', '-B', 'main', 'origin/main');
// base_sha가 결정 커밋보다 뒤이면(결정을 이력 속에 묻는 변형) 결정 머지 뒤의 upstream 커밋을 이어서 얹는다.
if (!threadMode && spec.base_sha !== spec.decision_commit) {
  const later = git(source, 'rev-list', '--reverse', '--first-parent', `${PR_COMMIT}..${spec.base_sha}`).split('\n').filter(Boolean);
  for (const sha of later) {
    const n = git(source, 'rev-list', '--parents', '-n', '1', sha).split(' ').length - 1;
    git(upstream, 'cherry-pick', ...(n === 2 ? ['-m', '1'] : []), sha);
  }
  git(work, 'fetch', '-q', upstream, '+refs/heads/main:refs/remotes/origin/main');
  git(work, 'checkout', '-q', '-B', 'main', 'origin/main');
  console.log(`결정 뒤 ${later.length}개 커밋을 얹음`);
}
// 미래 이력이 upstream에 남지 않게 한다: 원격 추적 참조를 지우고 도달 불가능한 객체를 정리한다.
for (const ref of git(upstream, 'for-each-ref', '--format=%(refname)', 'refs/remotes').split('\n').filter(Boolean)) git(upstream, 'update-ref', '-d', ref);
git(upstream, 'reflog', 'expire', '--expire=now', '--all');
git(upstream, 'gc', '-q', '--prune=now');
console.log(`시딩 완료: 결정 ${applied.records[0].id}, main ${git(work, 'rev-parse', '--short', 'HEAD')}`);
