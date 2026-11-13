// testCadence 점검 판정 보조: 한 세션의 transcript(메인과 하위 에이전트)에서 테스트 실행 명령을
// 순서대로 뽑아 전체 테스트와 대상 테스트로 나눈다.
//
// 사용법: node count-test-runs.mjs <세션 transcript.jsonl>
//   하위 에이전트 transcript는 <세션 ID>/subagents/*.jsonl에서 함께 읽는다.
//
// 전체 테스트: 파일·패턴 인자 없는 `npm test`, `npm run test`, `node --test`.
// 대상 테스트: 테스트 파일이나 이름 패턴을 준 실행.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const main = process.argv[2];
if (!main) {
  console.error('usage: count-test-runs.mjs <session transcript.jsonl>');
  process.exit(2);
}

/**
 * Test runs in one shell command. Heredoc bodies are dropped (a test file being written is not a
 * run), and a segment counts only when it starts with the test command, after an optional `cd`.
 * @param {string} command
 * @returns {('full' | 'focused')[]}
 */
export function classify(command) {
  /** @type {string[]} */
  const kept = [];
  /** @type {string | null} */
  let heredoc = null;
  for (const line of command.split('\n')) {
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    kept.push(line);
    const m = /<<-?\s*['"]?(\w+)['"]?/.exec(line);
    if (m) heredoc = m[1];
  }
  /** @type {('full' | 'focused')[]} */
  const runs = [];
  for (const raw of kept.join('\n').split(/&&|\|\||;|\n|\|/)) {
    const m = /^(?:npm\s+(?:run\s+)?test|node\s+--test)(?=\s|$)(.*)$/.exec(raw.trim());
    if (!m) continue;
    const args = m[1].replace(/\d?>&\d.*$/, '').trim().split(/\s+/).filter((x) => x && x !== '--' && !x.startsWith('--test-reporter'));
    runs.push(args.some((x) => /\.m?[jt]s$|^test\/|--test-name-pattern/.test(x)) ? 'focused' : 'full');
  }
  return runs;
}

/** @param {string} file */
async function commands(file) {
  const out = [];
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return out;
  }
  /** @type {Set<string>} */
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    for (const part of entry?.message?.content ?? []) {
      if (part?.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string') {
        if (part.id && seen.has(part.id)) continue;
        if (part.id) seen.add(part.id);
        for (const kind of classify(part.input.command)) out.push({ at: entry.timestamp, kind, command: part.input.command.split('\n')[0].slice(0, 120) });
      }
    }
  }
  return out;
}

const dir = path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents');
const files = [{ who: 'main', file: main }];
try {
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.jsonl')).sort()) files.push({ who: name.replace(/\.jsonl$/, ''), file: path.join(dir, name) });
} catch {
  // no subagents
}
const all = [];
for (const { who, file } of files) {
  const runs = await commands(file);
  for (const r of runs) all.push({ who, ...r });
  console.log(`${who}: 전체 ${runs.filter((r) => r.kind === 'full').length}, 대상 ${runs.filter((r) => r.kind === 'focused').length}`);
}
all.sort((a, b) => String(a.at).localeCompare(String(b.at)));
console.log(`\n합계: 전체 ${all.filter((r) => r.kind === 'full').length}, 대상 ${all.filter((r) => r.kind === 'focused').length}, 하위 에이전트 ${files.length - 1}개`);
console.log('\n시간순:');
for (const r of all) console.log(`${r.at ?? '-'}  ${r.kind === 'full' ? '전체' : '대상'}  ${r.who}  ${r.command}`);
