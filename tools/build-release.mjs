#!/usr/bin/env node
// Development tool: update the `release` branch, which is what users install, from a source
// commit (default `main`). The release tree holds only the plugin directories below; tests,
// evals, tools and development files stay on main (MVP-PLAN 2절 '브랜치와 CI').
//
//   node tools/build-release.mjs [--from main] [--branch release]
//
// Uses git plumbing only: the working tree, the index and HEAD are never touched. Each run
// adds one commit on top of the previous release commit, or nothing when the released
// files did not change. It does not push; run `git push origin release` afterwards.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Top-level paths copied into the release tree. */
export const RELEASE_PATHS = Object.freeze(['.claude-plugin', 'hooks', 'skills', 'examples']);

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
 * @param {{ cwd: string, from?: string, branch?: string }} options
 * @returns {Promise<{ branch: string, source: string, commit: string, tree: string, updated: boolean }>}
 */
export async function buildRelease({ cwd, from = 'main', branch = 'release' }) {
  const source = tryRev(cwd, from);
  if (!source) throw new Error(`소스 커밋을 찾지 못함: ${from}`);

  const entries = [];
  for (const p of RELEASE_PATHS) {
    const line = git(cwd, ['ls-tree', source, '--', p]);
    if (!line) throw new Error(`${from}에 ${p}가 없음`);
    entries.push(line);
  }
  const tree = git(cwd, ['mktree'], `${entries.join('\n')}\n`);

  const parent = tryRev(cwd, `refs/heads/${branch}`);
  if (parent && git(cwd, ['rev-parse', `${parent}^{tree}`]) === tree) {
    return { branch, source, commit: parent, tree, updated: false };
  }
  const subject = `release: ${from} ${source.slice(0, 7)}`;
  const commit = git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', subject, '-m', `Source: ${source}`]);
  // Compare-and-swap: fail if the branch moved since it was read.
  git(cwd, ['update-ref', `refs/heads/${branch}`, commit, parent ?? '']);
  return { branch, source, commit, tree, updated: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: { from: { type: 'string' }, branch: { type: 'string' } } });
  try {
    const out = await buildRelease({ cwd: process.cwd(), from: values.from, branch: values.branch });
    console.log(JSON.stringify(out));
    if (out.updated) console.error(`${out.branch}를 ${out.commit.slice(0, 7)}로 갱신함. 올리려면: git push origin ${out.branch}`);
    else console.error(`${out.branch}에 바뀐 내용이 없음`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
