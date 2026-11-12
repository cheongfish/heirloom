// What the fake `claude` does in a curation worktree, standing in for an agent that follows
// the skills: curate proposes one axiom candidate and one relation; apply writes, commits
// and pushes the approved records.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [phase, taskId] = process.argv.slice(2);

/** @param {string} script @param {string[]} args */
function run(script, args) {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'skills', script), ...args], { encoding: 'utf8' });
  const result = JSON.parse(out);
  if (!result.ok) throw new Error(`${script}: ${JSON.stringify(result.error)}`);
  return result.data;
}
/** @param {string[]} args */
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

if (phase === 'curate') {
  const prepared = run('curate-decisions/scripts/prepare-curation.mjs', []);
  const [first, second, third] = prepared.batch;
  const draft = {
    schemaVersion: 1,
    taskId,
    inputSourceHash: prepared.inputSourceHash,
    summary: [{ text: '반올림 결정 두 개를 axiom 후보로 묶었다', codePaths: [] }],
    records: [
      {
        op: 'add',
        kind: 'axiom',
        title: '금액은 반올림하지 않는다',
        body: { property: '금액 계산은 반올림 없이 끝까지 정확한 값을 쓴다', scope: 'src/money', exceptions: '', checks: '반올림 호출이 없는지 본다' },
        codePaths: ['src/money/**'],
        topics: ['rounding'],
        evidence: [first.id, second.id],
        sources: [{ ref: first.file, quote: '금액 계산 결과를 반올림하면 합계가 맞지 않는다' }],
      },
      { op: 'relate', target: first.id, relation: { type: 'coexist', id: third.id, condition: '환불 계산일 때' } },
    ],
    missing: [],
    conflicts: [],
    notes: '',
  };
  writeFileSync(prepared.draftPath, JSON.stringify(draft, null, 2));
  run('prepare-handoff/scripts/submit-draft.mjs', ['--task', taskId]);
} else {
  const applied = run('apply-approval/scripts/apply.mjs', ['--task', taskId]);
  git('add', ...applied.files, ...applied.removed);
  git('commit', '-q', '-m', 'docs: 맥락 정리 반영');
  git('push', '-q', applied.pr.remote, applied.pr.head);
}
