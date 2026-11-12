// Hand-written validators for Heirloom's data formats (records, input, draft, approval,
// events, index, config).
// A validator pushes "<json path>: <message>" strings into `errors`.

import { HeirloomError } from './errors.mjs';

/** @typedef {(value: unknown, at: string, errors: string[]) => void} Validator */

const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;
const MARKDOWN_BRACES = /\.\{([^}]*)\}$/;

/**
 * True when a code path or glob points only at Markdown documents. Documents are linked as
 * sources, never as related code paths.
 * @param {string} p
 */
export function isMarkdownCodePath(p) {
  const last = p.split('/').pop() ?? '';
  if (MARKDOWN_EXT.test(last)) return true;
  const braces = MARKDOWN_BRACES.exec(last);
  return Boolean(braces && braces[1].split(',').every((ext) => /^(md|mdx|markdown)$/i.test(ext.trim())));
}

// ---------------------------------------------------------------- combinators

/** @param {unknown} v */
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * @param {{ nonEmpty?: boolean, pattern?: RegExp, check?: (s: string) => string | null }} [opts]
 * @returns {Validator}
 */
export const str = (opts = {}) => (v, at, errors) => {
  if (typeof v !== 'string') return void errors.push(`${at}: 문자열이어야 함 (${typeOf(v)})`);
  if (opts.nonEmpty && !v.trim()) return void errors.push(`${at}: 비어 있으면 안 됨`);
  if (opts.pattern && !opts.pattern.test(v)) return void errors.push(`${at}: 형식이 맞지 않음 (${JSON.stringify(v)})`);
  const problem = opts.check?.(v);
  if (problem) errors.push(`${at}: ${problem}`);
};

/** @param {{ min?: number, max?: number }} [opts] @returns {Validator} */
export const int = (opts = {}) => (v, at, errors) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return void errors.push(`${at}: 정수여야 함`);
  if (opts.min !== undefined && v < opts.min) errors.push(`${at}: ${opts.min} 이상이어야 함`);
  if (opts.max !== undefined && v > opts.max) errors.push(`${at}: ${opts.max} 이하여야 함`);
};

/** @type {Validator} */
export const bool = (v, at, errors) => {
  if (typeof v !== 'boolean') errors.push(`${at}: true/false여야 함`);
};

/** @param {...(string | number | boolean | null)} values @returns {Validator} */
export const oneOf = (...values) => (v, at, errors) => {
  if (!values.includes(/** @type {any} */ (v))) errors.push(`${at}: ${values.map((x) => JSON.stringify(x)).join(', ')} 중 하나여야 함`);
};

/** @param {Validator} inner @returns {Validator} */
export const nullable = (inner) => (v, at, errors) => {
  if (v !== null) inner(v, at, errors);
};

/** @param {Validator} item @param {{ min?: number, max?: number }} [opts] @returns {Validator} */
export const arrayOf = (item, opts = {}) => (v, at, errors) => {
  if (!Array.isArray(v)) return void errors.push(`${at}: 배열이어야 함 (${typeOf(v)})`);
  if (opts.min !== undefined && v.length < opts.min) errors.push(`${at}: 항목이 ${opts.min}개 이상이어야 함`);
  if (opts.max !== undefined && v.length > opts.max) errors.push(`${at}: 항목이 ${opts.max}개 이하여야 함`);
  v.forEach((x, i) => item(x, `${at}[${i}]`, errors));
};

/** @param {Validator} value @returns {Validator} */
export const recordOf = (value) => (v, at, errors) => {
  if (typeOf(v) !== 'object') return void errors.push(`${at}: 객체여야 함 (${typeOf(v)})`);
  for (const [k, x] of Object.entries(/** @type {object} */ (v))) value(x, `${at}[${JSON.stringify(k)}]`, errors);
};

/**
 * @param {Record<string, Validator>} shape required fields
 * @param {{ optional?: Record<string, Validator>, extra?: boolean, check?: (o: Record<string, unknown>) => string[] }} [opts]
 * @returns {Validator}
 */
