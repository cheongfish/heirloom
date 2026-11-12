// Project (.heirloom/config.json) and user (~/.heirloom/config.json) settings with defaults.
// See docs/HEIRLOOM-MVP-PLAN.md section 5.8.

import { readJson } from './fsx.mjs';
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
 */

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
  };
}

/**
 * @typedef {object} UserConfig
 * @property {1} schemaVersion
 * @property {{ idleMinutes: number, openBrowser: boolean, staleDays: number }} dashboard
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
  return { schemaVersion: 1, dashboard: { idleMinutes: d.idleMinutes ?? 30, openBrowser: d.openBrowser ?? true, staleDays: d.staleDays ?? 7 } };
}
