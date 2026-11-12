// Atomic writes, mkdir-based locks and JSON/JSONL helpers.
// See docs/HEIRLOOM-MVP-PLAN.md section 3.2.

import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { ensureDir } from './paths.mjs';

/**
 * @typedef {object} WriteOptions
 * @property {number} [mode] file mode (default 0o600)
 * @property {number} [dirMode] mode for a created parent directory (default 0o700)
 */

/**
 * Write via a temp file in the same directory followed by rename.
 * @param {string} file
 * @param {string | Uint8Array} data
 * @param {WriteOptions} [options]
 */
export async function writeFileAtomic(file, data, options = {}) {
  const { mode = 0o600, dirMode = 0o700 } = options;
  await ensureDir(path.dirname(file), dirMode);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, data, { mode });
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/**
 * @param {string} file
 * @param {unknown} value
 * @param {WriteOptions} [options]
 */
export async function writeJsonAtomic(file, value, options) {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * @param {string} file
 * @returns {Promise<unknown>} parsed JSON, or undefined when the file does not exist
 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return undefined;
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new HeirloomError('E_INPUT', `JSON 형식이 올바르지 않음: ${file}`, { cause: err });
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` while holding `<target>.lock/`. A lock older than `staleMs` is treated as abandoned.
 * @template T
 * @param {string} target
 * @param {() => Promise<T>} fn
 * @param {{ staleMs?: number, timeoutMs?: number, retryMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withLock(target, fn, options = {}) {
  const { staleMs = 30_000, timeoutMs = 10_000, retryMs = 25 } = options;
  const lockDir = `${target}.lock`;
  await ensureDir(path.dirname(target));
  const started = Date.now();
  for (;;) {
    try {
      await mkdir(lockDir);
      break;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
    }
    try {
      const { mtimeMs } = await stat(lockDir);
      if (Date.now() - mtimeMs > staleMs) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
    } catch {
      continue; // released between mkdir and stat
    }
    if (Date.now() - started > timeoutMs) {
      throw new HeirloomError('E_TRANSIENT', `잠금을 얻지 못함: ${lockDir}`, {
        hint: '다른 Heirloom 프로세스가 끝난 뒤 다시 시도한다. 프로세스가 없는데 남아 있다면 잠금 디렉터리를 지운다.',
      });
    }
    await sleep(retryMs);
  }
  try {
    return await fn();
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}

/**
 * Append one JSON line without locking. Callers that read-validate-append must hold the lock.
 * @param {string} file
 * @param {unknown} value
 */
export async function appendJsonLine(file, value) {
  await ensureDir(path.dirname(file));
  await appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

/**
 * @param {string} file
 * @param {unknown} value
 */
export async function appendJsonl(file, value) {
  await withLock(file, () => appendJsonLine(file, value));
}

/**
 * Read a JSONL file. A malformed final line (torn write) is ignored; a malformed line
 * anywhere else is an error.
 * @param {string} file
 * @returns {Promise<unknown[]>}
 */
export async function readJsonl(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  const lines = text.split('\n');
  /** @type {unknown[]} */
  const values = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line));
    } catch (err) {
      const isLast = lines.slice(i + 1).every((rest) => !rest.trim());
      if (isLast) break;
      throw new HeirloomError('E_INPUT', `JSONL ${i + 1}번째 줄이 올바르지 않음: ${file}`, { cause: err });
    }
  }
  return values;
}
