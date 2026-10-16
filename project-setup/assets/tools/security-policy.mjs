// Shared secret-path policy: grammar, validation, matcher and version contract. Zero dependencies beyond node:util.
// Works when copied alone (installed as .ai/tools/security-policy.mjs by a later component).
//
// Plan: docs/plans/2026-10-16-project-setup-v3-rc1-c1.md sections 2.3 and 3, with PQ1 and the simplified PQ2.
//
// What this gets right that the v2 helpers did not:
//   - One grammar for every consumer. v2 had two matchers that disagreed on `a**b` (one crossed `/`, one did not), so a
//     pattern could hide a file from one tool and expose it to another. Here `**` is only ever a whole component.
//   - Host-independent case. v2 folded case only on Windows; a policy read on Linux protected less than on Windows.
//     Comparison is JavaScript toLowerCase() on every host, wildcards counting code points after lowercasing.
//   - Windows spellings of the same name. Per component, the prefix before the first ':' (an NTFS stream: `.env::$DATA`)
//     and the component with trailing dots and spaces removed (`.env.`, `.env `), alone and combined, also count.
//     Unicode case-fold and normalization aliases are accepted residual risks (PQ2) and deliberately not built.
//   - Invalid input never falls back to an empty or shipped policy, and a path is validated, never rewritten.
//   - Matching is dynamic programming over code points, never a backtracking regular expression, so a hostile glob or
//     path costs O(|glob| * |path|), not exponential time.
//
// Every function is synchronous, reads no file, process, network or environment, prints nothing, never exits and never
// mutates its input. Importing the module does nothing but define it.
import { types } from 'node:util';

export const POLICY_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------- errors ----
// Plan 3.5: exact codes and messages. Messages never carry rejected paths, globs, metadata or raw JSON.
const SUFFIX = {
  POLICY_TEXT: () => 'policy text must be a string',
  POLICY_JSON: () => 'policy text must be valid JSON',
  POLICY_ROOT: () => 'policy must be a JSON object',
  POLICY_VALUE: () => 'policy must contain only JSON data',
  POLICY_SCHEMA: () => 'policy.schema must be 1 or 2',
  POLICY_PATTERNS: () => 'policy.patterns must be an array',
  POLICY_PROJECT_PATTERNS: () => 'policy.projectPatterns must be an array',
  POLICY_ENTRY: (l) => `${l} must be an object`,
  POLICY_GLOB: (l) => `${l}.glob must be a nonempty string`,
  POLICY_ANCHOR: (l) => `${l}.anchor must be "any" or "root"`,
  POLICY_GLOB_SYNTAX: (l) => `${l}.glob uses unsupported syntax`,
  POLICY_GLOBSTAR: (l) => `${l}.glob must use * or a separate **/ component; ** must be a whole component`,
  POLICY_GLOB_PATH: (l) => `${l}.glob must be a canonical repository-relative glob`,
  POLICY_ANCHOR_ANY: (l) => `${l}.glob must start with **/ for anchor "any"`,
  POLICY_ANCHOR_ROOT: (l) => `${l}.glob must not start with **/ for anchor "root"`,
  POLICY_LEGACY_ANCHOR: (l) => `${l}.anchor conflicts with the inferred legacy anchor`,
  POLICY_PATH_TYPE: () => 'path must be a nonempty string',
  POLICY_PATH_NUL: () => 'path must not contain NUL',
  POLICY_PATH_ABSOLUTE: () => 'path must be repository-relative',
  POLICY_PATH_CANONICAL: () => 'path must use canonical POSIX components',
};

function policyError(code, location) {
  const e = new Error(`${code}: ${SUFFIX[code](location)}`);
  e.code = code;
  return e;
}

