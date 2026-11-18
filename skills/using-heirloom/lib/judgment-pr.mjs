// What a signed judgment puts on the pull request: the "사람이 확인한 동작"
// paragraph of the PR body and the `heirloom/understood` commit status.
//
// The paragraph is built from the judgment record only; neither the person nor the agent
// writes it. It sits between markers, so updating it never touches the rest of the body.

import { readFile, writeFile } from 'node:fs/promises';

import { loadApprovalBaseline } from './baseline.mjs';
import { HeirloomError } from './errors.mjs';
import { readEvents } from './events.mjs';
import { tryGit } from './git.mjs';
import { taskPaths } from './paths.mjs';
import { isMarkdownCodePath } from './schema.mjs';
import { ARCHIVE_DIR, specDecisions } from './spec-handling.mjs';
import { computeCommitState, currentSourceState, hashEntries } from './state.mjs';

export const SECTION_START = '<!-- heirloom:understood:start -->';
export const SECTION_END = '<!-- heirloom:understood:end -->';
export const STATUS_CONTEXT = 'heirloom/understood';

/**
 * Hash of the code part of a source state. Markdown changes (spec lifecycle, docs) after a
 * judgment do not change what the person judged.
 * @param {{ path: string, status: 'A' | 'M' | 'D', sha256: string }[]} files
 */
export const codeHash = (files) => hashEntries(files.filter((f) => !isMarkdownCodePath(f.path)));

/**
 * Whether the working tree still holds the code the person judged.
 * @param {{ input: any, judgedFiles: any[] }} options
 */
export async function codeMatches({ input, judgedFiles }) {
  const current = await currentSourceState({ root: input.repo.root, base: input.base });
  return { ok: codeHash(current.files) === codeHash(judgedFiles), mergeBase: current.mergeBase };
}

/**
 * The commit the status goes on: HEAD, when its committed code is exactly the judged code.
 * Uncommitted judged work has no commit yet; the agent commits it first.
 * @param {{ input: any, judgedFiles: any[] }} options
 * @returns {Promise<{ sha: string | null, reason: 'uncommitted' | 'changed' | 'no_head' | null }>}
 */
export async function statusCommit({ input, judgedFiles }) {
  const root = input.repo.root;
  const match = await codeMatches({ input, judgedFiles });
  if (!match.ok) return { sha: null, reason: 'changed' };
  const head = await tryGit(['rev-parse', 'HEAD'], { cwd: root });
  if (!head) return { sha: null, reason: 'no_head' };
  const committed = await computeCommitState({ root, mergeBase: match.mergeBase, commit: head });
  return codeHash(committed.files) === codeHash(judgedFiles) ? { sha: head, reason: null } : { sha: null, reason: 'uncommitted' };
}

/** @type {Record<string, string>} */
const VERDICT_TEXT = {
  'as-expected': '예상대로 확인함',
  'my-misunderstanding': '예측과 달랐지만 의도대로 확인함',
  answered: '답함',
};

/** @param {string} s */
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

/** What the agent did with spec lines the person sent back. @type {Record<string, string>} */
const SPEC_CHOICE_TEXT = {
  'spec-wrong': 'spec이 틀렸다고 판정해 spec에서 고침',
  defer: '이번에는 하지 않기로 하고 spec에 보류로 표시함',
  snapshot: '구현하지 않음. spec은 작성 시점의 스냅샷이라 고치지 않음',
};

/** @param {any} part */
const partName = (part) => `\`${part.ref}${part.lines ? `:${part.lines[0]}-${part.lines[1]}` : ''}\``;

/**
 * Lines on the spec: parts the person sent back in earlier rounds, then the spec's lifetime.
 * @param {any[]} decisions
 * @param {any} afterMerge
 */
function specLines(decisions, afterMerge) {
  /** @type {string[]} */
  const lines = [];
  for (const d of decisions) {
    const quote = d.parts.map((/** @type {any} */ p) => p.quote).find(Boolean);
    lines.push(`- spec ${d.parts.map(partName).join(', ')}${quote ? ` "${oneLine(quote)}"` : ''}: ${SPEC_CHOICE_TEXT[d.choice] ?? d.choice}. 이유: "${oneLine(d.reason)}"`);
  }
  for (const ref of afterMerge?.specs ?? []) {
    const what =
      afterMerge.action === 'delete'
        ? '머지 뒤 삭제(git 이력과 이 PR에 남음)'
        : afterMerge.action === 'archive'
          ? `\`${ARCHIVE_DIR}/\`로 보관`
          : `유지. 소유자: ${oneLine(afterMerge.owner ?? '')}`;
    lines.push(`- spec \`${ref}\`: ${what}.`);
  }
  return lines;
}

/**
 * The paragraph for the PR body.
 * @param {{ judgment: any, draft: any, sha: string | null, rechecking?: { head: string | null } | null, specDecisions?: any[] }} options
 * @returns {string}
 */
