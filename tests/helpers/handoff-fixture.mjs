// A repository with a prepared and submitted schema 2 handoff (state awaiting_approval), and
// the same task judged with every question accepted (state approved). Both come from the
// judgment fixture: the discount threshold moves from 10 to 100.

import { judge, judgedTask } from './judge-fixture.mjs';

export { SPEC } from './judge-fixture.mjs';

/** @param {Parameters<typeof judgedTask>[0]} [options] */
export async function submittedTask(options) {
  return judgedTask(options);
}

/**
 * A submitted task the person judged, every question accepted. The judgment keeps no
 * decision record, and its spec lifetime is the default (`delete`): apply stages `git rm` of
 * the spec.
 * @param {Parameters<typeof judgedTask>[0]} [options]
 */
export async function approvedTask(options) {
  const t = await judgedTask(options);
  const judgment = await judge({ home: t.home, taskId: t.taskId, sourceHash: t.sourceHash });
  return { ...t, judgment };
}
