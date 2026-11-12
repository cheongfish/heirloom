// Canonical JSON (sorted keys, no whitespace) and digests used for signing and for
// detecting stale dashboard screens.

import { createHash } from 'node:crypto';

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const obj = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** @param {string | Uint8Array} data */
export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

/**
 * Digest of a draft as the dashboard shows it. An approval names the digest it was given,
 * so an approval made on a stale screen is rejected (PLAN 13.3).
 * @param {unknown} draft
 */
export const draftDigest = (draft) => sha256Hex(canonicalJson(draft));
