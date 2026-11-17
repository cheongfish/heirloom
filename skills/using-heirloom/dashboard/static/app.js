// Heirloom dashboard. Vanilla JS on top of the vendored SEED Design CSS.
// SEED class names are written out in full (never assembled from parts) so the layout test
// can check that each one exists in the vendored CSS.

const TOKEN = document.querySelector('meta[name="heirloom-token"]')?.getAttribute('content') ?? '';

// ------------------------------------------------------------------ theme

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => document.documentElement.setAttribute('data-seed-user-color-scheme', darkQuery.matches ? 'dark' : 'light');
applyScheme();
darkQuery.addEventListener('change', applyScheme);

// Sticky elements (banner, tab list) sit right under the top bar, whose height depends on
// the font and zoom: measure it instead of hard-coding it in the CSS.
const topbar = document.querySelector('.hl-topbar');
if (topbar) {
  const setTopbarHeight = () => document.documentElement.style.setProperty('--hl-topbar-h', `${topbar.getBoundingClientRect().height}px`);
  setTopbarHeight();
  new ResizeObserver(setTopbarHeight).observe(topbar);
}

// ------------------------------------------------------------------ SEED class names

const BUTTON = {
  primary:
    'seed-action-button seed-action-button--variant_brandSolid seed-action-button--size_medium seed-action-button--layout_withText seed-action-button--size_medium-layout_withText',
  neutral:
    'seed-action-button seed-action-button--variant_neutralSolid seed-action-button--size_medium seed-action-button--layout_withText seed-action-button--size_medium-layout_withText',
  outline:
    'seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_medium seed-action-button--layout_withText seed-action-button--size_medium-layout_withText',
  smallWeak:
    'seed-action-button seed-action-button--variant_neutralWeak seed-action-button--size_small seed-action-button--layout_withText seed-action-button--size_small-layout_withText',
  smallOutline:
    'seed-action-button seed-action-button--variant_neutralOutline seed-action-button--size_small seed-action-button--layout_withText seed-action-button--size_small-layout_withText',
  smallGhost:
    'seed-action-button seed-action-button--variant_ghost seed-action-button--size_small seed-action-button--layout_withText seed-action-button--size_small-layout_withText',
};

/** @typedef {'neutral' | 'informative' | 'positive' | 'warning' | 'critical'} Tone */

/** @type {Record<Tone, string>} */
const BADGE = {
  neutral: 'seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_neutral-variant_weak',
  informative: 'seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_informative-variant_weak',
  positive: 'seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_positive-variant_weak',
  warning: 'seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_warning-variant_weak',
  critical: 'seed-badge__root seed-badge__root--size_medium seed-badge__root--variant_weak seed-badge__root--tone_critical-variant_weak',
};

/** @type {Record<Tone, { root: string, title: string, description: string }>} */
const CALLOUT = {
  neutral: {
    root: 'seed-callout__root seed-callout__root--tone_neutral',
    title: 'seed-callout__title seed-callout__title--tone_neutral',
    description: 'seed-callout__description seed-callout__description--tone_neutral',
  },
  informative: {
    root: 'seed-callout__root seed-callout__root--tone_informative',
    title: 'seed-callout__title seed-callout__title--tone_informative',
    description: 'seed-callout__description seed-callout__description--tone_informative',
  },
  positive: {
    root: 'seed-callout__root seed-callout__root--tone_positive',
    title: 'seed-callout__title seed-callout__title--tone_positive',
    description: 'seed-callout__description seed-callout__description--tone_positive',
  },
  warning: {
    root: 'seed-callout__root seed-callout__root--tone_warning',
    title: 'seed-callout__title seed-callout__title--tone_warning',
    description: 'seed-callout__description seed-callout__description--tone_warning',
  },
  critical: {
    root: 'seed-callout__root seed-callout__root--tone_critical',
    title: 'seed-callout__title seed-callout__title--tone_critical',
    description: 'seed-callout__description seed-callout__description--tone_critical',
  },
};

const BANNER = {
  informative: {
    root: 'seed-page-banner__root seed-page-banner__root--tone_informative-variant_weak',
    title: 'seed-page-banner__title seed-page-banner__title--tone_informative-variant_weak',
    description: 'seed-page-banner__description seed-page-banner__description--tone_informative-variant_weak',
    button: 'seed-page-banner__button seed-page-banner__button--tone_informative-variant_weak',
  },
  critical: {
    root: 'seed-page-banner__root seed-page-banner__root--tone_critical-variant_weak',
    title: 'seed-page-banner__title seed-page-banner__title--tone_critical-variant_weak',
    description: 'seed-page-banner__description seed-page-banner__description--tone_critical-variant_weak',
    button: 'seed-page-banner__button seed-page-banner__button--tone_critical-variant_weak',
  },
};

const TABS = {
  root: 'seed-tabs__root seed-tabs__root--size_medium seed-tabs__root--contentLayout_hug',
  list: 'seed-tabs__list seed-tabs__list--size_medium seed-tabs__list--triggerLayout_hug',
  trigger: 'seed-tabs__trigger seed-tabs__trigger--size_medium seed-tabs__trigger--triggerLayout_hug',
  indicator: 'seed-tabs__indicator seed-tabs__indicator--triggerLayout_hug',
  content: 'seed-tabs__content hl-panel',
};

const INPUT_ROOT = 'seed-text-input__root seed-text-input__root--variant_outline seed-text-input__root--variant_outline-size_medium';
const INPUT_VALUE = 'seed-text-input__value seed-text-input__value--size_medium seed-text-input__value--variant_outline-size_medium';

// ------------------------------------------------------------------ DOM helpers

/** @typedef {Node | string | number | null | undefined | false | Child[]} Child */

/**
 * @param {Element} el
 * @param {Child[]} children
 */
function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(typeof c === 'number' ? String(c) : c);
  }
}

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, unknown>} [props]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    else if (key === 'value') /** @type {HTMLInputElement} */ (el).value = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/** @param {Element} el @param {...Child} children */
function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

/** @param {Tone} tone @param {string} label */
const badge = (tone, label) => h('span', { class: BADGE[tone] }, h('span', { class: 'seed-badge__label' }, label));

/**
 * @param {Tone} tone
 * @param {string} title
 * @param {Child} [description]
 */
function callout(tone, title, description) {
  const c = CALLOUT[tone];
  return h(
    'div',
    { class: c.root, role: tone === 'critical' ? 'alert' : 'note' },
    h('div', { class: 'seed-callout__content' }, h('span', { class: c.title }, title), description ? h('span', { class: c.description }, description) : null),
  );
}

/**
 * @param {string} cls
 * @param {string} label
 * @param {(ev: Event) => void} onclick
 * @param {Record<string, unknown>} [props]
 */
const button = (cls, label, onclick, props = {}) => h('button', { type: 'button', class: cls, onclick, ...props }, label);

/** @param {string | null | undefined} hash */
const short = (hash) => (hash ? hash.replace(/^sha256:/, '').slice(0, 12) : '없음');
/** @param {string | null | undefined} iso */
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR') : '알 수 없음');
/** @param {string[] | undefined} paths */
const pathList = (paths) =>
  paths?.length ? h('div', { class: 'hl-paths' }, paths.map((p) => h('span', { class: 'hl-path' }, p))) : h('span', { class: 'hl-muted' }, '없음');

/**
 * A text input or textarea in SEED's outline style. Focus is mirrored to data-focus on the
 * root because the focus ring is drawn by the root. `oneLine` is a textarea that wraps long
 * text but takes no line breaks (titles): a single-line input would hide most of a long title.
 * @param {{ value: string, multiline?: boolean, oneLine?: boolean, label: string, placeholder?: string, oninput: (value: string) => void }} o
 */
function textInput({ value, multiline = false, oneLine = false, label, placeholder, oninput }) {
  const field = multiline || oneLine
    ? h('textarea', { class: oneLine ? `${INPUT_VALUE} hl-one-line` : INPUT_VALUE, 'aria-label': label, placeholder, rows: oneLine ? 1 : 2 })
    : h('input', { class: INPUT_VALUE, type: 'text', 'aria-label': label, placeholder });
  field.value = value;
  const root = h('div', { class: multiline || oneLine ? `${INPUT_ROOT} hl-textarea-root` : INPUT_ROOT }, field);
  field.addEventListener('focus', () => root.setAttribute('data-focus', ''));
  field.addEventListener('blur', () => root.removeAttribute('data-focus'));
  if (oneLine) {
    field.addEventListener('keydown', (ev) => {
      if (/** @type {KeyboardEvent} */ (ev).key === 'Enter') ev.preventDefault();
    });
  }
  field.addEventListener('input', () => {
    if (oneLine && /[\r\n]/.test(field.value)) field.value = field.value.replace(/\s*[\r\n]+\s*/g, ' ');
    oninput(field.value);
  });
  return root;
}

/**
 * Labeled field (SEED field + field-label).
 * @param {string} label
 * @param {Child} control
 * @param {string} [description]
 */
const fieldBlock = (label, control, description) =>
  h(
    'div',
    { class: 'seed-field__root' },
    h('div', { class: 'seed-field__header' }, h('span', { class: 'seed-field-label__root seed-field-label__root--weight_bold' }, label)),
    control,
    description ? h('div', { class: 'seed-field__footer' }, h('span', { class: 'seed-field__description' }, description)) : null,
  );

/**
 * Approve / reject / hold control: a radio group styled as a SEED segmented control.
 * Starts with nothing selected; the human must choose.
 * @param {{ label: string, value: Decision | null, onchange: (value: Decision) => void }} o
 */
function decisionControl({ label, value, onchange }) {
  /** @type {[Decision, string][]} */
  const options = [
    ['approved', '승인'],
    ['rejected', '거절'],
    ['pending', '보류'],
  ];
  const root = h('div', { class: 'seed-segmented-control__root hl-decision', role: 'radiogroup', 'aria-label': label });
  root.style.setProperty('--segment-count', String(options.length));
  root.append(h('div', { class: 'seed-segmented-control__indicator', 'aria-hidden': 'true' }));
  /** @type {HTMLButtonElement[]} */
  const items = options.map(([v, text]) => h('button', { type: 'button', role: 'radio', class: 'seed-segmented-control__item', 'data-value': v }, text));
  root.append(...items);

  /** @param {Decision | null} v */
  const set = (v) => {
    const index = options.findIndex(([o]) => o === v);
    items.forEach((item, i) => {
      item.setAttribute('aria-checked', String(i === index));
      item.toggleAttribute('data-checked', i === index);
      item.tabIndex = i === (index < 0 ? 0 : index) ? 0 : -1;
    });
    root.toggleAttribute('data-has-value', index >= 0);
    root.style.setProperty('--segment-index', String(Math.max(index, 0)));
  };
  /** @param {number} i */
  const choose = (i) => {
    set(options[i][0]);
    onchange(options[i][0]);
  };
  items.forEach((item, i) => {
    item.addEventListener('click', () => choose(i));
    item.addEventListener('keydown', (ev) => {
      const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      const next = (i + step + items.length) % items.length;
      items[next].focus();
      choose(next);
    });
  });
  set(value);
  return { root, set };
}

// ------------------------------------------------------------------ API

class ApiError extends Error {
  /** @param {number} status @param {string} code @param {string} message */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** @param {string} path @param {RequestInit} [init] */
async function api(path, init) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new ApiError(0, 'E_NETWORK', '대시보드 서버에 연결할 수 없습니다. 에이전트에게 open-dashboard 실행을 요청하세요.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    const code = body.error?.code ?? 'E_INTERNAL';
    let message = body.error?.message ?? `요청 실패 (${res.status})`;
    if (res.status === 403 && code === 'E_FORBIDDEN') message = '대시보드 서버가 다시 시작됐습니다. 화면을 새로 고친 뒤 다시 시도하세요.';
    throw new ApiError(res.status, code, message);
  }
  return body;
}

/** @param {string} path @param {unknown} body */
const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-heirloom-token': TOKEN }, body: JSON.stringify(body) });

// ------------------------------------------------------------------ labels

/** @typedef {'approved' | 'rejected' | 'pending'} Decision */

/** @type {Record<string, [Tone, string]>} */
const STATE = {
  prepared: ['neutral', '준비됨'],
  drafted: ['neutral', '초안 검사 통과'],
  awaiting_approval: ['informative', '승인 대기'],
  approved: ['positive', '승인됨'],
  applied: ['positive', '기록 반영됨'],
  pr_created: ['positive', 'PR 작성됨'],
  failed: ['critical', '실패'],
  stale: ['critical', '재확인 필요'],
  returned: ['warning', '되돌림'],
  discarded: ['neutral', '폐기됨'],
  expired: ['neutral', '만료됨'],
};
/** @param {string | null} state */
const stateBadge = (state) => {
  const [tone, label] = STATE[state ?? ''] ?? ['neutral', state ?? '알 수 없음'];
  return badge(tone, label);
};

