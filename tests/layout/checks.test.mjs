import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkSkillFrontmatter,
  checkImports,
  checkNoDevFiles,
  checkSignUsage,
  checkVendoredSeed,
} from './checks.mjs';
import { createHash } from 'node:crypto';

/**
 * Create a temporary plugin root containing the given files.
 * @param {Record<string, string>} files relative path -> content
 * @returns {Promise<string>}
 */
async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'heirloom-layout-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return root;
}

/** @param {string} name @param {string} [description] */
function skillMd(name, description = 'Use when testing.') {
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n# ${name}\n`;
}

test('frontmatter: valid skills pass', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/SKILL.md': skillMd('using-heirloom'),
    'skills/prepare-handoff/SKILL.md': skillMd('prepare-handoff'),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await checkSkillFrontmatter(root), []);
});

test('frontmatter: missing SKILL.md, name mismatch, empty description, heirloom prefix', async (t) => {
  const root = await fixture({
    'skills/no-skill-file/scripts/a.mjs': '',
    'skills/recall-context/SKILL.md': skillMd('recall-contexts'),
    'skills/apply-approval/SKILL.md': '---\nname: apply-approval\ndescription: ""\n---\n',
    'skills/heirloom-status/SKILL.md': skillMd('heirloom-status'),
    'skills/no-frontmatter/SKILL.md': '# no frontmatter\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkSkillFrontmatter(root)).join('\n');
  assert.match(errors, /no-skill-file: SKILL\.md is missing/);
  assert.match(errors, /recall-context: name "recall-contexts" does not match directory/);
  assert.match(errors, /apply-approval: description is empty/);
  assert.match(errors, /heirloom-status: name must not start with "heirloom"/);
  assert.match(errors, /no-frontmatter: frontmatter is missing/);
});

test('imports: relative imports inside skills/ and node: builtins pass', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/lib/a.mjs': "import fs from 'node:fs';\nexport const a = 1;\n",
    'skills/prepare-handoff/scripts/p.mjs':
      "import { a } from '../../using-heirloom/lib/a.mjs';\nconst m = await import('../../using-heirloom/lib/a.mjs');\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await checkImports(root), []);
});

test('imports: broken path, escape from skills/, bare package, non-node builtin', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/lib/a.mjs': [
      "import x from './missing.mjs';",
      "import y from '../../../tests/helper.mjs';",
      "import z from 'lodash';",
      "import fs from 'fs';",
      "export { q } from './also-missing.mjs';",
      '',
    ].join('\n'),
    'tests/helper.mjs': '',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkImports(root)).join('\n');
  assert.match(errors, /a\.mjs: "\.\/missing\.mjs" does not exist/);
  assert.match(errors, /a\.mjs: "\.\.\/\.\.\/\.\.\/tests\/helper\.mjs" resolves outside skills\//);
  assert.match(errors, /a\.mjs: "lodash" is not a node: builtin/);
  assert.match(errors, /a\.mjs: "fs" is not a node: builtin/);
  assert.match(errors, /a\.mjs: "\.\/also-missing\.mjs" does not exist/);
});

test('dev files: clean skills pass', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/SKILL.md': skillMd('using-heirloom'),
    'skills/using-heirloom/lib/state.mjs': '',
    'skills/using-heirloom/dashboard/index.html': '',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await checkNoDevFiles(root), []);
});

test('dev files: tests, fixtures, evals, configs, typescript sources are rejected', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/lib/state.test.mjs': '',
    'skills/using-heirloom/lib/state.spec.js': '',
    'skills/prepare-handoff/fixtures/repo.json': '',
    'skills/prepare-handoff/evals/case.md': '',
    'skills/recall-context/__tests__/a.mjs': '',
    'skills/recall-context/package.json': '{}',
    'skills/apply-approval/scripts/apply.ts': '',
    'skills/apply-approval/.gitkeep': '',
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkNoDevFiles(root)).join('\n');
  for (const rel of [
    'skills/using-heirloom/lib/state.test.mjs',
    'skills/using-heirloom/lib/state.spec.js',
    'skills/prepare-handoff/fixtures',
    'skills/prepare-handoff/evals',
    'skills/recall-context/__tests__',
    'skills/recall-context/package.json',
    'skills/apply-approval/scripts/apply.ts',
    'skills/apply-approval/.gitkeep',
  ]) {
    assert.ok(errors.includes(rel), `expected violation for ${rel}\n${errors}`);
  }
});

test('sign usage: allowed in lib/ and dashboard/, verify allowed anywhere', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/lib/sign.mjs': 'export function sign() {}\nexport function verify() {}\n',
    'skills/using-heirloom/lib/approvals.mjs': "import { sign } from './sign.mjs';\n",
    'skills/using-heirloom/dashboard/server.mjs': "import { sign, verify } from '../lib/sign.mjs';\n",
    'skills/apply-approval/scripts/apply.mjs': "import { verify } from '../../using-heirloom/lib/sign.mjs';\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await checkSignUsage(root), []);
});

