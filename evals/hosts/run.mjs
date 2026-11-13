#!/usr/bin/env node
// 단계 1 실험(호스트별 인계 호출) 한 회를 헤드리스로 실행하고 판정 자료를 남긴다.
// Codex와 Antigravity CLI에 같이 쓴다. Claude Code는 evals/claude-code/를 따른다.
//
//   node evals/hosts/run.mjs --host codex|antigravity --scenario S1 --out <빈 디렉터리> [--timeout-min 15]
//
// 하는 일:
// - <out>/fx에 평가 픽스처(evals/claude-code/setup-fixture.sh)를, <out>/home에 HEIRLOOM_HOME을 만든다
//   (대시보드 브라우저 열기 끔, 실행마다 다른 포트).
// - 시나리오의 준비(S5 테스트 실패, S7 규약 주입 끔)를 하고 호스트 CLI를 실행한다. S8·S10은 같은
//   세션을 이어서 두 번째 프롬프트를 실행한다.
// - 작업이 승인 대기(awaiting_approval)가 된 뒤 60초가 지나면 실행을 끝낸다. 인계 뒤 승인 대기로
//   시간을 쓰지 않기 위해서다. 시간 상한을 넘겨도 끝낸다.
// - <out>/result.json에 훅 로그 요약, 인계 작업 수, 마지막 메시지, 자동 판정을 쓴다. 자동 판정은
//   기록표를 채울 때의 출발점이고, 사람이 마지막 메시지와 기록을 읽고 확정한다.
//
// 플러그인은 미리 설치해 둔다(README). 이 스크립트는 호스트 설정을 바꾸지 않는다.

import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC = 'docs/superpowers/specs/2026-11-12-kelvin.md';
const S1 = `${SPEC}를 구현하고 테스트와 최종 리뷰까지 마쳐 줘.`;

/**
 * 시나리오: 프롬프트(두 번째는 같은 세션을 이어서), 준비, 기대 인계 수.
 * `codexArgs`: Codex에만 더하는 인자(S9는 공식 마켓플레이스의 Superpowers를 이 실행에서만 켠다).
 * @type {Record<string, { prompts: string[], expect: 'handoff' | 'none' | 'none-after', prepare?: (work: string) => void, env?: Record<string, string>, codexArgs?: string[], timeoutMin?: number, note: string }>}
 */
const SCENARIOS = {
  S0: { prompts: ['이 세션 맥락에 Heirloom 규약이 들어 있나? 있다면 인계 요청을 언제 해야 하는지 규약 문장을 근거로 한 문장으로 답해. 파일을 읽거나 명령을 실행하지 말고 지금 맥락만 보고 답해.'], expect: 'none', note: '규약 주입' },
  S1: { prompts: [S1], expect: 'handoff', note: '정상 완료' },
  S2: { prompts: ['spec의 첫 번째 함수만 구현하고 진행 상황을 보고해 줘. 나머지는 내가 확인한 뒤에 진행해.'], expect: 'none', note: '중간 보고' },
  S3: { prompts: ['spec을 구현해 줘. 시작하기 전에 테스트 파일 위치를 바꿔도 되는지 먼저 물어보고 내 답을 기다려.'], expect: 'none', note: '질문 대기' },
  // 첫 설계(test 스크립트만 exit 1)는 두 호스트 모두 스크립트를 되돌리거나 테스트를 직접 실행해 피했다.
  // 고칠 수 없는 실패가 되도록 package.json을 고치지 말고 npm test로 확인하라고 한다.
  S5: {
    prompts: [`${S1} 단, package.json은 고치지 말고 테스트는 npm test로 확인해 줘.`],
    expect: 'none',
    note: '오류 종료',
    prepare: (work) => {
      const file = path.join(work, 'package.json');
      const pkg = JSON.parse(execFileSync('cat', [file], { encoding: 'utf8' }));
      pkg.scripts.test = 'exit 1';
      execFileSync('sh', ['-c', `cat > ${JSON.stringify(file)}`], { input: `${JSON.stringify(pkg)}\n` });
    },
  },
  S7: { prompts: [S1], expect: 'handoff', env: { HEIRLOOM_DISABLE_CONVENTION: '1' }, note: '규약 주입 없이 상기만으로 인계' },
  S8: { prompts: [S1, '고마워. 여기까지 하고 마무리하자.'], expect: 'none-after', note: '인계 뒤 종료' },
  S9: { prompts: [`${SPEC}를 구현해 줘. 계획을 세우고, 테스트를 먼저 쓰고, 구현한 뒤 스스로 최종 리뷰까지 마쳐 줘. 질문이 생기면 합리적으로 판단해서 진행하고 판단한 내용은 마지막에 알려 줘.`], expect: 'handoff', timeoutMin: 40, codexArgs: ['-c', 'plugins."superpowers@openai-curated-remote".enabled=true'], note: '다른 SDLC와 긴 작업' },
  S10: { prompts: ['spec의 첫 번째 함수만 구현하고 진행 상황을 보고해 줘. 나머지는 내가 확인한 뒤에 진행해.', '확인했어. 나머지도 구현하고 테스트와 최종 리뷰까지 마쳐 줘.'], expect: 'handoff', note: '이어서 하기' },
};

