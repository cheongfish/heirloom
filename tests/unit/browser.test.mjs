// Browser command selection (MVP-PLAN 6.5) and the run-and-wait helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { browserCommands, isWsl, openBrowser } from '../../skills/using-heirloom/lib/browser.mjs';

const URL_ = 'http://127.0.0.1:17380/r/r-x/w/w-y/t/t-20261112-abcdefgh';

test('browserCommands per platform', () => {
  assert.deepEqual(browserCommands(URL_, { platform: 'linux', wsl: false }), [['xdg-open', URL_]]);
  assert.deepEqual(browserCommands(URL_, { platform: 'darwin', wsl: false }), [['open', URL_]]);
  assert.deepEqual(browserCommands(URL_, { platform: 'win32', wsl: false }), [['cmd', '/c', 'start', '""', URL_]]);
});

test('WSL: wslview first, then cmd.exe start', () => {
  assert.deepEqual(browserCommands(URL_, { platform: 'linux', wsl: true }), [
    ['wslview', URL_],
    ['cmd.exe', '/c', 'start', '""', URL_],
  ]);
});

test('isWsl from the environment or the kernel release', () => {
  assert.equal(isWsl({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, release: '6.1.0' }), true);
  assert.equal(isWsl({ platform: 'linux', env: {}, release: '6.6.87.2-microsoft-standard-WSL2' }), true);
  assert.equal(isWsl({ platform: 'linux', env: {}, release: '6.8.0-45-generic' }), false);
  assert.equal(isWsl({ platform: 'darwin', env: { WSL_DISTRO_NAME: 'x' }, release: '' }), false);
});

test('openBrowser tries the next command when one is missing or fails', async () => {
  /** @type {string[][]} */
  const tried = [];
  const result = await openBrowser(URL_, {
    commands: [['missing'], ['fails'], ['works']],
    run: async (cmd) => {
      tried.push(cmd);
      if (cmd[0] === 'missing') return { ok: false, reason: 'ENOENT' };
      if (cmd[0] === 'fails') return { ok: false, reason: 'exit 1' };
      return { ok: true };
    },
  });
  assert.deepEqual(result, { opened: true, command: 'works' });
  assert.deepEqual(tried, [['missing'], ['fails'], ['works']]);
});

test('openBrowser reports failure when every command fails', async () => {
  const result = await openBrowser(URL_, { commands: [['a'], ['b']], run: async () => ({ ok: false, reason: 'ENOENT' }) });
  assert.equal(result.opened, false);
  assert.match(String(result.reason), /a: ENOENT/);
});

test('openBrowser with the real runner: a missing executable fails without throwing', async () => {
  const result = await openBrowser(URL_, { commands: [['heirloom-no-such-browser-command']] });
  assert.equal(result.opened, false);
});
