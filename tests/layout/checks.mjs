// Layout checks for the plugin tree. Each check takes the plugin root and
// returns a list of human-readable violations (empty when the layout is valid).
// See docs/HEIRLOOM-DESIGN.md sections 3 and 5 and AGENTS.md section 2.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursively list files and directories under `dir`.
 * @param {string} dir
 * @returns {Promise<{ files: string[], dirs: string[] }>} absolute paths
 */
async function walk(dir) {
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const dirs = [];
  /** @param {string} current */
  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(abs);
        await visit(abs);
      } else {
        files.push(abs);
      }
    }
  }
  await visit(dir);
  return { files, dirs };
}

/** @param {string} p */
async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @param {string} abs
 */
function rel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

/**
 * List skill directories (direct children of skills/).
 * @param {string} root
 * @returns {Promise<string[]>} directory names
 */
async function skillDirs(root) {
  try {
    const entries = await readdir(path.join(root, 'skills'), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/**
 * Parse the simple `key: value` frontmatter used by SKILL.md files.
 * Returns null when the file does not start with a frontmatter block.
 * @param {string} text
 * @returns {Record<string, string> | null}
 */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return fields;
}

/**
 * Every skill directory has a SKILL.md whose frontmatter name matches the
 * directory, has a non-empty description, and follows the naming rule.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function checkSkillFrontmatter(root) {
  /** @type {string[]} */
  const errors = [];
  for (const dir of await skillDirs(root)) {
    const file = path.join(root, 'skills', dir, 'SKILL.md');
    if (!(await exists(file))) {
      errors.push(`${dir}: SKILL.md is missing`);
      continue;
    }
    const fields = parseFrontmatter(await readFile(file, 'utf8'));
    if (!fields) {
      errors.push(`${dir}: frontmatter is missing`);
      continue;
    }
    const name = fields.name ?? '';
    if (name !== dir) errors.push(`${dir}: name "${name}" does not match directory`);
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(name)) {
      errors.push(`${dir}: name "${name}" must be lowercase verb-noun kebab-case`);
    }
    if (name.startsWith('heirloom')) errors.push(`${dir}: name must not start with "heirloom"`);
    if (!(fields.description ?? '').trim()) errors.push(`${dir}: description is empty`);
  }
  return errors;
}

const IMPORT_PATTERNS = [
  // static import / export ... from '...'
  /\b(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  // dynamic import('...')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Extract module specifiers from JavaScript source.
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiers(source) {
  /** @type {string[]} */
  const specs = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) specs.push(match[1]);
  }
  return specs;
}

/** @param {string} file */
function isScript(file) {
  return /\.(mjs|cjs|js)$/.test(file);
}

/**
 * Runtime code under skills/ may import only relative files that exist and stay
 * inside skills/, or node: builtins. No packages (no runtime dependencies).
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function checkImports(root) {
  /** @type {string[]} */
  const errors = [];
  const skillsRoot = path.join(root, 'skills');
  const { files } = await walk(skillsRoot);
  for (const file of files.filter(isScript).sort()) {
    const source = await readFile(file, 'utf8');
    for (const spec of importSpecifiers(source)) {
      const where = rel(root, file);
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(skillsRoot + path.sep)) {
          errors.push(`${where}: "${spec}" resolves outside skills/`);
        } else if (!(await exists(target))) {
          errors.push(`${where}: "${spec}" does not exist`);
        }
      } else if (!spec.startsWith('node:')) {
        errors.push(`${where}: "${spec}" is not a node: builtin (runtime dependencies are not allowed)`);
      }
    }
  }
  return errors;
}

const DEV_DIR_NAMES = new Set(['fixtures', '__fixtures__', 'tests', '__tests__', 'test', 'evals', 'scenarios', 'node_modules']);
const DEV_FILE_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]s$/,
  /(?<!\.d)\.[cm]?ts$/,
  /^package(-lock)?\.json$/,
  /^[jt]sconfig\.json$/,
  /^\.gitkeep$/,
];

/**
 * Skill directories ship as-is, so they must not contain tests, fixtures,
 * eval scenarios, package manifests or TypeScript sources.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function checkNoDevFiles(root) {
  /** @type {string[]} */
  const errors = [];
  const { files, dirs } = await walk(path.join(root, 'skills'));
  for (const dir of dirs.sort()) {
    if (DEV_DIR_NAMES.has(path.basename(dir))) {
      errors.push(`${rel(root, dir)}: development directory inside skills/`);
    }
  }
  for (const file of files.sort()) {
    const base = path.basename(file);
    if (DEV_FILE_PATTERNS.some((p) => p.test(base))) {
      errors.push(`${rel(root, file)}: development file inside skills/`);
    }
  }
  return errors;
}

const SIGN_ALLOWED = ['skills/using-heirloom/lib/', 'skills/using-heirloom/dashboard/'];
const SIGN_MODULE = 'skills/using-heirloom/lib/sign.mjs';

/**
 * Only lib/ and dashboard/ may obtain signing functions. Elsewhere, sign.mjs may be
 * imported only as `import { verify } from '.../sign.mjs'`.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function checkSignUsage(root) {
  /** @type {string[]} */
  const errors = [];
  const signModule = path.join(root, SIGN_MODULE);
  const { files } = await walk(path.join(root, 'skills'));
  for (const file of files.filter(isScript).sort()) {
    const where = rel(root, file);
    if (SIGN_ALLOWED.some((prefix) => where.startsWith(prefix))) continue;
    const source = await readFile(file, 'utf8');

    /** @param {string} spec */
    const targetsSign = (spec) =>
      (spec.startsWith('./') || spec.startsWith('../')) && path.resolve(path.dirname(file), spec) === signModule;

    for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (targetsSign(match[1])) errors.push(`${where}: dynamic import of sign.mjs is only allowed in lib/ and dashboard/`);
    }
    for (const match of source.matchAll(/\b(?:import|export)\s+([^'"`;]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
      if (!targetsSign(match[2])) continue;
      // Outside lib/ and dashboard/ only `import { verify } from '.../sign.mjs'` is allowed.
      const named = /^\{([^}]*)\}$/.exec(match[1].trim());
      const names = named ? named[1].split(',').map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
      if (!named || names.some((n) => n !== 'verify')) {
        errors.push(`${where}: sign.mjs may only be imported as { verify } outside lib/ and dashboard/`);
      }
    }
  }
  return errors;
}
