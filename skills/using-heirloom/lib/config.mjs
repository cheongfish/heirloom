// Project (.heirloom/config.json) and user (~/.heirloom/config.json) settings with defaults.

import path from 'node:path';

import { HeirloomError } from './errors.mjs';
import { readJson, writeJsonAtomic } from './fsx.mjs';
import { homePaths, repoPaths } from './paths.mjs';
import { assertValid, projectConfigSchema, userConfigSchema } from './schema.mjs';

export const DEFAULT_SPEC_GLOBS = Object.freeze(['docs/superpowers/specs/**', '**/specs/**/*.md']);

/**
 * @typedef {object} ProjectConfig
 * @property {1} schemaVersion
 * @property {string | null} baseBranch
 * @property {string[]} specGlobs
 * @property {{ maxRecords: number, maxTokens: number }} recall
 * @property {{ maxDecisions: number }} sessionIndex
 * @property {CurationConfig} curation
 * @property {{ mode: 'off' | 'phase' }} testCadence opt-in rule for how often the full test suite runs
 */

/** @typedef {{ minUnreviewed: number, maxAgeDays: number, minForAge: number, batchSize: number }} CurationConfig */

/** @type {Readonly<CurationConfig>} */
export const CURATION_DEFAULTS = Object.freeze({ minUnreviewed: 10, maxAgeDays: 30, minForAge: 3, batchSize: 20 });

/**
 * @param {string} root repository root
 * @returns {Promise<ProjectConfig>}
 */
export async function loadProjectConfig(root) {
  const file = repoPaths(root).config;
  const raw = /** @type {Record<string, any> | undefined} */ (await readJson(file));
  if (raw !== undefined) assertValid(projectConfigSchema, raw, file);
  const c = raw ?? {};
  return {
    schemaVersion: 1,
    baseBranch: c.baseBranch ?? null,
    specGlobs: c.specGlobs ?? [...DEFAULT_SPEC_GLOBS],
    recall: { maxRecords: c.recall?.maxRecords ?? 8, maxTokens: c.recall?.maxTokens ?? 6000 },
    sessionIndex: { maxDecisions: c.sessionIndex?.maxDecisions ?? 30 },
    curation: { ...CURATION_DEFAULTS, ...(c.curation ?? {}) },
    testCadence: { mode: c.testCadence?.mode ?? 'off' },
  };
}

/**
 * @typedef {object} UserConfig
 * @property {1} schemaVersion
 * @property {{ idleMinutes: number, openBrowser: boolean, staleDays: number, port: number }} dashboard
 * @property {{ agent: { host: 'claude-code', command: string, model: string | null } }} curation
 */

/**
 * @param {string} home
 * @returns {Promise<UserConfig>}
 */
export async function loadUserConfig(home) {
  const file = homePaths(home).config;
  const raw = /** @type {Record<string, any> | undefined} */ (await readJson(file));
  if (raw !== undefined) assertValid(userConfigSchema, raw, file);
  const d = raw?.dashboard ?? {};
  const agent = raw?.curation?.agent ?? {};
  return {
    schemaVersion: 1,
    dashboard: { idleMinutes: d.idleMinutes ?? 30, openBrowser: d.openBrowser ?? true, staleDays: d.staleDays ?? 7, port: d.port ?? 17380 },
    curation: { agent: { host: agent.host ?? 'claude-code', command: agent.command ?? 'claude', model: agent.model ?? null } },
  };
}

/**
 * A spec location pattern as `specGlobs` takes it: repository-relative, forward slashes, and
 * never leaving the repository.
 * @param {string} glob
 */
function checkSpecGlob(glob) {
  if (!glob.trim()) return '빈 패턴';
  if (glob.startsWith('/') || /^[A-Za-z]:/.test(glob)) return '절대 경로';
  if (glob.includes('\\')) return '역슬래시(경로 구분자는 /)';
  if (glob.split('/').includes('..')) return '저장소 밖을 가리킴(..)';
  return null;
}

/**
 * Add spec location patterns to the project setting `.heirloom/config.json`, creating it when
 * missing. A new file keeps the default patterns, so adding never narrows what was matched.
 * Other settings and an existing pattern list are kept as they are. Runs only when the user
 * asked for it; the file is a project file the user commits.
 * @param {string} root repository root
 * @param {string[]} globs
 * @returns {Promise<{ file: string, created: boolean, added: string[], specGlobs: string[] }>}
 */
export async function addSpecGlobs(root, globs) {
  if (!globs.length) throw new HeirloomError('E_INPUT', '추가할 spec 패턴이 없음', { hint: '--glob <패턴>을 하나 이상 준다.' });
  for (const glob of globs) {
    const problem = checkSpecGlob(glob);
    if (problem) throw new HeirloomError('E_INPUT', `spec 패턴으로 쓸 수 없음 (${problem}): ${JSON.stringify(glob)}`, { hint: '저장소 루트 기준 상대 패턴을 준다. 예: design/specs/**/*.md' });
  }
  const file = repoPaths(root).config;
  const raw = /** @type {Record<string, any> | undefined} */ (await readJson(file));
  if (raw !== undefined) assertValid(projectConfigSchema, raw, file);
  const current = raw?.specGlobs ?? [...DEFAULT_SPEC_GLOBS];
  const added = [...new Set(globs)].filter((g) => !current.includes(g));
  const next = { ...(raw ?? { schemaVersion: 1 }), specGlobs: [...current, ...added] };
  assertValid(projectConfigSchema, next, file);
  if (raw === undefined || added.length) await writeJsonAtomic(file, next, { mode: 0o644, dirMode: 0o755 });
  return { file: path.relative(root, file).split(path.sep).join('/'), created: raw === undefined, added, specGlobs: next.specGlobs };
}