export const object = (shape, opts = {}) => (v, at, errors) => {
  if (typeOf(v) !== 'object') return void errors.push(`${at}: 객체여야 함 (${typeOf(v)})`);
  const o = /** @type {Record<string, unknown>} */ (v);
  const optional = opts.optional ?? {};
  for (const [key, validator] of Object.entries(shape)) {
    if (!(key in o)) errors.push(`${at}.${key}: 필수 필드가 없음`);
    else validator(o[key], `${at}.${key}`, errors);
  }
  for (const [key, validator] of Object.entries(optional)) {
    if (key in o && o[key] !== undefined) validator(o[key], `${at}.${key}`, errors);
  }
  if (!opts.extra) {
    for (const key of Object.keys(o)) {
      if (!(key in shape) && !(key in optional)) errors.push(`${at}.${key}: 허용되지 않는 필드`);
    }
  }
  if (opts.check) for (const problem of opts.check(o)) errors.push(`${at}: ${problem}`);
};

/**
 * Pick a validator by the value of a discriminator field.
 * @param {string} field
 * @param {Record<string, Validator>} variants
 * @returns {Validator}
 */
export const tagged = (field, variants) => (v, at, errors) => {
  if (typeOf(v) !== 'object') return void errors.push(`${at}: 객체여야 함 (${typeOf(v)})`);
  const tag = /** @type {Record<string, unknown>} */ (v)[field];
  const variant = typeof tag === 'string' ? variants[tag] : undefined;
  if (!variant) return void errors.push(`${at}.${field}: ${Object.keys(variants).join(', ')} 중 하나여야 함`);
  variant(v, at, errors);
};

/**
 * @param {Validator} validator
 * @param {unknown} value
 * @returns {string[]}
 */
export function validate(validator, value) {
  /** @type {string[]} */
  const errors = [];
  validator(value, '$', errors);
  return errors;
}

/**
 * @param {Validator} validator
 * @param {unknown} value
 * @param {string} label what is being validated (file name or document kind)
 */
export function assertValid(validator, value, label) {
  const errors = validate(validator, value);
  if (errors.length) {
    throw new HeirloomError('E_INPUT', `${label} 형식 오류:\n${errors.map((e) => `- ${e}`).join('\n')}`, {
      details: { errors },
    });
  }
}

// ---------------------------------------------------------------- primitives

export const PATTERNS = Object.freeze({
  repoId: /^r-[0-9a-hjkmnp-tv-z]{10}$/,
  worktreeId: /^w-[0-9a-hjkmnp-tv-z]{10}$/,
  taskId: /^t-\d{8}-[0-9a-hjkmnp-tv-z]{8}$/,
  approvalId: /^ap-[0-9a-hjkmnp-tv-z]{12}$/,
  recordId: /^[da]-[0-9a-hjkmnp-tv-z]{8}$/,
  sha256: /^[0-9a-f]{64}$/,
  stateHash: /^sha256:[0-9a-f]{64}$/,
  commit: /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/,
  timestamp: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/,
});

const v1 = oneOf(1);
const text = str();
const nonEmpty = str({ nonEmpty: true });
const timestamp = str({ pattern: PATTERNS.timestamp });
const sha256 = str({ pattern: PATTERNS.sha256 });
const stateHash = str({ pattern: PATTERNS.stateHash });
const recordId = str({ pattern: PATTERNS.recordId });
const taskId = str({ pattern: PATTERNS.taskId });
const approvalId = str({ pattern: PATTERNS.approvalId });

/** Repository-relative code path or glob: no Markdown, not absolute, no `..`. */
export const codePath = str({
  nonEmpty: true,
  check: (p) => {
    if (isMarkdownCodePath(p)) return '마크다운 문서는 연관 코드 경로에 넣을 수 없음. 문서는 sources로 연결한다';
    if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) return '저장소 기준 상대경로여야 함';
    if (p.split(/[\\/]/).includes('..')) return '`..`을 포함할 수 없음';
    return null;
  },
});

