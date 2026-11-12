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
  'AGENTS.md': '',
  'README.md': '',
};

test('release holds only the plugin directories; the working tree and HEAD are untouched', async () => {
  const repo = await makeRepo(FILES);
  const head = repo.git('rev-parse', 'HEAD');
  const out = await buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' });
  assert.equal(out.updated, true);
  assert.equal(out.source, head);
  const top = repo.git('ls-tree', '--name-only', 'release').split('\n').sort();
  assert.deepEqual(top, [...RELEASE_PATHS].sort());
  assert.equal(repo.git('show', 'release:skills/a/scripts/x.mjs'), 'export {};');
  assert.equal(repo.git('rev-parse', 'HEAD'), head);
  assert.equal(repo.git('branch', '--show-current'), 'main');
  assert.equal(repo.git('status', '--porcelain'), '');
  assert.match(repo.git('log', '-1', '--format=%B', 'release'), new RegExp(`Source: ${head}`));
});

test('running again without changes adds no commit; a change adds one on top', async () => {
  const repo = await makeRepo(FILES);
  const first = await buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' });
  const again = await buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' });
  assert.equal(again.updated, false);
  assert.equal(again.commit, first.commit);

  await repo.write('tests/unit/b.test.mjs', '');
  repo.commitAll('test only');
  assert.equal((await buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' })).updated, false, 'tests are not released');

  await repo.write('skills/a/SKILL.md', '# a2\n');
  repo.commitAll('skill change');
  const next = await buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' });
  assert.equal(next.updated, true);
  assert.equal(repo.git('rev-parse', 'release^'), first.commit);
});

test('a missing plugin directory or unknown source is an error', async () => {
  const repo = await makeRepo({ 'skills/a/SKILL.md': '# a\n' });
  await assert.rejects(buildRelease({ cwd: repo.dir, from: 'main', branch: 'release' }), /\.claude-plugin/);
  await assert.rejects(buildRelease({ cwd: repo.dir, from: 'nope', branch: 'release' }), /nope/);
});
