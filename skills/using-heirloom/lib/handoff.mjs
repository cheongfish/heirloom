// Human-readable handoff file (~/.heirloom/tasks/<id>/handoff.md). Self-contained so that
// the PR can be written later from this file and the approval alone.

import { CONVERSATION_REF } from './conversation.mjs';

/** @type {Record<string, string>} */
const CHANGE_REASON = { edited: '수정', base_updated: '기준 브랜치 갱신으로 인한 변경', added: '추가', removed: '빠짐' };

/** @param {string | null | undefined} h */
const short = (h) => (h ? h.replace(/^sha256:/, '').slice(0, 12) : '없음');

/**
 * Whether the reviewed source state equals the frozen source state.
 * null when no review state is known.
 * @param {any} input
 * @returns {boolean | null}
 */
export function reviewMatchesSource(input) {
  const reviewed = input.materials.filter((/** @type {any} */ m) => m.role === 'review' && m.reviewedSourceHash);
  if (!reviewed.length) return null;
  return reviewed.every((/** @type {any} */ m) => m.reviewedSourceHash === input.source.hash);
}

/** @type {Record<string, string>} */
const QUESTION_KIND = { predict: '예측', 'test-lock': '테스트가 막는 동작', intent: '의도와 일치', fork: '열린 선택' };

/**
 * Questions of a schema 2 draft, without observed values: the person predicts before the
 * dashboard reveals them, so this readable copy shows neither probe outputs nor the
 * behavior descriptions that quote them.
 * @param {any} draft
 * @returns {string[]}
 */
function renderQuestions(draft) {
  const out = ['', `## 질문 (${draft.questions.length})`, ''];
  if (!draft.questions.length) out.push('- 없음');
  for (const q of draft.questions) {
    out.push(`### ${q.id} ${QUESTION_KIND[q.kind] ?? q.kind}`, '', `- ${q.prompt}`);
    if (q.kind === 'test-lock') out.push(`- 테스트: ${q.test} — ${q.plain}`);
    if (q.kind === 'fork') out.push(`- 코드: ${q.codePaths.join(', ')}`, `- 열린 이유: ${q.whyOpen}`);
    if (q.kind === 'predict' && q.choices) out.push(`- 보기: ${q.choices.join(' / ')}`);
    for (const s of q.sources ?? []) {
      const where = s.ref === CONVERSATION_REF ? '대화 (사용자 발화)' : s.lines ? `${s.ref} ${s.lines[0]}-${s.lines[1]}행` : s.ref;
      out.push(`- 근거: ${where}${s.quote ? ` — "${s.quote}"` : ''}`);
    }
    out.push('');
  }
  out.push(`동작 차이 설명 ${draft.behaviorDiffs.length}개와 탐침 출력은 예측을 받은 뒤 대시보드에서 공개한다. 탐침 묶음 ${short(draft.probeSetHash)}.`, '');
  return out;
}

/**
 * @param {{ input: any, draft: any, warnings: string[] }} options
 * @returns {string}
 */
export function renderHandoff({ input, draft, warnings }) {
  const out = [`# 인계: ${input.branch ?? '(detached)'} (${input.taskId})`, ''];
  out.push(
    `- 저장소: ${input.repo.root}${input.repo.remote ? ` (${input.repo.remote})` : ''}`,
    `- worktree: ${input.worktree.path}`,
    `- 대상 브랜치: ${input.base.ref} (merge-base ${input.base.mergeBase.slice(0, 12)})`,
    `- 소스 상태: ${input.source.hash}`,
    `- 인계 방식: ${input.trigger === 'auto' ? '자동' : '수동'}`,
    `- SDLC 작업 식별자: ${input.sdlcTaskRef ?? '미확인'}`,
    `- 준비 시각: ${input.createdAt}`,
  );
  const review = reviewMatchesSource(input);
  if (review === false) out.push('- 리뷰 이후 소스가 바뀜: 최종 리뷰가 대상으로 삼은 상태와 현재 상태가 다르다. 변경이 잘못됐다는 뜻은 아니다.');
  if (review === true) out.push('- 최종 리뷰 대상 상태와 현재 상태가 같다.');

  if (input.recheck) out.push('', '## 재확인', '', `- 기준 판정: ${input.recheck.basedOn}. 탐침 출력이 같은 질문은 판정을 유지하고, 달라진 질문만 다시 묻는다.`, ...input.recheck.changes.map((/** @type {any} */ c) => `- ${c.path}: ${CHANGE_REASON[c.reason] ?? c.reason}`), ...input.recheck.unlinked.map((/** @type {string} */ p) => `- 탐침과 연결되지 않은 변경: ${p}`));

  out.push('', `## 변경 파일 (${input.source.files.length})`, '');
  for (const f of input.source.files) out.push(`- ${f.status} ${f.path}`);

  out.push('', '## 자료', '');
  if (!input.materials.length) out.push('- 없음');
  for (const m of input.materials) out.push(`- ${m.role}: ${m.ref} (${m.sha256 ? short(m.sha256) : '파일 없음'})`);

  out.push(...renderQuestions(draft));

  /** @param {string} title @param {string[]} items */
  const list = (title, items) => {
    if (items.length) out.push(`## ${title}`, '', ...items.map((x) => `- ${x}`), '');
  };
  list('탐침으로 확인하지 못한 주장', (draft.inferences ?? []).map((/** @type {any} */ x) => `${x.text} (확인하지 못한 이유: ${x.reason})`));
  list('미확인 값', input.unknowns);
  list('검사 경고', warnings);
  if (draft.notes) out.push('## 메모', '', draft.notes, '');
  return `${out.join('\n').trimEnd()}\n`;
}