/** @type {Validator} */
const lineRange = (v, at, errors) => {
  arrayOf(int({ min: 1 }), { min: 2, max: 2 })(v, at, errors);
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] > v[1]) {
    errors.push(`${at}: 시작 줄이 끝 줄보다 클 수 없음`);
  }
};

const draftSource = object({ ref: nonEmpty }, { optional: { lines: lineRange, quote: text, sha256 } });
const recordSource = object({ ref: nonEmpty, sha256 }, { optional: { lines: lineRange, quote: text } });

// ---------------------------------------------------------------- records (5.1)

const recordApproval = object({ id: approvalId, signer: nonEmpty, approvedAt: timestamp });

export const recordMetaSchema = object(
  {
    schemaVersion: v1,
    id: recordId,
    kind: oneOf('decision', 'axiom'),
    title: nonEmpty,
    active: bool,
    codePaths: arrayOf(codePath),
    topics: arrayOf(nonEmpty),
    supersedes: arrayOf(object({ id: recordId, reason: nonEmpty })),
    supersededBy: nullable(recordId),
    relations: arrayOf(object({ type: oneOf('exception', 'coexist'), id: recordId }, { optional: { condition: text } })),
    sources: arrayOf(recordSource),
    taskId,
    approval: recordApproval,
  },
  {
    optional: {
      deprecation: object({ reason: nonEmpty, taskId, approval: recordApproval }),
      revisions: arrayOf(object({ approval: recordApproval, replacedBy: approvalId, taskId, reason: nonEmpty })),
    },
    check: (o) => {
      const prefix = o.kind === 'axiom' ? 'a-' : 'd-';
      return typeof o.id === 'string' && typeof o.kind === 'string' && !o.id.startsWith(prefix)
        ? [`id는 ${o.kind}이므로 "${prefix}"로 시작해야 함 ($.id)`]
        : [];
    },
  },
);

// ---------------------------------------------------------------- input (5.2)

const fileStatus = oneOf('A', 'M', 'D');

export const inputSchema = object({
  schemaVersion: v1,
  taskId,
  repo: object({ id: str({ pattern: PATTERNS.repoId }), root: nonEmpty, remote: nullable(nonEmpty) }),
  worktree: object({ id: str({ pattern: PATTERNS.worktreeId }), path: nonEmpty }),
  branch: nullable(nonEmpty),
  base: object({ ref: nonEmpty, mergeBase: str({ pattern: PATTERNS.commit }) }),
  sdlcTaskRef: nullable(nonEmpty),
  trigger: oneOf('auto', 'manual'),
  source: object({
    hash: stateHash,
    files: arrayOf(object({ path: nonEmpty, status: fileStatus, sha256: str({ pattern: /^([0-9a-f]{64}|deleted)$/ }) })),
  }),
  materials: arrayOf(
    object(
      { role: oneOf('spec', 'design', 'plan', 'review', 'verification', 'other'), ref: nonEmpty, sha256: nullable(sha256) },
      { optional: { reviewedSourceHash: nullable(stateHash) } },
    ),
  ),
  unknowns: arrayOf(nonEmpty),
  projectRules: object({ prTemplates: arrayOf(nonEmpty), commitGuides: arrayOf(nonEmpty) }),
  createdAt: timestamp,
});

// ---------------------------------------------------------------- draft (5.3)

const decisionBody = object({ problem: nonEmpty, choice: nonEmpty, alternatives: text, scope: text });
const axiomBody = object({ property: nonEmpty, scope: text, exceptions: text, checks: text });

const addOp = object(
  {
    op: oneOf('add'),
    kind: oneOf('decision', 'axiom'),
    title: nonEmpty,
    body: object({}, { extra: true }),
    codePaths: arrayOf(codePath),
    topics: arrayOf(nonEmpty),
    sources: arrayOf(draftSource, { min: 1 }),
  },
  {
    optional: {
      id: recordId,
      relations: arrayOf(object({ type: oneOf('exception', 'coexist'), id: recordId }, { optional: { condition: text } })),
    },
    check: (o) => {
      /** @type {string[]} */
      const errors = [];
      (o.kind === 'axiom' ? axiomBody : decisionBody)(o.body, '$.body', errors);
      return errors;
    },
  },
);

