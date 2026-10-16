// C1 tests lane: the twelve component assertions of "Shared policy grammar, matcher and version contract".
//
// Written from the frozen plan only, before any implementation exists:
//   docs/plans/2026-10-16-project-setup-v3-rc1-c1.md   (sections 2.3-2.5, 3, 4, 5 and the C1-P4-1 / C1-P4-2 addendum)
// Under the frozen architecture plan docs/plans/2026-10-15-project-setup-v3-rc1.md, the design decisions PQ1 and the
// simplified PQ2 (docs/design/project-setup-v3.md), and the landed C11a harness (tests/rc1-cases.mjs,
// tests/run-component-tests.mjs, tests/c11a.test.mjs). The implementer wires C1_IMPLEMENTATIONS into
// COMPONENT_IMPLEMENTATIONS.C1 and must not edit this file or tests/fixtures/security-policy-corpus.json.
//
// Importing this module runs nothing. Every production module (assets/tools/security-policy.mjs, scripts/lib.mjs,
// scripts/globs.mjs, scripts/schemas.mjs) and the registry modules (rc1-cases.mjs, run-component-tests.mjs; rc1-cases.mjs
// imports this file, so a static import back would be circular) are imported lazily inside run(context). A missing module,
// export or fixture fails one assertion with a diagnostic; it never breaks the import.
//
// PLAN-GAP (scope, not a value): plan 2.1 also assigns to the tests lane the R17 addition in tests/run-tests.mjs (an async callback that runs
// runComponentAssertions('C1', context) and fails R17 unless report.ok === true). The delegation brief limited this lane to the section 2.2 files
// (this file and tests/fixtures/security-policy-corpus.json), so that edit is not made here.
//
// Every run(context) returns { failures, skipped: null }. There is no skip path. Scratch data lives under context.tmp only.
// Every expected value below is exact and comes from the plan; each group quotes the plan section or row IDs it rests on.
// Rows labelled "accepted residual (PQ2)" assert the actual, unprotected result the plan states (plan 5.1).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// ===================================================== generic utilities ====
const eq = (a, b) => isDeepStrictEqual(a, b);
const hasOwn = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const errMsg = (e) => String((e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) || e).slice(0, 500);
// Diagnostics are ASCII-only whatever the data holds.
function show(v) {
  let s;
  try { s = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? String(x) : x)) ?? String(v)); } catch { s = String(v); }
  return s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 400);
}
function mkCheck(failures) { return (cond, msg, detail) => { if (!cond) failures.push(detail === undefined ? msg : `${msg} :: ${show(detail)}`); }; }
function deepFreeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }
function deepFrozen(v) { if (v === null || typeof v !== 'object') return true; return Object.isFrozen(v) && Object.values(v).every(deepFrozen); }
const sorted = (a) => [...a].sort();

// Runs one assertion body. `step` isolates sections so one failing section never hides the others.
async function runAssertion(body) {
  const failures = [];
  const check = mkCheck(failures);
  const step = async (name, fn) => { try { await fn(); } catch (e) { failures.push(`${name}: threw: ${errMsg(e)}`); } };
  try { await body({ failures, check, step }); } catch (e) { failures.push(`threw: ${errMsg(e)}`); }
  return { failures, skipped: null };
}
async function attempt(fn) { try { return { threw: false, value: await fn() }; } catch (e) { return { threw: true, error: e }; } }

const policyUrl = (context) => pathToFileURL(path.join(context.skillRoot, 'assets', 'tools', 'security-policy.mjs')).href;
const scriptUrl = (context, name) => pathToFileURL(path.join(context.skillRoot, 'scripts', name)).href;
async function importOrFail(failures, url, label) {
  try { return await import(url); } catch (e) { failures.push(`cannot import ${label}: ${errMsg(e)}`); return null; }
}
const needPolicy = (failures, context) => importOrFail(failures, policyUrl(context), 'assets/tools/security-policy.mjs');
const needScript = (failures, context, name) => importOrFail(failures, scriptUrl(context, name), `scripts/${name}`);
const needSibling = (failures, rel) => importOrFail(failures, new URL(rel, import.meta.url).href, `tests/${rel}`);
function needFns(failures, mod, names) {
  const missing = names.filter((n) => typeof (mod && mod[n]) !== 'function');
  if (missing.length) failures.push(`missing exports: ${missing.join(', ')}`);
  return missing.length === 0;
}

function scratchDir(context, label) {
  fs.mkdirSync(context.tmp, { recursive: true });
  return fs.mkdtempSync(path.join(context.tmp, `c1-${label}-`));
}
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };
async function withScratch(context, label, fn) {
  const dir = scratchDir(context, label);
  try { return await fn(dir); } finally { rmrf(dir); }
}
const readBytes = (p) => { try { return fs.readFileSync(p); } catch { return null; } };

// ============================================================ literals ====
// Written out independently of the implementation (plan 4.1, 4.2: "The tests lane embeds independent expected literals").
const COMPONENT_INVENTORY = [
  ['R45/C1/grammar', 'policy grammar and PQ1 rejection'],
  ['R45/C1/schema', 'strict policy schemas and errors'],
  ['R44/C1/anchors', 'root and any-depth matching'],
  ['R74/C1/case', 'platform-independent case matching'],
  ['R74/C1/corpus', 'shared policy matching corpus'],
  ['R74/C1/deduplication', 'effective entries preserve source metadata'],
  ['R75/C1/path-validation', 'structural checks preserve exact path names'],
  ['R78/C1/legacy-adapter', 'validated non-writing schema-1 adapter'],
  ['R97/C1/environment-names', 'environment-name variant matching'],
  ['V2/C1/source-helpers', 'source helpers use shared policy semantics'],
  ['V2/C1/exception-overlap', 'user exception overlap stays conservative'],
  ['V2/C1/module-contract', 'standalone module and component contracts'],
];
const EXPECTED_DESCRIPTORS = COMPONENT_INVENTORY.map(([id, name]) => ({ id, name }));
const C11A_DESCRIPTORS = [
  { id: 'V2/C11a/tag-identity', name: 'trusted v2 tag identity' },
  { id: 'V2/C11a/snapshot-inventory', name: 'exhaustive v2 snapshot mapping' },
  { id: 'V2/C11a/snapshot-bytes', name: 'raw tagged snapshot byte parity' },
  { id: 'V2/C11a/installed-fixture', name: 'tagged v2 installation and provenance' },
  { id: 'V2/C11a/fixture-failures', name: 'v2 fixture failures are fatal' },
  { id: 'V2/C11a/live-v2', name: 'live v2 fixture and existing kinds' },
  { id: 'V2/C11a/component-records', name: 'strict component result contract' },
  { id: 'V2/C11a/strict-gate', name: 'strict rc1 acceptance contract' },
];
const MODULE_EXPORTS = ['POLICY_SCHEMA_VERSION', 'matchesPolicyPath', 'parseSecurityPolicy', 'policyEntriesMayOverlap', 'policyEntryKey', 'readSecurityPolicy', 'validateRepoPath'];
const CASE_EXPORTS = ['C1_IMPLEMENTATIONS'];

// The 19 effective entries of the immutable v2 snapshot, in order (plan 4.9).
const V2_GLOBS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.crt', '**/*.cer', '**/*.jks', '**/*.keystore',
  '**/id_rsa*', '**/id_ed25519*', '**/secrets/**', '**/credentials/**', '**/.aws/**', '**/.ssh/**', '**/.gnupg/**', '**/.npmrc',
  '**/.ai/.run/*/vault/**',
];

// ----------------------------------------------------------------- errors ----
// Plan 3.5: these 20 codes and message suffixes are exact. <L> is "entry", "patterns[i]" or "projectPatterns[i]".
// BEGIN CORPUS
const SUFFIX = {
  POLICY_TEXT: () => 'policy text must be a string',
  POLICY_JSON: () => 'policy text must be valid JSON',
  POLICY_ROOT: () => 'policy must be a JSON object',
  POLICY_VALUE: () => 'policy must contain only JSON data',
  POLICY_SCHEMA: () => 'policy.schema must be 1 or 2',
  POLICY_PATTERNS: () => 'policy.patterns must be an array',
  POLICY_PROJECT_PATTERNS: () => 'policy.projectPatterns must be an array',
  POLICY_ENTRY: (L) => `${L} must be an object`,
  POLICY_GLOB: (L) => `${L}.glob must be a nonempty string`,
  POLICY_ANCHOR: (L) => `${L}.anchor must be "any" or "root"`,
  POLICY_GLOB_SYNTAX: (L) => `${L}.glob uses unsupported syntax`,
  POLICY_GLOBSTAR: (L) => `${L}.glob must use * or a separate **/ component; ** must be a whole component`,
  POLICY_GLOB_PATH: (L) => `${L}.glob must be a canonical repository-relative glob`,
  POLICY_ANCHOR_ANY: (L) => `${L}.glob must start with **/ for anchor "any"`,
  POLICY_ANCHOR_ROOT: (L) => `${L}.glob must not start with **/ for anchor "root"`,
  POLICY_LEGACY_ANCHOR: (L) => `${L}.anchor conflicts with the inferred legacy anchor`,
  POLICY_PATH_TYPE: () => 'path must be a nonempty string',
  POLICY_PATH_NUL: () => 'path must not contain NUL',
  POLICY_PATH_ABSOLUTE: () => 'path must be repository-relative',
  POLICY_PATH_CANONICAL: () => 'path must use canonical POSIX components',
};
const message = (code, loc) => `${code}: ${SUFFIX[code](loc)}`;

// ---------------------------------------------------------------- corpus ----
// Plan 4.2-4.6, 4.10: 78 matching rows (A01-A10, W01-W30, C01-C08 + C11, B01-B09 + B12, E01-E19) and the 27 rejected
// entries G01-G27. Quoted JSON strings in the plan tables denote decoded values; non-ASCII is written as \u escapes.
const M = (id, anchor, glob, p, expected) => ({ id, entry: { anchor, glob }, path: p, expected });
const A_ROWS = [
  M('A01', 'root', 'env/**', 'env/key', true),
  M('A02', 'root', 'env/**', 'src/env/key', false),
  M('A03', 'any', '**/env/**', 'env/key', true),
  M('A04', 'any', '**/env/**', 'src/env/key', true),
  M('A05', 'root', 'key.pem', 'key.pem', true),
  M('A06', 'root', 'key.pem', 'src/key.pem', false),
  M('A07', 'any', '**/key.pem', 'key.pem', true),
  M('A08', 'any', '**/key.pem', 'src/key.pem', true),
  M('A09', 'root', 'env/**', 'env', false),
  M('A10', 'root', '**', 'src/file', true),
];
const W_ROWS = [
  M('W01', 'root', 'a/*/b', 'a/x/b', true),
  M('W02', 'root', 'a/*/b', 'a/x/y/b', false),
  M('W03', 'root', 'a/*/b', 'a/b', false),
  M('W04', 'root', 'a/**/b', 'a/b', true),
  M('W05', 'root', 'a/**/b', 'a/x/y/b', true),
  M('W06', 'root', 'a/**/b', 'x/a/b', false),
  M('W07', 'root', 'a/**', 'a/b/c', true),
  M('W08', 'root', 'a/**', 'a', false),
  M('W09', 'root', 'a/**/**/b', 'a/b', true),
  M('W10', 'root', 'a/**/**/b', 'a/x/y/b', true),
  M('W11', 'any', '**/*.pem', '.pem', true),
  M('W12', 'any', '**/*.pem', 'x/key.pem', true),
  M('W13', 'any', '**/*.pem', 'x/key.pem.txt', false),
  M('W14', 'root', 'key?.pem', 'key1.pem', true),
  M('W15', 'root', 'key?.pem', 'key.pem', false),
  M('W16', 'root', 'key?.pem', 'key12.pem', false),
  M('W17', 'root', 'a*b', 'ab', true),
  M('W18', 'root', 'a*b', 'a/x/b', false),
  M('W19', 'root', 'dir/*', 'dir/.hidden', true),
  M('W20', 'root', 'dir/*', 'dir/a\nb', true),
  M('W21', 'root', 'dir/?', 'dir/\ud83d\ude00', true),
  M('W22', 'root', 'a+b.(txt)', 'a+b.(txt)', true),
  M('W23', 'root', 'a+b.(txt)', 'abXtxt', false),
  M('W24', 'root', 'a|b', 'a|b', true),
  M('W25', 'root', 'a.$^', 'a.$^', true),
  M('W26', 'any', '**/**/x', 'x', true),
  M('W27', 'root', 'dir/?', 'dir/\r', true),
  M('W28', 'root', 'dir/*', 'dir/a\rb', true),
  M('W29', 'root', 'dir/?', 'dir/\u2028', true),
  M('W30', 'root', 'dir/*', 'dir/a\u2028b', true),
];
const C_ROWS = [
  M('C01', 'any', '**/*.PEM', 'src/Key.pem', true),
  M('C02', 'root', 'ENV/**', 'env/Key', true),
  M('C03', 'root', 'ENV/**', 'src/env/Key', false),
  M('C04', 'root', '\u00c9.pem', '\u00e9.PEM', true),
  M('C05', 'root', '\u00e9.pem', 'e\u0301.pem', false),
  M('C06', 'root', '\u212a.pem', 'k.pem', true),
  M('C07', 'any', '**/secrets/**', '\u017fecrets/x', false),
  M('C08', 'root', 'i\u0307.pem', '\u0130.PEM', true),
  M('C11', 'root', '?.pem', '\u0130.pem', false),
];
const B_ROWS = [
  M('B01', 'any', '**/.env', '.env::$DATA', true),
  M('B02', 'any', '**/.env', '.env.', true),
  M('B03', 'any', '**/.env', '.env ', true),
  M('B04', 'root', 'secrets/**', 'secrets::$INDEX_ALLOCATION/t', true),
  M('B05', 'any', '**/.env', '.env. :$DATA', true),
  M('B06', 'root', 'notes.txt.', 'notes.txt', true),
  M('B07', 'root', 'notes.txt', 'notes.txt.', true),
  M('B08', 'root', 'secrets/t', 'secrets::$INDEX_ALLOCATION/t. ', true),
  M('B09', 'root', 'foo', ':foo', false),
  M('B12', 'root', 'secrets/t', 'secrets/.../t', false),
];
const E_ROWS = [
  M('E01', 'any', '**/.env*', '.env', true),
  M('E02', 'any', '**/.env*', '.env.local', true),
  M('E03', 'any', '**/.env*', '.envrc', true),
  M('E04', 'any', '**/.env*', '.env-prod', true),
  M('E05', 'any', '**/.env*', '.env.example', true),
  M('E06', 'any', '**/.env*', '.env.sample', true),
  M('E07', 'any', '**/.env*', '.env.template', true),
  M('E08', 'any', '**/.env*', 'src/.envrc', true),
  M('E09', 'any', '**/.env*', 'src/deep/.env-prod', true),
  M('E10', 'any', '**/.env*', 'SRC/.ENVRC', true),
  M('E11', 'any', '**/.env*', 'src/.EnV.ExAmPlE', true),
  M('E12', 'any', '**/.env*', 'env', false),
  M('E13', 'any', '**/.env*', 'dotenv', false),
  M('E14', 'any', '**/.env*', 'x.env', false),
  M('E15', 'any', '**/.env*', '.en', false),
  M('E16', 'any', '**/.env*', '.envdir/file.txt', false),
  M('E17', 'any', '**/.env*', '.env::$DATA', true),
  M('E18', 'any', '**/.env*', '.env.', true),
  M('E19', 'any', '**/.env*', '.env ', true),
];
const MATCH_ROWS = [...A_ROWS, ...W_ROWS, ...C_ROWS, ...B_ROWS, ...E_ROWS];
const G = (id, anchor, glob, code) => ({ id, entry: { anchor, glob }, code, message: message(code, 'entry') });
const G_ROWS = [
  G('G01', 'root', 'a**b', 'POLICY_GLOBSTAR'),
  G('G02', 'root', 'key**.pem', 'POLICY_GLOBSTAR'),
  G('G03', 'root', '**x', 'POLICY_GLOBSTAR'),
  G('G04', 'root', 'x**', 'POLICY_GLOBSTAR'),
  G('G05', 'root', '***', 'POLICY_GLOBSTAR'),
  G('G06', 'any', '**/a***b', 'POLICY_GLOBSTAR'),
  G('G07', 'any', '**/****/x', 'POLICY_GLOBSTAR'),
  G('G08', 'any', '**/[ab].pem', 'POLICY_GLOB_SYNTAX'),
  G('G09', 'any', '**/x].pem', 'POLICY_GLOB_SYNTAX'),
  G('G10', 'any', '**/{a,b}.pem', 'POLICY_GLOB_SYNTAX'),
  G('G11', 'root', 'key\\*.pem', 'POLICY_GLOB_SYNTAX'),
  G('G12', 'root', '!key.pem', 'POLICY_GLOB_SYNTAX'),
  G('G13', 'root', '~/key.pem', 'POLICY_GLOB_SYNTAX'),
  G('G14', 'root', ':(glob)key.pem', 'POLICY_GLOB_SYNTAX'),
  G('G15', 'root', '@(key).pem', 'POLICY_GLOB_SYNTAX'),
  G('G16', 'root', '?(key).pem', 'POLICY_GLOB_SYNTAX'),
  G('G17', 'root', '/key.pem', 'POLICY_GLOB_PATH'),
  G('G18', 'root', 'C:/key.pem', 'POLICY_GLOB_PATH'),
  G('G19', 'root', 'C:key.pem', 'POLICY_GLOB_PATH'),
  G('G20', 'root', './key.pem', 'POLICY_GLOB_PATH'),
  G('G21', 'root', 'a/../key.pem', 'POLICY_GLOB_PATH'),
  G('G22', 'root', 'a//key.pem', 'POLICY_GLOB_PATH'),
  G('G23', 'root', 'a/', 'POLICY_GLOB_PATH'),
  G('G24', 'any', 'key.pem', 'POLICY_ANCHOR_ANY'),
  G('G25', 'root', '**/key.pem', 'POLICY_ANCHOR_ROOT'),
  G('G26', 'root', 'key*(1).pem', 'POLICY_GLOB_SYNTAX'),
  G('G27', 'root', 'a/+(b)', 'POLICY_GLOB_SYNTAX'),
];
// END CORPUS
const RESIDUAL = new Set(['C05', 'C07', 'C11', 'B12']); // plan 4.6 and 5.1: "accepted residual (PQ2)"
const residualNote = (id) => (RESIDUAL.has(id) ? ' [accepted residual (PQ2): the unprotected result]' : '');
const rowsOf = (...lists) => lists.flat();
const rowIds = (rows) => rows.map((r) => r.id);

