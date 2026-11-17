// Hand-written validators for Heirloom's data formats (records, input, draft, judgment,
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

// Records from before 0.4 (decisions and axioms): no longer written, still read as past
// records.

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

// ---------------------------------------------------------------- decision records 2

/** A decision record id (`d-…`). Axioms belong to the records before 0.4. */
const decisionId = str({ pattern: /^d-[0-9a-hjkmnp-tv-z]{8}$/ });

/**
 * Where the code holds a decision now: a symbol in a file, or a test that locks it (by the
 * name the test results report). The file is a repository file, never a glob or Markdown.
 * @type {Validator}
 */
export const decisionAnchor = object(
  { file: codePath },
  {
    optional: { symbol: nonEmpty, test: nonEmpty },
    check: (o) => {
      const problems = [];
      if (('symbol' in o) === ('test' in o)) problems.push('symbol과 test 중 정확히 하나를 쓴다');
      if (typeof o.file === 'string' && /[*?[{]/.test(o.file)) problems.push('file은 glob이 아닌 파일 하나여야 함');
      return problems;
    },
  },
);

/**
 * Anchors of a decision: at least one, and at least one test that locks it.
 * @type {Validator}
 */
const anchorList = (v, at, errors) => {
  arrayOf(decisionAnchor, { min: 1 })(v, at, errors);
  if (Array.isArray(v) && v.length && !v.some((a) => typeof a === 'object' && a !== null && 'test' in a)) {
    errors.push(`${at}: 결정을 잠그는 테스트 앵커({ file, test })가 하나 이상 필요함. 없으면 그 테스트를 먼저 쓴다`);
  }
};

/** What the agent proposes to keep when the person answers a fork question. */
export const decisionProposal = object({ scope: arrayOf(codePath, { min: 1 }), anchors: anchorList }, { optional: { replaces: decisionId } });

/** The narrow decision record since 0.4. */
export const decisionSchema = object({
  schemaVersion: oneOf(2),
  id: decisionId,
  kind: oneOf('decision'),
  choice: nonEmpty,
  question: nonEmpty,
  scope: arrayOf(codePath, { min: 1 }),
  anchors: anchorList,
  source: arrayOf(
    tagged('kind', {
      'fork-answer': object({ kind: oneOf('fork-answer'), approval: approvalId, question: str({ pattern: /^[a-z][a-z0-9-]{0,31}$/ }) }),
      discussion: object({ kind: oneOf('discussion'), approval: approvalId, url: nonEmpty, quote: nonEmpty, author: nullable(nonEmpty) }),
    }),
    { min: 1 },
  ),
  replaces: nullable(decisionId),
  taskId,
  approval: recordApproval,
});

// ---------------------------------------------------------------- input (5.2)

const fileStatus = oneOf('A', 'M', 'D');

/** `input.recheck` after a judgment: the probes run again and unchanged outputs keep their verdict. */
const probeRecheckSchema = object({
  kind: oneOf('probes'),
  basedOn: approvalId,
  mergeBaseChanged: bool,
  changes: arrayOf(object({ path: nonEmpty, reason: oneOf('edited', 'base_updated', 'added', 'removed') })),
  unlinked: arrayOf(nonEmpty),
});

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
}, {
  optional: {
    // Recheck after a judgment.
    recheck: probeRecheckSchema,
  },
});

// ---------------------------------------------------------------- draft v2

/** Probe and question ids: lower case, digits and hyphens. */
export const SHORT_ID = /^[a-z][a-z0-9-]{0,31}$/;
const shortId = str({ pattern: SHORT_ID });
/** A spec line range or a conversation message the question rests on. */
const questionSources = arrayOf(draftSource);

/**
 * The draft of the agent since 0.4: what the change does, backed by probe runs, and the
 * questions the human answers before seeing the observed results.
 */
