// Discover the consumer project's PR templates (GitHub), MR templates (GitLab) and commit
// message guides. Only paths are reported; the agent reads the contents.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { tryGit } from './git.mjs';

const PR_TEMPLATE_FILES = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
];
const PR_TEMPLATE_DIRS = ['.github/PULL_REQUEST_TEMPLATE', '.github/pull_request_template', 'docs/PULL_REQUEST_TEMPLATE'];
const MR_TEMPLATE_DIR = '.gitlab/merge_request_templates';
const COMMIT_GUIDE_FILES = ['.gitmessage', 'CONTRIBUTING.md'];

/**
 * Keep existing files only, dropping duplicates that are the same file
 * (case-insensitive file systems list one file under two names).
 * @param {string} root
 * @param {string[]} candidates repository-relative or absolute paths
 */
async function existingUnique(root, candidates) {
  /** @type {string[]} */
  const found = [];
  const seen = new Set();
  for (const rel of candidates) {
    try {
      const info = await stat(path.resolve(root, rel));
      if (!info.isFile()) continue;
      const key = `${info.dev}:${info.ino}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(rel);
    } catch {
      // missing
    }
  }
  return found;
}

/**
 * @param {string} root repository root
 * @returns {Promise<{ prTemplates: string[], commitGuides: string[] }>}
 */
export async function findProjectRules(root) {
  const templates = [...PR_TEMPLATE_FILES];
  for (const dir of PR_TEMPLATE_DIRS) {
    try {
      for (const name of (await readdir(path.join(root, dir))).sort()) {
        if (name.toLowerCase().endsWith('.md')) templates.push(`${dir}/${name}`);
      }
    } catch {
      // missing
    }
  }
  const template = await tryGit(['config', '--get', 'commit.template'], { cwd: root });
  const guides = template ? [template, ...COMMIT_GUIDE_FILES] : [...COMMIT_GUIDE_FILES];
  return { prTemplates: await existingUnique(root, templates), commitGuides: await existingUnique(root, guides) };
}

/**
 * GitLab merge request templates, sorted by name.
 * @param {string} root repository root
 * @returns {Promise<string[]>}
 */
export async function findMrTemplates(root) {
  try {
    const names = (await readdir(path.join(root, MR_TEMPLATE_DIR))).filter((n) => n.toLowerCase().endsWith('.md')).sort();
    return existingUnique(root, names.map((n) => `${MR_TEMPLATE_DIR}/${n}`));
  } catch {
    return [];
  }
}