// ------------------------------------------------------------ JSON data ----
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Every key is defined, never assigned: assigning an own "__proto__" key would change the copy's prototype.
function define(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

// A plain JSON object: not a Proxy (checked first, so no trap runs), not an array, prototype exactly this realm's
// Object.prototype or null. Date, Map, class instances and objects from another realm fail.
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || types.isProxy(v) || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Validates the whole JSON domain and returns a detached copy made of ordinary objects and arrays. Reads property
 * descriptors only: no accessor, Proxy trap or toJSON is ever invoked. Shared references are copied by value; a
 * reference to an ancestor (a cycle) is rejected.
 */
function cloneJson(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw policyError('POLICY_VALUE');
    return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) throw policyError('POLICY_VALUE');
  ancestors.add(value);
  const proto = Object.getPrototypeOf(value);
  const keys = Reflect.ownKeys(value);
  let out;
  if (Array.isArray(value)) {
    if (proto !== Array.prototype && proto !== null) throw policyError('POLICY_VALUE');
    const length = Object.getOwnPropertyDescriptor(value, 'length').value;
    if (keys.length !== length + 1) throw policyError('POLICY_VALUE'); // holes, or properties other than indexes
    out = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(value, String(i));
      if (!d || !('value' in d) || !d.enumerable) throw policyError('POLICY_VALUE');
      out.push(cloneJson(d.value, ancestors));
    }
  } else {
    if (proto !== Object.prototype && proto !== null) throw policyError('POLICY_VALUE');
    out = {};
    for (const k of keys) {
      if (typeof k !== 'string') throw policyError('POLICY_VALUE');
      const d = Object.getOwnPropertyDescriptor(value, k);
      if (!('value' in d) || !d.enumerable) throw policyError('POLICY_VALUE');
      define(out, k, cloneJson(d.value, ancestors));
    }
  }
  ancestors.delete(value);
  return out;
}

// ---------------------------------------------------------------- grammar ----
// Plan 3.2. Unsupported: brackets, braces, any backslash, a leading "!", "~/" or ":(", and an extglob opener anywhere.
const UNSUPPORTED = /[[\]{}\\]|[?*+@!]\(/;
const DRIVE = /^[A-Za-z]:/;
const ANY_PREFIX = '**/';

const unsupportedSyntax = (g) => UNSUPPORTED.test(g) || g.startsWith('!') || g.startsWith('~/') || g.startsWith(':(');
// PQ1: `**` only as a whole component. Any component holding `**` that is not exactly `**` (a**b, x**, ***) fails.
const badGlobstar = (g) => g.split('/').some((c) => c.includes('**') && c !== '**');
const badComponents = (s) => s.split('/').some((c) => c === '' || c === '.' || c === '..');
const badGlobPath = (g) => g.includes('\u0000') || g.startsWith('/') || DRIVE.test(g) || badComponents(g);

/**
 * Plan 3.5 entry order: object, glob, anchor, syntax, PQ1, structure, legacy conflict, anchor prefix.
 * `entry` is already a validated JSON copy. Returns { anchor, glob } with the glob in its original spelling.
 */
function checkEntry(entry, location, legacy) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw policyError('POLICY_ENTRY', location);
  if (!own(entry, 'glob') || typeof entry.glob !== 'string' || entry.glob === '') throw policyError('POLICY_GLOB', location);
  const glob = entry.glob;
  const hasAnchor = own(entry, 'anchor'); // an own anchor counts as present whatever its value
  const anchor = hasAnchor ? entry.anchor : undefined;
  if ((!legacy || hasAnchor) && anchor !== 'any' && anchor !== 'root') throw policyError('POLICY_ANCHOR', location);
  if (unsupportedSyntax(glob)) throw policyError('POLICY_GLOB_SYNTAX', location);
  if (badGlobstar(glob)) throw policyError('POLICY_GLOBSTAR', location);
  if (badGlobPath(glob)) throw policyError('POLICY_GLOB_PATH', location);
  const inferred = glob.startsWith(ANY_PREFIX) ? 'any' : 'root';
  if (legacy && hasAnchor && anchor !== inferred) throw policyError('POLICY_LEGACY_ANCHOR', location);
  const effective = legacy ? inferred : anchor;
  if (effective === 'any' && !glob.startsWith(ANY_PREFIX)) throw policyError('POLICY_ANCHOR_ANY', location);
  if (effective === 'root' && glob.startsWith(ANY_PREFIX)) throw policyError('POLICY_ANCHOR_ROOT', location);
  return { anchor: effective, glob };
}

// A standalone entry (policyEntryKey, policyEntriesMayOverlap): shape first, then JSON data, then the schema-2 rules.
function readEntry(entry) {
  if (!isPlainObject(entry)) throw policyError('POLICY_ENTRY', 'entry');
  return checkEntry(cloneJson(entry, new Set()), 'entry', false);
}

const entryKey = (anchor, glob) => JSON.stringify([anchor, glob.toLowerCase()]);

