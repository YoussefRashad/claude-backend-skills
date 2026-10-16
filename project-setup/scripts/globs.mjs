// Overlap test between two gitignore-style path globs, used to decide whether appending a managed deny
// rule after a user `!` exception could cancel that exception.
//
// Sound for the syntax it understands: permission expressions are normalized into policy entries and compared by the
// shared policy matcher (assets/tools/security-policy.mjs), over the same lowercase and Windows-alias forms the secret
// matcher uses, so an unrelated exception never holds a managed deny back and a related one always does. For anything
// it does not model (character classes, braces, escapes, `~/`, `//`, invalid policy grammar such as `a**b`, a
// non-string or blank operand) it returns true, i.e. "may overlap", so the caller defers to the user.
// Plan: docs/plans/2026-10-16-project-setup-v3-rc1-c1.md section 3.7.
import { policyEntryKey, policyEntriesMayOverlap } from '../assets/tools/security-policy.mjs';

const ANY_PREFIX = '**/';

/** A permission expression as a policy entry, or null when it is not modeled. Invalid star runs are not collapsed. */
function normalize(glob) {
  if (typeof glob !== 'string') return null;
  let g = glob.trim();
  if (g.startsWith('!')) g = g.slice(1);
  if (g === '') return null;
  if (g.startsWith('~/') || g.startsWith('//')) return null;
  // A leading "/" anchors at the base directory (Claude reads "!/x" relative to the current directory).
  const anchored = g.startsWith('/');
  g = g.replace(/^\.\//, '').replace(/^\//, '');
  if (g.endsWith('/')) g += '**';
  if (!anchored && !g.includes('/')) g = `${ANY_PREFIX}${g}`; // a bare name matches at any depth
  const entry = { anchor: g.startsWith(ANY_PREFIX) ? 'any' : 'root', glob: g };
  try { policyEntryKey(entry); } catch (e) {
    if (e instanceof Error && typeof e.code === 'string' && e.code.startsWith('POLICY_')) return null;
    throw e;
  }
  return entry;
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

/**
 * true unless provably disjoint.
 * File level: some file path matches both patterns (the shared code-point intersection, not segmentsIntersect).
 * Directory level: a directory rule (`x/**`) can also collide with an exception that names the directory itself
 * (`!x`), so the rule's directory prefix is compared with the exception too.
 * (An exception that merely matches a parent directory does not re-include files a rule matches by name, which is
 * gitignore semantics, so the exception is not extended to `<exception>/**`.)
 */
export function globsMayOverlap(ruleGlob, exceptionGlob) {
  const a = normalize(ruleGlob);
  const b = normalize(exceptionGlob);
  if (!a || !b) return true;
  if (policyEntriesMayOverlap(a, b)) return true;
  if (a.glob.endsWith('/**') && a.glob.length > 3) {
    const prefix = a.glob.slice(0, -3);
    const dir = { anchor: prefix.startsWith(ANY_PREFIX) ? 'any' : 'root', glob: prefix };
    if (policyEntriesMayOverlap(dir, b)) return true;
  }
  return false;
}
