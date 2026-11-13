// 회수 점검(R1~R7) 판정 보조: transcript(JSONL, 또는 claude -p --output-format stream-json 출력)에서
// recall.mjs 호출과 그 결과, 첫 코드 수정 위치를 뽑아 "수정 전에 회수했는지"를 보여 준다.
// transcript 형식은 Claude Code 내부 형식이라 버전에 따라 바뀔 수 있다. 결과가 이상하면 직접 확인한다.
// 사용법: node evals/acceptance/check-recall.mjs <transcript.jsonl>
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('사용법: node check-recall.mjs <transcript.jsonl>');
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

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** Code files only: specs, plans and test notes are not what a record covers. */
const isCode = (/** @type {string} */ p) => !/\.(md|mdx|markdown)$/i.test(p) && !p.includes('/.heirloom/');

/** @type {Map<string, string>} tool_use_id → result text */
const results = new Map();
for (const e of entries) {
  if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue;
  for (const block of e.message.content) {
    if (block.type !== 'tool_result') continue;
    const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((/** @type {any} */ c) => c.text ?? '').join('');
    results.set(block.tool_use_id, text);
  }
}

/** @param {string} text */
function summarize(text) {
  const start = text.indexOf('{"ok"');
  if (start === -1) return '결과 JSON 없음';
  try {
    const j = JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    if (!j.ok) return `실패 ${j.error.code}: ${j.error.message}`;
    const d = j.data;
    const parts = [`기록 ${d.records.map((/** @type {any} */ r) => `${r.id}(${r.status})`).join(', ') || '없음'}`];
    if (d.excluded.count) parts.push(`제외 ${d.excluded.items.map((/** @type {any} */ x) => `${x.id}:${x.reason}`).join(', ')}`);
    if (d.pendingWarnings.length) parts.push(`머지 대기 경고 ${d.pendingWarnings.map((/** @type {any} */ w) => `${w.id}:${w.change}`).join(', ')}`);
    if (d.inactive.length) parts.push(`비활성 ${d.inactive.map((/** @type {any} */ x) => x.id).join(', ')}`);
    if (d.missing.length) parts.push(`없음 ${d.missing.join(', ')}`);
    if (d.errors.length) parts.push(`읽기 오류 ${d.errors.length}`);
    if (d.merge.status !== 'checked') parts.push(`머지 판정 ${d.merge.status}`);
    return parts.join(' / ');
  } catch {
    return '결과 JSON을 읽지 못함';
  }
}

// Shell writes to a code file: redirection (`>`, `>>`), `tee` or `sed -i`.
const SHELL_WRITE = /(?:>>?|\btee\s+(?:-a\s+)?|\bsed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+)\s*([^\s;&|<>'"]+)/g;

/** @type {{ at: number, kind: 'recall' | 'read' | 'edit', detail: string, result?: string }[]} */
const timeline = [];
entries.forEach((e, at) => {
  if (e.type !== 'assistant') return;
  for (const block of e.message?.content ?? []) {
    if (block.type !== 'tool_use') continue;
    if (block.name === 'Bash' && /recall-context\/scripts\/recall\.mjs/.test(block.input?.command ?? '')) {
      const args = (block.input.command.match(/recall\.mjs(.*)$/m) ?? ['', ''])[1].trim();
      timeline.push({ at, kind: 'recall', detail: args || '(질의 없음)', result: summarize(results.get(block.id) ?? '') });
    }
    if (block.name === 'Bash') {
      const command = String(block.input?.command ?? '');
      // Reading record files directly instead of through recall.mjs: allowed, but it skips the
      // status check (active, pending, superseded) and the limits.
      if (/\.heirloom\/(decisions|axioms)\//.test(command) && !/recall\.mjs/.test(command)) timeline.push({ at, kind: 'read', detail: command.split('\n')[0].slice(0, 120) });
      // Heredoc bodies are file content, not commands: `a > b` inside them is not a write.
      const shell = command.replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\1(?=\n|$)/g, '$2');
      for (const m of shell.matchAll(SHELL_WRITE)) {
        if (isCode(m[1]) && m[1] !== '/dev/null' && !/^&?\d$/.test(m[1])) timeline.push({ at, kind: 'edit', detail: `Bash ${m[1]}` });
      }
    }
    const target = block.input?.file_path ?? block.input?.notebook_path;
    if (EDIT_TOOLS.has(block.name) && typeof target === 'string' && isCode(target)) {
      timeline.push({ at, kind: 'edit', detail: `${block.name} ${target}` });
    }
  }
});

for (const t of timeline) console.log(`${String(t.at).padStart(5)}  ${t.kind.padEnd(7)} ${t.detail}${t.result ? `\n         → ${t.result}` : ''}`);

const recalls = timeline.filter((t) => t.kind === 'recall');
const reads = timeline.filter((t) => t.kind === 'read');
const firstEdit = timeline.find((t) => t.kind === 'edit');
console.log('\n판정 보조');
console.log(`- recall.mjs 호출: ${recalls.length}회`);
console.log(`- 기록 파일 직접 읽기: ${reads.length}회${firstEdit && reads.some((r) => r.at < firstEdit.at) ? ' (첫 코드 수정 전)' : ''}`);
console.log(`- 첫 코드 수정: ${firstEdit ? firstEdit.detail : '없음'}`);
console.log(
  `- 첫 코드 수정 전 회수: ${firstEdit ? (recalls.some((r) => r.at < firstEdit.at) ? '예' : '아니오') : recalls.length ? '예 (수정 없음)' : '해당 없음'}`,
);