// --------------------------------------------------------------- reading ----
/** Validates a whole schema-1 or schema-2 policy (plan 3.1, 3.4, 3.5) and returns a detached snapshot. Never writes. */
export function readSecurityPolicy(value) {
  if (!isPlainObject(value)) throw policyError('POLICY_ROOT');
  const policy = cloneJson(value, new Set());
  if (!own(policy, 'schema') || (policy.schema !== 1 && policy.schema !== 2)) throw policyError('POLICY_SCHEMA');
  const sourceSchema = policy.schema;
  const legacy = sourceSchema === 1;
  if (!own(policy, 'patterns') || !Array.isArray(policy.patterns)) throw policyError('POLICY_PATTERNS');
  if (own(policy, 'projectPatterns')) {
    if (!Array.isArray(policy.projectPatterns)) throw policyError('POLICY_PROJECT_PATTERNS');
  } else if (legacy) {
    define(policy, 'projectPatterns', []);
  } else {
    throw policyError('POLICY_PROJECT_PATTERNS');
  }
  const effectivePatterns = [];
  const byKey = new Map();
  for (const collection of ['patterns', 'projectPatterns']) {
    policy[collection].forEach((entry, index) => {
      const { anchor, glob } = checkEntry(entry, `${collection}[${index}]`, legacy);
      if (legacy && !own(entry, 'anchor')) define(entry, 'anchor', anchor);
      const key = entryKey(anchor, glob);
      let effective = byKey.get(key);
      if (!effective) {
        effective = { anchor, glob: glob.toLowerCase(), sources: [] };
        byKey.set(key, effective);
        effectivePatterns.push(effective);
      }
      effective.sources.push({ collection, index });
    });
  }
  policy.schema = POLICY_SCHEMA_VERSION;
  return { sourceSchema, policy, effectivePatterns };
}

/** Parses policy text (at most one initial BOM) and reads it. A parse error never echoes the text or the parser. */
export function parseSecurityPolicy(text) {
  if (typeof text !== 'string') throw policyError('POLICY_TEXT');
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let value;
  let parsed = false;
  try { value = JSON.parse(body); parsed = true; } catch { /* reported below, without the native message */ }
  if (!parsed) throw policyError('POLICY_JSON');
  return readSecurityPolicy(value);
}

/** Entry identity: the anchor and the lowercase glob. Windows aliases and Unicode forms are not part of it. */
export function policyEntryKey(entry) {
  const { anchor, glob } = readEntry(entry);
  return entryKey(anchor, glob);
}

// ------------------------------------------------------------ path checks ----
/** Plan 3.6: structural checks only. Returns the original string unchanged: no trim, case or Unicode change. */
export function validateRepoPath(value) {
  if (typeof value !== 'string' || value === '') throw policyError('POLICY_PATH_TYPE');
  if (value.includes('\u0000')) throw policyError('POLICY_PATH_NUL');
  if (value.startsWith('/') || value.startsWith('\\') || DRIVE.test(value)) throw policyError('POLICY_PATH_ABSOLUTE');
  if (value.includes('\\') || badComponents(value)) throw policyError('POLICY_PATH_CANONICAL');
  return value;
}

// --------------------------------------------------------------- matching ----
// A compiled glob is an array of components: GLOBSTAR, or an array of up to four alternatives, each an array of tokens
// (STAR, ONE, or a single code point). A terminal `**` becomes `*` then `**`: at least one more component.
const GLOBSTAR = 0;
const STAR = 1;
const ONE = 2;

function trimDotsAndSpaces(s) {
  let end = s.length;
  while (end > 0 && (s[end - 1] === '.' || s[end - 1] === ' ')) end--;
  return s.slice(0, end);
}

// PQ2 aliases of one (lowercase) component: itself, the nonempty prefix before the first ':', and both with trailing
// ASCII dots and spaces removed. An emptied alternative keeps the component's position; a component is never removed.
function alternatives(component) {
  const out = [component];
  const colon = component.indexOf(':');
  const prefix = colon > 0 ? component.slice(0, colon) : null;
  if (prefix !== null) out.push(prefix);
  out.push(trimDotsAndSpaces(component));
  if (prefix !== null) out.push(trimDotsAndSpaces(prefix));
  return [...new Set(out)];
}

const tokens = (s) => Array.from(s, (ch) => (ch === '*' ? STAR : ch === '?' ? ONE : ch));

function compileGlob(lowerGlob) {
  const parts = lowerGlob.split('/');
  const out = parts.map((c) => (c === '**' ? GLOBSTAR : alternatives(c).map(tokens)));
  if (parts[parts.length - 1] === '**') out.splice(out.length - 1, 0, [[STAR]]);
  return out;
}

const pathForms = (lowerPath) => lowerPath.split('/').map((c) => alternatives(c).map((alt) => Array.from(alt)));