/**
 * Screen names of the record kinds. The README calls them 결정(decision) and 규칙(axiom);
 * the original word is shown once where a kind is introduced (section titles).
 * @type {Record<string, string>}
 */
const KIND = { decision: '결정', axiom: '규칙' };
/** @param {string} kind */
const kindName = (kind) => KIND[kind] ?? kind;

/** @type {Record<string, string>} */
const OP = { add: '추가', update: '수정', supersede: '대체', deprecate: '폐기', relate: '관계 추가' };
/** @type {Record<string, string>} */
const RELATION = { exception: '예외', coexist: '병존' };
const FINISHED = new Set(['pr_created', 'discarded', 'expired']);
/** Approved, waiting for the agent to write the records and open the PR. */
const APPLYING = new Set(['approved', 'applied']);

/** @type {Record<string, [string, string][]>} */
const BODY_FIELDS = {
  decision: [
    ['problem', '문제'],
    ['choice', '선택과 이유'],
    ['alternatives', '버린 대안'],
    ['scope', '적용 범위'],
  ],
  axiom: [
    ['property', '유지할 성질'],
    ['scope', '적용 범위와 조건'],
    ['exceptions', '예외'],
    ['checks', '점검 지침'],
  ],
};

/** @param {string} taskId @param {string | null} repoId @param {string | null} worktreeId */
const taskHref = (taskId, repoId, worktreeId) => `/r/${repoId ?? '-'}/w/${worktreeId ?? '-'}/t/${taskId}`;

// ------------------------------------------------------------------ banner

const bannerSlot = /** @type {HTMLElement} */ (document.getElementById('banner'));
const main = /** @type {HTMLElement} */ (document.getElementById('app'));

/**
 * @param {'informative' | 'critical'} tone
 * @param {string} title
 * @param {string} description
 * @param {{ label: string, onclick: () => void }} [action]
 */
function showBanner(tone, title, description, action) {
  const c = BANNER[tone];
  replace(
    bannerSlot,
    h(
      'div',
      { class: c.root, role: 'status' },
      h(
        'div',
        { class: 'seed-page-banner__content' },
        h('div', { class: 'seed-page-banner__body' }, h('span', { class: c.title }, title), h('span', { class: c.description }, description)),
        action ? h('button', { type: 'button', class: c.button, onclick: action.onclick }, action.label) : null,
      ),
    ),
  );
}
const clearBanner = () => bannerSlot.replaceChildren();

// ------------------------------------------------------------------ overview

/**
 * @param {string} title
 * @param {Child[]} rows
 * @param {string} empty
 */
function listSection(title, rows, empty) {
  return h(
    'section',
    { class: 'hl-card hl-list-card' },
    h('div', { class: 'seed-list-header seed-list-header--variant_boldSolid' }, h('span', {}, title), h('span', { class: 'hl-muted' }, String(rows.length))),
    rows.length ? rows : h('p', { class: 'hl-empty hl-muted hl-small' }, empty),
  );
}

/**
 * One line for the overview sections that have nothing to show, so empty cards do not push
 * the waiting approvals down.
 * @param {string[]} titles
 */
const emptySections = (titles) =>
  titles.length ? h('p', { class: 'hl-muted hl-small hl-empty-sections' }, `비어 있는 목록: ${titles.join(' · ')}`) : null;

/** @param {any} t */
const taskRow = (t) =>
  h(
    'a',
    { class: 'seed-list-item__root', href: taskHref(t.taskId, t.repoId, t.worktreeId) },
    h(
      'div',
      { class: 'seed-list-item__content' },
      h('span', { class: 'seed-list-item__title' }, t.branch ?? '(브랜치 없음)'),
      h('span', { class: 'seed-list-item__detail' }, `${t.repoRoot ?? '저장소 알 수 없음'} · ${t.taskId} · 갱신 ${when(t.updatedAt)}`),
    ),
    h('div', { class: 'seed-list-item__suffix' }, h('div', { class: 'hl-row' }, t.merged === true ? badge('positive', '머지됨') : stateBadge(t.state))),
  );

/** @param {any} t a listed task: finished, or applied without a PR and already merged */
const isDone = (t) => FINISHED.has(t.state) || t.merged === true;

async function renderOverview() {
  const data = await api('/api/tasks');
  /** @type {any[]} */
  const tasks = data.tasks;
  const waiting = tasks.filter((t) => t.state === 'awaiting_approval');
  const stale = tasks.filter((t) => t.stale && t.state !== 'awaiting_approval');
  const active = tasks.filter((t) => !t.stale && t.state !== 'awaiting_approval' && !isDone(t));
  const applying = active.filter((t) => APPLYING.has(t.state));
  const open = active.filter((t) => !APPLYING.has(t.state));
  const done = tasks.filter((t) => isDone(t) && !t.stale).slice(0, 10);

  const unhandedRows = data.unhanded.map((/** @type {any} */ c) =>
    h(
      'div',
      { class: 'seed-list-item__root', title: c.files.join('\n') },
      h(
        'div',
        { class: 'seed-list-item__content' },
        h('span', { class: 'seed-list-item__title' }, `${c.branch ?? '(브랜치 없음)'} · 코드 파일 ${c.files.length}개 변경`),
        h('span', { class: 'seed-list-item__detail' }, `${c.path} · 대상 ${c.base} · 소스 상태 ${short(c.sourceHash)}`),
      ),
      h('div', { class: 'seed-list-item__suffix' }, badge('warning', '인계 안 됨')),
    ),
  );
  const uncheckedNote = data.unchecked.length
    ? h(
        'p',
        { class: 'hl-empty hl-muted hl-small' },
        `확인하지 못한 작업 트리 ${data.unchecked.length}개: `,
        data.unchecked.map((/** @type {any} */ u) => `${u.path} (${u.reason})`).join(', '),
      )
    : null;

  // Sections below the waiting approvals are drawn only when they have rows; the empty ones
  // are named on one line at the end.
  /** @type {string[]} */
  const empty = [];
  /** @param {string} title @param {Child[]} rows @param {Child} [note] */
  const optional = (title, rows, note = null) => {
    if (rows.length || note) return h('div', {}, listSection(title, rows, `${title} 항목이 없습니다.`), note);
    empty.push(title);
    return null;
  };
  replace(
    main,
    h('h1', { class: 'hl-title' }, '전체 목록'),
    listSection('승인 대기', waiting.map(taskRow), '승인을 기다리는 인계가 없습니다.'),
    optional('반영 대기', applying.map(taskRow)),
    optional('인계되지 않은 변경', unhandedRows, uncheckedNote),
    optional(`오래된 미처리 건 (${data.staleDays}일 이상)`, stale.map(taskRow)),
    optional('진행 중', open.map(taskRow)),
    optional('최근 끝난 작업', done.map(taskRow)),
    emptySections(empty),
  );
}

// ------------------------------------------------------------------ task screen

/**
 * @typedef {object} Form
 * @property {any} task the task the form was built from (its draftSha256 and sourceHash are sent)
 * @property {string} summary PR summary as one text, one bullet per line (see summaryLines)
 * @property {Map<number, Decision>} decisions
 * @property {Map<number, { title: string, body: Record<string, string> }>} edits
 * @property {Map<number, (d: Decision) => void>} setters
 * @property {{ decision: number[], axiom: number[] }} kinds record indexes per tab
 * @property {Set<number>} carriedRecords record indexes that keep their approval (incremental handoff)
 * @property {Set<number>} carriedSummary draft summary indexes that keep their approval
 * @property {Set<number>} reopened carried records the human opened for review again
 * @property {Set<number>} editing added records shown as an edit form (others are a read view)
 * @property {boolean} dirty
 * @property {boolean} busy
 */

/** @type {Form | null} */
let form = null;
/** @type {any} */
let latest = null;

/** @param {any} input */
function reviewMatch(input) {
  const reviewed = input.materials.filter((/** @type {any} */ m) => m.role === 'review' && m.reviewedSourceHash);
  if (!reviewed.length) return null;
  return reviewed.every((/** @type {any} */ m) => m.reviewedSourceHash === input.source.hash);
}

/** @param {any} task */
function titleBlock(task) {
  const input = task.input;
  return h(
    'section',
    { class: 'hl-stack-tight' },
    h('div', { class: 'hl-spread' }, h('h1', { class: 'hl-title' }, '인계 검토'), h('div', { class: 'hl-row' }, stateBadge(task.state), h('code', { class: 'hl-muted' }, task.taskId))),
    h(
      'div',
      { class: 'hl-spread' },
      input ? h('p', {}, h('code', {}, input.branch ?? '(분리된 HEAD)'), ' → ', h('code', {}, input.base.ref)) : h('span'),
      // Discard is rare and cannot be undone: it sits by the title, not in the sticky approval bar.
      (form ?? judge)?.task.taskId === task.taskId ? discardButton : null,
    ),
  );
}

/** git name-status letters of the changed files, in display order. @type {[string, Tone, string][]} */
const FILE_STATUS = [
  ['A', 'positive', '신규'],
  ['M', 'informative', '수정'],
  ['D', 'critical', '삭제'],
];

/**
 * Changed files grouped as new, modified and deleted; the summary line shows the counts.
 * @param {{ path: string, status: string }[]} files
 */
function changedFiles(files) {
  const known = new Set(FILE_STATUS.map(([s]) => s));
  /** @type {[string, Tone, string][]} */
  const groups = [...FILE_STATUS, ['?', 'neutral', '기타']];
  const of = (/** @type {string} */ s) => files.filter((f) => (s === '?' ? !known.has(f.status) : f.status === s));
  const counts = groups.map(([s, , label]) => [label, of(s).length]).filter(([, n]) => n);
  return h(
    'details',
    {},
    h('summary', {}, `변경 파일 ${files.length}개`, counts.length ? h('span', { class: 'hl-small' }, ` (${counts.map(([label, n]) => `${label} ${n}`).join(' · ')})`) : null),
    h(
      'div',
      { class: 'hl-stack' },
      groups.map(([s, tone, label]) => {
        const list = of(s);
        if (!list.length) return null;
        return h(
          'div',
          { class: 'hl-stack-tight' },
          h('div', { class: 'hl-row' }, badge(tone, label), h('span', { class: 'hl-muted hl-small' }, `${list.length}개`)),
          h('ul', { class: 'hl-files' }, list.map((f) => h('li', {}, h('code', {}, f.path), s === '?' ? h('span', { class: 'hl-muted' }, ` ${f.status}`) : null))),
        );
      }),
    ),
  );
}

/** @param {any} task */
function boundaryCard(task) {
  const input = task.input;
  if (!input) return callout('critical', '입력 없음', '이 작업의 input.json을 찾지 못했습니다.');
  const match = reviewMatch(input);
  return h(
    'section',
    { class: 'hl-card' },
    h('h2', { class: 'hl-section-title' }, '작업 경계'),
    h(
      'dl',
      { class: 'hl-meta' },
      h('dt', {}, '저장소'),
      h('dd', {}, h('code', {}, input.repo.root)),
      h('dt', {}, '브랜치'),
      h('dd', {}, h('code', {}, input.branch ?? '(분리된 HEAD)'), ' → ', h('code', {}, input.base.ref)),
      h('dt', {}, '검토 대상 상태'),
      h('dd', {}, '소스 ', h('code', {}, short(input.source.hash)), ' · merge-base ', h('code', {}, input.base.mergeBase.slice(0, 12))),
      h('dt', {}, '리뷰한 상태'),
      h('dd', {}, match === null ? h('span', { class: 'hl-muted' }, '알 수 없음') : match ? badge('positive', '현재 소스와 같음') : badge('critical', '현재 소스와 다름')),
      h('dt', {}, '인계 방식'),
      h('dd', {}, input.trigger === 'manual' ? '수동 요청' : '자동(spec 기반)', input.sdlcTaskRef ? ` · ${input.sdlcTaskRef}` : ''),
      h('dt', {}, '준비 시각'),
      h('dd', {}, when(input.createdAt)),
    ),
    changedFiles(input.source.files),
    h(
      'details',
      {},
      h('summary', {}, `자료 ${input.materials.length}개`),
      input.materials.length
        ? h('ul', { class: 'hl-files' }, input.materials.map((/** @type {any} */ m) => h('li', {}, h('span', { class: 'hl-muted' }, `${m.role} `), h('code', {}, m.ref), h('span', { class: 'hl-muted' }, ` ${short(m.sha256)}`))))
        : h('p', { class: 'hl-muted' }, '연결된 자료가 없습니다.'),
    ),
  );
}

