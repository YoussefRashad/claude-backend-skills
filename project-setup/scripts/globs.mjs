// Overlap test between two gitignore-style path globs, used to decide whether appending a managed deny
// rule after a user `!` exception could cancel that exception.
//
// Sound for the syntax it understands (literals, `*`, `?`, `**` segments): it returns false only when no
// path can match both patterns. For anything it does not model (character classes, braces, escapes,
// `~/`, `//`, absolute anchors) it returns true, i.e. "may overlap", so the caller defers to the user.
// Matching is case-insensitive on purpose: treating more pairs as overlapping is the safe direction.

const UNMODELED = /[[\]{}\\]/;

function normalize(glob) {
  let g = String(glob).trim();
  if (g.startsWith('!')) g = g.slice(1);
  if (g.startsWith('~/') || g.startsWith('//')) return null;
  if (UNMODELED.test(g)) return null;
  // A leading "/" anchors at the base directory (Claude reads "!/x" relative to the current directory).
  const anchored = g.startsWith('/');
  g = g.replace(/^\.\//, '').replace(/^\//, '');
  if (g.endsWith('/')) g += '**';
  if (!anchored && !g.includes('/')) g = `**/${g}`; // a bare name matches at any depth
  return g.split('/').filter((s) => s.length).map((s) => (s === '**' ? s : s.replace(/\*\*+/g, '*')));
}

/** Can some single path segment match both segment globs? Exact BFS over the product automaton. */
export function segmentsIntersect(a, b) {
  const A = a.toLowerCase(); const B = b.toLowerCase();
  const seen = new Set();
  const stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const key = `${i},${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === A.length && j === B.length) return true;
    if (A[i] === '*') stack.push([i + 1, j]); // star matches empty
    if (B[j] === '*') stack.push([i, j + 1]);
    if (i < A.length && j < B.length) {
      const ca = A[i]; const cb = B[j];
      const wildA = ca === '*' || ca === '?'; const wildB = cb === '*' || cb === '?';
      if (wildA || wildB || ca === cb) stack.push([ca === '*' ? i : i + 1, cb === '*' ? j : j + 1]);
    }
  }
  return false;
}

function pathsIntersect(A, B) {
  const seen = new Set();
  const stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const key = `${i},${j}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === A.length && j === B.length) return true;
    if (A[i] === '**') stack.push([i + 1, j]);
    if (B[j] === '**') stack.push([i, j + 1]);
    if (i < A.length && j < B.length) {
      const sa = A[i]; const sb = B[j];
      if (sa === '**' || sb === '**' || segmentsIntersect(sa, sb)) stack.push([sa === '**' ? i : i + 1, sb === '**' ? j : j + 1]);
    }
  }
  return false;
}

/**
 * true unless provably disjoint.
 * File level: some file path matches both patterns.
 * Directory level: a directory rule (`x/**`) can also collide with an exception that names the directory itself
 * (`!x`), so the rule's directory prefix is compared with the exception too.
 * (An exception that merely matches a parent directory does not re-include files a rule matches by name, which is
 * gitignore semantics, so the exception is not extended to `<exception>/**`.)
 */
export function globsMayOverlap(ruleGlob, exceptionGlob) {
  const a = normalize(ruleGlob);
  const b = normalize(exceptionGlob);
  if (!a || !b) return true;
  if (pathsIntersect(a, b)) return true;
  if (a.length > 1 && a[a.length - 1] === '**' && pathsIntersect(a.slice(0, -1), b)) return true;
  return false;
}