// One segment against one path component, both as code-point arrays: O(|glob| * |path|), no backtracking.
function segmentMatches(glob, chars) {
  const n = chars.length;
  let prev = new Uint8Array(n + 1);
  prev[0] = 1;
  for (const t of glob) {
    const cur = new Uint8Array(n + 1);
    if (t === STAR) {
      let seen = 0;
      for (let j = 0; j <= n; j++) { seen |= prev[j]; cur[j] = seen; }
    } else {
      for (let j = 1; j <= n; j++) cur[j] = prev[j - 1] && (t === ONE || t === chars[j - 1]) ? 1 : 0;
    }
    prev = cur;
  }
  return prev[n] === 1;
}

const componentMatches = (globAlts, pathAlts) => globAlts.some((g) => pathAlts.some((p) => segmentMatches(g, p)));

// Whole glob against whole path, component by component, from the end: O(components(glob) * components(path)) cells.
function globMatches(compiled, path) {
  const n = path.length;
  let next = new Uint8Array(n + 1);
  next[n] = 1;
  for (let i = compiled.length - 1; i >= 0; i--) {
    const c = compiled[i];
    const cur = new Uint8Array(n + 1);
    if (c === GLOBSTAR) {
      cur[n] = next[n];
      for (let j = n - 1; j >= 0; j--) cur[j] = next[j] || cur[j + 1] ? 1 : 0;
    } else {
      for (let j = n - 1; j >= 0; j--) cur[j] = next[j + 1] && componentMatches(c, path[j]) ? 1 : 0;
    }
    next = cur;
  }
  return next[0] === 1;
}

/**
 * true when the path is protected by the policy. The complete policy (schema 1 or 2, not a snapshot wrapper) is
 * validated first, the candidate second; an invalid later entry fails even when an earlier one would match.
 */
export function matchesPolicyPath(path, policy) {
  const { effectivePatterns } = readSecurityPolicy(policy);
  const forms = pathForms(validateRepoPath(path).toLowerCase());
  return effectivePatterns.some((e) => globMatches(compileGlob(e.glob), forms));
}

// ---------------------------------------------------------------- overlap ----
// Product automata: a state is a position in each operand; every transition advances at least one of them, so one
// row-major pass over the table settles it.
function segmentsOverlap(a, b) {
  const w = b.length + 1;
  const reach = new Uint8Array((a.length + 1) * w);
  reach[0] = 1;
  for (let i = 0; i <= a.length; i++) {
    for (let j = 0; j <= b.length; j++) {
      if (!reach[i * w + j]) continue;
      const ta = a[i];
      const tb = b[j];
      if (ta === STAR) reach[(i + 1) * w + j] = 1;
      if (tb === STAR) reach[i * w + j + 1] = 1;
      if (i === a.length || j === b.length) continue;
      if (ta === STAR && tb === STAR) continue;
      if (ta === STAR) reach[i * w + j + 1] = 1;
      else if (tb === STAR) reach[(i + 1) * w + j] = 1;
      else if (ta === ONE || tb === ONE || ta === tb) reach[(i + 1) * w + j + 1] = 1;
    }
  }
  return reach[a.length * w + b.length] === 1;
}

const componentsOverlap = (a, b) => a.some((x) => b.some((y) => segmentsOverlap(x, y)));

function globsOverlap(a, b) {
  const w = b.length + 1;
  const reach = new Uint8Array((a.length + 1) * w);
  reach[0] = 1;
  for (let i = 0; i <= a.length; i++) {
    for (let j = 0; j <= b.length; j++) {
      if (!reach[i * w + j]) continue;
      const ca = a[i];
      const cb = b[j];
      if (ca === GLOBSTAR) reach[(i + 1) * w + j] = 1;
      if (cb === GLOBSTAR) reach[i * w + j + 1] = 1;
      if (i === a.length || j === b.length) continue;
      if (ca === GLOBSTAR && cb === GLOBSTAR) continue;
      if (ca === GLOBSTAR) reach[i * w + j + 1] = 1;
      else if (cb === GLOBSTAR) reach[(i + 1) * w + j] = 1;
      else if (componentsOverlap(ca, cb)) reach[(i + 1) * w + j + 1] = 1;
    }
  }
  return reach[a.length * w + b.length] === 1;
}

/**
 * true if and only if some alias form of the left glob and some alias form of the right glob match a common path
 * (C1-P4-1). Both entries are validated first, left then right. No permission-expression normalization and no
 * directory-prefix comparison: root `a/**` and root `a` do not overlap here.
 */
export function policyEntriesMayOverlap(left, right) {
  const l = readEntry(left);
  const r = readEntry(right);
  return globsOverlap(compileGlob(l.glob.toLowerCase()), compileGlob(r.glob.toLowerCase()));
}