/** @type {Record<string, string>} */
const CHANGE_REASON = { edited: '수정', base_updated: '기준 브랜치 갱신으로 인한 변경', added: '추가', removed: '빠짐' };

/** @param {string} reason */
const reasonText = (reason) =>
  reason === 'unlinked'
    ? '연결 없는 변경(불확실)'
    : reason === 'pending'
      ? '지난 승인에서 보류'
      : reason.startsWith('material:')
        ? `자료 변경 ${reason.slice(9)}`
        : reason.startsWith('with:')
          ? '대체하는 항목이 다시 확인 대상'
          : `${reason} 변경`;

/**
 * Why a draft item is up for recheck: the affected reasons of its baseline item, the
 * agent's extra reason, or "new" for an item that was not in the last approval.
 * @param {any} task
 * @param {'summary' | 'record'} kind
 * @param {any} item draft bullet or record
 * @returns {string[]}
 */
function recheckReasons(task, kind, item) {
  const recheck = task.input?.recheck;
  if (!recheck) return [];
  if (!Number.isInteger(item.baseIndex)) return ['지난 승인 뒤에 새로 생긴 항목'];
  const affected = kind === 'summary' ? recheck.affected.summary : recheck.affected.records;
  const hit = affected.find((/** @type {any} */ a) => a.index === item.baseIndex);
  const extra = (task.draft?.recheck?.extra ?? []).filter((/** @type {any} */ e) => e.kind === kind && e.baseIndex === item.baseIndex);
  return [...(hit ? hit.reasons.map(reasonText) : []), ...extra.map((/** @type {any} */ e) => `에이전트 추가: ${e.reason}`)];
}

/** @param {any} task */
function recheckCard(task) {
  const recheck = task.input?.recheck;
  if (!recheck) return null;
  const carried = task.carried ?? { summary: [], records: [] };
  return h(
    'section',
    { class: 'hl-card' },
    h('div', { class: 'hl-spread' }, h('h2', { class: 'hl-section-title' }, '증분 재확인'), h('code', { class: 'hl-muted' }, `기준 ${recheck.basedOn}`)),
    h(
      'p',
      { class: 'hl-muted hl-small' },
      '지난 승인 뒤에 바뀐 부분과 연결된 항목만 다시 확인합니다. 나머지는 지난 승인을 유지합니다. 구현이 적절한지 다시 심사하는 절차가 아닙니다.',
    ),
    recheck.mergeBaseChanged ? callout('informative', '대상 브랜치가 갱신됨', 'merge-base가 바뀌었습니다. 이 작업이 바꾼 파일의 내용만 비교했고, 대상 브랜치에서 들어온 다른 변경은 보지 않았습니다.') : null,
    recheck.affected.unlinked.length
      ? callout('warning', '연결 없는 변경 (불확실)', h('span', {}, '어느 요약·기록에도 연결되지 않은 변경입니다. 요약 전체를 다시 확인하세요: ', recheck.affected.unlinked.join(', ')))
      : null,
    h(
      'dl',
      { class: 'hl-meta' },
      h('dt', {}, '바뀐 파일'),
      h(
        'dd',
        {},
        recheck.changes.length
          ? h('ul', { class: 'hl-files' }, recheck.changes.map((/** @type {any} */ c) => h('li', {}, h('code', {}, c.path), h('span', { class: 'hl-muted' }, ` ${CHANGE_REASON[c.reason] ?? c.reason}`))))
          : h('span', { class: 'hl-muted' }, '없음'),
      ),
      h('dt', {}, '바뀐 자료'),
      h('dd', {}, recheck.materials.length ? recheck.materials.map((/** @type {any} */ m) => m.ref).join(', ') : h('span', { class: 'hl-muted' }, '없음')),
      h('dt', {}, '승인 유지'),
      h('dd', {}, `요약 ${carried.summary.length}개, 기록 ${carried.records.length}개`),
    ),
  );
}

/** @param {any} task @param {string} id */
const recordLine = (task, id) => {
  const t = task.targets?.[id];
  return h('li', {}, h('code', {}, id), ' ', t ? t.title : h('span', { class: 'hl-muted' }, '(기록을 찾지 못함)'), h('span', { class: 'hl-muted hl-small' }, ` .heirloom/${id.startsWith('a-') ? 'axioms' : 'decisions'}/${id}.md`));
};

/**
 * Number of notices that need attention (critical or warning), shown on the overview tab.
 * @param {any} task
 */
function attentionCount(task) {
  const draft = task?.draft;
  return (
    (task?.input && reviewMatch(task.input) === false ? 1 : 0) +
    (draft?.conflicts?.length ? 1 : 0) +
    (draft?.missing?.length ? 1 : 0) +
    (task?.check?.warnings?.length ? 1 : 0)
  );
}

/** @type {Record<string, string>} */
const DRAFT_FIELD = { codePaths: '연관 코드 경로', topics: '주제', sources: '출처', title: '제목', body: '본문' };

/**
 * A draft check warning for people. The check writes JSON paths for the agent
 * (`$.records[0].codePaths[1]: …`); the screen names the item and field instead.
 * @param {any} task
 * @param {string} warning
 */
function warningText(task, warning) {
  const m = /^\$\.(summary|records\[(\d+)\])(?:\.(\w+)(?:\[\d+\])?)?: (.*)$/s.exec(warning);
  if (!m) return warning;
  const [, where, index, field, message] = m;
  const fieldText = field ? ` ${DRAFT_FIELD[field] ?? field}` : '';
  if (where === 'summary') return `PR 요약${fieldText}: ${message}`;
  const records = task.draft?.records ?? [];
  const r = records[Number(index)];
  if (!r) return warning;
  const full = String((r.op === 'add' ? r.title : r.target) ?? '').trim();
  const title = full.length > 40 ? `${full.slice(0, 40)}…` : full;
  return `${kindName(kindOf(r, records))} #${Number(index) + 1}${title ? ` '${title}'` : ''}${fieldText}: ${message}`;
}

/** @param {any} task */
function noticesBlock(task) {
  const draft = task.draft;
  const input = task.input;
  /** @type {Child[]} */
  const items = [];
  if (input && reviewMatch(input) === false) {
    items.push(callout('critical', '리뷰 대상 불일치', '최종 리뷰가 다룬 소스 상태와 인계한 소스 상태가 다릅니다. 리뷰 이후의 변경을 직접 확인하세요.'));
  }
  if (draft?.conflicts?.length) {
    items.push(
      callout(
        'critical',
        '자료 충돌',
        h('span', {}, draft.conflicts.map((/** @type {any} */ c, /** @type {number} */ i) => [i ? h('br') : null, `${c.refs.join(' ↔ ')}: ${c.note}`])),
      ),
    );
  }
  if (draft?.missing?.length) items.push(callout('warning', '누락된 자료', draft.missing.join(' · ')));
  if (task.check?.warnings?.length) {
    const lines = task.check.warnings.map((/** @type {string} */ w) => warningText(task, w));
    items.push(callout('warning', '검사 경고', h('span', {}, lines.map((/** @type {string} */ l, /** @type {number} */ i) => [i ? h('br') : null, l]))));
  }
  if (input?.unknowns?.length) items.push(callout('neutral', '확인하지 못한 값', input.unknowns.join(', ')));
  if (draft?.notes) items.push(callout('informative', '에이전트 메모', draft.notes));
  return items.length ? h('section', { class: 'hl-stack' }, items) : null;
}

/**
 * @param {any} record draft op
 * @returns {'decision' | 'axiom'}
 */
function kindOf(record, records = /** @type {any[]} */ ([])) {
  if (record.op === 'add') return record.kind;
  if (record.op === 'supersede' && records[record.with]?.kind === 'axiom') return 'axiom';
  return String(record.target).startsWith('a-') ? 'axiom' : 'decision';
}

/** @param {any[]} sources */
function sourcesBlock(sources) {
  if (!sources?.length) return null;
  return h(
    'div',
    { class: 'hl-stack-tight' },
    h('span', { class: 'hl-muted hl-small' }, '출처'),
    sources.map((/** @type {any} */ s) =>
      h(
        'div',
        { class: 'hl-stack-tight' },
        // `@conversation` quotes what the person typed in the session, not a file.
        s.ref === '@conversation'
          ? h('span', { class: 'hl-small' }, '대화 (사용자 발화)')
          : h('span', { class: 'hl-small' }, h('code', {}, s.ref), s.lines ? (s.lines[0] === s.lines[1] ? ` ${s.lines[0]}행` : ` ${s.lines[0]}–${s.lines[1]}행`) : ''),
        s.quote ? h('blockquote', { class: 'hl-quote hl-small' }, s.quote) : null,
      ),
    ),
  );
}

/** @param {any} task @param {string} id */
function targetLabel(task, id) {
  const t = task.targets?.[id];
  return t ? `${id} ${t.title}${t.active ? '' : ' (비활성)'}` : `${id} (기록을 찾지 못함)`;
}

/**
 * @param {Form} f
 * @param {number} index
 */
function recordCard(f, index) {
  if (f.carriedRecords.has(index) && !f.reopened.has(index)) return carriedRecordCard(f, index);
  const task = f.task;
  const records = task.draft.records;
  const r = records[index];
  const kind = kindOf(r, records);
  const editable = r.op === 'add';
  const card = h('article', { class: 'hl-card', id: `record-${index}`, 'aria-label': `${kindName(kind)} 항목 ${index + 1}` });
  const current = f.decisions.get(index);
  if (current) card.setAttribute('data-decision', current);
  /** Redraw this card in place (read view ↔ edit form), keeping the decision and edits. */
  const redraw = () => {
    const next = recordCard(f, index);
    card.replaceWith(next);
    return next;
  };

  /** @type {Child[]} */
  const content = [];
  if (editable) {
    const edit = /** @type {{ title: string, body: Record<string, string> }} */ (f.edits.get(index));
    const editing = f.editing.has(index);
    const edited = edit.title.trim() !== String(r.title ?? '').trim() || Object.keys(edit.body).some((k) => (edit.body[k] ?? '').trim() !== String(r.body[k] ?? '').trim());
    const toggle = button(BUTTON.smallWeak, editing ? '편집 닫기' : '편집', () => {
      if (editing) f.editing.delete(index);
      else f.editing.add(index);
      const next = redraw();
      /** @type {HTMLElement | null} */ (next.querySelector(editing ? '.hl-edit-toggle' : 'textarea'))?.focus();
    });
    toggle.classList.add('hl-edit-toggle');
    toggle.setAttribute('aria-expanded', String(editing));
    if (editing) {
      content.push(
        fieldBlock(
          '제목',
          textInput({
            value: edit.title,
            oneLine: true,
            label: `항목 ${index + 1} 제목`,
            oninput: (v) => {
              edit.title = v;
              markDirty();
            },
          }),
        ),
        h(
          'div',
          { class: 'hl-fields' },
          BODY_FIELDS[kind].map(([key, label]) =>
            fieldBlock(
              label,
              textInput({
                value: edit.body[key] ?? '',
                multiline: true,
                label: `항목 ${index + 1} ${label}`,
                oninput: (v) => {
                  edit.body[key] = v;
                  markDirty();
                },
              }),
            ),
          ),
        ),
        h('div', {}, toggle),
      );
    } else {
      const filled = BODY_FIELDS[kind].filter(([key]) => (edit.body[key] ?? '').trim());
      const blank = BODY_FIELDS[kind].filter(([key]) => !(edit.body[key] ?? '').trim());
      content.push(
        h('div', { class: 'hl-spread hl-record-head' }, h('h3', { class: 'hl-record-title' }, edit.title.trim() || h('span', { class: 'hl-muted' }, '(제목 없음)')), h('div', { class: 'hl-row' }, edited ? badge('informative', '고침') : null, toggle)),
        filled.length
          ? h('dl', { class: 'hl-meta' }, filled.map(([key, label]) => [h('dt', {}, label), h('dd', { class: 'hl-field-text' }, edit.body[key])]))
          : null,
        blank.length ? h('p', { class: 'hl-muted hl-small' }, `비어 있음: ${blank.map(([, label]) => label).join(', ')}`) : null,
      );
    }
    content.push(
      h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '연관 코드 경로'), pathList(r.codePaths)),
      r.topics?.length ? h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '주제'), pathList(r.topics)) : null,
      Array.isArray(r.evidence)
        ? h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, `근거 결정 ${r.evidence.length}개 (원문은 저장소의 기록 파일)`), h('ul', { class: 'hl-files' }, r.evidence.map((/** @type {string} */ id) => recordLine(task, id))))
        : null,
      sourcesBlock(r.sources),
    );
  } else {
    content.push(h('p', {}, h('span', { class: 'hl-muted' }, '대상 '), h('code', {}, targetLabel(task, r.target))));
    if (r.op === 'relate') {
      content.push(
        h('p', {}, h('span', { class: 'hl-muted' }, `${RELATION[r.relation.type] ?? r.relation.type} 관계 `), h('code', {}, targetLabel(task, r.relation.id))),
        h('p', { class: 'hl-field-text' }, h('span', { class: 'hl-muted' }, '조건 '), r.relation.condition),
      );
    }
    if (r.op === 'supersede') {
      const by = records[r.with];
      content.push(h('p', {}, h('span', { class: 'hl-muted' }, '대체하는 항목 '), `#${r.with + 1} ${by?.id ?? ''} ${by?.title ?? ''}`));
    }
    if (r.reason) content.push(h('p', { class: 'hl-field-text' }, h('span', { class: 'hl-muted' }, '이유 '), r.reason));
    if (r.op === 'update') {
      if (r.title) content.push(h('p', {}, h('span', { class: 'hl-muted' }, '새 제목 '), r.title));
      if (r.body) {
        content.push(
          h(
            'dl',
            { class: 'hl-meta' },
            Object.entries(r.body).map(([key, value]) => [
              h('dt', {}, (BODY_FIELDS[kind].find(([k]) => k === key) ?? [key, key])[1]),
              h('dd', { class: 'hl-field-text' }, String(value)),
            ]),
          ),
        );
      }
      if (r.codePaths) content.push(h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '새 연관 코드 경로'), pathList(r.codePaths)));
      if (r.topics) content.push(h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '새 주제'), pathList(r.topics)));
    }
    content.push(sourcesBlock(r.sources));
  }

  const control = decisionControl({
    label: `항목 ${index + 1} 결정`,
    value: current ?? null,
    onchange: (d) => {
      f.decisions.set(index, d);
      card.setAttribute('data-decision', d);
      markDirty();
    },
  });
  f.setters.set(index, (d) => {
    control.set(d);
    f.decisions.set(index, d);
    card.setAttribute('data-decision', d);
  });

  const reasons = f.reopened.has(index) ? ['사람이 다시 검토하기로 함'] : recheckReasons(task, 'record', r);
  const before = Number.isInteger(r.baseIndex) ? task.input.recheck?.baseline.records[r.baseIndex] : undefined;
  append(
    card,
    [
      h(
        'div',
        { class: 'hl-spread' },
        h(
          'div',
          { class: 'hl-row' },
          badge(r.op === 'deprecate' ? 'critical' : r.op === 'add' ? 'positive' : 'informative', OP[r.op] ?? r.op),
          badge(kind === 'axiom' ? 'warning' : 'neutral', kindName(kind)),
          h('code', { class: 'hl-muted' }, `#${index + 1}${r.id ? ` ${r.id}` : ''}`),
        ),
        control.root,
      ),
      reasons.length ? callout('warning', '다시 확인할 이유', reasons.join(' · ')) : null,
      before ? previousRecord(before, kind) : null,
      editable ? null : h('h3', { class: 'hl-section-title' }, r.op === 'update' ? '기존 기록 수정' : r.op === 'supersede' ? '기존 기록 대체' : r.op === 'relate' ? '기존 기록에 관계 추가' : '기존 기록 폐기'),
      content,
    ],
  );
  return card;
}

