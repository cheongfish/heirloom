// A2(압축) 판정 보조: Claude Code transcript(JSONL)에서 압축 경계, 경계 뒤 Heirloom 규약 재주입,
// 인계 호출 위치를 뽑는다. transcript 형식은 Claude Code 내부 형식이라 버전에 따라 바뀔 수 있다
// (2.1.322에서 확인). 결과가 이상하면 transcript를 직접 확인한다.
// 사용법: node evals/acceptance/check-compact.mjs <transcript.jsonl>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('사용법: node check-compact.mjs <transcript.jsonl>');
  process.exit(2);
}
/** @type {any[]} */
const entries = readFileSync(file, 'utf8').trim().split('\n').flatMap((l) => {
  try {
    return [JSON.parse(l)];
  } catch {
    return [];
  }
});

/** @type {{ at: number, kind: string, detail: string }[]} */
const timeline = [];
entries.forEach((e, at) => {
  if (e.type === 'system' && e.subtype === 'compact_boundary') {
    timeline.push({ at, kind: 'compact', detail: JSON.stringify(e.compactMetadata ?? e.compact_metadata ?? {}) });
  }
  if (e.type === 'attachment' && e.attachment?.type === 'hook_additional_context' && e.attachment?.hookEvent === 'SessionStart') {
    const text = JSON.stringify(e.attachment);
    timeline.push({ at, kind: 'session-start', detail: text.includes('heirloom-convention') ? 'Heirloom 규약 포함' : 'Heirloom 규약 없음' });
  }
  if (e.type === 'assistant') {
    for (const block of e.message?.content ?? []) {
      if (block.type !== 'tool_use') continue;
      const input = JSON.stringify(block.input ?? {});
      if (block.name === 'Skill' && input.includes('prepare-handoff')) timeline.push({ at, kind: 'handoff-skill', detail: input.slice(0, 120) });
      if (block.name === 'Bash' && /prepare-handoff\/scripts\/(prepare|submit-draft)\.mjs/.test(input)) {
        timeline.push({ at, kind: 'handoff-script', detail: (input.match(/(prepare|submit-draft)\.mjs/) ?? [''])[0] });
      }
    }
  }
  if (e.type === 'system' && e.subtype === 'stop_hook_summary') timeline.push({ at, kind: 'stop-hook', detail: JSON.stringify(e).slice(0, 120) });
});

for (const t of timeline) console.log(`${String(t.at).padStart(5)}  ${t.kind.padEnd(15)} ${t.detail}`);

const compacts = timeline.filter((t) => t.kind === 'compact');
const reinjected = compacts.map((c) => timeline.some((t) => t.kind === 'session-start' && t.at > c.at && t.detail === 'Heirloom 규약 포함'));
const prepares = timeline.filter((t) => t.kind === 'handoff-script' && t.detail === 'prepare.mjs');
console.log('\n판정 보조');
console.log(`- 압축 횟수: ${compacts.length}`);
console.log(`- 압축마다 뒤에 Heirloom 규약 재주입: ${reinjected.length ? reinjected.map((r) => (r ? '예' : '아니오')).join(', ') : '압축 없음'}`);
console.log(`- prepare.mjs 실행 횟수: ${prepares.length}${compacts.length && prepares.length ? ` (첫 압축 ${prepares[0].at > compacts[0].at ? '뒤' : '앞'})` : ''}`);
