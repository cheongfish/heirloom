// The release build: one commit with the plugin directories only, on a new temporary branch
// that starts at the current release. The release branch itself is changed only by the PR
// from that branch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeRepo } from '../helpers/git-fixture.mjs';
import { RELEASE_PATHS, buildRelease } from '../../tools/build-release.mjs';

const FILES = {
  '.claude-plugin/plugin.json': '{}\n',
  '.claude-plugin/marketplace.json': '{}\n',
  'hooks/hooks.json': '{}\n',
  'skills/a/SKILL.md': '# a\n',
  'skills/a/scripts/x.mjs': 'export {};\n',
  'examples/user-config.example.json': '{}\n',
  'tests/unit/a.test.mjs': '',
  'evals/README.md': '',
  'tools/t.mjs': '',
  'docs/guide/en/x.md': '',
  'package.json': '{}\n',
  'CHANGELOG.md': '# 변경 이력\n',
  'AGENTS.md': '',
  'README.md': '',
};

test('the build branch holds only the plugin directories; the working tree, HEAD and release are untouched', async () => {
  const repo = await makeRepo(FILES);
  const head = repo.git('rev-parse', 'HEAD');
  const out = await buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/20261113' });
  assert.equal(out.updated, true);
  assert.equal(out.source, head);
  assert.equal(out.branch, 'release-build/20261113');
  const top = repo.git('ls-tree', '--name-only', 'release-build/20261113').split('\n').sort();
  assert.deepEqual(top, [...RELEASE_PATHS].sort(), 'no CHANGELOG, tests or tools');
  assert.equal(repo.git('show', 'release-build/20261113:skills/a/scripts/x.mjs'), 'export {};');
  assert.equal(repo.git('rev-parse', 'HEAD'), head);
  assert.equal(repo.git('branch', '--show-current'), 'main');
  assert.equal(repo.git('status', '--porcelain'), '');
  assert.equal(repo.git('branch', '--list', 'release'), '', 'no release branch is created');
  assert.match(repo.git('log', '-1', '--format=%B', 'release-build/20261113'), new RegExp(`Source: ${head}`));
});

test('the build starts at the release tip; nothing to release creates no branch', async () => {
  const repo = await makeRepo(FILES);
  const first = await buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/1' });
  // The PR is merged with a merge commit: release now points at a commit with that tree.
  repo.git('branch', 'release', String(first.commit));
  repo.git('branch', '-D', 'release-build/1');

  const again = await buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/2' });
  assert.equal(again.updated, false);
  assert.equal(repo.git('branch', '--list', 'release-build/2'), '');

  await repo.write('tests/unit/b.test.mjs', '');
  repo.commitAll('test only');
  assert.equal((await buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/3' })).updated, false, 'tests are not released');

  await repo.write('skills/a/SKILL.md', '# a2\n');
  repo.commitAll('skill change');
  const next = await buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/4' });
  assert.equal(next.updated, true);
  assert.equal(repo.git('rev-parse', 'release-build/4^'), first.commit, 'one commit on top of the release tip');
  assert.equal(repo.git('rev-parse', 'release'), first.commit, 'release itself does not move');
});

test('errors: missing plugin directory, unknown source, existing build branch, no branch name', async () => {
  const bare = await makeRepo({ 'skills/a/SKILL.md': '# a\n' });
  await assert.rejects(buildRelease({ cwd: bare.dir, from: 'main', base: 'release', branch: 'b' }), /\.claude-plugin/);
  await assert.rejects(buildRelease({ cwd: bare.dir, from: 'nope', base: 'release', branch: 'b' }), /nope/);

  const repo = await makeRepo(FILES);
  repo.git('branch', 'release-build/x');
  await assert.rejects(buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: 'release-build/x' }), /이미 있음/);
  await assert.rejects(buildRelease({ cwd: repo.dir, from: 'main', base: 'release', branch: '' }), /브랜치 이름/);
});
