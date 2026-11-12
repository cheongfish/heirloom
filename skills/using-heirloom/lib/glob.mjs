// Minimal glob matching for repository-relative paths (`/` separators).
// Supports `*`, `**`, `?` and `{a,b}`. Node 20 has no built-in glob matcher.

/** @param {string} s */
const escape = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atSegmentStart = i === 0 || glob[i - 1] === '/';
        if (atSegmentStart && glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += escape(c);
      } else {
        re += `(?:${glob.slice(i + 1, end).split(',').map(escape).join('|')})`;
        i = end;
      }
    } else {
      re += escape(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * @param {string} file
 * @param {readonly string[]} globs
 */
export function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}
