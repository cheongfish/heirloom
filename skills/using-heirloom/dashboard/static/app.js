// Heirloom dashboard. Vanilla JS on top of the vendored SEED Design CSS.
// SEED class names are written out in full (never assembled from parts) so the layout test
// can check that each one exists in the vendored CSS.

const TOKEN = document.querySelector('meta[name="heirloom-token"]')?.getAttribute('content') ?? '';

// ------------------------------------------------------------------ theme

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => document.documentElement.setAttribute('data-seed-user-color-scheme', darkQuery.matches ? 'dark' : 'light');
applyScheme();
darkQuery.addEventListener('change', applyScheme);

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
 * root because the focus ring is drawn by the root.
 * @param {{ value: string, multiline?: boolean, label: string, placeholder?: string, oninput: (value: string) => void }} o
 */
function textInput({ value, multiline = false, label, placeholder, oninput }) {
  const field = multiline
    ? h('textarea', { class: INPUT_VALUE, 'aria-label': label, placeholder, rows: 2 })
    : h('input', { class: INPUT_VALUE, type: 'text', 'aria-label': label, placeholder });
  field.value = value;
  const root = h('div', { class: multiline ? `${INPUT_ROOT} hl-textarea-root` : INPUT_ROOT }, field);
  field.addEventListener('focus', () => root.setAttribute('data-focus', ''));
  field.addEventListener('blur', () => root.removeAttribute('data-focus'));
  field.addEventListener('input', () => oninput(field.value));
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
  discarded: ['neutral', '폐기됨'],
  expired: ['neutral', '만료됨'],
};
/** @param {string | null} state */
const stateBadge = (state) => {
  const [tone, label] = STATE[state ?? ''] ?? ['neutral', state ?? '알 수 없음'];
  return badge(tone, label);
};

/** @type {Record<string, string>} */
const STATE_HELP = {
  prepared: '에이전트가 초안을 쓰고 있습니다. 초안이 제출되면 이 화면이 갱신됩니다.',
  drafted: '초안 검사를 통과했습니다. 곧 승인 대기 상태가 됩니다.',
  approved: '승인을 저장했습니다. 에이전트가 apply-approval로 기록을 반영하고 PR을 만들 차례입니다.',
  applied: '기록 파일을 썼습니다. PR 작성을 기다립니다. PR을 만들 수 없는 저장소(GitHub 원격이 아님)는 대상 브랜치에 머지되면 끝난 작업으로 봅니다.',
  pr_created: 'PR을 만들었습니다.',
  failed: '인계 준비가 실패했습니다. 에이전트에게 원인을 확인하세요.',
  stale: '승인 이후 소스나 자료가 바뀌었습니다. 에이전트가 prepare-handoff를 다시 실행하면 바뀐 부분과 연결된 항목만 다시 확인합니다. 기존 승인은 보존됩니다.',
  discarded: '폐기된 작업입니다.',
  expired: 'PR이 닫혔거나 브랜치가 삭제되어 만료된 작업입니다.',
};

/** @type {Record<string, string>} */
const CURATION_HELP = {
  prepared: '정리 초안을 기다립니다. 헤드리스 실행 상태는 아래 전용 worktree 카드에 있습니다. 초안이 제출되면 이 화면이 갱신됩니다.',
  awaiting_approval: '제안을 항목마다 승인하세요. axiom 후보를 보류하거나 거절할 때는 이유를 적습니다. 이유는 저장소의 검토 이력에 남아, 새 근거 없이 같은 후보가 다시 제안되지 않게 합니다.',
  approved: '승인을 저장했습니다. 헤드리스 에이전트가 기록과 검토 이력을 커밋하고 PR을 만듭니다.',
  applied: '기록과 검토 이력을 썼습니다. PR 작성을 기다립니다.',
  pr_created: 'PR을 만들었습니다. 머지되면 묶음이 검토된 것으로 바뀌고 전용 worktree가 지워집니다.',
};