/**
 * The approved version of a record, shown next to the new draft.
 * @param {any} before baseline record
 * @param {'decision' | 'axiom'} kind
 */
function previousRecord(before, kind) {
  return h(
    'details',
    {},
    h('summary', {}, '지난 승인 내용'),
    h(
      'dl',
      { class: 'hl-meta' },
      before.title ? [h('dt', {}, '제목'), h('dd', {}, before.title)] : null,
      before.op === 'add'
        ? BODY_FIELDS[kind].map(([key, label]) => [h('dt', {}, label), h('dd', { class: 'hl-field-text' }, before.body?.[key] || '(없음)')])
        : [h('dt', {}, '이유'), h('dd', { class: 'hl-field-text' }, before.reason ?? '')],
      before.codePaths ? [h('dt', {}, '연관 코드 경로'), h('dd', {}, pathList(before.codePaths))] : null,
    ),
  );
}

/**
 * A record that keeps its approval: shown folded, with a way to review it again when the
 * human thinks the change does touch it.
 * @param {Form} f
 * @param {number} index
 */
function carriedRecordCard(f, index) {
  const records = f.task.draft.records;
  const r = records[index];
  const kind = kindOf(r, records);
  const title = r.op === 'add' ? r.title : `${OP[r.op] ?? r.op}: ${targetLabel(f.task, r.target)}`;
  /** @type {HTMLElement} */
  const card = h(
    'article',
    { class: 'hl-card', id: `record-${index}`, 'aria-label': `${kindName(kind)} 항목 ${index + 1} (승인 유지)`, 'data-decision': 'approved' },
    h(
      'div',
      { class: 'hl-spread' },
      h('div', { class: 'hl-row' }, badge('positive', '승인 유지'), badge(kind === 'axiom' ? 'warning' : 'neutral', kindName(kind)), h('code', { class: 'hl-muted' }, `#${index + 1}${r.id ? ` ${r.id}` : ''}`)),
      button(BUTTON.smallWeak, '다시 검토', () => {
        f.reopened.add(index);
        card.replaceWith(recordCard(f, index));
        markDirty();
      }),
    ),
    h('p', {}, title),
    h('p', { class: 'hl-muted hl-small' }, '바뀐 파일·자료와 연결되지 않아 지난 승인을 유지합니다. 영향이 있다고 보면 다시 검토하세요.'),
  );
  return card;
}

/** @param {Form} f */
function summaryCard(f) {
  const editor = textInput({
    value: f.summary,
    multiline: true,
    label: 'PR 요약 내용',
    placeholder: '- 한 줄에 불릿 하나씩 적습니다',
    oninput: (v) => {
      f.summary = v;
      markDirty();
    },
  });
  editor.classList.add('hl-summary-editor');
  const field = /** @type {HTMLTextAreaElement} */ (editor.querySelector('textarea'));

  const fill = button(BUTTON.smallWeak, '초안 생성', () => {
    const text = draftSummaryText(f.task);
    if (f.summary === text) return;
    if (f.summary.trim() && !window.confirm('입력한 요약을 에이전트가 쓴 초안으로 바꿀까요? 지금 고친 내용은 사라집니다.')) return;
    f.summary = text;
    field.value = text;
    markDirty();
    field.focus();
  });

  return h(
    'section',
    { class: 'hl-card' },
    h('div', { class: 'hl-spread' }, h('h2', { class: 'hl-section-title' }, 'PR 요약'), fill),
    editor,
    summaryRecheck(f),
  );
}

/**
 * Incremental handoff: which draft bullets keep their approval and which are up for recheck,
 * with the reasons and the approved text, under the one summary box.
 * @param {Form} f
 */
function summaryRecheck(f) {
  const task = f.task;
  if (!task.input?.recheck) return null;
  const rows = task.draft.summary.map((/** @type {any} */ b, /** @type {number} */ i) => {
    if (f.carriedSummary.has(i)) return h('li', {}, badge('positive', '승인 유지'), ` ${b.text}`);
    const reasons = recheckReasons(task, 'summary', b);
    const before = Number.isInteger(b.baseIndex) ? task.input.recheck.baseline.summary[b.baseIndex]?.text : null;
    return h(
      'li',
      {},
      h(
        'div',
        { class: 'hl-stack-tight' },
        h('span', {}, badge('warning', '다시 확인'), ` ${b.text}`),
        reasons.length ? h('span', { class: 'hl-muted hl-small' }, `이유: ${reasons.join(' · ')}`) : null,
        before ? h('span', { class: 'hl-muted hl-small' }, `지난 승인: ${before}`) : null,
      ),
    );
  });
  return h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '초안 불릿별 재확인'), h('ul', { class: 'hl-files hl-stack' }, rows));
}

/**
 * The agent's draft summary as the editor text: one "- " bullet per line.
 * @param {any} task
 */
function draftSummaryText(task) {
  return (task.draft?.summary ?? []).map((/** @type {any} */ b) => `- ${String(b.text).replace(/\s*[\r\n]+\s*/g, ' ').trim()}`).join('\n');
}

/**
 * Bullets of the editor text: one per non-empty line, a leading "-", "*", "•" or "1." dropped.
 * @param {string} text
 * @returns {string[]}
 */
function summaryLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

/**
 * Draft bullet each final line came from, so the next incremental handoff keeps its code
 * paths: an unchanged line matches its draft bullet by text; an edited line takes the draft
 * bullet at the same position if that one is not used yet; anything else counts as added.
 * @param {string[]} lines
 * @param {any[]} draft draft summary bullets
 * @returns {(number | null)[]}
 */
function summaryOrigins(lines, draft) {
  const used = new Set();
  /** @type {(number | null | undefined)[]} */
  const origins = lines.map((line) => {
    const i = draft.findIndex((b, j) => !used.has(j) && String(b.text).trim() === line);
    if (i < 0) return undefined;
    used.add(i);
    return i;
  });
  return origins.map((o, i) => {
    if (o !== undefined) return o;
    if (i < draft.length && !used.has(i)) {
      used.add(i);
      return i;
    }
    return null;
  });
}

/**
 * Record indexes the human decides: everything except carried records not reopened.
 * @param {Form} f
 * @param {number[]} [indexes]
 */
function openIndexes(f, indexes = f.task.draft.records.map((/** @type {any} */ _r, /** @type {number} */ i) => i)) {
  return indexes.filter((i) => !f.carriedRecords.has(i) || f.reopened.has(i));
}

/**
 * Contents of the decision or axiom tab.
 * @param {Form} f
 * @param {'decision' | 'axiom'} kind
 */
function recordsPanel(f, kind) {
  const indexes = f.kinds[kind];
  if (kind === 'axiom') {
    return [
      h('h2', { class: 'hl-section-title' }, `규칙(axiom) 변경 ${indexes.length}건`),
      callout('warning', '규칙은 항목마다 따로 확인합니다', '규칙(axiom)은 이후 모든 작업에 적용됩니다. 일괄 승인에 포함되지 않습니다.'),
      indexes.map((i) => recordCard(f, i)),
    ];
  }
  return [
    h(
      'div',
      { class: 'hl-spread' },
      h('h2', { class: 'hl-section-title' }, `결정(decision) 변경 ${indexes.length}건`),
      button(BUTTON.smallWeak, '남은 결정 모두 승인', () => {
        // Only items without a choice yet: a reject or hold the human already picked stays.
        const undecided = openIndexes(f, indexes).filter((i) => !f.decisions.has(i));
        if (!undecided.length) return;
        const ok = window.confirm(
          [
            `아직 고르지 않은 결정 ${undecided.length}건(${undecided.map((i) => `#${i + 1}`).join(', ')})을 모두 승인으로 표시할까요?`,
            '',
            '이미 거절·보류로 고른 항목은 그대로 둡니다. 승인 저장 전에는 항목마다 다시 바꿀 수 있습니다.',
          ].join('\n'),
        );
        if (!ok) return;
        for (const i of undecided) f.setters.get(i)?.('approved');
        markDirty();
      }),
    ),
    indexes.map((i) => recordCard(f, i)),
  ];
}

