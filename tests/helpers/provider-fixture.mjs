// An approved handoff on a remote of a given provider, with the skill scripts run as the agent
// runs them (`node <skill>/scripts/<name>.mjs`). gh and glab are always the fakes from
// tests/helpers: PATH starts with them, or holds git alone when a tool must be missing, so
// the real gh or glab on the machine is never reached.

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { submittedTask } from './handoff-fixture.mjs';
import { tempDir } from './git-fixture.mjs';
import { approveTask } from '../../skills/using-heirloom/dashboard/approve.mjs';
import { draftDigest } from '../../skills/using-heirloom/lib/canonical.mjs';
import { deriveState, readEvents } from '../../skills/using-heirloom/lib/events.mjs';
import { readJson } from '../../skills/using-heirloom/lib/fsx.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_GH = path.join(ROOT, 'tests', 'helpers', 'fake-gh');
const FAKE_GLAB = path.join(ROOT, 'tests', 'helpers', 'fake-glab');

const SCRIPTS = {
  apply: ['apply-approval', 'scripts', 'apply.mjs'],
  complete: ['apply-approval', 'scripts', 'complete.mjs'],
  'open-mr': ['apply-approval', 'scripts', 'open-mr.mjs'],
};

/** A directory with git and node alone (the fakes run on node), for "gh/glab is not installed". */
async function gitOnlyPath() {
  const dir = await tempDir('gitonly');
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  await symlink(real, path.join(dir, 'git'));
  await symlink(process.execPath, path.join(dir, 'node'));
  return dir;
}

/**
 * @param {{
 *   remote: string,
 *   gh?: object | null,
 *   glab?: object | null,
 *   templates?: Record<string, string>,
 * }} options `gh`/`glab`: the fake's state, or null when the tool is missing
 */
export async function providerTask({ remote, gh = {}, glab = {}, templates = {} }) {
  const t = await submittedTask();
  // Templates are excluded from git, so adding them after the handoff does not change the
  // approved source state; template discovery reads the files on disk.
  for (const [file, text] of Object.entries(templates)) {
    await t.repo.write(file, text);
    await appendFile(path.join(t.repo.dir, '.git', 'info', 'exclude'), `${file}\n`);
  }
  t.repo.git('remote', 'set-url', 'origin', remote);

  const dir = await tempDir('fakes');
  const files = {
    ghState: path.join(dir, 'gh-state.json'),
    ghLog: path.join(dir, 'gh-log.jsonl'),
    glabState: path.join(dir, 'glab-state.json'),
    glabLog: path.join(dir, 'glab-log.jsonl'),
  };
  await writeFile(files.ghState, JSON.stringify(gh ?? {}));
  await writeFile(files.glabState, JSON.stringify(glab ?? {}));
  /** @type {string[]} */
  const pathDirs = [];
  if (gh !== null) pathDirs.push(FAKE_GH);
  if (glab !== null) pathDirs.push(FAKE_GLAB);
  // No other directory: the one holding node may also hold the real gh or glab.
  pathDirs.push(await gitOnlyPath());

  const paths = taskPaths(t.home, t.taskId);
  const draft = /** @type {any} */ (await readJson(paths.draft));
  const approval = await approveTask({
    home: t.home,
    taskId: t.taskId,
    keystore: 'file',
    request: { kind: 'full', draftSha256: draftDigest(draft), sourceHash: t.sourceHash, summary: ['a를 2로 바꿨다', 'spec을 추가했다'], items: [{ index: 0, decision: 'approved' }] },
  });

  const env = {
    ...process.env,
    PATH: pathDirs.join(path.delimiter),
    HEIRLOOM_HOME: t.home,
    HEIRLOOM_KEYSTORE: 'file',
    GIT_SSH_COMMAND: 'false',
    GIT_TERMINAL_PROMPT: '0',
    FAKE_GH_STATE: files.ghState,
    FAKE_GH_LOG: files.ghLog,
    FAKE_GLAB_STATE: files.glabState,
    FAKE_GLAB_LOG: files.glabLog,
  };

  /**
   * Run a skill script in the task's worktree as the agent does.
   * @param {keyof typeof SCRIPTS} name
   * @param {string[]} args
   * @returns {{ status: number | null, out: any, stderr: string }}
   */
  const run = (name, args) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'skills', ...SCRIPTS[name]), ...args], { cwd: t.repo.dir, env, encoding: 'utf8' });
    let out = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {
      // left null: the assertion shows stdout
    }
    return { status: r.status, out, stderr: r.stderr };
  };

  return {
    ...t,
    approval,
    paths,
    files,
    run,
    /** @param {'gh' | 'glab'} tool */
    async calls(tool) {
      try {
        return (await readFile(tool === 'gh' ? files.ghLog : files.glabLog, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    /** @param {'gh' | 'glab'} tool */
    async fakeState(tool) {
      return JSON.parse(await readFile(tool === 'gh' ? files.ghState : files.glabState, 'utf8'));
    },
    /** @param {'gh' | 'glab'} tool @param {object} state */
    async setFakeState(tool, state) {
      await writeFile(tool === 'gh' ? files.ghState : files.glabState, JSON.stringify(state));
    },
    async state() {
      return deriveState(await readEvents(paths.events));
    },
    async lastEvent() {
      return (await readEvents(paths.events)).at(-1);
    },
    /** Write a body file outside the repository, as the agent does. */
    async bodyFile(/** @type {string} */ text) {
      const file = path.join(await tempDir('body'), 'body.md');
      await writeFile(file, text);
      return file;
    },
  };
}