// ---------------------------------------------------- policy construction ----
const BASE = () => ({ schema: 2, patterns: [], projectPatterns: [] });
const OKENTRY = () => ({ anchor: 'any', glob: '**/ok.pem' });
const policyOf = (patterns = [], projectPatterns = [], schema = 2) => ({ schema, patterns, projectPatterns });
function placements(entry) {
  return [
    ['patterns', policyOf([{ ...entry }], [])],
    ['projectPatterns', policyOf([], [{ ...entry }])],
  ];
}
const DEDUP_INPUT = () => ({
  schema: 2,
  note: 'keep',
  patterns: [
    { glob: '**/*.PEM', anchor: 'any', kind: 'key', note: 'managed' },
    { glob: 'env/**', anchor: 'root', kind: 'dir' },
  ],
  projectPatterns: [
    { glob: '**/*.pem', anchor: 'any', note: 'user' },
    { glob: '**/*.PEM', anchor: 'any', extra: { ticket: 7 } },
  ],
});
const DEDUP_EFFECTIVE = [
  { anchor: 'any', glob: '**/*.pem', sources: [{ collection: 'patterns', index: 0 }, { collection: 'projectPatterns', index: 0 }, { collection: 'projectPatterns', index: 1 }] },
  { anchor: 'root', glob: 'env/**', sources: [{ collection: 'patterns', index: 1 }] },
];

// ------------------------------------------------------- error checking ----
// Plan 3.5: ordinary Error instances with name "Error", an own string code, and a message that starts with the code.
async function expectError(check, label, fn, code, loc = 'entry') {
  const r = await attempt(fn);
  if (!r.threw) { check(false, `${label}: expected ${code}, got a result`, r.value); return null; }
  const e = r.error;
  check(e instanceof Error && Object.getPrototypeOf(e) === Error.prototype && e.name === 'Error', `${label}: an ordinary Error instance named "Error"`, e && e.constructor && e.constructor.name);
  check(hasOwn(e, 'code') && e.code === code, `${label}: own string code ${code}`, { ownCode: hasOwn(e, 'code'), code: e && e.code, message: e && e.message });
  check(e && e.message === message(code, loc), `${label}: message is exactly ${show(message(code, loc))}`, e && e.message);
  return e;
}
// Reads every row in both placements (plan 4.2: "For every row, test both placements").
async function checkRows(check, m, rows) {
  for (const r of rows) {
    for (const [where, pol] of placements(r.entry)) {
      const got = await attempt(() => m.matchesPolicyPath(r.path, pol));
      check(!got.threw && got.value === r.expected, `${r.id} in ${where}: ${r.entry.anchor} ${show(r.entry.glob)} vs ${show(r.path)} must be ${r.expected}${residualNote(r.id)}`, got.threw ? errMsg(got.error) : got.value);
    }
  }
}

// Structural helpers: every output object has Object.prototype, every output array has Array.prototype (plan 2.3), and the
// output shares no object with the input (returned data is detached).
function protoIssues(v, where = '$', seen = new Set()) {
  const out = [];
  if (v === null || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) out.push(`${where}: array prototype`);
    v.forEach((x, i) => out.push(...protoIssues(x, `${where}[${i}]`, seen)));
  } else {
    if (Object.getPrototypeOf(v) !== Object.prototype) out.push(`${where}: object prototype`);
    for (const k of Object.keys(v)) out.push(...protoIssues(v[k], `${where}.${k}`, seen));
  }
  return out;
}
function objectsOf(v, into = new Set()) {
  if (v === null || typeof v !== 'object' || into.has(v)) return into;
  into.add(v);
  for (const k of Object.keys(v)) objectsOf(v[k], into);
  return into;
}
function sharedObjects(input, output) {
  const inSet = objectsOf(input);
  return [...objectsOf(output)].filter((o) => inSet.has(o)).length;
}

// ------------------------------------------------------- import safety ----
// Same criteria as C11a's checkImportSafe (plan 4.12): no spawn, no filesystem write, no output, no process.exit, no exit code.
const PROBE_SOURCE = [
  "import cp from 'node:child_process';",
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  "const log = { spawns: [], writes: [], stdout: [], stderr: [], exits: [], err: null, names: [], exitCode: null };",
  "for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) { const o = cp[k]; cp[k] = function () { log.spawns.push(k); return o.apply(this, arguments); }; }",
  "const W = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'cpSync', 'symlinkSync', 'linkSync', 'truncateSync', 'createWriteStream', 'writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp', 'symlink'];",
  "for (const k of W) { if (typeof fs[k] === 'function') { const o = fs[k]; fs[k] = function () { log.writes.push(k); return o.apply(this, arguments); }; } }",
  "for (const k of W) { if (typeof fs.promises[k] === 'function') { const o = fs.promises[k]; fs.promises[k] = function () { log.writes.push('promises.' + k); return o.apply(this, arguments); }; } }",
  "const ow = process.stdout.write, ew = process.stderr.write;",
  "process.stdout.write = function (c) { log.stdout.push(String(c)); return true; };",
  "process.stderr.write = function (c) { log.stderr.push(String(c)); return true; };",
  "process.exit = function (c) { log.exits.push(c === undefined ? null : c); };",
  "syncBuiltinESMExports();",
  "const before = process.exitCode;",
  "try { const m = await import(process.argv[2]); log.names = Object.keys(m).sort(); } catch (e) { log.err = String(e && e.message ? e.message : e); }",
  "log.exitCode = process.exitCode === before || process.exitCode === undefined ? null : process.exitCode;",
  "process.stdout.write = ow; process.stderr.write = ew;",
  "process.stdout.write(JSON.stringify(log) + '\\n');",
].join('\n') + '\n';
function checkImportSafe(check, label, context, dir, url, expectNames) {
  const file = path.join(dir, `probe-${Math.random().toString(36).slice(2, 8)}.mjs`);
  fs.writeFileSync(file, PROBE_SOURCE);
  const r = spawnSync(process.execPath, [file, url], { cwd: dir, env: { ...context.env }, encoding: 'utf8', windowsHide: true, shell: false, timeout: 60000 });
  let log = null; try { log = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { /* reported below */ }
  check(r.status === 0 && log, `${label}: the import probe ran`, { status: r.status, stderr: String(r.stderr).slice(0, 300), stdout: String(r.stdout).slice(0, 300) });
  if (!log) return null;
  check(log.err === null, `${label}: imports cleanly`, log.err);
  check(log.spawns.length === 0, `${label}: import spawns no subprocess`, log.spawns);
  check(log.writes.length === 0, `${label}: import writes nothing`, log.writes);
  check(log.stdout.length === 0 && log.stderr.length === 0, `${label}: import prints nothing`, { out: log.stdout.join('').slice(0, 200), err: log.stderr.join('').slice(0, 200) });
  check(log.exits.length === 0 && log.exitCode === null, `${label}: import neither exits nor sets an exit code`, { exits: log.exits, exitCode: log.exitCode });
  if (expectNames) check(eq(log.names, sorted(expectNames)), `${label}: the export set is exactly ${expectNames.join(', ')}`, log.names);
  return log;
}

// Runs fn while recording (and swallowing) any attempt to write a process stream or exit.
async function withStreamGuard(fn) {
  const rec = { out: [], err: [], exits: [], value: undefined, threw: null };
  const ow = process.stdout.write, ew = process.stderr.write, ex = process.exit, code0 = process.exitCode;
  const cb = (rest) => { const f = rest.find((x) => typeof x === 'function'); if (f) f(); };
  process.stdout.write = function (c, ...rest) { rec.out.push(String(c)); cb(rest); return true; };
  process.stderr.write = function (c, ...rest) { rec.err.push(String(c)); cb(rest); return true; };
  process.exit = function (c) { rec.exits.push(c); throw new Error('process.exit called'); };
  try { rec.value = await fn(); } catch (e) { rec.threw = e; } finally { process.stdout.write = ow; process.stderr.write = ew; process.exit = ex; }
  rec.exitCodeChanged = process.exitCode !== code0;
  return rec;
}

// ===================================================== R45/C1/grammar ====
// Plan 3.2, 3.5 and 4.4.
async function grammar(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['readSecurityPolicy', 'policyEntryKey', 'policyEntriesMayOverlap', 'matchesPolicyPath'])) return;
    const keyOf = (anchor, glob) => () => m.policyEntryKey({ anchor, glob });

    await step('4.4 G01-G27 reject through policyEntryKey with location "entry"', async () => {
      for (const r of G_ROWS) await expectError(check, `${r.id} ${r.entry.anchor} ${show(r.entry.glob)}`, keyOf(r.entry.anchor, r.entry.glob), r.code, 'entry');
    });
    // PLAN-GAP: plan 4.4 lists the supplementary invalid globs without an anchor. They run as anchor "root"; the outcome does not depend
    // on it, because the syntax and structural checks (3.5 entry order, steps 4 and 6) come before the anchor-prefix check (step 8).
    const SUPPLEMENTARY = [
      ['*(key)', 'POLICY_GLOB_SYNTAX'], ['+(key)', 'POLICY_GLOB_SYNTAX'], ['!(key)', 'POLICY_GLOB_SYNTAX'],
      ['a\u0000b', 'POLICY_GLOB_PATH'], ['a/./b', 'POLICY_GLOB_PATH'], ['.', 'POLICY_GLOB_PATH'], ['..', 'POLICY_GLOB_PATH'],
      ['//server/share', 'POLICY_GLOB_PATH'],
    ];
    await step('4.4 supplementary invalid globs', async () => {
      for (const [glob, code] of SUPPLEMENTARY) await expectError(check, `supplementary root ${show(glob)}`, keyOf('root', glob), code, 'entry');
    });
    await step('4.4 G01-G27 and the supplements repeated inside both policy arrays report indexed locations', async () => {
      const all = [...G_ROWS.map((r) => [r.id, r.entry, r.code]), ...SUPPLEMENTARY.map(([glob, code], i) => [`S${i + 1}`, { anchor: 'root', glob }, code])];
      for (const [id, entry, code] of all) {
        const make = (patterns, projectPatterns) => () => m.readSecurityPolicy(policyOf(patterns, projectPatterns));
        await expectError(check, `${id} at patterns[0]`, make([{ ...entry }], []), code, 'patterns[0]');
        await expectError(check, `${id} at patterns[2]`, make([OKENTRY(), OKENTRY(), { ...entry }], []), code, 'patterns[2]');
        await expectError(check, `${id} at projectPatterns[0]`, make([OKENTRY()], [{ ...entry }]), code, 'projectPatterns[0]');
        await expectError(check, `${id} at projectPatterns[1]`, make([], [OKENTRY(), { ...entry }]), code, 'projectPatterns[1]');
        await expectError(check, `${id} through matchesPolicyPath`, () => m.matchesPolicyPath('src/ok.pem', policyOf([OKENTRY(), { ...entry }], [])), code, 'patterns[1]');
      }
    });
    await step('4.4 valid PQ1 examples A07, W04, W07 (and adjacent globstars W09, W26) pass reader and key validation', async () => {
      const valid = [['any', '**/key.pem', '["any","**/key.pem"]'], ['root', 'a/**/b', '["root","a/**/b"]'], ['root', 'a/**', '["root","a/**"]'],
        ['root', 'a/**/**/b', '["root","a/**/**/b"]'], ['any', '**/**/x', '["any","**/**/x"]']];
      for (const [anchor, glob, key] of valid) {
        for (const [where, pol] of placements({ anchor, glob })) {
          const r = await attempt(() => m.readSecurityPolicy(pol));
          check(!r.threw, `${anchor} ${show(glob)} passes the reader in ${where}`, r.threw ? errMsg(r.error) : null);
        }
        const k = await attempt(keyOf(anchor, glob));
        check(!k.threw && k.value === key, `${anchor} ${show(glob)} has the key ${key}`, k.threw ? errMsg(k.error) : k.value);
      }
    });
    await step('4.4 an invalid operand of policyEntriesMayOverlap reports location "entry" for either argument', async () => {
      const bad = [...G_ROWS.map((r) => [r.id, r.entry, r.code]), ...SUPPLEMENTARY.map(([glob, code], i) => [`S${i + 1}`, { anchor: 'root', glob }, code])];
      for (const [id, entry, code] of bad) {
        await expectError(check, `${id} as the left operand`, () => m.policyEntriesMayOverlap({ ...entry }, OKENTRY()), code, 'entry');
        await expectError(check, `${id} as the right operand`, () => m.policyEntriesMayOverlap(OKENTRY(), { ...entry }), code, 'entry');
      }
    });
    await step('4.4 with two invalid operands the left error wins', async () => {
      const g = (id) => G_ROWS.find((r) => r.id === id);
      for (const [l, r] of [['G01', 'G08'], ['G08', 'G01'], ['G17', 'G24'], ['G24', 'G17'], ['G12', 'G05']]) {
        await expectError(check, `left ${l}, right ${r}`, () => m.policyEntriesMayOverlap({ ...g(l).entry }, { ...g(r).entry }), g(l).code, 'entry');
      }
    });
    await step('3.5 standalone entry shape: non-plain, array and Proxy entries are POLICY_ENTRY', async () => {
      const trapped = []; const handler = {};
      for (const t of ['defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'has', 'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf']) handler[t] = (...a) => { trapped.push(t); return Reflect[t](...a); };
      class Klass { constructor() { this.anchor = 'any'; this.glob = '**/x'; } }
      const revoked = Proxy.revocable({}, {}); revoked.revoke();
      const cases = [['null', () => null], ['an array', () => []], ['a string', () => 'x'], ['a Date', () => new Date(0)], ['a Map', () => new Map()],
        ['a class instance', () => new Klass()], ['a Proxy', () => new Proxy({ anchor: 'any', glob: '**/x' }, handler)], ['a revoked Proxy', () => revoked.proxy]];
      for (const [label, make] of cases) {
        await expectError(check, `policyEntryKey(${label})`, () => m.policyEntryKey(make()), 'POLICY_ENTRY', 'entry');
        await expectError(check, `policyEntriesMayOverlap(${label}, valid)`, () => m.policyEntriesMayOverlap(make(), OKENTRY()), 'POLICY_ENTRY', 'entry');
      }
      check(trapped.length === 0, 'no Proxy trap runs while an entry is rejected', trapped);
    });
    await step('3.5 standalone entry: glob and anchor are required, and the anchor is explicit', async () => {
      for (const [label, entry] of [['missing glob', { anchor: 'any' }], ['empty glob', { anchor: 'any', glob: '' }], ['numeric glob', { anchor: 'any', glob: 5 }], ['null glob', { anchor: 'any', glob: null }]]) {
        await expectError(check, `policyEntryKey with a ${label}`, () => m.policyEntryKey(entry), 'POLICY_GLOB', 'entry');
      }
      for (const [label, entry] of [['missing anchor', { glob: '**/x' }], ['empty anchor', { anchor: '', glob: '**/x' }], ['ANY', { anchor: 'ANY', glob: '**/x' }], ['Root', { anchor: 'Root', glob: 'x' }],
        ['null anchor', { anchor: null, glob: '**/x' }], ['numeric anchor', { anchor: 1, glob: '**/x' }]]) {
        await expectError(check, `policyEntryKey with ${label}`, () => m.policyEntryKey(entry), 'POLICY_ANCHOR', 'entry');
      }
    });
    await step('3.5 standalone entry: JSON data is checked, and the entry order of checks holds', async () => {
      await expectError(check, 'function metadata on a standalone entry', () => m.policyEntryKey({ anchor: 'any', glob: '**/x', note: () => 1 }), 'POLICY_VALUE');
      await expectError(check, 'JSON data is checked before the remaining entry rules', () => m.policyEntryKey({ anchor: 'root', glob: 'a**b', note: () => 1 }), 'POLICY_VALUE');
      await expectError(check, 'glob error beats anchor error', () => m.policyEntryKey({ anchor: 'bogus', glob: '' }), 'POLICY_GLOB', 'entry');
      await expectError(check, 'anchor error beats syntax error', () => m.policyEntryKey({ anchor: 'bogus', glob: '[a]' }), 'POLICY_ANCHOR', 'entry');
      await expectError(check, 'syntax error beats globstar error', () => m.policyEntryKey({ anchor: 'root', glob: '[a]**b' }), 'POLICY_GLOB_SYNTAX', 'entry');
      await expectError(check, 'globstar error beats path error', () => m.policyEntryKey({ anchor: 'root', glob: '/a**b' }), 'POLICY_GLOBSTAR', 'entry');
      await expectError(check, 'path error beats the root anchor-prefix error', () => m.policyEntryKey({ anchor: 'root', glob: '**/a//b' }), 'POLICY_GLOB_PATH', 'entry');
      await expectError(check, 'path error beats the any anchor-prefix error', () => m.policyEntryKey({ anchor: 'any', glob: 'a//b' }), 'POLICY_GLOB_PATH', 'entry');
    });
    await step('2.3 policyEntryKey ignores extra metadata and never mutates the entry', async () => {
      const entry = deepFreeze({ anchor: 'any', glob: '**/X.pem', kind: 'key', extra: { n: [1, 2] } });
      const k = await attempt(() => m.policyEntryKey(entry));
      check(!k.threw && k.value === '["any","**/x.pem"]', 'the key depends on anchor and lowercase glob only', k.threw ? errMsg(k.error) : k.value);
    });
  });
}