const actionsBar = h('section', { class: 'hl-actions hl-stack' });
const actionsStatus = h('div', { class: 'hl-stack' });
const progress = h('span', { class: 'hl-muted' });
const approveButton = h('button', { type: 'button', class: BUTTON.primary }, '승인 저장');
approveButton.addEventListener('click', () => void submitApproval());
const discardButton = button(BUTTON.smallOutline, '작업 폐기', () => void discardTask());
/** Why the approval cannot be saved yet, next to the disabled button. */
const blocked = h('span', { class: 'hl-small hl-blocked', id: 'approve-blocked', 'aria-live': 'polite' });
approveButton.setAttribute('aria-describedby', 'approve-blocked');
/** @type {number | null} first record that still needs the human, target of the jump button */
let nextOpen = null;
const jumpButton = button(BUTTON.smallWeak, '다음 미처리 항목으로', () => {
  if (!form || nextOpen === null) return;
  const index = nextOpen;
  selectTab(kindOf(form.task.draft.records[index], form.task.draft.records));
  window.requestAnimationFrame(() => {
    const card = document.getElementById(`record-${index}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    /** @type {HTMLElement | null | undefined} */ (card?.querySelector('[role="radio"][tabindex="0"]'))?.focus({ preventScroll: true });
  });
});
append(actionsBar, [
  actionsStatus,
  h('div', { class: 'hl-spread' }, h('div', { class: 'hl-stack-tight' }, progress, blocked), h('div', { class: 'hl-row hl-actions-buttons' }, jumpButton, approveButton)),
]);

function refreshActions() {
  if (!form) return;
  const f = form;
  const open = openIndexes(f);
  const total = open.length;
  const quick = total === 0;
  const undecided = open.filter((i) => !f.decisions.has(i));
  const decided = total - undecided.length;
  const hasSummary = summaryLines(form.summary).length > 0;
  approveButton.textContent = quick ? '요약 확인하고 간이 승인' : '승인 저장';
  const carriedNote = f.carriedRecords.size ? ` · 승인 유지 ${f.carriedRecords.size - f.reopened.size}건` : '';
  progress.textContent = (quick ? (f.carriedRecords.size ? '다시 확인할 결정·규칙 항목이 없습니다.' : '결정·규칙 변경이 없는 작업입니다.') : `처리한 항목 ${decided}/${total}`) + carriedNote;
  /** @param {number[]} list */
  const nums = (list) => list.map((i) => `#${i + 1}`).join(', ');
  /** @type {string[]} */
  const why = [];
  if (!hasSummary) why.push('PR 요약이 비어 있습니다');
  if (undecided.length) why.push(`승인·거절·보류를 고르지 않은 항목: ${nums(undecided)}`);
  blocked.textContent = why.length ? `승인 저장 전에 필요: ${why.join(' · ')}` : '';
  nextOpen = undecided[0] ?? null;
  jumpButton.hidden = nextOpen === null;
  const ready = !why.length && !form.busy;
  approveButton.disabled = !ready;
  approveButton.toggleAttribute('data-disabled', !ready);
  discardButton.disabled = form.busy;
  refreshTabLabels();
}

function markDirty() {
  if (!form) return;
  form.dirty = true;
  refreshActions();
}

/** @param {any} task @returns {Form} */
function newForm(task) {
  const records = task.draft?.records ?? [];
  /** @type {Form['edits']} */
  const edits = new Map();
  records.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
    if (r.op === 'add') edits.set(i, { title: r.title, body: { ...r.body } });
  });
  /** @type {Form['kinds']} */
  const kinds = { decision: [], axiom: [] };
  records.forEach((/** @type {any} */ r, /** @type {number} */ i) => kinds[kindOf(r, records)].push(i));
  const carriedSummary = new Set(/** @type {number[]} */ (task.carried?.summary ?? []));
  return {
    task,
    kinds,
    carriedRecords: new Set(task.carried?.records ?? []),
    carriedSummary,
    reopened: new Set(),
    editing: new Set(),
    summary: draftSummaryText(task),
    decisions: new Map(),
    edits,
    setters: new Map(),
    dirty: false,
    busy: false,
  };
}

/** @param {Form} f */
function approvalRequest(f) {
  const records = f.task.draft.records;
  const open = openIndexes(f);
  const items = open.map((index) => {
    const r = records[index];
    /** @type {{ index: number, decision: Decision | undefined, edited?: Record<string, unknown>, reopen?: true }} */
    const item = { index, decision: f.decisions.get(index) };
    if (f.reopened.has(index)) item.reopen = true;
    const edit = f.edits.get(index);
    if (r.op === 'add' && edit) {
      /** @type {Record<string, unknown>} */
      const edited = {};
      if (edit.title.trim() !== r.title) edited.title = edit.title.trim();
      const changed = Object.keys(edit.body).some((k) => (edit.body[k] ?? '') !== (r.body[k] ?? ''));
      if (changed) edited.body = Object.fromEntries(Object.entries(edit.body).map(([k, v]) => [k, v.trim()]));
      if (Object.keys(edited).length) item.edited = edited;
    }
    return item;
  });
  const lines = summaryLines(f.summary);
  return {
    kind: open.length ? 'full' : 'quick',
    draftSha256: f.task.draftSha256,
    sourceHash: f.task.input.source.hash,
    summary: lines,
    summaryOrigins: summaryOrigins(lines, f.task.draft.summary),
    items,
  };
}

async function submitApproval() {
  if (!form) return;
  const f = form;
  const emptyTitle = [...f.edits.entries()].find(([i, e]) => f.decisions.get(i) === 'approved' && !e.title.trim());
  if (emptyTitle) {
    replace(actionsStatus, callout('critical', '제목이 비어 있음', `항목 #${emptyTitle[0] + 1}의 제목을 입력하세요.`));
    return;
  }
  f.busy = true;
  refreshActions();
  replace(actionsStatus);
  try {
    await post(`/api/tasks/${encodeURIComponent(f.task.taskId)}/approve`, approvalRequest(f));
    f.dirty = false;
    clearBanner();
    // The screen switches to the approved state.
    await loadTask(f.task.taskId, { force: true });
  } catch (err) {
    const e = /** @type {ApiError} */ (err);
    replace(
      actionsStatus,
      callout(
        'critical',
        e.status === 409 ? '승인할 수 없음' : '승인 실패',
        e.status === 409 ? h('span', {}, e.message, ' ', button(BUTTON.smallWeak, '새로 불러오기', () => void loadTask(f.task.taskId, { force: true }))) : e.message,
      ),
    );
  } finally {
    f.busy = false;
    refreshActions();
  }
}

async function discardTask() {
  if (judge) {
    const j = judge;
    if (!window.confirm('이 인계를 폐기할까요? 폐기한 작업은 판정하거나 반영할 수 없습니다.')) return;
    await judgeStep(j, '폐기 실패', () => post(`/api/tasks/${encodeURIComponent(j.task.taskId)}/discard`, { reason: 'user' }));
    return;
  }
  if (!form) return;
  const f = form;
  if (!window.confirm('이 인계를 폐기할까요? 폐기한 작업은 승인하거나 반영할 수 없습니다.')) return;
  f.busy = true;
  refreshActions();
  try {
    await post(`/api/tasks/${encodeURIComponent(f.task.taskId)}/discard`, { reason: 'user' });
    f.dirty = false;
    await loadTask(f.task.taskId, { force: true });
  } catch (err) {
    replace(actionsStatus, callout('critical', '폐기 실패', /** @type {Error} */ (err).message));
  } finally {
    f.busy = false;
    refreshActions();
  }
}

/** @param {any} task */
function approvalSummaryCard(task) {
  const a = task.latestApproval;
  if (!a) return null;
  const records = task.draft?.records ?? [];
  /** @type {Record<string, [Tone, string]>} */
  const label = { approved: ['positive', '승인'], rejected: ['critical', '거절'], pending: ['warning', '보류'] };
  return h(
    'section',
    { class: 'hl-card' },
    h('div', { class: 'hl-spread' }, h('h2', { class: 'hl-section-title' }, APPROVAL_TITLE[a.kind] ?? '승인 내용'), h('code', { class: 'hl-muted' }, a.id)),
    a.basedOn ? h('p', { class: 'hl-muted hl-small' }, `지난 승인 ${a.basedOn}에서 바뀐 부분만 다시 확인했습니다. '유지'는 지난 승인을 그대로 이어받은 항목입니다.`) : null,
    h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '최종 요약'), h('ul', { class: 'hl-files' }, a.summary.final.map((/** @type {string} */ s) => h('li', {}, s)))),
    a.items.length
      ? h(
          'ul',
          { class: 'hl-files' },
          a.items.map((/** @type {any} */ item) => {
            const r = records[item.index] ?? {};
            const [tone, text] = label[item.decision] ?? ['neutral', item.decision];
            return h(
              'li',
              {},
              badge(tone, text),
              item.carried ? [' ', badge('neutral', '유지')] : null,
              ` #${item.index + 1} ${OP[r.op] ?? ''} ${r.id ?? r.target ?? ''} ${item.edited?.title ?? r.title ?? ''}`,
              item.edited ? h('span', { class: 'hl-muted' }, ' (사람이 고침)') : null,
              item.reason ? h('span', { class: 'hl-muted' }, ` · 이유: ${item.reason}`) : null,
            );
          }),
        )
      : null,
  );
}

/** @type {Record<string, string>} */
const APPROVAL_TITLE = { full: '승인 내용', quick: '간이 승인 내용', incremental: '증분 승인 내용', judgment: '판정 내용' };

/** @param {any} task */
function prLink(task) {
  const event = [...(task.events ?? [])].reverse().find((/** @type {any} */ e) => e.type === 'pr_created');
  if (!event?.url) return null;
  return h('section', { class: 'hl-card' }, h('p', {}, 'PR: ', h('a', { href: event.url, rel: 'noreferrer noopener', target: '_blank' }, event.url)));
}

// ------------------------------------------------------------------ prediction and judgment (schema 2)

/**
 * A radio group styled as a SEED segmented control, with any options. Starts empty.
 * @param {{ label: string, options: [string, string][], value: string | null, disabled?: Set<string>, onchange: (value: string) => void }} o
 */
function choiceControl({ label, options, value, disabled = new Set(), onchange }) {
  const root = h('div', { class: 'seed-segmented-control__root hl-decision hl-choice', role: 'radiogroup', 'aria-label': label });
  root.style.setProperty('--segment-count', String(options.length));
  root.append(h('div', { class: 'seed-segmented-control__indicator', 'aria-hidden': 'true' }));
  /** @type {HTMLButtonElement[]} */
  const items = options.map(([v, text]) => h('button', { type: 'button', role: 'radio', class: 'seed-segmented-control__item', 'data-value': v, disabled: disabled.has(v) }, text));
  root.append(...items);
  /** @param {string | null} v */
  const set = (v) => {
    const index = options.findIndex(([o]) => o === v);
    items.forEach((item, i) => {
      item.setAttribute('aria-checked', String(i === index));
      item.toggleAttribute('data-checked', i === index);
      item.tabIndex = i === (index < 0 ? 0 : index) ? 0 : -1;
    });
    root.toggleAttribute('data-has-value', index >= 0);
    root.style.setProperty('--segment-index', String(Math.max(index, 0)));
  };
  items.forEach((item, i) => {
    item.addEventListener('click', () => {
      set(options[i][0]);
      onchange(options[i][0]);
    });
  });
  set(value);
  return root;
}

/** @type {Record<string, string>} */
const QUESTION_KIND = { predict: '결과 예측', 'test-lock': '테스트가 막는 동작', intent: '의도와 일치', fork: '열린 선택' };

/** Verdict options per question kind, as the server accepts them. @type {Record<string, [string, string][]>} */
const VERDICT_OPTIONS = {
  predict: [['as-expected', '예상대로'], ['my-misunderstanding', '잘못 알았음'], ['revert', '되돌림'], ['split', '분리']],
  'test-lock': [['as-expected', '예상대로'], ['my-misunderstanding', '잘못 알았음'], ['revert', '되돌림'], ['split', '분리']],
  intent: [['as-expected', '의도와 같음'], ['my-misunderstanding', '달라도 맞음'], ['revert', '되돌림'], ['split', '분리']],
  fork: [['answered', '답함'], ['revert', '되돌림'], ['split', '분리']],
};
const RETURNING = new Set(['revert', 'split']);

/** What each verdict means, under the control. @type {Record<string, string>} */
const VERDICT_HELP = {
  'as-expected': '예측이 맞았고 이 동작을 받아들입니다.',
  'my-misunderstanding': '예측은 틀렸지만 실제 동작이 의도대로입니다. PR에 예측이 틀렸다는 사실이 남습니다.',
  answered: '아래에 적은 답이 PR 본문에 남습니다.',
  revert: '이 동작이 틀렸습니다. 작업이 에이전트에게 되돌아가 코드를 고칩니다.',
  split: '동작은 맞지만 이번 PR에서 뺍니다. 에이전트가 별도 브랜치로 옮깁니다.',
};

/** What the spec becomes when a question citing it is sent back. @type {[string, string][]} */
const SPEC_CHOICE_OPTIONS = [['spec-wrong', 'spec이 틀렸다'], ['defer', '미룬다'], ['snapshot', 'spec은 스냅샷']];
/** @type {Record<string, string>} */
const SPEC_CHOICE_HELP = {
  'spec-wrong': '원래 하면 안 되는 동작입니다. 에이전트가 spec의 인용한 줄을 고치거나 지우고 "거절: <이유>"를 남깁니다. 줄이 그대로면 다시 인계할 수 없습니다.',
  defer: '맞는 동작이지만 이번에는 하지 않습니다. 에이전트가 인용한 줄에 "보류: <후속 이슈>"를 표시합니다. 줄이 그대로면 다시 인계할 수 없습니다.',
  'snapshot': 'spec을 고치지 않습니다. PR 본문에 "spec의 이 부분은 구현하지 않음"이 남습니다.',
};
/** The spec's lifetime once every question is accepted. @type {[string, string][]} */
const AFTER_MERGE_OPTIONS = [['delete', '삭제'], ['archive', '보관'], ['keep', '유지']];
/** @type {Record<string, string>} */
const AFTER_MERGE_HELP = {
  delete: 'git 이력과 PR에 남습니다. 오래 남길 내용은 테스트, PR 본문, 결정 기록이 맡습니다.',
  archive: '`docs/specs/archive/`로 옮깁니다. 과거 기록으로 읽힙니다.',
  keep: '그 자리에 둡니다. 외부 API 계약처럼 코드 밖 약속이 있을 때 씁니다. 소유자가 PR 본문에 남습니다.',
};