/** @type {Record<string, string>} */
const OP = { add: '추가', update: '수정', supersede: '대체', deprecate: '폐기', relate: '관계 추가' };
/** @type {Record<string, string>} */
const RELATION = { exception: '예외', coexist: '병존' };
const FINISHED = new Set(['pr_created', 'discarded', 'expired']);

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
 * @param {string} description
 * @param {Child[]} rows
 * @param {string} empty
 */
function listSection(title, description, rows, empty) {
  return h(
    'section',
    { class: 'hl-card hl-list-card' },
    h('div', { class: 'seed-list-header seed-list-header--variant_boldSolid' }, h('span', {}, title), h('span', { class: 'hl-muted' }, String(rows.length))),
    description ? h('p', { class: 'hl-empty hl-muted hl-small' }, description) : null,
    rows.length ? rows : h('p', { class: 'hl-empty hl-muted' }, empty),
  );
}

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
    h('div', { class: 'seed-list-item__suffix' }, h('div', { class: 'hl-row' }, t.curation ? badge('neutral', '맥락 정리') : null, agentBadge(t.agent), t.merged === true ? badge('positive', '머지됨') : stateBadge(t.state))),
  );

/** @param {any} t a listed task: finished, or applied without a PR and already merged */
const isDone = (t) => FINISHED.has(t.state) || t.merged === true;

/**
 * Badge of a curation task's headless run, or null when nothing ran or the last run ended
 * normally.
 * @param {any} agent agentStatusOf() from the server
 */
function agentBadge(agent) {
  if (agent?.running) return badge('informative', agent.running.phase === 'curate' ? '정리 초안 작성 중' : '반영 중');
  const last = agent?.last;
  if (last && (last.error || last.timedOut || last.exitCode !== 0)) return badge('critical', '헤드리스 실행 실패');
  return null;
}

/**
 * Start a curation for a repository after the human confirms, then open its task screen.
 * @param {any} c curation status of the repository
 * @param {HTMLButtonElement} trigger
 */
async function runCuration(c, trigger) {
  const ok = window.confirm(
    [
      '맥락 정리를 실행할까요?',
      '',
      '- 저장소의 전용 worktree(~/.heirloom/worktrees/)에 새 브랜치를 만들고, 그 안에서 헤드리스 에이전트를 실행합니다. 지금 작업 트리는 건드리지 않습니다.',
      '- 에이전트는 사용자 권한으로 실행되며, 승인 뒤 PR을 만들 때 사용자의 gh 인증을 씁니다.',
      '- 제안은 이 대시보드에서 항목마다 승인하기 전까지 아무 기록도 바꾸지 않습니다.',
    ].join('\n'),
  );
  if (!ok) return;
  trigger.disabled = true;
  try {
    const started = await post(`/api/repos/${encodeURIComponent(c.repoId)}/curate`, {});
    window.location.href = taskHref(started.taskId, c.repoId, null);
  } catch (err) {
    trigger.disabled = false;
    showBanner('critical', '정리를 시작하지 못함', /** @type {Error} */ (err).message);
  }
}

/** @param {any} c curation status of one repository */
function curationRow(c) {
  /** @type {Child} */
  let suffix = null;
  if (c.inProgress.length) suffix = badge('informative', '정리 진행 중');
  else if (c.unreviewed > 0 && !c.error) {
    const run = /** @type {HTMLButtonElement} */ (button(c.notify ? BUTTON.primary : BUTTON.smallWeak, '정리 실행', () => void runCuration(c, run)));
    suffix = h('div', { class: 'hl-row' }, c.notify ? badge('warning', '정리 권장') : null, run);
  }
  const detail = c.error
    ? `확인하지 못함: ${c.error}`
    : `검토하지 않은 decision ${c.unreviewed}개 · 마지막 정리 ${c.lastReviewedAt ? when(c.lastReviewedAt) : '없음'} · 대상 ${c.base}${c.unreadable ? ` · 읽지 못한 파일 ${c.unreadable}개` : ''}`;
  return h(
    'div',
    { class: 'seed-list-item__root' },
    h('div', { class: 'seed-list-item__content' }, h('span', { class: 'seed-list-item__title' }, c.root ?? c.repoId), h('span', { class: 'seed-list-item__detail' }, detail)),
    h('div', { class: 'seed-list-item__suffix' }, suffix),
  );
}

