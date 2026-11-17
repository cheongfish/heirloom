// Run the probes of a prepared handoff on base and head and record the outputs. Prints one
// JSON object. See ../SKILL.md.
// node probe.mjs --task <taskId> --file <probes.json>

import path from 'node:path';

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { readProbeSpec, runProbes } from '../../using-heirloom/lib/probe.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, file: { type: 'string' } });
  if (!args.task) throw new HeirloomError('E_INPUT', '--task가 필요함');
  if (!args.file) throw new HeirloomError('E_INPUT', '--file이 필요함', { hint: '탐침 파일(probes.json)의 경로를 준다.' });
  const file = path.resolve(String(args.file));
  return runProbes({ home: heirloomHome(), taskId: String(args.task), spec: await readProbeSpec(file), specLabel: file });
});