/**
 * @typedef {object} JudgeForm
 * @property {any} task
 * @property {Map<string, string>} predictions
 * @property {Map<string, string>} verdicts
 * @property {Map<string, string>} reasons
 * @property {Map<string, string>} answers fork answers
 * @property {string[]} diffs behavior descriptions as the person edits them
 * @property {Map<string, string>} specChoices what the spec becomes, per sent-back question citing it
 * @property {string} afterMerge the spec's lifetime when every question is accepted
 * @property {string} owner who owns a kept spec
 * @property {HTMLElement} lifecycle
 * @property {boolean | null} lifecycleFor whether the lifetime box was drawn for an accepting judgment
 * @property {HTMLElement} status
 * @property {boolean} dirty
 * @property {boolean} busy
 */

/** @type {JudgeForm | null} */
let judge = null;

/** @param {any} task @returns {JudgeForm} */
function newJudgeForm(task) {
  return {
    task,
    predictions: new Map(),
    verdicts: new Map(),
    reasons: new Map(),
    answers: new Map(),
    diffs: (task.judge.behaviorDiffs ?? []).map((/** @type {any} */ d) => d.text),
    specChoices: new Map(),
    afterMerge: task.judge.specAfterMergeDefault ?? 'delete',
    owner: '',
    lifecycle: h('div', { class: 'hl-stack' }),
    lifecycleFor: null,
    status: h('div', { class: 'hl-stack' }),
    dirty: false,
    busy: false,
  };
}

