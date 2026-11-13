// 회수 점검(R1~R7)용: setup-fixture.sh로 만든 fixture에 승인·머지된 기록과 시나리오 브랜치를 만든다.
// 실제 세션 없이 Heirloom 라이브러리로 인계 → 초안 제출 → 서명 승인(파일 키) → 반영 → 머지를 반복한다.
//
// 사용법: HEIRLOOM_HOME=$F/home node seed-recall.mjs <fixture 디렉터리>
// fixture는 로컬 원격 모드여야 한다(merge-local.sh로 머지를 흉내 낸다).
//
// main에 머지되는 기록
//   T  온도 변환 결과는 반올림하지 않는다          src/temperature.mjs   topics: rounding, temperature
//   F  섭씨 표시는 소수 첫째 자리와 °C로 고정한다   src/format.mjs        topics: display, temperature
//   P1 압력 변환은 소수 첫째 자리에서 반올림한다    src/pressure.mjs      (P2가 대체함)
//   P2 압력 변환은 반올림하지 않는다               src/pressure.mjs      topics: rounding, pressure
// 머지되지 않은 변경
//   다른 worktree($F/other)에서 승인·반영만 한 T의 대체안(소수 둘째 자리 반올림)
// 시나리오 브랜치 (모두 main에서 갈라짐)
//   recall/base     변경 없음 (R1, R2, R4, R5, R7)
//   recall/moved    src/temperature.mjs → src/units/temperature.mjs 이동 (R3)
//   recall/limits   recall.maxRecords 1, 읽을 수 없는 기록 파일 1개 (R6)

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
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
if (!process.argv[2]) {
  console.error('usage: HEIRLOOM_HOME=<dir> node seed-recall.mjs <fixture>');
  process.exit(2);
}
const fixture = path.resolve(process.argv[2]);
const work = path.join(fixture, 'work');
const other = path.join(fixture, 'other');
const home = heirloomHome();
process.env.HEIRLOOM_KEYSTORE = 'file';

/**
 * @param {string} cwd
 * @param {...string} args
 */
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', ...args], { cwd, encoding: 'utf8' }).trim();

/**
 * @param {string} cwd
 * @param {Record<string, string>} files
 */
async function writeFiles(cwd, files) {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, rel)), { recursive: true });
    await writeFile(path.join(cwd, rel), text);
  }
}

let specNo = 0;

/**
 * One task: commit code and a spec, hand off, approve every item, apply and commit the records.
 * @param {{ cwd: string, branch: string, files: Record<string, string>, summary: string,
 *   decision: { title: string, text: string, codePaths: string[], topics: string[] },
 *   supersedes?: string, merge: boolean }} seed
 * @returns {Promise<{ id: string, taskId: string }>}
 */
async function seedTask(seed) {
  const { cwd } = seed;
  git(cwd, 'checkout', '-q', '-B', seed.branch, 'origin/main');
  specNo += 1;
  const spec = `docs/superpowers/specs/2026-10-${String(specNo).padStart(2, '0')}-${seed.branch.split('/').pop()}.md`;
  await writeFiles(cwd, { ...seed.files, [spec]: `# ${seed.summary}\n\n## 결정\n- ${seed.decision.text}\n` });
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', `feat: ${seed.summary}`);

  const prepared = await prepareHandoff({ cwd, home, specs: [spec] });
  const d = seed.decision;
  /** @type {any[]} */
  const records = [
    {
      op: 'add',
      kind: 'decision',
      title: d.title,
      body: { problem: '변환·표시 결과의 자릿수를 어디서 정할지', choice: d.text, alternatives: '', scope: d.codePaths.join(', ') },
      codePaths: d.codePaths,
      topics: d.topics,
      sources: [{ ref: spec, lines: [4, 4], quote: `- ${d.text}` }],
    },
  ];
  if (seed.supersedes) records.push({ op: 'supersede', target: seed.supersedes, reason: d.text, with: 0 });
  const draft = {
    schemaVersion: 1,
    taskId: prepared.taskId,
    inputSourceHash: prepared.source.hash,
    summary: [{ text: seed.summary, codePaths: Object.keys(seed.files) }],
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
      summary: [seed.summary],
      items: records.map((_, index) => ({ index, decision: 'approved' })),
    },
  });
  const applied = /** @type {any} */ (await applyApproval({ home, taskId: prepared.taskId }));
  git(cwd, 'add', ...applied.files);
  git(cwd, 'commit', '-q', '-m', `docs: ${d.title} 기록`);
  if (seed.merge) execFileSync(path.join(HERE, 'merge-local.sh'), [fixture, seed.branch], { stdio: ['ignore', 'ignore', 'inherit'] });
  return { id: applied.records[0].id, taskId: prepared.taskId };
}

const TEMPERATURE = 'export function celsiusToFahrenheit(c) {\n  return (c * 9) / 5 + 32;\n}\n';