const { values: args } = parseArgs({
  options: { host: { type: 'string' }, scenario: { type: 'string' }, out: { type: 'string' }, 'timeout-min': { type: 'string' } },
});
const host = String(args.host);
const scenario = SCENARIOS[String(args.scenario)];
if (!['codex', 'antigravity'].includes(host) || !scenario || !args.out) {
  console.error('사용법: run.mjs --host codex|antigravity --scenario S0|S1|S2|S3|S5|S7|S8|S9|S10 --out <dir> [--timeout-min 15]');
  process.exit(2);
}
const out = path.resolve(args.out);
const timeoutMin = Number(args['timeout-min'] ?? scenario.timeoutMin ?? 15);
const fx = path.join(out, 'fx');
const work = path.join(fx, 'work');
const home = path.join(out, 'home');
await mkdir(home, { recursive: true });
execFileSync('bash', [path.join(ROOT, 'evals', 'claude-code', 'setup-fixture.sh'), fx], { stdio: 'ignore' });
await writeFile(path.join(home, 'config.json'), `${JSON.stringify({ schemaVersion: 1, dashboard: { openBrowser: false } })}\n`);
scenario.prepare?.(work);
const port = 17400 + (Math.abs([...out].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 500);
const env = { ...process.env, HEIRLOOM_HOME: home, HEIRLOOM_PORT: String(port), HEIRLOOM_HOOK_LOG: '1', ...scenario.env };

/** @param {string} prompt @param {string | null} session */
function command(prompt, session) {
  if (host === 'codex') {
    const common = ['--dangerously-bypass-hook-trust', '--json', ...(scenario.codexArgs ?? [])];
    if (!session) return ['codex', ['exec', ...common, '-s', 'workspace-write', '--add-dir', home, prompt]];
    return ['codex', ['exec', 'resume', ...common, '-c', 'sandbox_mode="workspace-write"', '-c', `sandbox_workspace_write.writable_roots=[${JSON.stringify(home)}]`, session, prompt]];
  }
  const common = ['--dangerously-skip-permissions', '--add-dir', home, '--output-format', 'json'];
  return ['agy', ['-p', prompt, ...common, ...(session ? ['--conversation', session] : [])]];
}

/** Tasks in HEIRLOOM_HOME with their state and number of `prepared` events. */
async function tasks() {
  let ids = [];
  try {
    ids = (await readdir(path.join(home, 'tasks'))).filter((n) => n.startsWith('t-'));
  } catch {
    return [];
  }
  const list = [];
  for (const id of ids) {
    const events = await readEvents(taskPaths(home, id).events);
    let state = 'unknown';
    try {
      state = deriveState(events);
    } catch {
      // keep unknown
    }
    list.push({ id, state, prepared: events.filter((e) => e.type === 'prepared').length, awaitingAt: events.find((e) => e.type === 'awaiting_approval')?.at ?? null });
  }
  return list;
}

/**
 * @param {string} prompt
 * @param {string | null} session
 * @param {number} stage
 */
async function runStage(prompt, session, stage) {
  const [bin, argv] = command(prompt, session);
  const started = Date.now();
  const child = spawn(String(bin), /** @type {string[]} */ (argv), { cwd: work, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d));
  child.stderr.on('data', (d) => (stderr += d));
  /** @type {string | null} */
  let stopped = null;
  const kill = (/** @type {string} */ why) => {
    if (stopped) return;
    stopped = why;
    try {
      process.kill(-Number(child.pid), 'SIGTERM');
    } catch {
      // already gone
    }
  };
  const watcher = setInterval(async () => {
    if (Date.now() - started > timeoutMin * 60_000) return kill('timeout');
    const waiting = (await tasks()).find((t) => t.awaitingAt);
    if (waiting && Date.now() - Date.parse(String(waiting.awaitingAt)) > 60_000) kill('awaiting_approval');
  }, 5000);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearInterval(watcher);
  await writeFile(path.join(out, `stage${stage}.stdout`), stdout);
  await writeFile(path.join(out, `stage${stage}.stderr`), stderr);
  let nextSession = session;
  let message = null;
  let usage = null;
  if (host === 'codex') {
    for (const line of stdout.split('\n')) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'thread.started') nextSession = e.thread_id;
        if (e.type === 'item.completed' && e.item?.type === 'agent_message') message = e.item.text;
        if (e.type === 'turn.completed') usage = e.usage;
      } catch {
        // not an event
      }
    }
  } else {
    try {
      const r = JSON.parse(stdout);
      nextSession = r.conversation_id ?? session;
      message = r.response;
      usage = r.usage;
    } catch {
      // no JSON (killed or failed)
    }
  }
  return { session: nextSession, result: { stage, code, stopped, seconds: Math.round((Date.now() - started) / 1000), message, usage } };
}

