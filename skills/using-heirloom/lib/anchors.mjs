// Anchor check of a decision record at recall. Only presence is checked, never
// meaning: a function that keeps its name but changes its behavior is caught only by a test
// anchor that fails. That is why every record has at least one test anchor.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { hasSymbol } from './draft-check.mjs';
import { readJson } from './fsx.mjs';
import { readIds } from './ids.mjs';
import { taskPaths } from './paths.mjs';
import { readIndex } from './store.mjs';

/** @typedef {{ status: 'pass' | 'fail' | 'skip', ranAt: string, taskId: string }} TestRun */

/**
 * The newest head result of each test across the probe runs of this repository's tasks.
 * Heirloom runs tests only in probe runs, so this is the "last run" a test anchor is held to.
 * @param {string} home
 * @param {import('./git.mjs').RepoInfo} info
 * @returns {Promise<Map<string, TestRun>>}
 */
export async function lastTestRuns(home, info) {
  /** @type {Map<string, TestRun>} */
  const runs = new Map();
  const ids = await readIds(info, home);
  if (!ids) return runs;
  const index = await readIndex(home);
  for (const [key, taskId] of Object.entries(index.tasks)) {
    const worktreeId = key.split('|')[0];
    if (worktreeId !== ids.worktreeId && index.worktrees[worktreeId]?.repoId !== ids.repoId) continue;
    const result = /** @type {any} */ (await readJson(path.join(taskPaths(home, taskId).probes, 'result.json')).catch(() => undefined));
    const head = result?.tests?.head;
    if (!head?.parsed || typeof result.ranAt !== 'string') continue;
    for (const [name, r] of Object.entries(/** @type {Record<string, any>} */ (head.results))) {
      const before = runs.get(name);
      if (!before || before.ranAt < result.ranAt) runs.set(name, { status: r.status, ranAt: result.ranAt, taskId });
    }
  }
  return runs;
}

/**
 * The part of a test name the test file spells out: the last segment of "suite > test".
 * @param {string} name
 */
const ownName = (name) => name.split(' > ').at(-1) ?? name;

/**
 * Check a record's anchors in the working tree.
 * - symbol anchor: the file exists and has the name.
 * - test anchor: the file exists and spells the test name; its last run, when known, passed.
 * Any missing anchor or failing test makes the record `possibly-stale`: the agent neither
 * follows nor ignores it, and asks the person.
 * @param {{ root: string, anchors: { file: string, symbol?: string, test?: string }[], runs: Map<string, TestRun> }} options
 */
export async function checkAnchors({ root, anchors, runs }) {
  /** @type {{ file: string, symbol?: string, test?: string, found: boolean, lastRun?: { status: string, at: string } | null }[]} */
  const checked = [];
  for (const a of anchors) {
    let text = null;
    try {
      text = await readFile(path.join(root, a.file), 'utf8');
    } catch {
      // missing file
    }
    if (a.symbol !== undefined) {
      checked.push({ ...a, found: text !== null && hasSymbol(text, a.symbol) });
      continue;
    }
    const name = String(a.test);
    const run = runs.get(name);
    checked.push({ ...a, found: text !== null && text.includes(ownName(name)), lastRun: run ? { status: run.status, at: run.ranAt } : null });
  }
  const stale = checked.some((a) => !a.found || ('lastRun' in a && a.lastRun?.status === 'fail'));
  return { result: stale ? 'possibly-stale' : 'active', anchors: checked };
}