const t = await seedTask({
  cwd: work,
  branch: 'seed/temperature',
  files: { 'src/temperature.mjs': `${TEMPERATURE}\nexport function fahrenheitToCelsius(f) {\n  return ((f - 32) * 5) / 9;\n}\n` },
  summary: 'fahrenheitToCelsius를 추가했다',
  decision: {
    title: '온도 변환 결과는 반올림하지 않는다',
    text: '온도 변환 함수는 계산 결과를 반올림하지 않고 그대로 돌려준다. 자릿수는 화면마다 다르므로 표시하는 쪽이 정하기 때문이다.',
    codePaths: ['src/temperature.mjs'],
    topics: ['rounding', 'temperature'],
  },
  merge: true,
});
const f = await seedTask({
  cwd: work,
  branch: 'seed/format',
  files: { 'src/format.mjs': "export function formatCelsius(c) {\n  return `${c.toFixed(1)}°C`;\n}\n" },
  summary: 'formatCelsius를 추가했다',
  decision: {
    title: '섭씨 표시는 소수 첫째 자리와 °C로 고정한다',
    text: '섭씨 표시는 소수 첫째 자리까지 고정하고 단위 기호 °C를 붙인다. 화면마다 표기가 달라 값을 비교하기 어려웠기 때문이다.',
    codePaths: ['src/format.mjs'],
    topics: ['display', 'temperature'],
  },
  merge: true,
});
const p1 = await seedTask({
  cwd: work,
  branch: 'seed/pressure',
  files: { 'src/pressure.mjs': 'export function barToPsi(bar) {\n  return Math.round(bar * 14.5037738 * 10) / 10;\n}\n' },
  summary: 'barToPsi를 추가했다',
  decision: {
    title: '압력 변환은 소수 첫째 자리에서 반올림한다',
    text: '압력 변환 결과는 소수 첫째 자리에서 반올림한다. 계기판 표기와 맞추기 위해서다.',
    codePaths: ['src/pressure.mjs'],
    topics: ['rounding', 'pressure'],
  },
  merge: true,
});
const p2 = await seedTask({
  cwd: work,
  branch: 'seed/pressure-raw',
  files: { 'src/pressure.mjs': 'export function barToPsi(bar) {\n  return bar * 14.5037738;\n}\n' },
  summary: 'barToPsi가 반올림하지 않도록 바꿨다',
  decision: {
    title: '압력 변환은 반올림하지 않는다',
    text: '압력 변환 결과는 반올림하지 않는다. 계기판마다 자릿수가 달라 변환 함수에서 정하면 값이 어긋나기 때문이다.',
    codePaths: ['src/pressure.mjs'],
    topics: ['rounding', 'pressure'],
  },
  supersedes: p1.id,
  merge: true,
});

// Another worktree approves a replacement of T and applies it, but it is not merged.
git(work, 'worktree', 'add', '-q', '-b', 'seed/temperature-round', other, 'origin/main');
const pending = await seedTask({
  cwd: other,
  branch: 'seed/temperature-round',
  files: { 'src/temperature.mjs': `${TEMPERATURE.replace('return (c * 9) / 5 + 32;', 'return Math.round(((c * 9) / 5 + 32) * 100) / 100;')}` },
  summary: 'celsiusToFahrenheit 결과를 반올림하도록 바꿨다',
  decision: {
    title: '온도 변환 결과는 소수 둘째 자리에서 반올림한다',
    text: '온도 변환 결과는 소수 둘째 자리에서 반올림한다. 화면마다 반올림이 달라 결과가 어긋나기 때문이다.',
    codePaths: ['src/temperature.mjs'],
    topics: ['rounding', 'temperature'],
  },
  supersedes: t.id,
  merge: false,
});

// Scenario branches.
git(work, 'checkout', '-q', '-B', 'main', 'origin/main');
git(work, 'checkout', '-q', '-B', 'recall/base', 'origin/main');

git(work, 'checkout', '-q', '-B', 'recall/moved', 'origin/main');
await mkdir(path.join(work, 'src/units'), { recursive: true });
git(work, 'mv', 'src/temperature.mjs', 'src/units/temperature.mjs');
git(work, 'commit', '-q', '-m', 'refactor: 온도 변환을 src/units로 옮김');
execFileSync(path.join(HERE, 'merge-local.sh'), [fixture, 'recall/moved'], { stdio: ['ignore', 'ignore', 'inherit'] });
// Merged so the move is on main and the branch starts with no changes, like a new task after a refactor.
git(work, 'checkout', '-q', '-B', 'recall/moved', 'origin/main');

git(work, 'checkout', '-q', '-B', 'recall/limits', 'origin/main');
await writeFiles(work, {
  '.heirloom/config.json': `${JSON.stringify({ schemaVersion: 1, recall: { maxRecords: 1 } }, null, 2)}\n`,
  '.heirloom/decisions/d-broken00.md': '---json\n{ "schemaVersion": 1, "id": "d-broken00",\n---\n깨진 기록\n',
});
git(work, 'add', '-A');
git(work, 'commit', '-q', '-m', 'chore: 회수 제한 설정과 깨진 기록 (R6)');

git(work, 'checkout', '-q', 'recall/base');
console.log(
  [
    'main에 머지된 기록',
    `  T  ${t.id}  온도 변환 결과는 반올림하지 않는다`,
    `  F  ${f.id}  섭씨 표시는 소수 첫째 자리와 °C로 고정한다`,
    `  P1 ${p1.id}  압력 변환은 소수 첫째 자리에서 반올림한다 (대체됨)`,
    `  P2 ${p2.id}  압력 변환은 반올림하지 않는다`,
    '머지되지 않은 변경',
    `  ${pending.id}  T를 대체하는 반올림 결정 (작업 ${pending.taskId}, worktree ${other})`,
    '브랜치: recall/base(현재), recall/moved, recall/limits',
  ].join('\n'),
);