// ===================================================== R45/C1/schema ====
// Plan 3.1, 3.5 and 4.5: strict schemas, the JSON-domain pass, parsing, and checkSecurityPolicy classification.
const JD_PRIMS = [['a function', () => () => 1], ['a symbol', () => Symbol('s')], ['a BigInt', () => 10n], ['NaN', () => NaN], ['Infinity', () => Infinity], ['-Infinity', () => -Infinity], ['undefined', () => undefined]];
function jdBuilders(make) {
  return [
    ['a root field', () => ({ schema: 2, patterns: [], projectPatterns: [], metadata: make() })],
    ['an entry field', () => ({ schema: 2, patterns: [{ anchor: 'any', glob: '**/x.pem', metadata: make() }], projectPatterns: [] })],
    ['nested in an object', () => ({ schema: 2, patterns: [], projectPatterns: [], metadata: { inner: make() } })],
    ['nested in an array', () => ({ schema: 2, patterns: [], projectPatterns: [{ anchor: 'root', glob: 'a', list: [make()] }] })],
  ];
}
async function schemaPolicy(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['readSecurityPolicy', 'parseSecurityPolicy', 'matchesPolicyPath', 'policyEntryKey', 'validateRepoPath'])) return;
    const read = (v) => () => m.readSecurityPolicy(v);
    const bad = async (label, build, code, loc) => expectError(check, label, read(build()), code, loc);
    const entryAt = (where, entry) => (where === 'patterns' ? policyOf([entry], []) : policyOf([], [entry]));

    await step('S01 root is null, an array, a primitive or undefined: POLICY_ROOT', async () => {
      for (const [label, v] of [['null', null], ['an array', []], ['a number', 5], ['a string', 'x'], ['true', true], ['undefined', undefined]]) await expectError(check, `S01 ${label}`, read(v), 'POLICY_ROOT');
    });
    await step('S02/JD18 root is a Date, a Map, a class instance, a custom prototype or a foreign-realm object: POLICY_ROOT', async () => {
      class Klass { constructor() { Object.assign(this, BASE()); } }
      const foreign = () => vm.runInNewContext('({ schema: 2, patterns: [], projectPatterns: [] })');
      for (const [label, make] of [['a Date', () => new Date(0)], ['a Map', () => new Map()], ['a class instance', () => new Klass()],
        ['JD18 an inherited schema through a custom prototype', () => Object.create(BASE())], ['an object from another realm', foreign]]) await expectError(check, `S02 ${label}`, read(make()), 'POLICY_ROOT');
    });
    await step('S03 a Proxy or revoked-Proxy root is POLICY_ROOT and no trap runs', async () => {
      const trapped = []; const handler = {};
      for (const t of ['defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'has', 'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf']) handler[t] = (...a) => { trapped.push(t); return Reflect[t](...a); };
      await expectError(check, 'S03 a Proxy root', read(new Proxy(BASE(), handler)), 'POLICY_ROOT');
      const rev = Proxy.revocable(BASE(), handler); rev.revoke();
      await expectError(check, 'S03 a revoked Proxy root', read(rev.proxy), 'POLICY_ROOT');
      await expectError(check, 'S03 a Proxy root through matchesPolicyPath', () => m.matchesPolicyPath('a', new Proxy(BASE(), handler)), 'POLICY_ROOT');
      check(trapped.length === 0, 'S03 no Proxy trap runs', trapped);
    });
    await step('S04 schema missing, 0, 3, "2" or null: POLICY_SCHEMA', async () => {
      const without = () => { const p = BASE(); delete p.schema; return p; };
      await bad('S04 schema missing', without, 'POLICY_SCHEMA');
      for (const v of [0, 3, '2', null, '1', 2.5, true]) await bad(`S04 schema ${show(v)}`, () => ({ ...BASE(), schema: v }), 'POLICY_SCHEMA');
    });
    await step('S05 patterns missing, null, an object or a string: POLICY_PATTERNS', async () => {
      await bad('S05 patterns missing', () => ({ schema: 2, projectPatterns: [] }), 'POLICY_PATTERNS');
      for (const v of [null, {}, 'x']) await bad(`S05 patterns ${show(v)}`, () => ({ schema: 2, patterns: v, projectPatterns: [] }), 'POLICY_PATTERNS');
    });
    await step('S06 projectPatterns missing, null, an object or a string: POLICY_PROJECT_PATTERNS (schema 2)', async () => {
      await bad('S06 projectPatterns missing', () => ({ schema: 2, patterns: [] }), 'POLICY_PROJECT_PATTERNS');
      for (const v of [null, {}, 'x']) await bad(`S06 projectPatterns ${show(v)}`, () => ({ schema: 2, patterns: [], projectPatterns: v }), 'POLICY_PROJECT_PATTERNS');
    });
    await step('S07 a null, array or string entry: POLICY_ENTRY (a nested Date entry is POLICY_VALUE)', async () => {
      for (const where of ['patterns', 'projectPatterns']) {
        for (const [label, v] of [['null', null], ['an array', []], ['a string', 'x']]) await bad(`S07 ${label} in ${where}`, () => entryAt(where, v), 'POLICY_ENTRY', `${where}[0]`);
      }
      await bad('S07 a Date entry fails the JSON-domain pass first', () => policyOf([new Date(0)], []), 'POLICY_VALUE');
    });
    await step('S08 glob missing, empty, numeric or null: POLICY_GLOB', async () => {
      for (const where of ['patterns', 'projectPatterns']) {
        for (const [label, e] of [['missing', { anchor: 'any' }], ['empty', { anchor: 'any', glob: '' }], ['numeric', { anchor: 'any', glob: 7 }], ['null', { anchor: 'any', glob: null }]]) {
          await bad(`S08 ${label} glob in ${where}`, () => entryAt(where, { ...e }), 'POLICY_GLOB', `${where}[0]`);
        }
      }
    });
    await step('S09 anchor missing, empty, "ANY", "Root", null or numeric: POLICY_ANCHOR', async () => {
      for (const where of ['patterns', 'projectPatterns']) {
        const no = { glob: '**/x.pem' };
        for (const [label, e] of [['missing', no], ['empty', { ...no, anchor: '' }], ['"ANY"', { ...no, anchor: 'ANY' }], ['"Root"', { glob: 'x.pem', anchor: 'Root' }], ['null', { ...no, anchor: null }], ['numeric', { ...no, anchor: 3 }]]) {
          await bad(`S09 ${label} anchor in ${where}`, () => entryAt(where, { ...e }), 'POLICY_ANCHOR', `${where}[0]`);
        }
      }
    });
    await step('S10 the empty valid base: sourceSchema 2, no effective entries, matches no valid path', async () => {
      const r = await attempt(read(BASE()));
      check(!r.threw && eq(r.value, { sourceSchema: 2, policy: BASE(), effectivePatterns: [] }), 'S10 the snapshot of the empty base', r.threw ? errMsg(r.error) : r.value);
      for (const p of ['a', '.env', 'src/key.pem', 'a/b/c']) {
        const hit = await attempt(() => m.matchesPolicyPath(p, BASE()));
        check(!hit.threw && hit.value === false, `S10 an explicitly empty policy matches no valid path: ${show(p)}`, hit.threw ? errMsg(hit.error) : hit.value);
      }
    });
    await step('S11 unknown JSON metadata is preserved', async () => {
      const input = { schema: 2, $comment: 'c', n: 1, t: true, z: null, deep: { list: [1, 'a', { k: [null] }] }, patterns: [{ glob: '**/x', anchor: 'any', kind: 'k', n: 2 }], projectPatterns: [{ glob: 'y', anchor: 'root', note: ['a'] }] };
      const r = await attempt(read(input));
      check(!r.threw && eq(r.value.policy, input) && r.value.policy !== input, 'S11 every unknown field and entry field survives in an equal detached policy', r.threw ? errMsg(r.error) : r.value && r.value.policy);
    });
    await step('S12 a valid entry followed by an invalid entry reports the later entry', async () => {
      await bad('S12 invalid second entry in patterns', () => policyOf([OKENTRY(), { anchor: 'any', glob: '**/a**b' }], []), 'POLICY_GLOBSTAR', 'patterns[1]');
      await bad('S12 invalid second entry in projectPatterns', () => policyOf([OKENTRY()], [OKENTRY(), { anchor: 'root' }]), 'POLICY_GLOB', 'projectPatterns[1]');
      await bad('S12 invalid entry in projectPatterns after valid patterns', () => policyOf([OKENTRY()], [{ anchor: 'root', glob: '[a]' }]), 'POLICY_GLOB_SYNTAX', 'projectPatterns[0]');
      await bad('S12 patterns are validated before projectPatterns', () => policyOf([{ anchor: 'root', glob: 'a**b' }], [{ anchor: 'root', glob: '[a]' }]), 'POLICY_GLOBSTAR', 'patterns[0]');
    });
    await step('S13 a matching entry followed by an invalid duplicate is an error, never true', async () => {
      const dup = (extra) => policyOf([{ anchor: 'any', glob: '**/*.pem' }], [{ anchor: 'any', glob: '**/*.pem' }, { anchor: 'any', glob: '**/*.pem', ...extra }]);
      for (const [label, extra, code, loc] of [['an invalid anchor', { anchor: 'ANY' }, 'POLICY_ANCHOR', 'projectPatterns[1]'], ['function metadata', { note: () => 1 }, 'POLICY_VALUE', null],
        ['an emptied glob', { glob: '' }, 'POLICY_GLOB', 'projectPatterns[1]']]) {
        await expectError(check, `S13 matchesPolicyPath with ${label} on the duplicate`, () => m.matchesPolicyPath('src/key.pem', dup(extra)), code, loc);
      }
    });
    await step('S14-S20 first error wins, in the exact validation order', async () => {
      await bad('S14 invalid schema and arrays', () => ({ schema: 3, patterns: null, projectPatterns: null }), 'POLICY_SCHEMA');
      await bad('S15 invalid patterns and projectPatterns', () => ({ schema: 2, patterns: null, projectPatterns: null }), 'POLICY_PATTERNS');
      await bad('S16 empty glob and invalid anchor', () => policyOf([{ anchor: 'bogus', glob: '' }], []), 'POLICY_GLOB', 'patterns[0]');
      await bad('S17 invalid anchor and globstar', () => policyOf([{ anchor: 'bogus', glob: 'a**b' }], []), 'POLICY_ANCHOR', 'patterns[0]');
      await bad('S18 unsupported syntax and invalid globstar', () => policyOf([{ anchor: 'root', glob: '[a]**b' }], []), 'POLICY_GLOB_SYNTAX', 'patterns[0]');
      await bad('S19 invalid globstar and path', () => policyOf([{ anchor: 'root', glob: '/a**b' }], []), 'POLICY_GLOBSTAR', 'patterns[0]');
      await expectError(check, 'S20 invalid policy and invalid candidate: the policy error comes first', () => m.matchesPolicyPath('/abs', { schema: 3, patterns: [], projectPatterns: [] }), 'POLICY_SCHEMA');
      await expectError(check, 'S20 an invalid policy with a type-invalid candidate', () => m.matchesPolicyPath(undefined, null), 'POLICY_ROOT');
      await expectError(check, 'S20 a valid policy with an invalid candidate reports the candidate', () => m.matchesPolicyPath('/abs', BASE()), 'POLICY_PATH_ABSOLUTE');
      await bad('3.5 a nested Date entry produces POLICY_VALUE before any entry check', () => policyOf([new Date(0), { anchor: 'x' }], []), 'POLICY_VALUE');
      await bad('3.1 policy schema 3 is invalid', () => ({ schema: 3, patterns: [], projectPatterns: [] }), 'POLICY_SCHEMA');
    });
    await step('2.3 matchesPolicyPath takes a raw policy, not a snapshot wrapper; snapshot.policy is accepted', async () => {
      const snap = m.readSecurityPolicy(DEDUP_INPUT());
      // PLAN-GAP: plan 2.3 says matchesPolicyPath accepts a raw policy "not a snapshot wrapper" but names no error code for a wrapper. POLICY_SCHEMA
      // is what the 3.5 validation order gives: the wrapper is a plain JSON object with no own "schema" key (root and JSON-domain checks pass first).
      await expectError(check, 'a snapshot wrapper is not a policy', () => m.matchesPolicyPath('src/key.pem', snap), 'POLICY_SCHEMA');
      const viaPolicy = await attempt(() => m.matchesPolicyPath('src/key.pem', snap.policy));
      check(!viaPolicy.threw && viaPolicy.value === true, 'snapshot.policy matches src/key.pem', viaPolicy.threw ? errMsg(viaPolicy.error) : viaPolicy.value);
    });

    // ---- JD: the whole-policy JSON domain (plan 3.1, 4.5) ----
    await step('JD01 Object.prototype and null-prototype objects are accepted; output objects are ordinary', async () => {
      const nul = (o) => Object.assign(Object.create(null), o);
      const input = nul({ schema: 2, patterns: [nul({ glob: '**/x', anchor: 'any', meta: nul({ a: 1 }) })], projectPatterns: [nul({ glob: 'y', anchor: 'root' })], extra: nul({ list: [nul({ k: 1 })] }) });
      const r = await attempt(read(input));
      check(!r.threw, 'JD01 null-prototype data is accepted', r.threw ? errMsg(r.error) : null);
      if (!r.threw) {
        check(eq(r.value.policy, { schema: 2, patterns: [{ glob: '**/x', anchor: 'any', meta: { a: 1 } }], projectPatterns: [{ glob: 'y', anchor: 'root' }], extra: { list: [{ k: 1 }] } }), 'JD01 the policy is an equal ordinary-object copy', r.value.policy);
        check(protoIssues(r.value).length === 0, 'JD01 every output object has Object.prototype and every output array Array.prototype', protoIssues(r.value));
        check(sharedObjects(input, r.value) === 0, 'JD01 the output shares no object with the input', sharedObjects(input, r.value));
      }
      const plainRoot = await attempt(read(BASE()));
      check(!plainRoot.threw && protoIssues(plainRoot.value).length === 0, 'JD01 Object.prototype input is accepted', plainRoot.threw ? errMsg(plainRoot.error) : protoIssues(plainRoot.value));
    });
    await step('JD02 frozen valid data is accepted and unchanged', async () => {
      const input = deepFreeze({ schema: 2, note: 'n', patterns: [{ glob: '**/x', anchor: 'any', meta: { list: [1, 2] } }], projectPatterns: [] });
      const r = await attempt(read(input));
      check(!r.threw && eq(r.value.policy, input) && r.value.policy !== input, 'JD02 a deep-frozen policy reads to an equal detached policy', r.threw ? errMsg(r.error) : r.value);
      if (!r.threw) {
        r.value.policy.note = 'changed'; r.value.policy.patterns.push({ glob: 'z', anchor: 'root' });
        check(r.value.policy.note === 'changed' && deepFrozen(input) && input.note === 'n' && input.patterns.length === 1, 'JD02 returned data is mutable and the frozen input is untouched');
      }
    });
    await step('JD03 a shared metadata reference without a cycle is accepted and copied by value', async () => {
      const shared = { list: [1, { k: 2 }] };
      const input = { schema: 2, patterns: [{ glob: '**/x', anchor: 'any', meta: shared }], projectPatterns: [{ glob: 'y', anchor: 'root', meta: shared }], top: shared };
      const r = await attempt(read(input));
      check(!r.threw, 'JD03 shared references are accepted', r.threw ? errMsg(r.error) : null);
      if (!r.threw) {
        const p = r.value.policy;
        check(eq(p.patterns[0].meta, shared) && eq(p.projectPatterns[0].meta, shared) && eq(p.top, shared), 'JD03 each position holds an equal value');
        check(p.patterns[0].meta !== shared && p.top !== shared && sharedObjects(input, r.value) === 0, 'JD03 no output object is an input object');
        check(p.patterns[0].meta !== p.projectPatterns[0].meta && p.patterns[0].meta !== p.top, 'JD03 each reference is copied separately (copied by value)');
        p.patterns[0].meta.list.push('x');
        check(p.projectPatterns[0].meta.list.length === 2 && shared.list.length === 2, 'JD03 mutating one copy changes neither the other copy nor the input');
      }
    });
    await step('JD04 a direct or indirect cycle is POLICY_VALUE', async () => {
      const cycles = [
        ['a direct object cycle', () => { const o = {}; o.self = o; return o; }],
        ['an indirect object cycle', () => { const a = {}; const b = { a }; a.b = b; return a; }],
        ['an array cycle', () => { const a = []; a.push(a); return a; }],
        ['a cycle through an array', () => { const o = {}; o.list = [o]; return o; }],
      ];
      for (const [label, make] of cycles) for (const [where, build] of jdBuilders(make)) await expectError(check, `JD04 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      const rootCycle = BASE(); rootCycle.me = rootCycle;
      await expectError(check, 'JD04 the root refers to itself', read(rootCycle), 'POLICY_VALUE');
      const entryCycle = OKENTRY(); entryCycle.me = entryCycle;
      await expectError(check, 'JD04 an entry refers to itself', read(policyOf([entryCycle], [])), 'POLICY_VALUE');
    });
    await step('JD05 a function, symbol, BigInt, NaN, Infinity or undefined value is POLICY_VALUE', async () => {
      for (const [label, make] of JD_PRIMS) for (const [where, build] of jdBuilders(make)) await expectError(check, `JD05 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
    });
    await step('JD06 a Date, Map, class instance or custom-prototype object is POLICY_VALUE', async () => {
      class Klass { constructor() { this.a = 1; } }
      for (const [label, make] of [['a Date', () => new Date(0)], ['a Map', () => new Map()], ['a class instance', () => new Klass()], ['a custom-prototype object', () => Object.create({ inherited: 1 })],
        ['a RegExp', () => /x/]]) for (const [where, build] of jdBuilders(make)) await expectError(check, `JD06 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
    });
    await step('JD07 a nested Proxy or revoked Proxy is POLICY_VALUE and no trap runs', async () => {
      const trapped = []; const handler = {};
      for (const t of ['defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'has', 'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf']) handler[t] = (...a) => { trapped.push(t); return Reflect[t](...a); };
      const revoked = () => { const r = Proxy.revocable({}, handler); r.revoke(); return r.proxy; };
      for (const [label, make] of [['a Proxy of an object', () => new Proxy({ a: 1 }, handler)], ['a Proxy of an array', () => new Proxy([1], handler)], ['a revoked Proxy', revoked]]) {
        for (const [where, build] of jdBuilders(make)) await expectError(check, `JD07 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      }
      await expectError(check, 'JD07 a Proxy entry', read(policyOf([new Proxy({ anchor: 'any', glob: '**/x' }, handler)], [])), 'POLICY_VALUE');
      await expectError(check, 'JD07 a Proxy patterns array', read({ schema: 2, patterns: new Proxy([], handler), projectPatterns: [] }), 'POLICY_VALUE');
      await expectError(check, 'JD07 a revoked Proxy projectPatterns array', read({ schema: 2, patterns: [], projectPatterns: revoked() }), 'POLICY_VALUE');
      await expectError(check, 'JD07 a Proxy entry through standalone policyEntryKey metadata', () => m.policyEntryKey({ anchor: 'any', glob: '**/x', meta: new Proxy({}, handler) }), 'POLICY_VALUE');
      check(trapped.length === 0, 'JD07 no Proxy trap runs', trapped);
    });
    await step('JD08 an enumerable or non-enumerable symbol key is POLICY_VALUE', async () => {
      const keyed = (enumerable) => () => { const o = {}; Object.defineProperty(o, Symbol('k'), { value: 1, enumerable, writable: true, configurable: true }); return o; };
      for (const [label, enumerable] of [['an enumerable symbol key', true], ['a non-enumerable symbol key', false]]) {
        for (const [where, build] of jdBuilders(keyed(enumerable))) await expectError(check, `JD08 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
        const root = BASE(); Object.defineProperty(root, Symbol('k'), { value: 1, enumerable });
        await expectError(check, `JD08 ${label} on the root`, read(root), 'POLICY_VALUE');
        const entry = OKENTRY(); Object.defineProperty(entry, Symbol('k'), { value: 1, enumerable });
        await expectError(check, `JD08 ${label} on an entry`, read(policyOf([entry], [])), 'POLICY_VALUE');
      }
    });
    await step('JD09 a non-enumerable object property is POLICY_VALUE', async () => {
      const hidden = () => { const o = { shown: 1 }; Object.defineProperty(o, 'hidden', { value: 1, enumerable: false, writable: true, configurable: true }); return o; };
      for (const [where, build] of jdBuilders(hidden)) await expectError(check, `JD09 in ${where}`, read(build()), 'POLICY_VALUE');
      const root = BASE(); Object.defineProperty(root, 'hidden', { value: 1, enumerable: false });
      await expectError(check, 'JD09 on the root', read(root), 'POLICY_VALUE');
      const entry = OKENTRY(); Object.defineProperty(entry, 'hidden', { value: 1, enumerable: false });
      await expectError(check, 'JD09 on an entry', read(policyOf([entry], [])), 'POLICY_VALUE');
    });
    await step('JD10 a getter or setter property is POLICY_VALUE and is never invoked', async () => {
      const log = [];
      const getter = () => { const o = {}; Object.defineProperty(o, 'g', { get() { log.push('get'); return 1; }, enumerable: true, configurable: true }); return o; };
      const setter = () => { const o = {}; Object.defineProperty(o, 's', { set(v) { log.push('set'); void v; }, enumerable: true, configurable: true }); return o; };
      const both = () => { const o = {}; Object.defineProperty(o, 'b', { get() { log.push('get'); return 1; }, set(v) { log.push('set'); void v; }, enumerable: true, configurable: true }); return o; };
      for (const [label, make] of [['a getter', getter], ['a setter', setter], ['a getter and setter', both]]) for (const [where, build] of jdBuilders(make)) await expectError(check, `JD10 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      const root = BASE(); Object.defineProperty(root, 'schema', { get() { log.push('get'); return 2; }, enumerable: true, configurable: true });
      await expectError(check, 'JD10 an accessor schema on the root', read(root), 'POLICY_VALUE');
      const entry = OKENTRY(); Object.defineProperty(entry, 'glob', { get() { log.push('get'); return '**/x'; }, enumerable: true, configurable: true });
      await expectError(check, 'JD10 an accessor glob on an entry', read(policyOf([entry], [])), 'POLICY_VALUE');
      check(log.length === 0, 'JD10 no accessor is invoked', log);
    });
    await step('JD11 a sparse array is POLICY_VALUE', async () => {
      const trailing = () => { const a = [1, 2]; a.length = 3; return a; };
      for (const [label, make] of [['new Array(2)', () => new Array(2)], ['a hole in the middle', () => [1, , 3]], ['a trailing hole', trailing]]) { // eslint-disable-line no-sparse-arrays
        for (const [where, build] of jdBuilders(make)) await expectError(check, `JD11 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      }
      await expectError(check, 'JD11 a sparse patterns array', read({ schema: 2, patterns: new Array(1), projectPatterns: [] }), 'POLICY_VALUE');
    });
    await step('JD12 an extra array string, symbol or non-enumerable property is POLICY_VALUE', async () => {
      const str = () => { const a = [1]; a.extra = 1; return a; };
      const sym = () => { const a = [1]; a[Symbol('x')] = 1; return a; };
      const hid = () => { const a = [1]; Object.defineProperty(a, 'hidden', { value: 1, enumerable: false }); return a; };
      const hidSym = () => { const a = [1]; Object.defineProperty(a, Symbol('x'), { value: 1, enumerable: false }); return a; };
      for (const [label, make] of [['a string property', str], ['a symbol property', sym], ['a non-enumerable property', hid], ['a non-enumerable symbol property', hidSym]]) {
        for (const [where, build] of jdBuilders(make)) await expectError(check, `JD12 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      }
      const pat = []; pat.extra = 1;
      await expectError(check, 'JD12 an extra property on the patterns array', read({ schema: 2, patterns: pat, projectPatterns: [] }), 'POLICY_VALUE');
    });
    await step('JD13 an accessor or non-enumerable array index is POLICY_VALUE and no accessor runs', async () => {
      const log = [];
      const acc = () => { const a = [0]; Object.defineProperty(a, 0, { get() { log.push('get'); return 1; }, enumerable: true, configurable: true }); return a; };
      const hid = () => { const a = [0]; Object.defineProperty(a, 0, { value: 1, enumerable: false, writable: true, configurable: true }); return a; };
      for (const [label, make] of [['an accessor index', acc], ['a non-enumerable index', hid]]) for (const [where, build] of jdBuilders(make)) await expectError(check, `JD13 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      check(log.length === 0, 'JD13 no index accessor is invoked', log);
    });
    await step('JD14 a dense array with Array.prototype or a null prototype is accepted', async () => {
      const nullProto = () => Object.setPrototypeOf([1, 'a', { k: [2] }], null);
      const r = await attempt(read({ schema: 2, patterns: Object.setPrototypeOf([{ glob: '**/x', anchor: 'any', list: nullProto() }], null), projectPatterns: [], extra: [1, [2]] }));
      check(!r.threw, 'JD14 accepted', r.threw ? errMsg(r.error) : null);
      if (!r.threw) {
        check(eq(r.value.policy, { schema: 2, patterns: [{ glob: '**/x', anchor: 'any', list: [1, 'a', { k: [2] }] }], projectPatterns: [], extra: [1, [2]] }), 'JD14 the policy is an equal copy', r.value.policy);
        check(protoIssues(r.value).length === 0, 'JD14 every output array has Array.prototype', protoIssues(r.value));
      }
    });
    await step('JD15 an array with another prototype is POLICY_VALUE', async () => {
      class Sub extends Array {}
      for (const [label, make] of [['an object prototype', () => Object.setPrototypeOf([1], {})], ['Object.prototype', () => Object.setPrototypeOf([1], Object.prototype)], ['an Array subclass', () => Sub.from([1])]]) {
        for (const [where, build] of jdBuilders(make)) await expectError(check, `JD15 ${label} in ${where}`, read(build()), 'POLICY_VALUE');
      }
    });
    await step('JD16 an own __proto__ JSON key is data: preserved without changing a prototype', async () => {
      const root = JSON.parse('{"schema":2,"patterns":[{"glob":"**/x","anchor":"any","__proto__":{"polluted":true}}],"projectPatterns":[],"__proto__":{"polluted":true},"meta":{"__proto__":[1]}}');
      const r = await attempt(read(root));
      check(!r.threw, 'JD16 accepted', r.threw ? errMsg(r.error) : null);
      if (!r.threw) {
        const p = r.value.policy; const ent = p.patterns[0];
        const own = (o) => { const d = Object.getOwnPropertyDescriptor(o, '__proto__'); return d && 'value' in d && d.enumerable ? d.value : undefined; };
        check(eq(own(p), { polluted: true }) && eq(own(ent), { polluted: true }) && eq(own(p.meta), [1]), 'JD16 each own __proto__ key survives as an own data property', { root: own(p), entry: own(ent), meta: own(p.meta) });
        check(Object.getPrototypeOf(p) === Object.prototype && Object.getPrototypeOf(ent) === Object.prototype && Object.getPrototypeOf(p.meta) === Object.prototype, 'JD16 no prototype changed');
        check(p.polluted === undefined && ent.polluted === undefined && ({}).polluted === undefined && !Array.isArray(p.meta), 'JD16 nothing was inherited or polluted');
      }
    });
    await step('JD17 a function-valued toJSON is POLICY_VALUE and is never invoked', async () => {
      const log = [];
      for (const [where, build] of jdBuilders(() => ({ toJSON() { log.push('toJSON'); return {}; } }))) await expectError(check, `JD17 toJSON in ${where}`, read(build()), 'POLICY_VALUE');
      const root = BASE(); root.toJSON = () => { log.push('toJSON'); return {}; };
      await expectError(check, 'JD17 toJSON on the root', read(root), 'POLICY_VALUE');
      const entry = OKENTRY(); entry.toJSON = () => { log.push('toJSON'); return {}; };
      await expectError(check, 'JD17 toJSON on an entry', read(policyOf([entry], [])), 'POLICY_VALUE');
      check(log.length === 0, 'JD17 toJSON is never invoked', log);
    });

    // ---- J: parsing (plan 4.5) ----
    await step('J01 a non-string is POLICY_TEXT', async () => {
      for (const [label, v] of [['a Buffer', Buffer.from('{}')], ['a number', 5], ['null', null], ['undefined', undefined], ['an object', BASE()], ['an array', ['{}']], ['a Uint8Array', new Uint8Array(2)]]) {
        await expectError(check, `J01 ${label}`, () => m.parseSecurityPolicy(v), 'POLICY_TEXT');
      }
    });
    await step('J02 empty text, "{" and trailing-comma JSON are POLICY_JSON, and the text never leaks', async () => {
      for (const [label, v] of [['the empty string', ''], ['"{"', '{'], ['trailing-comma JSON', '{"schema":2,"patterns":[],"projectPatterns":[],}'], ['text', 'not json']]) await expectError(check, `J02 ${label}`, () => m.parseSecurityPolicy(v), 'POLICY_JSON');
      const sentinel = 'SENTINEL-LEAK-4417';
      const e = await expectError(check, 'J02 malformed text with sentinel content', () => m.parseSecurityPolicy(`{"${sentinel}": [1, 2,`), 'POLICY_JSON');
      check(e && !String(e.message).includes(sentinel) && !/position|token|Unexpected|JSON\.parse/.test(String(e.message)), 'J02 the message carries neither the source text nor native parser details', e && e.message);
    });
    await step('J03 serialized valid base and a populated policy give the same snapshot as the reader', async () => {
      for (const v of [BASE(), DEDUP_INPUT()]) {
        const a = await attempt(() => m.parseSecurityPolicy(JSON.stringify(v)));
        check(!a.threw && eq(a.value, m.readSecurityPolicy(v)), 'J03 parse equals read', a.threw ? errMsg(a.error) : a.value);
      }
    });
    await step('J04/J05 one initial BOM is removed; two are POLICY_JSON', async () => {
      const text = JSON.stringify(DEDUP_INPUT());
      const one = await attempt(() => m.parseSecurityPolicy(`\ufeff${text}`));
      check(!one.threw && eq(one.value, m.readSecurityPolicy(DEDUP_INPUT())), 'J04 one initial BOM plus valid JSON gives the same snapshot', one.threw ? errMsg(one.error) : one.value);
      await expectError(check, 'J05 two initial BOMs', () => m.parseSecurityPolicy(`\ufeff\ufeff${text}`), 'POLICY_JSON');
      await expectError(check, 'J05 a BOM that is not initial', () => m.parseSecurityPolicy(` \ufeff${text}`), 'POLICY_JSON');
    });
    await step('J06/J07 JSON null is POLICY_ROOT and JSON schema 3 is POLICY_SCHEMA', async () => {
      await expectError(check, 'J06 JSON null', () => m.parseSecurityPolicy('null'), 'POLICY_ROOT');
      await expectError(check, 'J06 a JSON array', () => m.parseSecurityPolicy('[]'), 'POLICY_ROOT');
      await expectError(check, 'J07 JSON schema 3', () => m.parseSecurityPolicy('{"schema":3,"patterns":[],"projectPatterns":[]}'), 'POLICY_SCHEMA');
      await expectError(check, 'J07 a policy error keeps its indexed location through parsing', () => m.parseSecurityPolicy('{"schema":2,"patterns":[{"glob":"a**b","anchor":"root"}],"projectPatterns":[]}'), 'POLICY_GLOBSTAR', 'patterns[0]');
    });
    await step('3.5 messages never include rejected path, glob or metadata contents', async () => {
      const marker = 'LEAKMARK-9921';
      const e1 = await expectError(check, 'a glob holding a marker', read(policyOf([{ anchor: 'root', glob: `a**${marker}` }], [])), 'POLICY_GLOBSTAR', 'patterns[0]');
      const e2 = await expectError(check, 'a path holding a marker', () => m.validateRepoPath(`/${marker}`), 'POLICY_PATH_ABSOLUTE');
      const e3 = await expectError(check, 'metadata holding a marker', read({ ...BASE(), [marker]: () => 1 }), 'POLICY_VALUE');
      for (const e of [e1, e2, e3]) check(e && !String(e.message).includes(marker), 'the message does not echo the marker', e && e.message);
    });
  });
}
// Plan 4.5: checkSecurityPolicy and its error classification. These belong to R45/C1/schema too; they need scripts/schemas.mjs, not the
// policy module, so they run even when the policy module is missing.
async function schemaChecks(context, failures, check, step) {
  const sch = await needScript(failures, context, 'schemas.mjs');
  if (!sch || !needFns(failures, sch, ['checkSecurityPolicy'])) return;
  await step('4.5 checkSecurityPolicy returns [] for valid input and exactly one full message per reader failure', async () => {
    for (const [label, v] of [['the empty base', BASE()], ['a populated schema 2 policy', DEDUP_INPUT()], ['a schema 1 policy', { schema: 1, patterns: [{ glob: '**/x' }] }]]) {
      const r = await attempt(() => sch.checkSecurityPolicy(v));
      check(!r.threw && eq(r.value, []), `checkSecurityPolicy(${label}) is []`, r.threw ? errMsg(r.error) : r.value);
    }
    const cases = [
      [null, 'POLICY_ROOT', 'entry'], [{ ...BASE(), schema: 3 }, 'POLICY_SCHEMA', 'entry'], [{ schema: 2, patterns: null, projectPatterns: [] }, 'POLICY_PATTERNS', 'entry'],
      [{ schema: 2, patterns: [], projectPatterns: null }, 'POLICY_PROJECT_PATTERNS', 'entry'], [policyOf([null], []), 'POLICY_ENTRY', 'patterns[0]'],
      [policyOf([{ anchor: 'any' }], []), 'POLICY_GLOB', 'patterns[0]'], [policyOf([{ glob: '**/x' }], []), 'POLICY_ANCHOR', 'patterns[0]'],
      [policyOf([OKENTRY()], [{ anchor: 'root', glob: '[a]' }]), 'POLICY_GLOB_SYNTAX', 'projectPatterns[0]'], [policyOf([{ anchor: 'root', glob: 'a**b' }], []), 'POLICY_GLOBSTAR', 'patterns[0]'],
      [policyOf([{ anchor: 'root', glob: 'a//b' }], []), 'POLICY_GLOB_PATH', 'patterns[0]'], [policyOf([{ anchor: 'any', glob: 'key.pem' }], []), 'POLICY_ANCHOR_ANY', 'patterns[0]'],
      [policyOf([{ anchor: 'root', glob: '**/key.pem' }], []), 'POLICY_ANCHOR_ROOT', 'patterns[0]'], [{ schema: 1, patterns: [{ glob: '**/x', anchor: 'root' }] }, 'POLICY_LEGACY_ANCHOR', 'patterns[0]'],
      [{ ...BASE(), meta: () => 1 }, 'POLICY_VALUE', 'entry'],
    ];
    for (const [v, code, loc] of cases) {
      const r = await attempt(() => sch.checkSecurityPolicy(v));
      check(!r.threw && eq(r.value, [message(code, loc)]), `checkSecurityPolicy reports exactly [${code} message]`, r.threw ? errMsg(r.error) : r.value);
    }
  });
  await step('2.4 schemas.mjs imports the shared reader exactly and no other relative module', async () => {
    const src = readBytes(path.join(context.skillRoot, 'scripts', 'schemas.mjs'));
    const text = src ? src.toString('utf8') : '';
    check(text.includes("import { readSecurityPolicy } from '../assets/tools/security-policy.mjs';\n"), "scripts/schemas.mjs contains exactly: import { readSecurityPolicy } from '../assets/tools/security-policy.mjs';");
    const specs = [...text.matchAll(/(?:^|\n)\s*import\s[^'"\n]*?['"]([^'"]+)['"]/g), ...text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g), ...text.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g), ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
    const relative = [...new Set(specs.filter((s) => s.startsWith('.')))];
    check(eq(relative, ['../assets/tools/security-policy.mjs']), 'schemas.mjs imports no relative module other than the shared policy module', relative);
  });
  await step('4.5 classification: only an Error with an own code from the 20 known codes is reported; everything else is rethrown unchanged', async () => {
    await withScratch(context, 'cls', async (dir) => {
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'assets', 'tools'), { recursive: true });
      fs.copyFileSync(path.join(context.skillRoot, 'scripts', 'schemas.mjs'), path.join(dir, 'scripts', 'schemas.mjs'));
      fs.writeFileSync(path.join(dir, 'assets', 'tools', 'security-policy.mjs'), [
        'export let sentinel;', '', 'export function setSentinel(value) {', '  sentinel = value;', '}', '', 'export function readSecurityPolicy() {', '  throw sentinel;', '}', ''].join('\n'));
      const schemasUrl = pathToFileURL(path.join(dir, 'scripts', 'schemas.mjs')).href;
      const stubUrl = new URL('../assets/tools/security-policy.mjs', schemasUrl).href;
      const stub = await import(stubUrl); const copied = await import(schemasUrl);
      const run = (value) => { stub.setSentinel(value); try { return { threw: false, value: copied.checkSecurityPolicy({}) }; } catch (e) { return { threw: true, error: e }; } };
      const codeError = (code, message) => { const e = new Error(message); e.code = code; return e; };
      for (const code of Object.keys(SUFFIX)) {
        const s = codeError(code, 'sentinel'); const r = run(s);
        check(!r.threw && eq(r.value, ['sentinel']), `an Error with own code ${code} is reported as [message]`, r.threw ? errMsg(r.error) : r.value);
      }
      check(Object.keys(SUFFIX).length === 20, 'the test lists exactly the 20 codes of plan 3.5', Object.keys(SUFFIX).length);
      const inherited = new Error('sentinel'); Object.setPrototypeOf(inherited, Object.create(Error.prototype, { code: { value: 'POLICY_SCHEMA' } }));
      const rethrown = [
        ['an Error with own POLICY_UNKNOWN', codeError('POLICY_UNKNOWN', 'sentinel')], ['an Error with an inherited POLICY_SCHEMA', inherited],
        ['an Error with an own numeric code', codeError(5, 'sentinel')], ['an Error without a code', new Error('sentinel')],
        ['a plain object with POLICY_SCHEMA', { code: 'POLICY_SCHEMA', message: 'sentinel' }], ['the string "sentinel"', 'sentinel'],
        ['an Error with a POLICY_ prefixed message but no code', new Error('POLICY_SCHEMA: sentinel')], ['an Error with own code POLICY_ and nothing more', codeError('POLICY_', 'sentinel')],
      ];
      for (const [label, value] of rethrown) {
        const r = run(value);
        check(r.threw && r.error === value, `${label} is rethrown as the same value`, r.threw ? 'threw something else or the same' : r.value);
      }
    });
  });
}

async function schema(context) {
  const main = await schemaPolicy(context);
  const extra = await runAssertion(async ({ failures, check, step }) => { await schemaChecks(context, failures, check, step); });
  return { failures: [...main.failures, ...extra.failures], skipped: null };
}

// ===================================================== R44/C1/anchors ====
// Plan 4.3: A01-A10.
async function anchors(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['matchesPolicyPath'])) return;
    await step('4.3 A01-A10 in both placements', async () => { await checkRows(check, m, A_ROWS); });
    await step('2.3 an any entry and a root entry together keep their own anchors', async () => {
      const pol = policyOf([{ anchor: 'root', glob: 'env/**' }], [{ anchor: 'any', glob: '**/env/**' }]);
      for (const [p, want] of [['env/key', true], ['src/env/key', true], ['env', false]]) {
        const r = await attempt(() => m.matchesPolicyPath(p, pol));
        check(!r.threw && r.value === want, `a root and an any entry together: ${show(p)} is ${want}`, r.threw ? errMsg(r.error) : r.value);
      }
    });
  });
}

// ===================================================== R74/C1/case ====
// Plan 3.3 and 4.6: C01-C08, C11, B01-B09, B12 and the exact entry keys.
async function casePolicy(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['matchesPolicyPath', 'policyEntryKey'])) return;
    await step('4.6 C01-C08 and C11 in both placements (C05, C07 and C11 are accepted residuals)', async () => { await checkRows(check, m, C_ROWS); });
    await step('4.6 B01-B09 and B12 in both placements (B12 is an accepted residual)', async () => { await checkRows(check, m, B_ROWS); });
    await step('5.1 documented residuals that have no corpus row: a ? counts code points, not graphemes; 8.3 short names are not resolved', async () => {
      const probes = [
        ['root', '?/k', 'i\u0307/K', false, 'the C18-style case: ? counts code points, not graphemes (accepted residual, PQ2)'],
        ['any', '**/credentials/**', 'CREDEN~1/x', false, 'lexical matching does not resolve a Windows 8.3 short name (accepted residual; realpath checks belong to C3 and C5)'],
      ];
      for (const [anchor, glob, p, want, why] of probes) {
        for (const [where, pol] of placements({ anchor, glob })) {
          const r = await attempt(() => m.matchesPolicyPath(p, pol));
          check(!r.threw && r.value === want, `${anchor} ${show(glob)} vs ${show(p)} in ${where} is ${want}: ${why}`, r.threw ? errMsg(r.error) : r.value);
        }
      }
    });
    await step('4.6 exact entry keys; the original spelling is unchanged', async () => {
      for (const [entry, key] of [[{ anchor: 'any', glob: '**/*.PEM' }, '["any","**/*.pem"]'], [{ anchor: 'root', glob: 'ENV/**' }, '["root","env/**"]']]) {
        const frozen = deepFreeze({ ...entry });
        const r = await attempt(() => m.policyEntryKey(frozen));
        check(!r.threw && r.value === key, `policyEntryKey(${show(entry)}) is ${key}`, r.threw ? errMsg(r.error) : r.value);
        check(frozen.glob === entry.glob && frozen.anchor === entry.anchor, 'the entry spelling is unchanged');
      }
    });
    await step('3.3 the caller policy and path are never rewritten by matching', async () => {
      const pol = deepFreeze(policyOf([{ anchor: 'any', glob: '**/.ENV' }], []));
      const r = await attempt(() => m.matchesPolicyPath('.env. ', pol));
      check(!r.threw && r.value === true && pol.patterns[0].glob === '**/.ENV', 'a frozen policy with an uppercase glob matches an aliased lowercase path and keeps its spelling', r.threw ? errMsg(r.error) : r.value);
    });
    await step('3.3 Windows aliases apply per component, and an alias never legalizes invalid syntax', async () => {
      const probes = [
        ['any', '**/.env', '.env:x', true], ['any', '**/.env', 'a/.env::$DATA/b', false], ['root', 'a/b', 'a./b ', true], ['root', 'a/b', 'a/b..  ', true],
        ['root', '.env', ' .env', false], ['root', 'xy', 'xy:', true], ['root', 'xy.', 'xy:z', true],
      ];
      for (const [anchor, glob, p, want] of probes) {
        for (const [where, pol] of placements({ anchor, glob })) {
          const r = await attempt(() => m.matchesPolicyPath(p, pol));
          check(!r.threw && r.value === want, `${anchor} ${show(glob)} vs ${show(p)} in ${where} is ${want}`, r.threw ? errMsg(r.error) : r.value);
        }
      }
      await expectError(check, 'an alias-looking glob that is structurally invalid is still invalid', () => m.matchesPolicyPath('a', policyOf([{ anchor: 'root', glob: 'a//b.' }], [])), 'POLICY_GLOB_PATH', 'patterns[0]');
    });
  });
}

// ===================================================== R74/C1/corpus ====
// Plan 4.2 and 4.3: W01-W30, the corpus integrity check, and the complexity regression.
const COMPLEXITY_PROBE = [
  "import path from 'node:path';",
  "import { pathToFileURL } from 'node:url';",
  "const skillRoot = process.argv[2];",
  "const m = await import(pathToFileURL(path.join(skillRoot, 'assets', 'tools', 'security-policy.mjs')).href);",
  "const policy = { schema: 2, patterns: [{ anchor: 'root', glob: '*a*a*a*a*a*a*a*a*b' }], projectPatterns: [] };",
  "const out = [m.matchesPolicyPath('a'.repeat(8192), policy), m.matchesPolicyPath('a'.repeat(8192) + 'b', policy)];",
  "process.stdout.write(JSON.stringify(out) + '\\n');",
].join('\n') + '\n';
async function corpus(context) {
  return runAssertion(async ({ failures, check, step }) => {
    await step('4.2 the corpus inventory: 78 matching rows and G01-G27, in the exact order, with no duplicate ID', async () => {
      const ids = [
        ...Array.from({ length: 10 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`), ...Array.from({ length: 30 }, (_, i) => `W${String(i + 1).padStart(2, '0')}`),
        ...['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08', 'C11'], ...['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B12'],
        ...Array.from({ length: 19 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`),
      ];
      check(MATCH_ROWS.length === 78 && eq(rowIds(MATCH_ROWS), ids), 'the embedded matching inventory is A01-A10, W01-W30, C01-C08, C11, B01-B09, B12, E01-E19', rowIds(MATCH_ROWS));
      check(G_ROWS.length === 27 && eq(rowIds(G_ROWS), Array.from({ length: 27 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`)), 'the embedded rejected inventory is G01-G27', rowIds(G_ROWS));
    });
    await step('4.2 tests/fixtures/security-policy-corpus.json equals the embedded literals (the fixture cannot define its own oracle)', async () => {
      const file = path.join(context.skillRoot, 'tests', 'fixtures', 'security-policy-corpus.json');
      const bytes = readBytes(file);
      check(bytes !== null, 'the corpus fixture exists', file);
      if (bytes === null) return;
      let fixture = null;
      try { fixture = JSON.parse(bytes.toString('utf8')); } catch (e) { check(false, 'the corpus fixture is valid JSON', errMsg(e)); return; }
      check(fixture !== null && typeof fixture === 'object' && !Array.isArray(fixture) && eq(sorted(Object.keys(fixture)), ['matches', 'rejectedEntries', 'schema']), 'the fixture has exactly schema, matches and rejectedEntries', fixture && Object.keys(fixture));
      check(fixture && fixture.schema === 1, 'the fixture schema (of the corpus, not the policy) is 1', fixture && fixture.schema);
      const fm = fixture && Array.isArray(fixture.matches) ? fixture.matches : [], fr = fixture && Array.isArray(fixture.rejectedEntries) ? fixture.rejectedEntries : [];
      check(fm.length === MATCH_ROWS.length && fr.length === G_ROWS.length, 'the fixture holds 78 matching rows and 27 rejected entries', { matches: fm.length, rejected: fr.length });
      MATCH_ROWS.forEach((row, i) => check(eq(fm[i], row), `fixture matching row ${row.id} (position ${i}) equals the literal`, fm[i]));
      G_ROWS.forEach((row, i) => check(eq(fr[i], row), `fixture rejected row ${row.id} (position ${i}) equals the literal, with the full message`, fr[i]));
      check(new Set(fm.map((r) => r && r.id)).size === fm.length && new Set(fr.map((r) => r && r.id)).size === fr.length, 'the fixture has no duplicate ID');
      check(eq(fixture, { schema: 1, matches: MATCH_ROWS, rejectedEntries: G_ROWS }), 'the fixture equals the embedded corpus as a whole (no missing, extra, duplicate or changed row)');
    });
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['matchesPolicyPath', 'policyEntryKey'])) return;
    await step('4.3 W01-W30 in both placements', async () => { await checkRows(check, m, W_ROWS); });
    await step('4.2 every rejected-entry row of the corpus rejects with its recorded code and message', async () => {
      for (const row of G_ROWS) await expectError(check, `${row.id}`, () => m.policyEntryKey({ ...row.entry }), row.code, 'entry');
    });
    // PLAN-GAP: plan 4.3 assigns A01-A10 to R44/C1/anchors and "W01-W30 and corpus integrity" to R74/C1/corpus, but does not say which of the twelve
    // component assertions owns the complexity regression. It runs here, next to the W rows it follows in section 4.3.
    await step('4.3 complexity regression: *a*a*a*a*a*a*a*a*b against 8192 characters finishes in a child process', async () => {
      await withScratch(context, 'cx', async (dir) => {
        const probe = path.join(dir, 'complexity-probe.mjs');
        fs.writeFileSync(probe, COMPLEXITY_PROBE);
        const r = spawnSync(process.execPath, [probe, context.skillRoot], { timeout: 60000, shell: false, windowsHide: true, encoding: 'utf8', env: { ...context.env }, cwd: context.tmp });
        const diag = { status: r.status, signal: r.signal, error: r.error ? String(r.error.message || r.error.code) : undefined, stdout: String(r.stdout).slice(0, 200), stderr: String(r.stderr).slice(0, 300) };
        check(r.status === 0 && r.signal === null && r.error === undefined && r.stdout === '[false,true]\n' && r.stderr === '', 'the probe exits 0, no signal, no spawn error, prints exactly [false,true] and nothing on stderr', diag);
      });
    });
  });
}

// ===================================================== R74/C1/deduplication ====
// Plan 3.4 and 4.7.
async function deduplication(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['readSecurityPolicy', 'matchesPolicyPath', 'policyEntryKey'])) return;
    const read = (v) => m.readSecurityPolicy(v);
    await step('4.7.1 the complete section 3.4 example', async () => {
      const input = DEDUP_INPUT(); const before = JSON.stringify(input);
      const r = await attempt(() => read(input));
      check(!r.threw, 'reads', r.threw ? errMsg(r.error) : null);
      if (r.threw) return;
      check(eq(sorted(Object.keys(r.value)), ['effectivePatterns', 'policy', 'sourceSchema']), 'the snapshot has exactly sourceSchema, policy and effectivePatterns', Object.keys(r.value));
      check(r.value.sourceSchema === 2, 'sourceSchema is 2', r.value.sourceSchema);
      check(eq(r.value.policy, DEDUP_INPUT()) && r.value.policy !== input, 'the policy is an equal detached copy', r.value.policy);
      check(eq(r.value.effectivePatterns, DEDUP_EFFECTIVE), 'effectivePatterns are exactly the two entries with their source locations', r.value.effectivePatterns);
      check(JSON.stringify(input) === before && Object.isExtensible(input) && !Object.isFrozen(input), 'the input is not mutated');
      check(protoIssues(r.value).length === 0 && sharedObjects(input, r.value) === 0, 'output objects are ordinary and detached', protoIssues(r.value));
    });
    await step('4.7.2 duplicates within and across both arrays; the first occurrence fixes the position', async () => {
      const input = policyOf(
        [{ anchor: 'any', glob: '**/.ENV' }, { anchor: 'root', glob: 'docs/**' }, { anchor: 'any', glob: '**/.env' }],
        [{ anchor: 'root', glob: 'DOCS/**' }, { anchor: 'any', glob: '**/.Env' }, { anchor: 'any', glob: '**/x' }],
      );
      const r = await attempt(() => read(input));
      const want = [
        { anchor: 'any', glob: '**/.env', sources: [{ collection: 'patterns', index: 0 }, { collection: 'patterns', index: 2 }, { collection: 'projectPatterns', index: 1 }] },
        { anchor: 'root', glob: 'docs/**', sources: [{ collection: 'patterns', index: 1 }, { collection: 'projectPatterns', index: 0 }] },
        { anchor: 'any', glob: '**/x', sources: [{ collection: 'projectPatterns', index: 2 }] },
      ];
      check(!r.threw && eq(r.value.effectivePatterns, want), 'effective entries in first-occurrence order with every source appended', r.threw ? errMsg(r.error) : r.value.effectivePatterns);
      check(!r.threw && eq(r.value.policy, input), 'every original entry and spelling stays in the returned policy', r.threw ? null : r.value.policy);
    });
    await step('4.7.3 a matching project entry with empty managed patterns', async () => {
      const input = policyOf([], [{ anchor: 'root', glob: 'private/**', note: 'user' }]);
      const r = await attempt(() => read(input));
      check(!r.threw && eq(r.value.effectivePatterns, [{ anchor: 'root', glob: 'private/**', sources: [{ collection: 'projectPatterns', index: 0 }] }]), 'one effective entry sourced from projectPatterns[0]', r.threw ? errMsg(r.error) : r.value.effectivePatterns);
      const hit = await attempt(() => m.matchesPolicyPath('private/a', input));
      check(!hit.threw && hit.value === true, 'the project entry matches', hit.threw ? errMsg(hit.error) : hit.value);
    });
    await step('4.7.4 invalid duplicates fail before deduplication', async () => {
      await expectError(check, 'a duplicate with an invalid anchor', () => read(policyOf([OKENTRY()], [{ anchor: 'ANY', glob: '**/ok.pem' }])), 'POLICY_ANCHOR', 'projectPatterns[0]');
      await expectError(check, 'a duplicate with a missing glob in the same array', () => read(policyOf([OKENTRY(), { anchor: 'any' }], [])), 'POLICY_GLOB', 'patterns[1]');
      await expectError(check, 'a duplicate carrying non-JSON metadata', () => read(policyOf([OKENTRY()], [{ ...OKENTRY(), note: () => 1 }])), 'POLICY_VALUE');
    });
    await step('4.7.5/4.7.6 differing metadata stays on each source; file metadata, nested arrays and objects survive', async () => {
      const input = {
        schema: 2, $comment: 'file comment', contentRisk: { $comment: 'c', globs: ['**/*.config.ts', '**/k8s/**'] }, codexGlobScanMaxDepth: 6, custom: { keep: [1, [2, { z: null }]], flag: true },
        patterns: [{ glob: '**/*.pem', anchor: 'any', kind: 'key', note: 'a', list: [{ n: 1 }, [2]] }, { glob: '**/*.PEM', anchor: 'any', kind: 'other', nested: { deep: { deeper: ['x'] } } }],
        projectPatterns: [{ glob: '**/*.Pem', anchor: 'any', note: 'user', n: 0 }],
      };
      const r = await attempt(() => read(input));
      check(!r.threw && eq(r.value.policy, input), 'every entry keeps its own metadata and the file metadata survives', r.threw ? errMsg(r.error) : r.value.policy);
      check(!r.threw && r.value.effectivePatterns.length === 1 && r.value.effectivePatterns[0].sources.length === 3, 'the three entries collapse to one effective entry with three sources', r.threw ? null : r.value.effectivePatterns);
    });
    await step('4.7.7 an own __proto__ key survives without changing a prototype', async () => {
      const input = JSON.parse('{"schema":2,"patterns":[{"glob":"**/x","anchor":"any","__proto__":{"a":1}},{"glob":"**/X","anchor":"any","__proto__":{"a":2}}],"projectPatterns":[],"__proto__":{"b":1}}');
      const r = await attempt(() => read(input));
      check(!r.threw && r.value.effectivePatterns.length === 1 && r.value.effectivePatterns[0].sources.length === 2, 'the two duplicates still merge into one effective entry', r.threw ? errMsg(r.error) : r.value.effectivePatterns);
      if (!r.threw) {
        const own = (o) => { const d = Object.getOwnPropertyDescriptor(o, '__proto__'); return d && 'value' in d ? d.value : undefined; };
        check(eq(own(r.value.policy.patterns[0]), { a: 1 }) && eq(own(r.value.policy.patterns[1]), { a: 2 }) && eq(own(r.value.policy), { b: 1 }), 'each entry keeps its own __proto__ data value');
        check(Object.getPrototypeOf(r.value.policy.patterns[0]) === Object.prototype && r.value.policy.patterns[0].a === undefined && r.value.policy.b === undefined, 'no prototype changed');
      }
    });
    await step('4.7.8 deep-frozen input succeeds unchanged', async () => {
      const input = deepFreeze(DEDUP_INPUT());
      const r = await attempt(() => read(input));
      check(!r.threw && eq(r.value.effectivePatterns, DEDUP_EFFECTIVE) && eq(input, DEDUP_INPUT()), 'a frozen section 3.4 example gives the same snapshot and stays equal', r.threw ? errMsg(r.error) : r.value);
    });
    await step('4.7.9 returned data cannot mutate the input or later results', async () => {
      const input = DEDUP_INPUT();
      const r1 = read(input);
      r1.policy.patterns[0].note = 'mutated'; r1.policy.note = 'x'; r1.policy.projectPatterns[1].extra.ticket = 8;
      r1.effectivePatterns[0].sources.push({ collection: 'patterns', index: 99 }); r1.effectivePatterns.pop();
      check(eq(input, DEDUP_INPUT()), 'mutating the first result leaves the input unchanged');
      const r2 = read(input);
      check(eq(r2.policy, DEDUP_INPUT()) && eq(r2.effectivePatterns, DEDUP_EFFECTIVE), 'a later result is unaffected by the earlier mutation', r2);
      check(r2.policy !== r1.policy && r2.effectivePatterns !== r1.effectivePatterns && sharedObjects(r1, r2) === 0, 'two results share no object');
      input.patterns[0].note = 'later'; input.projectPatterns[1].extra.ticket = 9;
      check(r2.policy.patterns[0].note === 'managed' && r2.policy.projectPatterns[1].extra.ticket === 7, 'a result is detached from later input changes');
    });
    await step('4.7.10 input changes between calls affect the next result (no identity cache)', async () => {
      const p = policyOf([{ anchor: 'any', glob: '**/*.pem' }], []);
      const a = read(p);
      p.patterns.push({ anchor: 'root', glob: 'env/**' });
      const b = read(p);
      check(a.effectivePatterns.length === 1 && b.effectivePatterns.length === 2, 'a pushed entry appears in the next snapshot', [a.effectivePatterns.length, b.effectivePatterns.length]);
      const hit = () => m.matchesPolicyPath('src/a.pem', p);
      check(hit() === true, 'before the change the path matches');
      p.patterns[0].glob = '**/*.key';
      check(hit() === false, 'after an in-place glob change the path no longer matches');
      p.patterns[0].glob = 'a**b';
      const r = await attempt(hit);
      check(r.threw && r.error && r.error.code === 'POLICY_GLOBSTAR', 'an in-place change to an invalid glob is rejected, not served from a cache', r.threw ? r.error && r.error.code : r.value);
    });
    await step('4.7.11 a/**/b and a/**/**/b retain distinct keys and distinct effective entries', async () => {
      const k1 = m.policyEntryKey({ anchor: 'root', glob: 'a/**/b' }), k2 = m.policyEntryKey({ anchor: 'root', glob: 'a/**/**/b' });
      check(k1 === '["root","a/**/b"]' && k2 === '["root","a/**/**/b"]' && k1 !== k2, 'distinct keys', [k1, k2]);
      const r = read(policyOf([{ anchor: 'root', glob: 'a/**/b' }, { anchor: 'root', glob: 'a/**/**/b' }], []));
      check(eq(r.effectivePatterns.map((e) => e.glob), ['a/**/b', 'a/**/**/b']), 'two effective entries', r.effectivePatterns);
    });
    await step('4.7.12 lowercase variants share a key; Windows-alias and Unicode variants do not merge identities', async () => {
      const key = (anchor, glob) => m.policyEntryKey({ anchor, glob });
      check(key('any', '**/*.PEM') === key('any', '**/*.pem') && key('any', '**/*.Pem') === key('any', '**/*.pem'), 'lowercase variants share one key');
      check(key('root', '\u00c9.pem') === key('root', '\u00e9.pem'), 'a lowercase-equal Unicode variant shares the key');
      check(key('any', '**/.env') !== key('any', '**/.env.') && key('any', '**/.env') !== key('any', '**/.env::$DATA'), 'a Windows-alias spelling is a separate entry identity (plan 3.3)');
      check(key('root', '\u00e9.pem') !== key('root', 'e\u0301.pem'), 'no Unicode normalization in the identity');
      check(key('any', '**/x') !== key('root', 'x') && key('root', 'a/**') !== key('any', '**/a/**'), 'the anchor is part of the identity');
      const r = read(policyOf([{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/.env.' }], []));
      check(r.effectivePatterns.length === 2, 'alias spellings stay two effective entries', r.effectivePatterns);
    });
    await step('4.7.13 object key order is ignored; array order is exact', async () => {
      const a = read({ schema: 2, patterns: [{ glob: '**/a', anchor: 'any' }, { glob: 'b', anchor: 'root' }], projectPatterns: [] });
      const b = read({ projectPatterns: [], patterns: [{ anchor: 'any', glob: '**/a' }, { anchor: 'root', glob: 'b' }], schema: 2 });
      check(eq(a, b), 'the same data with different key order gives equal snapshots');
      const c = read({ schema: 2, patterns: [{ glob: 'b', anchor: 'root' }, { glob: '**/a', anchor: 'any' }], projectPatterns: [] });
      check(eq(c.effectivePatterns.map((e) => e.glob), ['b', '**/a']) && !eq(a.effectivePatterns, c.effectivePatterns), 'a reversed array gives a reversed effective order');
    });
    await step('4.7.14 deduplicating lowercase variants preserves their matching result', async () => {
      const variants = policyOf([{ anchor: 'any', glob: '**/*.PEM' }, { anchor: 'any', glob: '**/*.pem' }], [{ anchor: 'any', glob: '**/*.Pem' }]);
      const single = policyOf([{ anchor: 'any', glob: '**/*.pem' }], []);
      check(read(variants).effectivePatterns.length === 1, 'the three variants are one effective entry');
      for (const p of ['src/Key.pem', 'KEY.PEM', 'x/key.pem.txt', 'a/b', '.pem']) {
        const a = await attempt(() => m.matchesPolicyPath(p, variants)), b = await attempt(() => m.matchesPolicyPath(p, single));
        check(!a.threw && !b.threw && a.value === b.value, `${show(p)} matches the same with and without the duplicates`, [a.threw ? errMsg(a.error) : a.value, b.threw ? errMsg(b.error) : b.value]);
      }
    });
  });
}

// ===================================================== R75/C1/path-validation ====
// Plan 3.6 and 4.8.
const VALID_PATHS = [
  'src/Key.PEM', 'space dir/a b.txt', 'a\tb', 'a\nb', 'a\rb', 'a\u2028b', 'quote"file', "single'file", 'literal[1]*?.txt',
  '..work/file', '.hidden/file', '-leading', '  ', 'caf\u00e9/File', '.env::$DATA', '.env.', '.env ',
  'secrets::$INDEX_ALLOCATION/t', 'secrets/.../t', 'secrets/ . /t',
];
const INVALID_PATHS = [
  ...[undefined, null, true, 5, {}, ['x'], ''].map((v) => [v, 'POLICY_PATH_TYPE']),
  ['a\u0000b', 'POLICY_PATH_NUL'],
  ...['/x', '//server/share', 'C:/x', 'C:x', '\\x', '\\\\server\\share'].map((v) => [v, 'POLICY_PATH_ABSOLUTE']),
  ...['a\\b', './x', '.', '..', 'a/../b', 'a/./b', 'a//b', 'a/'].map((v) => [v, 'POLICY_PATH_CANONICAL']),
];
async function pathValidation(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['validateRepoPath', 'matchesPolicyPath'])) return;
    await step('4.8 valid inputs return the exact original string', async () => {
      check(VALID_PATHS.length === 20, 'the valid list holds the 20 plan inputs', VALID_PATHS.length);
      for (const p of VALID_PATHS) {
        const r = await attempt(() => m.validateRepoPath(p));
        check(!r.threw && r.value === p, `validateRepoPath(${show(p)}) returns the same string`, r.threw ? errMsg(r.error) : r.value);
      }
    });
    await step('4.8 rejected inputs and their codes; every one also fails through matchesPolicyPath with a valid empty policy', async () => {
      for (const [p, code] of INVALID_PATHS) {
        await expectError(check, `validateRepoPath(${show(p)})`, () => m.validateRepoPath(p), code);
        await expectError(check, `matchesPolicyPath(${show(p)}, empty policy)`, () => m.matchesPolicyPath(p, BASE()), code);
      }
    });
    await step('4.8 precedence: NUL beats an absolute prefix, a drive path is absolute, traversal is rejected unresolved', async () => {
      await expectError(check, 'NUL plus an absolute prefix', () => m.validateRepoPath('/\u0000x'), 'POLICY_PATH_NUL');
      await expectError(check, 'NUL plus a drive prefix', () => m.validateRepoPath('C:\\\u0000x'), 'POLICY_PATH_NUL');
      await expectError(check, 'C:\\x', () => m.validateRepoPath('C:\\x'), 'POLICY_PATH_ABSOLUTE');
      await expectError(check, 'a lowercase drive designator', () => m.validateRepoPath('d:rel'), 'POLICY_PATH_ABSOLUTE');
      await expectError(check, '../x', () => m.validateRepoPath('../x'), 'POLICY_PATH_CANONICAL');
      await expectError(check, 'a backslash after a valid prefix', () => m.validateRepoPath('a\\b/c'), 'POLICY_PATH_CANONICAL');
      await expectError(check, 'a type error beats everything else', () => m.validateRepoPath(undefined), 'POLICY_PATH_TYPE');
    });
    await step('4.8 all retained corpus candidates are valid and preserved exactly, whatever the matching result', async () => {
      for (const row of MATCH_ROWS) {
        const r = await attempt(() => m.validateRepoPath(row.path));
        check(!r.threw && r.value === row.path, `${row.id}: validateRepoPath(${show(row.path)}) returns it unchanged`, r.threw ? errMsg(r.error) : r.value);
      }
    });
    await step('3.6 validation never normalizes: no trim, lowercase or Unicode normalization', async () => {
      for (const p of ['  a  ', 'ABC/Def', 'e\u0301', '\u00c9']) {
        const r = await attempt(() => m.validateRepoPath(p));
        check(!r.threw && r.value === p, `validateRepoPath(${show(p)}) is the identity`, r.threw ? errMsg(r.error) : r.value);
      }
    });
  });
}