/** @param {string[]} run */
const commandText = (run) => run.map((a) => (/[\s"'$`\\]/.test(a) ? JSON.stringify(a) : a)).join(' ');

/** @param {any} task @param {string} id */
const commandOf = (task, id) => task.judge.commands.find((/** @type {any} */ c) => c.id === id);

/** @param {any} q */
function questionHead(q) {
  return h('div', { class: 'hl-spread' }, h('div', { class: 'hl-row' }, badge(q.kind === 'fork' ? 'warning' : 'informative', QUESTION_KIND[q.kind] ?? q.kind), h('code', { class: 'hl-muted' }, q.id)));
}

/** @param {any} task @param {string} id */
function probeCommand(task, id) {
  const c = commandOf(task, id);
  if (!c) return h('p', { class: 'hl-muted' }, `탐침 ${id}`);
  return h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, `탐침 ${c.id}: ${c.title}`), h('code', { class: 'hl-command' }, commandText(c.run)));
}

/** @param {any[] | undefined} sources */
const questionSources = (sources) =>
  sources?.length
    ? h(
        'ul',
        { class: 'hl-files' },
        sources.map((s) => h('li', {}, h('span', { class: 'hl-muted' }, s.ref === '@conversation' ? '대화 ' : `${s.ref}${s.lines ? ` ${s.lines[0]}-${s.lines[1]}행` : ''} `), s.quote ? `“${s.quote}”` : null)),
      )
    : null;

/** @param {JudgeForm} f @param {any} q */
function predictionCard(f, q) {
  /** @type {Child[]} */
  const body = [questionHead(q), h('p', { class: 'hl-question' }, q.prompt)];
  if (q.kind === 'predict') body.push(probeCommand(f.task, q.probe));
  if (q.kind === 'test-lock') body.push(h('p', {}, h('code', {}, q.test), h('span', { class: 'hl-muted' }, ` — ${q.plain}`)));
  body.push(questionSources(q.sources));
  /** @param {string} v */
  const set = (v) => {
    if (v.trim()) f.predictions.set(q.id, v);
    else f.predictions.delete(q.id);
    f.dirty = true;
    refreshJudge();
  };
  if (q.kind === 'test-lock') body.push(choiceControl({ label: `${q.id} 답`, options: [['yes', '예'], ['no', '아니오']], value: f.predictions.get(q.id) ?? null, onchange: set }));
  else if (q.answerType === 'choice') body.push(choiceControl({ label: `${q.id} 답`, options: q.choices.map((/** @type {string} */ c) => [c, c]), value: f.predictions.get(q.id) ?? null, onchange: set }));
  else body.push(fieldBlock('내 예측', textInput({ value: f.predictions.get(q.id) ?? '', label: `${q.id} 예측`, placeholder: q.answerType === 'number' ? '숫자' : '결과', oninput: set })));
  return h('section', { class: 'hl-card hl-stack', id: `question-${q.id}` }, body);
}

/** @param {JudgeForm} f */
function predictPanel(f) {
  const j = f.task.judge;
  const first = j.questions.filter((/** @type {any} */ q) => q.predictFirst);
  const later = j.questions.filter((/** @type {any} */ q) => !q.predictFirst && !q.carried);
  const kept = j.questions.filter((/** @type {any} */ q) => q.carried);
  const reveal = /** @type {HTMLButtonElement} */ (button(BUTTON.primary, first.length ? '예측 저장하고 결과 보기' : '결과 보기', () => void savePredictions(), { id: 'reveal' }));
  return h(
    'div',
    { class: 'hl-stack' },
    callout('informative', '먼저 결과를 예측하세요', '예측을 저장해야 실제 결과가 공개됩니다. 저장한 예측은 바꿀 수 없습니다. 틀린 예측도 그대로 PR에 남아 리뷰어에게 도움이 됩니다.'),
    j.questions.length > 5 ? callout('warning', `질문이 ${j.questions.length}개`, '이 변경은 한 번에 이해하기에 클 수 있습니다. 나눌 수 있는지 에이전트와 상의해 보세요.') : null,
    j.setupFailed ? callout('warning', '탐침 준비 명령 실패', '실행 환경을 갖추지 못한 채 탐침이 돌았습니다. 결과가 실행 실패일 수 있습니다.') : null,
    recheckNotice(j),
    first.map((/** @type {any} */ q) => predictionCard(f, q)),
    later.length
      ? h('section', { class: 'hl-card hl-stack' }, h('h2', { class: 'hl-section-title' }, '결과를 본 뒤 답할 질문'), h('ul', { class: 'hl-files' }, later.map((/** @type {any} */ q) => h('li', {}, badge('neutral', QUESTION_KIND[q.kind] ?? q.kind), ` ${q.prompt}`))))
      : null,
    kept.length
      ? h('section', { class: 'hl-card hl-stack' }, h('h2', { class: 'hl-section-title' }, '이전 판정 유지'), h('p', { class: 'hl-muted hl-small' }, '탐침 출력이 지난 판정 때와 같아 다시 묻지 않습니다.'), h('ul', { class: 'hl-files' }, kept.map((/** @type {any} */ q) => h('li', {}, badge('positive', VERDICT_LABEL[q.carried.verdict] ?? q.carried.verdict), ` ${q.prompt}`))))
      : null,
    h(
      'details',
      {},
      h('summary', {}, `실행한 탐침 명령 ${j.commands.length}개`),
      h('p', { class: 'hl-muted hl-small' }, 'base와 head의 임시 worktree에서 셸 없이 실행했습니다.'),
      h('ul', { class: 'hl-files' }, j.commands.map((/** @type {any} */ c) => h('li', {}, h('span', { class: 'hl-muted' }, `${c.id} ${c.title}: `), h('code', {}, commandText(c.run))))),
    ),
    f.status,
    h('div', { class: 'hl-row' }, reveal),
  );
}

/** @param {any} run */
function outputBlock(run) {
  const tail = run.error ? `실행 못 함: ${run.error}` : run.timedOut ? '시간 초과' : run.exitCode !== 0 ? `종료 코드 ${run.exitCode}` : null;
  return h('div', { class: 'hl-stack-tight' }, h('pre', { class: 'hl-output' }, run.stdout || h('span', { class: 'hl-muted' }, '(출력 없음)')), tail ? h('span', { class: 'hl-muted hl-small' }, tail, run.stderr ? ` — ${run.stderr.slice(0, 300)}` : '') : null);
}

/** @param {any} task @param {string} id */
function observedProbe(task, id) {
  const p = task.judge.probes.find((/** @type {any} */ x) => x.id === id);
  if (!p) return null;
  return h(
    'div',
    { class: 'hl-stack-tight' },
    h('span', { class: 'hl-muted hl-small' }, `탐침 ${p.id}: ${p.title}`, p.same ? ' · base와 같음' : ''),
    h('code', { class: 'hl-command' }, commandText(p.run)),
    h('div', { class: 'hl-compare' }, h('div', {}, h('span', { class: 'hl-muted hl-small' }, '이전 (base)'), outputBlock(p.base)), h('div', {}, h('span', { class: 'hl-muted hl-small' }, '이후 (head)'), outputBlock(p.head))),
  );
}

/** @type {Record<string, string>} */
const TEST_STATUS = { pass: '통과', fail: '실패', skip: '건너뜀', absent: '없음' };

/**
 * What a recheck says before the questions: which judgment it builds on, and changes no
 * probe covers.
 * @param {any} j
 */
function recheckNotice(j) {
  if (!j.basedOn) return null;
  return callout(
    j.unlinked.length ? 'warning' : 'informative',
    `판정 ${j.basedOn} 이후 재확인`,
    j.unlinked.length ? `출력이 바뀐 질문만 다시 묻습니다. 어느 탐침에도 연결되지 않은 변경이 있습니다: ${j.unlinked.join(', ')}` : '출력이 바뀐 질문만 다시 묻습니다.',
  );
}

/** A question whose verdict is kept from the last judgment. @param {any} q */
function carriedCard(q) {
  return h(
    'section',
    { class: 'hl-card hl-stack', id: `question-${q.id}` },
    questionHead(q),
    h('p', { class: 'hl-question' }, q.prompt),
    h('div', { class: 'hl-row' }, badge('positive', VERDICT_LABEL[q.carried.verdict] ?? q.carried.verdict), badge('neutral', '이전 판정 유지'), q.carried.answer !== null ? h('span', { class: 'hl-muted' }, `답: ${q.carried.answer}`) : null),
  );
}

/** @param {JudgeForm} f @param {any} q */
function judgeCard(f, q) {
  if (q.carried) return carriedCard(q);
  const j = f.task.judge;
  const observed = j.observed[q.id] ?? { probes: [], tests: [], correct: null };
  const prediction = j.predictions[q.id];
  /** @type {Child[]} */
  const body = [questionHead(q), h('p', { class: 'hl-question' }, q.prompt), questionSources(q.sources)];
  if (prediction !== undefined) {
    const shown = q.kind === 'test-lock' ? (prediction === 'yes' ? '예' : '아니오') : prediction;
    body.push(
      h('div', { class: 'hl-row' }, h('span', {}, '내 예측: ', h('strong', {}, shown)), observed.correct === true ? badge('positive', '맞음') : observed.correct === false ? badge('critical', '틀림') : badge('neutral', '직접 비교')),
    );
  }
  if (q.kind === 'test-lock') {
    body.push(h('p', {}, h('code', {}, q.test), h('span', { class: 'hl-muted' }, ` — ${q.plain}`)));
    body.push(
      observed.tests.length
        ? h('ul', { class: 'hl-files' }, observed.tests.map((/** @type {any} */ t) => h('li', {}, h('code', {}, t.name), ` ${TEST_STATUS[t.base] ?? t.base} → ${TEST_STATUS[t.head] ?? t.head}`, t.location ? h('span', { class: 'hl-muted' }, ` (${t.location})`) : null)))
        : h('p', { class: 'hl-muted' }, '이 테스트는 base와 head에서 결과가 같습니다.'),
    );
  }
  for (const id of observed.probes) body.push(observedProbe(f.task, id));
  if (q.kind === 'fork') {
    body.push(h('p', { class: 'hl-muted hl-small' }, `코드: ${q.codePaths.join(', ')} · 열린 이유: ${q.whyOpen}`));
  }
  const disabled = new Set();
  if (observed.correct === false) disabled.add('as-expected');
  if (observed.correct === true) disabled.add('my-misunderstanding');
  const verdict = f.verdicts.get(q.id) ?? null;
  const help = h('span', { class: 'hl-muted hl-small' }, verdict ? VERDICT_HELP[verdict] : '');
  const extra = h('div', { class: 'hl-stack-tight' });
  const drawExtra = () => {
    const v = f.verdicts.get(q.id);
    replace(
      extra,
      q.kind === 'fork' && v === 'answered'
        ? fieldBlock('답', textInput({ value: f.answers.get(q.id) ?? '', multiline: true, label: `${q.id} 답`, oninput: (x) => { f.answers.set(q.id, x); f.dirty = true; refreshJudge(); } }))
        : null,
      v && RETURNING.has(v)
        ? fieldBlock('이유 (필수)', textInput({ value: f.reasons.get(q.id) ?? '', multiline: true, label: `${q.id} 이유`, oninput: (x) => { f.reasons.set(q.id, x); f.dirty = true; refreshJudge(); } }), '에이전트가 이 이유를 받아 코드를 고칩니다.')
        : null,
      v && RETURNING.has(v) && q.citesSpec ? specChoiceBlock(f, q) : null,
    );
  };
  drawExtra();
  body.push(
    choiceControl({
      label: `${q.id} 판정`,
      options: VERDICT_OPTIONS[q.kind] ?? [],
      value: verdict,
      disabled,
      onchange: (v) => {
        f.verdicts.set(q.id, v);
        f.dirty = true;
        help.textContent = VERDICT_HELP[v] ?? '';
        drawExtra();
        refreshJudge();
      },
    }),
    help,
    extra,
  );
  return h('section', { class: 'hl-card hl-stack', id: `question-${q.id}` }, body);
}

/** What to do with the spec lines a sent-back question cites. @param {JudgeForm} f @param {any} q */
function specChoiceBlock(f, q) {
  const help = h('span', { class: 'seed-field__description' }, SPEC_CHOICE_HELP[f.specChoices.get(q.id) ?? ''] ?? '이 질문은 spec을 인용했습니다. spec을 어떻게 할지 고릅니다.');
  return fieldBlock(
    'spec 처리 (필수)',
    h(
      'div',
      { class: 'hl-stack-tight' },
      choiceControl({
        label: `${q.id} spec 처리`,
        options: SPEC_CHOICE_OPTIONS,
        value: f.specChoices.get(q.id) ?? null,
        onchange: (v) => {
          f.specChoices.set(q.id, v);
          f.dirty = true;
          help.textContent = SPEC_CHOICE_HELP[v] ?? '';
          refreshJudge();
        },
      }),
      help,
    ),
  );
}

/** The spec's lifetime, asked only when every question is accepted. @param {JudgeForm} f */
function drawLifecycle(f) {
  const j = f.task.judge;
  const accepting = ![...f.verdicts.values()].some((v) => RETURNING.has(v));
  if (f.lifecycleFor === accepting) return;
  f.lifecycleFor = accepting;
  if (!j.revealed || !j.specs?.length || !accepting) return void replace(f.lifecycle, null);
  const help = h('span', { class: 'hl-muted hl-small' }, AFTER_MERGE_HELP[f.afterMerge] ?? '');
  const owner = h('div', {});
  const drawOwner = () =>
    replace(
      owner,
      f.afterMerge === 'keep'
        ? fieldBlock('소유자 (필수)', textInput({ value: f.owner, oneLine: true, label: 'spec 소유자', oninput: (x) => { f.owner = x; f.dirty = true; refreshJudge(); } }), 'spec이 코드와 어긋나지 않게 챙길 사람이나 팀입니다.')
        : null,
    );
  drawOwner();
  replace(
    f.lifecycle,
    h(
      'section',
      { class: 'hl-card hl-stack' },
      h('h2', { class: 'hl-section-title' }, '머지할 때 spec 처리'),
      h('p', { class: 'hl-muted hl-small' }, '작업이 끝난 spec이 저장소에 남으면 현재 명세처럼 읽힙니다. ', j.specs.map((/** @type {string} */ r, /** @type {number} */ i) => [i ? ', ' : null, h('code', {}, r)])),
      choiceControl({
        label: 'spec 수명',
        options: AFTER_MERGE_OPTIONS,
        value: f.afterMerge,
        onchange: (v) => {
          f.afterMerge = v;
          f.dirty = true;
          help.textContent = AFTER_MERGE_HELP[v] ?? '';
          drawOwner();
          refreshJudge();
        },
      }),
      help,
      owner,
    ),
  );
}

/** @param {JudgeForm} f */
function judgePanel(f) {
  const j = f.task.judge;
  const submit = /** @type {HTMLButtonElement} */ (button(BUTTON.primary, '판정 저장', () => void saveJudgment(), { id: 'judge-submit' }));
  return h(
    'div',
    { class: 'hl-stack' },
    h(
      'section',
      { class: 'hl-card hl-stack' },
      h('h2', { class: 'hl-section-title' }, '동작 차이'),
      h('p', { class: 'hl-muted hl-small' }, '문장은 고칠 수 있지만, 숫자와 따옴표 친 값(관측값)은 바꿀 수 없습니다.'),
      j.behaviorDiffs.length
        ? j.behaviorDiffs.map((/** @type {any} */ d, /** @type {number} */ i) =>
            h(
              'div',
              { class: 'hl-stack-tight' },
              textInput({ value: f.diffs[i], multiline: true, label: `동작 차이 ${i + 1}`, oninput: (v) => { f.diffs[i] = v; f.dirty = true; refreshJudge(); } }),
              h('span', { class: 'hl-muted hl-small' }, `근거 탐침 ${d.probes.join(', ')}${d.codePaths.length ? ` · ${d.codePaths.join(', ')}` : ''}`),
            ),
          )
        : h('p', { class: 'hl-muted' }, '동작 차이 설명이 없습니다.'),
    ),
    j.inferences?.length
      ? callout('warning', '실행 증거 없음', h('span', {}, j.inferences.map((/** @type {any} */ x, /** @type {number} */ i) => [i ? h('br') : null, `${x.text} (확인하지 못한 이유: ${x.reason})`])))
      : null,
    j.tests
      ? h(
          'details',
          {},
          h('summary', {}, `테스트: base ${j.tests.base.counts.pass}/${j.tests.base.counts.fail} → head ${j.tests.head.counts.pass}/${j.tests.head.counts.fail} (통과/실패), 결과가 바뀐 테스트 ${j.tests.changed.length}개`),
          j.tests.changed.length
            ? h('ul', { class: 'hl-files' }, j.tests.changed.map((/** @type {any} */ t) => h('li', {}, h('code', {}, t.name), ` ${TEST_STATUS[t.base] ?? t.base} → ${TEST_STATUS[t.head] ?? t.head}`)))
            : h('p', { class: 'hl-muted' }, j.tests.comparison === 'tests' ? '없음' : '테스트별 결과를 읽지 못해 종료 코드만 비교했습니다.'),
        )
      : null,
    recheckNotice(j),
    j.questions.map((/** @type {any} */ q) => judgeCard(f, q)),
    f.lifecycle,
    f.status,
    h('div', { class: 'hl-row' }, submit),
  );
}

/** Why the current step cannot be saved yet. @param {JudgeForm} f @returns {string[]} */
function judgeBlockers(f) {
  const j = f.task.judge;
  /** @type {string[]} */
  const why = [];
  if (!j.revealed) {
    const open = j.questions.filter((/** @type {any} */ q) => q.predictFirst && !f.predictions.has(q.id));
    if (open.length) why.push(`예측하지 않은 질문: ${open.map((/** @type {any} */ q) => q.id).join(', ')}`);
    return why;
  }
  const undecided = j.questions.filter((/** @type {any} */ q) => !q.carried && !f.verdicts.has(q.id));
  if (undecided.length) why.push(`판정하지 않은 질문: ${undecided.map((/** @type {any} */ q) => q.id).join(', ')}`);
  const noReason = j.questions.filter((/** @type {any} */ q) => RETURNING.has(f.verdicts.get(q.id) ?? '') && !f.reasons.get(q.id)?.trim());
  if (noReason.length) why.push(`이유가 없는 되돌림·분리: ${noReason.map((/** @type {any} */ q) => q.id).join(', ')}`);
  const noAnswer = j.questions.filter((/** @type {any} */ q) => f.verdicts.get(q.id) === 'answered' && !f.answers.get(q.id)?.trim());
  if (noAnswer.length) why.push(`답이 없는 열린 선택: ${noAnswer.map((/** @type {any} */ q) => q.id).join(', ')}`);
  const noSpec = j.questions.filter((/** @type {any} */ q) => q.citesSpec && RETURNING.has(f.verdicts.get(q.id) ?? '') && !f.specChoices.has(q.id));
  if (noSpec.length) why.push(`spec 처리를 고르지 않은 질문: ${noSpec.map((/** @type {any} */ q) => q.id).join(', ')}`);
  const accepting = ![...f.verdicts.values()].some((v) => RETURNING.has(v));
  if (accepting && j.specs?.length && f.afterMerge === 'keep' && !f.owner.trim()) why.push('유지할 spec의 소유자');
  if (f.diffs.some((d) => !d.trim())) why.push('비어 있는 동작 차이 설명');
  return why;
}

function refreshJudge() {
  if (!judge) return;
  drawLifecycle(judge);
  const why = judgeBlockers(judge);
  const target = /** @type {HTMLButtonElement | null} */ (document.getElementById(judge.task.judge.revealed ? 'judge-submit' : 'reveal'));
  if (target) {
    target.disabled = Boolean(why.length) || judge.busy;
    target.toggleAttribute('data-disabled', target.disabled);
    if (judge.task.judge.revealed) target.textContent = [...judge.verdicts.values()].some((v) => RETURNING.has(v)) ? '판정 저장 (작업 되돌림)' : '판정 저장';
  }
  if (!judge.busy) replace(judge.status, why.length ? h('span', { class: 'hl-small hl-blocked' }, `저장 전에 필요: ${why.join(' · ')}`) : null);
  discardButton.disabled = judge.busy;
  refreshTabLabels();
}

/**
 * @param {JudgeForm} f
 * @param {string} title
 * @param {() => Promise<unknown>} work
 */
async function judgeStep(f, title, work) {
  f.busy = true;
  refreshJudge();
  try {
    await work();
    f.dirty = false;
    clearBanner();
    await loadTask(f.task.taskId, { force: true });
  } catch (err) {
    const e = /** @type {ApiError} */ (err);
    f.busy = false;
    replace(f.status, callout('critical', title, e.status === 409 ? h('span', {}, e.message, ' ', button(BUTTON.smallWeak, '새로 불러오기', () => void loadTask(f.task.taskId, { force: true }))) : e.message));
    refreshJudge();
  }
}

async function savePredictions() {
  if (!judge || judgeBlockers(judge).length) return;
  const f = judge;
  if (!window.confirm('예측을 저장하고 결과를 볼까요? 저장한 예측은 바꿀 수 없습니다.')) return;
  await judgeStep(f, '예측을 저장하지 못함', () => post(`/api/tasks/${encodeURIComponent(f.task.taskId)}/predict`, { draftSha256: f.task.draftSha256, answers: Object.fromEntries(f.predictions) }));
}

async function saveJudgment() {
  if (!judge || judgeBlockers(judge).length) return;
  const f = judge;
  const returning = [...f.verdicts.values()].some((v) => RETURNING.has(v));
  if (returning && !window.confirm('되돌림이나 분리가 있어 작업이 에이전트에게 되돌아갑니다. PR은 열리지 않습니다. 저장할까요?')) return;
  const items = f.task.judge.questions.filter((/** @type {any} */ q) => !q.carried).map((/** @type {any} */ q) => {
    const verdict = /** @type {string} */ (f.verdicts.get(q.id));
    return {
      id: q.id,
      verdict,
      ...(RETURNING.has(verdict) ? { reason: f.reasons.get(q.id)?.trim() } : {}),
      ...(verdict === 'answered' ? { answer: f.answers.get(q.id)?.trim() } : {}),
      ...(RETURNING.has(verdict) && q.citesSpec ? { spec: f.specChoices.get(q.id) } : {}),
    };
  });
  const lifetime = !returning && f.task.judge.specs?.length ? { specAfterMerge: { action: f.afterMerge, ...(f.afterMerge === 'keep' ? { owner: f.owner.trim() } : {}) } } : {};
  await judgeStep(f, '판정을 저장하지 못함', () =>
    post(`/api/tasks/${encodeURIComponent(f.task.taskId)}/judge`, { draftSha256: f.task.draftSha256, sourceHash: f.task.input.source.hash, items, behaviorDiffs: f.diffs.map((d) => d.trim()), ...lifetime }),
  );
}

/** @type {Record<string, string>} */
const VERDICT_LABEL = { 'as-expected': '예상대로', 'my-misunderstanding': '잘못 알았음', answered: '답함', revert: '되돌림', split: '분리' };

/** The signed judgment, after it was saved. @param {any} task */
function judgmentSummaryCard(task) {
  const a = task.latestApproval;
  if (!a || a.kind !== 'judgment') return null;
  return h(
    'section',
    { class: 'hl-card hl-stack' },
    h('div', { class: 'hl-spread' }, h('h2', { class: 'hl-section-title' }, '판정 내용'), h('div', { class: 'hl-row' }, a.outcome === 'accepted' ? badge('positive', '모두 수용') : badge('critical', '되돌림'), h('code', { class: 'hl-muted' }, a.id))),
    h('p', { class: 'hl-muted hl-small' }, `head ${a.target.headSha ? a.target.headSha.slice(0, 12) : '알 수 없음'} · 탐침 묶음 ${short(a.target.probeSetHash)} · ${when(a.judgedAt)}`),
    h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '동작 차이'), h('ul', { class: 'hl-files' }, a.behaviorDiffs.final.map((/** @type {string} */ t) => h('li', {}, t)))),
    h(
      'ul',
      { class: 'hl-files' },
      a.items.map((/** @type {any} */ i) =>
        h(
          'li',
          {},
          badge(RETURNING.has(i.verdict) ? 'critical' : 'positive', VERDICT_LABEL[i.verdict] ?? i.verdict),
          ` ${i.id} ${i.prompt}`,
          i.answer !== null ? h('span', { class: 'hl-muted' }, ` · 답: ${i.answer}${i.correct === false ? ' (틀림)' : i.correct === true ? ' (맞음)' : ''}`) : null,
          i.reason ? h('span', { class: 'hl-muted' }, ` · 이유: ${i.reason}`) : null,
          i.spec ? h('span', { class: 'hl-muted' }, ` · spec: ${SPEC_CHOICE_OPTIONS.find(([v]) => v === i.spec.choice)?.[1] ?? i.spec.choice}`) : null,
        ),
      ),
    ),
    a.specAfterMerge
      ? h('p', { class: 'hl-muted hl-small' }, `머지할 때 spec: ${AFTER_MERGE_OPTIONS.find(([v]) => v === a.specAfterMerge.action)?.[1] ?? a.specAfterMerge.action}${a.specAfterMerge.owner ? ` (소유자: ${a.specAfterMerge.owner})` : ''} — ${a.specAfterMerge.specs.join(', ')}`)
      : null,
  );
}

