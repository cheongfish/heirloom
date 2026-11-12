// Hook stdin/stdout helpers.

/**
 * Read the hook input JSON from stdin. Returns {} for a TTY, empty or invalid input,
 * or when nothing arrives within `timeoutMs`.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStdinJson({ timeoutMs = 1000 } = {}) {
  if (process.stdin.isTTY) return {};
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  await Promise.race([
    new Promise((resolve) => {
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.once('end', resolve);
      process.stdin.once('error', resolve);
    }),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  process.stdin.destroy();
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** @param {unknown} value */
export function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