// ===================================================== R78/C1/legacy-adapter ====
// Plan 3.1, 3.4 and 4.9.
async function legacyAdapter(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['readSecurityPolicy', 'parseSecurityPolicy', 'matchesPolicyPath'])) return;
    const read = (v) => () => m.readSecurityPolicy(v);
    const L1 = () => ({
      schema: 1,
      patterns: [{ glob: '**/*.PEM', kind: 'key', note: 'keep' }, { glob: 'env/**', kind: 'dir' }],
      contentRisk: { globs: ['**/*.config.ts'] },
      codexGlobScanMaxDepth: 6,
      custom: { keep: [1, 2] },
    });
    await step('4.9 the schema 1 example adapts in memory with every other value preserved', async () => {
      const input = L1(); const before = JSON.stringify(input);
      const r = await attempt(read(input));
      const wantPolicy = {
        schema: 2,
        patterns: [{ glob: '**/*.PEM', kind: 'key', note: 'keep', anchor: 'any' }, { glob: 'env/**', kind: 'dir', anchor: 'root' }],
        projectPatterns: [],
        contentRisk: { globs: ['**/*.config.ts'] },
        codexGlobScanMaxDepth: 6,
        custom: { keep: [1, 2] },
      };
      check(!r.threw && r.value.sourceSchema === 1, 'sourceSchema is 1', r.threw ? errMsg(r.error) : r.value.sourceSchema);
      check(!r.threw && eq(r.value.policy, wantPolicy), 'the policy is schema 2 with anchors any then root, projectPatterns [], and every other value and spelling preserved', r.threw ? null : r.value.policy);
      check(!r.threw && eq(r.value.effectivePatterns, [{ anchor: 'any', glob: '**/*.pem', sources: [{ collection: 'patterns', index: 0 }] }, { anchor: 'root', glob: 'env/**', sources: [{ collection: 'patterns', index: 1 }] }]), 'effective globs are **/*.pem then env/**', r.threw ? null : r.value.effectivePatterns);
      check(JSON.stringify(input) === before, 'the input is not mutated');
      for (const [p, want] of [['env/key', true], ['src/env/key', false], ['src/Key.PEM', true]]) {
        const hit = await attempt(() => m.matchesPolicyPath(p, L1()));
        check(!hit.threw && hit.value === want, `matchesPolicyPath(${show(p)}) on the raw schema 1 policy is ${want}`, hit.threw ? errMsg(hit.error) : hit.value);
      }
    });
    await step('L01 a valid schema 1 projectPatterns array is preserved and its anchors inferred', async () => {
      const input = { schema: 1, patterns: [], projectPatterns: [{ glob: '**/*.tok', note: 'u' }, { glob: 'cfg/*.json', kind: 'k' }] };
      const r = await attempt(read(input));
      check(!r.threw && eq(r.value.policy, { schema: 2, patterns: [], projectPatterns: [{ glob: '**/*.tok', note: 'u', anchor: 'any' }, { glob: 'cfg/*.json', kind: 'k', anchor: 'root' }] }), 'L01 preserved with inferred anchors', r.threw ? errMsg(r.error) : r.value.policy);
      check(!r.threw && eq(r.value.effectivePatterns, [{ anchor: 'any', glob: '**/*.tok', sources: [{ collection: 'projectPatterns', index: 0 }] }, { anchor: 'root', glob: 'cfg/*.json', sources: [{ collection: 'projectPatterns', index: 1 }] }]), 'L01 sources point at projectPatterns', r.threw ? null : r.value.effectivePatterns);
    });
    await step('L02 a present projectPatterns must be an array', async () => {
      for (const v of [null, {}, 'x', 5]) await expectError(check, `L02 projectPatterns ${show(v)}`, read({ schema: 1, patterns: [], projectPatterns: v }), 'POLICY_PROJECT_PATTERNS');
      await expectError(check, 'both schemas require an own patterns array', read({ schema: 1 }), 'POLICY_PATTERNS');
      await expectError(check, 'both schemas require an own patterns array (null)', read({ schema: 1, patterns: null }), 'POLICY_PATTERNS');
    });
    await step('L03-L06, L13 existing anchors must be valid and agree with the inferred anchor', async () => {
      const ok = await attempt(read({ schema: 1, patterns: [{ glob: 'env/**', anchor: 'root' }, { glob: '**/*.pem', anchor: 'any' }] }));
      check(!ok.threw && eq(ok.value.policy.patterns, [{ glob: 'env/**', anchor: 'root' }, { glob: '**/*.pem', anchor: 'any' }]), 'L03 agreeing anchors are accepted unchanged', ok.threw ? errMsg(ok.error) : ok.value.policy.patterns);
      await expectError(check, 'L04 env/** with an any anchor', read({ schema: 1, patterns: [{ glob: 'env/**', anchor: 'any' }] }), 'POLICY_LEGACY_ANCHOR', 'patterns[0]');
      await expectError(check, 'L05 a prefixed glob with a root anchor', read({ schema: 1, patterns: [{ glob: '**/x.pem', anchor: 'root' }] }), 'POLICY_LEGACY_ANCHOR', 'patterns[0]');
      await expectError(check, 'L05 in projectPatterns', read({ schema: 1, patterns: [], projectPatterns: [{ glob: '**/x.pem', anchor: 'root' }] }), 'POLICY_LEGACY_ANCHOR', 'projectPatterns[0]');
      await expectError(check, 'L06 anchor "ANY"', read({ schema: 1, patterns: [{ glob: '**/x', anchor: 'ANY' }] }), 'POLICY_ANCHOR', 'patterns[0]');
      await expectError(check, 'L13 own anchor null', read({ schema: 1, patterns: [{ glob: '**/x', anchor: null }] }), 'POLICY_ANCHOR', 'patterns[0]');
      await expectError(check, 'L13 own anchor empty string', read({ schema: 1, patterns: [{ glob: '**/x', anchor: '' }] }), 'POLICY_ANCHOR', 'patterns[0]');
      await expectError(check, 'a schema 1 entry still needs a nonempty string glob', read({ schema: 1, patterns: [{ kind: 'k' }] }), 'POLICY_GLOB', 'patterns[0]');
      await expectError(check, 'a schema 1 entry must be an object', read({ schema: 1, patterns: ['**/x'] }), 'POLICY_ENTRY', 'patterns[0]');
    });
    await step('L07 an unsupported grammar or PQ1 violation gives the same error as schema 2', async () => {
      for (const r of G_ROWS) {
        if (r.id === 'G24' || r.id === 'G25') continue; // their anchors disagree with the glob; under schema 1 the anchor is inferred
        await expectError(check, `L07 ${r.id} without an anchor in patterns`, read({ schema: 1, patterns: [{ glob: r.entry.glob }] }), r.code, 'patterns[0]');
        await expectError(check, `L07 ${r.id} without an anchor in projectPatterns`, read({ schema: 1, patterns: [], projectPatterns: [{ glob: r.entry.glob }] }), r.code, 'projectPatterns[0]');
      }
    });
    await step('L08 a bare key.pem is root-only; schema 1 env/** stays root-only', async () => {
      const pol = { schema: 1, patterns: [{ glob: 'key.pem' }, { glob: 'env/**' }] };
      for (const [p, want] of [['key.pem', true], ['src/key.pem', false], ['env/key', true], ['src/env/key', false]]) {
        const r = await attempt(() => m.matchesPolicyPath(p, pol));
        check(!r.threw && r.value === want, `L08 ${show(p)} is ${want}`, r.threw ? errMsg(r.error) : r.value);
      }
    });
    await step('L09/L10/L11 no restoration, entries stay in their array, old environment globs are not replaced', async () => {
      const input = { schema: 1, patterns: [{ glob: '**/.env' }, { glob: '**/.env.*' }, { glob: 'docs/private/**', note: 'added' }], projectPatterns: [{ glob: '**/user.tok' }] };
      const r = await attempt(read(input));
      check(!r.threw && eq(r.value.effectivePatterns.map((e) => e.glob), ['**/.env', '**/.env.*', 'docs/private/**', '**/user.tok']), 'L09/L11 exactly the four recorded entries: nothing restored, nothing replaced', r.threw ? errMsg(r.error) : r.value.effectivePatterns);
      check(!r.threw && r.value.policy.patterns.length === 3 && r.value.policy.projectPatterns.length === 1 && r.value.policy.patterns[2].glob === 'docs/private/**', 'L10 an added entry stays in patterns', r.threw ? null : r.value.policy);
      for (const [p, want] of [['.npmrc', false], ['key.pem', false], ['.envrc', false], ['.env-prod', false], ['.env.local', true], ['src/.env', true]]) {
        const hit = await attempt(() => m.matchesPolicyPath(p, input));
        check(!hit.threw && hit.value === want, `L11 ${show(p)} is ${want} under the old globs`, hit.threw ? errMsg(hit.error) : hit.value);
      }
    });
    await step('L12 reading the returned policy again gives sourceSchema 2 and the same effective entries', async () => {
      const first = m.readSecurityPolicy(L1());
      const again = await attempt(() => m.readSecurityPolicy(first.policy));
      check(!again.threw && again.value.sourceSchema === 2 && eq(again.value.effectivePatterns, first.effectivePatterns) && eq(again.value.policy, first.policy), 'L12 sourceSchema 2, equal effective entries and an equal policy', again.threw ? errMsg(again.error) : again.value);
    });
    await step('4.9 data/secret-paths-v2.0.0.json: sourceSchema 1 and exactly the 19 any entries in order', async () => {
      const file = path.join(context.skillRoot, 'data', 'secret-paths-v2.0.0.json');
      const bytes = readBytes(file); check(bytes !== null, 'the immutable v2 snapshot exists', file);
      if (bytes === null) return;
      const text = bytes.toString('utf8');
      const r = await attempt(() => m.parseSecurityPolicy(text));
      check(!r.threw && r.value.sourceSchema === 1, 'sourceSchema is 1', r.threw ? errMsg(r.error) : r.value.sourceSchema);
      if (!r.threw) {
        check(eq(r.value.effectivePatterns, V2_GLOBS.map((glob, index) => ({ anchor: 'any', glob, sources: [{ collection: 'patterns', index }] }))), 'exactly 19 effective entries, all any, in order, each sourced from patterns[i]', r.value.effectivePatterns.map((e) => e.glob));
        const src = JSON.parse(text);
        check(eq(r.value.policy, { ...src, schema: 2, patterns: src.patterns.map((p) => ({ ...p, anchor: 'any' })), projectPatterns: [] }), '$comment, contentRisk, codexGlobScanMaxDepth, other metadata and entry fields are preserved');
        check(r.value.policy.$comment === src.$comment && eq(r.value.policy.contentRisk, src.contentRisk) && r.value.policy.codexGlobScanMaxDepth === src.codexGlobScanMaxDepth, 'the named file metadata is preserved');
      }
      const viaRead = await attempt(() => m.readSecurityPolicy(JSON.parse(text)));
      check(!viaRead.threw && !r.threw && eq(viaRead.value, r.value), 'reading the parsed object equals parsing the text');
      check(readBytes(file) !== null && Buffer.compare(readBytes(file), bytes) === 0, 'the file bytes are unchanged by reading (the adapter never writes)');
    });
    await step('4.9 data/secret-paths.json: passes the reader, sourceSchema 1, every entry valid and preserved, no pinned list', async () => {
      const file = path.join(context.skillRoot, 'data', 'secret-paths.json');
      const bytes = readBytes(file); check(bytes !== null, 'the mutable shipped policy exists', file);
      if (bytes === null) return;
      const text = bytes.toString('utf8'); const src = JSON.parse(text);
      const r = await attempt(() => m.parseSecurityPolicy(text));
      check(!r.threw, 'the shipped policy passes readSecurityPolicy', r.threw ? errMsg(r.error) : null);
      if (!r.threw) {
        check(r.value.sourceSchema === 1, 'sourceSchema is 1 at this landing', r.value.sourceSchema);
        const inferred = (g) => (g.startsWith('**/') ? 'any' : 'root');
        const wantPatterns = src.patterns.map((p) => ({ ...p, anchor: inferred(p.glob) }));
        const wantProject = Array.isArray(src.projectPatterns) ? src.projectPatterns.map((p) => ({ ...p, anchor: inferred(p.glob) })) : [];
        check(eq(r.value.policy, { ...src, schema: 2, patterns: wantPatterns, projectPatterns: wantProject }), 'every source entry and all metadata are preserved under adaptation', r.value.policy && r.value.policy.patterns);
        check(r.value.effectivePatterns.length >= 1 && r.value.effectivePatterns.every((e) => typeof e.glob === 'string' && e.glob === e.glob.toLowerCase()), 'there are effective entries with lowercase globs');
      }
      check(Buffer.compare(readBytes(file), bytes) === 0, 'the file bytes are unchanged by reading');
    });
  });
}