test('sign usage: sign, aliased sign, namespace and dynamic import outside allowed dirs are rejected', async (t) => {
  const root = await fixture({
    'skills/using-heirloom/lib/sign.mjs': 'export function sign() {}\nexport function verify() {}\n',
    'skills/apply-approval/scripts/a.mjs': "import { sign } from '../../using-heirloom/lib/sign.mjs';\n",
    'skills/apply-approval/scripts/b.mjs':
      "import {\n  verify,\n  sign as s,\n} from '../../using-heirloom/lib/sign.mjs';\n",
    'skills/apply-approval/scripts/c.mjs': "import * as k from '../../using-heirloom/lib/sign.mjs';\n",
    'skills/using-heirloom/scripts/d.mjs': "const k = await import('../lib/sign.mjs');\n",
    'skills/apply-approval/scripts/e.mjs': "import { verify, ensureSigningKey } from '../../using-heirloom/lib/sign.mjs';\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkSignUsage(root)).join('\n');
  assert.match(errors, /apply-approval\/scripts\/a\.mjs/);
  assert.match(errors, /apply-approval\/scripts\/b\.mjs/);
  assert.match(errors, /apply-approval\/scripts\/c\.mjs/);
  assert.match(errors, /using-heirloom\/scripts\/d\.mjs/);
  assert.match(errors, /apply-approval\/scripts\/e\.mjs/, 'only verify may be imported outside lib/ and dashboard/');
});

/** @param {Record<string, string>} vendored file -> content @param {Record<string, string>} [extra] */
function seedFixture(vendored, extra = {}, version = '3.2.1') {
  const dir = 'skills/using-heirloom/dashboard/vendor/seed-design';
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<string, string>} */
  const hashes = {};
  for (const [name, content] of Object.entries(vendored)) {
    files[`${dir}/${name}`] = content;
    hashes[name] = createHash('sha256').update(content).digest('hex');
  }
  files[`${dir}/VENDOR.json`] = JSON.stringify({ package: '@seed-design/css', version, files: hashes });
  return { ...files, ...extra };
}

const SEED_OK = { LICENSE: 'Apache', NOTICE: 'notice', 'base.min.css': ':root{}', 'recipes/badge.css': '.seed-badge__root{}' };
const STATIC = 'skills/using-heirloom/dashboard/static';

test('vendored seed: pinned, licensed, unmodified copy with used classes passes', async (t) => {
  const root = await fixture(seedFixture(SEED_OK, { [`${STATIC}/app.js`]: "el.className = 'seed-badge__root hl-x';\nconst v = '--seed-color-fg-neutral'; // data-seed" }));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.deepEqual(await checkVendoredSeed(root), []);
});

test('vendored seed: wrong version, missing NOTICE, edited file, unlisted file are rejected', async (t) => {
  const { NOTICE: _n, ...noNotice } = SEED_OK;
  const files = seedFixture(noNotice, {}, '3.3.0');
  files['skills/using-heirloom/dashboard/vendor/seed-design/base.min.css'] = ':root{color:red}';
  files['skills/using-heirloom/dashboard/vendor/seed-design/recipes/extra.css'] = '';
  const root = await fixture(files);
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = await checkVendoredSeed(root);
  assert.equal(errors.length, 4, errors.join('\n'));
  assert.match(errors.join('\n'), /3\.3\.0/);
  assert.match(errors.join('\n'), /NOTICE is required/);
  assert.match(errors.join('\n'), /base\.min\.css: differs/);
  assert.match(errors.join('\n'), /extra\.css: not listed/);
});

test('vendored seed: unknown or interpolated SEED classes, images and brand names in static/ are rejected', async (t) => {
  const root = await fixture(
    seedFixture(SEED_OK, {
      [`${STATIC}/app.js`]: "a = 'seed-badge__root seed-nope'; b = `seed-badge__root--tone_${t}`;",
      [`${STATIC}/logo.svg`]: '<svg/>',
      [`${STATIC}/app.css`]: '/* 당근 */',
    }),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkVendoredSeed(root)).join('\n');
  assert.match(errors, /seed-nope is not defined/);
  assert.match(errors, /seed-badge__root--tone_ is not defined/);
  assert.match(errors, /logo\.svg: only HTML, JS and CSS/);
  assert.match(errors, /app\.css: Karrot brand/);
});

test('vendored seed: index.html must link every vendored CSS file and nothing else', async (t) => {
  const root = await fixture(
    seedFixture(SEED_OK, { [`${STATIC}/index.html`]: '<link rel="stylesheet" href="/assets/seed/base.min.css"><link rel="stylesheet" href="/assets/seed/recipes/tabs.css">' }),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const errors = (await checkVendoredSeed(root)).join('\n');
  assert.match(errors, /recipes\/badge\.css is not linked/);
  assert.match(errors, /links recipes\/tabs\.css, which is not vendored/);
});
