// GitHub remote detection (PLAN 16.2: GitHub uses gh; anything else is not supported in the MVP).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGithubRemote, baseBranchName } from '../../skills/using-heirloom/lib/github.mjs';

test('parseGithubRemote accepts github.com over ssh and https', () => {
  const want = { owner: 'acme', repo: 'widgets' };
  assert.deepEqual(parseGithubRemote('git@github.com:acme/widgets.git'), want);
  assert.deepEqual(parseGithubRemote('git@github.com:acme/widgets'), want);
  assert.deepEqual(parseGithubRemote('ssh://git@github.com/acme/widgets.git'), want);
  assert.deepEqual(parseGithubRemote('https://github.com/acme/widgets.git'), want);
  assert.deepEqual(parseGithubRemote('https://user@github.com/acme/widgets'), want);
  assert.deepEqual(parseGithubRemote('https://github.com/acme/widgets/'), want);
});

test('parseGithubRemote rejects other hosts, local paths and malformed URLs', () => {
  for (const url of [
    'git@gitlab.com:acme/widgets.git',
    'https://github.example.com/acme/widgets.git',
    'https://notgithub.com/acme/widgets',
    '/tmp/repo',
    'file:///tmp/repo',
    'https://github.com/acme',
    '',
    null,
  ]) {
    assert.equal(parseGithubRemote(url), null, String(url));
  }
});

test('baseBranchName strips the remote prefix only', () => {
  assert.deepEqual(baseBranchName('origin/main', ['origin']), { remote: 'origin', branch: 'main' });
  assert.deepEqual(baseBranchName('origin/release/1.x', ['origin', 'upstream']), { remote: 'origin', branch: 'release/1.x' });
  assert.deepEqual(baseBranchName('main', ['origin']), { remote: null, branch: 'main' });
  assert.deepEqual(baseBranchName('feature/x', ['origin']), { remote: null, branch: 'feature/x' });
});
