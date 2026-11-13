// B6(맥락 정리) 점검용: fixture의 main에 승인·머지된 decision을 여러 개 만든다. 실제 세션 없이
// Heirloom 라이브러리로 인계 → 초안 제출 → 서명 승인(파일 키) → 반영 → 머지를 반복한다.
// 세 decision은 같은 이유(반올림하지 않음)를 공유해 axiom 후보가 되고, 하나는 다른 하나와 겹친다.
//
// 사용법: HEIRLOOM_HOME=$F/home node seed-decisions.mjs <fixture 디렉터리> [--more]
//   --more  첫 정리를 머지한 뒤 쓴다. 기존 후보와 무관한 decision 하나만 더한다(반복 제안 점검).
// fixture는 setup-fixture.sh로 만든 것이어야 한다(로컬 모드 또는 가짜 원격 모드).

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
const fixture = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: HEIRLOOM_HOME=<dir> node seed-decisions.mjs <fixture>');
  process.exit(2);
}
const work = path.join(fixture, 'work');
const home = heirloomHome();
process.env.HEIRLOOM_KEYSTORE = 'file';

/** @param {string[]} args */
const git = (...args) => execFileSync('git', ['-c', 'user.name=acceptance', '-c', 'user.email=acceptance@example.invalid', ...args], { cwd: work, encoding: 'utf8' }).trim();

const SEEDS = [
  {
    branch: 'seed/fahrenheit',
    file: 'src/fahrenheit.mjs',
    code: 'export function fahrenheitToCelsius(f) {\n  return ((f - 32) * 5) / 9;\n}\n',
    title: '화씨→섭씨 변환 결과는 반올림하지 않는다',
    decision: '화씨→섭씨 변환 결과는 반올림하지 않는다. 표시 형식은 화면마다 다르므로 호출하는 쪽이 정해야 하기 때문이다.',
    summary: 'fahrenheitToCelsius를 추가했다',
  },
  {
    branch: 'seed/pressure',
    file: 'src/pressure.mjs',
    code: 'export function barToPsi(bar) {\n  return bar * 14.5037738;\n}\n',
    title: '압력 변환 결과는 반올림하지 않는다',
    decision: '압력 변환 결과는 반올림하지 않는다. 표시 형식은 화면마다 다르므로 호출하는 쪽이 정해야 하기 때문이다.',
    summary: 'barToPsi를 추가했다',
  },
  {
    branch: 'seed/length',
    file: 'src/length.mjs',
    code: 'export function inchToCm(inch) {\n  return inch * 2.54;\n}\n',
    title: '길이 변환 결과는 반올림하지 않는다',
    decision: '길이 변환 결과는 반올림하지 않는다. 표시 형식은 화면마다 다르므로 호출하는 쪽이 정해야 하기 때문이다.',
    summary: 'inchToCm을 추가했다',
  },
  {
    branch: 'seed/fahrenheit-raw',
    file: 'src/fahrenheit.mjs',
    code: 'export function fahrenheitToCelsius(f) {\n  return ((f - 32) * 5) / 9;\n}\n\nexport function celsiusToFahrenheitRaw(c) {\n  return (c * 9) / 5 + 32;\n}\n',
    title: '화씨 변환 값은 자르거나 반올림하지 않고 그대로 돌려준다',
    decision: '화씨 변환 값은 자르거나 반올림하지 않고 그대로 돌려준다. 자릿수는 표시하는 쪽이 정하기 때문이다.',
    summary: 'celsiusToFahrenheitRaw를 추가했다',
  },
  {
    branch: 'seed/range',
    file: 'src/range.mjs',
    code: "export function assertAboveAbsoluteZero(c) {\n  if (c < -273.15) throw new RangeError('absolute zero');\n}\n",
    title: '절대영도 미만 입력은 RangeError를 던진다',
    decision: '절대영도 미만 입력은 RangeError를 던진다. 물리적으로 불가능한 값을 조용히 계산하면 오류를 늦게 발견하기 때문이다.',
    summary: 'assertAboveAbsoluteZero를 추가했다',
  },
];

const MORE = [
  {
    branch: 'seed/currency',
    file: 'src/currency.mjs',
    code: 'export function formatWon(amount) {\n  return `${Math.round(amount).toLocaleString(\'ko-KR\')}원`;\n}\n',
    title: '원화 표시는 정수로 반올림하고 천 단위 구분 기호를 붙인다',
    decision: '원화 표시는 정수로 반올림하고 천 단위 구분 기호를 붙인다. 원 아래 단위는 쓰지 않기 때문이다.',
    summary: 'formatWon을 추가했다',
  },
];

/** @type {string[]} */
const made = [];
const seeds = process.argv.includes('--more') ? MORE : SEEDS;
for (const [i, seed] of seeds.entries()) {
  git('checkout', '-q', '-B', seed.branch, 'origin/main');
  const spec = `docs/superpowers/specs/2026-11-${String(i + 1 + (seeds === MORE ? SEEDS.length : 0)).padStart(2, '0')}-${seed.branch.split('/')[1]}.md`;
  const specText = `# ${seed.summary}\n\n## 결정\n- ${seed.decision}\n`;
  await mkdir(path.dirname(path.join(work, spec)), { recursive: true });
  await mkdir(path.dirname(path.join(work, seed.file)), { recursive: true });
  await writeFile(path.join(work, spec), specText);
  await writeFile(path.join(work, seed.file), seed.code);
  git('add', '-A');
  git('commit', '-q', '-m', `feat: ${seed.summary}`);

  const prepared = await prepareHandoff({ cwd: work, home, specs: [spec] });
  const draft = {
    schemaVersion: 1,
    taskId: prepared.taskId,
    inputSourceHash: prepared.source.hash,
    summary: [{ text: seed.summary, codePaths: [seed.file] }],
    records: [
      {
        op: 'add',
        kind: 'decision',
        title: seed.title,
        body: { problem: '변환 결과의 자릿수를 어디서 정할지', choice: seed.decision, alternatives: '', scope: seed.file },
        codePaths: [seed.file],
        topics: ['conversion'],
        sources: [{ ref: spec, lines: [4, 4], quote: `- ${seed.decision}` }],
      },
    ],
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
    request: { kind: 'full', draftSha256: draftDigest(submitted), sourceHash: prepared.source.hash, summary: [seed.summary], items: [{ index: 0, decision: 'approved' }] },
  });
  const applied = /** @type {any} */ (await applyApproval({ home, taskId: prepared.taskId }));
  git('add', ...applied.files);
  git('commit', '-q', '-m', `docs: ${seed.title} 기록`);
  execFileSync(path.join(HERE, 'merge-local.sh'), [fixture, seed.branch], { stdio: ['ignore', 'ignore', 'inherit'] });
  made.push(`${applied.records[0].id}  ${seed.title}  (작업 ${prepared.taskId})`);
}
git('checkout', '-q', '-B', 'main', 'origin/main');
console.log(`main에 머지된 decision ${made.length}개:\n${made.join('\n')}`);