// Task screen layout: title, tabs (one panel per tab), and the approval bar fixed at the
// bottom of every tab. The selected tab is kept in the URL hash.

/** @typedef {'overview' | 'summary' | 'decision' | 'axiom' | 'judge' | 'approval'} TabId */

const titleSlot = h('div');
const tabList = h('div', { class: TABS.list, role: 'tablist', 'aria-label': '인계 검토 화면' });
const tabIndicator = h('div', { class: TABS.indicator, 'aria-hidden': 'true' });
/** @type {Record<TabId, HTMLElement>} */
const panels = {
  overview: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-overview', 'aria-labelledby': 'tab-overview' }),
  summary: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-summary', 'aria-labelledby': 'tab-summary' }),
  decision: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-decision', 'aria-labelledby': 'tab-decision' }),
  axiom: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-axiom', 'aria-labelledby': 'tab-axiom' }),
  judge: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-judge', 'aria-labelledby': 'tab-judge' }),
  approval: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-approval', 'aria-labelledby': 'tab-approval' }),
};
const tabsRoot = h('div', { class: `${TABS.root} hl-tabs` }, tabList, Object.values(panels));
/** @type {TabId[]} */
let tabIds = [];
/** @type {TabId} */
let activeTab = /** @type {TabId} */ (window.location.hash.slice(1) || 'overview');
/** Whether the URL named a tab, so the screen does not jump away from it. */
const activeTabChosen = Boolean(window.location.hash.slice(1));

/** @param {TabId} id @returns {Child} */
function tabLabel(id) {
  if (id === 'overview') {
    const n = attentionCount(latest);
    return [h('span', {}, '개요'), n ? badge('warning', `확인 ${n}`) : null];
  }
  if (id === 'summary') return 'PR 요약';
  if (id === 'approval') return APPROVAL_TITLE[latest?.latestApproval?.kind] ?? '승인 내용';
  if (id === 'judge') {
    const j = judge?.task.judge;
    if (!j) return '질문';
    if (!j.revealed) {
      const first = j.questions.filter((/** @type {any} */ q) => q.predictFirst);
      return [h('span', {}, `예측 ${first.filter((/** @type {any} */ q) => judge?.predictions.has(q.id)).length}/${first.length}`)];
    }
    const asked = j.questions.filter((/** @type {any} */ q) => !q.carried);
    const done = asked.filter((/** @type {any} */ q) => judge?.verdicts.has(q.id)).length;
    return [h('span', {}, `판정 ${done}/${asked.length}`), done === asked.length ? badge('positive', '완료') : null];
  }
  const indexes = form ? openIndexes(form, form.kinds[id]) : [];
  const decided = indexes.filter((i) => form?.decisions.has(i)).length;
  return [h('span', {}, `${kindName(id)} ${decided}/${indexes.length}`), decided === indexes.length ? badge('positive', '완료') : null];
}

function positionIndicator() {
  const selected = /** @type {HTMLElement | null} */ (tabList.querySelector('[aria-selected="true"]'));
  if (!selected) return;
  const pad = parseFloat(getComputedStyle(tabList).paddingLeft) || 0;
  tabIndicator.style.setProperty('--indicator-left', `${selected.offsetLeft - pad}px`);
  tabIndicator.style.setProperty('--indicator-width', `${selected.offsetWidth}px`);
}
window.addEventListener('resize', positionIndicator);

/**
 * @param {TabId} id
 * @param {{ focus?: boolean }} [options]
 */
function selectTab(id, { focus = false } = {}) {
  activeTab = id;
  for (const trigger of /** @type {NodeListOf<HTMLButtonElement>} */ (tabList.querySelectorAll('[role="tab"]'))) {
    const on = trigger.dataset.tab === id;
    trigger.setAttribute('aria-selected', String(on));
    trigger.tabIndex = on ? 0 : -1;
    if (on && focus) trigger.focus();
  }
  for (const [key, panel] of Object.entries(panels)) panel.setAttribute('aria-selected', String(key === id));
  if (window.location.hash.slice(1) !== id) window.history.replaceState(null, '', `#${id}`);
  window.requestAnimationFrame(positionIndicator);
}

/** @param {TabId[]} ids */
function drawTabs(ids) {
  tabIds = ids;
  const triggers = ids.map((id, i) => {
    const trigger = h('button', { type: 'button', role: 'tab', class: TABS.trigger, id: `tab-${id}`, 'aria-controls': `panel-${id}`, 'data-tab': id }, tabLabel(id));
    trigger.addEventListener('click', () => selectTab(id));
    trigger.addEventListener('keydown', (ev) => {
      const next = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? ids.length - 1 : null;
      if (next === null) return;
      ev.preventDefault();
      selectTab(ids[(next + ids.length) % ids.length], { focus: true });
    });
    return trigger;
  });
  replace(tabList, triggers, tabIndicator);
  if (!ids.includes(activeTab)) activeTab = ids.includes('approval') ? 'approval' : 'overview';
  selectTab(activeTab);
}

function refreshTabLabels() {
  for (const id of tabIds) {
    const trigger = tabList.querySelector(`#tab-${id}`);
    if (trigger) replace(trigger, tabLabel(id));
  }
  window.requestAnimationFrame(positionIndicator);
}

/** @param {any} task */
function drawStatic(task) {
  replace(titleSlot, titleBlock(task));
  replace(panels.overview, recheckCard(task), boundaryCard(task), noticesBlock(task));
  refreshTabLabels();
}

/** @param {any} task */
function drawForm(task) {
  if (task.judge) {
    form = null;
    actionsBar.remove();
    for (const id of /** @type {TabId[]} */ (['summary', 'decision', 'axiom'])) replace(panels[id]);
    if (task.state === 'awaiting_approval' && task.input) {
      const f = newJudgeForm(task);
      judge = f;
      replace(panels.judge, task.judge.revealed ? judgePanel(f) : predictPanel(f));
      replace(panels.approval);
      drawTabs(['overview', 'judge']);
      if (!activeTabChosen) selectTab('judge');
      refreshJudge();
      return;
    }
    judge = null;
    replace(panels.judge);
    const card = judgmentSummaryCard(task);
    const pr = prLink(task);
    replace(panels.approval, pr, card);
    drawTabs(card || pr ? ['overview', 'approval'] : ['overview']);
    return;
  }
  judge = null;
  replace(panels.judge);
  if (task.state === 'awaiting_approval' && task.draft && task.input) {
    const f = newForm(task);
    form = f;
    replace(panels.summary, summaryCard(f));
    replace(panels.decision, f.kinds.decision.length ? recordsPanel(f, 'decision') : null);
    replace(panels.axiom, f.kinds.axiom.length ? recordsPanel(f, 'axiom') : null);
    replace(panels.approval);
    /** @type {TabId[]} */
    const ids = ['overview', 'summary'];
    if (f.kinds.decision.length) ids.push('decision');
    if (f.kinds.axiom.length) ids.push('axiom');
    drawTabs(ids);
    if (!main.contains(actionsBar)) main.append(actionsBar);
    replace(actionsStatus);
    refreshActions();
  } else {
    form = null;
    for (const id of /** @type {TabId[]} */ (['summary', 'decision', 'axiom'])) replace(panels[id]);
    const approval = approvalSummaryCard(task);
    const pr = prLink(task);
    replace(panels.approval, pr, approval);
    actionsBar.remove();
    drawTabs(approval || pr ? ['overview', 'approval'] : ['overview']);
  }
}

/**
 * Fetch the task and redraw. The editable form is rebuilt only when nothing is being
 * edited; otherwise a banner offers to load the new version.
 * @param {string} taskId
 * @param {{ force?: boolean }} [options]
 */
async function loadTask(taskId, { force = false } = {}) {
  const task = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
  latest = task;
  if (!main.contains(tabsRoot)) replace(main, h('p', {}, h('a', { href: '/', class: 'hl-back' }, '← 전체 목록')), titleSlot, tabsRoot);
  const active = form ?? judge;
  const shown = active?.task;
  const changed = !shown || shown.draftSha256 !== task.draftSha256 || shown.state !== task.state || shown.judge?.revealed !== task.judge?.revealed;
  if (force || !active || !active.dirty) {
    if (force || changed || !active) drawForm(task);
    drawStatic(task);
    clearBanner();
    return;
  }
  drawStatic(task);
  if (changed) {
    showBanner(
      'informative',
      task.state === 'awaiting_approval' ? '새 초안이 있음' : '작업 상태가 바뀜',
      '편집 중인 내용은 그대로 두었습니다. 새로 불러오면 편집한 내용이 사라집니다.',
      { label: '새로 불러오기', onclick: () => void loadTask(taskId, { force: true }).catch(showError) },
    );
  }
}

// ------------------------------------------------------------------ routing and live updates

/** @param {unknown} err */
function showError(err) {
  replace(main, h('p', {}, h('a', { href: '/', class: 'hl-back' }, '← 전체 목록')), callout('critical', '불러오지 못함', /** @type {Error} */ (err).message));
}

const route = /^\/r\/[^/]+\/w\/[^/]+\/t\/([^/]+)$/.exec(window.location.pathname);
const currentTask = route ? decodeURIComponent(route[1]) : null;
document.title = currentTask ? `인계 검토 · Heirloom` : '전체 목록 · Heirloom';

/** @type {number | undefined} */
let refreshTimer;
function scheduleRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    const work = currentTask ? loadTask(currentTask) : renderOverview();
    work.catch((err) => {
      if (currentTask && latest) showBanner('critical', '갱신 실패', /** @type {Error} */ (err).message);
      else showError(err);
    });
  }, 200);
}

const events = new EventSource('/api/events');
events.addEventListener('task-updated', (ev) => {
  const { taskId } = JSON.parse(/** @type {MessageEvent} */ (ev).data);
  if (!currentTask || taskId === currentTask) scheduleRefresh();
});
let disconnected = false;
events.addEventListener('error', () => {
  if (disconnected) return;
  disconnected = true;
  showBanner('critical', '서버 연결 끊김', '대시보드 서버가 종료되었을 수 있습니다. 에이전트에게 open-dashboard 실행을 요청하면 다시 열립니다.');
});
events.addEventListener('open', () => {
  if (!disconnected) return;
  disconnected = false;
  // A restarted server has a new session token: reload unless the human is editing.
  if (!(form ?? judge)?.dirty) {
    window.location.reload();
    return;
  }
  showBanner('informative', '서버에 다시 연결됨', '서버가 다시 시작됐을 수 있습니다. 편집한 내용을 따로 적어 둔 뒤 화면을 새로 고치세요.', {
    label: '새로 고침',
    onclick: () => window.location.reload(),
  });
});

(currentTask ? loadTask(currentTask) : renderOverview()).catch(showError);