async function renderOverview() {
  const data = await api('/api/tasks');
  /** @type {any[]} */
  const tasks = data.tasks;
  const waiting = tasks.filter((t) => t.state === 'awaiting_approval');
  const stale = tasks.filter((t) => t.stale && t.state !== 'awaiting_approval');
  const open = tasks.filter((t) => !t.stale && t.state !== 'awaiting_approval' && !isDone(t));
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

  /** @type {any[]} */
  const curations = (data.curation ?? []).filter((/** @type {any} */ c) => c.unreviewed > 0 || c.inProgress.length || c.error);
  replace(
    main,
    h('h1', { class: 'hl-title' }, '전체 목록'),
    listSection('승인 대기', '', waiting.map(taskRow), '승인을 기다리는 인계가 없습니다.'),
    curations.length
      ? listSection(
          '맥락 정리',
          '여러 작업의 decision을 묶어 중복을 정리하고 axiom 후보를 찾습니다. 실행은 선택이며, 실행해도 승인하기 전에는 아무 기록도 바뀌지 않습니다.',
          curations.map(curationRow),
          '',
        )
      : null,
    h(
      'div',
      {},
      listSection(
        '인계되지 않은 변경',
        '코드 변경이 있지만 현재 상태로 인계를 준비하지 않은 작업 트리입니다. 작업이 끝났다면 에이전트에게 인계를 요청하세요.',
        unhandedRows,
        '인계되지 않은 변경이 없습니다.',
      ),
      uncheckedNote,
    ),
    listSection(`오래된 미처리 건 (${data.staleDays}일 이상)`, '시간이 지나도 자동으로 만료되지 않습니다. 필요 없으면 작업 화면에서 폐기하세요.', stale.map(taskRow), '오래된 미처리 건이 없습니다.'),
    listSection('진행 중', '', open.map(taskRow), '진행 중인 다른 작업이 없습니다.'),
    listSection('최근 끝난 작업', '', done.map(taskRow), '끝난 작업이 없습니다.'),
  );
}

// ------------------------------------------------------------------ task screen

/**
 * @typedef {object} Bullet
 * @property {string} text
 * @property {number | null} origin index in the draft summary, null for a bullet the human added
 * @property {boolean} carried copied from the last approval and not touched by the changes (read only)
 */

/**
 * @typedef {object} Form
 * @property {any} task the task the form was built from (its draftSha256 and sourceHash are sent)
 * @property {Bullet[]} summary
 * @property {Map<number, Decision>} decisions
 * @property {Map<number, { title: string, body: Record<string, string> }>} edits
 * @property {Map<number, (d: Decision) => void>} setters
 * @property {{ decision: number[], axiom: number[] }} kinds record indexes per tab
 * @property {Set<number>} carriedRecords record indexes that keep their approval (incremental handoff)
 * @property {Set<number>} carriedSummary draft summary indexes that keep their approval
 * @property {Set<number>} reopened carried records the human opened for review again
 * @property {Map<number, string>} reasons why a curation candidate is held or rejected
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
    h('div', { class: 'hl-spread' }, h('h1', { class: 'hl-title' }, task.curation ? '맥락 정리 검토' : '인계 검토'), h('div', { class: 'hl-row' }, stateBadge(task.state), h('code', { class: 'hl-muted' }, task.taskId))),
    input ? h('p', {}, h('code', {}, input.branch ?? '(분리된 HEAD)'), ' → ', h('code', {}, input.base.ref), h('span', { class: 'hl-muted' }, ` · ${input.repo.root}`)) : null,
    ((task.curation && CURATION_HELP[task.state]) || STATE_HELP[task.state]) ? h('p', { class: 'hl-muted' }, (task.curation && CURATION_HELP[task.state]) || STATE_HELP[task.state]) : null,
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
      h('dd', {}, input.trigger === 'manual' ? '수동 요청' : input.trigger === 'curation' ? '맥락 정리(대시보드에서 실행)' : '자동(spec 기반)', input.sdlcTaskRef ? ` · ${input.sdlcTaskRef}` : ''),
      h('dt', {}, '준비 시각'),
      h('dd', {}, when(input.createdAt)),
    ),
    h(
      'details',
      {},
      h('summary', {}, `변경 파일 ${input.source.files.length}개`),
      h('ul', { class: 'hl-files' }, input.source.files.map((/** @type {any} */ f) => h('li', {}, h('code', {}, f.path), h('span', { class: 'hl-muted' }, ` ${f.status}`)))),
    ),
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

