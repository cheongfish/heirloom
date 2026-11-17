// Project (.heirloom/config.json) and user (~/.heirloom/config.json) settings with defaults.

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
 * @property {{ mode: 'off' | 'phase' }} testCadence opt-in rule for how often the full test suite runs
 * @property {ProbeConfig} probe how probes run
 * @property {{ afterMerge: 'delete' | 'archive' | 'keep' }} spec the spec lifetime the judgment screen offers first
 */

/**
 * @typedef {object} ProbeConfig
 * @property {string[][]} setup commands run once in each probe worktree before the probes (dependency install)
 * @property {number} maxProbes
 * @property {number} setupTimeoutSeconds per setup command
 * @property {number} testTimeoutSeconds default for the test command when the probes file gives none
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
    testCadence: { mode: c.testCadence?.mode ?? 'off' },
    probe: {
      setup: c.probe?.setup ?? [],
      maxProbes: c.probe?.maxProbes ?? 10,
      setupTimeoutSeconds: c.probe?.setupTimeoutSeconds ?? 600,
      testTimeoutSeconds: c.probe?.testTimeoutSeconds ?? 600,
    },
    spec: { afterMerge: c.spec?.afterMerge ?? 'delete' },
  };
}

/**
 * @typedef {object} UserConfig
 * @property {1} schemaVersion
 * @property {{ idleMinutes: number, openBrowser: boolean, staleDays: number, port: number }} dashboard
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
  return {
    schemaVersion: 1,
    dashboard: { idleMinutes: d.idleMinutes ?? 30, openBrowser: d.openBrowser ?? true, staleDays: d.staleDays ?? 7, port: d.port ?? 17380 },
  };
}
