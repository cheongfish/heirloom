// Error classification, exit codes and the single-retry policy.

export const EXIT = Object.freeze({ OK: 0, INTERNAL: 1, INPUT: 2, CONFLICT: 3, VERIFY: 4, TRANSIENT: 75 });

/** @typedef {'E_INPUT' | 'E_CONFLICT' | 'E_VERIFY' | 'E_TRANSIENT' | 'E_INTERNAL'} ErrorCode */

/** @type {Record<ErrorCode, number>} */
const EXIT_BY_CODE = {
  E_INPUT: EXIT.INPUT,
  E_CONFLICT: EXIT.CONFLICT,
  E_VERIFY: EXIT.VERIFY,
  E_TRANSIENT: EXIT.TRANSIENT,
  E_INTERNAL: EXIT.INTERNAL,
};

export class HeirloomError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} message
   * @param {{ hint?: string, cause?: unknown, details?: Record<string, unknown> }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'HeirloomError';
    /** @type {ErrorCode} */
    this.code = code;
    /** @type {string | undefined} */
    this.hint = options.hint;
    /** @type {Record<string, unknown> | undefined} */
    this.details = options.details;
  }

  get retryable() {
    return this.code === 'E_TRANSIENT';
  }

  get exitCode() {
    return EXIT_BY_CODE[this.code];
  }
}

const TRANSIENT_ERRNO = new Set(['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH']);

const TRANSIENT_TEXT = [
  /index\.lock/i,
  /could not resolve host/i,
  /connection (?:reset|timed out|refused)/i,
  /operation timed out/i,
  /\bHTTP 5\d\d\b/,
  /bad gateway|service unavailable|gateway timeout/i,
  /rate limit/i,
];

/**
 * Normalize any thrown value into a HeirloomError.
 * Only errors recognized as transient become E_TRANSIENT; everything unknown is E_INTERNAL.
 * @param {unknown} err
 * @returns {HeirloomError}
 */
export function classifyError(err) {
  if (err instanceof HeirloomError) return err;
  if (err instanceof Error) {
    const errno = /** @type {{ code?: unknown }} */ (err).code;
    const stderr = /** @type {{ stderr?: unknown }} */ (err).stderr;
    const text = `${err.message}\n${typeof stderr === 'string' ? stderr : ''}`;
    if ((typeof errno === 'string' && TRANSIENT_ERRNO.has(errno)) || TRANSIENT_TEXT.some((p) => p.test(text))) {
      return new HeirloomError('E_TRANSIENT', err.message, { cause: err });
    }
    return new HeirloomError('E_INTERNAL', err.message, { cause: err });
  }
  return new HeirloomError('E_INTERNAL', String(err));
}

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying once after `delayMs` only when the failure is transient.
 * At most two attempts in total; nothing is retried unconditionally.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ delayMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const { delayMs = 2000, sleep = defaultSleep } = options;
  try {
    return await fn();
  } catch (first) {
    const classified = classifyError(first);
    if (!classified.retryable) throw classified;
    await sleep(delayMs);
    try {
      return await fn();
    } catch (second) {
      throw classifyError(second);
    }
  }
}

/**
 * @param {unknown} err
 * @returns {{ payload: { ok: false, error: { code: ErrorCode, message: string, retryable: boolean, hint?: string } }, exitCode: number }}
 */
export function toFailure(err) {
  const e = classifyError(err);
  /** @type {{ code: ErrorCode, message: string, retryable: boolean, hint?: string }} */
  const error = { code: e.code, message: e.message, retryable: e.retryable };
  if (e.hint) error.hint = e.hint;
  return { payload: { ok: false, error }, exitCode: e.exitCode };
}

/**
 * Entry point wrapper for skill scripts: prints exactly one JSON object to stdout
 * and sets the exit code. Stack traces of internal errors go to stderr.
 * @param {() => Promise<unknown>} main
 */
export async function runScript(main) {
  try {
    const data = await main();
    process.stdout.write(`${JSON.stringify({ ok: true, data })}\n`);
    process.exitCode = EXIT.OK;
  } catch (err) {
    const { payload, exitCode } = toFailure(err);
    if (payload.error.code === 'E_INTERNAL' && err instanceof Error && err.stack) process.stderr.write(`${err.stack}\n`);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = exitCode;
  }
}