/** @param {any} task */
function curationCard(task) {
  const c = task.input?.curation;
  if (!c) return null;
  const closed = c.history.flatMap((/** @type {any} */ r) => r.candidates.filter((/** @type {any} */ x) => x.decision !== 'accepted').map((/** @type {any} */ x) => ({ ...x, review: r.id })));
  /** @param {string} title @param {string[]} ids @param {boolean} [open] */
  const group = (title, ids, open = false) =>
    h('details', open ? { open: '' } : {}, h('summary', {}, `${title} ${ids.length}개`), ids.length ? h('ul', { class: 'hl-files' }, ids.map((id) => recordLine(task, id))) : h('p', { class: 'hl-muted' }, '없음'));
  return h(
    'section',
    { class: 'hl-card' },
    h('h2', { class: 'hl-section-title' }, '정리 묶음'),
    h('p', { class: 'hl-muted hl-small' }, '대상 브랜치에서 아직 함께 검토하지 않은 decision을 묶었습니다. 이 정리가 머지되면 묶음은 검토된 것으로 기록됩니다.'),
    group('검토할 decision', c.batch, true),
    group('관련된 활성 decision', c.related),
    group('활성 axiom', c.axioms),
    h(
      'details',
      {},
      h('summary', {}, `이전 정리 ${c.history.length}회 · 보류·거절된 후보 ${closed.length}개`),
      closed.length
        ? h(
            'ul',
            { class: 'hl-files' },
            closed.map((/** @type {any} */ x) => h('li', {}, badge(x.decision === 'held' ? 'warning' : 'critical', x.decision === 'held' ? '보류' : '거절'), ` ${x.title} `, h('span', { class: 'hl-muted hl-small' }, `근거 ${x.evidence.join(', ')}${x.reason ? ` · 이유: ${x.reason}` : ''}`))),
          )
        : h('p', { class: 'hl-muted' }, '없음'),
    ),
  );
}

/** @type {Record<string, string>} */
const AGENT_ERROR = { command_missing: '실행 파일을 찾지 못함', interrupted: '실행이 중간에 끊김(대시보드 서버 종료 등)' };

