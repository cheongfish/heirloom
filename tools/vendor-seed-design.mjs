#!/usr/bin/env node
// Development tool: copy the pinned @seed-design/css files the dashboard uses into
// skills/using-heirloom/dashboard/vendor/seed-design/ (MVP-PLAN 6.7). Never edit the
// copied files by hand; change RECIPES or --version and run this again.
//
//   node tools/vendor-seed-design.mjs [--version 3.2.1] [--from <package.tgz>]
//
// Without --from the package is fetched with `npm pack`. VENDOR.json records the version
// and a sha256 per file so that the layout tests catch hand edits.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PACKAGE = '@seed-design/css';
const DEFAULT_VERSION = '3.2.1';
/** Component recipes the dashboard uses. Keep in sync with the class names in dashboard/static/. */
export const RECIPES = [
  'action-button',
  'badge',
  'callout',
  'field',
  'field-label',
  'list-header',
  'list-item',
  'page-banner',
  'segmented-control',
  'tabs',
  'text-input',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(ROOT, 'skills', 'using-heirloom', 'dashboard', 'vendor', 'seed-design');

const { values } = parseArgs({ options: { version: { type: 'string' }, from: { type: 'string' } }, strict: true });
const version = values.version ?? DEFAULT_VERSION;

const work = await mkdtemp(path.join(tmpdir(), 'heirloom-seed-'));
try {
  let tarball = values.from ? path.resolve(values.from) : '';
  if (!tarball) {
    const name = execFileSync('npm', ['pack', `${PACKAGE}@${version}`, '--silent', '--pack-destination', work], { encoding: 'utf8' }).trim().split('\n').pop();
    tarball = path.join(work, /** @type {string} */ (name));
  }
  execFileSync('tar', ['-xzf', tarball, '-C', work]);
  const pkgDir = path.join(work, 'package');
  const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  if (pkg.name !== PACKAGE || pkg.version !== version) {
    throw new Error(`expected ${PACKAGE}@${version}, got ${pkg.name}@${pkg.version}`);
  }

  const files = ['LICENSE', 'NOTICE', 'base.min.css', ...RECIPES.map((r) => `recipes/${r}.css`)];
  await rm(DEST, { recursive: true, force: true });
  await mkdir(path.join(DEST, 'recipes'), { recursive: true });
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const file of files) {
    await copyFile(path.join(pkgDir, file), path.join(DEST, file));
    hashes[file] = createHash('sha256').update(await readFile(path.join(DEST, file))).digest('hex');
  }
  const manifest = { package: PACKAGE, version, license: pkg.license, files: hashes };
  await writeFile(path.join(DEST, 'VENDOR.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const copied = (await readdir(path.join(DEST, 'recipes'))).length;
  process.stderr.write(`vendored ${PACKAGE}@${version}: base.min.css, ${copied} recipes, LICENSE, NOTICE\n`);
} finally {
  await rm(work, { recursive: true, force: true });
}
