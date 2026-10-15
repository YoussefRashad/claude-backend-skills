// rc.1 case inventory, component assertion registry, suite selection and component execution.
//
// Plan: docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md sections 2.5, 3.1 and 3.3, with decisions G8, G9 and G11.
// Component assertions are sub-assertions (for example V2/C11a/tag-identity). They never produce a complete
// numbered case record; complete rc.1 cases are composed by C11b through registerRc1Cases.
//
// Importing this module performs no filesystem write, starts no process and runs no test. The test modules it
// imports are import-safe as well and load this module lazily, so there is no eager read across the cycle.
import { C11A_IMPLEMENTATIONS } from './c11a.test.mjs';

const deepFreeze = (v) => { if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); } return v; };
const ids = (s) => s.trim().split(/\s+/);

// ------------------------------------------------------------ inventory ----
// Plan 3.3, in its frozen order. G8: RC1 is the 38 numbered IDs then A5-templates and N8-doctor.
export const BASELINE_CASE_IDS = Object.freeze(ids(`
  R01 R02 R03a R03b R04a R04b R05 R06 R06b R07 R08 R09 R10 R11 R12
  R13a R13b R13c R13d R14a R14b R15 R16 R17 R18 R19 R20 R21 R22
  R23a R23b R24 R25 R26 R27a R27b R27c R27d R28 R29 R30 R31 R32
  R33 R34 R35 R36 R37 R38 R39 R40
  S01 S02 S03 S04 S05 S06 S07 S08 S09
`));
export const RC1_CASE_IDS = Object.freeze([...ids(`
  R41 R42 R43 R44 R45 R46 R47 R48 R49 R50 R51 R52 R53 R54
  R65 R66 R67 R68 R72 R73 R74 R75 R76 R77 R78 R79 R80 R81 R82
  R84 R85 R86 R90 R91 R92 R93 R97 R100
`), 'A5-templates', 'N8-doctor']);
export const REQUIRED_CASE_IDS = Object.freeze([...BASELINE_CASE_IDS, ...RC1_CASE_IDS]);

// ------------------------------------------------------------- registry ----
// Expected descriptors are written out here, never derived from the implementations (plan 2.5).
// C1-C10 add their own component keys to both maps.
export const COMPONENT_ASSERTIONS = deepFreeze({
  C11a: [
    { id: 'V2/C11a/tag-identity', name: 'trusted v2 tag identity' },
    { id: 'V2/C11a/snapshot-inventory', name: 'exhaustive v2 snapshot mapping' },
    { id: 'V2/C11a/snapshot-bytes', name: 'raw tagged snapshot byte parity' },
    { id: 'V2/C11a/installed-fixture', name: 'tagged v2 installation and provenance' },
    { id: 'V2/C11a/fixture-failures', name: 'v2 fixture failures are fatal' },
    { id: 'V2/C11a/live-v2', name: 'live v2 fixture and existing kinds' },
    { id: 'V2/C11a/component-records', name: 'strict component result contract' },
    { id: 'V2/C11a/strict-gate', name: 'strict rc1 acceptance contract' },
  ],
});
// The tests-lane descriptors themselves (same objects, same run functions), in a frozen list of our own.
export const COMPONENT_IMPLEMENTATIONS = Object.freeze({
  C11a: Object.freeze([...C11A_IMPLEMENTATIONS]),
});

// ------------------------------------------------------------ selection ----
// G11: every SUITE_* error carries the token in err.code and starts its message with it.
function suiteError(code, detail) {
  const e = new Error(`${code}: ${detail}`);
  e.code = code;
  return e;
}
const singleLine = (s) => typeof s === 'string' && s !== '' && !/[\r\n\u2028\u2029]/.test(s);

/**
 * Pure selection over { id, name, fn } cases, in registration order. `only` keeps the diagnostic substring match
 * against "<id> <name>"; `onlyId` matches the ID exactly. Returns the original case objects.
 */
export function selectSuiteCases(cases, options) {
  const o = options === undefined ? {} : options;
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw suiteError('SUITE_USAGE', 'options must be an object');
  const only = o.only === undefined ? null : o.only;
  const onlyId = o.onlyId === undefined ? null : o.onlyId;
  for (const [k, v] of [['only', only], ['onlyId', onlyId]]) {
    if (v !== null && (typeof v !== 'string' || v === '')) throw suiteError('SUITE_USAGE', `${k} must be a nonempty string`);
  }
  if (only !== null && onlyId !== null) throw suiteError('SUITE_USAGE', 'only and onlyId are mutually exclusive');
  if (!Array.isArray(cases)) throw suiteError('SUITE_CASE_INVALID', 'cases must be an array');
  cases.forEach((c, i) => {
    if (!c || typeof c !== 'object' || !singleLine(c.id) || !singleLine(c.name) || typeof c.fn !== 'function') {
      throw suiteError('SUITE_CASE_INVALID', `case ${i}`);
    }
  });
  const seen = new Set();
  for (const c of cases) {
    if (seen.has(c.id)) throw suiteError('SUITE_DUPLICATE_ID', c.id);
    seen.add(c.id);
  }
  const selected = cases.filter((c) => (onlyId !== null ? c.id === onlyId : only !== null ? `${c.id} ${c.name}`.includes(only) : true));
  if (!selected.length) throw suiteError('SUITE_EMPTY_SELECTION', onlyId !== null ? `no case has id ${onlyId}` : 'no case selected');
  return selected;
}