/** @param {any} task */
function agentCard(task) {
  const meta = task.curation;
  if (!meta) return null;
  const agent = task.agent ?? {};
  /** @type {Child[]} */
  const body = [];
  const phase = task.state === 'prepared' || task.state === 'drafted' ? 'curate' : task.state === 'approved' || task.state === 'applied' ? 'apply' : null;
  if (agent.running) {
    body.push(callout('informative', agent.running.phase === 'curate' ? '정리 초안 작성 중' : '기록 반영과 PR 작성 중', h('span', {}, `${when(agent.running.at)}부터 실행 중 · 로그 `, h('code', {}, agent.running.log))));
  } else if (agent.last && (agent.last.error || agent.last.timedOut || agent.last.exitCode !== 0) && phase) {
    const why = agent.last.error ? (AGENT_ERROR[agent.last.error] ?? agent.last.error) : agent.last.timedOut ? '시간 상한(30분)을 넘어 중지함' : `종료 코드 ${agent.last.exitCode}`;
    const retry = /** @type {HTMLButtonElement} */ (
      button(BUTTON.smallWeak, '다시 실행', async () => {
        retry.disabled = true;
        try {
          await post(`/api/tasks/${encodeURIComponent(task.taskId)}/retry-agent`, {});
          await loadTask(task.taskId, { force: true });
        } catch (err) {
          retry.disabled = false;
          showBanner('critical', '다시 실행하지 못함', /** @type {Error} */ (err).message);
        }
      })
    );
    body.push(
      callout(
        'critical',
        `헤드리스 실행 실패: ${why}`,
        h(
          'span',
          {},
          '작업은 지금 상태 그대로 있습니다. 다시 실행하거나, 직접 실행하세요: ',
          h('code', {}, `cd ${meta.worktree}`),
          ' 뒤 Claude Code에서 ',
          h('code', {}, phase === 'curate' ? '/curate-decisions' : '/apply-approval'),
          agent.last.log ? [' · 로그 ', h('code', {}, agent.last.log)] : null,
        ),
      ),
      h('div', {}, retry),
    );
  }
  if (meta.removeNote) body.push(callout('warning', '전용 worktree를 지우지 않음', meta.removeNote));
  return h(
    'section',
    { class: 'hl-card' },
    h('h2', { class: 'hl-section-title' }, '전용 worktree'),
    h(
      'dl',
      { class: 'hl-meta' },
      h('dt', {}, '위치'),
      h('dd', {}, meta.removedAt ? h('span', { class: 'hl-muted' }, `지움 (${when(meta.removedAt)})`) : h('code', {}, meta.worktree)),
      h('dt', {}, '브랜치'),
      h('dd', {}, h('code', {}, meta.branch), ' → ', h('code', {}, meta.base)),
      h('dt', {}, '대상 브랜치 갱신'),
      h('dd', {}, meta.fetch.fetched === false ? badge('warning', `미확인: ${meta.fetch.note}`) : meta.fetch.fetched ? '실행 전에 가져옴' : h('span', { class: 'hl-muted' }, '원격 없음')),
    ),
    body,
  );
}

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
  if (task.check?.warnings?.length) items.push(callout('warning', '검사 경고', task.check.warnings.join(' · ')));
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
        h('span', { class: 'hl-small' }, h('code', {}, s.ref), s.lines ? (s.lines[0] === s.lines[1] ? ` ${s.lines[0]}행` : ` ${s.lines[0]}–${s.lines[1]}행`) : ''),
        s.quote ? h('blockquote', { class: 'hl-quote hl-small' }, s.quote) : null,
      ),
    ),
  );
}

/**
 * An axiom candidate of a curation: holding or rejecting it needs a reason.
 * @param {any} task
 * @param {any} r draft op
 */
