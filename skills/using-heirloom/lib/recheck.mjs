// Recheck after a judgment: what changed since the judged state (a pure function).

/** @typedef {{ path: string, status: string, sha256: string }} FileState */
/** @typedef {{ files: FileState[], mergeBase: string, materials: Record<string, string | null> }} StateSnapshot */
/** @typedef {{ path: string, before: string | null, after: string | null, reason: 'edited' | 'base_updated' | 'added' | 'removed' }} FileChange */
/** @typedef {{ ref: string, before: string | null, after: string | null }} MaterialChange */

/** @param {string} a @param {string} b */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Files and materials that differ between the approved state and the current one.
 * `after` is the task's diff against the current merge-base, so changes that came in from
 * the target branch do not appear.
 *
 * After the merge-base moved, a changed file is a base update when the target branch itself
 * changed it between the two merge-bases (`baseChanged`); other changes are ordinary edits.
 * Without `baseChanged` (the old merge-base is no longer available) every changed file
 * counts as a base update, because an edit cannot be told apart from what came in.
 * @param {{ before: StateSnapshot, after: StateSnapshot, baseChanged?: Set<string> | null }} options
 * @returns {{ mergeBaseChanged: boolean, changes: FileChange[], materials: MaterialChange[] }}
 */
export function diffStates({ before, after, baseChanged = null }) {
  const mergeBaseChanged = before.mergeBase !== after.mergeBase;
  const was = new Map(before.files.map((f) => [f.path, f.sha256]));
  const now = new Map(after.files.map((f) => [f.path, f.sha256]));
  /** @type {FileChange[]} */
  const changes = [];
  for (const p of [...new Set([...was.keys(), ...now.keys()])].sort(byString)) {
    const b = was.get(p) ?? null;
    const a = now.get(p) ?? null;
    if (b === a) continue;
    const fromBase = mergeBaseChanged && (baseChanged === null || baseChanged.has(p));
    const reason = b === null ? 'added' : a === null ? 'removed' : fromBase ? 'base_updated' : 'edited';
    changes.push({ path: p, before: b, after: a, reason });
  }
  /** @type {MaterialChange[]} */
  const materials = [];
  for (const ref of [...new Set([...Object.keys(before.materials), ...Object.keys(after.materials)])].sort(byString)) {
    const b = before.materials[ref] ?? null;
    const a = after.materials[ref] ?? null;
    if (b !== a) materials.push({ ref, before: b, after: a });
  }
  return { mergeBaseChanged, changes, materials };
}