// ===================================================== R97/C1/environment-names ====
// Plan 4.10: E01-E19, all with {anchor: "any", glob: "**/.env*"}.
async function environmentNames(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    if (!m || !needFns(failures, m, ['matchesPolicyPath'])) return;
    await step('4.10 E01-E19 in both placements', async () => { await checkRows(check, m, E_ROWS); });
    await step('4.10 the corpus entry is exactly {anchor: "any", glob: "**/.env*"} on every row', async () => {
      check(E_ROWS.length === 19 && E_ROWS.every((r) => eq(r.entry, { anchor: 'any', glob: '**/.env*' })), 'every E row uses the replacement pattern (C1 does not change the shipped list)');
    });
    await step('4.10 no template exception: E05-E07 stay protected', async () => {
      for (const p of ['.env.example', '.env.sample', '.env.template', 'config/.env.example']) {
        const r = await attempt(() => m.matchesPolicyPath(p, policyOf([{ anchor: 'any', glob: '**/.env*' }], [])));
        check(!r.threw && r.value === true, `${show(p)} is protected`, r.threw ? errMsg(r.error) : r.value);
      }
    });
  });
}

// ===================================================== V2/C1/source-helpers ====
// Plan 2.4 and 4.11.
async function sourceHelpers(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    const lib = await needScript(failures, context, 'lib.mjs');
    if (!m || !lib || !needFns(failures, lib, ['secretGlobs', 'isSecretPath', 'globToRegExp', 'matchesAny', 'assertWritable', 'loadSecretSpec'])) return;
    const secretPolicy = (entry) => policyOf([{ ...entry }], []);
    await step('4.11 valid results equal the shared matcher for the retained A, C, B and E rows', async () => {
      for (const row of rowsOf(A_ROWS, C_ROWS, B_ROWS, E_ROWS)) {
        for (const [where, pol] of placements(row.entry)) {
          const r = await attempt(() => lib.isSecretPath(row.path, pol));
          check(!r.threw && r.value === row.expected, `${row.id} in ${where}: isSecretPath(${show(row.path)}) is ${row.expected}${residualNote(row.id)}`, r.threw ? errMsg(r.error) : r.value);
        }
      }
    });
    await step('4.11 schema 1 env/** stays root-only through both helpers', async () => {
      const pol = { schema: 1, patterns: [{ glob: 'env/**' }] };
      const a = await attempt(() => lib.isSecretPath('env/key', pol)), b = await attempt(() => lib.isSecretPath('src/env/key', pol)), g = await attempt(() => lib.secretGlobs(pol));
      check(!a.threw && a.value === true && !b.threw && b.value === false, 'env/key is secret and src/env/key is not', [a.value, b.value]);
      check(!g.threw && eq(g.value, ['env/**']), 'secretGlobs returns the normalized glob', g.threw ? errMsg(g.error) : g.value);
    });
    await step('4.11 project entries participate in both helpers; secretGlobs follows effective order (section 3.4)', async () => {
      const pol = policyOf([{ anchor: 'any', glob: '**/*.pem' }], [{ anchor: 'root', glob: 'private/**' }]);
      const g = await attempt(() => lib.secretGlobs(pol));
      check(!g.threw && eq(g.value, ['**/*.pem', 'private/**']), 'secretGlobs lists a project entry after the managed ones', g.threw ? errMsg(g.error) : g.value);
      for (const [p, want] of [['private/x', true], ['src/private/x', false], ['a/k.pem', true]]) {
        const r = await attempt(() => lib.isSecretPath(p, pol));
        check(!r.threw && r.value === want, `isSecretPath(${show(p)}) is ${want}`, r.threw ? errMsg(r.error) : r.value);
      }
      const dedup = await attempt(() => lib.secretGlobs(DEDUP_INPUT()));
      check(!dedup.threw && eq(dedup.value, ['**/*.pem', 'env/**']), 'the section 3.4 example gives ["**/*.pem", "env/**"]', dedup.threw ? errMsg(dedup.error) : dedup.value);
      check(!dedup.threw && Array.isArray(dedup.value) && dedup.value.every((x) => typeof x === 'string'), 'secretGlobs returns an array of strings');
      const def = await attempt(() => lib.secretGlobs());
      const want = m.readSecurityPolicy(lib.loadSecretSpec()).effectivePatterns.map((e) => e.glob);
      check(!def.threw && eq(def.value, want), 'the default policy projects to its effective globs', def.threw ? errMsg(def.error) : def.value);
    });
    await step('4.11 malformed policies propagate the exact errors', async () => {
      const cases = [[null, 'POLICY_ROOT', 'entry'], [{ ...BASE(), schema: 3 }, 'POLICY_SCHEMA', 'entry'], [policyOf([{ anchor: 'root', glob: 'a**b' }], []), 'POLICY_GLOBSTAR', 'patterns[0]'],
        [policyOf([{ glob: '**/x' }], []), 'POLICY_ANCHOR', 'patterns[0]'], [{ ...BASE(), meta: () => 1 }, 'POLICY_VALUE', 'entry'], [policyOf([OKENTRY()], [null]), 'POLICY_ENTRY', 'projectPatterns[0]']];
      for (const [pol, code, loc] of cases) {
        await expectError(check, `secretGlobs rethrows ${code}`, () => lib.secretGlobs(pol), code, loc);
        await expectError(check, `isSecretPath rethrows ${code} (a policy error is never turned into true)`, () => lib.isSecretPath('src/a.ts', pol), code, loc);
      }
    });
    await step('4.11 every invalid section 4.8 candidate is secret; ./.env, ./AGENTS.md and the empty string too', async () => {
      for (const [p] of INVALID_PATHS) {
        const r = await attempt(() => lib.isSecretPath(p, BASE()));
        check(!r.threw && r.value === true, `isSecretPath(${show(p)}) is true under a valid empty policy`, r.threw ? errMsg(r.error) : r.value);
      }
      for (const spec of [BASE(), undefined, secretPolicy({ anchor: 'any', glob: '**/*.pem' })]) {
        for (const p of ['./.env', './AGENTS.md', '']) {
          const r = await attempt(() => (spec === undefined ? lib.isSecretPath(p) : lib.isSecretPath(p, spec)));
          check(!r.threw && r.value === true, `isSecretPath(${show(p)}) is true (${spec === undefined ? 'shipped policy' : 'explicit policy'})`, r.threw ? errMsg(r.error) : r.value);
        }
      }
    });
    await step('4.11 an invalid policy still wins over an invalid candidate; unmatched AGENTS.md is false under the shipped policy', async () => {
      await expectError(check, 'invalid policy and invalid candidate', () => lib.isSecretPath('./x', { schema: 3, patterns: [], projectPatterns: [] }), 'POLICY_SCHEMA');
      await expectError(check, 'invalid policy and an empty candidate', () => lib.isSecretPath('', null), 'POLICY_ROOT');
      const r = await attempt(() => lib.isSecretPath('AGENTS.md'));
      check(!r.threw && r.value === false, 'AGENTS.md is not secret under the shipped policy', r.threw ? errMsg(r.error) : r.value);
      const e = await attempt(() => lib.isSecretPath('.env'));
      check(!e.threw && e.value === true, '.env is secret under the shipped policy', e.threw ? errMsg(e.error) : e.value);
    });
    await step('4.11 generic matching stays separate: platform-dependent case, any-depth bare names, a**b crossing /', async () => {
      check(lib.globToRegExp('Docs/**').flags === (process.platform === 'win32' ? 'i' : ''), "globToRegExp('Docs/**').flags is 'i' on win32 and empty elsewhere", lib.globToRegExp('Docs/**').flags);
      check(lib.globToRegExp('Docs/**').test('docs/a') === (process.platform === 'win32'), "globToRegExp('Docs/**').test('docs/a') follows the platform", lib.globToRegExp('Docs/**').test('docs/a'));
      check(lib.globToRegExp('a**b').test('a/x/b') === true, "globToRegExp('a**b').test('a/x/b') is true (the generic matcher still crosses /)");
      check(lib.matchesAny('src/deep/README.md', ['README.md']) === true && lib.matchesAny('README.md', ['README.md']) === true, 'a bare name matches at any depth through the generic matcher');
    });
    await step('4.11 write scope is unchanged', async () => {
      for (const p of ['docs/a.md', '.ai/tools/x.mjs']) {
        const r = await attempt(() => lib.assertWritable(p));
        check(!r.threw, `${p} remains writable`, r.threw ? errMsg(r.error) : null);
      }
      const out = await attempt(() => lib.assertWritable('src/a.ts'));
      check(out.threw && out.error instanceof Error && out.error.message === 'write outside documentation scope: src/a.ts', 'src/a.ts throws write outside documentation scope: src/a.ts', out.threw ? out.error && out.error.message : 'did not throw');
      const den = await attempt(() => lib.assertWritable('.git/config'));
      check(den.threw && den.error instanceof Error && den.error.message === 'write denied by policy: .git/config', '.git/config throws write denied by policy: .git/config', den.threw ? den.error && den.error.message : 'did not throw');
    });
  });
}