export const draftV2Schema = object(
  {
    schemaVersion: oneOf(2),
    taskId,
    inputSourceHash: stateHash,
    probeSetHash: stateHash,
    behaviorDiffs: arrayOf(object({ text: nonEmpty, probes: arrayOf(shortId, { min: 1 }), codePaths: arrayOf(codePath) })),
    questions: arrayOf(
      tagged('kind', {
        predict: object(
          { id: shortId, kind: oneOf('predict'), probe: shortId, prompt: nonEmpty, answerType: oneOf('number', 'text', 'choice') },
          {
            optional: { choices: arrayOf(nonEmpty, { min: 2 }), sources: questionSources },
            check: (o) => (o.answerType === 'choice') === Array.isArray(o.choices) ? [] : ['answerType이 choice일 때만, 그리고 반드시 choices를 쓴다'],
          },
        ),
        'test-lock': object(
          { id: shortId, kind: oneOf('test-lock'), test: nonEmpty, plain: nonEmpty, prompt: nonEmpty },
          { optional: { sources: questionSources } },
        ),
        intent: object({ id: shortId, kind: oneOf('intent'), probe: shortId, sources: arrayOf(draftSource, { min: 1 }), prompt: nonEmpty }),
        fork: object(
          { id: shortId, kind: oneOf('fork'), probes: arrayOf(shortId, { min: 1 }), codePaths: arrayOf(codePath, { min: 1 }), prompt: nonEmpty, whyOpen: nonEmpty },
          // `decision`: what to keep if the person keeps the answer in the repository;
          // `retires`: a decision record this question asks whether it still holds.
          { optional: { sources: questionSources, decision: decisionProposal, retires: decisionId } },
        ),
      }),
    ),
    inferences: arrayOf(object({ text: nonEmpty, reason: nonEmpty })),
    notes: text,
  },
  {
    optional: {
      // Decisions settled in a PR or issue discussion, for the person to confirm.
      // `fetched` is filled by the check: who wrote the comment and a hash of its text.
      discussions: arrayOf(
        object(
          { id: shortId, url: nonEmpty, quote: nonEmpty, choice: nonEmpty, scope: arrayOf(codePath, { min: 1 }), anchors: anchorList },
          { optional: { replaces: decisionId, fetched: object({ author: nullable(nonEmpty), bodySha256: sha256 }) } },
        ),
      ),
    },
  },
);

// ---------------------------------------------------------------- judgment

/** What the person concluded about one question. */
export const VERDICTS = /** @type {const} */ (['as-expected', 'my-misunderstanding', 'answered', 'revert', 'split']);
/** Verdicts that accept the behavior; the others send the work back. */
export const ACCEPTING = new Set(['as-expected', 'my-misunderstanding', 'answered']);

const probeHash = object({ base: sha256, head: sha256 });

/**
 * What the spec becomes when a question citing it is sent back, with the cited
 * parts as they were, so the next handoff can tell whether they changed.
 */
const specChoice = object({
  choice: oneOf('spec-wrong', 'defer', 'snapshot'),
  parts: arrayOf(
    object({ ref: nonEmpty, block: nullable(str()), fileSha256: sha256 }, { optional: { lines: lineRange, quote: text } }),
    { min: 1 },
  ),
});

/** The spec's lifetime once every question is accepted. */
const specAfterMerge = object(
  { action: oneOf('delete', 'archive', 'keep'), specs: arrayOf(nonEmpty, { min: 1 }) },
  { optional: { owner: nonEmpty }, check: (o) => (o.action === 'keep') === (typeof o.owner === 'string') ? [] : ['owner는 keep일 때만, 그리고 반드시 쓴다'] },
);

/**
 * The signed judgment of a schema 2 draft, kept where approvals are kept. One item per
 * question: the person's prediction or answer, what was revealed and the verdict.
 */
export const judgmentSchema = object({
  schemaVersion: oneOf(2),
  id: approvalId,
  taskId,
  kind: oneOf('judgment'),
  target: object({ sourceHash: stateHash, headSha: nullable(str({ pattern: PATTERNS.commit })), draftSha256: sha256, probeSetHash: stateHash, materials: recordOf(nullable(sha256)) }),
  behaviorDiffs: object({ initial: arrayOf(nonEmpty), final: arrayOf(nonEmpty) }),
  items: arrayOf(
    object(
      {
        id: str({ pattern: SHORT_ID }),
        kind: oneOf('predict', 'test-lock', 'intent', 'fork'),
        prompt: nonEmpty,
        answer: nullable(text),
        correct: nullable(bool),
        revealed: object({}, { extra: true }),
        probeHashes: recordOf(probeHash),
        verdict: oneOf(...VERDICTS),
      },
      { optional: { reason: nonEmpty, carried: bool, spec: specChoice, keep: object({ action: oneOf('record', 'retire'), id: decisionId }) } },
    ),
  ),
  outcome: oneOf('accepted', 'returned'),
  predictedAt: timestamp,
  judgedAt: timestamp,
  approver: object({ fingerprint: nonEmpty, gitUser: nullable(nonEmpty) }),
  signature: nonEmpty,
}, { optional: { basedOn: approvalId, specAfterMerge, discussions: arrayOf(object({ id: str({ pattern: SHORT_ID }), confirmed: bool }, { optional: { recordId: decisionId } })) } });

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
  'returned',
  // Written by the context curation removed in 0.4; kept so older task logs still read.
  'agent_started',
  'agent_finished',
]);

