// Remote provider detection and the glab calls (GitHub through gh, GitLab through glab).
// glab is always the fake one from tests/helpers/fake-glab, never the real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { tempDir } from '../helpers/git-fixture.mjs';
import { parseRemote, remoteProvider } from '../../skills/using-heirloom/lib/remote.mjs';
import { findOpenMr, glabReady, mrState, normalizeMrState, parseMrUrl } from '../../skills/using-heirloom/lib/gitlab.mjs';
import { HeirloomError } from '../../skills/using-heirloom/lib/errors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_GLAB_DIR = path.join(ROOT, 'tests', 'helpers', 'fake-glab');
const PATH0 = process.env.PATH;

/**
 * Point PATH at the fake glab (or at an empty directory: "glab is not installed").
 * @param {object | null} state
 */
async function fakeGlab(state) {
  const dir = await tempDir('glab');
  const log = path.join(dir, 'log.jsonl');
  const file = path.join(dir, 'state.json');
  await writeFile(file, JSON.stringify(state ?? {}));
  process.env.FAKE_GLAB_LOG = log;
  process.env.FAKE_GLAB_STATE = file;
  process.env.PATH = state === null ? await tempDir('noglab') : `${FAKE_GLAB_DIR}${path.delimiter}${PATH0}`;
  return {
    file,
    async calls() {
      try {
        return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
  };
}

test.afterEach(() => {
  process.env.PATH = PATH0;
});

test('parseRemote: ssh, scp-like and https URLs, ports, subgroups, with or without .git', () => {
  const cases = /** @type {const} */ ([
    ['git@github.com:acme/widgets.git', 'github.com', 'acme/widgets'],
    ['git@gitlab.com:group/sub/project', 'gitlab.com', 'group/sub/project'],
    ['ssh://git@gitlab.example.com:2222/group/sub/project.git', 'gitlab.example.com', 'group/sub/project'],
    ['https://gitlab.example.com:8443/group/project.git/', 'gitlab.example.com', 'group/project'],
    ['https://oauth2:token@GitLab.com/Group/Project', 'gitlab.com', 'Group/Project'],
    ['git://github.com/acme/widgets', 'github.com', 'acme/widgets'],
  ]);
  for (const [url, host, repo] of cases) assert.deepEqual(parseRemote(url), { host, path: repo }, url);
});

test('parseRemote: local paths, file URLs and paths without a project are not remotes', () => {
  for (const url of ['/tmp/repo', './repo', 'file:///tmp/repo', 'https://gitlab.com/group', 'git@gitlab.com:', 'C:\\repo', '', null, undefined]) {
    assert.equal(parseRemote(url), null, String(url));
  }
});

test('remoteProvider: github.com and gitlab.com need no glab call', async () => {
  const glab = await fakeGlab({ hosts: [] });
  assert.deepEqual(await remoteProvider({ cwd: ROOT, url: 'git@github.com:acme/widgets.git' }), { provider: 'github', host: 'github.com', repo: 'acme/widgets' });
  assert.deepEqual(await remoteProvider({ cwd: ROOT, url: 'https://gitlab.com/group/sub/project.git' }), { provider: 'gitlab', host: 'gitlab.com', repo: 'group/sub/project' });
  // A GitHub URL with a subgroup-like path is not a GitHub repository.
  assert.equal((await remoteProvider({ cwd: ROOT, url: 'https://github.com/acme/widgets/extra' })).provider, null);
  assert.deepEqual(await glab.calls(), []);
});

test('remoteProvider: a self-hosted host is GitLab only when glab is logged in there', async () => {
  const url = 'ssh://git@git.example.com:2222/group/sub/project.git';
  const glab = await fakeGlab({ hosts: ['git.example.com'] });
  assert.deepEqual(await remoteProvider({ cwd: ROOT, url }), { provider: 'gitlab', host: 'git.example.com', repo: 'group/sub/project' });
  assert.ok((await glab.calls()).some((a) => a[0] === 'auth' && a[1] === 'status' && a.includes('git.example.com')));

  await fakeGlab({ hosts: ['gitlab.com'] });
  assert.deepEqual(await remoteProvider({ cwd: ROOT, url }), { provider: null, host: 'git.example.com', repo: 'group/sub/project' });

  await fakeGlab(null);
  assert.equal((await remoteProvider({ cwd: ROOT, url })).provider, null);
  assert.deepEqual(await remoteProvider({ cwd: ROOT, url: '/tmp/repo' }), { provider: null, host: null, repo: null });
});

test('glabReady: missing, unauthenticated, ready', async () => {
  await fakeGlab(null);
  assert.deepEqual(await glabReady({ cwd: ROOT, host: 'gitlab.com' }), { ok: false, reason: 'glab_missing' });
  await fakeGlab({ hosts: [] });
  assert.deepEqual(await glabReady({ cwd: ROOT, host: 'gitlab.com' }), { ok: false, reason: 'glab_unauthenticated' });
  await fakeGlab({ hosts: ['gitlab.com'] });
  assert.deepEqual(await glabReady({ cwd: ROOT, host: 'gitlab.com' }), { ok: true });
});

test('parseMrUrl accepts GitLab merge request URLs only', () => {
  assert.deepEqual(parseMrUrl('https://gitlab.com/group/sub/project/-/merge_requests/12'), { host: 'gitlab.com', repo: 'group/sub/project', iid: 12 });
  assert.deepEqual(parseMrUrl('https://git.example.com:8443/g/p/-/merge_requests/3'), { host: 'git.example.com:8443', repo: 'g/p', iid: 3 });
  for (const url of [
    'https://github.com/acme/widgets/pull/7',
    'https://gitlab.com/group/project/merge_requests/1',
    'https://gitlab.com/project/-/merge_requests/1',
    'http://gitlab.com/group/project/-/merge_requests/1',
    'https://gitlab.com/group/project/-/merge_requests/1/diffs',
    'https://gitlab.com/group/project/-/merge_requests/x',
  ]) {
    assert.equal(parseMrUrl(url), null, url);
  }
});

test('normalizeMrState maps GitLab states; locked counts as open', () => {
  assert.equal(normalizeMrState('opened'), 'OPEN');
  assert.equal(normalizeMrState('locked'), 'OPEN');
  assert.equal(normalizeMrState('closed'), 'CLOSED');
  assert.equal(normalizeMrState('merged'), 'MERGED');
  assert.throws(() => normalizeMrState('reopened'), (/** @type {any} */ e) => e instanceof HeirloomError && e.code === 'E_INTERNAL');
});

test('findOpenMr and mrState go through the GitLab API of the right host and project', async () => {
  const mr = { iid: 4, web_url: 'https://git.example.com/group/sub/project/-/merge_requests/4', state: 'opened', source_branch: 'feat', target_branch: 'main', project: 'group/sub/project' };
  const glab = await fakeGlab({ hosts: ['git.example.com'], mrs: [mr, { ...mr, iid: 5, source_branch: 'other' }] });

  assert.deepEqual(await findOpenMr({ cwd: ROOT, host: 'git.example.com', repo: 'group/sub/project', head: 'feat' }), { iid: 4, url: mr.web_url, base: 'main' });
  assert.equal(await findOpenMr({ cwd: ROOT, host: 'git.example.com', repo: 'group/sub/project', head: 'none' }), null);
  const list = (await glab.calls()).find((a) => a[0] === 'api');
  assert.ok(list?.includes('git.example.com'));
  assert.ok(list?.some((/** @type {string} */ a) => a.startsWith('projects/group%2Fsub%2Fproject/merge_requests?')));

  assert.equal(await mrState({ cwd: ROOT, url: mr.web_url }), 'OPEN');
  await writeFile(glab.file, JSON.stringify({ mrs: [{ ...mr, state: 'merged' }] }));
  assert.equal(await mrState({ cwd: ROOT, url: mr.web_url }), 'MERGED');
  await rejectsCode(mrState({ cwd: ROOT, url: 'https://github.com/acme/widgets/pull/1' }), 'E_INPUT');

  await fakeGlab(null);
  await rejectsCode(mrState({ cwd: ROOT, url: mr.web_url }), 'E_INPUT');
});

/** @param {Promise<unknown>} p @param {string} code */
const rejectsCode = (p, code) => assert.rejects(p, (/** @type {any} */ e) => e instanceof HeirloomError && e.code === code);
