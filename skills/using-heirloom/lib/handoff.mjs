// Human-readable handoff file (~/.heirloom/tasks/<id>/handoff.md). Self-contained so that
// the PR can be written later from this file and the approval alone.

import { carriedItems } from './recheck.mjs';

/** @type {Record<string, string>} */
const CHANGE_REASON = { edited: '수정', base_updated: '기준 브랜치 갱신으로 인한 변경', added: '추가', removed: '빠짐' };

/** @param {string} reason */
const reasonText = (reason) =>
  reason === 'unlinked' ? '연결 없는 변경(불확실)' : reason === 'pending' ? '지난 승인에서 보류' : reason.startsWith('material:') ? `자료 변경 ${reason.slice(9)}` : reason.startsWith('with:') ? `대체하는 항목 ${reason.slice(5)}의 재확인` : reason;

/**
 * @param {any} recheck
 * @param {any} draft
 * @returns {string[]}
 */
function renderRecheck(recheck, draft) {
  const out = ['## 증분 재확인', ''];
  out.push(`- 기준 승인: ${recheck.basedOn}`);
  if (recheck.mergeBaseChanged) out.push('- 대상 브랜치가 갱신되어 merge-base가 바뀌었다. 작업이 바꾼 파일의 내용만 비교했다.');
  out.push('', `### 승인 이후 바뀐 파일 (${recheck.changes.length})`, '');
  if (!recheck.changes.length) out.push('- 없음');
  for (const c of recheck.changes) out.push(`- ${c.path}: ${CHANGE_REASON[c.reason] ?? c.reason}`);
  if (recheck.materials.length) out.push('', '### 바뀐 자료', '', ...recheck.materials.map((/** @type {any} */ m) => `- ${m.ref}${m.after === null ? ' (없어짐)' : ''}`));
  if (recheck.affected.unlinked.length) out.push('', '### 연결 없는 변경 (불확실, 요약 전체를 다시 확인)', '', ...recheck.affected.unlinked.map((/** @type {string} */ p) => `- ${p}`));
  out.push('', '### 재확인 대상', '');
  /** @param {string} label @param {any[]} list */
  const items = (label, list) => list.map((a) => `- ${label} ${a.index}: ${a.reasons.map(reasonText).join(', ')}`);
  const extra = (draft.recheck?.extra ?? []).map((/** @type {any} */ e) => `- ${e.kind === 'summary' ? '요약' : '기록'} ${e.baseIndex}: 에이전트 추가 — ${e.reason}`);
  const all = [...items('요약', recheck.affected.summary), ...items('기록', recheck.affected.records), ...extra];
  out.push(...(all.length ? all : ['- 없음. 바뀐 부분이 승인된 항목과 연결되지 않는다.']));
  const carried = carriedItems({ recheck, draft });
  out.push('', `승인이 유지되는 항목: 요약 ${carried.summary.length}개, 기록 ${carried.records.length}개. 번호는 기준 승인의 baseline 위치다.`, '');
  return out;
}

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

/** @param {any} op @param {string} heading */
function renderAdd(op, heading) {
  const lines = [`### ${heading} ${op.id ?? ''} ${op.title}`.replace(/\s+/g, ' ').trim(), ''];
  const labels =
    op.kind === 'axiom'
      ? [['property', '유지할 성질'], ['scope', '적용 범위와 조건'], ['exceptions', '예외'], ['checks', '점검 지침']]
      : [['problem', '문제'], ['choice', '선택과 이유'], ['alternatives', '버린 대안'], ['scope', '적용 범위']];
  for (const [key, label] of labels) lines.push(`- ${label}: ${op.body?.[key] || '(없음)'}`);
  lines.push(`- 연관 코드 경로: ${op.codePaths?.join(', ') || '(없음)'}`);
  if (op.topics?.length) lines.push(`- 주제: ${op.topics.join(', ')}`);
  for (const s of op.sources ?? []) {
    const where = s.lines ? `${s.ref} ${s.lines[0]}-${s.lines[1]}행` : s.ref;
    lines.push(`- 출처: ${where}${s.quote ? ` — "${s.quote}"` : ''}`);
  }
  return lines.join('\n');
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
    `- 인계 방식: ${input.trigger === 'auto' ? '자동' : input.trigger === 'curation' ? '맥락 정리' : '수동'}`,
    `- SDLC 작업 식별자: ${input.sdlcTaskRef ?? '미확인'}`,
    `- 준비 시각: ${input.createdAt}`,
  );
  const review = reviewMatchesSource(input);
  if (review === false) out.push('- 리뷰 이후 소스가 바뀜: 최종 리뷰가 대상으로 삼은 상태와 현재 상태가 다르다. 변경이 잘못됐다는 뜻은 아니다.');
  if (review === true) out.push('- 최종 리뷰 대상 상태와 현재 상태가 같다.');

  if (input.recheck) out.push('', ...renderRecheck(input.recheck, draft));
  if (input.curation) {
    const c = input.curation;
    out.push('', '## 정리 묶음', '', `- 미검토 decision (${c.batch.length}): ${c.batch.join(', ') || '없음'}`, `- 관련 기록 (${c.related.length}): ${c.related.join(', ') || '없음'}`, `- 활성 axiom (${c.axioms.length}): ${c.axioms.join(', ') || '없음'}`, `- 이전 검토 이력: ${c.history.length}건`);
  }

  out.push('', `## 변경 파일 (${input.source.files.length})`, '');
  for (const f of input.source.files) out.push(`- ${f.status} ${f.path}`);

  out.push('', '## 자료', '');
  if (!input.materials.length) out.push('- 없음');
  for (const m of input.materials) out.push(`- ${m.role}: ${m.ref} (${m.sha256 ? short(m.sha256) : '파일 없음'})`);

  out.push('', '## PR 요약 초안', '');
  for (const b of draft.summary) out.push(`- ${b.text} (근거: ${b.codePaths.join(', ') || '없음'})`);

  out.push('', '## decision·axiom 초안', '');
  if (!draft.records.length) out.push('- 없음. 간이 승인 대상이다.');
  draft.records.forEach((/** @type {any} */ op, /** @type {number} */ i) => {
    if (op.op === 'add') out.push(renderAdd(op, `[${i}] 추가 ${op.kind}`), ...(op.evidence ? [`- 근거 decision: ${op.evidence.join(', ')}`] : []), '');
    else if (op.op === 'relate') out.push(`### [${i}] 관계 추가: ${op.target} → ${op.relation.type} ${op.relation.id}`, '', `- 조건: ${op.relation.condition}`, '');
    else if (op.op === 'supersede') out.push(`### [${i}] 대체: ${op.target} → [${op.with}] ${draft.records[op.with]?.id ?? ''}`, '', `- 이유: ${op.reason}`, '');
    else if (op.op === 'deprecate') out.push(`### [${i}] 폐기: ${op.target}`, '', `- 이유: ${op.reason}`, '');
    else if (op.op === 'update') out.push(`### [${i}] 수정: ${op.target}`, '', `- 이유: ${op.reason}`, '');
  });

  /** @param {string} title @param {string[]} items */
  const list = (title, items) => {
    if (items.length) out.push(`## ${title}`, '', ...items.map((x) => `- ${x}`), '');
  };
  list('자료 누락', draft.missing);
  list('자료 충돌', draft.conflicts.map((/** @type {any} */ c) => `${c.refs.join(' ↔ ')}: ${c.note}`));
  list('미확인 값', input.unknowns);
  list('검사 경고', warnings);
  if (draft.notes) out.push('## 메모', '', draft.notes, '');
  return `${out.join('\n').trimEnd()}\n`;
}
