#!/usr/bin/env node
// Development tool: build what users install (the `release` branch) from a source commit
// (default `main`). The release tree holds only the plugin directories below; tests, evals,
// tools, CHANGELOG.md and development files stay on main.
//
//   node tools/build-release.mjs --branch release-build/<YYYYMMDD> [--from main] [--base origin/release]
//
// The release branch is changed only through a pull request: this tool puts one build commit,
// on top of the current release tip (`--base`), on a new temporary branch (`--branch`), which
// the agent pushes and opens as a PR into `release`. After the merge the temporary branch is
// deleted locally and on the remote (see AGENTS.md).
//
// Uses git plumbing only: the working tree, the index and HEAD are never touched. When the
// released files did not change, it creates nothing.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Top-level paths copied into the release tree. */
export const RELEASE_PATHS = Object.freeze(['.claude-plugin', '.codex-plugin', '.antigravity-plugin', 'hooks', 'hooks.json', 'rules', 'skills', 'examples']);

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {string} [input]
 */
function git(cwd, args, input) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/** @param {string} cwd @param {string} ref */
function tryRev(cwd, ref) {
  try {
    return git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

/**
 * @param {{ cwd: string, branch: string, from?: string, base?: string }} options
 *   `branch`: the temporary branch to create; `base`: the current release tip (missing for the first release)
 * @returns {Promise<{ branch: string, base: string | null, source: string, commit: string | null, tree: string, updated: boolean }>}
 */
export async function buildRelease({ cwd, branch, from = 'main', base = 'origin/release' }) {
  if (!branch) throw new Error('임시 브랜치 이름이 필요함 (--branch release-build/<YYYYMMDD>)');
  if (tryRev(cwd, `refs/heads/${branch}`)) throw new Error(`브랜치가 이미 있음: ${branch}`);
  const source = tryRev(cwd, from);
  if (!source) throw new Error(`소스 커밋을 찾지 못함: ${from}`);

  const entries = [];
  for (const p of RELEASE_PATHS) {
    const line = git(cwd, ['ls-tree', source, '--', p]);
    if (!line) throw new Error(`${from}에 ${p}가 없음`);
    entries.push(line);
  }
  const tree = git(cwd, ['mktree'], `${entries.join('\n')}\n`);

  const parent = tryRev(cwd, base);
  if (parent && git(cwd, ['rev-parse', `${parent}^{tree}`]) === tree) {
    return { branch, base: parent, source, commit: null, tree, updated: false };
  }
  const subject = `release: ${from} ${source.slice(0, 7)}`;
  const commit = git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', subject, '-m', `Source: ${source}`]);
  // Create only: fail if the branch appeared meanwhile.
  git(cwd, ['update-ref', `refs/heads/${branch}`, commit, '']);
  return { branch, base: parent, source, commit, tree, updated: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { from: { type: 'string' }, base: { type: 'string' }, branch: { type: 'string' } } });
  try {
    const out = await buildRelease({ cwd: process.cwd(), branch: values.branch ?? '', from: values.from, base: values.base });
    console.log(JSON.stringify(out));
    if (out.updated) console.error(`${out.branch}에 빌드 커밋 ${String(out.commit).slice(0, 7)}을 만듦. 올리고 PR을 연다: git push -u origin ${out.branch}`);
    else console.error('release에 바뀐 내용이 없음. 브랜치를 만들지 않음');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