// ===================================================== V2/C1/exception-overlap ====
// Plan 3.7, 4.11 and the C1-P4-1 addendum.
const OVERLAP_ROWS = [
  ['**/.env.*', '!*.example', true], ['**/.env.*', '!**/*.example', true], ['**/.env.*', '!.env.?xample', true], ['**/.env.*', '!*', true],
  ['**/.env.*', '![.]env.example', true], ['**/.env.*', '!docs/README.md', false], ['**/.env.*', '!/README.md', false], ['**/secrets/**', '!README.md', true],
  ['**/.env', '!README.md', false], ['/env/**', '!env', true], ['**/*.pem', '!~/public/*', true], ['**/*.pem', '!//public/*', true],
  ['**/*.pem', '!a**b', true], ['**/*.pem', '!a***b', true], ['a**b', '!docs/README.md', true], ['**/*.pem', '', true], ['**/*.pem', null, true],
  ['**/\ud83d\ude00.pem', '!?.pem', true], ['**/key.pem', '!key.pem.', true], ['**/.env', '!.env::$DATA', true], ['**/.env', '!docs/r\u00e9sum\u00e9.md', false],
  ['**/*.pem', '!a.txt.', false],
];
const DIRECT_OVERLAP = [
  [{ anchor: 'root', glob: 'env/**' }, { anchor: 'root', glob: 'docs/*.md' }, false],
  [{ anchor: 'any', glob: '**/.env' }, { anchor: 'root', glob: 'docs/r\u00e9sum\u00e9.md' }, false],
  [{ anchor: 'any', glob: '**/\ud83d\ude00.pem' }, { anchor: 'any', glob: '**/?.pem' }, true],
  [{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/.env::$DATA' }, true],
  [{ anchor: 'any', glob: '**/*.pem' }, { anchor: 'any', glob: '**/a.txt.' }, false],
  [{ anchor: 'root', glob: 'a/**' }, { anchor: 'root', glob: 'a' }, false],
];
async function exceptionOverlap(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    const g = await needScript(failures, context, 'globs.mjs');
    if (!m || !g || !needFns(failures, g, ['globsMayOverlap', 'segmentsIntersect']) || !needFns(failures, m, ['policyEntriesMayOverlap'])) return;
    await step('4.11 globsMayOverlap rows (the permission wrapper)', async () => {
      check(OVERLAP_ROWS.length === 22, 'the table holds the 22 plan rows', OVERLAP_ROWS.length);
      for (const [rule, exc, want] of OVERLAP_ROWS) {
        const r = await attempt(() => g.globsMayOverlap(rule, exc));
        check(!r.threw && r.value === want, `globsMayOverlap(${show(rule)}, ${show(exc)}) is ${want}`, r.threw ? errMsg(r.error) : r.value);
      }
    });
    await step('4.11 the legacy UTF-16 helper assertion is kept', async () => {
      const r = await attempt(() => g.segmentsIntersect('\ud83d\ude00.pem', '?.pem'));
      check(!r.threw && r.value === false, "segmentsIntersect('\\ud83d\\ude00.pem', '?.pem') is false (its result is not used by the shared code-point engine)", r.threw ? errMsg(r.error) : r.value);
    });
    await step('4.11 direct policyEntriesMayOverlap rows', async () => {
      check(DIRECT_OVERLAP.length === 6, 'the table holds the 6 plan rows', DIRECT_OVERLAP.length);
      for (const [l, r, want] of DIRECT_OVERLAP) {
        const got = await attempt(() => m.policyEntriesMayOverlap(l, r));
        check(!got.threw && got.value === want, `policyEntriesMayOverlap(${l.anchor} ${show(l.glob)}, ${r.anchor} ${show(r.glob)}) is ${want}`, got.threw ? errMsg(got.error) : got.value);
      }
    });
    await step('4.11 symmetry for valid direct-entry pairs and input non-mutation', async () => {
      const entries = [...DIRECT_OVERLAP.flatMap(([l, r]) => [l, r]), { anchor: 'any', glob: '**/*.pem' }, { anchor: 'root', glob: 'a/**' }, { anchor: 'any', glob: '**/x' }, { anchor: 'root', glob: '**' }];
      for (const [i, a] of entries.entries()) for (const [j, b] of entries.entries()) {
        const fa = deepFreeze({ ...a }), fb = deepFreeze({ ...b });
        const ab = await attempt(() => m.policyEntriesMayOverlap(fa, fb)), ba = await attempt(() => m.policyEntriesMayOverlap(fb, fa));
        check(!ab.threw && !ba.threw && ab.value === ba.value && typeof ab.value === 'boolean', `entries ${i} and ${j} overlap symmetrically (and frozen entries are accepted unchanged)`, [ab.threw ? errMsg(ab.error) : ab.value, ba.threw ? errMsg(ba.error) : ba.value]);
      }
    });
    await step('C1-P4-1 overlap is form against form; a path-side alias alone is reported disjoint', async () => {
      const w = await attempt(() => g.globsMayOverlap('x', '*q'));
      check(!w.threw && w.value === false, "globsMayOverlap('x', '*q') is false (the overlap exists only through the path x.:q)", w.threw ? errMsg(w.error) : w.value);
      const e = await attempt(() => m.policyEntriesMayOverlap({ anchor: 'any', glob: '**/x' }, { anchor: 'any', glob: '**/*q' }));
      check(!e.threw && e.value === false, 'policyEntriesMayOverlap(**/x, **/*q) is false', e.threw ? errMsg(e.error) : e.value);
      const pos = await attempt(() => m.policyEntriesMayOverlap({ anchor: 'any', glob: '**/x' }, { anchor: 'any', glob: '**/x.' }));
      check(!pos.threw && pos.value === true, 'a glob-side alias form of the right operand intersects (**/x with **/x.)', pos.threw ? errMsg(pos.error) : pos.value);
    });
    // Derived from plan 3.7 steps 1 to 3 (not a plan table row): no row of the 4.11 table discriminates the directory-prefix comparison, because
    // /env/** against !env already intersects at the entry level (the path env/x/env matches both).
    await step('3.7 step 2: the permission wrapper compares the directory prefix of a terminal /** rule; the entry API does not', async () => {
      const rows = [
        ['/env/**', '!/env', true, 'a directory rule collides with an exception that names the directory itself (full-entry comparison is false, the prefix comparison is true)'],
        ['/env/**', '!/docs', false, 'an unrelated anchored exception stays disjoint'],
        ['/env/a', '!/env', false, 'a rule that does not end in /** gets no prefix comparison'],
      ];
      for (const [rule, exc, want, why] of rows) {
        const r = await attempt(() => g.globsMayOverlap(rule, exc));
        check(!r.threw && r.value === want, `globsMayOverlap(${show(rule)}, ${show(exc)}) is ${want}: ${why}`, r.threw ? errMsg(r.error) : r.value);
      }
      const e = await attempt(() => m.policyEntriesMayOverlap({ anchor: 'root', glob: 'env/**' }, { anchor: 'root', glob: 'env' }));
      check(!e.threw && e.value === false, 'policyEntriesMayOverlap(root env/**, root env) stays false: the prefix comparison is the wrapper\'s, not the entry API\'s', e.threw ? errMsg(e.error) : e.value);
    });
    await step('C1-P4-2 the Unicode-disjoint example', async () => {
      const r = await attempt(() => m.policyEntriesMayOverlap({ anchor: 'any', glob: '**/.env' }, { anchor: 'root', glob: 'docs/r\u00e9sum\u00e9.md' }));
      check(!r.threw && r.value === false, 'any **/.env against root docs/r\\u00e9sum\\u00e9.md is false', r.threw ? errMsg(r.error) : r.value);
    });
    await step('3.7 the v2 shipped denies cannot be held back by !docs/r\\u00e9sum\\u00e9.md', async () => {
      const file = path.join(context.skillRoot, 'data', 'secret-paths-v2.0.0.json');
      const bytes = readBytes(file);
      let fileGlobs = null;
      try { fileGlobs = JSON.parse(bytes.toString('utf8')).patterns.map((p) => p.glob); } catch (e) { check(false, 'the immutable v2 snapshot is readable', errMsg(e)); }
      if (fileGlobs) check(eq(fileGlobs, V2_GLOBS), 'the snapshot glob list equals the 19 literals', fileGlobs);
      for (const glob of V2_GLOBS) {
        const r = await attempt(() => g.globsMayOverlap(glob, '!docs/r\u00e9sum\u00e9.md'));
        check(!r.threw && r.value === false, `${glob} does not overlap !docs/r\\u00e9sum\\u00e9.md`, r.threw ? errMsg(r.error) : r.value);
      }
    });
    await step('3.7 a non-string or blank operand stays conservative; a modeled unrelated exception is false', async () => {
      const probes = [['**/*.pem', '   ', true], ['**/*.pem', 5, true], ['**/*.pem', undefined, true], ['**/*.pem', '!docs/README.md', false]];
      for (const [rule, exc, want] of probes) {
        const r = await attempt(() => g.globsMayOverlap(rule, exc));
        check(!r.threw && r.value === want, `globsMayOverlap(${show(rule)}, ${show(exc)}) is ${want}`, r.threw ? errMsg(r.error) : r.value);
      }
    });
  });
}

