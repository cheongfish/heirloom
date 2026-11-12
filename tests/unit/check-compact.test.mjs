import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../evals/acceptance/check-compact.mjs', import.meta.url));
const PREPARE = 'node /x/skills/prepare-handoff/scripts/prepare.mjs --spec docs/s.md';

/** @param {string} id @param {string} command */
const bashCall = (id, command) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
/** @param {string} id @param {string} content @param {boolean} [isError] */
const result = (id, content, isError = false) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});

/** @param {object[]} entries */
function run(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'check-compact-'));
  try {
    const file = join(dir, 't.jsonl');
    writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return execFileSync(process.execPath, [script, file], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('check-compact: permission-denied prepare.mjs calls are not counted as runs', () => {
  const out = run([
    bashCall('t1', `${PREPARE}; echo "exit=$?"`),
    result('t1', 'This Bash command contains multiple operations. The following part requires approval: echo "exit=$?"', true),
    bashCall('t2', PREPARE),
    result('t2', '{"ok":true,"data":{}}'),
  ]);
  assert.match(out, /prepare\.mjs 실행 횟수: 1/);
  assert.match(out, /권한 거부로 제외: 1/);
  assert.match(out, /handoff-denied/);
});

test('check-compact: a prepare.mjs run that exits with an error still counts', () => {
  const out = run([bashCall('t1', PREPARE), result('t1', 'Exit code 2\n{"ok":false,"error":{}}', true)]);
  assert.match(out, /prepare\.mjs 실행 횟수: 1/);
  assert.doesNotMatch(out, /권한 거부로 제외/);
});
