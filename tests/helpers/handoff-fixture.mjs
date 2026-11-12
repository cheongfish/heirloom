// A repository with a prepared and submitted handoff (state awaiting_approval).

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeRepo, cloneRepo, tempDir } from './git-fixture.mjs';
import { prepareHandoff } from '../../skills/using-heirloom/lib/prepare.mjs';
import { submitDraft } from '../../skills/using-heirloom/lib/submit.mjs';
import { taskPaths } from '../../skills/using-heirloom/lib/paths.mjs';

process.env.HEIRLOOM_KEYSTORE = 'file';

export const SPEC = 'docs/superpowers/specs/2026-11-12-x.md';
const SPEC_TEXT = '# X\n\n## 결정\n변환 결과는 반올림하지 않는다.\n';

/**
 * @param {{ records?: boolean }} [options] records: false gives a draft without decisions (quick approval)
 */
export async function submittedTask({ records = true } = {}) {
  const upstream = await makeRepo({ 'README.txt': 'hello\n', 'src/a.mjs': 'export const a = 1;\n' });
  const repo = await cloneRepo(upstream);
  repo.git('checkout', '-q', '-b', 'feat');
  await repo.write(SPEC, SPEC_TEXT);
  await repo.write('src/a.mjs', 'export const a = 2;\n');
  const home = await tempDir('home');

  const prepared = await prepareHandoff({ cwd: repo.dir, home, specs: [SPEC] });
  const draft = {
    schemaVersion: 1,
    taskId: prepared.taskId,
    inputSourceHash: prepared.source.hash,
    summary: [
      { text: 'a를 2로 바꿨다', codePaths: ['src/a.mjs'] },
      { text: 'spec을 추가했다', codePaths: ['src/a.mjs'] },
    ],
    records: records
      ? [
          {
            op: 'add',
            kind: 'decision',
            title: '변환 결과는 반올림하지 않는다',
            body: { problem: 'p', choice: 'c', alternatives: '', scope: '' },
            codePaths: ['src/a.mjs'],
            topics: [],
            sources: [{ ref: SPEC, lines: [4, 4], quote: '변환 결과는 반올림하지 않는다.' }],
          },
        ]
      : [],
    missing: [],
    conflicts: [],
    notes: '',
  };
  const file = taskPaths(home, prepared.taskId).draft;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(draft));
  await submitDraft({ home, taskId: prepared.taskId });
  return { upstream, repo, home, taskId: prepared.taskId, sourceHash: prepared.source.hash };
}
