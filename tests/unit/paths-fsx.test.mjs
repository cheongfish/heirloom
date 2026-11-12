import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat, mkdir, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { tempDir } from '../helpers/git-fixture.mjs';
import { heirloomHome, homePaths, taskPaths, repoPaths } from '../../skills/using-heirloom/lib/paths.mjs';
import {
  writeFileAtomic,
  writeJsonAtomic,
  readJson,
  withLock,
  appendJsonl,
  readJsonl,
} from '../../skills/using-heirloom/lib/fsx.mjs';

const posix = process.platform !== 'win32';

test('heirloomHome: HEIRLOOM_HOME overrides ~/.heirloom', () => {
  assert.equal(heirloomHome({}), path.join(os.homedir(), '.heirloom'));
  assert.equal(heirloomHome({ HEIRLOOM_HOME: '/tmp/h' }), path.resolve('/tmp/h'));
});

test('homePaths, taskPaths and repoPaths follow MVP-PLAN section 3', () => {
  const home = homePaths('/h');
  assert.equal(home.index, path.join('/h', 'index.json'));
  assert.equal(home.keys, path.join('/h', 'keys'));
  const task = taskPaths('/h', 't-20261112-3h7k2p9m');
  assert.equal(task.dir, path.join('/h', 'tasks', 't-20261112-3h7k2p9m'));
  assert.equal(task.events, path.join(task.dir, 'events.jsonl'));
  assert.equal(task.approvals, path.join(task.dir, 'approvals'));
  const repo = repoPaths('/r');
  assert.equal(repo.decisions, path.join('/r', '.heirloom', 'decisions'));
  assert.equal(repo.axioms, path.join('/r', '.heirloom', 'axioms'));
});

test('taskPaths rejects ids that are not task ids', () => {
  for (const bad of ['../x', 't-1/../../etc', '', 'd-7k3q9m2x']) {
    assert.throws(() => taskPaths('/h', bad), /작업 ID/);
  }
});

test('writeFileAtomic: writes with 0600 in 0700 dirs and leaves no temp files', async (t) => {
  const dir = await tempDir('fsx');
  const file = path.join(dir, 'a', 'b', 'x.json');
  await writeFileAtomic(file, 'one');
  await writeFileAtomic(file, 'two');
  assert.equal(await readFile(file, 'utf8'), 'two');
  assert.deepEqual(await readdir(path.dirname(file)), ['x.json']);
  if (posix) {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  }
  t.after(() => import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true })));
});

test('writeFileAtomic: repo files can use ordinary permissions', { skip: !posix }, async () => {
  const dir = await tempDir('fsx');
  const file = path.join(dir, 'repo', '.heirloom', 'decisions', 'd.md');
  await writeFileAtomic(file, 'x', { mode: 0o644, dirMode: 0o755 });
  assert.equal((await stat(file)).mode & 0o777, 0o644);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o755);
});

test('readJson: undefined for a missing file, E_INPUT for invalid JSON', async () => {
  const dir = await tempDir('fsx');
  assert.equal(await readJson(path.join(dir, 'missing.json')), undefined);
  await writeJsonAtomic(path.join(dir, 'ok.json'), { a: 1 });
  assert.deepEqual(await readJson(path.join(dir, 'ok.json')), { a: 1 });
  await writeFile(path.join(dir, 'bad.json'), '{');
  await assert.rejects(readJson(path.join(dir, 'bad.json')), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});

test('withLock: serializes concurrent read-modify-write', async () => {
  const dir = await tempDir('lock');
  const file = path.join(dir, 'counter.json');
  await writeJsonAtomic(file, { n: 0 });
  await Promise.all(
    Array.from({ length: 20 }, () =>
      withLock(file, async () => {
        const { n } = /** @type {{n: number}} */ (await readJson(file));
        await new Promise((r) => setTimeout(r, 1));
        await writeJsonAtomic(file, { n: n + 1 });
      }),
    ),
  );
  assert.deepEqual(await readJson(file), { n: 20 });
});

test('withLock: reclaims a stale lock and times out on a live one', async () => {
  const dir = await tempDir('lock');
  const file = path.join(dir, 'x.json');
  await mkdir(`${file}.lock`);
  const old = new Date(Date.now() - 60_000);
  await utimes(`${file}.lock`, old, old);
  assert.equal(await withLock(file, async () => 'got it', { staleMs: 30_000 }), 'got it');

  await mkdir(`${file}.lock`);
  await assert.rejects(
    withLock(file, async () => 'never', { timeoutMs: 100, retryMs: 10 }),
    (err) => /** @type {any} */ (err).code === 'E_TRANSIENT',
  );
});

test('appendJsonl/readJsonl: round trip, torn final line is ignored', async () => {
  const dir = await tempDir('jsonl');
  const file = path.join(dir, 'events.jsonl');
  assert.deepEqual(await readJsonl(file), []);
  await appendJsonl(file, { a: 1 });
  await appendJsonl(file, { b: 2 });
  assert.deepEqual(await readJsonl(file), [{ a: 1 }, { b: 2 }]);
  await writeFile(file, '{"a":1}\n{"b":', { flag: 'w' });
  assert.deepEqual(await readJsonl(file), [{ a: 1 }]);
  await writeFile(file, '{"a":1}\n{"b":\n{"c":3}\n', { flag: 'w' });
  await assert.rejects(readJsonl(file), (err) => /** @type {any} */ (err).code === 'E_INPUT');
});