const updateOp = object(
  { op: oneOf('update'), target: recordId, reason: nonEmpty, sources: arrayOf(draftSource) },
  { optional: { title: nonEmpty, body: object({}, { extra: true }), codePaths: arrayOf(codePath), topics: arrayOf(nonEmpty) } },
);

export const draftSchema = object({
  schemaVersion: v1,
  taskId,
  inputSourceHash: stateHash,
  summary: arrayOf(object({ text: nonEmpty, codePaths: arrayOf(codePath) })),
  records: arrayOf(
    tagged('op', {
      add: addOp,
      update: updateOp,
      supersede: object({ op: oneOf('supersede'), target: recordId, reason: nonEmpty, with: int({ min: 0 }) }),
      deprecate: object({ op: oneOf('deprecate'), target: recordId, reason: nonEmpty, sources: arrayOf(draftSource) }),
    }),
  ),
  missing: arrayOf(nonEmpty),
  conflicts: arrayOf(object({ refs: arrayOf(nonEmpty, { min: 2 }), note: nonEmpty })),
  notes: text,
});

// ---------------------------------------------------------------- approval (5.5)

export const approvalSchema = object({
  schemaVersion: v1,
  id: approvalId,
  taskId,
  kind: oneOf('full', 'quick'),
  target: object({ sourceHash: stateHash, materials: recordOf(nullable(sha256)), draftSha256: sha256 }),
  summary: object({ initial: arrayOf(nonEmpty), final: arrayOf(nonEmpty, { min: 1 }) }),
  items: arrayOf(
    object(
      { index: int({ min: 0 }), decision: oneOf('approved', 'rejected', 'pending') },
      { optional: { edited: object({}, { extra: true }) } },
    ),
  ),
  approver: object({ fingerprint: nonEmpty, gitUser: nullable(nonEmpty) }),
  approvedAt: timestamp,
  signature: str({ pattern: /^[A-Za-z0-9+/]+={0,2}$/ }),
});

// ---------------------------------------------------------------- events (5.6)

export const EVENT_TYPES = /** @type {const} */ ([
  'prepared',
  'draft_checked',
  'awaiting_approval',
  'dashboard_opened',
  'approved',
  'approval_received',
  'records_written',
  'pr_created',
  'failed',
  'stale',
  'discarded',
  'expired',
]);

export const eventSchema = object({ at: timestamp, type: oneOf(...EVENT_TYPES) }, { extra: true });

// ---------------------------------------------------------------- index (5.7)

export const indexSchema = object({
  schemaVersion: v1,
  worktrees: recordOf(object({ repoId: str({ pattern: PATTERNS.repoId }), path: nonEmpty, lastSeen: timestamp })),
  tasks: recordOf(taskId),
  reminders: recordOf(object({ sourceHash: stateHash, at: timestamp })),
  lastFetch: recordOf(timestamp),
});

// ---------------------------------------------------------------- config (5.8)

export const projectConfigSchema = object(
  { schemaVersion: v1 },
  {
    optional: {
      baseBranch: nonEmpty,
      specGlobs: arrayOf(nonEmpty),
      recall: object({}, { optional: { maxRecords: int({ min: 1 }), maxTokens: int({ min: 1 }) } }),
      sessionIndex: object({}, { optional: { maxDecisions: int({ min: 0 }) } }),
    },
  },
);

export const userConfigSchema = object(
  { schemaVersion: v1 },
  { optional: { dashboard: object({}, { optional: { idleMinutes: int({ min: 1 }), openBrowser: bool, staleDays: int({ min: 1 }), port: int({ min: 1024, max: 65535 }) } }) } },
);