export const eventSchema = object({ at: timestamp, type: oneOf(...EVENT_TYPES) }, { extra: true });

// ---------------------------------------------------------------- index (5.7)

export const indexSchema = object({
  schemaVersion: v1,
  // `managed` marked worktrees of the context curation removed in 0.4; kept so older indexes still read.
  worktrees: recordOf(object({ repoId: str({ pattern: PATTERNS.repoId }), path: nonEmpty, lastSeen: timestamp }, { optional: { managed: bool, host: oneOf('claude-code', 'codex', 'antigravity'), hostAt: timestamp } })),
  tasks: recordOf(taskId),
  reminders: recordOf(object({ sourceHash: stateHash, at: timestamp })),
  lastFetch: recordOf(timestamp),
});

// ---------------------------------------------------------------- probes

/** A command as an argument vector. It runs without a shell. */
const argv = arrayOf(nonEmpty, { min: 1 });

/** Test output formats Heirloom reads to tell which tests changed between base and head. */
export const TEST_PARSERS = /** @type {const} */ (['node-tap', 'pytest', 'jest-json', 'exit-code']);

/** The probes file the agent writes: commands that show what this change does. */
export const probeSpecSchema = object(
  {
    probes: arrayOf(
      object(
        { id: shortId, title: nonEmpty, run: argv },
        { optional: { timeoutSeconds: int({ min: 1, max: 600 }) } },
      ),
    ),
  },
  {
    optional: {
      setup: arrayOf(argv),
      tests: object({ command: argv, parser: oneOf(...TEST_PARSERS) }, { optional: { timeoutSeconds: int({ min: 1, max: 3600 }) } }),
    },
  },
);

// ---------------------------------------------------------------- config (5.8)

export const projectConfigSchema = object(
  { schemaVersion: v1 },
  {
    optional: {
      baseBranch: nonEmpty,
      specGlobs: arrayOf(nonEmpty),
      recall: object({}, { optional: { maxRecords: int({ min: 1 }), maxTokens: int({ min: 1 }) } }),
      // `sessionIndex` and `curation` are accepted for configs written before 0.4 and ignored.
      sessionIndex: object({}, { optional: { maxDecisions: int({ min: 0 }) } }),
      curation: object({}, { optional: { minUnreviewed: int({ min: 1 }), maxAgeDays: int({ min: 1 }), minForAge: int({ min: 1 }), batchSize: int({ min: 1 }) } }),
      testCadence: object({}, { optional: { mode: oneOf('off', 'phase') } }),
      spec: object({}, { optional: { afterMerge: oneOf('delete', 'archive', 'keep') } }),
      probe: object({}, {
        optional: {
          setup: arrayOf(argv),
          maxProbes: int({ min: 1, max: 50 }),
          setupTimeoutSeconds: int({ min: 1, max: 3600 }),
          testTimeoutSeconds: int({ min: 1, max: 3600 }),
        },
      }),
    },
  },
);

export const userConfigSchema = object(
  { schemaVersion: v1 },
  {
    optional: {
      dashboard: object({}, { optional: { idleMinutes: int({ min: 1 }), openBrowser: bool, staleDays: int({ min: 1 }), port: int({ min: 1024, max: 65535 }) } }),
      // Accepted for configs written before 0.4 and ignored: the context curation was removed.
      curation: object({}, { optional: { agent: object({}, { optional: { host: oneOf('claude-code', 'codex', 'antigravity'), command: nonEmpty, model: nullable(nonEmpty) } }) } }),
    },
  },
);