const isCandidate = (task, r) => task.input?.trigger === 'curation' && r.op === 'add' && r.kind === 'axiom';

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
  const card = h('article', { class: 'hl-card', 'aria-label': `${kind} 항목 ${index + 1}` });
  const current = f.decisions.get(index);
  if (current) card.setAttribute('data-decision', current);

  /** @type {Child[]} */
  const content = [];
  if (editable) {
    const edit = /** @type {{ title: string, body: Record<string, string> }} */ (f.edits.get(index));
    content.push(
      fieldBlock(
        '제목',
        textInput({
          value: edit.title,
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
      h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '연관 코드 경로'), pathList(r.codePaths)),
      r.topics?.length ? h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, '주제'), pathList(r.topics)) : null,
      Array.isArray(r.evidence)
        ? h('div', { class: 'hl-stack-tight' }, h('span', { class: 'hl-muted hl-small' }, `근거 decision ${r.evidence.length}개 (원문은 저장소의 기록 파일)`), h('ul', { class: 'hl-files' }, r.evidence.map((/** @type {string} */ id) => recordLine(task, id))))
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
          badge(kind === 'axiom' ? 'warning' : 'neutral', kind),
          h('code', { class: 'hl-muted' }, `#${index + 1}${r.id ? ` ${r.id}` : ''}`),
        ),
        control.root,
      ),
      reasons.length ? callout('warning', '다시 확인할 이유', reasons.join(' · ')) : null,
      before ? previousRecord(before, kind) : null,
      editable ? null : h('h3', { class: 'hl-section-title' }, r.op === 'update' ? '기존 기록 수정' : r.op === 'supersede' ? '기존 기록 대체' : r.op === 'relate' ? '기존 기록에 관계 추가' : '기존 기록 폐기'),
      content,
      isCandidate(task, r)
        ? fieldBlock(
            '보류·거절 이유',
            textInput({
              value: f.reasons.get(index) ?? '',
              multiline: true,
              label: `항목 ${index + 1} 보류·거절 이유`,
              oninput: (v) => {
                f.reasons.set(index, v);
                markDirty();
              },
            }),
            '후보를 보류하거나 거절하면 필수입니다. 저장소의 검토 이력에 남습니다.',
          )
        : null,
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
    { class: 'hl-card', 'aria-label': `${kind} 항목 ${index + 1} (승인 유지)`, 'data-decision': 'approved' },
    h(
      'div',
      { class: 'hl-spread' },
      h('div', { class: 'hl-row' }, badge('positive', '승인 유지'), badge(kind === 'axiom' ? 'warning' : 'neutral', kind), h('code', { class: 'hl-muted' }, `#${index + 1}${r.id ? ` ${r.id}` : ''}`)),
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
  const list = h('div', { class: 'hl-stack' });
  const count = h('span', { class: 'hl-muted hl-small' });
  const initial = f.task.draft.summary;

  const draw = () => {
    replace(
      list,
      f.summary.map((b, i) =>
        b.carried
          ? h(
              'div',
              { class: 'hl-bullet' },
              h(
                'div',
                { class: 'hl-stack-tight' },
                h('p', { class: 'hl-field-text' }, b.text),
                h('div', { class: 'hl-row' }, badge('positive', '승인 유지'), b.origin !== null && initial[b.origin]?.codePaths?.length ? pathList(initial[b.origin].codePaths) : null),
              ),
            )
          : h(
          'div',
          { class: 'hl-bullet' },
          h(
            'div',
            { class: 'hl-stack-tight' },
            textInput({
              value: b.text,
              multiline: true,
              label: `요약 불릿 ${i + 1}`,
              placeholder: '요약 문장',
              oninput: (v) => {
                b.text = v;
                markDirty();
                refreshActions();
              },
            }),
            b.origin !== null && initial[b.origin]?.codePaths?.length ? pathList(initial[b.origin].codePaths) : null,
            bulletRecheck(f.task, b),
          ),
          button(BUTTON.smallGhost, '삭제', () => {
            f.summary.splice(i, 1);
            markDirty();
            draw();
            refreshActions();
          }),
        ),
      ),
    );
    const n = f.summary.length;
    count.textContent = `불릿 ${n}개${n < 2 || n > 5 ? ' (권장 2~5개)' : ''}`;
  };
  draw();

  return h(
    'section',
    { class: 'hl-card' },
    h('div', { class: 'hl-spread' }, h('h2', { class: 'hl-section-title' }, 'PR 요약'), count),
    h('p', { class: 'hl-muted hl-small' }, 'PR 본문에 들어갈 요약입니다. 고치지 않고 승인해도 됩니다. 최초 초안과 최종 요약은 따로 보존됩니다.'),
    list,
    h(
      'div',
      { class: 'hl-row' },
      button(BUTTON.smallWeak, '불릿 추가', () => {
        f.summary.push({ text: '', origin: null, carried: false });
        markDirty();
        draw();
        refreshActions();
      }),
      button(BUTTON.smallGhost, '초안으로 되돌리기', () => {
        f.summary = draftBullets(f.task, f.carriedSummary);
        markDirty();
        draw();
        refreshActions();
      }),
    ),
  );
}

/**
 * Reasons and the approved text of a bullet that is up for recheck.
 * @param {any} task
 * @param {Bullet} b
 */