// --------------------------------------------------- component execution ----
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const zero = () => ({ passed: 0, failed: 0, skipped: 0 });

// Plan 3.1: the first structural error in category order, or null. G9: inventory-invalid always carries id.
function structuralIssue(component, registry) {
  const expectedMap = isObj(registry) ? registry.expected : undefined;
  if (!own(expectedMap, component) || expectedMap[component] === undefined) return { code: 'component-unknown' };
  const expected = expectedMap[component];
  const implMap = isObj(registry) ? registry.implementations : undefined;
  const impls = own(implMap, component) && implMap[component] !== undefined ? implMap[component] : [];
  if (!Array.isArray(expected) || !Array.isArray(impls)) return { code: 'inventory-invalid', id: null };
  // Within a category the first issue is the one with the earliest expected position; an issue with no expected
  // position (a malformed implementation ID, or an ID nobody expects) follows, in implementation order.
  const position = (id) => expected.findIndex((d) => isObj(d) && d.id === id);
  const invalid = [];
  expected.forEach((d, i) => {
    if (!isObj(d) || !singleLine(d.id)) invalid.push({ pos: i, id: null });
    else if (!singleLine(d.name)) invalid.push({ pos: i, id: d.id });
  });
  impls.forEach((m, i) => {
    if (!isObj(m) || !singleLine(m.id)) invalid.push({ pos: Infinity, at: i, id: null });
    else if (typeof m.run !== 'function') { const p = position(m.id); invalid.push({ pos: p < 0 ? Infinity : p, at: i, id: m.id }); }
  });
  if (invalid.length) {
    invalid.sort((a, b) => a.pos - b.pos || (a.at ?? -1) - (b.at ?? -1));
    return { code: 'inventory-invalid', id: invalid[0].id };
  }
  if (!expected.length) return { code: 'empty-inventory' };
  const expIds = expected.map((d) => d.id);
  const dupExp = expIds.find((id) => expIds.filter((x) => x === id).length > 1);
  if (dupExp !== undefined) return { code: 'duplicate-expected', id: dupExp };
  const implIds = impls.map((m) => m.id);
  const count = (id) => implIds.filter((x) => x === id).length;
  const dupImpl = expIds.find((id) => count(id) > 1) ?? implIds.find((id) => count(id) > 1);
  if (dupImpl !== undefined) return { code: 'duplicate-group', id: dupImpl };
  const extra = implIds.find((id) => !expIds.includes(id));
  if (extra !== undefined) return { code: 'unexpected-group', id: extra };
  const missing = expIds.find((id) => !implIds.includes(id));
  if (missing !== undefined) return { code: 'missing-group', id: missing };
  return null;
}

function outcomeFailures(outcome) {
  if (!isObj(outcome) || !Array.isArray(outcome.failures) || outcome.failures.some((f) => typeof f !== 'string')
    || !('skipped' in outcome) || (outcome.skipped !== null && typeof outcome.skipped !== 'string')) return ['invalid-outcome'];
  const failures = [...outcome.failures];
  if (outcome.skipped !== null) failures.push(`skip-forbidden: ${outcome.skipped}`); // a skip is never a pass
  return failures;
}

/** Validates the registry for one component, then runs each implementation once in expected order. */
export async function runComponentAssertions(component, context, { registry } = {}) {
  const reg = registry === undefined ? { expected: COMPONENT_ASSERTIONS, implementations: COMPONENT_IMPLEMENTATIONS } : registry;
  const issue = structuralIssue(component, reg);
  if (issue) return { component, ok: false, errors: [issue], summary: zero(), results: [] };
  const impls = reg.implementations[component];
  const results = [];
  for (const d of reg.expected[component]) {
    const impl = impls.find((m) => m.id === d.id);
    let failures;
    try { failures = outcomeFailures(await impl.run(context)); } catch (e) {
      failures = [`threw: ${e instanceof Error ? e.message : String(e)}`];
    }
    results.push({ id: d.id, name: d.name, status: failures.length ? 'FAIL' : 'PASS', failures });
  }
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.length - passed;
  return { component, ok: results.length > 0 && failed === 0, errors: [], summary: { passed, failed, skipped: 0 }, results };
}

/**
 * Registers complete rc.1 cases with the baseline runner: register(id, name, fn).
 * At C11a landing there are none; C11b composes them from the component assertions.
 */
export function registerRc1Cases(register, context) {
  void register;
  void context;
}
