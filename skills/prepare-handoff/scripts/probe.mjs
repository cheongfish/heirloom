// Run the probes of a prepared handoff on base and head and record the outputs, once the person
// has allowed the commands in the dashboard. Prints one JSON object. See ../SKILL.md.
// node probe.mjs --task <taskId> --file <probes.json> [--timeout-minutes <n>]

import path from 'node:path';

import { parseCliArgs } from '../../using-heirloom/lib/args.mjs';
import { HeirloomError, runScript } from '../../using-heirloom/lib/errors.mjs';
import { heirloomHome } from '../../using-heirloom/lib/paths.mjs';
import { readProbeSpec } from '../../using-heirloom/lib/probe.mjs';
import { PERMIT_WAIT_MINUTES, runPermittedProbes } from '../../using-heirloom/lib/probe-permit.mjs';

await runScript(async () => {
  const args = parseCliArgs({ task: { type: 'string' }, file: { type: 'string' }, 'timeout-minutes': { type: 'string' } });
  if (!args.task) throw new HeirloomError('E_INPUT', '--task가 필요함');
  if (!args.file) throw new HeirloomError('E_INPUT', '--file이 필요함', { hint: '탐침 파일(probes.json)의 경로를 준다.' });
  const minutes = args['timeout-minutes'] === undefined ? PERMIT_WAIT_MINUTES : Number(args['timeout-minutes']);
  if (!Number.isFinite(minutes) || minutes < 0) throw new HeirloomError('E_INPUT', '--timeout-minutes는 0 이상의 수여야 함');
  const file = path.resolve(String(args.file));
  return runPermittedProbes({ home: heirloomHome(), taskId: String(args.task), spec: await readProbeSpec(file), specLabel: file, timeoutMs: minutes * 60_000 });
});