function bulletRecheck(task, b) {
  if (!task.input?.recheck || b.origin === null) return null;
  const bullet = task.draft.summary[b.origin];
  const reasons = recheckReasons(task, 'summary', bullet);
  const before = Number.isInteger(bullet.baseIndex) ? task.input.recheck.baseline.summary[bullet.baseIndex]?.text : null;
  return h(
    'div',
    { class: 'hl-stack-tight hl-small' },
    reasons.length ? h('span', { class: 'hl-muted' }, `다시 확인할 이유: ${reasons.join(' · ')}`) : null,
    before ? h('span', { class: 'hl-muted' }, `지난 승인: ${before}`) : null,
  );
}

/**
 * Bullets of the draft summary, carried ones marked.
 * @param {any} task
 * @param {Set<number>} carried
 * @returns {Bullet[]}
 */
function draftBullets(task, carried) {
  return (task.draft?.summary ?? []).map((/** @type {any} */ b, /** @type {number} */ i) => ({ text: b.text, origin: i, carried: carried.has(i) }));
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
      h('h2', { class: 'hl-section-title' }, `axiom 변경 ${indexes.length}건`),
      callout('warning', 'axiom은 항목마다 따로 확인합니다', 'axiom은 이후 모든 작업에 적용되는 규칙입니다. 일괄 승인에 포함되지 않습니다.'),
      indexes.map((i) => recordCard(f, i)),
    ];
  }
  return [
    h(
      'div',
      { class: 'hl-spread' },
      h('h2', { class: 'hl-section-title' }, `decision 변경 ${indexes.length}건`),
      button(BUTTON.smallWeak, 'decision 모두 승인', () => {
        for (const i of openIndexes(f, indexes)) f.setters.get(i)?.('approved');
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
const discardButton = button(BUTTON.outline, '작업 폐기', () => void discardTask());
append(actionsBar, [actionsStatus, h('div', { class: 'hl-spread' }, progress, h('div', { class: 'hl-row' }, discardButton, approveButton))]);

function refreshActions() {
  if (!form) return;
  const f = form;
  const open = openIndexes(f);
  const total = open.length;
  const quick = total === 0;
  const decided = open.filter((i) => f.decisions.has(i)).length;
  const hasSummary = form.summary.some((b) => b.text.trim());
  const missingReason = open.filter((i) => {
    const d = f.decisions.get(i);
    return d && d !== 'approved' && isCandidate(f.task, f.task.draft.records[i]) && !f.reasons.get(i)?.trim();
  });
  approveButton.textContent = quick ? '요약 확인하고 간이 승인' : '승인 저장';
  const carriedNote = f.carriedRecords.size ? ` · 승인 유지 ${f.carriedRecords.size - f.reopened.size}건` : '';
  const reasonNote = missingReason.length ? ` · 이유가 필요한 후보 ${missingReason.map((i) => `#${i + 1}`).join(', ')}` : '';
  progress.textContent = (quick ? (f.carriedRecords.size ? '다시 결정할 decision·axiom 항목이 없습니다.' : 'decision·axiom 변경이 없는 작업입니다.') : `결정한 항목 ${decided}/${total}`) + carriedNote + reasonNote;
  const ready = hasSummary && decided === total && !missingReason.length && !form.busy;
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
    reasons: new Map(),
    summary: draftBullets(task, carriedSummary),
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
    /** @type {{ index: number, decision: Decision | undefined, edited?: Record<string, unknown>, reopen?: true, reason?: string }} */
    const item = { index, decision: f.decisions.get(index) };
    if (f.reopened.has(index)) item.reopen = true;
    const reason = f.reasons.get(index)?.trim();
    if (reason && item.decision !== 'approved') item.reason = reason;
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
  const bullets = f.summary.filter((b) => b.text.trim());
  return {
    kind: open.length ? 'full' : 'quick',
    draftSha256: f.task.draftSha256,
    sourceHash: f.task.input.source.hash,
    summary: bullets.map((b) => b.text.trim()),
    summaryOrigins: bullets.map((b) => b.origin),
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
    // The screen switches to the approved state; STATE_HELP tells the human what happens next.
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
    h('p', { class: 'hl-muted hl-small' }, `${when(a.approvedAt)} · ${a.approver.gitUser ?? '승인자 알 수 없음'} · 키 ${a.approver.fingerprint}`),
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
const APPROVAL_TITLE = { full: '승인 내용', quick: '간이 승인 내용', incremental: '증분 승인 내용' };

/** @param {any} task */
function prLink(task) {
  const event = [...(task.events ?? [])].reverse().find((/** @type {any} */ e) => e.type === 'pr_created');
  if (!event?.url) return null;
  return h('section', { class: 'hl-card' }, h('p', {}, 'PR: ', h('a', { href: event.url, rel: 'noreferrer noopener', target: '_blank' }, event.url)));
}

// Task screen layout: title, tabs (one panel per tab), and the approval bar fixed at the
// bottom of every tab. The selected tab is kept in the URL hash.

/** @typedef {'overview' | 'summary' | 'decision' | 'axiom' | 'approval'} TabId */

const titleSlot = h('div');
const tabList = h('div', { class: TABS.list, role: 'tablist', 'aria-label': '인계 검토 화면' });
const tabIndicator = h('div', { class: TABS.indicator, 'aria-hidden': 'true' });
/** @type {Record<TabId, HTMLElement>} */
const panels = {
  overview: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-overview', 'aria-labelledby': 'tab-overview' }),
  summary: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-summary', 'aria-labelledby': 'tab-summary' }),
  decision: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-decision', 'aria-labelledby': 'tab-decision' }),
  axiom: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-axiom', 'aria-labelledby': 'tab-axiom' }),
  approval: h('div', { class: TABS.content, role: 'tabpanel', id: 'panel-approval', 'aria-labelledby': 'tab-approval' }),
};
const tabsRoot = h('div', { class: `${TABS.root} hl-tabs` }, tabList, Object.values(panels));
/** @type {TabId[]} */
let tabIds = [];
/** @type {TabId} */
let activeTab = /** @type {TabId} */ (window.location.hash.slice(1) || 'overview');

/** @param {TabId} id @returns {Child} */
function tabLabel(id) {
  if (id === 'overview') {
    const n = attentionCount(latest);
    return [h('span', {}, '개요'), n ? badge('warning', `확인 ${n}`) : null];
  }
  if (id === 'summary') return 'PR 요약';
  if (id === 'approval') return APPROVAL_TITLE[latest?.latestApproval?.kind] ?? '승인 내용';
  const indexes = form ? openIndexes(form, form.kinds[id]) : [];
  const decided = indexes.filter((i) => form?.decisions.has(i)).length;
  return [h('span', {}, `${id} ${decided}/${indexes.length}`), decided === indexes.length ? badge('positive', '완료') : null];
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
  replace(panels.overview, agentCard(task), recheckCard(task), curationCard(task), boundaryCard(task), noticesBlock(task));
  refreshTabLabels();
}

/** @param {any} task */
function drawForm(task) {
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
  if (!main.contains(tabsRoot)) replace(main, h('p', {}, h('a', { href: '/' }, '← 전체 목록')), titleSlot, tabsRoot);
  const shown = form?.task;
  const changed = !shown || shown.draftSha256 !== task.draftSha256 || shown.state !== task.state;
  if (force || !form || !form.dirty) {
    if (force || changed || !form) drawForm(task);
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
  replace(main, h('p', {}, h('a', { href: '/' }, '← 전체 목록')), callout('critical', '불러오지 못함', /** @type {Error} */ (err).message));
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
  if (!form?.dirty) {
    window.location.reload();
    return;
  }
  showBanner('informative', '서버에 다시 연결됨', '서버가 다시 시작됐을 수 있습니다. 편집한 내용을 따로 적어 둔 뒤 화면을 새로 고치세요.', {
    label: '새로 고침',
    onclick: () => window.location.reload(),
  });
});

(currentTask ? loadTask(currentTask) : renderOverview()).catch(showError);
