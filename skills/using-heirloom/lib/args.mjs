// Command-line parsing for skill scripts; parse errors become E_INPUT.

import { parseArgs } from 'node:util';

import { HeirloomError } from './errors.mjs';

/**
 * @template {import('node:util').ParseArgsConfig['options']} O
 * @param {O} options
 * @param {string[]} [args]
 */
export function parseCliArgs(options, args = process.argv.slice(2)) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (err) {
    throw new HeirloomError('E_INPUT', `인자 오류: ${err instanceof Error ? err.message : String(err)}`);
  }
}