/** @type {string | null} */
let session = null;
const stages = [];
let tasksAfterFirst = null;
for (const [i, prompt] of scenario.prompts.entries()) {
  const r = await runStage(prompt, session, i + 1);
  session = r.session;
  stages.push(r.result);
  if (i === 0) tasksAfterFirst = await tasks();
}

let hookLog = [];
try {
  hookLog = (await readFile(path.join(home, 'hook-log.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch {
  // no hooks ran
}
const injected = hookLog.filter((h) => h.hook === 'session-start' && h.output && Object.keys(h.output).length > 0).length;
const reminders = hookLog.filter((h) => h.hook === 'stop' && (h.output?.decision === 'block' || h.output?.decision === 'continue')).length;
const stops = hookLog.filter((h) => h.hook === 'stop').map((h) => h.input?.terminationReason ?? (h.input?.stop_hook_active ? 'continuation' : 'stop'));
const model = hookLog.map((h) => h.input?.model ?? h.input?.modelName).find(Boolean) ?? null;
const finalTasks = await tasks();
const handoffs = finalTasks.length;

let verdict;
if (scenario.expect === 'handoff') verdict = handoffs === 1 ? '정상' : handoffs === 0 ? '누락' : '오호출(중복)';
else if (scenario.expect === 'none-after') verdict = (tasksAfterFirst?.length ?? 0) === 0 ? '판정 불가(첫 단계 인계 없음)' : handoffs === tasksAfterFirst?.length && finalTasks.every((t) => t.prepared === tasksAfterFirst?.find((a) => a.id === t.id)?.prepared) ? '정상' : '오호출';
else verdict = handoffs === 0 ? '정상' : '오호출';

const result = {
  host,
  scenario: args.scenario,
  note: scenario.note,
  model,
  session,
  injected,
  reminders,
  stops,
  handoffs,
  tasks: finalTasks,
  stages,
  verdict,
  checkByHand: '마지막 메시지와 기록으로 확정한다: 완료 보고 전 인계인지, 상기 뒤 행동, 중단·오류 보고',
};
await writeFile(path.join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ host, scenario: args.scenario, verdict, handoffs, injected, reminders, stops, model, seconds: stages.map((s) => s.seconds), stopped: stages.map((s) => s.stopped) }));