export function renderSection({ judgment, draft, sha, rechecking = null, specDecisions = [] }) {
  if (judgment.outcome !== 'accepted') throw new HeirloomError('E_CONFLICT', '되돌린 판정으로는 PR 본문을 만들 수 없음');
  const short = (/** @type {string | null} */ s) => (s ? s.slice(0, 7) : '알 수 없음');
  const lines = [SECTION_START, '### 사람이 확인한 동작', ''];
  if (rechecking) lines.push(`> ${short(sha)} 기준 판정. 현재 head(${short(rechecking.head)})와 다름, 재확인 중.`, '');
  for (const text of judgment.behaviorDiffs.final) lines.push(`- ${oneLine(text)}`);
  const questions = new Map((draft?.questions ?? []).map((/** @type {any} */ q) => [q.id, q]));
  for (const item of judgment.items) {
    const q = /** @type {any} */ (questions.get(item.id)) ?? {};
    const verdict = VERDICT_TEXT[item.verdict] ?? item.verdict;
    const kept = item.carried ? ' (이전 판정 유지)' : '';
    if (item.kind === 'predict') {
      const mark = item.correct === true ? '맞음' : item.correct === false ? '틀림' : '직접 비교';
      lines.push(`- ${oneLine(item.prompt)} 예측 ${oneLine(String(item.answer))}(${mark}) → ${verdict}${kept}`);
    } else if (item.kind === 'test-lock') {
      const said = item.answer === 'yes' ? '막는다' : item.answer === 'no' ? '막지 않는다' : '알 수 없음';
      lines.push(`- 테스트 \`${q.test ?? item.id}\`${q.plain ? `(${oneLine(q.plain)})` : ''}: 이 변경의 동작을 ${said}고 예측 → ${verdict}${kept}`);
    } else if (item.kind === 'intent') {
      lines.push(`- ${oneLine(item.prompt)} → ${item.verdict === 'as-expected' ? '의도와 같음' : '의도와 달라도 맞는 동작으로 확인함'}${kept}`);
    } else {
      const replaces = item.keep?.action === 'record' ? q.decision?.replaces : null;
      const where =
        item.keep?.action === 'record'
          ? ` (저장소에 결정 기록 ${item.keep.id}로 남김${replaces ? `, ${replaces} 대체` : ''})`
          : item.keep?.action === 'retire'
            ? ` (결정 기록 ${item.keep.id}는 더 이상 맞지 않아 지움)`
            : '';
      lines.push(`- 결정: ${oneLine(item.prompt)} — "${oneLine(String(item.answer))}"${where}${kept}`);
    }
  }
  for (const c of judgment.discussions ?? []) {
    const d = (draft?.discussions ?? []).find((/** @type {any} */ x) => x.id === c.id);
    if (!c.confirmed || !d) continue;
    lines.push(`- 토론에서 확정한 결정: ${oneLine(d.choice)} — ${d.url} (저장소에 결정 기록 ${c.recordId}로 남김${d.replaces ? `, ${d.replaces} 대체` : ''})`);
  }
  for (const x of draft?.inferences ?? []) lines.push(`- 실행 증거 없음: ${oneLine(x.text)} (${oneLine(x.reason)})`);
  lines.push(...specLines(specDecisions, judgment.specAfterMerge));
  const probes = [...new Set(judgment.items.flatMap((/** @type {any} */ i) => Object.keys(i.probeHashes).filter((k) => k !== 'tests')))];
  lines.push('', `<sub>Heirloom 판정 ${judgment.id} · 탐침 ${probes.join(', ') || '없음'} · head ${short(sha)}</sub>`, SECTION_END);
  return lines.join('\n');
}

/**
 * Put the paragraph into a PR body: replace the marked part, or append it.
 * @param {string} body
 * @param {string} section
 */
export function mergeSection(body, section) {
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END);
  if (start !== -1 && end > start) return `${body.slice(0, start)}${section}${body.slice(end + SECTION_END.length)}`;
  const trimmed = body.replace(/\s+$/, '');
  return `${trimmed ? `${trimmed}\n\n` : ''}${section}\n`;
}

/**
 * Write the paragraph of the task's latest accepted judgment into a PR body file, replacing
 * an earlier paragraph. `rechecking` marks it as judged on an older head while a recheck runs.
 * @param {{ home: string, taskId: string, bodyFile: string, rechecking?: boolean }} options
 */
export async function writePrBody({ home, taskId, bodyFile, rechecking = false }) {
  const paths = taskPaths(home, taskId);
  const events = await readEvents(paths.events);
  const approvalId = events.filter((e) => e.type === 'approved').at(-1)?.approvalId;
  if (typeof approvalId !== 'string') throw new HeirloomError('E_CONFLICT', '이 작업에는 수용된 판정이 없음');
  const { approval, input, draft } = await loadApprovalBaseline({ home, taskId, approvalId });
  if (approval.kind !== 'judgment') throw new HeirloomError('E_CONFLICT', '판정이 아닌 승인에는 이 단락을 쓰지 않음');
  const recorded = /** @type {any} */ (events.filter((e) => e.type === 'pr_created' && e.approvalId === approvalId).at(-1));
  const sha = typeof recorded?.statusSha === 'string' ? recorded.statusSha : (await statusCommit({ input, judgedFiles: input.source.files })).sha;
  const head = rechecking ? await tryGit(['rev-parse', 'HEAD'], { cwd: input.repo.root }) : null;
  const decisions = await specDecisions({ home, taskId, events });
  const section = renderSection({ judgment: approval, draft, sha, rechecking: rechecking ? { head } : null, specDecisions: decisions });
  let body = '';
  try {
    body = await readFile(bodyFile, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  await writeFile(bodyFile, mergeSection(body, section));
  return { taskId, approvalId, bodyFile, sha, rechecking, section };
}