// ===================================================== V2/C1/module-contract ====
// Plan 2.3, 2.5 and 4.12.
async function moduleContract(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needPolicy(failures, context);
    await step('4.12 import safety and the exact export sets of both files', async () => {
      await withScratch(context, 'imp', async (dir) => {
        checkImportSafe(check, 'assets/tools/security-policy.mjs', context, dir, policyUrl(context), MODULE_EXPORTS);
        checkImportSafe(check, 'tests/c1.test.mjs', context, dir, import.meta.url, CASE_EXPORTS);
      });
    });
    // PLAN-GAP: plan 2.3 permits "Node built-ins" but says the functions have "no filesystem, subprocess, network or environment inputs" without naming
    // which built-ins that excludes. The forbidden list below is this lane's reading (a static proxy; the dynamic checks are import safety, the
    // standalone-copy run and the no-output check). Drop or adjust it if the maintainer reads the sentence differently.
    await step('2.3 the module imports only Node built-ins that perform no I/O (no filesystem, subprocess, network or environment inputs)', async () => {
      const bytes = readBytes(path.join(context.skillRoot, 'assets', 'tools', 'security-policy.mjs'));
      if (bytes === null) { check(false, 'the module source is readable'); return; }
      const text = bytes.toString('utf8');
      const specs = [...text.matchAll(/^\s*import\s[^'"]*?from\s*['"]([^'"]+)['"]/gm), ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm), ...text.matchAll(/^\s*export\s[^'"]*?from\s*['"]([^'"]+)['"]/gm)].map((x) => x[1]);
      const forbidden = ['fs', 'fs/promises', 'child_process', 'net', 'http', 'https', 'http2', 'dgram', 'dns', 'tls', 'os', 'cluster', 'worker_threads', 'readline', 'repl', 'inspector'];
      check(specs.every((s) => s.startsWith('node:') && !forbidden.includes(s.slice(5))), 'every import is a node: built-in outside the I/O set', specs);
    });
    // The registry and runner contracts after this block do not need the policy module.
    if (m && needFns(failures, m, ['readSecurityPolicy', 'parseSecurityPolicy', 'policyEntryKey', 'validateRepoPath', 'matchesPolicyPath', 'policyEntriesMayOverlap'])) {
      await step('2.3 POLICY_SCHEMA_VERSION is 2; the functions are synchronous', async () => {
        check(m.POLICY_SCHEMA_VERSION === 2, 'POLICY_SCHEMA_VERSION === 2', m.POLICY_SCHEMA_VERSION);
        const outs = [m.readSecurityPolicy(BASE()), m.parseSecurityPolicy('{"schema":2,"patterns":[],"projectPatterns":[]}'), m.policyEntryKey(OKENTRY()), m.validateRepoPath('a/b'), m.matchesPolicyPath('a', BASE()), m.policyEntriesMayOverlap(OKENTRY(), OKENTRY())];
        check(outs.every((o) => !(o && typeof o.then === 'function')), 'no function returns a thenable');
        check(typeof outs[2] === 'string' && typeof outs[3] === 'string' && typeof outs[4] === 'boolean' && typeof outs[5] === 'boolean', 'return types are string, string, boolean, boolean');
      });
      await step('4.12 direct calls (including every error path) emit no output and never exit', async () => {
        const rec = await withStreamGuard(async () => {
          for (const row of rowsOf(A_ROWS, C_ROWS, B_ROWS)) m.matchesPolicyPath(row.path, policyOf([{ ...row.entry }], []));
          for (const r of G_ROWS) { try { m.policyEntryKey({ ...r.entry }); } catch { /* expected */ } }
          for (const [p] of INVALID_PATHS) { try { m.validateRepoPath(p); } catch { /* expected */ } }
          for (const t of [undefined, '{', 5]) { try { m.parseSecurityPolicy(t); } catch { /* expected */ } }
          m.policyEntriesMayOverlap(OKENTRY(), { anchor: 'root', glob: 'a/**' });
        });
        check(rec.threw === null, 'the direct calls complete', rec.threw && errMsg(rec.threw));
        check(rec.out.length === 0 && rec.err.length === 0 && rec.exits.length === 0 && !rec.exitCodeChanged, 'no stdout, no stderr, no process.exit, no exit code', { out: rec.out.join('').slice(0, 100), err: rec.err.join('').slice(0, 100), exits: rec.exits });
      });
      await step('2.3 errors have the required name, own code and message for every one of the 20 codes', async () => {
        const probes = [
          ['POLICY_TEXT', () => m.parseSecurityPolicy(5), 'entry'], ['POLICY_JSON', () => m.parseSecurityPolicy('{'), 'entry'], ['POLICY_ROOT', () => m.readSecurityPolicy(null), 'entry'],
          ['POLICY_VALUE', () => m.readSecurityPolicy({ ...BASE(), x: () => 1 }), 'entry'], ['POLICY_SCHEMA', () => m.readSecurityPolicy({ ...BASE(), schema: 3 }), 'entry'],
          ['POLICY_PATTERNS', () => m.readSecurityPolicy({ schema: 2, projectPatterns: [] }), 'entry'], ['POLICY_PROJECT_PATTERNS', () => m.readSecurityPolicy({ schema: 2, patterns: [] }), 'entry'],
          ['POLICY_ENTRY', () => m.readSecurityPolicy(policyOf([null], [])), 'patterns[0]'], ['POLICY_GLOB', () => m.readSecurityPolicy(policyOf([{ anchor: 'any' }], [])), 'patterns[0]'],
          ['POLICY_ANCHOR', () => m.readSecurityPolicy(policyOf([{ glob: 'a' }], [])), 'patterns[0]'], ['POLICY_GLOB_SYNTAX', () => m.policyEntryKey({ anchor: 'root', glob: '[a]' }), 'entry'],
          ['POLICY_GLOBSTAR', () => m.policyEntryKey({ anchor: 'root', glob: 'a**b' }), 'entry'], ['POLICY_GLOB_PATH', () => m.policyEntryKey({ anchor: 'root', glob: 'a//b' }), 'entry'],
          ['POLICY_ANCHOR_ANY', () => m.policyEntryKey({ anchor: 'any', glob: 'a' }), 'entry'], ['POLICY_ANCHOR_ROOT', () => m.policyEntryKey({ anchor: 'root', glob: '**/a' }), 'entry'],
          ['POLICY_LEGACY_ANCHOR', () => m.readSecurityPolicy({ schema: 1, patterns: [{ glob: '**/a', anchor: 'root' }] }), 'patterns[0]'], ['POLICY_PATH_TYPE', () => m.validateRepoPath(''), 'entry'],
          ['POLICY_PATH_NUL', () => m.validateRepoPath('a\u0000'), 'entry'], ['POLICY_PATH_ABSOLUTE', () => m.validateRepoPath('/a'), 'entry'], ['POLICY_PATH_CANONICAL', () => m.validateRepoPath('a//b'), 'entry'],
        ];
        check(eq(probes.map((p) => p[0]), Object.keys(SUFFIX)), 'the probe list covers the 20 codes in plan order', probes.map((p) => p[0]));
        for (const [code, fn, loc] of probes) await expectError(check, `code ${code}`, fn, code, loc);
      });
      await step('4.12 the standalone asset copy passes A01, W04, C01, B01, B05, G01 and reproduces the residuals C05, C07, C11, B12', async () => {
        await withScratch(context, 'alone', async (dir) => {
          const lone = path.join(dir, 'alone');
          fs.mkdirSync(lone);
          fs.copyFileSync(path.join(context.skillRoot, 'assets', 'tools', 'security-policy.mjs'), path.join(lone, 'security-policy.mjs'));
          const copy = await importOrFail(failures, pathToFileURL(path.join(lone, 'security-policy.mjs')).href, 'the standalone copy of security-policy.mjs');
          if (!copy || !needFns(failures, copy, ['matchesPolicyPath', 'policyEntryKey', 'policyEntriesMayOverlap'])) return;
          const pick = (ids) => MATCH_ROWS.filter((r) => ids.includes(r.id));
          await checkRows(check, copy, pick(['A01', 'W04', 'C01', 'B01', 'B05']));
          await checkRows(check, copy, pick(['C05', 'C07', 'C11', 'B12']));
          const g01 = G_ROWS[0];
          await expectError(check, 'standalone G01', () => copy.policyEntryKey({ ...g01.entry }), g01.code, 'entry');
          const r = await attempt(() => copy.policyEntriesMayOverlap({ anchor: 'any', glob: '**/.env' }, { anchor: 'root', glob: 'docs/r\u00e9sum\u00e9.md' }));
          check(!r.threw && r.value === false, 'the standalone copy passes the Unicode-disjoint overlap example', r.threw ? errMsg(r.error) : r.value);
        });
      });
    }
    await step('4.1/4.12 the C1 inventory equals section 4.1 independently; inventory and descriptors are deep-frozen; the implementation array is frozen and shares the test-export objects', async () => {
      const rc = await needSibling(failures, 'rc1-cases.mjs');
      if (!rc) return;
      const exp = rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C1;
      check(Array.isArray(exp) && eq(JSON.parse(JSON.stringify(exp)), EXPECTED_DESCRIPTORS), 'COMPONENT_ASSERTIONS.C1 is the twelve descriptors of plan 4.1 in order', exp);
      check(deepFrozen(exp) && Array.isArray(exp), 'COMPONENT_ASSERTIONS.C1 and every descriptor are deep-frozen');
      const impls = rc.COMPONENT_IMPLEMENTATIONS && rc.COMPONENT_IMPLEMENTATIONS.C1;
      check(Array.isArray(impls) && Object.isFrozen(impls), 'COMPONENT_IMPLEMENTATIONS.C1 is a frozen array', impls && Object.isFrozen(impls));
      check(Array.isArray(impls) && impls.length === C1_IMPLEMENTATIONS.length && impls.every((x, i) => x === C1_IMPLEMENTATIONS[i]), 'it holds exactly the objects of C1_IMPLEMENTATIONS, in order');
      check(eq(C1_IMPLEMENTATIONS.map((x) => x.id), EXPECTED_DESCRIPTORS.map((d) => d.id)) && C1_IMPLEMENTATIONS.every((x) => typeof x.run === 'function'), 'C1_IMPLEMENTATIONS holds the twelve IDs of plan 4.1 with callable run functions');
      check(eq(JSON.parse(JSON.stringify(rc.COMPONENT_ASSERTIONS.C11a)), C11A_DESCRIPTORS), 'the C11a inventory is unchanged', rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C11a);
      check(rc.COMPONENT_IMPLEMENTATIONS && eq(rc.COMPONENT_IMPLEMENTATIONS.C11a.map((x) => x.id), C11A_DESCRIPTORS.map((d) => d.id)), 'the C11a implementations are unchanged', rc.COMPONENT_IMPLEMENTATIONS && rc.COMPONENT_IMPLEMENTATIONS.C11a);
      const calls = []; const ret = rc.registerRc1Cases((...a) => calls.push(a), context);
      check(calls.length === 0 && (ret === undefined || (ret && typeof ret.then === 'function')), 'registerRc1Cases registers no complete rc.1 case', calls.length);
    });
    await step('4.12 runner seam: twelve successful outcomes, a missing first group, a controlled failure, a forbidden skip and a failing evidence writer', async () => {
      const rcm = await needSibling(failures, 'run-component-tests.mjs');
      if (!rcm) return;
      const results = path.join(context.tmp, 'component-results.json');
      const ran = [];
      const impl = (id, make) => ({ id, run: () => { ran.push(id); return make ? make() : { failures: [], skipped: null }; } });
      const exp = () => EXPECTED_DESCRIPTORS.map((d) => ({ ...d }));
      const seam = async (impls, writeEvidence = () => results) => {
        ran.length = 0;
        const rec = await withStreamGuard(() => rcm.main(['--component', 'C1'], { context, registry: { expected: { C1: exp() }, implementations: { C1: impls } }, writeEvidence }));
        check(rec.threw === null && rec.out.length === 0 && rec.err.length === 0 && rec.exits.length === 0, 'main resolves and writes no process stream', rec.threw && errMsg(rec.threw));
        return rec.value;
      };
      const passing = EXPECTED_DESCRIPTORS.map((d) => impl(d.id));
      const ok = await seam(passing);
      const okLines = [...EXPECTED_DESCRIPTORS.map((d) => `PASS  ${d.id}  ${d.name}`), '12 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${results}`];
      check(ok && ok.exitCode === 0 && ok.stderr === '' && ok.stdout === `${okLines.join('\n')}\n`, 'twelve successful outcomes yield the section 6.1 output exactly: exit 0, empty stderr', ok && ok.stdout);
      check(eq(ran, EXPECTED_DESCRIPTORS.map((d) => d.id)), 'each implementation ran once, in expected order', ran);
      const missing = await seam(passing.slice(1));
      check(missing && missing.exitCode === 1 && missing.stderr === '' && missing.stdout === `COMPONENT  FAIL  missing-group  R45/C1/grammar\n0 PASS / 0 FAIL / 0 SKIP\nRESULTS  ${results}\n`, 'a missing first implementation yields missing-group R45/C1/grammar and exit 1', missing && missing.stdout);
      check(ran.length === 0, 'a structural failure executes no implementation', ran);
      const failing = async (index, make, diag, label) => {
        const impls = EXPECTED_DESCRIPTORS.map((d, i) => (i === index ? impl(d.id, make) : impl(d.id)));
        const v = await seam(impls);
        const lines = [...EXPECTED_DESCRIPTORS.flatMap((d, i) => (i === index ? [`FAIL  ${d.id}  ${d.name}`, `        - ${diag}`] : [`PASS  ${d.id}  ${d.name}`])), '11 PASS / 1 FAIL / 0 SKIP', `RESULTS  ${results}`];
        check(v && v.exitCode === 1 && v.stderr === '' && v.stdout === `${lines.join('\n')}\n`, `${label} at position ${index}: FAIL record, the exact diagnostic, 11 PASS / 1 FAIL / 0 SKIP, exit 1`, v && v.stdout);
        check(ran.length === 12, `${label}: the remaining implementations still ran`, ran.length);
      };
      for (const index of [0, 6, 11]) {
        await failing(index, () => ({ failures: ['sentinel'], skipped: null }), 'sentinel', 'failures [sentinel]');
        await failing(index, () => ({ failures: [], skipped: 'sentinel' }), 'skip-forbidden: sentinel', 'skipped "sentinel"');
      }
      const boom = await seam(passing, () => { throw new Error('disk full'); });
      check(boom && boom.exitCode === 1 && boom.stderr === '' && boom.stdout === 'COMPONENT  FAIL  evidence-write\n', 'a throwing evidence writer yields only COMPONENT  FAIL  evidence-write, exit 1, empty stderr', boom);
    });
  });
}

// ===================================================== registration ====
// The array wired into COMPONENT_IMPLEMENTATIONS.C1 (plan 2.5). Each run(context) executes its assigned groups.
export const C1_IMPLEMENTATIONS = [
  { id: 'R45/C1/grammar', run: (context) => grammar(context) },
  { id: 'R45/C1/schema', run: (context) => schema(context) },
  { id: 'R44/C1/anchors', run: (context) => anchors(context) },
  { id: 'R74/C1/case', run: (context) => casePolicy(context) },
  { id: 'R74/C1/corpus', run: (context) => corpus(context) },
  { id: 'R74/C1/deduplication', run: (context) => deduplication(context) },
  { id: 'R75/C1/path-validation', run: (context) => pathValidation(context) },
  { id: 'R78/C1/legacy-adapter', run: (context) => legacyAdapter(context) },
  { id: 'R97/C1/environment-names', run: (context) => environmentNames(context) },
  { id: 'V2/C1/source-helpers', run: (context) => sourceHelpers(context) },
  { id: 'V2/C1/exception-overlap', run: (context) => exceptionOverlap(context) },
  { id: 'V2/C1/module-contract', run: (context) => moduleContract(context) },
];
