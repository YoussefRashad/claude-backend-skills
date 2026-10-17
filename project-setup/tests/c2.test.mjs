// C2 tests lane: the fourteen component assertions of "C2: ownership, metadata transactions and draft review".
//
// Written from the frozen plan only, before any implementation exists:
//   docs/plans/2026-10-17-project-setup-v3-rc1-c2.md   (sections 2-9 and the C2-P3-1 to C2-P3-9 addendum, which wins over earlier sections)
// Under the frozen architecture plan docs/plans/2026-10-15-project-setup-v3-rc1.md and the landed C11a/C1 harness (tests/rc1-cases.mjs,
// tests/run-component-tests.mjs, tests/helpers/v2-baseline.mjs, tests/c11a.test.mjs, tests/c1.test.mjs). The implementer wires
// C2_IMPLEMENTATIONS into COMPONENT_IMPLEMENTATIONS.C2 and writes the expected C2 inventory into COMPONENT_ASSERTIONS.C2 in tests/rc1-cases.mjs,
// and must not edit this file.
//
// Importing this module runs nothing. Every production module (scripts/ownership.mjs, scripts/lib.mjs, scripts/schemas.mjs) and every
// registry module (rc1-cases.mjs and run-component-tests.mjs; rc1-cases.mjs imports this file, so a static import back would be circular) is
// imported lazily inside run(context). A missing module or export fails one assertion with a diagnostic; it never breaks the import.
//
// Every run(context) returns { failures, skipped: null }. There is no skip path: an unavailable optional subcase (a Windows file symlink
// without privilege) is simply not exercised, while junction coverage is mandatory on Windows and a failure to create one is a failure.
// Scratch data lives under context.tmp only; nothing is ever written or deleted anywhere else. No fixture is checked in (plan 2).
//
// Each fixture project is a small synthetic git repository. R86 migration cases start from a genuine v2 installation built by the
// tagged scripts (tests/helpers/v2-baseline.mjs createV2InstalledFixture) after an initial synthetic commit (plan 7.2). Schema-3 states are
// derived from that fixture by rewriting only its manifest (never from this component's own commit), so one failing mechanism does
// not hide the others.
//
// Where the plan does not pin a value a test would need, the test asserts only what is pinned. The gaps are listed in the delegation
// report as PLAN-GAP lines; the places they touch carry a comment starting with "PLAN-GAP". Three readings the plan implies but does not
// spell out are used throughout and are named here so a reviewer can challenge them in one place:
//   - a prepare error entry for a wrongly typed managed/omission value names the affected project target (5.2: "one entry per affected
//     target", "a shape error that prevents resolving targets uses the run-input filename");
//   - before prepare, diff returns metadataRequests as an object whose absent request files are null (6.3: "return validated requests");
//     after prepare it is null;
//   - sourceInventory lists every source, unchanged drafts included (5.3: an absent source yields the inventory row and suppresses its
//     source-body row, and unchanged drafts have source-body rows).
// One fixture fact worth knowing: the existing write scope has no root-level .env.sample or .env.template, so vault operations that must
// pass prepare use docs/.env.sample and docs/.env.template (and .env.example at the root).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcessModule, { spawnSync } from 'node:child_process';
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
  return s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 700);
}
function mkCheck(failures) { return (cond, msg, detail) => { if (!cond) failures.push(detail === undefined ? msg : `${msg} :: ${show(detail)}`); }; }
function deepFreeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }
function deepFrozen(v) { if (v === null || typeof v !== 'object') return true; return Object.isFrozen(v) && Object.values(v).every(deepFrozen); }
const clone = (v) => JSON.parse(JSON.stringify(v));
const sorted = (a) => [...a].sort();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const jsonText = (v) => JSON.stringify(v, null, 2) + '\n';
const toPosix = (p) => String(p).replace(/\\/g, '/');
const HEX64 = /^[0-9a-f]{64}$/;

// A group that fails 400 assertions would bury its own report; the cap keeps the first failures and counts the rest.
const FAILURE_CAP = 60;
// Runs one assertion body. `step` isolates sections so one failing section never hides the others.
async function runAssertion(body) {
  const failures = [];
  const check = mkCheck(failures);
  const step = async (name, fn) => { try { await fn(); } catch (e) { failures.push(`${name}: threw: ${errMsg(e)}`); } };
  try { await body({ failures, check, step }); } catch (e) { failures.push(`threw: ${errMsg(e)}`); }
  if (failures.length > FAILURE_CAP) { const more = failures.length - FAILURE_CAP; failures.length = FAILURE_CAP; failures.push(`(${more} more failures not shown)`); }
  return { failures, skipped: null };
}
async function attempt(fn) { try { return { threw: false, value: await fn() }; } catch (e) { return { threw: true, error: e }; } }

const ownershipUrl = (context) => pathToFileURL(path.join(context.skillRoot, 'scripts', 'ownership.mjs')).href;
const scriptUrl = (context, name) => pathToFileURL(path.join(context.skillRoot, 'scripts', name)).href;
async function importOrFail(failures, url, label) {
  try { return await import(url); } catch (e) { failures.push(`cannot import ${label}: ${errMsg(e)}`); return null; }
}
const needOwnership = (failures, context) => importOrFail(failures, ownershipUrl(context), 'scripts/ownership.mjs');
const needScript = (failures, context, name) => importOrFail(failures, scriptUrl(context, name), `scripts/${name}`);
const needSibling = (failures, rel) => importOrFail(failures, new URL(rel, import.meta.url).href, `tests/${rel}`);
function needFns(failures, mod, names) {
  const missing = names.filter((n) => typeof (mod && mod[n]) !== 'function');
  if (missing.length) failures.push(`missing exports: ${missing.join(', ')}`);
  return missing.length === 0;
}

// ------------------------------------------------------------- scratch ----
function scratchDir(context, label) {
  fs.mkdirSync(context.tmp, { recursive: true });
  return fs.mkdtempSync(path.join(context.tmp, `c2-${label}-`));
}
const rmrf = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };
// Junctions and symlinks created by a test are unlinked by name before the scratch directory is removed, so a recursive removal can never
// reach through one. The registry only holds links this file created.
const createdLinks = new Set();
function dropLink(link) { try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { /* already gone */ } } createdLinks.delete(link); }
async function withScratch(context, label, fn) {
  const dir = scratchDir(context, label);
  try { return await fn(dir); } finally {
    for (const l of [...createdLinks]) { if (l === dir || l.startsWith(dir + path.sep)) dropLink(l); }
    rmrf(dir);
  }
}
const readBytes = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
const readText = (p) => { const b = readBytes(p); return b === null ? null : b.toString('utf8'); };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
function putFile(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }
function isLink(p) { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } }
// Windows: a junction (needs no privilege); elsewhere a directory symlink.
function linkDir(target, link) {
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); createdLinks.add(link); return true; } catch { return false; }
}
function linkFile(target, link) {
  try { fs.symlinkSync(target, link, 'file'); createdLinks.add(link); return true; } catch { return false; }
}

// A deterministic listing of a tree: relative path, kind and SHA-256 of every file. Links are listed, never followed.
function walkTree(root, skipTop = []) {
  const out = [];
  const rec = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!rel && skipTop.includes(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) out.push([r, 'link', null]);
      else if (e.isDirectory()) { out.push([r, 'dir', null]); rec(full, r); } else out.push([r, 'file', sha(fs.readFileSync(full))]);
    }
  };
  rec(root, '');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
const snapshotTree = (root, skipTop = []) => JSON.stringify(walkTree(root, skipTop));
function cloneTree(src, dst) { fs.cpSync(src, dst, { recursive: true }); return dst; }

// Structural helpers for returned JSON data: plain prototypes, and no object shared with the input (returned data is detached).
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
// Checks a successful pure result: equal to the expected value, detached from the (deep-frozen) input, plain prototypes.
function checkDetached(check, label, input, output, expected) {
  check(eq(output, expected), `${label}: the result equals the expected data`, output);
  check(output !== input && sharedObjects(input, output) === 0, `${label}: the result is detached from the input`);
  check(protoIssues(output).length === 0, `${label}: the result holds only plain objects and arrays`, protoIssues(output).slice(0, 3));
}

// ------------------------------------------------------- import safety ----
// Same criteria as C1/C11a (plan 2.1 and 7.11): no spawn, no filesystem write, no output, no process.exit, no exit code.
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

// ============================================================ literals ====
// Written out independently of the implementation (plan 7.1: "Register these independent expected descriptors").
const COMPONENT_INVENTORY = [
  ['R79/C2/policy-schema', 'complete policy ownership metadata'],
  ['R79/C2/settings-schema', 'permission and hook ownership schemas'],
  ['R79/C2/manifest-schema', 'manifest schema 3 and legacy input'],
  ['R86/C2/omissions', 'exact persistent omission identities'],
  ['R86/C2/metadata-only', 'approved metadata without content writes'],
  ['R86/C2/mixed-transaction', 'one content and metadata transaction'],
  ['R80/C2/input-binding', 'all approved inputs remain bound'],
  ['R02/C2/diff-output', 'deterministic read-only draft review'],
  ['R02/C2/no-git', 'draft review invokes no Git'],
  ['R02/C2/diff-safety', 'secret and unsafe targets are refused'],
  ['R15/C2/metadata-binding', 'metadata presence and bytes are approved'],
  ['R29/C2/approval-noop', 'unchanged-file approvals and genuine no-op'],
  ['V2/C2/recovery', 'metadata transaction recovery preserves later edits'],
  ['V2/C2/module-contract', 'shared exports and component registration'],
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
const C1_DESCRIPTORS = [
  { id: 'R45/C1/grammar', name: 'policy grammar and PQ1 rejection' },
  { id: 'R45/C1/schema', name: 'strict policy schemas and errors' },
  { id: 'R44/C1/anchors', name: 'root and any-depth matching' },
  { id: 'R74/C1/case', name: 'platform-independent case matching' },
  { id: 'R74/C1/corpus', name: 'shared policy matching corpus' },
  { id: 'R74/C1/deduplication', name: 'effective entries preserve source metadata' },
  { id: 'R75/C1/path-validation', name: 'structural checks preserve exact path names' },
  { id: 'R78/C1/legacy-adapter', name: 'validated non-writing schema-1 adapter' },
  { id: 'R97/C1/environment-names', name: 'environment-name variant matching' },
  { id: 'V2/C1/source-helpers', name: 'source helpers use shared policy semantics' },
  { id: 'V2/C1/exception-overlap', name: 'user exception overlap stays conservative' },
  { id: 'V2/C1/module-contract', name: 'standalone module and component contracts' },
];
// Plan 2.1: the exact export sets. lib.mjs keeps every export it has at 8b3f1c4 and adds two; schemas.mjs keeps its three.
const OWNERSHIP_EXPORTS = ['hookIdentity', 'isPolicyOmitted', 'readManagedMetadata', 'readManifest', 'readOmissions'];
const LIB_OLD_EXPORTS = ['ENV_TEMPLATE_RE', 'IS_WINDOWS', 'SKILL_DIR', 'WRITE_ALLOWLIST', 'WRITE_DENYLIST', 'assertNotLink', 'assertNotSecretInput', 'assertWritable', 'atomicWrite', 'canonicalPath', 'detectEol', 'fail', 'git', 'globToRegExp', 'hostId', 'isSecretPath', 'loadSecretSpec', 'matchesAny', 'normalizeText', 'normalizedHash', 'ok', 'parseArgs', 'rawFileHash', 'readInRepo', 'readJsonFile', 'repoRoot', 'run', 'safeResolve', 'secretGlobs', 'secureDir', 'secureDirRel', 'sha256', 'skillVersion', 'toPosix', 'validateRunId', 'writeInRepo'];
const LIB_NEW_EXPORTS = ['classifyEnvTemplate', 'setFilesystemRoot'];
const SCHEMAS_EXPORTS = ['checkClaudeSettings', 'checkManifest', 'checkSecurityPolicy'];
const CASE_EXPORTS = ['C2_IMPLEMENTATIONS'];

// Control files and targets (plan 3, 4).
const T_POLICY = '.ai/security-paths.json';
const T_SETTINGS = '.claude/settings.json';
const T_MANIFEST = '.ai/manifest.json';
// Section 4.5 reason strings and the exact CLI error texts of section 5.2.
const R_POLICY = 'policy ownership or managed metadata changes';
const R_SETTINGS = 'settings ownership or managed metadata changes';
const R_OMIT = 'approved omission records change';
const approvalSuffix = (t) => `Show the diff; re-run prepare with --approve-user-content ${t} only after the user approves it`;
const metaApprovalError = (t) => `metadata changes require --approve-user-content ${t}`;
const MSG = {
  DIFF_USAGE: 'usage: apply.mjs diff --project <root> --run-id <id>',
  ROOT: 'explicit project root is not a safe existing directory',
  VAULT_TARGET: 'vault files may only target .env.example/.env.sample/.env.template',
  TARGET_TYPE: 'target is not a regular file',
  DUP: 'target appears in both drafts and vault',
  MANIFEST_DRAFT: 'the manifest is written by commit, not drafted',
  UNRELATED: '--approve-user-content names files that do not need it; refusing broad approvals',
  PLAN_SCHEMA: 'unsupported prepared plan; run prepare again',
  PLAN_INVALID: 'invalid prepared plan; run prepare again',
  PLAN_REJECTED: 'plan rejected',
  DRIFT: 'changes since prepare; nothing was written. Re-run prepare and get approval again.',
  SECRET_DIFF: (t) => `refusing textual diff of secret target: ${t}`,
  SECRET_PREPARE: 'agent drafts may not target secret-pattern paths',
  SCOPE: (t) => `write outside documentation scope: ${t}`,
  DENIED: (t) => `write denied by policy: ${t}`,
  RUN_MISSING: (id) => `run ${id} does not exist; run init first`,
  METADATA_TARGET: (t) => `metadata-only adoption is not supported for ${t}`,
  METADATA_UNKNOWN: (t) => `metadata target is not in this plan or manifest: ${t}`,
  METADATA_OWNERSHIP: (t) => `managed or omission metadata requires keys ownership: ${t}`,
  METADATA_REQUIRED: (t) => `policy keys ownership requires complete managed metadata: ${t}`,
  OWNERSHIP_VALUE: (t, v) => `${t}: invalid ownership "${v}"`,
  DIFF_TEXT: (t) => `cannot render non-text draft: ${t}`,
  INPUT_JSON: (n) => `invalid JSON: ${n}`,
  INPUT_SHAPE: (n) => `invalid run metadata shape: ${n}`,
  PLAN_HASH: 'plan.json differs from the approved plan; re-run prepare and get approval again',
  LOCK: 'lock is not held by this run; run lock.mjs acquire first',
};
// Section 5.3 drift descriptions.
const DRIFT_WHAT = {
  INVENTORY: 'draft inventory changed since prepare',
  TARGET: 'target changed since prepare',
  INPUT: 'transaction input changed since prepare',
  SOURCE: 'draft changed after prepare (unreviewed content)',
  REQUEST: 'manifest metadata changed after prepare (unreviewed ownership)',
  MANIFEST: 'manifest changed since prepare',
};
const REQUEST_FILES = ['ownership.json', 'managed-keys.json', 'omissions.json', 'manifest-metadata.json', 'transaction-inputs.json'];
const reviewText = (id) => `Review with: node <SKILL_DIR>/scripts/apply.mjs diff --project . --run-id ${id}. Vault files are shown only as key names and value classifications. The user approves this planSha256; pass it to commit --approved-plan.`;
const NOOP_BODY = { ok: true, committed: false, reason: 'nothing to change (zero diff)' };
const SECRET_TEMPLATE_NOTE = 'secret-pattern path; content never hashed into reports';

// C1 messages (plan 3.1: C1 errors propagate with C1's original code, message and location). <L> is the C1 location.
const C1_ENTRY = (L) => `POLICY_ENTRY: ${L} must be an object`;
const C1_GLOBSTAR = (L) => `POLICY_GLOBSTAR: ${L}.glob must use * or a separate **/ component; ** must be a whole component`;
const C1_ANCHOR = (L) => `POLICY_ANCHOR: ${L}.anchor must be "any" or "root"`;
const C1_LEGACY = (L) => `POLICY_LEGACY_ANCHOR: ${L}.anchor conflicts with the inferred legacy anchor`;
const C1_PATH_ABSOLUTE = 'POLICY_PATH_ABSOLUTE: path must be repository-relative';
const C1_PATH_CANONICAL = 'POLICY_PATH_CANONICAL: path must use canonical POSIX components';

// The exact settings object of section 3.3 (M4/M5/M6): user order, hook options and unrelated fields must survive.
const PRESERVE_SETTINGS = {
  permissions: { allow: ['Bash(user-one)', 'Bash(user-two)'], deny: ['Read(user-one)', 'Read(user-two)'], defaultMode: 'default' },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'user-one', timeout: 17 }] }] },
  custom: { keep: [2, 1] },
};
const PRESERVE_BYTES = jsonText(PRESERVE_SETTINGS);
// Section 7.8 classifier fixture and expected result.
const ENV_FIXTURE = 'EMPTY=\nPLACE=<value>\nTOKEN=fixture-value\nPORT=3000\n';
const ENV_EXPECTED = [
  { name: 'EMPTY', line: 1, valueState: 'empty' },
  { name: 'PLACE', line: 2, valueState: 'placeholder' },
  { name: 'TOKEN', line: 3, valueState: 'possible-real-secret' },
  { name: 'PORT', line: 4, valueState: 'non-placeholder' },
];

// ========================================================= processes ====
// Plan 7.2: every CLI call is shell-free, uses the absolute Node executable and absolute script paths, a 60 s timeout and a 16 MiB buffer. A
// spawn failure, signal, timeout or truncated output is "dead" and fails the calling assertion.
function execNode(context, { cwd, script, args = [], preload = null, env = null }) {
  const pre = Array.isArray(preload) ? preload : preload ? [preload] : [];
  const argv = [...pre.flatMap((p) => ['--require', p]), script, ...args];
  const r = spawnSync(process.execPath, argv, { cwd, env: env || context.env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000, maxBuffer: 16777216 });
  let dead = null;
  if (r.error) dead = `${r.error.code || 'error'}: ${String(r.error.message).slice(0, 120)}`;
  else if (r.signal) dead = `signal ${r.signal}`;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  let json = null;
  try { json = JSON.parse(stdout); } catch { /* not JSON */ }
  return { code: r.status, stdout, stderr, json, dead };
}
const fmtOk = (r) => r.json !== null && typeof r.json === 'object' && r.stdout === jsonText(r.json);

function gitCmd(context, cwd, args) {
  const r = spawnSync('git', args, { cwd, env: context.env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
  return { code: r.status, stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || '').trim() };
}
function makeRepo(context, dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  const a = gitCmd(context, dir, ['init', '-q']);
  for (const [rel, data] of Object.entries(files)) putFile(path.join(dir, ...rel.split('/')), data);
  gitCmd(context, dir, ['add', '-A']);
  const c = gitCmd(context, dir, ['commit', '-qm', 'init']);
  if (a.code !== 0 || c.code !== 0) throw new Error(`cannot create the fixture repository: ${a.stderr} ${c.stderr}`);
  return dir;
}
function commitAll(context, dir, msg = 'fixture') {
  gitCmd(context, dir, ['add', '-A']);
  const c = gitCmd(context, dir, ['commit', '-qm', msg, '--allow-empty']);
  if (c.code !== 0) throw new Error(`cannot commit the fixture: ${c.stderr}`);
}
const headShort = (context, dir) => gitCmd(context, dir, ['rev-parse', '--short', 'HEAD']).stdout;

// ============================================================= kit ====
// One toolkit per assertion group: every call goes through the group's `check`, so a dead process is reported once, where it happened.
function makeKit(context, check) {
  const scripts = (name) => path.join(context.skillRoot, 'scripts', `${name}.mjs`);
  const exec = (label, scriptPath, args, o = {}) => {
    const r = execNode(context, { cwd: o.cwd, script: scriptPath, args, preload: o.preload || null, env: o.env || null });
    if (r.dead && !o.allowDead) check(false, `${label}: the process did not end normally`, r.dead);
    return r;
  };
  const kit = {
    context, check, scripts,
    apply: (root, args, o = {}) => exec(`apply ${args[0]}`, scripts('apply'), args, { cwd: root, ...o }),
    lock: (root, args, o = {}) => exec(`lock ${args[0]}`, scripts('lock'), args, { cwd: root, ...o }),
    script: (name, root, args, o = {}) => exec(name, scripts(name), args, { cwd: root, ...o }),
    begin(root, id) {
      const a = kit.lock(root, ['acquire', '--run-id', id]);
      const b = kit.apply(root, ['init', '--run-id', id]);
      check(a.code === 0 && b.code === 0, `begin ${id}: lock acquire and init succeed`, { a: a.stdout.slice(0, 200), b: b.stdout.slice(0, 200) });
      return a.code === 0 && b.code === 0;
    },
    prepare(root, id, o = {}) {
      const args = ['prepare', '--run-id', id, '--mode', o.mode || 'update'];
      if (o.agents) args.push('--agents', o.agents);
      if (o.approve && o.approve.length) args.push('--approve-user-content', o.approve.join(','));
      return kit.apply(root, args, o);
    },
    commit(root, id, planSha, o = {}) { return kit.apply(root, ['commit', '--run-id', id, '--approved-plan', planSha], o); },
    diff(root, id, o = {}) {
      return kit.apply(o.cwd || root, ['diff', '--project', o.project !== undefined ? o.project : root, '--run-id', id], o);
    },
    status: (root, id, o = {}) => kit.apply(root, ['status', '--run-id', id], o),
    rollback: (root, id, o = {}) => kit.apply(root, ['rollback', '--run-id', id], o),
  };
  return kit;
}

// ------------------------------------------------------ run-dir helpers ----
const runDirOf = (root, id) => path.join(root, '.ai', '.run', id);
const runFile = (root, id, ...segs) => path.join(runDirOf(root, id), ...segs);
const draftPath = (root, id, rel) => path.join(runDirOf(root, id), 'drafts', ...rel.split('/'));
const vaultPath = (root, id, rel) => path.join(runDirOf(root, id), 'vault', 'files', ...rel.split('/'));
const projPath = (root, rel) => path.join(root, ...rel.split('/'));
function putDraft(root, id, rel, data) { putFile(draftPath(root, id, rel), data); }
function putRequest(root, id, name, value) { putFile(runFile(root, id, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : jsonText(value)); }
const readPlan = (root, id) => readJson(runFile(root, id, 'plan.json'));
const readJournal = (root, id) => readJson(runFile(root, id, 'journal.json'));
const planShaOf = (root, id) => { const b = readBytes(runFile(root, id, 'plan.json')); return b === null ? null : sha(b); };
const lockOwnerPath = (root) => path.join(root, '.ai', '.setup.lock', 'owner.json');
const manifestPath = (root) => path.join(root, '.ai', 'manifest.json');
const readManifestFile = (root) => readJson(manifestPath(root));
const headerOf = (m) => { const h = { ...m }; delete h.files; return h; };
const projectSnapshot = (root) => snapshotTree(root, ['.git']);
const skillVersionOf = (context) => String(readText(path.join(context.skillRoot, 'VERSION')) || '').trim();

// ------------------------------------------------- expected-value helpers ----
// An independent statement of the plan's rules, so a test never takes an expected value from the code under test.
const normText = (s) => { let t = String(s); if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); t = t.replace(/\r\n?/g, '\n'); if (!t.endsWith('\n')) t += '\n'; return t; };
const lineCount = (s) => normText(s).split('\n').length - 1;
// Plan 4.3: the content operation prepare must record for one source and target (secret targets never have their lines counted).
function expectedOp({ target, origin = 'draft', draft, current = null, secret = false, reasons = [] }) {
  const d = Buffer.isBuffer(draft) ? draft : Buffer.from(draft);
  const c = current === null ? null : Buffer.isBuffer(current) ? current : Buffer.from(current);
  const action = c === null ? 'create' : normText(c) === normText(d) ? 'unchanged' : 'modify';
  return {
    target, origin, source: `${origin === 'vault' ? 'vault/files' : 'drafts'}/${target}`, sourceSha256: sha(d), action,
    preRawSha: c === null ? null : sha(c), eol: c !== null && /\r\n/.test(c.toString('utf8')) ? '\r\n' : '\n',
    linesBefore: c !== null && !secret ? lineCount(c.toString('utf8')) : null, linesAfter: origin === 'vault' ? null : lineCount(d.toString('utf8')),
    userContentChange: reasons.length > 0, userContentReasons: reasons,
  };
}
// Compares recorded operations with expected ones. uncommittedUserChanges is only type-checked (it depends on the work tree). For an
// unchanged operation the line counts are only type-checked too (plan 4.3 gives their type, not a value).
function checkOps(check, label, got, want) {
  check(Array.isArray(got) && got.length === want.length, `${label}: ${want.length} content operations`, Array.isArray(got) ? got.map((o) => o && o.target) : got);
  if (!Array.isArray(got)) return;
  want.forEach((w, i) => {
    const g = got[i];
    if (!g || typeof g !== 'object') { check(false, `${label}: operation ${i} is an object`, g); return; }
    check(eq(sorted(Object.keys(g)), sorted([...Object.keys(w), 'uncommittedUserChanges'])), `${label}: operation ${w.target} has exactly the plan 4.3 fields`, Object.keys(g));
    check(typeof g.uncommittedUserChanges === 'boolean', `${label}: ${w.target} uncommittedUserChanges is a boolean`, g.uncommittedUserChanges);
    for (const k of Object.keys(w)) {
      if (w.action === 'unchanged' && (k === 'linesBefore' || k === 'linesAfter')) { check(g[k] === null || Number.isInteger(g[k]), `${label}: ${w.target} ${k} is a number or null`, g[k]); continue; }
      check(eq(g[k], w[k]), `${label}: ${w.target} ${k}`, { got: g[k], want: w[k] });
    }
  });
}
// Plan 6.5, restated: one full-file replacement hunk over normalized text. The literal examples of the plan are asserted against it below.
function textDiff(target, oldText, newText) {
  if (oldText !== null && normText(oldText) === normText(newText)) return null;
  const lines = (t) => { const a = normText(t).split('\n'); a.pop(); return a; };
  const o = oldText === null ? [] : lines(oldText);
  const n = lines(newText);
  const head = oldText === null ? '--- /dev/null' : `--- ${JSON.stringify(`a/${target}`)}`;
  return `${head}\n+++ ${JSON.stringify(`b/${target}`)}\n@@ -${oldText === null ? 0 : 1},${o.length} +1,${n.length} @@\n${o.map((l) => `-${l}`).join('\n')}${o.length ? '\n' : ''}${n.map((l) => `+${l}`).join('\n')}\n`;
}
const canonRoot = (root) => toPosix(fs.realpathSync.native(root));

// Response expectations ------------------------------------------------------
// F: a direct new failure { ok:false, code, error } (plus named extra keys). Two-space JSON, one final LF, empty stderr (plan 5.2).
function expectF(check, label, r, { code, exit, error = null, extra = [] }) {
  check(r.code === exit, `${label}: exit code ${exit}`, { code: r.code, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 200) });
  check(r.stderr === '', `${label}: empty stderr`, r.stderr.slice(0, 200));
  check(r.json !== null && fmtOk(r), `${label}: two-space JSON with one final LF`, r.stdout.slice(0, 200));
  if (!r.json) return;
  check(r.json.ok === false && r.json.code === code, `${label}: ok false with code ${code}`, { ok: r.json.ok, code: r.json.code, error: r.json.error });
  if (typeof error === 'string') check(r.json.error === error, `${label}: error is exactly ${show(error)}`, r.json.error);
  else if (error instanceof RegExp) check(typeof r.json.error === 'string' && error.test(r.json.error), `${label}: error matches ${error}`, r.json.error);
  const want = sorted(['ok', 'code', 'error', ...extra]);
  check(eq(sorted(Object.keys(r.json)), want), `${label}: the envelope holds exactly ${want.join(', ')}`, Object.keys(r.json));
}
// P: a prepare rejection with one entry per affected target, in JavaScript string order (plan 5.2).
function expectP(check, label, r, entries, exit = 3) {
  check(r.code === exit, `${label}: exit code ${exit}`, { code: r.code, stdout: r.stdout.slice(0, 400), stderr: r.stderr.slice(0, 200) });
  check(r.stderr === '', `${label}: empty stderr`, r.stderr.slice(0, 200));
  check(r.json !== null && fmtOk(r), `${label}: two-space JSON with one final LF`, r.stdout.slice(0, 200));
  check(eq(r.json, { ok: false, code: 'APPLY_PLAN_REJECTED', error: MSG.PLAN_REJECTED, errors: entries }), `${label}: the exact plan rejection`, r.json);
}
// An entry where only the code and the message prefix are pinned (the plan does not fix the rest of the message).
function expectPLoose(check, label, r, target, code) {
  check(r.code === 3 && r.stderr === '' && r.json !== null && fmtOk(r), `${label}: exit 3, empty stderr, two-space JSON`, { code: r.code, stdout: r.stdout.slice(0, 300) });
  const j = r.json || {};
  check(j.ok === false && j.code === 'APPLY_PLAN_REJECTED' && j.error === MSG.PLAN_REJECTED && Array.isArray(j.errors) && j.errors.length === 1, `${label}: one plan rejection entry`, j);
  const e = (j.errors || [])[0] || {};
  check(e.target === target, `${label}: the entry names ${target}`, e.target);
  check(typeof e.code === 'string' && (code === null || e.code === code), `${label}: the entry code${code ? ` is ${code}` : ' is a string'}`, e.code);
  check(typeof e.error === 'string' && typeof e.code === 'string' && e.error.startsWith(`${e.code}: `), `${label}: the entry message starts with its code`, e.error);
}

// ========================================================== preloads ====
// External CommonJS preloads (plan 7.2): node --require <absolute-preload.cjs> <absolute-script.mjs> ... The fixture paths are embedded as
// JSON literals; no production fault flag or environment override exists or is used.
const WIN = process.platform === 'win32';
const fold = (s) => (WIN ? s.toLowerCase() : s);
// The comparison keys of a path: the parent resolved through the native realpath plus the leaf name, and the whole native realpath when the
// path exists (so a read through a junction matches a watched file outside it).
function keysOfPath(p) {
  const abs = path.resolve(p);
  const out = [];
  let d = path.dirname(abs);
  try { d = fs.realpathSync.native(d); } catch { /* keep the spelling */ }
  out.push(fold(path.join(d, path.basename(abs))));
  try { out.push(fold(fs.realpathSync.native(abs))); } catch { /* absent */ }
  return out;
}
const destKey = (p) => keysOfPath(p)[0];
const GUARD_SOURCE = (cfg) => [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  `const CFG = ${JSON.stringify(cfg)};`,
  "const WIN = process.platform === 'win32';",
  "const fold = (s) => (WIN ? s.toLowerCase() : s);",
  "const WATCH = new Set(CFG.watch);",
  "function toStr(p) { if (typeof p === 'string') return p; if (p instanceof URL) return require('url').fileURLToPath(p); if (Buffer.isBuffer(p)) return p.toString(); return null; }",
  "function keysOf(p) { const s = toStr(p); if (s === null) return []; let abs; try { abs = path.resolve(s); } catch (e) { return []; } const out = []; let d = path.dirname(abs); try { d = fs.realpathSync.native(d); } catch (e) { /* keep */ } out.push(fold(path.join(d, path.basename(abs)))); try { out.push(fold(fs.realpathSync.native(abs))); } catch (e) { /* absent */ } return out; }",
  "function note(op, key) { try { fs.appendFileSync(CFG.log, JSON.stringify({ op: op, key: key }) + '\\n'); } catch (e) { /* ignore */ } }",
  "function touched(p, op) { let found = false; for (const k of keysOf(p)) { if (WATCH.has(k)) { note(op, k); found = true; } } return found; }",
  "function boom() { const e = new Error('C2 injected read failure'); e.code = 'EACCES'; e.syscall = 'open'; return e; }",
  "function wrap(obj, name, isRead) { const orig = obj[name]; if (typeof orig !== 'function') return; obj[name] = function (p, second) { if (isRead(second) && touched(p, name) && CFG.mode === 'fail') throw boom(); return orig.apply(this, arguments); }; }",
  "const always = () => true;",
  "const readFlag = (f) => f === undefined || f === null || (typeof f === 'string' && (f.charAt(0) === 'r' || f.indexOf('+') >= 0)) || (typeof f === 'number' && (f & 3) !== 1);",
  "wrap(fs, 'readFileSync', always); wrap(fs, 'readFile', always); wrap(fs, 'createReadStream', always); wrap(fs.promises, 'readFile', always);",
  "wrap(fs, 'openSync', readFlag); wrap(fs, 'open', readFlag);",
].join('\n') + '\n';
const FAULT_SOURCE = (cfg) => [
  "'use strict';",
  "const fs = require('fs');",
  "const path = require('path');",
  `const CFG = ${JSON.stringify(cfg)};`,
  "const WIN = process.platform === 'win32';",
  "const fold = (s) => (WIN ? s.toLowerCase() : s);",
  "function keyOf(p) { let abs; try { abs = path.resolve(String(p)); } catch (e) { return null; } let d = path.dirname(abs); try { d = fs.realpathSync.native(d); } catch (e) { /* keep */ } return fold(path.join(d, path.basename(abs))); }",
  "function note(o) { try { fs.appendFileSync(CFG.log, JSON.stringify(o) + '\\n'); } catch (e) { /* ignore */ } }",
  "const counts = {};",
  "const origRename = fs.renameSync;",
  "fs.renameSync = function (from, to) {",
  "  const k = keyOf(to);",
  "  for (let i = 0; i < CFG.rules.length; i++) {",
  "    const r = CFG.rules[i];",
  "    if (r.dest !== k) continue;",
  "    counts[i] = (counts[i] || 0) + 1;",
  "    if (counts[i] !== r.nth) continue;",
  "    if (r.action === 'throw') { note({ rule: i, n: counts[i], action: 'throw' }); const e = new Error('C2 injected rename failure'); e.code = 'EIO'; throw e; }",
  "    if (r.action === 'exit-after') { const res = origRename.apply(this, arguments); note({ rule: i, n: counts[i], action: 'exit-after' }); process.exit(r.exitCode); return res; }",
  "  }",
  "  return origRename.apply(this, arguments);",
  "};",
].join('\n') + '\n';
let preloadSeq = 0;
function writePreload(dir, source) { const f = path.join(dir, `preload-${++preloadSeq}.cjs`); fs.writeFileSync(f, source); return f; }
// Read recording / read failure for a set of watched paths. mode "record" lets the read proceed, "fail" throws EACCES.
function makeGuard(dir, paths, mode = 'record') {
  const log = path.join(dir, `guard-${preloadSeq + 1}.log`);
  const watch = [...new Set(paths.flatMap((p) => keysOfPath(p)))];
  const file = writePreload(dir, GUARD_SOURCE({ log, watch, mode }));
  return { file, log, hits: () => (readText(log) || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }) };
}
// Rename fault injection: rules are { dest: <file path>, nth, action: "throw" | "exit-after", exitCode }.
function makeFault(dir, rules) {
  const log = path.join(dir, `fault-${preloadSeq + 1}.log`);
  const file = writePreload(dir, FAULT_SOURCE({ log, rules: rules.map((r) => ({ dest: destKey(r.dest), nth: r.nth || 1, action: r.action, exitCode: r.exitCode || 137 })) }));
  return { file, log, fired: () => (readText(log) || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return l; } }) };
}

// Plan 7.3: a recording, failing git first on PATH. Windows: a copy of Node named git.exe, a preload that recognizes it and exits 91.
function makeGitShim(context, dir) {
  const shimDir = path.join(dir, 'git-shim');
  fs.mkdirSync(shimDir, { recursive: true });
  const rec = path.join(dir, 'git-records.jsonl');
  const env = {};
  let origPath = null;
  for (const [k, v] of Object.entries(context.env)) {
    if (k.toUpperCase() === 'PATH') { if (origPath === null) origPath = v; continue; } // every case variant of PATH is removed
    env[k] = v;
  }
  env.PATH = `${shimDir}${path.delimiter}${origPath === null ? '' : origPath}`;
  if (WIN) {
    const preload = path.join(dir, 'git-shim.cjs');
    fs.writeFileSync(preload, [
      "'use strict';", "const path = require('path');", "const fs = require('fs');",
      "if (path.basename(process.execPath).toLowerCase() === 'git.exe') {",
      `  fs.appendFileSync(${JSON.stringify(rec)}, JSON.stringify(process.argv.slice(1)) + '\\n');`,
      '  process.exit(91);', '}',
    ].join('\n') + '\n');
    fs.copyFileSync(process.execPath, path.join(shimDir, 'git.exe'));
    env.NODE_OPTIONS = [context.env.NODE_OPTIONS, `--require "${toPosix(preload)}"`].filter(Boolean).join(' ');
  } else {
    const recorder = path.join(dir, 'git-recorder.cjs');
    fs.writeFileSync(recorder, `'use strict';\nrequire('fs').appendFileSync(${JSON.stringify(rec)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(91);\n`);
    const sh = path.join(shimDir, 'git');
    fs.writeFileSync(sh, `#!/bin/sh\nexec "${process.execPath}" "${recorder}" "$@"\n`);
    fs.chmodSync(sh, 0o755);
  }
  return {
    env, rec,
    records: () => (readText(rec) || '').split('\n').filter(Boolean),
    clear: () => fs.writeFileSync(rec, ''),
  };
}

// ======================================================== fixtures ====
// Lazily built, cached per context.tmp, never deleted by a test (the harness removes the whole tmp directory).
const baseCache = new Map();
function cached(context, name, build) {
  const key = `${context.tmp}|${name}`;
  if (!baseCache.has(key)) baseCache.set(key, Promise.resolve().then(build));
  return baseCache.get(key);
}
const getPlainBase = (context) => cached(context, 'plain', () => {
  const dir = scratchDir(context, 'base-plain');
  const root = path.join(dir, 'root');
  makeRepo(context, root, { 'package.json': '{"name":"fixture-app"}\n', 'src/a.ts': 'export {}\n' });
  return { dir, root };
});
// A genuine v2 installation: the tagged scripts ran in a synthetic repository (plan 7.2). The tagged source stays under work/ for the
// "tagged v2 validate rejects schema 3" check.
const getV2Base = (context) => cached(context, 'v2', async () => {
  const dir = scratchDir(context, 'base-v2');
  const root = path.join(dir, 'root');
  const work = path.join(dir, 'work');
  makeRepo(context, root, { 'package.json': '{"name":"fixture-app"}\n', 'src/a.ts': 'export {}\n' });
  const h = await import(new URL('./helpers/v2-baseline.mjs', import.meta.url).href);
  await h.createV2InstalledFixture({ repository: context.repository, root, workDir: work, projectName: 'fixture-wallet-api' });
  commitAll(context, root, 'v2 installed');
  return { dir, root, work, tagged: path.join(work, 'source', 'project-setup') };
});
function installPreserve(context, root) {
  putFile(projPath(root, T_SETTINGS), PRESERVE_BYTES);
  commitAll(context, root, 'preservation settings');
}
const getV2pBase = (context) => cached(context, 'v2p', async () => {
  const v2 = await getV2Base(context);
  const dir = scratchDir(context, 'base-v2p');
  const root = cloneTree(v2.root, path.join(dir, 'root'));
  installPreserve(context, root);
  return { dir, root, tagged: v2.tagged };
});
// Schema 3 derived by rewriting only the manifest: same records, JavaScript key order, serialization of plan 3.5.
function craftV3(context, root, editFiles = null) {
  const m = readManifestFile(root);
  const files = { ...m.files };
  if (editFiles) editFiles(files);
  const ordered = {};
  for (const k of Object.keys(files).sort()) ordered[k] = files[k];
  putFile(manifestPath(root), jsonText({ schema: 3, skill: m.skill, skillVersion: m.skillVersion, mode: m.mode, agents: m.agents, sourceCommit: m.sourceCommit, files: ordered }));
  commitAll(context, root, 'schema 3 manifest');
}
const getV3Base = (context) => cached(context, 'v3', async () => {
  const v2 = await getV2Base(context);
  const dir = scratchDir(context, 'base-v3');
  const root = cloneTree(v2.root, path.join(dir, 'root'));
  craftV3(context, root);
  return { dir, root, tagged: v2.tagged };
});
const getV3pBase = (context) => cached(context, 'v3p', async () => {
  const v2p = await getV2pBase(context);
  const dir = scratchDir(context, 'base-v3p');
  const root = cloneTree(v2p.root, path.join(dir, 'root'));
  craftV3(context, root);
  return { dir, root, tagged: v2p.tagged };
});
// Facts of an installed v2 project that several groups need (read from its own files, never from the code under test).
function baseFacts(root) {
  const manifest = readManifestFile(root);
  const policy = readJson(projPath(root, T_POLICY));
  const settingsRec = manifest.files[T_SETTINGS];
  const deny = settingsRec.managed['permissions.deny'];
  const npmrc = 'Read(**/.npmrc)';
  const npmrcEntry = { anchor: 'any', ...policy.patterns.find((e) => e.glob === '**/.npmrc') };
  return {
    manifest, policy, settingsRec, policyRec: manifest.files[T_POLICY], deny, npmrc, npmrcEntry,
    denyMinus: deny.filter((x) => x !== npmrc),
    // M3: the complete policy managed request (explicit, correctly inferred anchors on every schema-1 entry).
    policyManaged: { schema: policy.schema, patterns: policy.patterns.map((e) => ({ anchor: 'any', ...e })) },
  };
}
// The settings record M5 expects after its request (plan 4.4: Safter).
const m5After = (f) => ({ ...f.settingsRec, managed: { ...f.settingsRec.managed, 'permissions.deny': f.denyMinus }, omissions: { 'permissions.deny': [f.npmrcEntry] } });
const getV3oBase = (context) => cached(context, 'v3o', async () => {
  const v3p = await getV3pBase(context);
  const dir = scratchDir(context, 'base-v3o');
  const root = cloneTree(v3p.root, path.join(dir, 'root'));
  const f = baseFacts(root);
  craftV3(context, root, (files) => { files[T_SETTINGS] = m5After(f); });
  return { dir, root, tagged: v3p.tagged };
});
// Resolves a base or records one failure naming it.
async function useBase(failures, name, getter, context) {
  try { return await getter(context); } catch (e) { failures.push(`cannot build the ${name} fixture: ${errMsg(e)}`); return null; }
}
// A per-test copy of a base project.
function cloneBase(scratch, base, label) { return cloneTree(typeof base === 'string' ? base : base.root, path.join(scratch, label)); }

// A prepared run on a project: lock, init, files, requests, prepare. Returns { ok, root, id, prep, plan }.
function prepared(kit, root, id, setup, o = {}) {
  if (!kit.begin(root, id)) return { ok: false };
  if (setup) setup(root, id);
  const prep = kit.prepare(root, id, o);
  return { ok: prep.code === 0 && prep.json && prep.json.ok === true, root, id, prep, plan: readPlan(root, id), sha: prep.json && prep.json.planSha256 };
}

// =================================================== error expectations ====
// Plan 5.1: new thrown errors are Error objects with an own string code, and a message that starts with "<code>: ".
async function expectErr(check, label, fn, code, message = null) {
  const r = await attempt(fn);
  if (!r.threw) { check(false, `${label}: expected ${code}, got a result`, r.value); return null; }
  const e = r.error;
  check(e instanceof Error, `${label}: an Error instance`, e && e.constructor && e.constructor.name);
  check(hasOwn(e, 'code') && typeof e.code === 'string', `${label}: an own string code`, e && e.code);
  check(e && e.code === code, `${label}: code ${code}`, { code: e && e.code, message: e && e.message });
  if (message !== null) check(e && e.message === message, `${label}: message is exactly ${show(message)}`, e && e.message);
  else check(e && typeof e.message === 'string' && e.message.startsWith(`${code}: `), `${label}: the message starts with "${code}: "`, e && e.message);
  return e;
}
// For outcomes the plan pins only partly: an Error with an own string code and a message prefixed by it, the code in `codes` when given.
async function expectErrAny(check, label, fn, codes = null) {
  const r = await attempt(fn);
  if (!r.threw) { check(false, `${label}: expected an error, got a result`, r.value); return null; }
  const e = r.error;
  check(e instanceof Error && hasOwn(e, 'code') && typeof e.code === 'string', `${label}: an Error with an own string code`, e && e.code);
  check(e && typeof e.message === 'string' && typeof e.code === 'string' && e.message.startsWith(`${e.code}: `), `${label}: the message starts with its code`, e && e.message);
  if (codes) check(e && codes.includes(e.code), `${label}: the code is one of ${codes.join(', ')}`, e && e.code);
  return e;
}
// Runs an accepted case: the input is deep-frozen (so a mutation throws or fails), the result must be detached and equal.
async function expectAccepted(check, label, fn, input, expected) {
  const snapshot = clone(input);
  const frozen = deepFreeze(clone(input));
  const r = await attempt(() => fn(frozen));
  if (r.threw) { check(false, `${label}: accepted`, errMsg(r.error)); return null; }
  check(!(r.value && typeof r.value.then === 'function'), `${label}: synchronous`);
  checkDetached(check, label, frozen, r.value, expected);
  check(eq(frozen, snapshot), `${label}: the input is not mutated`);
  return r.value;
}

// ================================================ R79/C2/policy-schema ====
// Plan 3.1 and 7.4 rows P1-P8, with the validation-order rule of 5.1 (target, container, unknown fields in sorted order, declared fields).
const POLICY_ACCEPT = [
  ['P1 schema 2 with kind and note fields', { schema: 2, patterns: [{ anchor: 'any', glob: '**/.ENV.*', kind: 'env', note: 'keep this spelling' }, { anchor: 'root', glob: 'env/**', extra: { list: [1, 2, { deep: true }], n: null } }] }],
  ['P2 schema 1 with correct explicit anchors', { schema: 1, patterns: [{ anchor: 'any', glob: '**/*.pem', kind: 'key' }, { anchor: 'root', glob: 'env/**' }] }],
  ['P8 duplicate policy identity with different notes', { schema: 2, patterns: [{ anchor: 'any', glob: '**/.ENV', note: 'first' }, { anchor: 'any', glob: '**/.env', note: 'second' }, { anchor: 'any', glob: '**/.env', note: 'second' }] }],
  ['empty pattern list', { schema: 2, patterns: [] }],
];
async function policySchema(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needOwnership(failures, context);
    if (!m || !needFns(failures, m, ['readManagedMetadata'])) return;
    const read = (target, value) => m.readManagedMetadata(target, value);
    await step('P1, P2, P8: complete policy records are accepted, retained in full and detached', async () => {
      for (const [label, input] of POLICY_ACCEPT) {
        const out = await expectAccepted(check, label, (v) => read(T_POLICY, v), input, input);
        if (out) {
          check(eq(out.patterns.map((e) => Object.keys(e)), input.patterns.map((e) => Object.keys(e))), `${label}: entry fields keep their original order`, out.patterns.map((e) => Object.keys(e)));
          check(eq(out.patterns.map((e) => e.glob), input.patterns.map((e) => e.glob)), `${label}: entry spelling and order are retained, nothing is lowercased or deduplicated`, out.patterns.map((e) => e.glob));
        }
      }
    });
    await step('P3, P7: C1 errors propagate with C1 code, message and location (never rewritten to managed.patterns[i])', async () => {
      await expectErr(check, 'P3 a string instead of a policy entry', () => read(T_POLICY, { schema: 2, patterns: ['**/x'] }), 'POLICY_ENTRY', C1_ENTRY('patterns[0]'));
      await expectErr(check, 'P3 the second entry is not an object', () => read(T_POLICY, { schema: 2, patterns: [{ anchor: 'any', glob: '**/a' }, 5] }), 'POLICY_ENTRY', C1_ENTRY('patterns[1]'));
      const e = await expectErr(check, 'P7 glob a**b', () => read(T_POLICY, { schema: 2, patterns: [{ anchor: 'root', glob: 'a**b' }] }), 'POLICY_GLOBSTAR', C1_GLOBSTAR('patterns[0]'));
      check(!e || !e.message.includes('a**b'), 'P7: the message does not echo the glob', e && e.message);
      await expectErr(check, 'an invalid anchor', () => read(T_POLICY, { schema: 2, patterns: [{ anchor: 'sideways', glob: '**/a' }] }), 'POLICY_ANCHOR', C1_ANCHOR('patterns[0]'));
      await expectErr(check, 'schema 1 with an anchor that conflicts with the inferred one', () => read(T_POLICY, { schema: 1, patterns: [{ anchor: 'root', glob: '**/a' }] }), 'POLICY_LEGACY_ANCHOR', C1_LEGACY('patterns[0]'));
    });
    await step('P4, P5, P6 and the container rules: only the two supported targets, only their own fields', async () => {
      await expectErr(check, 'P4 a permission container for the policy', () => read(T_POLICY, { 'permissions.allow': ['Bash(x)'] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'P4 a complete policy plus a permission field', () => read(T_POLICY, { schema: 2, patterns: [], 'permissions.deny': [] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'P5 a policy container for the settings', () => read(T_SETTINGS, { schema: 2, patterns: [] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'P6 metadata for TODO.md', () => read('TODO.md', {}), 'OWNERSHIP_TARGET', 'OWNERSHIP_TARGET: unsupported target TODO.md');
      await expectErr(check, 'P6 metadata for a manifest-listed target that is neither file', () => read('docs/a.md', { schema: 2, patterns: [] }), 'OWNERSHIP_TARGET', 'OWNERSHIP_TARGET: unsupported target docs/a.md');
      await expectErr(check, 'a non-string target', () => read(5, {}), 'OWNERSHIP_TARGET');
      await expectErr(check, 'projectPatterns is not a managed field', () => read(T_POLICY, { schema: 2, patterns: [], projectPatterns: [] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'contentRisk is not a managed field', () => read(T_POLICY, { schema: 2, patterns: [], contentRisk: { globs: [] } }), 'OWNERSHIP_FIELD');
      // The container is not an object at all (null, array, string): a shape error. PLAN-GAP: 5.1 gives the location placeholder only.
      for (const bad of [null, [], 'x', 5, true]) await expectErr(check, `container ${show(bad)}`, () => read(T_POLICY, bad), 'OWNERSHIP_SHAPE');
    });
    await step('order of validation: target first, unknown fields before declared fields and array elements', async () => {
      await expectErr(check, 'target before container', () => read('TODO.md', null), 'OWNERSHIP_TARGET', 'OWNERSHIP_TARGET: unsupported target TODO.md');
      await expectErr(check, 'an unknown field wins over a bad entry', () => read(T_POLICY, { schema: 2, patterns: ['bad'], extra: 1 }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'an unknown field wins over a missing required field', () => read(T_POLICY, { schema: 2, extra: 1 }), 'OWNERSHIP_FIELD');
    });
    await step('a policy request must carry both schema and patterns (M20: no implicit merge)', async () => {
      // PLAN-GAP: 4.1 says "Missing either field fails shared validation" and M20 "Shared shape error" without naming the code or the
      // location, and C1 could also report the missing collection. Only "an error with its own code" is pinned here.
      for (const [label, bad] of [['no patterns', { schema: 2 }], ['no schema', { patterns: [] }], ['empty object', {}], ['schema 1 without patterns', { schema: 1 }]]) {
        await expectErrAny(check, `M20 ${label}`, () => read(T_POLICY, bad));
      }
    });
    await step('the result is data: no thenable, equal results for equal inputs, distinct objects', async () => {
      const input = POLICY_ACCEPT[0][1];
      const a = read(T_POLICY, clone(input));
      const b = read(T_POLICY, clone(input));
      check(!(a && typeof a.then === 'function'), 'readManagedMetadata is synchronous');
      check(eq(a, b) && a !== b && a.patterns !== b.patterns && a.patterns[0] !== b.patterns[0], 'two reads of equal inputs give equal, unshared results');
      a.patterns.push({ anchor: 'any', glob: '**/zz' });
      check(eq(read(T_POLICY, clone(input)), input), 'mutating a result never affects later reads');
    });
  });
}

// ============================================== R79/C2/settings-schema ====
// Plan 3.2 and 7.4 rows S1-S9, the location rule of 5.1 ("an invalid array or primitive element reports the array's location, no index").
const HOOK = (o = {}) => ({ event: 'PreToolUse', matcher: 'Bash', command: 'node check.mjs', ...o });
const SETTINGS_ACCEPT = [
  ['S1 allow, deny and heldBack', { 'permissions.allow': ['Bash(a)', 'Bash(a)', 'Bash(NPM test)'], 'permissions.deny': ['Read(**/.env)', 'Read(**/.ENV.*)'], heldBack: ['Read(\u00e9)'] }],
  ['the empty object', {}],
  ['hooks with three identity fields', { hooks: [HOOK(), HOOK({ matcher: '' })] }],
  ['S4 the same command under different events and matchers', { hooks: [HOOK({ command: 'same' }), HOOK({ event: 'PostToolUse', command: 'same' }), HOOK({ matcher: 'Edit', command: 'same' })] }],
  ['S8 an empty matcher with a valid event and command', { hooks: [{ event: 'Stop', matcher: '', command: 'node x.mjs' }] }],
  ['every field at once, order and duplicates kept', { 'permissions.deny': ['b', 'a', 'b'], 'permissions.allow': ['z'], hooks: [HOOK()], heldBack: [] }],
];
async function settingsSchema(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needOwnership(failures, context);
    if (!m || !needFns(failures, m, ['readManagedMetadata', 'hookIdentity'])) return;
    const read = (value) => m.readManagedMetadata(T_SETTINGS, value);
    await step('S1, S4, S8: accepted settings metadata is returned exactly, detached, with order and duplicates preserved', async () => {
      for (const [label, input] of SETTINGS_ACCEPT) await expectAccepted(check, label, (v) => read(v), input, input);
    });
    await step('S2: invalid arrays and primitive elements report the array location without an index', async () => {
      await expectErr(check, 'S2 a number in the deny array', () => read({ 'permissions.deny': [5] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.deny');
      await expectErr(check, 'a string instead of the deny array', () => read({ 'permissions.deny': 'Read(x)' }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.deny');
      await expectErr(check, 'a bad element after good ones still reports the array', () => read({ 'permissions.deny': ['a', 'b', null] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.deny');
      await expectErr(check, 'a number in the allow array', () => read({ 'permissions.allow': [1] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.allow');
      await expectErr(check, 'a null in heldBack', () => read({ heldBack: [null] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.heldBack');
      await expectErr(check, 'hooks that is not an array', () => read({ hooks: 'x' }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.hooks');
    });
    await step('S3: unknown fields, including permissions.ask, are rejected', async () => {
      await expectErr(check, 'S3 permissions.ask', () => read({ 'permissions.ask': [] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'a nested permissions object', () => read({ permissions: { allow: [] } }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'an approved flag (approvals are never carried in metadata)', () => read({ approved: true }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'P5 a policy container', () => read({ schema: 2, patterns: [] }), 'OWNERSHIP_FIELD');
      for (const bad of [null, [], 'x', 5]) await expectErr(check, `container ${show(bad)}`, () => read(bad), 'OWNERSHIP_SHAPE');
    });
    await step('order of validation: unknown fields first, then declared fields in schema order (allow, deny, hooks, heldBack)', async () => {
      await expectErr(check, 'an unknown field before a bad deny array', () => read({ 'permissions.ask': [], 'permissions.deny': [5] }), 'OWNERSHIP_FIELD');
      await expectErr(check, 'deny is checked before heldBack whatever the key order', () => read({ heldBack: [5], 'permissions.deny': [5] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.deny');
      await expectErr(check, 'allow is checked before deny', () => read({ 'permissions.deny': [5], 'permissions.allow': [5] }), 'OWNERSHIP_SHAPE', 'OWNERSHIP_SHAPE: managed.permissions.allow');
      await expectErr(check, 'hooks are checked before heldBack', () => read({ heldBack: [5], hooks: [null] }), 'HOOK_IDENTITY', 'HOOK_IDENTITY: event, matcher and command are required');
    });
    await step('S5: a duplicate hook identity is rejected at its index; no case folding or trimming', async () => {
      await expectErr(check, 'S5 the same hook twice', () => read({ hooks: [HOOK(), HOOK()] }), 'HOOK_DUPLICATE', 'HOOK_DUPLICATE: hooks[1]');
      await expectErr(check, 'a duplicate after a different hook', () => read({ hooks: [HOOK(), HOOK({ command: 'other' }), HOOK()] }), 'HOOK_DUPLICATE', 'HOOK_DUPLICATE: hooks[2]');
      const out = await attempt(() => read({ hooks: [HOOK(), HOOK({ event: 'pretooluse' }), HOOK({ matcher: 'bash' }), HOOK({ command: 'node check.mjs ' })] }));
      check(!out.threw, 'identities that differ only by case or trailing space are distinct', out.threw ? errMsg(out.error) : null);
    });
    await step('S6, S7, S9: incomplete, extra-field and non-object hook elements all fail with the fixed message', async () => {
      const fixed = 'HOOK_IDENTITY: event, matcher and command are required';
      const bad = [
        ['S6 missing command', { event: 'Stop', matcher: 'x' }], ['S6 empty command', HOOK({ command: '' })], ['an empty event', HOOK({ event: '' })],
        ['a missing event', { matcher: 'x', command: 'c' }], ['a missing matcher', { event: 'Stop', command: 'c' }], ['a non-string matcher', HOOK({ matcher: 5 })],
        ['a null matcher', HOOK({ matcher: null })], ['a non-string command', HOOK({ command: 7 })], ['S7 timeout inside the identity', HOOK({ timeout: 5 })],
        ['an options object inside the identity', HOOK({ options: {} })],
      ];
      for (const [label, h] of bad) await expectErr(check, label, () => read({ hooks: [h] }), 'HOOK_IDENTITY', fixed);
      for (const h of [null, [], 'x', 5, true]) await expectErr(check, `S9 hook element ${show(h)}`, () => read({ hooks: [h] }), 'HOOK_IDENTITY', fixed);
    });
    await step('hookIdentity: the JSON triple, exactly; null, arrays and non-objects fail with the fixed message', async () => {
      const id = (v) => m.hookIdentity(v);
      for (const h of [HOOK(), HOOK({ matcher: '' }), { event: 'E', matcher: 'M', command: 'c' }, { event: 'E', matcher: '', command: 'c d' }, { command: 'c', matcher: 'M', event: 'E' }]) {
        const r = await attempt(() => id(h));
        check(!r.threw && r.value === JSON.stringify([h.event, h.matcher, h.command]), `hookIdentity ${show(h)} is JSON.stringify([event, matcher, command])`, r.threw ? errMsg(r.error) : r.value);
      }
      const e1 = await attempt(() => id({ event: 'E', matcher: '', command: 'c' }));
      check(!e1.threw && e1.value === '["E","","c"]', 'an empty matcher is part of the identity string', e1.value);
      const a = await attempt(() => id(HOOK({ command: 'same' })));
      const b = await attempt(() => id(HOOK({ event: 'PostToolUse', command: 'same' })));
      const c = await attempt(() => id(HOOK({ matcher: 'Edit', command: 'same' })));
      check(!a.threw && !b.threw && !c.threw && new Set([a.value, b.value, c.value]).size === 3, 'S4 the same command under another event or matcher is another identity');
      const frozen = deepFreeze(HOOK());
      const f = await attempt(() => id(frozen));
      check(!f.threw && f.value === JSON.stringify(['PreToolUse', 'Bash', 'node check.mjs']), 'a frozen hook is accepted and not mutated', f.threw ? errMsg(f.error) : f.value);
      for (const bad of [null, undefined, [], 'x', 5, true, {}, { event: 'E' }, { event: 'E', matcher: '' }, { event: '', matcher: '', command: 'c' }, { event: 'E', matcher: 5, command: 'c' }]) {
        await expectErr(check, `hookIdentity(${show(bad)})`, () => id(bad), 'HOOK_IDENTITY', 'HOOK_IDENTITY: event, matcher and command are required');
      }
    });
  });
}

// ===================================================== R86/C2/omissions ====
// Plan 3.4 and 7.4 rows O1-O7. O6 runs through prepare (an omission request without a managed request leaves the managed list alone).
const OMIT_ROWS = [
  // [omitted entry, candidate entry, expected] : the four required results of section 3.4
  [{ anchor: 'any', glob: '**/.ENV.*' }, { anchor: 'any', glob: '**/.env.*' }, true],
  [{ anchor: 'any', glob: '**/.env.*' }, { anchor: 'any', glob: '**/.env*' }, false],
  [{ anchor: 'root', glob: 'env/**' }, { anchor: 'root', glob: 'ENV/**' }, true],
  [{ anchor: 'root', glob: 'env/**' }, { anchor: 'any', glob: '**/env/**' }, false],
];
async function omissions(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needOwnership(failures, context);
    if (m && needFns(failures, m, ['readOmissions', 'isPolicyOmitted'])) {
      await step('O1: the four required identity results, both directions of case, in any position', async () => {
        for (const [omitted, cand, want] of OMIT_ROWS) {
          const r = await attempt(() => m.isPolicyOmitted(deepFreeze(clone(cand)), deepFreeze([clone(omitted)])));
          check(!r.threw && r.value === want, `omitted ${omitted.anchor} ${show(omitted.glob)}, candidate ${cand.anchor} ${show(cand.glob)} -> ${want}`, r.threw ? errMsg(r.error) : r.value);
        }
        const many = [{ anchor: 'any', glob: '**/*.pem' }, { anchor: 'root', glob: 'env/**' }, { anchor: 'any', glob: '**/.NPMRC' }];
        for (const [cand, want] of [[{ anchor: 'any', glob: '**/.npmrc' }, true], [{ anchor: 'root', glob: 'Env/**' }, true], [{ anchor: 'any', glob: '**/*.PEM' }, true], [{ anchor: 'root', glob: '*.pem' }, false]]) {
          const r = await attempt(() => m.isPolicyOmitted(cand, many));
          check(!r.threw && r.value === want, `among several omissions, ${cand.anchor} ${show(cand.glob)} -> ${want}`, r.threw ? errMsg(r.error) : r.value);
        }
        const none = await attempt(() => m.isPolicyOmitted({ anchor: 'any', glob: '**/.env' }, []));
        check(!none.threw && none.value === false, 'an empty omission array omits nothing', none.threw ? errMsg(none.error) : none.value);
      });
      await step('identity is the C1 key only: no filesystem alias, Unicode normalization or coverage inference', async () => {
        const rows = [
          [{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/.env.' }, false],
          [{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/.env::$DATA' }, false],
          [{ anchor: 'any', glob: '**/\u00e9.pem' }, { anchor: 'any', glob: '**/e\u0301.pem' }, false],
          [{ anchor: 'any', glob: '**/*.pem' }, { anchor: 'any', glob: '**/a.pem' }, false],
          [{ anchor: 'any', glob: '**/secrets/**' }, { anchor: 'any', glob: '**/secrets/**' }, true],
        ];
        for (const [omitted, cand, want] of rows) {
          const r = await attempt(() => m.isPolicyOmitted(cand, [omitted]));
          check(!r.threw && r.value === want, `omitted ${show(omitted.glob)}, candidate ${show(cand.glob)} -> ${want}`, r.threw ? errMsg(r.error) : r.value);
        }
      });
      await step('O3: different valid anchored identities are never omitted by one another', async () => {
        const r1 = await attempt(() => m.isPolicyOmitted({ anchor: 'root', glob: '*.pem' }, [{ anchor: 'any', glob: '**/*.pem' }]));
        const r2 = await attempt(() => m.isPolicyOmitted({ anchor: 'any', glob: '**/*.pem' }, [{ anchor: 'root', glob: '*.pem' }]));
        check(!r1.threw && r1.value === false && !r2.threw && r2.value === false, 'root *.pem and any **/*.pem are separate identities', [r1.value, r2.value]);
      });
      await step('O2: case-equivalent duplicate omissions are rejected, before and regardless of any match', async () => {
        const dup = [{ anchor: 'any', glob: '**/.ENV' }, { anchor: 'any', glob: '**/.env' }];
        const e = await expectErrAny(check, 'O2 isPolicyOmitted with duplicates', () => m.isPolicyOmitted({ anchor: 'any', glob: '**/other' }, dup), ['OMISSIONS_DUPLICATE']);
        // PLAN-GAP: 5.1 gives "<location>[<index>]" without the location text; only the code and the index of the duplicate are pinned.
        check(!e || /\[1\]$/.test(e.message), 'O2: the duplicate is reported at index 1', e && e.message);
        await expectErrAny(check, 'O2 readOmissions policy duplicates', () => m.readOmissions(T_POLICY, { patterns: dup }), ['OMISSIONS_DUPLICATE']);
        const e2 = await expectErrAny(check, 'duplicates among three, reported at the second occurrence', () => m.readOmissions(T_POLICY, { patterns: [{ anchor: 'any', glob: '**/a' }, { anchor: 'any', glob: '**/b' }, { anchor: 'any', glob: '**/A' }] }), ['OMISSIONS_DUPLICATE']);
        check(!e2 || /\[2\]$/.test(e2.message), 'the duplicate is at index 2', e2 && e2.message);
        const e3 = await expectErrAny(check, 'settings deny omission duplicates', () => m.readOmissions(T_SETTINGS, { 'permissions.deny': dup }), ['OMISSIONS_DUPLICATE']);
        check(!e3 || /\[1\]$/.test(e3.message), 'the settings deny duplicate is at index 1', e3 && e3.message);
        const e4 = await expectErrAny(check, 'settings allow omission duplicates (exact strings)', () => m.readOmissions(T_SETTINGS, { 'permissions.allow': ['Bash(a)', 'Bash(b)', 'Bash(a)'] }), ['OMISSIONS_DUPLICATE']);
        check(!e4 || /\[2\]$/.test(e4.message), 'the allow duplicate is at index 2', e4 && e4.message);
      });
      await step('O4: a malformed later omission after a match is an error, never an early true', async () => {
        const good = { anchor: 'any', glob: '**/.env' };
        for (const [label, list] of [['after a match', [good, { anchor: 'root', glob: 'a**b' }]], ['after a non-match', [{ anchor: 'any', glob: '**/zzz' }, { anchor: 'root', glob: 'a**b' }]]]) {
          const e = await expectErrAny(check, `O4 malformed omission ${label}`, () => m.isPolicyOmitted(good, list), ['POLICY_GLOBSTAR']);
          check(!e || e.message.startsWith('POLICY_GLOBSTAR: '), `O4 ${label}: the C1 code leads the message`, e && e.message);
        }
        await expectErrAny(check, 'O4 a non-object later omission', () => m.isPolicyOmitted(good, [good, 5]), null);
      });
      await step('O7 and candidate order: a non-array omission list fails exactly; the candidate is validated first', async () => {
        const ok = { anchor: 'any', glob: '**/.env' };
        for (const bad of [null, undefined, 'x', 5, {}, true]) {
          await expectErr(check, `O7 isPolicyOmitted(valid entry, ${show(bad)})`, () => m.isPolicyOmitted(ok, bad), 'OMISSIONS_SHAPE', 'OMISSIONS_SHAPE: omissions.patterns');
        }
        const e = await expectErrAny(check, 'an invalid candidate with a null list reports the candidate (C1)', () => m.isPolicyOmitted({ anchor: 'root', glob: 'a**b' }, null), ['POLICY_GLOBSTAR']);
        check(!e || !e.message.startsWith('OMISSIONS_SHAPE'), 'the second argument is not looked at before the candidate is valid', e && e.message);
        await expectErrAny(check, 'a non-object candidate', () => m.isPolicyOmitted('**/.env', []), ['POLICY_ENTRY']);
      });
      await step('readOmissions: policy and settings shapes are returned exactly and detached; empty containers are valid', async () => {
        const polIn = { patterns: [{ anchor: 'any', glob: '**/.ENV.*', kind: 'env', note: 'keep' }, { anchor: 'root', glob: 'env/**' }] };
        await expectAccepted(check, 'policy omissions', (v) => m.readOmissions(T_POLICY, v), polIn, polIn);
        await expectAccepted(check, 'empty policy omissions', (v) => m.readOmissions(T_POLICY, v), {}, {});
        await expectAccepted(check, 'an empty policy pattern list', (v) => m.readOmissions(T_POLICY, v), { patterns: [] }, { patterns: [] });
        const setIn = { 'permissions.allow': ['Bash(npm test)', 'Bash(NPM test)'], 'permissions.deny': [{ anchor: 'any', glob: '**/.npmrc', kind: 'token' }] };
        await expectAccepted(check, 'O5 settings omissions keep exact allow strings', (v) => m.readOmissions(T_SETTINGS, v), setIn, setIn);
        await expectAccepted(check, 'empty settings omissions', (v) => m.readOmissions(T_SETTINGS, v), {}, {});
        await expectAccepted(check, 'empty settings arrays', (v) => m.readOmissions(T_SETTINGS, v), { 'permissions.allow': [], 'permissions.deny': [] }, { 'permissions.allow': [], 'permissions.deny': [] });
      });
      await step('readOmissions errors: unsupported targets, wrong types, unknown fields, malformed entries', async () => {
        await expectErr(check, 'an unsupported target', () => m.readOmissions('TODO.md', {}), 'OWNERSHIP_TARGET', 'OWNERSHIP_TARGET: unsupported target TODO.md');
        for (const bad of [null, [], 'x', 5]) await expectErr(check, `policy container ${show(bad)}`, () => m.readOmissions(T_POLICY, bad), 'OMISSIONS_SHAPE');
        await expectErr(check, 'a non-array patterns', () => m.readOmissions(T_POLICY, { patterns: 'x' }), 'OMISSIONS_SHAPE');
        // Location text derived from the stated rule (array location, field name after "omissions."), as isPolicyOmitted's example shows.
        await expectErr(check, 'allow omissions with a number', () => m.readOmissions(T_SETTINGS, { 'permissions.allow': [5] }), 'OMISSIONS_SHAPE', 'OMISSIONS_SHAPE: omissions.permissions.allow');
        await expectErr(check, 'a non-array deny omission list', () => m.readOmissions(T_SETTINGS, { 'permissions.deny': 'x' }), 'OMISSIONS_SHAPE', 'OMISSIONS_SHAPE: omissions.permissions.deny');
        // PLAN-GAP: the plan does not say which code reports an unknown omission field (no OMISSIONS_FIELD exists); both candidates are accepted.
        await expectErrAny(check, 'an unknown field in policy omissions', () => m.readOmissions(T_POLICY, { glob: 'x' }), ['OMISSIONS_SHAPE', 'OWNERSHIP_FIELD']);
        await expectErrAny(check, 'permissions.ask omissions', () => m.readOmissions(T_SETTINGS, { 'permissions.ask': [] }), ['OMISSIONS_SHAPE', 'OWNERSHIP_FIELD']);
        await expectErrAny(check, 'hook omissions are outside rc.1', () => m.readOmissions(T_SETTINGS, { hooks: [] }), ['OMISSIONS_SHAPE', 'OWNERSHIP_FIELD']);
        const e = await expectErrAny(check, 'an omission entry with an invalid glob is rejected by C1', () => m.readOmissions(T_POLICY, { patterns: [{ anchor: 'root', glob: 'a**b' }] }), ['POLICY_GLOBSTAR']);
        check(!e || e.message.startsWith('POLICY_GLOBSTAR: '), 'the C1 code leads the message', e && e.message);
      });
    }
    // O6 through the transaction engine: an omission request alone leaves the managed list as it was.
    await step('O6: an omission request without a managed request leaves the managed list unchanged', async () => {
      const kit = makeKit(context, check);
      const base = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
      if (!base) return;
      await withScratch(context, 'o6', async (dir) => {
        const root = cloneBase(dir, base, 'p');
        const f = baseFacts(root);
        const entry = f.npmrcEntry;
        const id = 'run-c2-o6';
        if (!kit.begin(root, id)) return;
        putRequest(root, id, 'omissions.json', { [T_SETTINGS]: { 'permissions.deny': [entry] } });
        const refused = kit.prepare(root, id);
        expectP(check, 'O6 without approval', refused, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
        const p = kit.prepare(root, id, { approve: [T_SETTINGS] });
        check(p.code === 0 && p.json && p.json.ok === true, 'O6 with approval: prepare succeeds', p.stdout.slice(0, 300));
        const after = { ...f.settingsRec, omissions: { 'permissions.deny': [entry] } };
        check(p.json && eq(p.json.metadataOps, [{ kind: 'file', target: T_SETTINGS, before: f.settingsRec, after, requiresApproval: true, reasons: [R_OMIT] }]), 'O6: exactly one file metadata operation: the omission, with the managed record untouched', p.json && p.json.metadataOps);
        check(p.json && p.json.metadataChanged === 1, 'O6: metadataChanged is 1', p.json && p.json.metadataChanged);
        const c = kit.commit(root, id, p.json && p.json.planSha256);
        check(c.code === 0 && c.json && c.json.committed === true, 'O6: commit succeeds', c.stdout.slice(0, 300));
        const rec = (readManifestFile(root) || { files: {} }).files[T_SETTINGS];
        check(eq(rec && rec.managed, f.settingsRec.managed), 'O6: the managed record is unchanged', rec && rec.managed);
        check(eq(rec && rec.omissions, { 'permissions.deny': [entry] }), 'O6: the omission is stored beside it', rec && rec.omissions);
        check(readText(projPath(root, T_SETTINGS)) === PRESERVE_BYTES, 'O6: the settings bytes are unchanged');
      });
    });
  });
}

// ================================================ R79/C2/manifest-schema ====
// Plan 3.5-3.7 and 7.5. The common synthetic schema-3 object of section 7.5, and the exact issue strings of section 5.1.
const V3_OBJ = () => ({ schema: 3, skill: 'project-setup', skillVersion: '2.0.0', mode: 'update', agents: ['claude', 'codex'], sourceCommit: null, files: {} });
const ISSUE = {
  schema: 'schema must be 2 or 3', root: 'root must be an object', skill: 'skill must be "project-setup"', skillVersion: 'skillVersion must be a string',
  agents: 'agents must be an array of strings', files: 'files must be an object', mode: 'mode must be a string', source: 'sourceCommit must be a string or null',
  snippet: 'codexSnippetSha256 must be a sha256 hex',
};
const H = (c) => c.repeat(64);
async function manifestError(m, value) {
  const r = await attempt(() => m.readManifest(value));
  return r.threw ? r.error : null;
}
async function expectManifestErr(check, label, m, value, code, issues) {
  const e = await manifestError(m, value);
  if (!e) { check(false, `${label}: expected ${code}`); return null; }
  check(e instanceof Error && hasOwn(e, 'code') && e.code === code, `${label}: code ${code}`, { code: e.code, message: e.message });
  const msg = code === 'MANIFEST_SCHEMA' ? 'MANIFEST_SCHEMA: schema must be 2 or 3' : 'MANIFEST_INVALID: invalid manifest';
  check(e.message === msg, `${label}: message is exactly ${show(msg)}`, e.message);
  check(hasOwn(e, 'issues') && Array.isArray(e.issues) && e.issues.every((x) => typeof x === 'string'), `${label}: an own issues array of strings`, e.issues);
  if (issues) check(eq(e.issues, issues), `${label}: the exact issues`, e.issues);
  return e;
}
// Facts of a detect run (plan 3.7), checked together so each scenario states only what differs.
function checkDetect(check, label, r, exp) {
  check(r.code === 0 && r.json !== null && r.json.ok === true, `${label}: detect exits 0 with ok true (an inventory command)`, { code: r.code, out: r.stdout.slice(0, 200), err: r.stderr.slice(0, 200) });
  const j = r.json || {};
  if (exp.mode !== undefined) check(j.mode === exp.mode, `${label}: top-level mode ${exp.mode}`, j.mode);
  if (exp.manifest === null) check(j.ai && j.ai.manifest === null, `${label}: ai.manifest is null when the manifest is absent`, j.ai && j.ai.manifest);
  else if (exp.manifest) {
    check(eq(j.ai && j.ai.manifest, exp.manifest), `${label}: ai.manifest is the exact summary`, j.ai && j.ai.manifest);
    check(eq(sorted(Object.keys((j.ai && j.ai.manifest) || {})), ['errors', 'mode', 'needsUpdate', 'schema', 'skillVersion', 'status']), `${label}: ai.manifest holds exactly the six summary fields`, Object.keys((j.ai && j.ai.manifest) || {}));
  }
  const ev = Array.isArray(j.evidence) ? j.evidence : [];
  if (exp.evidenceOnly) check(eq(ev, exp.evidenceOnly), `${label}: the evidence is exactly ${exp.evidenceOnly.join(' / ')}`, ev);
  if (exp.evidenceHas) check(ev.includes(exp.evidenceHas), `${label}: the evidence includes ${show(exp.evidenceHas)}`, ev);
  const warn = Array.isArray(j.warnings) ? j.warnings : [];
  const W = 'invalid .ai/manifest.json; repair or restore it before setup';
  if (exp.warn === true) check(warn.includes(W), `${label}: the warning ${show(W)} is present`, warn);
  if (exp.warn === false) check(!warn.includes(W), `${label}: no invalid-manifest warning`, warn);
}
function detectAt(kit, root, o = {}) { return kit.script('detect', root, [], o); }
function validateAt(kit, root, o = {}) { return kit.script('validate', root, [], o); }
const hasRes = (j, rec) => Array.isArray(j && j.results) && j.results.some((x) => eq(x, rec));
const sameSummary = (j) => Array.isArray(j && j.results) && j.summary && eq(j.summary, { pass: j.results.filter((x) => x.level === 'pass').length, warn: j.results.filter((x) => x.level === 'warn').length, fail: j.results.filter((x) => x.level === 'fail').length });

async function manifestSchema(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const m = await needOwnership(failures, context);
    const schemas = await needScript(failures, context, 'schemas.mjs');
    const kit = makeKit(context, check);
    if (m && needFns(failures, m, ['readManifest', 'readManagedMetadata', 'readOmissions'])) {
      await step('7.5 valid schema 3 and valid schema 2: reported schema, needsUpdate, detached equal copy, no migration', async () => {
        const v3 = V3_OBJ();
        const r3 = await attempt(() => m.readManifest(deepFreeze(clone(v3))));
        check(!r3.threw && eq(sorted(Object.keys(r3.value)), ['manifest', 'needsUpdate', 'sourceSchema']), 'schema 3: the result has exactly sourceSchema, needsUpdate and manifest', r3.threw ? errMsg(r3.error) : r3.value);
        if (!r3.threw) {
          check(r3.value.sourceSchema === 3 && r3.value.needsUpdate === false, 'schema 3: sourceSchema 3, needsUpdate false', r3.value);
          checkDetached(check, 'schema 3 manifest', v3, r3.value.manifest, v3);
        }
        const v2 = { ...V3_OBJ(), schema: 2 };
        const r2 = await attempt(() => m.readManifest(deepFreeze(clone(v2))));
        check(!r2.threw && r2.value.sourceSchema === 2 && r2.value.needsUpdate === true, 'schema 2: sourceSchema 2, needsUpdate true', r2.threw ? errMsg(r2.error) : r2.value);
        if (!r2.threw) checkDetached(check, 'schema 2 manifest', v2, r2.value.manifest, v2);
        const legacy = { schema: 2, skill: 'project-setup', skillVersion: '2.0.0', agents: ['claude'], files: {} };
        const rl = await attempt(() => m.readManifest(legacy));
        check(!rl.threw && rl.value.sourceSchema === 2 && eq(rl.value.manifest, legacy), 'schema 2 without mode and sourceCommit is valid legacy input and is returned unmigrated (no mode added)', rl.threw ? errMsg(rl.error) : rl.value);
        const bad2 = await manifestError(m, { ...legacy, mode: 5 });
        check(bad2 && bad2.issues && eq(bad2.issues, [ISSUE.mode]), 'schema 2: a present mode must have the schema 3 type', bad2 && bad2.issues);
        const bad3 = await manifestError(m, { ...legacy, sourceCommit: 5 });
        check(bad3 && bad3.issues && eq(bad3.issues, [ISSUE.source]), 'schema 2: a present sourceCommit must be a string or null', bad3 && bad3.issues);
        const noMode = { ...V3_OBJ() }; delete noMode.mode;
        const e1 = await manifestError(m, noMode);
        check(e1 && e1.issues && eq(e1.issues, [ISSUE.mode]), 'schema 3: mode is required', e1 && e1.issues);
        const noSrc = { ...V3_OBJ() }; delete noSrc.sourceCommit;
        const e2 = await manifestError(m, noSrc);
        check(e2 && e2.issues && eq(e2.issues, [ISSUE.source]), 'schema 3: sourceCommit is required (a string or null)', e2 && e2.issues);
        const withSha = { ...V3_OBJ(), sourceCommit: 'abc1234', codexSnippetSha256: H('a') };
        const ok = await attempt(() => m.readManifest(withSha));
        check(!ok.threw && eq(ok.value.manifest, withSha), 'a string sourceCommit and a lowercase 64-hex snippet hash are accepted and kept', ok.threw ? errMsg(ok.error) : null);
        check(!ok.threw && !hasOwn((m.readManifest(V3_OBJ()).manifest), 'codexSnippetSha256'), 'codexSnippetSha256 is not synthesized when absent');
      });
      await step('7.5 unknown or missing schema: MANIFEST_SCHEMA with the exact issue', async () => {
        const noSchema = V3_OBJ(); delete noSchema.schema;
        for (const [label, v] of [['a missing schema', noSchema], ['the string "3"', { ...V3_OBJ(), schema: '3' }], ['schema 1', { ...V3_OBJ(), schema: 1 }], ['schema 4', { ...V3_OBJ(), schema: 4 }], ['schema 2.5', { ...V3_OBJ(), schema: 2.5 }], ['a null schema', { ...V3_OBJ(), schema: null }]]) {
          await expectManifestErr(check, label, m, v, 'MANIFEST_SCHEMA', [ISSUE.schema]);
        }
      });
      await step('7.5 non-object roots fail root validation before schema validation', async () => {
        for (const v of [null, [], 'x', 5, true, undefined]) await expectManifestErr(check, `root ${show(v)}`, m, v, 'MANIFEST_INVALID', [ISSUE.root]);
      });
      await step('7.5 invalid common fields retain the structural issue strings, in the existing order', async () => {
        await expectManifestErr(check, 'skill', m, { ...V3_OBJ(), skill: 'other' }, 'MANIFEST_INVALID', [ISSUE.skill]);
        await expectManifestErr(check, 'skillVersion', m, { ...V3_OBJ(), skillVersion: 5 }, 'MANIFEST_INVALID', [ISSUE.skillVersion]);
        await expectManifestErr(check, 'agents', m, { ...V3_OBJ(), agents: ['claude', 1] }, 'MANIFEST_INVALID', [ISSUE.agents]);
        await expectManifestErr(check, 'files as an array', m, { ...V3_OBJ(), files: [] }, 'MANIFEST_INVALID', [ISSUE.files]);
        await expectManifestErr(check, 'files as null', m, { ...V3_OBJ(), files: null }, 'MANIFEST_INVALID', [ISSUE.files]);
        await expectManifestErr(check, 'mode', m, { ...V3_OBJ(), mode: {} }, 'MANIFEST_INVALID', [ISSUE.mode]);
        await expectManifestErr(check, 'sourceCommit', m, { ...V3_OBJ(), sourceCommit: 7 }, 'MANIFEST_INVALID', [ISSUE.source]);
        // PLAN-GAP: 5.1 does not place mode and sourceCommit relative to the other common fields, so the combined case leaves them valid.
        await expectManifestErr(check, 'common fields, then files in sorted order, then the snippet', m, {
          ...V3_OBJ(), skill: 'x', skillVersion: 5, agents: [1], codexSnippetSha256: 'q',
          files: { 'b.md': { ownership: 'full', sha256: 'zz' }, 'a.md': { ownership: 'blocks', blocks: { x: 'bad' } } },
        }, 'MANIFEST_INVALID', [ISSUE.skill, ISSUE.skillVersion, ISSUE.agents, 'files["a.md"].blocks must map ids to sha256 hex', 'files["b.md"].sha256 must be a sha256 hex', ISSUE.snippet]);
      });
      await step('7.5 per-file records: v2 issue strings, new metadata and omission issues, bad keys, the self-record', async () => {
        const withFiles = (files, extra = {}) => ({ ...V3_OBJ(), files, ...extra });
        await expectManifestErr(check, 'a non-object record', m, withFiles({ 'a.md': 5 }), 'MANIFEST_INVALID', ['files["a.md"] must be an object']);
        await expectManifestErr(check, 'an invalid ownership', m, withFiles({ 'a.md': { ownership: 'weird' } }), 'MANIFEST_INVALID', ['files["a.md"].ownership is invalid: weird']);
        await expectManifestErr(check, 'a bad full hash', m, withFiles({ 'a.md': { ownership: 'full', sha256: 'abc' } }), 'MANIFEST_INVALID', ['files["a.md"].sha256 must be a sha256 hex']);
        await expectManifestErr(check, 'an uppercase hash is not lowercase hex', m, withFiles({ 'a.md': { ownership: 'full', sha256: H('A') } }), 'MANIFEST_INVALID', ['files["a.md"].sha256 must be a sha256 hex']);
        await expectManifestErr(check, 'a missing full hash', m, withFiles({ 'a.md': { ownership: 'full' } }), 'MANIFEST_INVALID', ['files["a.md"].sha256 must be a sha256 hex']);
        await expectManifestErr(check, 'bad block hashes', m, withFiles({ 'a.md': { ownership: 'blocks', blocks: { x: H('g') } } }), 'MANIFEST_INVALID', ['files["a.md"].blocks must map ids to sha256 hex']);
        await expectManifestErr(check, 'blocks that is not an object', m, withFiles({ 'a.md': { ownership: 'blocks', blocks: [] } }), 'MANIFEST_INVALID', ['files["a.md"].blocks must map ids to sha256 hex']);
        const badManaged = { 'permissions.deny': [5] };
        const me = await attempt(() => m.readManagedMetadata(T_SETTINGS, badManaged));
        check(me.threw, 'the shared managed validator rejects the probe value');
        if (me.threw) await expectManifestErr(check, 'keys metadata uses the shared validator message', m, withFiles({ [T_SETTINGS]: { ownership: 'keys', managed: badManaged } }), 'MANIFEST_INVALID', [`files["${T_SETTINGS}"].managed: ${me.error.message}`]);
        const badOm = { 'permissions.allow': [5] };
        const oe = await attempt(() => m.readOmissions(T_SETTINGS, badOm));
        check(oe.threw, 'the shared omission validator rejects the probe value');
        if (oe.threw) await expectManifestErr(check, 'omissions use the shared validator message', m, withFiles({ [T_SETTINGS]: { ownership: 'keys', managed: {}, omissions: badOm } }), 'MANIFEST_INVALID', [`files["${T_SETTINGS}"].omissions: ${oe.error.message}`]);
        const t = await manifestError(m, withFiles({ 'TODO.md': { ownership: 'keys', managed: {} } }));
        check(t && t.code === 'MANIFEST_INVALID' && t.issues.length >= 1 && t.issues.every((i) => i.startsWith('files["TODO.md"]')), 'keys ownership is supported only for the two declared files', t && t.issues);
        const o = await manifestError(m, withFiles({ 'a.md': { ownership: 'merged', omissions: {} } }));
        check(o && o.code === 'MANIFEST_INVALID' && o.issues.length >= 1 && o.issues.every((i) => i.startsWith('files["a.md"]')), 'omissions are supported only on keys records', o && o.issues);
        await expectManifestErr(check, 'an absolute file key', m, withFiles({ '/abs.md': { ownership: 'merged' } }), 'MANIFEST_INVALID', [`files["/abs.md"]: ${C1_PATH_ABSOLUTE}`]);
        await expectManifestErr(check, 'a non-canonical file key', m, withFiles({ 'a//b.md': { ownership: 'merged' } }), 'MANIFEST_INVALID', [`files["a//b.md"]: ${C1_PATH_CANONICAL}`]);
        await expectManifestErr(check, 'a backslash file key', m, withFiles({ 'a\\b.md': { ownership: 'merged' } }), 'MANIFEST_INVALID', [`files["a\\b.md"]: ${C1_PATH_CANONICAL}`]);
        await expectManifestErr(check, 'a traversal file key', m, withFiles({ '../x.md': { ownership: 'merged' } }), 'MANIFEST_INVALID', [`files["../x.md"]: ${C1_PATH_CANONICAL}`]);
        await expectManifestErr(check, 'the manifest cannot record itself', m, withFiles({ [T_MANIFEST]: { ownership: 'merged' } }), 'MANIFEST_INVALID', [`files["${T_MANIFEST}"] must not record the manifest itself`]);
        await expectManifestErr(check, 'a short snippet hash', m, { ...V3_OBJ(), codexSnippetSha256: 'abcd' }, 'MANIFEST_INVALID', [ISSUE.snippet]);
        await expectManifestErr(check, 'an uppercase snippet hash', m, { ...V3_OBJ(), codexSnippetSha256: H('A') }, 'MANIFEST_INVALID', [ISSUE.snippet]);
        await expectManifestErr(check, 'a null snippet hash (never synthesized)', m, { ...V3_OBJ(), codexSnippetSha256: null }, 'MANIFEST_INVALID', [ISSUE.snippet]);
      });
      await step('7.5 valid records of every kind are accepted; JSON extension fields survive on the manifest and on each record', async () => {
        const policyManaged = { schema: 1, patterns: [{ anchor: 'any', glob: '**/.env', kind: 'env' }] };
        const input = {
          ...V3_OBJ(), 'x-top': { list: [1, { two: 2 }] }, codexSnippetSha256: H('b'),
          files: {
            'a.md': { ownership: 'full', sha256: H('c'), 'x-note': 'keep' },
            'b.md': { ownership: 'blocks', blocks: { overview: H('d') }, extra: [1] },
            'c.md': { ownership: 'merged', note: 'secret-pattern path; content never hashed into reports' },
            [T_SETTINGS]: { ownership: 'keys', managed: { 'permissions.deny': ['Read(**/.env)'], heldBack: [] }, omissions: { 'permissions.allow': ['Bash(npm test)'] }, 'x-ext': 1 },
            [T_POLICY]: { ownership: 'keys', managed: policyManaged, omissions: { patterns: [{ anchor: 'any', glob: '**/.npmrc' }] } },
          },
        };
        const r = await expectAccepted(check, 'all record kinds with extensions', (v) => m.readManifest(v), input, { sourceSchema: 3, needsUpdate: false, manifest: input });
        void r;
        const v2 = { ...input, schema: 2 };
        const r2 = await attempt(() => m.readManifest(deepFreeze(clone(v2))));
        check(!r2.threw && r2.value.sourceSchema === 2 && r2.value.needsUpdate === true && eq(r2.value.manifest, v2), 'the same data as schema 2 keeps every extension and reports needs-update', r2.threw ? errMsg(r2.error) : null);
      });
    }
    if (schemas && needFns(failures, schemas, ['checkManifest', 'checkClaudeSettings', 'checkSecurityPolicy']) && m && needFns(failures, m, ['readManifest'])) {
      await step('2.1 schemas.checkManifest: [] for a valid v2 or v3 manifest, the reader issues for a recognized error', async () => {
        for (const v of [V3_OBJ(), { ...V3_OBJ(), schema: 2 }]) {
          const r = await attempt(() => schemas.checkManifest(clone(v)));
          check(!r.threw && eq(r.value, []), `checkManifest of a valid schema ${v.schema} manifest is []`, r.threw ? errMsg(r.error) : r.value);
        }
        for (const [v, issues] of [[null, [ISSUE.root]], [{ ...V3_OBJ(), schema: 4 }, [ISSUE.schema]], [{ ...V3_OBJ(), skill: 'x' }, [ISSUE.skill]], [[], [ISSUE.root]]]) {
          const r = await attempt(() => schemas.checkManifest(clone(v)));
          check(!r.threw && eq(r.value, issues), `checkManifest of ${show(v && v.schema !== undefined ? { schema: v.schema, skill: v.skill } : v)} returns the issues`, r.threw ? errMsg(r.error) : r.value);
        }
        check(eq(sorted(Object.keys(schemas)), SCHEMAS_EXPORTS), 'schemas.mjs keeps exactly its three exports', Object.keys(schemas));
      });
    }

    // ------------------------------------------------------------- fixtures ----
    const v2base = await useBase(failures, 'genuine v2', getV2Base, context);
    const v3base = await useBase(failures, 'schema 3', getV3Base, context);
    const plain = await useBase(failures, 'plain', getPlainBase, context);
    if (v2base && m) {
      await step('7.5 a genuine tagged v2 manifest is accepted without modification', async () => {
        const raw = readBytes(manifestPath(v2base.root));
        const parsed = JSON.parse(raw.toString('utf8'));
        const r = await attempt(() => m.readManifest(parsed));
        check(!r.threw && r.value.sourceSchema === 2 && r.value.needsUpdate === true && eq(r.value.manifest, parsed), 'the tagged v2 manifest reads as schema 2, needs update, and equal', r.threw ? errMsg(r.error) : null);
        if (schemas) check(eq(schemas.checkManifest(parsed), []), 'schemas.checkManifest accepts it');
        check(Buffer.compare(raw, readBytes(manifestPath(v2base.root))) === 0, 'reading never changes the manifest bytes');
        const settings = parsed.files[T_SETTINGS];
        const sm = await attempt(() => m.readManagedMetadata(T_SETTINGS, settings.managed));
        check(!sm.threw && eq(sm.value, settings.managed), 'the recorded v2 settings metadata (including heldBack) passes the shared validator', sm.threw ? errMsg(sm.error) : null);
      });
    }
    // -------------------------------------------------------------- detect ----
    if (v2base) {
      await step('3.7 detect: valid schema 2 is "needs update", evidence exact, mode update, exit 0', async () => {
        await withScratch(context, 'dt2', async (dir) => {
          const root = cloneBase(dir, v2base, 'p');
          const before = projectSnapshot(root);
          const r = detectAt(kit, root);
          checkDetect(check, 'schema 2', r, { mode: 'update', evidenceOnly: ['.ai/manifest.json schema 2'], warn: false, manifest: { schema: 2, skillVersion: '2.0.0', mode: 'fresh', status: 'needs update', needsUpdate: true, errors: [] } });
          check(projectSnapshot(root) === before, 'detect writes nothing (the manifest and the whole tree are unchanged)');
        });
      });
    }
    if (v3base) {
      await step('3.7 detect: valid schema 3 is "current"', async () => {
        await withScratch(context, 'dt3', async (dir) => {
          const root = cloneBase(dir, v3base, 'p');
          const man = readManifestFile(root);
          const r = detectAt(kit, root);
          checkDetect(check, 'schema 3', r, { mode: 'update', evidenceOnly: ['.ai/manifest.json schema 3'], warn: false, manifest: { schema: 3, skillVersion: man.skillVersion, mode: man.mode, status: 'current', needsUpdate: false, errors: [] } });
        });
      });
      await step('3.7 detect: an invalid manifest is mode "invalid" with the shared reader issues and never falls through', async () => {
        await withScratch(context, 'dti', async (dir) => {
          const man = readManifestFile(v3base.root);
          const cases = [
            ['a bad skillVersion', jsonText({ ...man, skillVersion: 5 }), { schema: 3, skillVersion: null, mode: man.mode, status: 'invalid', needsUpdate: false, errors: [ISSUE.skillVersion] }],
            ['an unknown schema number', jsonText({ ...man, schema: 4 }), { schema: 4, skillVersion: man.skillVersion, mode: man.mode, status: 'invalid', needsUpdate: false, errors: [ISSUE.schema] }],
            ['a string schema and an object mode (summary values keep their declared type, otherwise null)', jsonText({ ...man, schema: '3', mode: { x: 1 } }), { schema: null, skillVersion: man.skillVersion, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.schema] }],
            ['a JSON parse error', '{"leak-marker-f3a": ', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: ['manifest is not valid JSON'] }],
            ['a null root', 'null\n', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.root] }],
            ['an array root', '[]\n', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.root] }],
            ['a string root', '"text"\n', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.root] }],
            ['a number root', '5\n', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.root] }],
            ['a boolean root', 'true\n', { schema: null, skillVersion: null, mode: null, status: 'invalid', needsUpdate: false, errors: [ISSUE.root] }],
          ];
          const root = cloneBase(dir, v3base, 'p');
          // A v1-provenance CLAUDE.md beside AGENTS.md: without the invalid-manifest gate this repository would classify as migrate-v1.
          const claude = readText(projPath(root, 'CLAUDE.md'));
          putFile(projPath(root, 'CLAUDE.md'), `<!-- Generated by project-setup -->\n${claude}`);
          for (const [label, bytes, summary] of cases) {
            putFile(manifestPath(root), bytes);
            const before = readBytes(manifestPath(root));
            const r = detectAt(kit, root);
            checkDetect(check, `invalid manifest: ${label}`, r, { mode: 'invalid', evidenceHas: '.ai/manifest.json is invalid', warn: true, manifest: summary });
            const ev = (r.json && r.json.evidence) || [];
            check(!ev.some((e) => /v1 provenance|no AI configuration|no tracked source files|both CLAUDE\.md and AGENTS\.md|existing Claude configuration|AGENTS\.md exists/.test(e)), `invalid manifest: ${label}: no fresh/adopt/migrate-v1 evidence`, ev);
            check(!r.stdout.includes('leak-marker-f3a'), `invalid manifest: ${label}: no manifest source text is printed`);
            check(Buffer.compare(before, readBytes(manifestPath(root))) === 0, `invalid manifest: ${label}: detect does not write the manifest`);
          }
        });
      });
    }
    if (plain) {
      await step('3.7 detect: an absent manifest keeps the existing discovery and ai.manifest is null', async () => {
        await withScratch(context, 'dtn', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const r = detectAt(kit, root);
          checkDetect(check, 'absent manifest', r, { mode: 'fresh', manifest: null, warn: false });
        });
      });
    }
    // ------------------------------------------------------------ validate ----
    if (v2base && v3base) {
      await step('3.7 validate: schema 2 gets the exact pass and info records, exit 0; schema 3 gets the pass only', async () => {
        await withScratch(context, 'va', async (dir) => {
          const r2root = cloneBase(dir, v2base, 'a');
          const before = projectSnapshot(r2root);
          const r2 = validateAt(kit, r2root);
          check(r2.code === 0 && r2.json && r2.json.ok === true, 'schema 2: an otherwise valid fixture exits 0', { code: r2.code, fails: r2.json && r2.json.results && r2.json.results.filter((x) => x.level === 'fail') });
          const pass = { level: 'pass', check: 'json-schema', detail: '.ai/manifest.json' };
          const info = { level: 'info', check: 'manifest-version', detail: '.ai/manifest.json: schema 2 needs update to schema 3' };
          check(hasRes(r2.json, pass) && hasRes(r2.json, info), 'schema 2: the json-schema pass and the manifest-version info are present', r2.json && r2.json.results.filter((x) => x.detail && String(x.detail).startsWith('.ai/manifest.json')));
          if (r2.json && Array.isArray(r2.json.results)) {
            const i = r2.json.results.findIndex((x) => eq(x, pass));
            check(i >= 0 && eq(r2.json.results[i + 1], info), 'schema 2: the info record directly follows the pass record', r2.json.results.slice(Math.max(0, i), i + 2));
            check(sameSummary(r2.json), 'schema 2: info records do not count in pass/warn/fail totals', r2.json.summary);
            check(r2.json.results.filter((x) => x.level === 'info').length === 1, 'schema 2: exactly one info record');
          }
          check(projectSnapshot(r2root) === before, 'validate writes nothing');
          const r3root = cloneBase(dir, v3base, 'b');
          const r3 = validateAt(kit, r3root);
          check(r3.code === 0 && r3.json && r3.json.ok === true, 'schema 3: validate exits 0', { code: r3.code, fails: r3.json && r3.json.results && r3.json.results.filter((x) => x.level === 'fail') });
          check(hasRes(r3.json, pass), 'schema 3: the json-schema pass is present');
          check(!(r3.json && r3.json.results.some((x) => x.check === 'manifest-version')), 'schema 3: no manifest-version record');
          check(sameSummary(r3.json), 'schema 3: totals agree with the records', r3.json && r3.json.summary);
        });
      });
      await step('3.7 validate: invalid manifests get the actual json-schema failures, no update info, exit 1, no source text', async () => {
        await withScratch(context, 'vi', async (dir) => {
          const man = readManifestFile(v3base.root);
          const root = cloneBase(dir, v3base, 'p');
          const cases = [
            ['schema 3 with a bad skill', { ...man, skill: 'other' }, [ISSUE.skill]],
            ['legacy schema 2 data with a bad skillVersion never gets the update info', { ...man, schema: 2, skillVersion: 9 }, [ISSUE.skillVersion]],
            ['an unknown schema', { ...man, schema: 4 }, [ISSUE.schema]],
          ];
          for (const [label, value, issues] of cases) {
            putFile(manifestPath(root), jsonText(value));
            const r = validateAt(kit, root);
            check(r.code === 1 && r.json && r.json.ok === false, `${label}: exit 1`, { code: r.code, out: r.stdout.slice(0, 200) });
            for (const i of issues) check(hasRes(r.json, { level: 'fail', check: 'json-schema', detail: `.ai/manifest.json: ${i}` }), `${label}: the failure ".ai/manifest.json: ${i}"`, r.json && r.json.results.filter((x) => x.check === 'json-schema'));
            check(!(r.json && r.json.results.some((x) => x.check === 'manifest-version')), `${label}: no manifest-version info`);
            check(!hasRes(r.json, { level: 'pass', check: 'json-schema', detail: '.ai/manifest.json' }), `${label}: no json-schema pass for the manifest`);
          }
          putFile(manifestPath(root), '{"leak-marker-9c1": ');
          const bad = validateAt(kit, root);
          check(bad.code === 1 && bad.json && bad.json.ok === false, 'a manifest that is not JSON: exit 1', { code: bad.code, out: bad.stdout.slice(0, 200) });
          check(hasRes(bad.json, { level: 'fail', check: 'json-syntax', detail: '.ai/manifest.json: manifest is not valid JSON' }), 'a manifest that is not JSON: the exact json-syntax failure (C2-P3-9)', bad.json && bad.json.results.filter((x) => x.check === 'json-syntax'));
          check(!bad.stdout.includes('leak-marker-9c1') && !/in JSON at position|Unexpected|Expected/.test(bad.stdout), 'a manifest that is not JSON: no source text and no native parser message', bad.stdout.slice(0, 300));
          check(!(bad.json && bad.json.results.some((x) => x.check === 'manifest-version')), 'a manifest that is not JSON: no manifest-version info');
        });
      });
      await step('3.7 validate: manifest-derived paths are not traversed when manifest validation failed; the settings JSON parse record keeps its v2 text', async () => {
        await withScratch(context, 'vt', async (dir) => {
          const man = readManifestFile(v3base.root);
          const root = cloneBase(dir, v3base, 'p');
          // Not a .md file: validate legitimately reads every .md file for its marker check, which would be a false hit.
          const probe = projPath(root, 'docs/zz-probe.txt');
          putFile(probe, 'password: abcdefgh12345678\n');
          putFile(manifestPath(root), jsonText({ ...man, skillVersion: 5, files: { ...man.files, 'docs/zz-probe.txt': { ownership: 'merged' }, 'docs/zz-absent.txt': { ownership: 'merged' } } }));
          const guard = makeGuard(dir, [probe], 'record');
          const r = validateAt(kit, root, { preload: guard.file });
          check(r.code === 1 && r.json && r.json.ok === false, 'the invalid manifest still fails validation', { code: r.code, out: r.stdout.slice(0, 200) });
          check(guard.hits().length === 0, 'a file named only by the invalid manifest is never read', guard.hits().slice(0, 2));
          check(!(r.json && r.json.results.some((x) => x.check === 'drift' || (x.check === 'secret-shaped-content' && /zz-probe/.test(x.detail)))), 'no drift or content finding comes from manifest-derived paths', r.json && r.json.results.filter((x) => x.check === 'drift' || x.check === 'secret-shaped-content'));
          const root2 = cloneBase(dir, v3base, 'q');
          putFile(projPath(root2, T_SETTINGS), '{ not json');
          const s = validateAt(kit, root2);
          const rec = s.json && s.json.results.find((x) => x.check === 'json-syntax' && String(x.detail).startsWith(`${T_SETTINGS}: `));
          check(!!rec && rec.level === 'fail', 'a settings.json parse failure is still reported as a json-syntax failure', s.json && s.json.results.filter((x) => x.check === 'json-syntax'));
        });
      });
    }
    // --------------------------------- written manifests (plan 3.5, 3.6, 4.4) ----
    if (plain) {
      await step('3.5 a newly written manifest is schema 3: serialization, key order, record kinds, no integrity, no synthesized snippet', async () => {
        await withScratch(context, 'wm', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-wm01';
          if (!kit.begin(root, id)) return;
          putDraft(root, id, 'docs/b.md', '# b\n');
          putDraft(root, id, 'docs/a.md', '# a\n');
          putDraft(root, id, 'TODO.md', '# TODO\n');
          putDraft(root, id, '.ai/agents/reviewer.md', '# reviewer\n');
          putDraft(root, id, 'AGENTS.md', '<!-- project-setup:begin id=one -->\nA\n<!-- project-setup:end id=one -->\n');
          putFile(vaultPath(root, id, '.env.example'), 'PORT=3000\n');
          const p = kit.prepare(root, id, { mode: 'fresh' });
          check(p.code === 0 && p.json && p.json.ok === true, 'prepare succeeds', p.stdout.slice(0, 300));
          check(p.json && p.json.metadataChanged === 0 && eq(p.json.metadataOps, []), 'fresh manifest creation caused only by content writes has no metadata operation', p.json && { n: p.json.metadataChanged, ops: p.json.metadataOps });
          const c = kit.commit(root, id, p.json && p.json.planSha256);
          check(c.code === 0 && c.json && c.json.committed === true, 'commit succeeds', c.stdout.slice(0, 300));
          const raw = readText(manifestPath(root));
          const man = raw === null ? null : JSON.parse(raw);
          check(raw !== null && raw === JSON.stringify(man, null, 2) + '\n', 'serialization is JSON.stringify(value, null, 2) plus one LF');
          if (!man) return;
          check(eq(Object.keys(man), ['schema', 'skill', 'skillVersion', 'mode', 'agents', 'sourceCommit', 'files']), 'the manifest holds exactly schema, skill, skillVersion, mode, agents, sourceCommit, files (no integrity, no snippet hash)', Object.keys(man));
          check(man.schema === 3 && man.skill === 'project-setup' && man.skillVersion === skillVersionOf(context) && man.mode === 'fresh' && eq(man.agents, ['claude', 'codex']), 'schema 3 with the plan header values', headerOf(man));
          check(man.sourceCommit === headShort(context, root), 'sourceCommit is the short HEAD', man.sourceCommit);
          check(eq(Object.keys(man.files), ['.ai/agents/reviewer.md', '.env.example', 'AGENTS.md', 'TODO.md', 'docs/a.md', 'docs/b.md']), 'file keys are in JavaScript string order (TODO.md before docs/a.md), not localeCompare order', Object.keys(man.files));
          check(eq(man.files['.env.example'], { ownership: 'merged', note: SECRET_TEMPLATE_NOTE }), 'a secret-template record keeps merged ownership and the explanatory note', man.files['.env.example']);
          check(man.files['TODO.md'].ownership === 'merged' && man.files['docs/a.md'].ownership === 'merged', 'living documents are merged');
          check(man.files['AGENTS.md'].ownership === 'blocks' && man.files['AGENTS.md'].blocks && Object.keys(man.files['AGENTS.md'].blocks).join() === 'one' && HEX64.test(man.files['AGENTS.md'].blocks.one), 'a marked file records its block hash');
          check(man.files['.ai/agents/reviewer.md'].ownership === 'full' && man.files['.ai/agents/reviewer.md'].sha256 === sha(normText('# reviewer\n')), 'a created agent file is full-owned with the normalized hash');
          check(!hasOwn(man, 'integrity') && !hasOwn(man, 'codexSnippetSha256'), 'no integrity field and no codexSnippetSha256');
        });
      });
    }
    // The manifest header and records through a real schema-2 conversion (M1): preservation and ordering.
    const v2for = v2base;
    if (v2for) {
      await step('3.5/3.6/7.5 a schema-only conversion preserves records, old block hashes, full ownership and extensions, and reorders the file map', async () => {
        await withScratch(context, 'cv', async (dir) => {
          const root = cloneBase(dir, v2for, 'p');
          // A user edit inside a managed block (the recorded hash must stay the old one), and extension fields on a manifest and on a record.
          const agents = readText(projPath(root, 'AGENTS.md')).replace('<!-- project-setup:end id=overview -->', 'USER EDIT INSIDE THE BLOCK\n<!-- project-setup:end id=overview -->');
          putFile(projPath(root, 'AGENTS.md'), agents);
          const old = readManifestFile(root);
          const ext = { ...old, 'x-top': { keep: [2, 1] }, files: { ...old.files, 'TODO.md': { ...old.files['TODO.md'], 'x-note': 'keep' } } };
          putFile(manifestPath(root), jsonText(ext));
          commitAll(context, root, 'edited fixture');
          const id = 'run-c2-cv01';
          if (!kit.begin(root, id)) return;
          const p = kit.prepare(root, id);
          check(p.code === 0 && p.json && p.json.ok === true && p.json.changed === 0, 'prepare: a pure conversion has no content change', p.stdout.slice(0, 300));
          const c = kit.commit(root, id, p.json && p.json.planSha256);
          check(c.code === 0 && c.json && c.json.committed === true, 'commit succeeds', c.stdout.slice(0, 300));
          const man = readManifestFile(root);
          if (!man) { check(false, 'the converted manifest is readable'); return; }
          check(man.schema === 3, 'the manifest is now schema 3', man.schema);
          check(eq(man['x-top'], { keep: [2, 1] }), 'an unrelated manifest field survives', man['x-top']);
          check(eq(man.files, ext.files), 'every file record (blocks, hashes, extensions, keys metadata) is preserved by value', Object.keys(man.files).filter((k) => !eq(man.files[k], ext.files[k])));
          check(man.files['AGENTS.md'].blocks.overview === old.files['AGENTS.md'].blocks.overview, 'an edited block keeps its old recorded hash (no rebaseline)', man.files['AGENTS.md'].blocks);
          check(eq(man.files[T_POLICY], old.files[T_POLICY]) && man.files[T_POLICY].ownership === 'full', 'a full-owned policy stays full without an explicit request', man.files[T_POLICY]);
          const keys = Object.keys(man.files);
          check(eq(keys, [...keys].sort()), 'file keys are in JavaScript string order', keys);
          check(keys.indexOf('TODO.md') < keys.indexOf('docs/api-conventions.md'), 'TODO.md now precedes docs/api-conventions.md (the intentional change from localeCompare order)');
          check(readText(manifestPath(root)) === JSON.stringify(man, null, 2) + '\n', 'the file is serialized as JSON.stringify(value, null, 2) plus one LF');
        });
      });
    }
    if (v3base) {
      await step('Q6/7.5 the tagged v2 validate rejects a schema 3 manifest (the compatibility signal; not every old writer is guarded)', async () => {
        const taggedValidate = path.join(v3base.tagged, 'scripts', 'validate.mjs');
        if (!exists(taggedValidate)) { check(false, 'the tagged v2 validate.mjs is available under the fixture work directory', taggedValidate); return; }
        await withScratch(context, 'tv', async (dir) => {
          const root = cloneBase(dir, v3base, 'p');
          const r = execNode(context, { cwd: root, script: taggedValidate, args: [] });
          check(!r.dead, 'the tagged validate ran', r.dead);
          check(r.code === 1 && r.json && r.json.ok === false, 'the tagged v2 validate exits 1 on schema 3', { code: r.code, out: r.stdout.slice(0, 200) });
          check(hasRes(r.json, { level: 'fail', check: 'json-schema', detail: '.ai/manifest.json: schema must be 2' }), 'it reports the v2 schema failure', r.json && r.json.results.filter((x) => x.check === 'json-schema'));
        });
      });
    }
  });
}

// ====================================== shared transaction scenario helpers ====
// Plan 4.4: Hafter is the prior manifest header with the normal plan headers applied (schema 3, current skill version, the run's mode and
// agents, the short HEAD at prepare). A supplied snippet hash is part of it.
function headerAfter(context, root, oldManifest, o = {}) {
  return {
    ...headerOf(oldManifest), schema: 3, skill: 'project-setup', skillVersion: skillVersionOf(context), mode: o.mode || 'update',
    agents: o.agents || ['claude', 'codex'], sourceCommit: headShort(context, root), ...(o.snippet ? { codexSnippetSha256: o.snippet } : {}),
  };
}
const fileOp = (target, before, after, reasons) => ({ kind: 'file', target, before, after, requiresApproval: reasons.length > 0, reasons });
const manifestOp = (before, after) => ({ kind: 'manifest', target: T_MANIFEST, before, after, requiresApproval: false, reasons: [] });
const sortedFiles = (files) => { const out = {}; for (const k of Object.keys(files).sort()) out[k] = files[k]; return out; };
// Files of the project that a run must not touch (everything but git data, the run area, the lock and the manifest itself).
const treeWithout = (root, exclude = ['.ai/.run', '.ai/.setup.lock', '.ai/manifest.json']) => JSON.stringify(walkTree(root, ['.git']).filter(([rel]) => !exclude.some((x) => rel === x || rel.startsWith(`${x}/`))));
const manifestFilesEqualExcept = (a, b, except = []) => eq(Object.fromEntries(Object.entries(a).filter(([k]) => !except.includes(k))), Object.fromEntries(Object.entries(b).filter(([k]) => !except.includes(k))));
// Request files for a run.
function writeRequests(root, id, reqs) { for (const [name, value] of Object.entries(reqs || {})) putRequest(root, id, name, value); }
// A prepared run: lock, init, drafts, vault files, request files, then prepare. spec = { drafts, vault, requests, o }.
function runSpec(kit, root, id, spec = {}) {
  return prepared(kit, root, id, (r, i) => {
    for (const [rel, data] of Object.entries(spec.drafts || {})) putDraft(r, i, rel, data);
    for (const [rel, data] of Object.entries(spec.vault || {})) putFile(vaultPath(r, i, rel), data);
    writeRequests(r, i, spec.requests);
  }, spec.o || {});
}
// Re-prepares the same (still journal-free) run with a fresh set of drafts, vault files and request files. The run directory is emptied
// first, so nothing of an earlier attempt leaks into this one. Only a run that was never committed may be reused (plan 4.6).
function respec(kit, root, id, spec = {}) {
  const rd = runDirOf(root, id);
  for (const sub of [['drafts'], ['vault', 'files']]) { const d = path.join(rd, ...sub); rmrf(d); fs.mkdirSync(d, { recursive: true }); }
  for (const f of [...REQUEST_FILES, 'plan.json']) rmrf(path.join(rd, f));
  for (const [rel, data] of Object.entries(spec.drafts || {})) putDraft(root, id, rel, data);
  for (const [rel, data] of Object.entries(spec.vault || {})) putFile(vaultPath(root, id, rel), data);
  writeRequests(root, id, spec.requests);
  const prep = kit.prepare(root, id, spec.o || {});
  return { ok: prep.code === 0 && prep.json && prep.json.ok === true, root, id, prep, plan: readPlan(root, id), sha: prep.json && prep.json.planSha256 };
}
// What a successful prepare must print and record about metadata (plan 4.3, 5.3).
function expectPrepared(check, label, p, { changed = 0, unchanged = 0, metadataOps }) {
  const j = (p.prep && p.prep.json) || {};
  check(p.ok === true, `${label}: prepare succeeds`, p.prep && p.prep.stdout.slice(0, 500));
  if (!p.ok) return;
  check(j.changed === changed && j.unchanged === unchanged, `${label}: changed ${changed}, unchanged ${unchanged}`, { changed: j.changed, unchanged: j.unchanged });
  check(eq(j.metadataOps, metadataOps), `${label}: the exact metadataOps`, j.metadataOps);
  check(j.metadataChanged === metadataOps.length, `${label}: metadataChanged equals metadataOps.length (${metadataOps.length})`, j.metadataChanged);
  check(p.plan && eq(p.plan.metadataOps, metadataOps), `${label}: the plan embeds the same metadataOps`, p.plan && p.plan.metadataOps);
}
function readEntries(root, id) { const j = readJournal(root, id); return j ? j.entries.map((e) => e.target) : null; }
// Commit and check its response; returns the journal.
function commitOk(kit, check, label, p, writtenTargets) {
  const c = kit.commit(p.root, p.id, p.sha);
  check(c.code === 0 && c.json && c.json.ok === true && c.json.committed === true, `${label}: commit succeeds`, c.stdout.slice(0, 400));
  if (writtenTargets) check(eq(c.json && c.json.written, writtenTargets.map((t) => ({ target: t.target, created: t.created === true }))), `${label}: written lists the real writes only`, c.json && c.json.written);
  const j = readJournal(p.root, p.id);
  check(j && j.committed === true, `${label}: the journal is committed`);
  return j;
}
const settingsRecordOf = (root) => ((readManifestFile(root) || { files: {} }).files || {})[T_SETTINGS];

// ===================================================== R86/C2/metadata-only ====
// Plan 4 and 7.6 rows M1-M5, M7, M15, M18, M19, M21 and the addendum items C2-P3-1, -2, -3, -6: metadata operations without content writes.
async function metadataOnly(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v2 = await useBase(failures, 'genuine v2', getV2Base, context);
    const v2p = await useBase(failures, 'v2 with preserved settings', getV2pBase, context);
    const v3p = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
    const v3o = await useBase(failures, 'schema 3 with omissions', getV3oBase, context);
    const plain = await useBase(failures, 'plain', getPlainBase, context);

    if (v2) {
      await step('M1: a schema-only upgrade writes only the manifest and has exactly one manifest metadata operation', async () => {
        await withScratch(context, 'm1', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const old = readManifestFile(root);
          const oldRaw = readBytes(manifestPath(root));
          const p = runSpec(kit, root, 'run-c2-m1', {});
          const hafter = headerAfter(context, root, old);
          expectPrepared(check, 'M1', p, { metadataOps: [manifestOp(headerOf(old), hafter)] });
          if (!p.ok) return;
          check(p.plan && p.plan.manifestAfter && eq(headerOf(p.plan.manifestAfter), hafter) && eq(p.plan.manifestAfter.files, old.files), 'M1: manifestAfter is the old records under the new header', p.plan && p.plan.manifestAfter && headerOf(p.plan.manifestAfter));
          const before = treeWithout(root);
          const ownerBefore = readJson(lockOwnerPath(root));
          const j = commitOk(kit, check, 'M1', p, [{ target: T_MANIFEST }]);
          check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'M1: the journal entries are only the manifest', j && j.entries.map((e) => e.target));
          check(j && eq(j.metadataOps, p.plan && p.plan.metadataOps), 'M1: the journal carries the same metadataOps', j && j.metadataOps);
          check(treeWithout(root) === before, 'M1: no project file other than the manifest changed (no dummy policy or settings write)');
          const man = readManifestFile(root);
          check(man && eq(headerOf(man), hafter) && eq(man.files, sortedFiles(old.files)) && eq(Object.keys(man.files), Object.keys(old.files).sort()), 'M1: schema 3 header, every record equal, file keys in JavaScript order', man && headerOf(man));
          check(readText(manifestPath(root)) === JSON.stringify(p.plan.manifestAfter, null, 2) + '\n', 'M1: the manifest is exactly the serialization of manifestAfter');
          const backup = readBytes(runFile(root, 'run-c2-m1', 'vault', 'backup', '.ai', 'manifest.json'));
          check(backup !== null && Buffer.compare(backup, oldRaw) === 0, 'M1: the old schema 2 manifest bytes are the journal backup');
          const ownerAfter = readJson(lockOwnerPath(root));
          check(ownerBefore && ownerAfter && Date.parse(ownerAfter.heartbeatAt) >= Date.parse(ownerBefore.heartbeatAt) && ownerAfter.heartbeatAt !== ownerBefore.heartbeatAt, 'M1: a real commit refreshes the lock heartbeat', { before: ownerBefore && ownerBefore.heartbeatAt, after: ownerAfter && ownerAfter.heartbeatAt });
        });
      });
      await step('M2, M3: an unchanged policy goes full to keys only with exact path approval; policy bytes stay; two metadata operations', async () => {
        await withScratch(context, 'm3', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const f = baseFacts(root);
          const old = f.manifest;
          const policyBytes = readBytes(projPath(root, T_POLICY));
          const reqs = { 'ownership.json': { [T_POLICY]: 'keys' }, 'managed-keys.json': { [T_POLICY]: f.policyManaged } };
          const p1 = runSpec(kit, root, 'run-c2-m2', { requests: reqs });
          expectP(check, 'M2 without approval', p1.prep, [{ target: T_POLICY, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_POLICY) }]);
          check(!exists(runFile(root, 'run-c2-m2', 'plan.json')), 'M2: a rejected prepare writes no plan');
          const p = kit.prepare(root, 'run-c2-m2', { approve: [T_POLICY] });
          const plan = readPlan(root, 'run-c2-m2');
          const pafter = { ownership: 'keys', managed: f.policyManaged };
          const hafter = headerAfter(context, root, old);
          const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root, id: 'run-c2-m2', prep: p, plan, sha: p.json && p.json.planSha256 };
          expectPrepared(check, 'M3', ready, { metadataOps: [fileOp(T_POLICY, f.policyRec, pafter, [R_POLICY]), manifestOp(headerOf(old), hafter)] });
          check(p.json && eq(p.json.ownershipOverrides, reqs['ownership.json']), 'M3: ownershipOverrides shows the request for review', p.json && p.json.ownershipOverrides);
          if (!ready.ok) return;
          const j = commitOk(kit, check, 'M3', ready, [{ target: T_MANIFEST }]);
          check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'M3: the journal entries are only the manifest', j && j.entries.map((e) => e.target));
          check(Buffer.compare(readBytes(projPath(root, T_POLICY)), policyBytes) === 0, 'M3: the policy bytes are unchanged');
          const man = readManifestFile(root);
          check(man && eq(man.files[T_POLICY], pafter), 'M3: the policy record is now keys with the complete managed metadata (sha256 removed)', man && man.files[T_POLICY]);
          check(man && manifestFilesEqualExcept(man.files, old.files, [T_POLICY]), 'M3: every other record is unchanged');
        });
      });
      await step('M3 with an omission and a second ownership change: operations sorted by target, one combined record each, the manifest last', async () => {
        await withScratch(context, 'm3b', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const old = f.manifest;
          const polEntry = f.policyManaged.patterns.find((e) => e.glob === '**/.npmrc');
          const reqs = {
            'ownership.json': { [T_SETTINGS]: 'keys', [T_POLICY]: 'keys' },
            'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus }, [T_POLICY]: f.policyManaged },
            'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] }, [T_POLICY]: { patterns: [polEntry] } },
          };
          const none = runSpec(kit, root, 'run-c2-m3b', { requests: reqs });
          expectP(check, 'both targets need approval', none.prep, [
            { target: T_POLICY, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_POLICY) },
            { target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) },
          ]);
          const only = kit.prepare(root, 'run-c2-m3b', { approve: [T_POLICY] });
          expectP(check, 'approving only the policy leaves the settings entry', only, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const p = kit.prepare(root, 'run-c2-m3b', { approve: [T_SETTINGS, T_POLICY] });
          const plan = readPlan(root, 'run-c2-m3b');
          const polAfter = { ownership: 'keys', managed: f.policyManaged, omissions: { patterns: [polEntry] } };
          const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root, id: 'run-c2-m3b', prep: p, plan, sha: p.json && p.json.planSha256 };
          expectPrepared(check, 'M3 combined', ready, { metadataOps: [
            fileOp(T_POLICY, f.policyRec, polAfter, [R_POLICY, R_OMIT]), fileOp(T_SETTINGS, f.settingsRec, m5After(f), [R_SETTINGS, R_OMIT]),
            manifestOp(headerOf(old), headerAfter(context, root, old)),
          ] });
          if (!ready.ok) return;
          const j = commitOk(kit, check, 'M3 combined', ready, [{ target: T_MANIFEST }]);
          check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'only the manifest is written', j && j.entries.map((e) => e.target));
          const man = readManifestFile(root);
          check(man && eq(man.files[T_POLICY], polAfter) && eq(man.files[T_SETTINGS], m5After(f)), 'both records carry their metadata and omissions', man && [man.files[T_POLICY], man.files[T_SETTINGS]]);
        });
      });
    }

    if (v2p) {
      await step('M4, M5: deny metadata removal plus an omission needs settings approval; settings bytes stay; exact operations', async () => {
        await withScratch(context, 'm5', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const old = f.manifest;
          check(readText(projPath(root, T_SETTINGS)) === PRESERVE_BYTES, 'the preservation settings are in place (section 3.3 object, two-space indentation, LF)');
          const bytesBefore = readBytes(projPath(root, T_SETTINGS));
          const removal = { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } };
          const omission = { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } };
          const p4 = runSpec(kit, root, 'run-c2-m4', { requests: { 'managed-keys.json': removal, 'omissions.json': omission } });
          expectP(check, 'M4 without approval', p4.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': removal, 'omissions.json': omission };
          for (const [name, v] of Object.entries(reqs)) putRequest(root, 'run-c2-m4', name, v);
          const p = kit.prepare(root, 'run-c2-m4', { approve: [T_SETTINGS] });
          const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root, id: 'run-c2-m4', prep: p, plan: readPlan(root, 'run-c2-m4'), sha: p.json && p.json.planSha256 };
          expectPrepared(check, 'M5', ready, { metadataOps: [fileOp(T_SETTINGS, f.settingsRec, m5After(f), [R_SETTINGS, R_OMIT]), manifestOp(headerOf(old), headerAfter(context, root, old))] });
          if (!ready.ok) return;
          const j = commitOk(kit, check, 'M5', ready, [{ target: T_MANIFEST }]);
          check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'M5: the journal entries are only the manifest', j && j.entries.map((e) => e.target));
          check(Buffer.compare(readBytes(projPath(root, T_SETTINGS)), bytesBefore) === 0 && readText(projPath(root, T_SETTINGS)) === PRESERVE_BYTES, 'M5: the raw settings bytes (hook options, user order, unrelated fields) are unchanged');
          const man = readManifestFile(root);
          check(man && eq(man.files[T_SETTINGS], m5After(f)), 'M5: the settings record has the shortened managed list and the omission', man && man.files[T_SETTINGS]);
          check(man && manifestFilesEqualExcept(man.files, old.files, [T_SETTINGS]), 'M5: every other record is unchanged');
        });
      });
      await step('M26 and content-only approvals: one combined entry per target, reasons in the plan order, the existing suffix', async () => {
        await withScratch(context, 'm26', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const reversed = clone(PRESERVE_SETTINGS);
          reversed.permissions.deny.reverse();
          const contentReason = 'draft removes or reorders existing permissions.deny entries';
          const reqs = { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } };
          // content only (the existing message, now with a code)
          const c1 = runSpec(kit, root, 'run-c2-m26a', { drafts: { [T_SETTINGS]: jsonText(reversed) } });
          expectP(check, 'content-only approval', c1.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: `${contentReason}. ${approvalSuffix(T_SETTINGS)}` }]);
          // both: one entry, content reasons first, then metadata reasons, joined with "; "
          const b = respec(kit, root, 'run-c2-m26a', { drafts: { [T_SETTINGS]: jsonText(reversed) }, requests: reqs });
          expectP(check, 'M26 content and metadata', b.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: `${[contentReason, R_SETTINGS, R_OMIT].join('; ')}. ${approvalSuffix(T_SETTINGS)}` }]);
          const ok = kit.prepare(root, 'run-c2-m26a', { approve: [T_SETTINGS] });
          check(ok.code === 0 && ok.json && ok.json.ok === true, 'M26: one path approval covers both content and metadata reasons', ok.stdout.slice(0, 300));
          const op = ok.json && ok.json.ops && ok.json.ops[0];
          check(op && op.target === T_SETTINGS && op.userContentChange === true && eq(op.userContentReasons, [contentReason]), 'M26: the content operation records the approved content reason', op);
          check(ok.json && Array.isArray(ok.json.metadataOps) && ok.json.metadataOps.length > 0 && eq(ok.json.metadataOps[0].reasons,[R_SETTINGS, R_OMIT]) && ok.json.metadataOps[0].requiresApproval === true, 'M26: the metadata operation records its own reasons', ok.json && ok.json.metadataOps);
          // metadata first, a different content reason order is never mixed: metadata-only reasons alone, no content change
          const m = respec(kit, root, 'run-c2-m26a', { drafts: { [T_SETTINGS]: PRESERVE_BYTES }, requests: reqs });
          expectP(check, 'an unchanged draft does not suppress the metadata approval', m.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
        });
      });
    }

    if (v3p) {
      await step('M7: an unchanged draft plus changed settings metadata commits one file metadata operation (no manifest operation on schema 3)', async () => {
        await withScratch(context, 'm7', async (dir) => {
          const root = cloneBase(dir, v3p, 'p');
          const f = baseFacts(root);
          const old = f.manifest;
          const reqs = { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } };
          const drafts = { [T_SETTINGS]: PRESERVE_BYTES };
          const none = runSpec(kit, root, 'run-c2-m7a', { drafts, requests: reqs });
          expectP(check, 'M7 without approval', none.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const p = kit.prepare(root, 'run-c2-m7a', { approve: [T_SETTINGS] });
          const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root, id: 'run-c2-m7a', prep: p, plan: readPlan(root, 'run-c2-m7a'), sha: p.json && p.json.planSha256 };
          expectPrepared(check, 'M7', ready, { changed: 0, unchanged: 1, metadataOps: [fileOp(T_SETTINGS, f.settingsRec, m5After(f), [R_SETTINGS, R_OMIT])] });
          if (!ready.ok) return;
          checkOps(check, 'M7 plan', ready.plan.ops, [expectedOp({ target: T_SETTINGS, draft: PRESERVE_BYTES, current: PRESERVE_BYTES })]);
          const j = commitOk(kit, check, 'M7', ready, [{ target: T_MANIFEST }]);
          check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'M7: only the manifest is written', j && j.entries.map((e) => e.target));
          const man = readManifestFile(root);
          check(man && eq(man.files[T_SETTINGS], m5After(f)) && man.schema === 3, 'M7: the settings record carries the new metadata on schema 3', man && man.files[T_SETTINGS]);
          check(man && eq(headerOf(man), headerAfter(context, root, old)), 'M7: the headers are refreshed from the plan although there was no manifest operation', man && headerOf(man));
          check(readText(projPath(root, T_SETTINGS)) === PRESERVE_BYTES, 'M7: the settings bytes are unchanged');
        });
      });
      await step('M19: a heldBack-only change is a file metadata operation without path approval', async () => {
        await withScratch(context, 'm19', async (dir) => {
          const root = cloneBase(dir, v3p, 'p');
          const f = baseFacts(root);
          const held = ['Read(**/.env)'];
          const p = runSpec(kit, root, 'run-c2-m19', { requests: { 'managed-keys.json': { [T_SETTINGS]: { heldBack: held } } } });
          const after = { ...f.settingsRec, managed: { ...f.settingsRec.managed, heldBack: held } };
          expectPrepared(check, 'M19', p, { metadataOps: [fileOp(T_SETTINGS, f.settingsRec, after, [])] });
          if (!p.ok) return;
          commitOk(kit, check, 'M19', p, [{ target: T_MANIFEST }]);
          check(eq(settingsRecordOf(root), after), 'M19: only heldBack changed in the record', settingsRecordOf(root));
        });
      });
      await step('M21: an append-only managed list update needs no path approval but is a reviewed file metadata operation; other changes need it', async () => {
        await withScratch(context, 'm21', async (dir) => {
          const f = baseFacts(v3p.root);
          const denyReq = (deny) => ({ 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': deny } } });
          const rec = (deny) => ({ ...f.settingsRec, managed: { ...f.settingsRec.managed, 'permissions.deny': deny } });
          const root = cloneBase(dir, v3p, 'a');
          const appended = [...f.deny, 'Read(**/.new-secret)', f.deny[0]];
          const p = runSpec(kit, root, 'run-c2-m21a', { requests: denyReq(appended) });
          expectPrepared(check, 'M21 append (a new entry and a duplicate of an old one)', p, { metadataOps: [fileOp(T_SETTINGS, f.settingsRec, rec(appended), [])] });
          if (p.ok) {
            commitOk(kit, check, 'M21', p, [{ target: T_MANIFEST }]);
            check(eq(settingsRecordOf(root), rec(appended)), 'M21: the appended list is recorded in order, duplicates kept', settingsRecordOf(root));
          }
          const needs = [
            ['replacing an element', f.deny.map((x, i) => (i === 0 ? 'Read(**/.ENV)' : x))],
            ['reordering two entries', [f.deny[1], f.deny[0], ...f.deny.slice(2)]],
            ['removing the last entry', f.deny.slice(0, -1)],
            ['removing the first entry and appending one', [...f.deny.slice(1), 'Read(**/.extra)']],
            ['an explicit empty array (a replacement, not an absence)', []],
          ];
          for (const [label, deny] of needs) {
            const r2 = cloneBase(dir, v3p, `n-${label.replace(/\W+/g, '-')}`);
            const id = 'run-c2-m21b';
            const q = runSpec(kit, r2, id, { requests: denyReq(deny) });
            expectP(check, `M21 ${label} needs approval`, q.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
            const ok = kit.prepare(r2, id, { approve: [T_SETTINGS] });
            check(ok.code === 0 && ok.json && ok.json.metadataOps && eq(ok.json.metadataOps, [fileOp(T_SETTINGS, f.settingsRec, rec(deny), [R_SETTINGS])]), `M21 ${label}: with approval, reason "${R_SETTINGS}" only`, ok.json && ok.json.metadataOps);
          }
          // Allow lists follow the same rule, and an append-only change of one list leaves the others alone.
          const r3 = cloneBase(dir, v3p, 'allow');
          const allow2 = [...f.settingsRec.managed['permissions.allow'], 'Bash(extra)'];
          const a = runSpec(kit, r3, 'run-c2-m21c', { requests: { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.allow': allow2 } } } });
          expectPrepared(check, 'M21/M14 an allow append leaves deny and heldBack as they were', a, { metadataOps: [fileOp(T_SETTINGS, f.settingsRec, { ...f.settingsRec, managed: { ...f.settingsRec.managed, 'permissions.allow': allow2 } }, [])] });
        });
      });
      await step('C2-P3-3: a recorded policy managed-schema change is an ownership change and needs approval; an append does not', async () => {
        await withScratch(context, 'p33', async (dir) => {
          const f = baseFacts(v3p.root);
          const recKeys = { ownership: 'keys', managed: f.policyManaged };
          const root = cloneBase(dir, v3p, 'p');
          const m = readManifestFile(root);
          putFile(manifestPath(root), jsonText({ ...m, files: sortedFiles({ ...m.files, [T_POLICY]: recKeys }) }));
          commitAll(context, root, 'policy keys');
          const reqSchema = { 'managed-keys.json': { [T_POLICY]: { schema: 2, patterns: f.policyManaged.patterns } } };
          const a = runSpec(kit, root, 'run-c2-p33a', { requests: reqSchema });
          expectP(check, 'schema 1 to 2 with the same entries', a.prep, [{ target: T_POLICY, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_POLICY) }]);
          const ok = kit.prepare(root, 'run-c2-p33a', { approve: [T_POLICY] });
          check(ok.code === 0 && ok.json && ok.json.metadataOps && eq(ok.json.metadataOps, [fileOp(T_POLICY, recKeys, { ownership: 'keys', managed: { schema: 2, patterns: f.policyManaged.patterns } }, [R_POLICY])]), 'with approval the reason is the policy reason', ok.json && ok.json.metadataOps);
          const extra = { anchor: 'any', glob: '**/.extra-secret' };
          const appended = { schema: 1, patterns: [...f.policyManaged.patterns, extra] };
          const b = respec(kit, root, 'run-c2-p33a', { requests: { 'managed-keys.json': { [T_POLICY]: appended } } });
          expectPrepared(check, 'an appended policy entry (key order of the old entries ignored)', b, { metadataOps: [fileOp(T_POLICY, recKeys, { ownership: 'keys', managed: appended }, [])] });
          const reordered = { schema: 1, patterns: [f.policyManaged.patterns[1], f.policyManaged.patterns[0], ...f.policyManaged.patterns.slice(2)] };
          const c = respec(kit, root, 'run-c2-p33a', { requests: { 'managed-keys.json': { [T_POLICY]: reordered } } });
          expectP(check, 'a reordered policy list', c.prep, [{ target: T_POLICY, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_POLICY) }]);
          // complete records are compared as JSON values, ignoring object key order: the old entries re-spelled with another key order plus one
          // appended entry are still append-only (no approval)
          const keyOrder = { schema: 1, patterns: [...f.policyManaged.patterns.map((e) => ({ note: e.note, kind: e.kind, glob: e.glob, anchor: e.anchor })), extra] };
          const keyOrderData = JSON.parse(JSON.stringify(keyOrder));
          const d = respec(kit, root, 'run-c2-p33a', { requests: { 'managed-keys.json': { [T_POLICY]: keyOrder } } });
          expectPrepared(check, 'old entries in another key order plus an appended entry (append-only ignoring key order)', d, { metadataOps: [fileOp(T_POLICY, recKeys, { ownership: 'keys', managed: keyOrderData }, [])] });
        });
      });
    }

    if (v3o) {
      await step('M14, M15: missing request fields preserve the prior field; an explicit empty omission array needs approval and persists', async () => {
        await withScratch(context, 'm15', async (dir) => {
          const f = baseFacts(v3o.root);
          const rec = f.settingsRec; // the schema 3 omissions fixture record
          check(rec && rec.omissions && eq(rec.omissions['permissions.deny'], [f.npmrcEntry]), 'the fixture carries the deny omission', rec && rec.omissions);
          // M14: an omission request with only permissions.allow keeps permissions.deny; both need the omission approval
          const a = cloneBase(dir, v3o, 'a');
          const q = runSpec(kit, a, 'run-c2-m14a', { requests: { 'omissions.json': { [T_SETTINGS]: { 'permissions.allow': ['Bash(npm test)'] } } } });
          expectP(check, 'M14 an omission change needs approval', q.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const ok = kit.prepare(a, 'run-c2-m14a', { approve: [T_SETTINGS] });
          const after = { ...rec, omissions: { 'permissions.deny': [f.npmrcEntry], 'permissions.allow': ['Bash(npm test)'] } };
          check(ok.code === 0 && ok.json && eq(ok.json.metadataOps, [fileOp(T_SETTINGS, rec, after, [R_OMIT])]), 'M14: the absent omission field survives; only allow is added', ok.json && ok.json.metadataOps);
          // changing managed entries never deletes omissions (append-only, so no approval)
          const b = cloneBase(dir, v3o, 'b');
          const allow2 = [...rec.managed['permissions.allow'], 'Bash(extra)'];
          const w = runSpec(kit, b, 'run-c2-m14b', { requests: { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.allow': allow2 } } } });
          expectPrepared(check, 'M14 a managed change keeps the omissions', w, { metadataOps: [fileOp(T_SETTINGS, rec, { ...rec, managed: { ...rec.managed, 'permissions.allow': allow2 } }, [])] });
          if (w.ok) { commitOk(kit, check, 'M14b', w, [{ target: T_MANIFEST }]); check(eq((settingsRecordOf(b) || {}).omissions, rec.omissions), 'M14: the omissions are still there after the managed change', settingsRecordOf(b)); }
          // M15: an explicit empty array clears the deny omissions, needs approval, and the cleared value persists
          const c = cloneBase(dir, v3o, 'c');
          const clear = { 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [] } } };
          const n = runSpec(kit, c, 'run-c2-m15', { requests: clear });
          expectP(check, 'M15 without approval', n.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const y = kit.prepare(c, 'run-c2-m15', { approve: [T_SETTINGS] });
          const cleared = { ...rec, omissions: { 'permissions.deny': [] } };
          const ready = { ok: y.code === 0 && y.json && y.json.ok === true, root: c, id: 'run-c2-m15', prep: y, plan: readPlan(c, 'run-c2-m15'), sha: y.json && y.json.planSha256 };
          expectPrepared(check, 'M15 with approval', ready, { metadataOps: [fileOp(T_SETTINGS, rec, cleared, [R_OMIT])] });
          if (ready.ok) {
            commitOk(kit, check, 'M15', ready, [{ target: T_MANIFEST }]);
            const got = settingsRecordOf(c);
            check(eq(got, cleared) && hasOwn(got.omissions, 'permissions.deny') && eq(got.omissions['permissions.deny'], []), 'M15: the empty array persists (it is a replacement, not an absence)', got);
          }
        });
      });
    }

    if (plain) {
      await step('C2-P3-2: explicit keys ownership on an unchanged unrecorded target is an approved ownership change (before null)', async () => {
        await withScratch(context, 'p32', async (dir) => {
          const userSettings = `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }, null, 2)}\n`;
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, T_SETTINGS), userSettings);
          commitAll(context, root, 'user settings');
          const id = 'run-c2-p32';
          const managed = { 'permissions.deny': ['Read(**/.env)'] };
          for (const [label, reqs, rec] of [
            ['without a managed request', { 'ownership.json': { [T_SETTINGS]: 'keys' } }, { ownership: 'keys', managed: {} }],
            ['with a managed request', { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: managed } }, { ownership: 'keys', managed }],
          ]) {
            const r = cloneBase(dir, root, `c-${label.replace(/\W+/g, '-')}`);
            const refused = runSpec(kit, r, id, { drafts: { [T_SETTINGS]: userSettings }, requests: reqs });
            expectP(check, `C2-P3-2 ${label}, no approval`, refused.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
            const p = kit.prepare(r, id, { approve: [T_SETTINGS] });
            const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root: r, id, prep: p, plan: readPlan(r, id), sha: p.json && p.json.planSha256 };
            expectPrepared(check, `C2-P3-2 ${label}`, ready, { changed: 0, unchanged: 1, metadataOps: [fileOp(T_SETTINGS, null, rec, [R_SETTINGS])] });
            if (!ready.ok) continue;
            check(ready.plan.manifestAfter && eq(ready.plan.manifestAfter.files[T_SETTINGS], rec), `C2-P3-2 ${label}: manifestAfter carries the complete record`, ready.plan.manifestAfter && ready.plan.manifestAfter.files);
            const j = commitOk(kit, check, `C2-P3-2 ${label}`, ready, [{ target: T_MANIFEST, created: true }]);
            check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]) && j.entries[0].existed === false, `C2-P3-2 ${label}: the manifest is created, nothing else written`, j && j.entries);
            const man = readManifestFile(r);
            check(man && man.schema === 3 && eq(Object.keys(man.files), [T_SETTINGS]) && eq(man.files[T_SETTINGS], rec), `C2-P3-2 ${label}: the only record is the requested one (an unchanged unrecorded target is not adopted otherwise)`, man && man.files);
            check(readText(projPath(r, T_SETTINGS)) === userSettings, `C2-P3-2 ${label}: the settings bytes are unchanged`);
          }
        });
      });
      await step('C2-P3-1: an omission change always needs approval, also on a newly written target with no previous record', async () => {
        await withScratch(context, 'p31', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-p31';
          const content = `${JSON.stringify({ permissions: { deny: ['Read(x)'] } }, null, 2)}\n`;
          const managed = { 'permissions.deny': ['Read(x)'] };
          const omissionsReq = { 'permissions.allow': ['Bash(npm test)'] };
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: managed }, 'omissions.json': { [T_SETTINGS]: omissionsReq } };
          const refused = runSpec(kit, root, id, { drafts: { [T_SETTINGS]: content }, requests: reqs });
          expectP(check, 'C2-P3-1 without approval', refused.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const p = kit.prepare(root, id, { approve: [T_SETTINGS] });
          const rec = { ownership: 'keys', managed, omissions: omissionsReq };
          const ready = { ok: p.code === 0 && p.json && p.json.ok === true, root, id, prep: p, plan: readPlan(root, id), sha: p.json && p.json.planSha256 };
          expectPrepared(check, 'C2-P3-1', ready, { changed: 1, unchanged: 0, metadataOps: [fileOp(T_SETTINGS, null, rec, [R_OMIT])] });
          if (!ready.ok) return;
          check(ready.plan.manifestAfter && eq(ready.plan.manifestAfter.files[T_SETTINGS], rec), 'C2-P3-1: manifestAfter holds the same complete record', ready.plan.manifestAfter && ready.plan.manifestAfter.files);
          const j = commitOk(kit, check, 'C2-P3-1', ready, [{ target: T_SETTINGS, created: true }, { target: T_MANIFEST, created: true }]);
          check(j && eq(j.entries.map((e) => e.target), [T_SETTINGS, T_MANIFEST]), 'C2-P3-1: content first, the manifest last', j && j.entries.map((e) => e.target));
          check(eq(settingsRecordOf(root), rec), 'C2-P3-1: the record is stored with the omission beside the managed list', settingsRecordOf(root));
        });
      });
      await step('4.2/C2-P3-6: snippet hash operations: none without a manifest, one when it differs, none when identical', async () => {
        await withScratch(context, 'sn', async (dir) => {
          // no existing manifest: recorded in manifestAfter only
          const a = cloneBase(dir, plain, 'a');
          const pa = runSpec(kit, a, 'run-c2-sn1', { drafts: { 'docs/a.md': '# a\n' }, requests: { 'manifest-metadata.json': { codexSnippetSha256: H('a') } } });
          expectPrepared(check, 'C2-P3-6 no existing manifest', pa, { changed: 1, metadataOps: [] });
          if (pa.ok) {
            check(pa.plan.manifestAfter && pa.plan.manifestAfter.codexSnippetSha256 === H('a'), 'C2-P3-6: the hash is recorded in manifestAfter', pa.plan.manifestAfter);
            commitOk(kit, check, 'C2-P3-6', pa, null);
            check((readManifestFile(a) || {}).codexSnippetSha256 === H('a'), 'C2-P3-6: the committed manifest holds the hash');
          }
        });
        if (!v3p || !v2p) return;
        await withScratch(context, 'sn2', async (dir) => {
          const root = cloneBase(dir, v3p, 'b');
          const old = readManifestFile(root);
          const p = runSpec(kit, root, 'run-c2-sn2', { requests: { 'manifest-metadata.json': { codexSnippetSha256: H('b') } } });
          const after = headerAfter(context, root, old, { snippet: H('b') });
          expectPrepared(check, 'a snippet hash differing from an existing manifest', p, { metadataOps: [manifestOp(headerOf(old), after)] });
          if (p.ok) {
            const j = commitOk(kit, check, 'snippet', p, [{ target: T_MANIFEST }]);
            check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'snippet: only the manifest is written', j && j.entries.map((e) => e.target));
            const man = readManifestFile(root);
            check(man && man.codexSnippetSha256 === H('b') && eq(man.files, old.files), 'snippet: recorded, records untouched', man && headerOf(man));
            // the same request again is identical: no operation, and a changed value is one manifest operation with the old value in before
            kit.lock(root, ['release', '--run-id', 'run-c2-sn2']);
            const same = runSpec(kit, root, 'run-c2-sn3', { requests: { 'manifest-metadata.json': { codexSnippetSha256: H('b') } } });
            expectPrepared(check, 'the identical snippet hash', same, { metadataOps: [] });
            kit.lock(root, ['release', '--run-id', 'run-c2-sn3']);
            const other = runSpec(kit, root, 'run-c2-sn4', { requests: { 'manifest-metadata.json': { codexSnippetSha256: H('c') } } });
            const mid = readManifestFile(root);
            expectPrepared(check, 'a changed snippet hash', other, { metadataOps: [manifestOp(headerOf(mid), headerAfter(context, root, mid, { snippet: H('c') }))] });
          }
        });
        await withScratch(context, 'sn3', async (dir) => {
          // conversion and snippet together: one combined manifest operation
          const root = cloneBase(dir, v2p, 'c');
          const old = readManifestFile(root);
          const p = runSpec(kit, root, 'run-c2-sn5', { requests: { 'manifest-metadata.json': { codexSnippetSha256: H('d') } } });
          expectPrepared(check, 'schema conversion and a snippet hash together', p, { metadataOps: [manifestOp(headerOf(old), headerAfter(context, root, old, { snippet: H('d') }))] });
        });
        await withScratch(context, 'sn4', async (dir) => {
          // mode, agents, sourceCommit and skillVersion alone never emit a manifest operation, but a content write refreshes them
          const root = cloneBase(dir, v3p, 'd');
          const p = runSpec(kit, root, 'run-c2-sn6', { drafts: { 'docs/api-conventions.md': '# api\n\nchanged\n' }, o: { mode: 'adopt', agents: 'claude' } });
          expectPrepared(check, 'a header-only refresh', p, { changed: 1, metadataOps: [] });
          if (p.ok) {
            commitOk(kit, check, 'header refresh', p, [{ target: 'docs/api-conventions.md' }, { target: T_MANIFEST }]);
            const man = readManifestFile(root);
            check(man && man.mode === 'adopt' && eq(man.agents, ['claude']) && man.skillVersion === skillVersionOf(context) && man.sourceCommit === p.plan.head, 'the headers follow the plan after a content write', man && headerOf(man));
          }
        });
      });
    }
  });
}

// ================================================ R86/C2/mixed-transaction ====
// Plan 4.1 (request combinations), 4.3 (plan shape), 4.4 (M6), 4.6 (one journal, plan order), 5.2/5.3 (prepare output) and 7.6 rows M6, M9,
// M13, M16, M17, M20, M23 with the addendum items C2-P3-4.
const PREPARE_KEYS = ['changed', 'metadataChanged', 'metadataOps', 'ok', 'ops', 'ownershipOverrides', 'plan', 'planSha256', 'review', 'unchanged'];
const PLAN_KEYS = ['agents', 'head', 'host', 'inputs', 'manifestAfter', 'manifestPreRawSha', 'metadata', 'metadataOps', 'mode', 'ops', 'planSchema', 'preparedAt', 'runId', 'skillVersion', 'sourceInventory'];
const PLAN_METADATA_KEYS = ['managedKeys', 'managedKeysSha256', 'manifestMetadata', 'manifestMetadataSha256', 'omissions', 'omissionsSha256', 'ownership', 'ownershipSha256', 'transactionInputs', 'transactionInputsSha256'];
async function mixedTransaction(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v2 = await useBase(failures, 'genuine v2', getV2Base, context);
    const v2p = await useBase(failures, 'v2 with preserved settings', getV2pBase, context);
    const v3p = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
    const plain = await useBase(failures, 'plain', getPlainBase, context);

    if (v2p) {
      await step('M6: changed document plus approved metadata is one journal, one manifest write last, two metadata operations', async () => {
        await withScratch(context, 'm6', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const old = f.manifest;
          const id = 'run-c2-m6';
          const docT = 'docs/api-conventions.md';
          const oldDoc = readBytes(projPath(root, docT));
          const newDoc = '# api-conventions\n\nchanged by the run\n';
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } };
          const p = runSpec(kit, root, id, { drafts: { [docT]: newDoc }, requests: reqs, o: { approve: [T_SETTINGS] } });
          const hafter = headerAfter(context, root, old);
          const mops = [fileOp(T_SETTINGS, f.settingsRec, m5After(f), [R_SETTINGS, R_OMIT]), manifestOp(headerOf(old), hafter)];
          expectPrepared(check, 'M6', p, { changed: 1, unchanged: 0, metadataOps: mops });
          if (!p.ok) return;
          const j = p.prep.json;
          // 5.3: the prepare output
          check(eq(sorted(Object.keys(j)), PREPARE_KEYS), 'prepare prints the retained fields plus metadataChanged and metadataOps, nothing else', Object.keys(j));
          check(j.plan === `.ai/.run/${id}/plan.json` && j.planSha256 === planShaOf(root, id), 'plan is the run-relative path and planSha256 is the SHA-256 of plan.json', { plan: j.plan, sha: j.planSha256 });
          check(j.review === reviewText(id), 'review is the exact single string with the run ID substituted and <SKILL_DIR> kept literal', j.review);
          check(eq(j.ownershipOverrides, reqs['ownership.json']), 'ownershipOverrides is the ownership request', j.ownershipOverrides);
          const wantOp = expectedOp({ target: docT, draft: newDoc, current: oldDoc });
          check(Array.isArray(j.ops) && j.ops.length === 1 && eq(sorted(Object.keys(j.ops[0])), sorted(['target', 'action', 'origin', 'linesBefore', 'linesAfter', 'uncommittedUserChanges', 'userContentChange', 'userContentReasons'])), 'the printed ops keep their eight fields and list changed operations only', j.ops);
          check(j.ops[0].target === docT && j.ops[0].action === 'modify' && j.ops[0].origin === 'draft' && j.ops[0].linesBefore === wantOp.linesBefore && j.ops[0].linesAfter === wantOp.linesAfter && j.ops[0].userContentChange === false && eq(j.ops[0].userContentReasons, []), 'the printed content operation is the document modification', j.ops[0]);
          // 4.3: the plan
          const plan = p.plan;
          check(eq(sorted(Object.keys(plan)), PLAN_KEYS), 'plan.json has exactly the plan 4.3 fields (no policySpecSha256)', Object.keys(plan));
          check(plan.planSchema === 2 && plan.runId === id && plan.mode === 'update' && eq(plan.agents, ['claude', 'codex']) && plan.skillVersion === skillVersionOf(context), 'plan header: planSchema 2, run, mode, agents, skill version', { s: plan.planSchema, r: plan.runId, m: plan.mode, a: plan.agents, v: plan.skillVersion });
          check(typeof plan.host === 'string' && plan.host !== '' && typeof plan.preparedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(plan.preparedAt), 'host and preparedAt are strings', { host: plan.host, at: plan.preparedAt });
          check(plan.head === headShort(context, root) && plan.manifestPreRawSha === sha(readBytes(manifestPath(root))), 'head is the short HEAD and manifestPreRawSha is the manifest raw hash', { head: plan.head, pre: plan.manifestPreRawSha });
          const meta = {
            ownershipSha256: sha(readBytes(runFile(root, id, 'ownership.json'))), ownership: reqs['ownership.json'],
            managedKeysSha256: sha(readBytes(runFile(root, id, 'managed-keys.json'))), managedKeys: reqs['managed-keys.json'],
            omissionsSha256: sha(readBytes(runFile(root, id, 'omissions.json'))), omissions: reqs['omissions.json'],
            manifestMetadataSha256: null, manifestMetadata: null, transactionInputsSha256: null, transactionInputs: null,
          };
          check(eq(sorted(Object.keys(plan.metadata)), PLAN_METADATA_KEYS) && eq(plan.metadata, meta), 'plan.metadata embeds each request with the SHA-256 of its raw bytes (null when absent)', plan.metadata);
          checkOps(check, 'M6 plan', plan.ops, [wantOp]);
          const inputs = [T_POLICY, T_SETTINGS, docT].map((t) => ({ target: t, preRawSha: sha(readBytes(projPath(root, t))) }));
          check(eq(plan.inputs, inputs), 'inputs: every content target, every file metadata target and the installed policy, sorted by target', plan.inputs);
          check(eq(plan.sourceInventory, [{ target: docT, origin: 'draft' }]), 'sourceInventory lists the drafts', plan.sourceInventory);
          const wantManifest = { ...hafter, files: sortedFiles({ ...old.files, [T_SETTINGS]: m5After(f), [docT]: { ownership: 'merged' } }) };
          check(eq(plan.manifestAfter, wantManifest), 'manifestAfter is the exact manifest to write', plan.manifestAfter && headerOf(plan.manifestAfter));
          // commit: one journal, manifest last
          const settingsBefore = readBytes(projPath(root, T_SETTINGS));
          const ownerBefore = readJson(lockOwnerPath(root));
          const jr = commitOk(kit, check, 'M6', p, [{ target: docT }, { target: T_MANIFEST }]);
          check(jr && eq(jr.entries.map((e) => e.target), [docT, T_MANIFEST]) && jr.entries.every((e) => e.state === 'applied'), 'M6: journal entries are the document, then the manifest, both applied', jr && jr.entries);
          check(jr && eq(jr.metadataOps, mops), 'M6: the journal carries the metadata operations', jr && jr.metadataOps);
          const runFiles = fs.readdirSync(runDirOf(root, id));
          check(runFiles.filter((n) => /journal/i.test(n)).join() === 'journal.json', 'M6: there is a single journal (no separate metadata commit)', runFiles);
          check(readText(projPath(root, docT)) === newDoc && Buffer.compare(readBytes(projPath(root, T_SETTINGS)), settingsBefore) === 0, 'M6: the document is written, the settings bytes are not', {});
          const man = readManifestFile(root);
          check(eq(man, wantManifest) && readText(manifestPath(root)) === JSON.stringify(plan.manifestAfter, null, 2) + '\n', 'M6: the committed manifest is exactly manifestAfter, serialized per plan 3.5');
          const docBackup = readBytes(runFile(root, id, 'vault', 'backup', ...docT.split('/')));
          check(docBackup !== null && Buffer.compare(docBackup, oldDoc) === 0, 'M6: the document backup is the old bytes');
          const ownerAfter = readJson(lockOwnerPath(root));
          check(ownerBefore && ownerAfter && ownerAfter.heartbeatAt !== ownerBefore.heartbeatAt, 'M6: the lock heartbeat was refreshed by the real commit');
          // rollback restores in reverse write order
          const rb = kit.rollback(root, id);
          check(rb.code === 0 && rb.json && eq(rb.json.restored, [T_MANIFEST, docT]) && rb.json.complete === true, 'M6: rollback restores the manifest first, then the document', rb.json);
          check(eq(readManifestFile(root), old) && readText(projPath(root, docT)) === oldDoc.toString('utf8'), 'M6: rollback leaves the pre-run manifest and document');
        });
      });
    }
    if (plain) {
      await step('4.6 the commit applies content operations in the order stored in the approved plan, without sorting again', async () => {
        await withScratch(context, 'ord', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-ord1';
          const p = runSpec(kit, root, id, { drafts: { 'docs/z.md': '# z\n', 'docs/a.md': '# a\n', 'docs/m.md': '# m\n' } });
          check(p.ok === true, 'prepare succeeds', p.prep && p.prep.stdout.slice(0, 300));
          if (!p.ok) return;
          check(eq(p.plan.ops.map((o) => o.target), ['docs/a.md', 'docs/m.md', 'docs/z.md']), 'prepare orders content operations by target', p.plan.ops.map((o) => o.target));
          const plan = clone(p.plan);
          plan.ops = [plan.ops[2], plan.ops[0], plan.ops[1]];
          putFile(runFile(root, id, 'plan.json'), jsonText(plan));
          const j = commitOk(kit, check, 'reordered plan', { root, id, sha: planShaOf(root, id) }, null);
          check(j && eq(j.entries.map((e) => e.target), ['docs/z.md', 'docs/a.md', 'docs/m.md', T_MANIFEST]), 'the journal follows the plan order, then the manifest', j && j.entries.map((e) => e.target));
        });
      });
      await step('4.3 content operation records: create, modify with CRLF, unchanged, and vault operations; M23 unchanged unrecorded stays unrecorded', async () => {
        await withScratch(context, 'ops', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, 'docs/crlf.md'), 'a\r\nb\r\n');
          putFile(projPath(root, 'docs/existing.md'), '# existing\n');
          putFile(projPath(root, 'docs/.env.template'), 'KEEP=1\nSECRET_TOKEN=abc12345\n');
          commitAll(context, root, 'existing files');
          const id = 'run-c2-ops1';
          const drafts = { 'docs/new.md': '# new\n', 'docs/crlf.md': 'a\nc\n', 'docs/existing.md': '# existing\n' };
          const vault = { 'docs/.env.sample': 'PORT=\n', 'docs/.env.template': 'KEEP=1\nSECRET_TOKEN=abc12345\n' };
          // docs/crlf.md is a pre-existing file the skill does not own: replacing its content needs the existing content approval.
          const p = runSpec(kit, root, id, { drafts, vault, o: { approve: ['docs/crlf.md'] } });
          check(p.ok === true, 'prepare succeeds', p.prep && p.prep.stdout.slice(0, 400));
          if (!p.ok) return;
          const cur = (t) => readBytes(projPath(root, t));
          const want = [
            expectedOp({ target: 'docs/.env.sample', origin: 'vault', draft: vault['docs/.env.sample'], current: null, secret: true }),
            expectedOp({ target: 'docs/.env.template', origin: 'vault', draft: vault['docs/.env.template'], current: cur('docs/.env.template'), secret: true }),
            expectedOp({ target: 'docs/crlf.md', draft: drafts['docs/crlf.md'], current: cur('docs/crlf.md'), reasons: ['draft changes content outside managed blocks (pre-existing file the skill does not own)'] }),
            expectedOp({ target: 'docs/existing.md', draft: drafts['docs/existing.md'], current: cur('docs/existing.md') }),
            expectedOp({ target: 'docs/new.md', draft: drafts['docs/new.md'], current: null }),
          ];
          checkOps(check, 'content operations', p.plan.ops, want);
          check(p.plan.ops.find((o) => o.target === 'docs/crlf.md').eol === '\r\n', 'a CRLF target keeps its line ending in the record');
          check(p.prep.json.changed === 3 && p.prep.json.unchanged === 2 && p.prep.json.metadataChanged === 0, 'changed counts create and modify, unchanged counts unchanged, no metadata operation', { c: p.prep.json.changed, u: p.prep.json.unchanged, m: p.prep.json.metadataChanged });
          check(eq(p.plan.sourceInventory, [{ target: 'docs/.env.sample', origin: 'vault' }, { target: 'docs/.env.template', origin: 'vault' }, { target: 'docs/crlf.md', origin: 'draft' }, { target: 'docs/existing.md', origin: 'draft' }, { target: 'docs/new.md', origin: 'draft' }]), 'sourceInventory lists every source (including unchanged), sorted by target', p.plan.sourceInventory);
          const j = commitOk(kit, check, 'ops', p, null);
          check(j && eq(j.entries.map((e) => e.target), ['docs/.env.sample', 'docs/crlf.md', 'docs/new.md', T_MANIFEST]), 'only real writes are journaled', j && j.entries.map((e) => e.target));
          const man = readManifestFile(root);
          check(man && eq(Object.keys(man.files), ['docs/.env.sample', 'docs/crlf.md', 'docs/new.md']), 'M23: the unchanged unrecorded targets (docs/existing.md, .env.template) gain no record; the written ones do', man && Object.keys(man.files));
          check(readText(projPath(root, 'docs/crlf.md')) === 'a\r\nc\r\n', 'a CRLF target is rewritten with CRLF');
        });
      });
    }
    if (v3p) {
      await step('M23: an unchanged recorded draft keeps its record while another target is written', async () => {
        await withScratch(context, 'm23', async (dir) => {
          const root = cloneBase(dir, v3p, 'p');
          const old = readManifestFile(root);
          const same = readBytes(projPath(root, 'docs/database.md'));
          const p = runSpec(kit, root, 'run-c2-m23', { drafts: { 'docs/database.md': same, 'docs/new.md': '# new\n' } });
          expectPrepared(check, 'M23', p, { changed: 1, unchanged: 1, metadataOps: [] });
          if (!p.ok) return;
          commitOk(kit, check, 'M23', p, [{ target: 'docs/new.md', created: true }, { target: T_MANIFEST }]);
          const man = readManifestFile(root);
          check(man && eq(man.files['docs/database.md'], old.files['docs/database.md']) && eq(man.files['docs/new.md'], { ownership: 'merged' }), 'the unchanged record is kept and the new document is recorded', man && man.files['docs/new.md']);
        });
      });
    }

    // --------------------------------------------- section 4.1 combination errors ----
    if (v2) {
      await step('4.1/M9: ownership changes on unchanged targets are refused (no metadata-only adoption); out of keys needs a content write', async () => {
        await withScratch(context, 'm9', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const id = 'run-c2-m9';
          const installed = (t) => readBytes(projPath(root, t));
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'an empty first prepare works (the run exists)', first.prep && first.prep.stdout.slice(0, 200));
          const rows = [
            ['M9 blocks to full on an unchanged AGENTS.md', { drafts: { 'AGENTS.md': installed('AGENTS.md') }, requests: { 'ownership.json': { 'AGENTS.md': 'full' } } }, 'AGENTS.md'],
            ['M9 full to merged on an unchanged agent file', { drafts: { '.ai/agents/reviewer.md': installed('.ai/agents/reviewer.md') }, requests: { 'ownership.json': { '.ai/agents/reviewer.md': 'merged' } } }, '.ai/agents/reviewer.md'],
            ['M9 merged to full on an unchanged TODO.md', { drafts: { 'TODO.md': installed('TODO.md') }, requests: { 'ownership.json': { 'TODO.md': 'full' } } }, 'TODO.md'],
            ['M9 an ownership change with no draft at all', { requests: { 'ownership.json': { 'docs/database.md': 'full' } } }, 'docs/database.md'],
            ['C2-P3-4 a transition out of keys with no content write', { drafts: { [T_SETTINGS]: installed(T_SETTINGS) }, requests: { 'ownership.json': { [T_SETTINGS]: 'merged' } } }, T_SETTINGS],
            ['C2-P3-4 a transition out of keys with no draft', { requests: { 'ownership.json': { [T_SETTINGS]: 'full' } } }, T_SETTINGS],
          ];
          for (const [label, spec, target] of rows) {
            const r = respec(kit, root, id, spec);
            expectP(check, label, r.prep, [{ target, code: 'APPLY_METADATA_TARGET', error: MSG.METADATA_TARGET(target) }]);
            check(!exists(runFile(root, id, 'plan.json')), `${label}: a rejected prepare writes no plan`);
          }
        });
      });
      await step('4.1/C2-P3-4: a transition out of keys with a content write is allowed, approved as a whole record change', async () => {
        await withScratch(context, 'm9k', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const f = baseFacts(root);
          const id = 'run-c2-m9k';
          const installed = readText(projPath(root, T_SETTINGS));
          const grown = JSON.parse(installed);
          grown.permissions.deny.push('Read(**/.extra)');
          const spec = { drafts: { [T_SETTINGS]: jsonText(grown) }, requests: { 'ownership.json': { [T_SETTINGS]: 'merged' } } };
          const p1 = runSpec(kit, root, id, spec);
          expectP(check, 'out of keys without approval', p1.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) }]);
          const p = kit.prepare(root, id, { approve: [T_SETTINGS] });
          check(p.code === 0 && p.json && p.json.ok === true, 'out of keys with approval: prepare succeeds', p.stdout.slice(0, 300));
          const op = p.json && p.json.metadataOps && p.json.metadataOps.find((o) => o.kind === 'file');
          check(!!op && op.target === T_SETTINGS && op.requiresApproval === true && eq(op.before, f.settingsRec) && eq(op.after, { ownership: 'merged' }) && eq(op.reasons, [R_SETTINGS]), 'the file operation replaces the keys-specific fields (managed removed) and needs approval', op);
          const c = kit.commit(root, id, p.json && p.json.planSha256);
          check(c.code === 0 && c.json && c.json.committed === true, 'commit succeeds', c.stdout.slice(0, 300));
          check(eq((readManifestFile(root) || { files: {} }).files[T_SETTINGS], { ownership: 'merged' }), 'the committed record is merged, without managed metadata', (readManifestFile(root) || { files: {} }).files[T_SETTINGS]);
        });
      });
      await step('4.1/M13: unknown metadata targets; an input-list entry does not make a target known', async () => {
        await withScratch(context, 'm13', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const id = 'run-c2-m13';
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'the run exists');
          const unknown = 'docs/unknown.md';
          const cases = [
            ['ownership for an unknown target', { 'ownership.json': { [unknown]: 'full' } }],
            ['a managed request for an unknown target', { 'managed-keys.json': { [unknown]: {} } }],
            ['an omission request for an unknown target', { 'omissions.json': { [unknown]: {} } }],
            ['R15: ownership for a path that is neither drafted nor recorded', { 'ownership.json': { 'src/app.ts': 'full' } }],
            ['all three requests for one unknown target give one entry', { 'ownership.json': { [unknown]: 'full' }, 'managed-keys.json': { [unknown]: {} }, 'omissions.json': { [unknown]: {} } }],
            ['a declared input does not make an unknown target known', { 'transaction-inputs.json': [unknown], 'ownership.json': { [unknown]: 'full' } }],
          ];
          for (const [label, requests] of cases) {
            const r = respec(kit, root, id, { requests });
            const target = label.startsWith('R15') ? 'src/app.ts' : unknown;
            expectP(check, `M13 ${label}`, r.prep, [{ target, code: 'APPLY_METADATA_UNKNOWN', error: MSG.METADATA_UNKNOWN(target) }]);
          }
        });
      });
      await step('4.1/M16, M17, M20: full ownership with managed or omission requests; policy keys without complete metadata; incomplete requests', async () => {
        await withScratch(context, 'm16', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const f = baseFacts(root);
          const id = 'run-c2-m16';
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'the run exists');
          const own = (target) => ({ target, code: 'APPLY_METADATA_OWNERSHIP', error: MSG.METADATA_OWNERSHIP(target) });
          for (const [label, requests] of [
            ['M16 a managed request while the resulting ownership is full', { 'managed-keys.json': { [T_POLICY]: f.policyManaged } }],
            ['M16 the same with explicit full ownership', { 'ownership.json': { [T_POLICY]: 'full' }, 'managed-keys.json': { [T_POLICY]: f.policyManaged } }],
            ['M16 an omission request while the resulting ownership is full', { 'omissions.json': { [T_POLICY]: { patterns: [] } } }],
          ]) expectP(check, label, respec(kit, root, id, { requests }).prep, [own(T_POLICY)]);
          const req = { target: T_POLICY, code: 'APPLY_METADATA_REQUIRED', error: MSG.METADATA_REQUIRED(T_POLICY) };
          expectP(check, 'M17 policy keys without managed metadata', respec(kit, root, id, { requests: { 'ownership.json': { [T_POLICY]: 'keys' } } }).prep, [req]);
          expectP(check, 'M17 policy keys with only an omission request', respec(kit, root, id, { requests: { 'ownership.json': { [T_POLICY]: 'keys' }, 'omissions.json': { [T_POLICY]: { patterns: [] } } } }).prep, [req]);
          // M20: incomplete policy managed requests fail shared validation and are never merged into validity.
          for (const [label, managed] of [['schema without patterns', { schema: 1 }], ['patterns without schema', { patterns: f.policyManaged.patterns }], ['an empty object', {}]]) {
            const r = respec(kit, root, id, { requests: { 'ownership.json': { [T_POLICY]: 'keys' }, 'managed-keys.json': { [T_POLICY]: managed } } });
            expectPLoose(check, `M20 ${label}`, r.prep, T_POLICY, null);
            check(!exists(runFile(root, id, 'plan.json')), `M20 ${label}: no plan is written`);
          }
          // a wrongly typed value in a known target: the shared validator code and message, naming the project target
          const bad = respec(kit, root, id, { requests: { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': [5] } } } });
          expectP(check, 'a wrongly typed managed value', bad.prep, [{ target: T_SETTINGS, code: 'OWNERSHIP_SHAPE', error: 'OWNERSHIP_SHAPE: managed.permissions.deny' }]);
          const bad2 = respec(kit, root, id, { requests: { 'omissions.json': { [T_SETTINGS]: { 'permissions.allow': 'x' } } } });
          expectPLoose(check, 'a wrongly typed omission value', bad2.prep, T_SETTINGS, 'OMISSIONS_SHAPE');
        });
      });
      await step('C2-P3-4: keys is valid only for the settings and the policy; invalid ownership values name the project target', async () => {
        await withScratch(context, 'p34', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const id = 'run-c2-p34';
          const first = runSpec(kit, root, id, { drafts: { 'TODO.md': '# TODO\n\nnew item\n' } });
          check(first.ok === true, 'a changed TODO.md prepares', first.prep && first.prep.stdout.slice(0, 200));
          const ownV = (t, v) => [{ target: t, code: 'APPLY_OWNERSHIP_VALUE', error: MSG.OWNERSHIP_VALUE(t, v) }];
          expectP(check, 'R15 keys for TODO.md', respec(kit, root, id, { drafts: { 'TODO.md': '# TODO\n\nnew item\n' }, requests: { 'ownership.json': { 'TODO.md': 'keys' } } }).prep, ownV('TODO.md', 'keys'));
          expectP(check, 'keys for an unchanged TODO.md too', respec(kit, root, id, { drafts: { 'TODO.md': readBytes(projPath(root, 'TODO.md')) }, requests: { 'ownership.json': { 'TODO.md': 'keys' } } }).prep, ownV('TODO.md', 'keys'));
          expectP(check, 'R15 an invalid ownership value', respec(kit, root, id, { drafts: { 'TODO.md': '# TODO\n\nnew item\n' }, requests: { 'ownership.json': { 'TODO.md': 'owned-by-me' } } }).prep, ownV('TODO.md', 'owned-by-me'));
          expectP(check, 'a non-string ownership value', respec(kit, root, id, { drafts: { 'TODO.md': '# TODO\n\nnew item\n' }, requests: { 'ownership.json': { 'TODO.md': 5 } } }).prep, ownV('TODO.md', 5));
        });
      });
    }
    if (plain) {
      await step('4.1 no prior record: policy keys need complete metadata; settings keys default to {}; unchanged targets need explicit keys ownership', async () => {
        await withScratch(context, 'np', async (dir) => {
          const base = cloneBase(dir, plain, 'b');
          const polText = jsonText({ schema: 2, patterns: [{ anchor: 'any', glob: '**/.env' }], projectPatterns: [] });
          const polManaged = { schema: 2, patterns: [{ anchor: 'any', glob: '**/.env' }] };
          putFile(projPath(base, T_POLICY), polText);
          putFile(projPath(base, T_SETTINGS), '{\n  "permissions": {}\n}\n');
          commitAll(context, base, 'installed controls');
          const id = 'run-c2-np1';
          const root = cloneBase(dir, base, 'p');
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'the run exists', first.prep && first.prep.stdout.slice(0, 200));
          const req = { target: T_POLICY, code: 'APPLY_METADATA_REQUIRED', error: MSG.METADATA_REQUIRED(T_POLICY) };
          expectP(check, 'row: no prior, known policy, keys, no managed request', respec(kit, root, id, { drafts: { [T_POLICY]: polText }, requests: { 'ownership.json': { [T_POLICY]: 'keys' } } }).prep, [req]);
          expectP(check, 'row: the same with an omission request', respec(kit, root, id, { drafts: { [T_POLICY]: polText }, requests: { 'ownership.json': { [T_POLICY]: 'keys' }, 'omissions.json': { [T_POLICY]: { patterns: [] } } } }).prep, [req]);
          // a written policy with complete managed metadata: a keys record, no operation (initial metadata of a written target)
          const newPol = jsonText({ schema: 2, patterns: [{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/*.pem' }], projectPatterns: [] });
          const polMgd = { schema: 2, patterns: [{ anchor: 'any', glob: '**/.env' }, { anchor: 'any', glob: '**/*.pem' }] };
          const w = respec(kit, root, id, { drafts: { [T_POLICY]: newPol }, requests: { 'ownership.json': { [T_POLICY]: 'keys' }, 'managed-keys.json': { [T_POLICY]: polMgd } }, o: { approve: [T_POLICY] } });
          // the existing policy is unrecorded, so replacing it is a pre-existing file edit: approval is the existing content rule, not metadata
          check(w.ok === true && w.prep.json.metadataChanged === 0 && eq(w.plan.manifestAfter && w.plan.manifestAfter.files[T_POLICY], { ownership: 'keys', managed: polMgd }), 'row: a written unrecorded policy with complete managed metadata becomes a keys record with no metadata operation', w.prep && w.prep.stdout.slice(0, 400));
          const wo = respec(kit, root, id, { drafts: { [T_POLICY]: newPol }, requests: { 'ownership.json': { [T_POLICY]: 'keys' }, 'managed-keys.json': { [T_POLICY]: polMgd }, 'omissions.json': { [T_POLICY]: { patterns: [{ anchor: 'any', glob: '**/.npmrc' }] } } }, o: { approve: [T_POLICY] } });
          check(wo.ok === true && eq(wo.prep.json.metadataOps, [fileOp(T_POLICY, null, { ownership: 'keys', managed: polMgd, omissions: { patterns: [{ anchor: 'any', glob: '**/.npmrc' }] } }, [R_OMIT])]), 'row: with an omission request there is one file operation with before null and the omission reason', wo.prep && wo.prep.json && wo.prep.json.metadataOps);
          // row: no prior, known settings, keys, no managed request: managed {}
          // an append-only draft over an unrecorded settings file: the initial metadata of a written target needs no extra approval (R29(d))
          const sx = respec(kit, root, id, { drafts: { [T_SETTINGS]: '{\n  "permissions": {\n    "deny": ["Read(x)"]\n  }\n}\n' }, requests: { 'ownership.json': { [T_SETTINGS]: 'keys' } } });
          check(sx.ok === true && sx.prep.json.metadataChanged === 0 && eq(sx.plan.manifestAfter && sx.plan.manifestAfter.files[T_SETTINGS], { ownership: 'keys', managed: {} }), 'M18: settings keys without prior or requested metadata record a valid empty managed object', sx.prep && sx.prep.stdout.slice(0, 400));
          // row: no prior, unchanged target: managed or omission requests need explicit keys ownership
          const own = { target: T_SETTINGS, code: 'APPLY_METADATA_OWNERSHIP', error: MSG.METADATA_OWNERSHIP(T_SETTINGS) };
          const settingsSame = readBytes(projPath(root, T_SETTINGS));
          expectP(check, 'row: an unchanged unrecorded target with a managed request and no ownership', respec(kit, root, id, { drafts: { [T_SETTINGS]: settingsSame }, requests: { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': ['Read(x)'] } } } }).prep, [own]);
          expectP(check, 'row: an unchanged unrecorded target with an omission request and no ownership', respec(kit, root, id, { drafts: { [T_SETTINGS]: settingsSame }, requests: { 'omissions.json': { [T_SETTINGS]: { 'permissions.allow': ['Bash(x)'] } } } }).prep, [own]);
          putFile(projPath(root, 'docs/plain.md'), '# plain\n');
          // R15: a valid explicit ownership on a written, unrecorded target is accepted and shown for review
          const fresh = respec(kit, root, id, { drafts: { 'docs/new-owned.md': '# new\n' }, requests: { 'ownership.json': { 'docs/new-owned.md': 'full' } } });
          check(fresh.ok === true && eq(fresh.prep.json.ownershipOverrides, { 'docs/new-owned.md': 'full' }), 'R15: explicit ownership on a created target is accepted and shown as ownershipOverrides', fresh.prep && fresh.prep.stdout.slice(0, 300));
          expectP(check, 'M9: explicit non-keys ownership on an unchanged unrecorded target is generic adoption', respec(kit, root, id, { drafts: { 'docs/plain.md': '# plain\n' }, requests: { 'ownership.json': { 'docs/plain.md': 'full' } } }).prep, [{ target: 'docs/plain.md', code: 'APPLY_METADATA_TARGET', error: MSG.METADATA_TARGET('docs/plain.md') }]);
          const none = respec(kit, root, id, { drafts: { 'docs/plain.md': '# plain\n' } });
          check(none.ok === true && none.prep.json.metadataChanged === 0 && none.prep.json.unchanged === 1, 'row: no requests at all leave an unchanged unrecorded target alone', none.prep && none.prep.stdout.slice(0, 300));
        });
      });
    }
  });
}

// ============================================ binding scenarios (R80 and R15) ====
// Plan 5.3 and 7.7: prepare once, mutate one item, test diff and commit in separate fixture copies.
const BIND_ID = 'run-c2-bind1';
const DOC_API = 'docs/api-conventions.md';
const DOC_DB = 'docs/database.md';
const DOC_OBS = 'docs/observability.md';
const IN_CONSUMER = 'docs/consumer.md';
const IN_ABSENT = 'docs/absent.md';
const DOC_ADDED = 'docs/added.md';
// Scenario A: all five request files present, three drafts (two changed, one unchanged), a metadata-only settings target, two declared
// inputs (one existing consumer, one absent) and a declared input that is also a content target. Scenario B: the same without requests.
async function bindScenario(context, kit, dir, v3p, withRequests) {
  const root = cloneBase(dir, v3p, withRequests ? 'bind-a' : 'bind-b');
  putFile(projPath(root, IN_CONSUMER), '# consumer\n');
  commitAll(context, root, 'consumer');
  const f = baseFacts(root);
  const dbBytes = readBytes(projPath(root, DOC_DB));
  const drafts = { [DOC_API]: '# api-conventions\n\nchanged\n', [DOC_DB]: dbBytes, [DOC_OBS]: '# observability\n\nchanged\n' };
  const requests = withRequests ? {
    'ownership.json': { [T_SETTINGS]: 'keys' },
    'managed-keys.json': { [T_SETTINGS]: { heldBack: ['Read(**/.env)'] } },
    'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } },
    'manifest-metadata.json': { codexSnippetSha256: H('a') },
    'transaction-inputs.json': [IN_CONSUMER, IN_ABSENT, DOC_API],
  } : {};
  const p = runSpec(kit, root, BIND_ID, { drafts, requests, o: withRequests ? { approve: [T_SETTINGS] } : {} });
  return { root, id: BIND_ID, p, f, drafts, requests };
}
// Runs one mutation against both commands, each in its own copy of the prepared project.
function bindRun(kit, check, dir, scen, counter, label, mutate, rows, o = {}) {
  const id = scen.id;
  const lockPath = (r) => lockOwnerPath(r);
  const tagFile = (r) => (o.failRead ? makeGuard(dir, o.failRead(r), 'fail') : null);
  // diff
  const d = cloneTree(scen.root, path.join(dir, `d${++counter.n}`));
  mutate(d);
  const snapD = projectSnapshot(d);
  const lockD = readBytes(lockPath(d));
  const gd = tagFile(d);
  const rd = kit.diff(d, id, gd ? { preload: gd.file } : {});
  expectF(check, `${label} (diff)`, rd, { code: 'APPLY_DRIFT', exit: 4, error: MSG.DRIFT, extra: ['drift'] });
  check(eq(rd.json && rd.json.drift, rows), `${label} (diff): the exact drift array`, rd.json && rd.json.drift);
  check(projectSnapshot(d) === snapD, `${label} (diff): the project, run inventory and lock are unchanged`);
  check(Buffer.compare(lockD, readBytes(lockPath(d))) === 0, `${label} (diff): the lock bytes are unchanged`);
  if (o.failRead) check(!/unreadable|EACCES|injected/i.test(rd.stdout), `${label} (diff): no native or injected read error text is printed`, rd.stdout.slice(0, 300));
  // commit
  const c = cloneTree(scen.root, path.join(dir, `c${++counter.n}`));
  mutate(c);
  const snapC = projectSnapshot(c);
  const lockC = readBytes(lockPath(c));
  const gc = tagFile(c);
  const rc = kit.commit(c, id, scen.p.sha, gc ? { preload: gc.file } : {});
  expectF(check, `${label} (commit)`, rc, { code: 'APPLY_DRIFT', exit: 4, error: MSG.DRIFT, extra: ['drift'] });
  check(eq(rc.json && rc.json.drift, rows), `${label} (commit): the exact drift array`, rc.json && rc.json.drift);
  check(!exists(runFile(c, id, 'journal.json')), `${label} (commit): no journal is created`);
  check(projectSnapshot(c) === snapC, `${label} (commit): no project file changed`);
  check(Buffer.compare(lockC, readBytes(lockPath(c))) === 0, `${label} (commit): a rejected commit leaves the lock bytes unchanged`);
  if (o.failRead) check(!/unreadable|EACCES|injected/i.test(rc.stdout), `${label} (commit): no native or injected read error text is printed`, rc.stdout.slice(0, 300));
}
const dr = (target, what) => ({ target, what });
const garbage = '{ not json';

// ============================================================ R80/C2/input-binding ====
// Plan 4.3 (inputs, sourceInventory), 5.3 (drift rows, order and roles) and 7.7 (the binding matrix).
async function inputBinding(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v3p = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
    if (!v3p) return;
    await withScratch(context, 'bind', async (dir) => {
      const scen = await bindScenario(context, kit, dir, v3p, true);
      check(scen.p.ok === true, 'the binding scenario prepares', scen.p.prep && scen.p.prep.stdout.slice(0, 500));
      if (!scen.p.ok) return;
      const { id, root } = scen;
      const counter = { n: 0 };
      const dpath = (r, rel) => draftPath(r, id, rel);
      const tpath = (r, rel) => projPath(r, rel);
      const bump = (p) => fs.appendFileSync(p, '\nmutation\n');
      // JSON control files change by whitespace only, so they stay valid and a fail-closed parse can never pre-empt the drift report.
      const ws = (p) => fs.appendFileSync(p, '\n');
      await step('the plan binds every input: inputs, sourceInventory, declared inputs (present and absent), the installed policy', async () => {
        const plan = scen.p.plan;
        const bound = [T_POLICY, T_SETTINGS, DOC_API, DOC_DB, DOC_OBS, IN_CONSUMER, IN_ABSENT].sort();
        const want = bound.map((t) => ({ target: t, preRawSha: exists(projPath(root, t)) ? sha(readBytes(projPath(root, t))) : null }));
        check(eq(plan.inputs, want), 'inputs: content targets, the metadata target, declared inputs and the installed policy, deduplicated and sorted, an absent input bound as null', plan.inputs);
        check(eq(plan.sourceInventory, [DOC_API, DOC_DB, DOC_OBS].sort().map((t) => ({ target: t, origin: 'draft' }))), 'sourceInventory lists every draft including the unchanged one', plan.sourceInventory);
        check(eq(plan.metadata.transactionInputs, [IN_CONSUMER, IN_ABSENT, DOC_API]) && plan.metadata.transactionInputsSha256 === sha(readBytes(runFile(root, id, 'transaction-inputs.json'))), 'the declared input list is embedded with the hash of its bytes', plan.metadata.transactionInputs);
        check(plan.ops.every((o) => o.sourceSha256 === sha(readBytes(draftPath(root, id, o.target)))), 'every source (including the unchanged draft) binds its raw bytes');
        check(!JSON.stringify(plan).includes('"approved"'), 'no approval field is stored in the plan');
      });
      await step('7.7 drafts: a changed or unchanged draft body, one source-body row for its project target', async () => {
        bindRun(kit, check, dir, scen, counter, 'a changed draft body', (r) => bump(dpath(r, DOC_API)), [dr(DOC_API, DRIFT_WHAT.SOURCE)]);
        bindRun(kit, check, dir, scen, counter, 'an unchanged draft body', (r) => bump(dpath(r, DOC_DB)), [dr(DOC_DB, DRIFT_WHAT.SOURCE)]);
        bindRun(kit, check, dir, scen, counter, 'an existing source that cannot be read', () => {}, [dr(DOC_OBS, DRIFT_WHAT.SOURCE)], { failRead: (r) => [dpath(r, DOC_OBS)] });
      });
      await step('7.7 targets and inputs: one row per path, content or metadata target role wins over the declared-input description', async () => {
        bindRun(kit, check, dir, scen, counter, 'a changed target body (also a declared input: one row)', (r) => bump(tpath(r, DOC_API)), [dr(DOC_API, DRIFT_WHAT.TARGET)]);
        bindRun(kit, check, dir, scen, counter, 'an unchanged target body', (r) => bump(tpath(r, DOC_DB)), [dr(DOC_DB, DRIFT_WHAT.TARGET)]);
        bindRun(kit, check, dir, scen, counter, 'the metadata-only settings target', (r) => ws(tpath(r, T_SETTINGS)), [dr(T_SETTINGS, DRIFT_WHAT.TARGET)]);
        bindRun(kit, check, dir, scen, counter, 'a declared unchanged consumer', (r) => bump(tpath(r, IN_CONSUMER)), [dr(IN_CONSUMER, DRIFT_WHAT.INPUT)]);
        bindRun(kit, check, dir, scen, counter, 'a declared absent input appears', (r) => putFile(tpath(r, IN_ABSENT), '# now here\n'), [dr(IN_ABSENT, DRIFT_WHAT.INPUT)]);
        // C2-P3-5: the installed policy is not itself a target of this run
        bindRun(kit, check, dir, scen, counter, 'the installed policy changes (not a target)', (r) => ws(tpath(r, T_POLICY)), [dr(T_POLICY, DRIFT_WHAT.INPUT)]);
        bindRun(kit, check, dir, scen, counter, 'manifest bytes change', (r) => fs.appendFileSync(manifestPath(r), '\n'), [dr(T_MANIFEST, DRIFT_WHAT.MANIFEST)]);
      });
      await step('7.7 the source inventory: an added safe draft, or a removed approved draft, is one inventory row and no source row', async () => {
        const inv = dr(`.ai/.run/${id}`, DRIFT_WHAT.INVENTORY);
        bindRun(kit, check, dir, scen, counter, 'a safe draft is added', (r) => putFile(dpath(r, DOC_ADDED), '# added\n'), [inv]);
        bindRun(kit, check, dir, scen, counter, 'an approved draft is removed', (r) => fs.rmSync(dpath(r, DOC_OBS)), [inv]);
        bindRun(kit, check, dir, scen, counter, 'a vault source is added (origin and inventory)', (r) => putFile(vaultPath(r, id, '.env.example'), 'PORT=\n'), [inv]);
      });
      await step('5.3 several mutations: categories in order (inventory, targets and inputs by target, source bodies by target, requests in file order, manifest), role deduplication', async () => {
        const rows = [
          dr(`.ai/.run/${id}`, DRIFT_WHAT.INVENTORY),
          dr(T_POLICY, DRIFT_WHAT.INPUT), dr(T_SETTINGS, DRIFT_WHAT.TARGET), dr(IN_ABSENT, DRIFT_WHAT.INPUT), dr(DOC_API, DRIFT_WHAT.TARGET), dr(IN_CONSUMER, DRIFT_WHAT.INPUT),
          dr(DOC_API, DRIFT_WHAT.SOURCE), dr(DOC_DB, DRIFT_WHAT.SOURCE),
          dr('ownership.json', DRIFT_WHAT.REQUEST), dr('omissions.json', DRIFT_WHAT.REQUEST),
          dr(T_MANIFEST, DRIFT_WHAT.MANIFEST),
        ];
        bindRun(kit, check, dir, scen, counter, 'a combined mutation', (r) => {
          putFile(dpath(r, DOC_ADDED), '# added\n');
          fs.rmSync(dpath(r, DOC_OBS));
          ws(tpath(r, T_POLICY)); ws(tpath(r, T_SETTINGS)); putFile(tpath(r, IN_ABSENT), '# now here\n');
          bump(tpath(r, DOC_API)); bump(dpath(r, DOC_API)); bump(tpath(r, IN_CONSUMER)); bump(dpath(r, DOC_DB));
          putFile(runFile(r, id, 'ownership.json'), garbage); fs.rmSync(runFile(r, id, 'omissions.json'));
          fs.appendFileSync(manifestPath(r), '\n');
        }, rows);
      });
      await step('7.7 an unrelated unbound file change is not drift; a changed plan.json keeps the existing approved-plan refusal; a link replacement wins over drift', async () => {
        const u1 = cloneTree(root, path.join(dir, 'u-diff'));
        bump(tpath(u1, 'package.json'));
        const du = kit.diff(u1, id);
        check(du.code === 0 && du.json && du.json.ok === true && du.json.prepared === true, 'diff ignores an unbound file change', du.stdout.slice(0, 300));
        const u2 = cloneTree(root, path.join(dir, 'u-commit'));
        bump(tpath(u2, 'package.json'));
        const cu = kit.commit(u2, id, scen.p.sha);
        check(cu.code === 0 && cu.json && cu.json.committed === true, 'commit ignores an unbound file change', cu.stdout.slice(0, 300));
        const t = cloneTree(root, path.join(dir, 'tamper'));
        fs.appendFileSync(runFile(t, id, 'plan.json'), ' ');
        const ct = kit.commit(t, id, scen.p.sha);
        check(ct.code === 4 && ct.json && ct.json.ok === false && ct.json.error === MSG.PLAN_HASH, 'a modified plan.json is refused with the existing approved-plan message and exit 4', { code: ct.code, out: ct.stdout.slice(0, 300) });
        check(!exists(runFile(t, id, 'journal.json')), 'the refusal creates no journal');
        // a replaced run directory takes precedence over drift
        const outside = path.join(dir, 'outside-drafts');
        const l = cloneTree(root, path.join(dir, 'link'));
        bump(dpath(l, DOC_API));
        fs.renameSync(path.join(runDirOf(l, id), 'drafts'), outside);
        if (!linkDir(outside, path.join(runDirOf(l, id), 'drafts'))) { check(false, 'a junction (a directory symlink off Windows) could be created for the run-link case'); return; }
        const outsideBefore = snapshotTree(outside);
        const dl = kit.diff(l, id);
        check(dl.code === 2 && dl.json && dl.json.ok === false && dl.json.code === 'APPLY_PATH', 'diff: a linked draft directory exits 2 (APPLY_PATH) before any drift report', { code: dl.code, out: dl.stdout.slice(0, 300) });
        const cl = kit.commit(l, id, scen.p.sha);
        check(cl.code === 2 && !exists(runFile(l, id, 'journal.json')), 'commit: a linked draft directory exits 2 with no journal, before any drift report', { code: cl.code, out: cl.stdout.slice(0, 300) });
        check(snapshotTree(outside) === outsideBefore, 'nothing was written through the link');
      });
      await step('M25 and M24: a no-op plan with drift exits 4 without a journal or heartbeat', async () => {
        // a genuine no-op plan: one unchanged draft, nothing else
        const nroot = cloneBase(dir, v3p, 'noop');
        const same = readBytes(projPath(nroot, DOC_DB));
        const np = runSpec(kit, nroot, 'run-c2-noop1', { drafts: { [DOC_DB]: same } });
        check(np.ok === true && np.prep.json.changed === 0 && np.prep.json.unchanged === 1 && np.prep.json.metadataChanged === 0, 'the no-op plan prepares with zero changes', np.prep && np.prep.stdout.slice(0, 300));
        if (!np.ok) return;
        check(np.plan.manifestAfter === null, 'a genuine no-op has manifestAfter null', np.plan.manifestAfter);
        const c1 = cloneTree(nroot, path.join(dir, 'noop-drift'));
        bump(draftPath(c1, 'run-c2-noop1', DOC_DB));
        const lockBefore = readBytes(lockOwnerPath(c1));
        const r = kit.commit(c1, 'run-c2-noop1', np.sha);
        expectF(check, 'M25', r, { code: 'APPLY_DRIFT', exit: 4, error: MSG.DRIFT, extra: ['drift'] });
        check(eq(r.json && r.json.drift, [dr(DOC_DB, DRIFT_WHAT.SOURCE)]), 'M25: the drift row names the unchanged draft', r.json && r.json.drift);
        check(!exists(runFile(c1, 'run-c2-noop1', 'journal.json')) && Buffer.compare(lockBefore, readBytes(lockOwnerPath(c1))) === 0, 'M25: no journal and no heartbeat');
      });
    });
  });
}

// ======================================================= R15/C2/metadata-binding ====
// Plan 4.1 (request files), 4.3 (embedded metadata), 5.2/5.3 and 7.7: presence and bytes of every request file are part of the approval.
async function metadataBinding(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v3p = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
    const plain = await useBase(failures, 'plain', getPlainBase, context);
    if (v3p) {
      await withScratch(context, 'mbind', async (dir) => {
        const a = await bindScenario(context, kit, dir, v3p, true);
        const b = await bindScenario(context, kit, dir, v3p, false);
        check(a.p.ok === true && b.p.ok === true, 'both binding scenarios prepare', { a: a.p.prep && a.p.prep.stdout.slice(0, 200), b: b.p.prep && b.p.prep.stdout.slice(0, 200) });
        if (!a.p.ok || !b.p.ok) return;
        await step('every present request file is embedded with the hash of its raw bytes; an absent one is null', async () => {
          const md = a.p.plan.metadata;
          for (const [name, key] of [['ownership.json', 'ownership'], ['managed-keys.json', 'managedKeys'], ['omissions.json', 'omissions'], ['manifest-metadata.json', 'manifestMetadata'], ['transaction-inputs.json', 'transactionInputs']]) {
            check(md[`${key}Sha256`] === sha(readBytes(runFile(a.root, a.id, name))) && eq(md[key], a.requests[name]), `${name} is embedded with its SHA-256`, { sha: md[`${key}Sha256`], value: md[key] });
          }
          const none = b.p.plan.metadata;
          check(eq(sorted(Object.keys(none)), PLAN_METADATA_KEYS) && Object.values(none).every((v) => v === null), 'without request files every metadata field is null', none);
        });
        await step('7.7 each request file changed, deleted (scenario with requests) or added (scenario without) is one request-file row; changed bytes need not be valid', async () => {
          const ca = { n: 0 };
          for (const name of REQUEST_FILES) {
            bindRun(kit, check, dir, a, ca, `${name} changed (not even JSON)`, (r) => putFile(runFile(r, a.id, name), garbage), [dr(name, DRIFT_WHAT.REQUEST)]);
            bindRun(kit, check, dir, a, ca, `${name} deleted`, (r) => fs.rmSync(runFile(r, a.id, name)), [dr(name, DRIFT_WHAT.REQUEST)]);
          }
          const cb = { n: 100 };
          for (const name of REQUEST_FILES) {
            bindRun(kit, check, dir, b, cb, `${name} added (not even JSON)`, (r) => putFile(runFile(r, b.id, name), garbage), [dr(name, DRIFT_WHAT.REQUEST)]);
          }
          bindRun(kit, check, dir, b, cb, 'R15: ownership added with a valid body', (r) => putFile(runFile(r, b.id, 'ownership.json'), jsonText({ [DOC_API]: 'full' })), [dr('ownership.json', DRIFT_WHAT.REQUEST)]);
        });
      });
    }
    if (plain) {
      await step('4.1 request files: missing means no request, present null is invalid, empty containers are valid and bound; container shape and JSON errors', async () => {
        await withScratch(context, 'mshape', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-shape1';
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'a run with no request files prepares', first.prep && first.prep.stdout.slice(0, 200));
          const shapeEntry = (name) => [{ target: name, code: 'APPLY_INPUT_SHAPE', error: MSG.INPUT_SHAPE(name) }];
          const jsonEntry = (name) => [{ target: name, code: 'APPLY_INPUT_JSON', error: MSG.INPUT_JSON(name) }];
          for (const name of REQUEST_FILES) {
            expectP(check, `${name}: a present null is invalid`, respec(kit, root, id, { requests: { [name]: 'null\n' } }).prep, shapeEntry(name));
          }
          const wrongContainer = { 'ownership.json': '[]\n', 'managed-keys.json': '[]\n', 'omissions.json': '"x"\n', 'manifest-metadata.json': '[]\n', 'transaction-inputs.json': '{}\n' };
          for (const [name, body] of Object.entries(wrongContainer)) {
            expectP(check, `${name}: a container of the wrong kind`, respec(kit, root, id, { requests: { [name]: body } }).prep, shapeEntry(name));
          }
          expectP(check, 'transaction inputs are paths, never caller-supplied hashes (an object is refused)', respec(kit, root, id, { requests: { 'transaction-inputs.json': { 'docs/a.md': H('a') } } }).prep, shapeEntry('transaction-inputs.json'));
          expectP(check, 'transaction inputs must be strings', respec(kit, root, id, { requests: { 'transaction-inputs.json': [1] } }).prep, shapeEntry('transaction-inputs.json'));
          for (const name of REQUEST_FILES) {
            const r = respec(kit, root, id, { requests: { [name]: '{ not json: leak-marker-77\n' } });
            expectP(check, `${name}: invalid JSON`, r.prep, jsonEntry(name));
            check(!/leak-marker-77|Unexpected|JSON at position|Expected/.test(r.prep.stdout), `${name}: no source text and no native parser excerpt is printed`, r.prep.stdout.slice(0, 300));
          }
          // empty containers are valid, embedded, and their presence is bound
          const empty = { 'ownership.json': {}, 'managed-keys.json': {}, 'omissions.json': {}, 'manifest-metadata.json': {}, 'transaction-inputs.json': [] };
          const e = respec(kit, root, id, { requests: empty });
          check(e.ok === true && e.prep.json.changed === 0 && e.prep.json.unchanged === 0 && e.prep.json.metadataChanged === 0, 'empty containers are valid and request nothing', e.prep && e.prep.stdout.slice(0, 300));
          if (e.ok) {
            const md = e.plan.metadata;
            check(md.ownership && eq(md.ownership, {}) && md.ownershipSha256 === sha(readBytes(runFile(root, id, 'ownership.json'))) && eq(md.transactionInputs, []) && typeof md.transactionInputsSha256 === 'string', 'empty containers are embedded (not null) with their hashes', md);
            check(e.plan.manifestAfter === null, 'empty requests are a genuine no-op', e.plan.manifestAfter);
            const copy = cloneTree(root, path.join(dir, 'del'));
            fs.rmSync(runFile(copy, id, 'transaction-inputs.json'));
            const c = kit.commit(copy, id, e.sha);
            expectF(check, 'deleting an empty request file', c, { code: 'APPLY_DRIFT', exit: 4, error: MSG.DRIFT, extra: ['drift'] });
            check(eq(c.json && c.json.drift, [dr('transaction-inputs.json', DRIFT_WHAT.REQUEST)]), 'presence is bound even for an empty container', c.json && c.json.drift);
          }
        });
      });
      await step('4.1 declared transaction inputs: structural path errors, out-of-scope, secret and run-internal paths and duplicates are rejected', async () => {
        await withScratch(context, 'tin', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-tin1';
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'the run exists');
          const r1 = respec(kit, root, id, { requests: { 'transaction-inputs.json': ['docs//x.md'] } });
          check(r1.prep.code === 3 && r1.prep.json && r1.prep.json.code === 'APPLY_PLAN_REJECTED' && r1.prep.json.errors.length === 1 && r1.prep.json.errors[0].code === 'APPLY_PATH' && r1.prep.json.errors[0].error === 'unsafe path: docs//x.md', 'a non-canonical declared path: APPLY_PATH with the path as written', r1.prep.json);
          // PLAN-GAP: the entry target for a bad declared path is not pinned (the path itself or the request filename); only a string is required.
          check(typeof ((r1.prep.json || {}).errors || [{}])[0].target === 'string', 'the entry names a target');
          const r2 = respec(kit, root, id, { requests: { 'transaction-inputs.json': ['../outside.md'] } });
          check(r2.prep.code === 3 && r2.prep.json && r2.prep.json.errors && r2.prep.json.errors[0] && r2.prep.json.errors[0].code === 'APPLY_PATH' && r2.prep.json.errors[0].error === 'unsafe path: ../outside.md', 'a traversal declared path: APPLY_PATH', r2.prep.json);
          // PLAN-GAP: the plan does not give the code or text for these refusals (write scope, secret, run-internal, duplicate); only the refusal is pinned.
          putFile(projPath(root, 'src/app.ts'), 'export {}\n');
          for (const [label, list] of [['a path outside the write scope', ['src/app.ts']], ['a secret-pattern path', ['docs/secrets/x.md']], ['a run-internal path', [`.ai/.run/${id}/ownership.json`]], ['a duplicate entry', ['docs/a.md', 'docs/a.md']]]) {
            const r = respec(kit, root, id, { requests: { 'transaction-inputs.json': list } });
            check(r.prep.code === 3 && r.prep.json && r.prep.json.ok === false && r.prep.json.code === 'APPLY_PLAN_REJECTED' && Array.isArray(r.prep.json.errors) && r.prep.json.errors.length >= 1, `${label} is rejected at prepare`, r.prep.stdout.slice(0, 300));
            check(!exists(runFile(root, id, 'plan.json')), `${label}: no plan is written`);
          }
        });
      });
    }
  });
}

// ================================================== R29/C2/approval-noop ====
// Plan 4.5 (approval rules), 4.6 (commit order, genuine no-op, one journal) and 7.6 rows M8, M10, M11, M12, M22, M24, M25 (M25 is also in the
// binding group). The existing R29 regression guard (d) stays in run-tests.mjs unchanged; M22 repeats it through the C2 engine.
const R29_BASE = { $schema: 'https://json.schemastore.org/claude-code-settings.json', permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)', 'Bash(DROP DATABASE *)'] }, hooks: { PostToolUse: [{ matcher: 'Write', command: 'x' }] } };
async function approvalNoop(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v2 = await useBase(failures, 'genuine v2', getV2Base, context);
    const v2p = await useBase(failures, 'v2 with preserved settings', getV2pBase, context);
    const v3p = await useBase(failures, 'schema 3 with preserved settings', getV3pBase, context);
    const plain = await useBase(failures, 'plain', getPlainBase, context);

    if (v3p) {
      await step('M8: identical content and requests are an exact no-op: exit 0, no journal, lock and manifest bytes unchanged', async () => {
        await withScratch(context, 'm8', async (dir) => {
          const root = cloneBase(dir, v3p, 'p');
          const f = baseFacts(root);
          const same = readBytes(projPath(root, DOC_DB));
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: f.settingsRec.managed } };
          // a different mode than the recorded one: a no-op leaves the manifest (including its mode and sourceCommit) alone
          const p = runSpec(kit, root, 'run-c2-m8', { drafts: { [DOC_DB]: same }, requests: reqs, o: { mode: 'adopt', agents: 'claude' } });
          expectPrepared(check, 'M8', p, { changed: 0, unchanged: 1, metadataOps: [] });
          if (!p.ok) return;
          check(p.plan.manifestAfter === null, 'M8: manifestAfter is null for a genuine no-op', p.plan.manifestAfter);
          const treeBefore = projectSnapshot(root);
          const lockBefore = readBytes(lockOwnerPath(root));
          const manifestBefore = readBytes(manifestPath(root));
          const c = kit.commit(root, 'run-c2-m8', p.sha);
          check(c.code === 0 && c.stderr === '' && c.stdout === jsonText(NOOP_BODY), 'M8: the exact no-op response (exit 0, two-space JSON, one final LF, empty stderr)', { code: c.code, out: c.stdout.slice(0, 300) });
          check(!exists(runFile(root, 'run-c2-m8', 'journal.json')), 'M8: no journal');
          check(Buffer.compare(lockBefore, readBytes(lockOwnerPath(root))) === 0, 'M8: the lock bytes are unchanged (no heartbeat)');
          check(Buffer.compare(manifestBefore, readBytes(manifestPath(root))) === 0 && projectSnapshot(root) === treeBefore, 'M8: manifest and every project file are unchanged');
          check(!exists(runFile(root, 'run-c2-m8', 'vault', 'backup', '.ai', 'manifest.json')), 'M8: no manifest backup was made');
        });
      });
      await step('M24: a no-op commit without this run\'s lock exits 2 before anything else: no journal, no heartbeat, lock bytes unchanged', async () => {
        await withScratch(context, 'm24', async (dir) => {
          const same = readBytes(projPath(v3p.root, DOC_DB));
          const mk = (label) => {
            const root = cloneBase(dir, v3p, label);
            const p = runSpec(kit, root, 'run-c2-m24', { drafts: { [DOC_DB]: same } });
            check(p.ok === true, `${label}: a no-op plan prepares`, p.prep && p.prep.stdout.slice(0, 200));
            return { root, p };
          };
          const retained = (label, r) => {
            check(r.code === 2 && r.json && r.json.ok === false && r.json.error === MSG.LOCK, `${label}: exit 2 with the existing lock message`, { code: r.code, out: r.stdout.slice(0, 300) });
          };
          // (i) no lock at all
          const a = mk('nolock');
          kit.lock(a.root, ['release', '--run-id', 'run-c2-m24']);
          const treeA = projectSnapshot(a.root);
          retained('M24 no lock', kit.commit(a.root, 'run-c2-m24', a.p.sha));
          check(!exists(path.join(a.root, '.ai', '.setup.lock')) && projectSnapshot(a.root) === treeA, 'M24 no lock: no lock directory was created and nothing changed');
          check(!exists(runFile(a.root, 'run-c2-m24', 'journal.json')), 'M24 no lock: no journal');
          // (ii) a lock owned by another run
          const b = mk('other');
          kit.lock(b.root, ['release', '--run-id', 'run-c2-m24']);
          kit.lock(b.root, ['acquire', '--run-id', 'run-c2-other']);
          const ownerB = readBytes(lockOwnerPath(b.root));
          retained('M24 wrong owner', kit.commit(b.root, 'run-c2-m24', b.p.sha));
          check(Buffer.compare(ownerB, readBytes(lockOwnerPath(b.root))) === 0, 'M24 wrong owner: the other run\'s lock bytes are unchanged');
          // (iii) a malformed owner file
          const c = mk('badowner');
          putFile(lockOwnerPath(c.root), '{ not json');
          const ownerC = readBytes(lockOwnerPath(c.root));
          retained('M24 malformed owner', kit.commit(c.root, 'run-c2-m24', c.p.sha));
          check(Buffer.compare(ownerC, readBytes(lockOwnerPath(c.root))) === 0 && !exists(runFile(c.root, 'run-c2-m24', 'journal.json')), 'M24 malformed owner: lock bytes unchanged, no journal');
        });
      });
    }

    if (v2) {
      await step('4.6 commit order: the lock is checked before the run lifecycle; a used run is refused with exit 7 while it holds the lock', async () => {
        await withScratch(context, 'ord2', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const id = 'run-c2-ord2';
          const p = runSpec(kit, root, id, {});
          check(p.ok === true, 'a schema-only plan prepares');
          if (!p.ok) return;
          const c = kit.commit(root, id, p.sha);
          check(c.code === 0 && c.json && c.json.committed === true, 'the first commit succeeds', c.stdout.slice(0, 200));
          const again = kit.commit(root, id, p.sha);
          check(again.code === 7 && again.json && again.json.ok === false && /^commit refused: run run-c2-ord2 is committed; its journal is never reset/.test(again.json.error), 'a second commit with the lock held: exit 7 with the existing lifecycle message', { code: again.code, out: again.stdout.slice(0, 300) });
          const rep = kit.prepare(root, id);
          check(rep.code === 7 && rep.json && /^prepare refused: run run-c2-ord2 is committed/.test(rep.json.error), 'prepare of a journaled run: exit 7', { code: rep.code, out: rep.stdout.slice(0, 300) });
          kit.lock(root, ['release', '--run-id', id]);
          const unlocked = kit.commit(root, id, p.sha);
          check(unlocked.code === 2 && unlocked.json && unlocked.json.error === MSG.LOCK, 'without the lock the same commit exits 2, not 7 (step 1 precedes step 2)', { code: unlocked.code, out: unlocked.stdout.slice(0, 300) });
        });
      });
      await step('4.6 prepared-plan format: a pre-C2 plan and a malformed plan are refused with exit 1 and no journal; re-prepare is then allowed', async () => {
        await withScratch(context, 'pfmt', async (dir) => {
          const root = cloneBase(dir, v2, 'p');
          const id = 'run-c2-pfmt1';
          const p = runSpec(kit, root, id, {});
          check(p.ok === true, 'a schema-only plan prepares');
          if (!p.ok) return;
          const plan = p.plan;
          const withSha = (mutate) => { const m = clone(plan); mutate(m); putFile(runFile(root, id, 'plan.json'), jsonText(m)); return planShaOf(root, id); };
          const old = withSha((m) => { delete m.planSchema; });
          const r1 = kit.commit(root, id, old);
          expectF(check, 'a plan without planSchema 2', r1, { code: 'APPLY_PLAN_SCHEMA', exit: 1, error: MSG.PLAN_SCHEMA });
          const wrong = withSha((m) => { m.planSchema = 1; });
          expectF(check, 'a plan with planSchema 1', kit.commit(root, id, wrong), { code: 'APPLY_PLAN_SCHEMA', exit: 1, error: MSG.PLAN_SCHEMA });
          const bad = withSha((m) => { m.ops = 'x'; });
          expectF(check, 'a planSchema 2 plan whose ops is not a list', kit.commit(root, id, bad), { code: 'APPLY_PLAN_INVALID', exit: 1, error: MSG.PLAN_INVALID });
          const badMeta = withSha((m) => { m.metadata = null; });
          expectF(check, 'a plan with no embedded metadata block', kit.commit(root, id, badMeta), { code: 'APPLY_PLAN_INVALID', exit: 1, error: MSG.PLAN_INVALID });
          const other = withSha((m) => { m.runId = 'run-c2-someone'; });
          const r5 = kit.commit(root, id, other);
          check(r5.code === 4 && r5.json && r5.json.ok === false && r5.json.error === 'plan belongs to another run', 'a plan for another run keeps the existing refusal (exit 4)', { code: r5.code, out: r5.stdout.slice(0, 300) });
          check(!exists(runFile(root, id, 'journal.json')), 'none of the refusals created a journal');
          const re = kit.prepare(root, id);
          check(re.code === 0 && re.json && re.json.ok === true, 'prepare may run again for the same run ID', re.stdout.slice(0, 200));
          const noArg = kit.apply(root, ['commit', '--run-id', id]);
          check(noArg.code === 1 && noArg.json && noArg.json.ok === false && /--approved-plan/.test(noArg.json.error), 'commit without --approved-plan exits 1', { code: noArg.code, out: noArg.stdout.slice(0, 200) });
          rmrf(runFile(root, id, 'plan.json'));
          const noPlan = kit.commit(root, id, 'x'.repeat(64));
          check(noPlan.code === 1 && noPlan.json && noPlan.json.ok === false && /no plan\.json/.test(noPlan.json.error), 'commit without plan.json exits 1', { code: noPlan.code, out: noPlan.stdout.slice(0, 200) });
        });
      });
    }

    if (v2p) {
      await step('M10, M11, M12: unrelated, blanket and directory approvals are rejected per target; no approval ever authorizes another path', async () => {
        await withScratch(context, 'm10', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const id = 'run-c2-m10';
          const first = runSpec(kit, root, id, {});
          check(first.ok === true, 'the run exists');
          const unrelated = (t) => ({ target: t, code: 'APPLY_APPROVAL_UNRELATED', error: MSG.UNRELATED });
          expectP(check, 'M10 a path that needs no approval', kit.prepare(root, id, { approve: [DOC_API] }), [unrelated(DOC_API)]);
          expectP(check, 'M10 two unrelated approvals give two entries, sorted by target', kit.prepare(root, id, { approve: ['docs/z.md', 'docs/a.md'] }), [unrelated('docs/a.md'), unrelated('docs/z.md')]);
          for (const t of ['*', 'docs', 'docs/', 'docs/*', '.claude', '**', '.']) {
            expectP(check, `M11 approval ${show(t)}`, kit.prepare(root, id, { approve: [t] }), [unrelated(t)]);
          }
          expectP(check, 'approval names with backslashes are converted to slashes', kit.prepare(root, id, { approve: ['docs\\z.md'] }), [unrelated('docs/z.md')]);
          // no blanket authorization: a needed approval is still needed beside a rejected blanket one
          const reqs = { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } };
          const need = { target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: metaApprovalError(T_SETTINGS) };
          writeRequests(root, id, reqs);
          expectP(check, 'M11 "*" does not authorize the settings change', kit.prepare(root, id, { approve: ['*'] }), [unrelated('*'), need]);
          expectP(check, 'M11 a directory prefix does not authorize it either', kit.prepare(root, id, { approve: ['.claude'] }), [unrelated('.claude'), need]);
          expectP(check, 'M11 a glob does not authorize it', kit.prepare(root, id, { approve: ['.claude/*'] }), [unrelated('.claude/*'), need]);
          const okp = kit.prepare(root, id, { approve: [T_SETTINGS] });
          check(okp.code === 0 && okp.json && okp.json.ok === true, 'the exact path approval is accepted', okp.stdout.slice(0, 300));
          // the same path approved twice and alongside an unrelated one: each unrelated one is its own entry
          expectP(check, 'an exact approval beside an unrelated one', kit.prepare(root, id, { approve: [T_SETTINGS, 'docs/q.md'] }), [unrelated('docs/q.md')]);
          // a target already rejected for another reason gets no unrelated entry
          putDraft(root, id, 'src/x.ts', 'x\n');
          // (whether the unrelated "docs/q.md" would also be reported next to a structural rejection is not pinned, so it is not part of this case)
          expectP(check, 'an approval for a target rejected for another reason adds no unrelated entry for it', kit.prepare(root, id, { approve: [T_SETTINGS, 'src/x.ts'] }), [{ target: 'src/x.ts', code: 'APPLY_WRITE_SCOPE', error: MSG.SCOPE('src/x.ts') }]);
        });
      });
    }
    if (v3p) {
      await step('M12: an approval for identical metadata is unrelated', async () => {
        await withScratch(context, 'm12', async (dir) => {
          const root = cloneBase(dir, v3p, 'p');
          const f = baseFacts(root);
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: f.settingsRec.managed } };
          const p = runSpec(kit, root, 'run-c2-m12', { requests: reqs, o: { approve: [T_SETTINGS] } });
          expectP(check, 'M12', p.prep, [{ target: T_SETTINGS, code: 'APPLY_APPROVAL_UNRELATED', error: MSG.UNRELATED }]);
          const q = kit.prepare(root, 'run-c2-m12');
          check(q.code === 0 && q.json && q.json.metadataChanged === 0 && eq(q.json.metadataOps, []), 'without the approval the identical requests prepare with no operation', q.stdout.slice(0, 300));
        });
      });
    }
    if (plain) {
      await step('4.5 a genuine fresh no-op: an initialized empty run changes nothing and creates no manifest', async () => {
        await withScratch(context, 'fresh', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-fresh1';
          const p = runSpec(kit, root, id, {});
          expectPrepared(check, 'empty run', p, { metadataOps: [] });
          if (!p.ok) return;
          check(p.plan.manifestAfter === null && p.prep.json.changed === 0 && p.prep.json.unchanged === 0, 'an empty run has no manifestAfter', p.plan.manifestAfter);
          const lockBefore = readBytes(lockOwnerPath(root));
          const c = kit.commit(root, id, p.sha);
          check(c.code === 0 && c.stdout === jsonText(NOOP_BODY), 'the exact no-op response', c.stdout.slice(0, 200));
          check(!exists(manifestPath(root)) && !exists(runFile(root, id, 'journal.json')) && Buffer.compare(lockBefore, readBytes(lockOwnerPath(root))) === 0, 'no manifest, no journal, lock bytes unchanged');
        });
      });
      await step('4.5 approval syntax: comma-separated, whitespace trimmed, backslashes converted; both content and metadata reasons share one path approval', async () => {
        await withScratch(context, 'syn', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, 'CLAUDE.md'), '# app\n\nuser notes\n');
          putFile(projPath(root, T_SETTINGS), jsonText(R29_BASE));
          commitAll(context, root, 'user files');
          const id = 'run-c2-syn1';
          const reversed = clone(R29_BASE);
          reversed.permissions.deny.reverse();
          const spec = { drafts: { 'CLAUDE.md': '# app\n\nrewritten\n', [T_SETTINGS]: jsonText(reversed) } };
          const refused = runSpec(kit, root, id, spec);
          expectP(check, 'both targets need content approval (entries sorted: ".claude/settings.json" precedes "CLAUDE.md")', refused.prep, [
            { target: T_SETTINGS, code: 'APPLY_APPROVAL_REQUIRED', error: `draft removes or reorders existing permissions.deny entries. ${approvalSuffix(T_SETTINGS)}` },
            { target: 'CLAUDE.md', code: 'APPLY_APPROVAL_REQUIRED', error: `draft changes content outside managed blocks (pre-existing file the skill does not own). ${approvalSuffix('CLAUDE.md')}` },
          ]);
          const ok = kit.apply(root, ['prepare', '--run-id', id, '--mode', 'update', '--approve-user-content', 'CLAUDE.md, .claude\\settings.json']);
          check(ok.code === 0 && ok.json && ok.json.ok === true && ok.json.ops.length === 2 && ok.json.ops.every((o) => o.userContentChange === true), 'a comma-separated list with whitespace and backslashes is accepted', ok.stdout.slice(0, 300));
        });
      });
      await step('M22 (R29(d)): appending managed settings entries to pre-existing unrecorded settings passes strict prepare without path approval', async () => {
        await withScratch(context, 'm22', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, T_SETTINGS), jsonText(R29_BASE));
          commitAll(context, root, 'user settings');
          const id = 'run-c2-m22';
          if (!kit.begin(root, id)) return;
          const m = kit.script('merge-claude-settings', root, ['--run-id', id]);
          check(m.code === 0 && m.json && m.json.ok === true, 'the merge script writes its draft and requests', m.stdout.slice(0, 300));
          const p = kit.prepare(root, id);
          check(p.code === 0 && p.json && p.json.ok === true && p.json.ops.every((o) => !o.userContentChange), 'strict prepare succeeds with no content approval', p.stdout.slice(0, 400));
          check(p.json && p.json.metadataChanged === 0 && eq(p.json.metadataOps, []), 'the initial metadata of a written unrecorded target is no metadata operation (no extra approval)', p.json && p.json.metadataOps);
          if (!(p.json && p.json.ok)) return;
          const c = kit.commit(root, id, p.json.planSha256);
          check(c.code === 0 && c.json && c.json.committed === true, 'commit succeeds', c.stdout.slice(0, 300));
          const managed = readJson(runFile(root, id, 'managed-keys.json'));
          check(eq(settingsRecordOf(root), { ownership: 'keys', managed: managed && managed[T_SETTINGS] }), 'the keys record carries the merge script\'s managed metadata', settingsRecordOf(root));
          const written = JSON.parse(readText(projPath(root, T_SETTINGS)));
          check(eq(written.hooks, R29_BASE.hooks) && eq(written.permissions.allow, R29_BASE.permissions.allow) && eq(written.permissions.deny.slice(0, 2), R29_BASE.permissions.deny), 'the user hooks, allow list and the first denies are preserved in order', written.permissions && written.permissions.deny.slice(0, 3));
        });
      });
    }
  });
}

// ======================================================= R02/C2/diff-output ====
// Plan 6.1 (dispatch, usage, root), 6.3-6.6 (modes, output, hunks, reference text), 7.8 (diff cases and the classifier fixture), 2.1 (the
// classifier and its helper contract), 5.3 (the prepare review string).
const DIFF_KEYS = ['files', 'metadataOps', 'metadataRequests', 'ok', 'planSha256', 'prepared', 'root', 'runId', 'vault'];
// Plan 6.3: before prepare the validated requests are returned (null for a request file that is absent); after prepare metadataRequests is null.
const NO_REQUESTS = { ownership: null, managedKeys: null, omissions: null, manifestMetadata: null, transactionInputs: null };
// The legacy corpus of the moved classifier (captured from the v2 env-keys parser at 8b3f1c4: regexes, duplicates, numbering, order).
const ENV_CORPUS = ['# comment', 'export FOO=bar', 'Q1="quoted"', "Q2='single'", 'EMPTYQ=""', 'URL=postgres://user:pass@host/db', 'SECRET_KEY=', 'NAME = spaced', 'DUP=1', 'DUP=2', 'INLINE=value # trailing comment', 'PLACEHOLDER=changeme', 'HOLDER=<your-value>', 'NOEQ', '  INDENT=1', '9BAD=1', 'A.B=1', 'API_KEY=real-looking-value', 'TOK=xxxx', 'Y=your_thing', 'R=REDACTED', 'STAR=***', 'T=todo', ''];
const ENV_CORPUS_EXPECTED = [
  ['FOO', 2, 'non-placeholder'], ['Q1', 3, 'non-placeholder'], ['Q2', 4, 'non-placeholder'], ['EMPTYQ', 5, 'empty'], ['URL', 6, 'possible-real-secret'], ['SECRET_KEY', 7, 'empty'],
  ['NAME', 8, 'non-placeholder'], ['DUP', 9, 'non-placeholder'], ['DUP', 10, 'non-placeholder'], ['INLINE', 11, 'non-placeholder'], ['PLACEHOLDER', 12, 'placeholder'], ['HOLDER', 13, 'placeholder'],
  ['INDENT', 15, 'non-placeholder'], ['A.B', 17, 'non-placeholder'], ['API_KEY', 18, 'possible-real-secret'], ['TOK', 19, 'placeholder'], ['Y', 20, 'placeholder'], ['R', 21, 'placeholder'],
  ['STAR', 22, 'placeholder'], ['T', 23, 'placeholder'],
].map(([name, line, valueState]) => ({ name, line, valueState }));
// Whitespace-insensitive containment: the reference text may be wrapped differently from the plan's code block, the words may not differ.
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const REF_PARAGRAPH_1 = 'Review drafts with the apply command. It renders target-versus-draft differences in-process without invoking Git, including during root discovery. The explicit project root is checked through the filesystem. Review does not acquire or refresh a lock, create directories, write a plan, or initialize a journal.';
const REF_COMMAND = 'node <SKILL_DIR>/scripts/apply.mjs diff --project . --run-id <id>';
const REF_PARAGRAPH_2 = 'Before prepare, this is an unapproved preview. After prepare, the report identifies planSha256 and refuses changed inputs. Vault files appear only as key names and value classifications. Review metadata operations even when the affected file bytes are unchanged. Any changed input requires a new prepare and approval.';
const REF_NOOP = 'A genuine no-op has neither content writes nor metadata operations. Commit still requires this run\'s lock and rechecks the prepared inputs. It leaves project files, manifest bytes and lock bytes unchanged and creates no journal. An ownership, omission, snippet or schema change can be a metadata operation even when every content operation is unchanged. sourceCommit changes only when actual content or metadata work is committed.';
const REF_INVALID = 'If detect reports mode "invalid", repair or restore .ai/manifest.json before running prepare.';
const OLD_ZERO_DIFF = 'With unchanged inputs and skill version, a re-run produces no file changes and no manifest change.';

function expectDiffOk(check, label, r, exp) {
  check(r.code === 0 && r.stderr === '' && r.json !== null && fmtOk(r), `${label}: exit 0, empty stderr, two-space JSON with one final LF`, { code: r.code, out: r.stdout.slice(0, 300), err: r.stderr.slice(0, 200) });
  const j = r.json || {};
  check(eq(sorted(Object.keys(j)), DIFF_KEYS), `${label}: the output holds exactly the plan 6.4 fields`, Object.keys(j));
  check(j.ok === true && j.root === exp.root && j.runId === exp.runId, `${label}: ok, canonical root with POSIX separators, run ID`, { ok: j.ok, root: j.root, want: exp.root, runId: j.runId });
  check(j.prepared === exp.prepared && j.planSha256 === exp.planSha256, `${label}: prepared ${exp.prepared}, planSha256 ${exp.planSha256 === null ? 'null' : 'the plan hash'}`, { prepared: j.prepared, sha: j.planSha256 });
  if (exp.files !== undefined) check(eq(j.files, exp.files), `${label}: files`, j.files);
  if (exp.vault !== undefined) check(eq(j.vault, exp.vault), `${label}: vault`, j.vault);
  if (exp.metadataOps !== undefined) check(eq(j.metadataOps, exp.metadataOps), `${label}: metadataOps`, j.metadataOps);
  if (exp.metadataRequests !== undefined) check(eq(j.metadataRequests, exp.metadataRequests), `${label}: metadataRequests`, j.metadataRequests);
}
const classify = (text) => String(text).split(/\r?\n/).flatMap((line, i) => {
  const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/);
  if (!m) return [];
  const value = m[2].replace(/\s+#.*$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  let valueState;
  if (/^(|<[^>]*>|changeme|change_me|xxx+|your[_-].*|example.*|placeholder|todo|redacted|\*+|""|'')$/i.test(value)) valueState = value === '' ? 'empty' : 'placeholder';
  else if (/(SECRET|TOKEN|PASSWORD|PASSWD|PASS$|PRIVATE|CREDENTIAL|API_?KEY|ACCESS_?KEY|_KEY$|DSN|SALT|SIGNING|CERT)/i.test(m[1]) || /:\/\/[^/\s]*:[^@\s]+@/.test(value)) valueState = 'possible-real-secret';
  else valueState = 'non-placeholder';
  return [{ name: m[1], line: i + 1, valueState }];
});

async function diffOutput(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const lib = await needScript(failures, context, 'lib.mjs');
    const plain = await useBase(failures, 'plain', getPlainBase, context);
    const v2p = await useBase(failures, 'v2 with preserved settings', getV2pBase, context);

    await step('6.5 the restated hunk helper reproduces the literal examples of the plan', async () => {
      check(textDiff('docs/a.md', 'old\n', 'new\n') === '--- "a/docs/a.md"\n+++ "b/docs/a.md"\n@@ -1,1 +1,1 @@\n-old\n+new\n', 'modification example');
      check(textDiff('docs/a.md', null, 'new\n') === '--- /dev/null\n+++ "b/docs/a.md"\n@@ -0,0 +1,1 @@\n+new\n', 'creation example');
      check(textDiff('docs/a.md', '', 'new\n') === '--- "a/docs/a.md"\n+++ "b/docs/a.md"\n@@ -1,1 +1,1 @@\n-\n+new\n', 'existing empty target example');
      check(eq(classify(ENV_FIXTURE), ENV_EXPECTED) && eq(classify(ENV_CORPUS.join('\r\n')), ENV_CORPUS_EXPECTED), 'the restated classifier reproduces the 7.8 fixture and the captured legacy corpus');
    });
    if (lib && needFns(failures, lib, ['classifyEnvTemplate'])) {
      await step('7.8 classifyEnvTemplate: the section 7.8 fixture, the legacy corpus, the exact error for non-string input', async () => {
        const r = await attempt(() => lib.classifyEnvTemplate(ENV_FIXTURE));
        check(!r.threw && eq(r.value, ENV_EXPECTED), 'the 7.8 fixture classifies exactly', r.threw ? errMsg(r.error) : r.value);
        const crlf = await attempt(() => lib.classifyEnvTemplate(ENV_CORPUS.join('\r\n')));
        check(!crlf.threw && eq(crlf.value, ENV_CORPUS_EXPECTED), 'the legacy corpus (CRLF) keeps its regexes, duplicates, line numbers, order and classifications', crlf.threw ? errMsg(crlf.error) : crlf.value);
        const lf = await attempt(() => lib.classifyEnvTemplate(ENV_CORPUS.join('\n')));
        check(!lf.threw && eq(lf.value, ENV_CORPUS_EXPECTED), 'the same corpus with LF endings classifies the same');
        const empty = await attempt(() => lib.classifyEnvTemplate(''));
        check(!empty.threw && eq(empty.value, []), 'empty text has no entries');
        for (const bad of [null, undefined, 5, {}, [], Buffer.from('A=1')]) {
          await expectErr(check, `classifyEnvTemplate(${show(bad)})`, () => lib.classifyEnvTemplate(bad), 'ENV_TEMPLATE_TEXT', 'ENV_TEMPLATE_TEXT: text must be a string');
        }
        const a = lib.classifyEnvTemplate(ENV_FIXTURE);
        a.push({ name: 'X', line: 9, valueState: 'empty' });
        check(eq(lib.classifyEnvTemplate(ENV_FIXTURE), ENV_EXPECTED), 'results are fresh data each call');
      });
    }
    if (plain) {
      await step('2.1 env-keys.mjs uses the helper and keeps its CLI output', async () => {
        await withScratch(context, 'envk', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, '.env.example'), ENV_CORPUS.join('\r\n'));
          const r = kit.script('env-keys', root, ['keys', '--file', '.env.example']);
          check(r.code === 0 && r.json && eq(sorted(Object.keys(r.json)), ['exists', 'file', 'keys', 'ok', 'possibleRealSecrets']), 'the keys command output has its existing fields', r.stdout.slice(0, 200));
          check(r.json && eq(r.json.keys, ENV_CORPUS_EXPECTED) && eq(r.json.possibleRealSecrets, ['URL', 'API_KEY']) && r.json.file === '.env.example' && r.json.exists === true, 'its keys equal the classifier result and the secret names are unchanged', r.json && r.json.possibleRealSecrets);
          check(!r.stdout.includes('real-looking-value') && !r.stdout.includes('user:pass'), 'values are still never printed');
          check(readText(projPath(root, '.env.example')) === ENV_CORPUS.join('\r\n'), 'the template is not modified');
        });
      });
    }
    if (plain) {
      await step('6.4/6.5/7.8 unprepared review: exact hunks, labels, ordering, unchanged and null, vault classification, validated requests, read-only', async () => {
        await withScratch(context, 'dfo', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-dfo1';
          const targets = {
            'docs/a.md': 'old\n', 'docs/empty.md': '', 'docs/crlf.md': 'a\r\nb\r\n', 'docs/crlf2.md': 'a\r\nb\r\n', 'docs/bom.md': '\ufeffx\n', 'docs/multi.md': 'l1\nl2\n',
            'docs/blank.md': 'x\n', 'docs/nonl.md': 'x\n', 'docs/a b.md': 'x\n',
          };
          const drafts = {
            'docs/a.md': 'new\n', 'docs/new.md': 'new\n', 'docs/empty.md': 'new\n', 'docs/crlf.md': 'a\nb\n', 'docs/crlf2.md': 'a\nc\n', 'docs/bom.md': 'x\n', 'docs/multi.md': 'l1\nl2\nl3\n',
            'docs/blank.md': '', 'docs/nonl.md': 'x', 'docs/a b.md': 'y\n', 'docs/\u00e9.md': 'e\n', 'docs/z.md': 'z\n',
          };
          for (const [t, d] of Object.entries(targets)) putFile(projPath(root, t), d);
          const oldEnv = 'OLD=1\nOLDSECRET=hunter2hunter2\n';
          putFile(projPath(root, '.env.example'), oldEnv);
          putFile(projPath(root, 'docs/.env.template'), 'KEEP=1\nSECRET_TOKEN=abc12345\n');
          if (!kit.begin(root, id)) return;
          for (const [t, d] of Object.entries(drafts)) putDraft(root, id, t, d);
          const vault = { '.env.example': ENV_FIXTURE, 'docs/.env.sample': ENV_FIXTURE, 'docs/.env.template': 'KEEP=1\nSECRET_TOKEN=abc12345\n' };
          for (const [t, d] of Object.entries(vault)) putFile(vaultPath(root, id, t), d);
          putFile(path.join(runDirOf(root, id), 'vault', 'backup', '.env.example'), 'BACKUP-SENTINEL=never-read\n');
          writeRequests(root, id, { 'ownership.json': { 'docs/new.md': 'full' }, 'transaction-inputs.json': ['docs/consumer.md'] });
          const files = Object.keys(drafts).sort().map((t) => {
            const old = Object.prototype.hasOwnProperty.call(targets, t) ? targets[t] : null;
            const diff = textDiff(t, old, drafts[t]);
            return { target: t, action: old === null ? 'create' : diff === null ? 'unchanged' : 'modify', diff };
          });
          const classifyT = (t) => classify(t);
          const vaultExp = [
            { target: '.env.example', action: 'modify', classification: 'env-template', before: classifyT(oldEnv), after: ENV_EXPECTED },
            { target: 'docs/.env.sample', action: 'create', classification: 'env-template', before: [], after: ENV_EXPECTED },
            { target: 'docs/.env.template', action: 'unchanged', classification: 'env-template', before: classifyT('KEEP=1\nSECRET_TOKEN=abc12345\n'), after: classifyT('KEEP=1\nSECRET_TOKEN=abc12345\n') },
          ];
          const expectRoot = canonRoot(root);
          const watch = [path.join(runDirOf(root, id), 'vault', 'backup', '.env.example')];
          const guard = makeGuard(dir, watch, 'record');
          const before = projectSnapshot(root);
          const r = kit.diff(root, id, { preload: guard.file });
          expectDiffOk(check, 'unprepared diff', r, {
            root: expectRoot, runId: id, prepared: false, planSha256: null, files, vault: vaultExp, metadataOps: null,
            metadataRequests: { ownership: { 'docs/new.md': 'full' }, managedKeys: null, omissions: null, manifestMetadata: null, transactionInputs: ['docs/consumer.md'] },
          });
          check(projectSnapshot(root) === before, 'the review is read-only: the project, the run (inventory), the lock and every file are unchanged');
          check(guard.hits().length === 0, 'vault backups are never inspected for the review', guard.hits().slice(0, 2));
          const find = (t) => (r.json && Array.isArray(r.json.files) && r.json.files.find((f) => f.target === t)) || {};
          check(find('docs/a.md').diff === '--- "a/docs/a.md"\n+++ "b/docs/a.md"\n@@ -1,1 +1,1 @@\n-old\n+new\n', 'the modification hunk is the literal of plan 6.5', find('docs/a.md').diff);
          check(find('docs/new.md').diff === '--- /dev/null\n+++ "b/docs/new.md"\n@@ -0,0 +1,1 @@\n+new\n', 'the creation hunk is the literal of plan 6.5', find('docs/new.md').diff);
          check(find('docs/empty.md').diff === '--- "a/docs/empty.md"\n+++ "b/docs/empty.md"\n@@ -1,1 +1,1 @@\n-\n+new\n', 'an existing empty target changed to "new" is the literal of plan 6.5', find('docs/empty.md').diff);
          check(find('docs/crlf.md').action === 'unchanged' && find('docs/crlf.md').diff === null && find('docs/bom.md').diff === null && find('docs/nonl.md').diff === null, 'LF/CRLF, BOM and final-newline differences normalize to unchanged with a null diff');
          check(find('docs/crlf2.md').diff === '--- "a/docs/crlf2.md"\n+++ "b/docs/crlf2.md"\n@@ -1,2 +1,2 @@\n-a\n-b\n+a\n+c\n', 'a CRLF target is shown with normalized lines: all removed lines, then all added lines', find('docs/crlf2.md').diff);
          const targetsOf = (a) => (Array.isArray(a) ? a.map((f) => f.target) : null);
          check(eq(targetsOf(r.json && r.json.files), Object.keys(drafts).sort()) && eq(targetsOf(r.json && r.json.vault), ['.env.example', 'docs/.env.sample', 'docs/.env.template']), 'files and vault are sorted by target in JavaScript string order');
          check(find('docs/a b.md').diff === textDiff('docs/a b.md', 'x\n', 'y\n') && find('docs/\u00e9.md').diff === `--- /dev/null\n+++ ${JSON.stringify('b/docs/\u00e9.md')}\n@@ -0,0 +1,1 @@\n+e\n`, 'labels are JSON-quoted (a space, a non-ASCII name)');
          // Output hygiene: no vault value, no hash, no timestamp, no absolute path other than the root, no source path.
          for (const secret of ['fixture-value', '<value>', '3000', 'hunter2hunter2', 'abc12345', 'BACKUP-SENTINEL']) check(!r.stdout.includes(secret), `the output never contains ${show(secret)}`);
          check(!/[0-9a-f]{64}/.test(r.stdout) && !/\d{4}-\d{2}-\d{2}T\d/.test(r.stdout), 'no content hash and no timestamp in an unprepared review');
          check(!r.stdout.split(expectRoot).join('').includes(toPosix(context.tmp)) && !/[A-Za-z]:[\\/]/.test(r.stdout.split(expectRoot).join('')), 'no absolute path other than the root', r.stdout.slice(0, 200));
          // cwd and --project spellings: the same output from another cwd, with "." and with a relative path
          const other = kit.diff(root, id, { cwd: dir });
          check(other.stdout === r.stdout, 'an absolute --project from another cwd gives the same output');
          const dot = kit.diff(root, id, { project: '.' });
          check(dot.stdout === r.stdout, '"." as the root gives the same output');
          const rel = kit.diff(root, id, { cwd: path.dirname(root), project: path.basename(root) });
          check(rel.stdout === r.stdout, 'a relative --project resolves against the cwd');
        });
      });
      await step('6.3 prepared review: the plan hash it read, embedded metadataOps, null requests, the same file reports', async () => {
        await withScratch(context, 'dfp', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          putFile(projPath(root, 'docs/same.md'), 'same\n');
          putFile(projPath(root, 'docs/.env.template'), 'KEEP=1\n');
          const id = 'run-c2-dfp1';
          const drafts = { 'docs/new1.md': '# one\n', 'docs/new2.md': '# two\n', 'docs/same.md': 'same\n' };
          const vault = { 'docs/.env.sample': ENV_FIXTURE, 'docs/.env.template': 'KEEP=1\n' };
          const p = runSpec(kit, root, id, { drafts, vault });
          check(p.ok === true, 'prepare succeeds', p.prep && p.prep.stdout.slice(0, 300));
          if (!p.ok) return;
          const files = [['docs/new1.md', null], ['docs/new2.md', null], ['docs/same.md', 'same\n']].map(([t, old]) => ({ target: t, action: old === null ? 'create' : 'unchanged', diff: textDiff(t, old, drafts[t]) }));
          const vaultExp = [
            { target: 'docs/.env.sample', action: 'create', classification: 'env-template', before: [], after: ENV_EXPECTED },
            { target: 'docs/.env.template', action: 'unchanged', classification: 'env-template', before: classify('KEEP=1\n'), after: classify('KEEP=1\n') },
          ];
          const before = projectSnapshot(root);
          const r = kit.diff(root, id);
          expectDiffOk(check, 'prepared diff', r, { root: canonRoot(root), runId: id, prepared: true, planSha256: p.sha, files, vault: vaultExp, metadataOps: p.plan.metadataOps, metadataRequests: null });
          check(r.json && r.json.planSha256 === planShaOf(root, id), 'planSha256 is the SHA-256 of the plan.json it read');
          check(projectSnapshot(root) === before, 'a prepared review is read-only too');
          check(r.json && eq(r.json.metadataOps, []), 'a plan without metadata operations embeds an empty list (not null)', r.json && r.json.metadataOps);
        });
      });
    }
    if (v2p) {
      await step('6.3/7.8 metadata review: embedded operations after prepare, validated requests before, and no invented content diff for a metadata-only run', async () => {
        await withScratch(context, 'dfm', async (dir) => {
          const root = cloneBase(dir, v2p, 'p');
          const f = baseFacts(root);
          const id = 'run-c2-dfm1';
          const reqs = { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } };
          const p = runSpec(kit, root, id, { requests: reqs, o: { approve: [T_SETTINGS] } });
          check(p.ok === true, 'a metadata-only run prepares', p.prep && p.prep.stdout.slice(0, 300));
          if (!p.ok) return;
          const pre = clone(p.plan);
          // before prepare the same requests are returned as validated data (a fresh run without a plan)
          const root2 = cloneBase(dir, v2p, 'q');
          const id2 = 'run-c2-dfm2';
          if (!kit.begin(root2, id2)) return;
          writeRequests(root2, id2, reqs);
          const un = kit.diff(root2, id2);
          expectDiffOk(check, 'metadata-only unprepared', un, { root: canonRoot(root2), runId: id2, prepared: false, planSha256: null, files: [], vault: [], metadataOps: null, metadataRequests: { ownership: reqs['ownership.json'], managedKeys: reqs['managed-keys.json'], omissions: reqs['omissions.json'], manifestMetadata: null, transactionInputs: null } });
          const pr = kit.diff(root, id);
          expectDiffOk(check, 'metadata-only prepared', pr, { root: canonRoot(root), runId: id, prepared: true, planSha256: p.sha, files: [], vault: [], metadataOps: pre.metadataOps, metadataRequests: null });
          check(pr.json && Array.isArray(pr.json.metadataOps) && pr.json.metadataOps.length === 2 && pr.json.metadataOps[0].requiresApproval === true,'both metadata operations are shown for review, the first needing approval', pr.json && pr.json.metadataOps);
          // an unchanged draft of the settings keeps a files entry (no content diff) beside the metadata operation
          const root3 = cloneBase(dir, v2p, 'r');
          const id3 = 'run-c2-dfm3';
          const p3 = runSpec(kit, root3, id3, { drafts: { [T_SETTINGS]: PRESERVE_BYTES }, requests: reqs, o: { approve: [T_SETTINGS] } });
          check(p3.ok === true, 'an unchanged settings draft plus metadata prepares', p3.prep && p3.prep.stdout.slice(0, 300));
          if (p3.ok) {
            const r3 = kit.diff(root3, id3);
            expectDiffOk(check, 'unchanged draft plus metadata', r3, { root: canonRoot(root3), runId: id3, prepared: true, planSha256: p3.sha, files: [{ target: T_SETTINGS, action: 'unchanged', diff: null }], vault: [], metadataOps: p3.plan.metadataOps, metadataRequests: null });
          }
        });
      });
    }
    if (plain) {
      await step('7.8 an initialized empty run returns empty arrays; a missing run fails without being created; the root context', async () => {
        await withScratch(context, 'dfe', async (dir) => {
          const root = cloneBase(dir, plain, 'p');
          const id = 'run-c2-dfe1';
          if (!kit.begin(root, id)) return;
          const before = projectSnapshot(root);
          const r = kit.diff(root, id);
          expectDiffOk(check, 'empty run', r, { root: canonRoot(root), runId: id, prepared: false, planSha256: null, files: [], vault: [], metadataOps: null, metadataRequests: NO_REQUESTS });
          check(projectSnapshot(root) === before, 'an empty review changes nothing');
          // the review needs no lock: without this run's lock it still succeeds and takes none
          const lockedState = kit.lock(root, ['release', '--run-id', id]);
          check(lockedState.code === 0, 'the run lock is released for the lock-free review');
          const unlocked = kit.diff(root, id);
          expectDiffOk(check, 'review without a lock', unlocked, { root: canonRoot(root), runId: id, prepared: false, planSha256: null, files: [], vault: [], metadataOps: null, metadataRequests: NO_REQUESTS });
          check(!exists(path.join(root, '.ai', '.setup.lock')), 'the review created no lock');
          const beforeMissing = projectSnapshot(root);
          // a missing run (with an unrelated run present) is not created
          const miss = kit.diff(root, 'run-c2-nope');
          expectF(check, 'missing run', miss, { code: 'APPLY_RUN_MISSING', exit: 2, error: MSG.RUN_MISSING('run-c2-nope') });
          check(projectSnapshot(root) === beforeMissing && !exists(runDirOf(root, 'run-c2-nope')), 'the missing run was not created');
          const bare = cloneBase(dir, plain, 'bare');
          const missBare = kit.diff(bare, 'run-c2-nope');
          expectF(check, 'missing run in a project with no .ai', missBare, { code: 'APPLY_RUN_MISSING', exit: 2, error: MSG.RUN_MISSING('run-c2-nope') });
          check(!exists(path.join(bare, '.ai')), 'no .ai directory was created');
          // the explicit root (6.1)
          const notDir = kit.diff(root, id, { project: path.join(dir, 'does-not-exist') });
          expectF(check, 'a root that does not exist', notDir, { code: 'APPLY_ROOT', exit: 2, error: MSG.ROOT });
          putFile(path.join(dir, 'a-file'), 'x');
          expectF(check, 'a root that is a file', kit.diff(root, id, { project: path.join(dir, 'a-file') }), { code: 'APPLY_ROOT', exit: 2, error: MSG.ROOT });
          const rootLink = path.join(dir, 'root-link');
          if (linkDir(root, rootLink)) {
            expectF(check, 'a root that is a junction or symlink', kit.diff(root, id, { project: rootLink }), { code: 'APPLY_ROOT', exit: 2, error: MSG.ROOT });
          } else check(false, 'a junction (a directory symlink off Windows) could be created for the root case');
          // an ancestor alias is resolved by the native realpath; links below the root stay rejected
          const holder = path.join(dir, 'holder');
          fs.mkdirSync(holder);
          cloneTree(root, path.join(holder, 'real-root'));
          const alias = path.join(dir, 'alias');
          if (linkDir(holder, alias)) {
            const viaAlias = kit.diff(root, id, { project: path.join(alias, 'real-root') });
            expectDiffOk(check, 'an ancestor alias of the root', viaAlias, { root: canonRoot(path.join(holder, 'real-root')), runId: id, prepared: false, planSha256: null, files: [], vault: [], metadataOps: null, metadataRequests: NO_REQUESTS });
          } else check(false, 'a junction (a directory symlink off Windows) could be created for the ancestor-alias case');
          // usage: both options exactly once with string values and a valid run ID; nothing else
          const usage = (label, args) => {
            const u = kit.apply(root, args);
            expectF(check, `usage: ${label}`, u, { code: 'APPLY_DIFF_USAGE', exit: 1, error: MSG.DIFF_USAGE });
          };
          usage('no options', ['diff']);
          usage('missing --run-id', ['diff', '--project', root]);
          usage('missing --project', ['diff', '--run-id', id]);
          usage('a duplicated --project', ['diff', '--project', root, '--project', root, '--run-id', id]);
          usage('a duplicated --run-id', ['diff', '--project', root, '--run-id', id, '--run-id', id]);
          usage('an unknown option', ['diff', '--project', root, '--run-id', id, '--extra', 'x']);
          usage('an unknown flag', ['diff', '--project', root, '--run-id', id, '--verbose']);
          usage('a missing value for --run-id', ['diff', '--project', root, '--run-id']);
          usage('a missing value for --project', ['diff', '--project', '--run-id', id]);
          usage('an extra positional', ['diff', 'extra', '--project', root, '--run-id', id]);
          usage('a trailing positional', ['diff', '--project', root, '--run-id', id, 'extra']);
          for (const bad of ['..', 'x', '../escape', 'a/b', '.hidden', '-lead']) usage(`the invalid run ID ${show(bad)}`, ['diff', '--project', root, '--run-id', bad]);
          check(projectSnapshot(root) === beforeMissing, 'usage failures create nothing');
        });
      });
    }
    // 6.6 and the C2-P3-8 line: reference text, whitespace-insensitively
    await step('6.6 references/state-and-apply.md carries the review paragraph, the command, the follow-up, the no-op paragraph and the invalid-mode line', async () => {
      const text = readText(path.join(context.skillRoot, 'references', 'state-and-apply.md'));
      if (text === null) { check(false, 'references/state-and-apply.md is readable'); return; }
      const s = squash(text);
      check(s.includes(squash(REF_PARAGRAPH_1)), 'the review paragraph');
      check(text.split('\n').some((l) => l.trim() === REF_COMMAND), 'the command line (on its own line)');
      check(s.includes(squash(REF_PARAGRAPH_2)), 'the paragraph that follows the command');
      check(s.includes(squash(REF_NOOP)), 'the zero-diff paragraph is replaced by the genuine no-op paragraph');
      check(!s.includes(squash(OLD_ZERO_DIFF)), 'the old zero-diff sentence is gone');
      check(s.includes(squash(REF_INVALID)), 'the line about detect mode "invalid" (C2-P3-8)');
    });
  });
}

// ================================================================ R02/C2/no-git ====
// Plan 6.1 and 7.3: a failing, recording git first on PATH; the control proves the shim intercepts; the diff must succeed with zero records.
const PROBE_ROOT_SOURCE = (libUrl) => [
  `import fs from 'node:fs';`,
  `import path from 'node:path';`,
  `import * as lib from ${JSON.stringify(libUrl)};`,
  'const cases = JSON.parse(process.argv[2]);',
  'const out = {};',
  'const val = (c) => (c.kind === "undefined" ? undefined : c.kind === "null" ? null : c.kind === "number" ? 5 : c.kind === "object" ? {} : c.value);',
  'for (const c of cases) {',
  '  try { out[c.name] = { ok: lib.setFilesystemRoot(val(c)) }; } catch (e) { out[c.name] = { threw: true, isError: e instanceof Error, code: Object.prototype.hasOwnProperty.call(e, "code") ? e.code : null, message: e.message }; }',
  '}',
  'const extra = {};',
  'if (process.argv[3]) {',
  '  const root = lib.setFilesystemRoot(process.argv[3]);',
  '  extra.root = root;',
  '  try { extra.dir = lib.secureDir(root, [".ai", ".run", "x"]); } catch (e) { extra.dirError = e.message; }',
  '  try { extra.nested = lib.secureDir(root, ["docs", "nested"]); } catch (e) { extra.nestedError = e.message; }',
  '  try { extra.created = lib.secureDir(root, [".ai", ".made"], { create: true }); } catch (e) { extra.createdError = e.message; }',
  '  try { extra.linked = lib.secureDir(root, ["linked"]); } catch (e) { extra.linkedError = e.message; }',
  '  try { extra.read = lib.readInRepo(root, "docs/nested/a.md").toString("utf8"); } catch (e) { extra.readError = e.message; }',
  '}',
  'process.stdout.write(JSON.stringify({ out, extra }) + "\\n");',
].join('\n') + '\n';

async function noGit(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const plain = await useBase(failures, 'plain', getPlainBase, context);
    if (!plain) return;
    await withScratch(context, 'nogit', async (dir) => {
      const shim = makeGitShim(context, dir);
      const control = (label, cwd) => {
        shim.clear();
        const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, env: shim.env, shell: false, windowsHide: true, encoding: 'utf8' });
        check(r.status === 91, `${label}: the shell-free control invocation of git exits 91 (the shim intercepts it)`, { status: r.status, error: r.error && r.error.code });
        check(shim.records().length === 1, `${label}: the control produced exactly one invocation record`, shim.records());
        shim.clear();
        check(shim.records().length === 0, `${label}: the record is cleared`);
      };
      control('before the review', dir);

      // fixture: a root containing spaces, no .git, nested draft paths, a lock held by the run
      const holder = path.join(dir, 'with spaces here');
      fs.mkdirSync(holder);
      const root = cloneBase(holder, plain, 'project root');
      const id = 'run-c2-ng001';
      putFile(projPath(root, 'docs/nested/a.md'), 'old\n');
      if (!kit.begin(root, id)) return;
      putDraft(root, id, 'docs/nested/a.md', 'new\n');
      putDraft(root, id, 'docs/new.md', '# new\n');
      putFile(vaultPath(root, id, 'docs/.env.sample'), ENV_FIXTURE);
      const preparedRoot = cloneBase(holder, root, 'prepared root');
      // docs/nested/a.md is a pre-existing file the skill does not own: replacing it needs the existing content approval
      const p = kit.prepare(preparedRoot, id, { approve: ['docs/nested/a.md'] });
      check(p.code === 0 && p.json && p.json.ok === true, 'a prepared copy exists (prepared with real git before .git is removed)', p.stdout.slice(0, 200));
      for (const r of [root, preparedRoot]) rmrf(path.join(r, '.git'));
      check(!exists(path.join(root, '.git')) && !exists(path.join(preparedRoot, '.git')), 'the roots have no .git');

      const wantFiles = [
        { target: 'docs/nested/a.md', action: 'modify', diff: textDiff('docs/nested/a.md', 'old\n', 'new\n') },
        { target: 'docs/new.md', action: 'create', diff: textDiff('docs/new.md', null, '# new\n') },
      ];
      const wantVault = [{ target: 'docs/.env.sample', action: 'create', classification: 'env-template', before: [], after: ENV_EXPECTED }];
      const run = (label, project, cwd, rootDir, prepared) => {
        shim.clear();
        const before = snapshotTree(rootDir);
        const lockBefore = readBytes(lockOwnerPath(rootDir));
        // the original absolute Node executable, the shim environment
        const r = execNode(context, { cwd, script: kit.scripts('apply'), args: ['diff', '--project', project, '--run-id', id], env: shim.env });
        check(!r.dead, `${label}: the diff ran`, r.dead);
        expectDiffOk(check, label, r, { root: canonRoot(rootDir), runId: id, prepared, planSha256: prepared ? p.json && p.json.planSha256 : null, files: wantFiles, vault: wantVault, metadataOps: prepared ? [] : null, metadataRequests: prepared ? null : NO_REQUESTS });
        check(shim.records().length === 0, `${label}: zero Git invocations (including secure traversal through drafts/docs/nested/a.md)`, shim.records());
        check(snapshotTree(rootDir) === before && Buffer.compare(lockBefore, readBytes(lockOwnerPath(rootDir))) === 0, `${label}: root, run and lock state are unchanged`);
      };
      await step('7.3 an absolute root with spaces, no .git, from another cwd', async () => run('absolute root from another cwd', root, dir, root, false));
      await step('7.3 "." as the root with the cwd inside the project', async () => run('dot root', '.', root, root, false));
      await step('7.3 a prepared review in a root without .git', async () => run('prepared review', preparedRoot, dir, preparedRoot, true));
      control('after the reviews', dir);

      // lib.setFilesystemRoot and secureDir under the same shim
      await step('6.1 setFilesystemRoot: returns the canonical native path, rejects unsafe roots with APPLY_ROOT, and secureDir then needs no Git', async () => {
        const libUrl = scriptUrl(context, 'lib.mjs');
        const probe = path.join(dir, 'probe-root.mjs');
        fs.writeFileSync(probe, PROBE_ROOT_SOURCE(libUrl));
        const ok1 = path.join(dir, 'ok-root');
        fs.mkdirSync(path.join(ok1, '.ai', '.run', 'x'), { recursive: true });
        fs.mkdirSync(path.join(ok1, 'docs', 'nested'), { recursive: true });
        putFile(path.join(ok1, 'docs', 'nested', 'a.md'), 'NESTED-BODY\n');
        const linkTarget = path.join(dir, 'link-target');
        fs.mkdirSync(linkTarget);
        const jLink = path.join(dir, 'junction-root');
        const inLink = path.join(ok1, 'linked');
        const okLinks = linkDir(linkTarget, jLink) && linkDir(linkTarget, inLink);
        check(okLinks, 'junctions (directory symlinks off Windows) could be created for the root probes');
        const aliasHolder = path.join(dir, 'alias-holder');
        fs.mkdirSync(path.join(aliasHolder, 'inner'), { recursive: true });
        const aliasLink = path.join(dir, 'alias-link');
        const aliasOk = linkDir(aliasHolder, aliasLink);
        putFile(path.join(dir, 'plain-file'), 'x');
        const cases = [
          { name: 'absolute', kind: 'string', value: ok1 }, { name: 'dot', kind: 'string', value: '.' }, { name: 'relative', kind: 'string', value: 'ok-root' },
          { name: 'empty', kind: 'string', value: '' }, { name: 'undefined', kind: 'undefined' }, { name: 'null', kind: 'null' }, { name: 'number', kind: 'number' }, { name: 'object', kind: 'object' },
          { name: 'missing', kind: 'string', value: path.join(dir, 'missing-dir') }, { name: 'file', kind: 'string', value: path.join(dir, 'plain-file') },
          { name: 'junction', kind: 'string', value: jLink }, { name: 'ancestor-alias', kind: 'string', value: path.join(aliasLink, 'inner') },
        ];
        shim.clear();
        const r = execNode(context, { cwd: dir, script: probe, args: [JSON.stringify(cases), ok1], env: shim.env });
        check(!r.dead && r.code === 0 && r.json, 'the probe ran', { code: r.code, dead: r.dead, err: r.stderr.slice(0, 300), out: r.stdout.slice(0, 300) });
        if (!r.json) return;
        const o = r.json.out;
        const real = (p) => fs.realpathSync.native(p);
        check(o.absolute && o.absolute.ok === real(ok1), 'an existing directory returns its canonical absolute native path', o.absolute);
        check(o.dot && o.dot.ok === real(dir), '"." resolves against the cwd', o.dot);
        check(o.relative && o.relative.ok === real(ok1), 'a relative path resolves against the cwd', o.relative);
        for (const name of ['empty', 'undefined', 'null', 'number', 'object', 'missing', 'file', 'junction']) {
          const e = o[name];
          check(e && e.threw === true && e.isError === true && e.code === 'APPLY_ROOT' && e.message === `APPLY_ROOT: ${MSG.ROOT}`, `${name}: APPLY_ROOT with the exact message`, e);
        }
        if (aliasOk) check(o['ancestor-alias'] && o['ancestor-alias'].ok === real(path.join(aliasHolder, 'inner')), 'an ancestor alias is resolved by the native realpath', o['ancestor-alias']);
        else check(false, 'a junction (a directory symlink off Windows) could be created for the ancestor-alias probe');
        const x = r.json.extra;
        check(x.root === real(ok1), 'the established root is the canonical native path', x.root);
        check(x.dir === path.join(real(ok1), '.ai', '.run', 'x'), 'secureDir then resolves from the explicit root', x);
        check(x.nested === path.join(real(ok1), 'docs', 'nested') && x.read === 'NESTED-BODY\n', 'a nested traversal and a safe read work without any Git lookup', x);
        check(x.created === path.join(real(ok1), '.ai', '.made') && exists(path.join(ok1, '.ai', '.made')), 'secureDir can still create below the established root', x);
        check(typeof x.linkedError === 'string' && /link or junction rejected: linked/.test(x.linkedError), 'a link below the established root is still rejected', x);
        check(shim.records().length === 0, 'setFilesystemRoot and secureDir invoked no Git', shim.records());
      });
    });
  });
}

// ==================================================== R02/C2/diff-safety ====
// Plan 6.2 (inventory and secret refusal, D2), 7.8 (D2 cases) and 7.9 (the safety/error matrix, for diff and for prepare), including the
// unread-body requirements (read-recording preloads) and the unchanged-state requirements (outside sentinels, run inventory, lock/project bytes).
const POLICY_BAD_GLOB = jsonText({ schema: 2, patterns: [{ anchor: 'root', glob: 'a**b' }], projectPatterns: [] });
const POLICY_PRIVATE = jsonText({ schema: 2, patterns: [], projectPatterns: [{ anchor: 'root', glob: 'docs/private/**' }] });
const POLICY_DRAFTED = jsonText({ schema: 2, patterns: [], projectPatterns: [{ anchor: 'root', glob: 'docs/drafted/**' }] });
const UNSAFE_PATH = /^unsafe path: [^\\:]+$/; // PLAN-GAP: 5.2 gives "<path>" without saying which path; only a project-relative POSIX path is pinned.
const fF = (code, exit, error, extra = []) => (check, label, r) => expectF(check, label, r, { code, exit, error, extra });
const pP = (entries) => (check, label, r) => expectP(check, label, r, entries);
const unsafeF = (exit) => (check, label, r) => {
  expectF(check, label, r, { code: 'APPLY_PATH', exit, error: UNSAFE_PATH });
  check(!(r.tmp && r.json && String(r.json.error).includes(toPosix(r.tmp))), `${label}: the path is relative to the project root, never absolute`, r.json && r.json.error);
};

async function diffSafety(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const plain = await useBase(failures, 'plain', getPlainBase, context);
    if (!plain) return;
    await withScratch(context, 'saf', async (dir) => {
      let n = 0;
      const junction = (target, link, what) => { const ok = linkDir(target, link); check(ok, `${what}: a junction (a directory symlink off Windows) could be created`); return ok; };
      // One row of the matrix: a fresh project, a run, the stimulus; then diff and prepare, each with a read recorder and state comparisons.
      const row = (label, spec) => {
        const root = cloneBase(dir, plain, `row${++n}`);
        const id = spec.id || 'run-c2-saf1';
        if (!spec.noBegin && !kit.begin(root, id)) return;
        const built = spec.build ? (spec.build(root, id) || {}) : {};
        const forbid = built.forbid || [];
        const outside = built.outside || [];
        const snap = () => JSON.stringify([projectSnapshot(root), ...outside.map((d) => snapshotTree(d))]);
        const before = snap();
        const guard = (watch) => (built.failRead ? makeGuard(dir, built.failRead, 'fail') : makeGuard(dir, watch, 'record'));
        // diff
        const g1 = guard(forbid);
        const rd = kit.diff(root, spec.diffId || id, { preload: g1.file });
        rd.tmp = context.tmp;
        spec.diff(check, `${label} (diff)`, rd, built);
        if (!built.failRead) check(g1.hits().length === 0, `${label} (diff): no forbidden body was read`, g1.hits().slice(0, 3));
        check(snap() === before, `${label} (diff): the project, the run inventory, the lock bytes and the outside sentinels are unchanged`);
        // prepare
        const g2 = guard(forbid);
        const rp = kit.prepare(root, spec.prepId || spec.diffId || id, { preload: g2.file });
        rp.tmp = context.tmp;
        spec.prepare(check, `${label} (prepare)`, rp, built);
        if (!built.failRead) check(g2.hits().length === 0, `${label} (prepare): no forbidden body was read`, g2.hits().slice(0, 3));
        if (spec.prepareFails !== false) check(snap() === before, `${label} (prepare): nothing changed`);
        return { root, id, built };
      };
      const draftOf = (root, id, rel) => draftPath(root, id, rel);
      const sentinel = (p, text) => { putFile(p, text); return p; };

      await step('7.9 unsafe paths: a junction in a draft path, a linked source or target leaf, a run replaced after prepare: APPLY_PATH, exit 2, F, for both commands', async () => {
        row('a junction at drafts/docs/nested', {
          build: (root, id) => {
            const out = path.join(dir, `out-${++n}`);
            const outFile = sentinel(path.join(out, 'a.md'), 'OUTSIDE-SENTINEL\n');
            const target = sentinel(projPath(root, 'docs/nested/a.md'), 'TARGET-SENTINEL\n');
            fs.mkdirSync(path.join(runDirOf(root, id), 'drafts', 'docs'), { recursive: true });
            const link = path.join(runDirOf(root, id), 'drafts', 'docs', 'nested');
            junction(out, link, 'drafts/docs/nested');
            return { forbid: [outFile, path.join(link, 'a.md'), target], outside: [out] };
          },
          diff: unsafeF(2), prepare: unsafeF(2),
        });
        row('a junction as the source leaf', {
          build: (root, id) => {
            const out = path.join(dir, `out-${++n}`);
            fs.mkdirSync(out, { recursive: true });
            const body = sentinel(path.join(out, 'inner.md'), 'OUTSIDE-SENTINEL\n');
            fs.mkdirSync(path.join(runDirOf(root, id), 'drafts', 'docs'), { recursive: true });
            junction(out, path.join(runDirOf(root, id), 'drafts', 'docs', 'leaf'), 'the source leaf');
            return { forbid: [body], outside: [out] };
          },
          diff: unsafeF(2), prepare: unsafeF(2),
        });
        row('a junction as the target leaf', {
          build: (root, id) => {
            const out = path.join(dir, `out-${++n}`);
            fs.mkdirSync(out, { recursive: true });
            fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
            junction(out, projPath(root, 'docs/tleaf'), 'the target leaf');
            const d = sentinel(draftOf(root, id, 'docs/tleaf'), 'DRAFT-SENTINEL\n');
            return { forbid: [d, projPath(root, 'docs/tleaf')], outside: [out] };
          },
          diff: unsafeF(2), prepare: unsafeF(2),
        });
        // optional file-symlink subcases: not exercised where the privilege is missing, never a substitute for the junction cases above
        const probeLink = path.join(dir, 'probe-file-link');
        const canFileLink = linkFile(path.join(dir, 'probe-file-target'), probeLink);
        if (canFileLink) {
          dropLink(probeLink);
          row('a file symlink as the source leaf', {
            build: (root, id) => {
              const out = sentinel(path.join(dir, `out-${++n}.md`), 'OUTSIDE-SENTINEL\n');
              fs.mkdirSync(path.join(runDirOf(root, id), 'drafts', 'docs'), { recursive: true });
              linkFile(out, path.join(runDirOf(root, id), 'drafts', 'docs', 'fl.md'));
              return { forbid: [out], outside: [] };
            },
            diff: unsafeF(2), prepare: unsafeF(2),
          });
          row('a file symlink as the target leaf', {
            build: (root, id) => {
              const out = sentinel(path.join(dir, `out-${++n}.md`), 'OUTSIDE-SENTINEL\n');
              fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
              linkFile(out, projPath(root, 'docs/tl.md'));
              const d = sentinel(draftOf(root, id, 'docs/tl.md'), 'DRAFT-SENTINEL\n');
              return { forbid: [out, d], outside: [] };
            },
            diff: unsafeF(2), prepare: unsafeF(2),
          });
        }
        row('the run directory replaced by a junction after prepare', {
          build: (root, id) => {
            putFile(projPath(root, 'docs/a.md'), 'TARGET-SENTINEL\n');
            putDraft(root, id, 'docs/a.md', 'DRAFT-SENTINEL\n');
            const p = kit.prepare(root, id, { approve: ['docs/a.md'] });
            check(p.code === 0, 'the run prepares before it is replaced', p.stdout.slice(0, 200));
            const out = path.join(dir, `out-run-${++n}`);
            fs.renameSync(runDirOf(root, id), out);
            junction(out, runDirOf(root, id), 'the run directory');
            return { forbid: [path.join(out, 'drafts', 'docs', 'a.md'), projPath(root, 'docs/a.md')], outside: [out] };
          },
          diff: unsafeF(2), prepare: unsafeF(2),
        });
      });
      await step('7.9 run lookups: a missing run and a wrong run ID (no candidate body is read), an invalid run ID', async () => {
        row('a missing run', { noBegin: true, id: 'run-c2-nope', diff: fF('APPLY_RUN_MISSING', 2, MSG.RUN_MISSING('run-c2-nope')), prepare: (check2, label, r) => {
          check2(r.code === 1 && r.json && r.json.ok === false && r.json.error === MSG.RUN_MISSING('run-c2-nope') && r.stderr === '', `${label}: the existing missing-run error, exit 1`, { code: r.code, out: r.stdout.slice(0, 200) });
        } });
        row('a wrong run ID with another run present', {
          id: 'run-c2-other', diffId: 'run-c2-nope',
          build: (root, id) => {
            const t = sentinel(projPath(root, 'docs/a.md'), 'TARGET-SENTINEL\n');
            const d = sentinel(draftOf(root, id, 'docs/a.md'), 'DRAFT-SENTINEL\n');
            return { forbid: [t, d], outside: [] };
          },
          diff: fF('APPLY_RUN_MISSING', 2, MSG.RUN_MISSING('run-c2-nope')),
          prepare: (check2, label, r) => check2(r.code === 1 && r.json && r.json.ok === false && r.json.error === MSG.RUN_MISSING('run-c2-nope'), `${label}: the existing missing-run error, exit 1`, { code: r.code, out: r.stdout.slice(0, 200) }),
        });
        row('an invalid run ID', {
          diffId: '../x',
          diff: fF('APPLY_DIFF_USAGE', 1, MSG.DIFF_USAGE),
          prepare: (check2, label, r) => {
            check2(r.code === 1 && r.json && r.json.ok === false && /^invalid run id /.test(r.json.error) && !hasOwn(r.json, 'code') && r.stderr === '', `${label}: the existing invalid-run-ID error (exit 1, no added code)`, { code: r.code, out: r.stdout.slice(0, 200) });
          },
        });
      });
      await step('7.9 scope, write denial, duplicates, the drafted manifest, vault eligibility, non-regular targets', async () => {
        row('a draft outside the write scope', {
          build: (root, id) => ({ forbid: [sentinel(projPath(root, 'src/x.ts'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, 'src/x.ts'), 'DRAFT-SENTINEL\n')] }),
          diff: fF('APPLY_WRITE_SCOPE', 3, MSG.SCOPE('src/x.ts')), prepare: pP([{ target: 'src/x.ts', code: 'APPLY_WRITE_SCOPE', error: MSG.SCOPE('src/x.ts') }]),
        });
        row('an explicitly write-denied target', {
          build: (root, id) => ({ forbid: [sentinel(projPath(root, '.claude/settings.local.json'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, '.claude/settings.local.json'), 'DRAFT-SENTINEL\n')] }),
          diff: fF('APPLY_WRITE_DENIED', 3, MSG.DENIED('.claude/settings.local.json')), prepare: pP([{ target: '.claude/settings.local.json', code: 'APPLY_WRITE_DENIED', error: MSG.DENIED('.claude/settings.local.json') }]),
        });
        row('the same target in drafts and vault', {
          build: (root, id) => ({ forbid: [sentinel(projPath(root, '.env.example'), 'TARGET-SENTINEL=1\n'), sentinel(draftOf(root, id, '.env.example'), 'DRAFT-SENTINEL=1\n'), sentinel(vaultPath(root, id, '.env.example'), 'VAULT-SENTINEL=1\n')] }),
          diff: fF('APPLY_DUPLICATE_TARGET', 3, MSG.DUP), prepare: pP([{ target: '.env.example', code: 'APPLY_DUPLICATE_TARGET', error: MSG.DUP }]),
        });
        row('a drafted manifest', {
          build: (root, id) => ({ forbid: [sentinel(draftOf(root, id, '.ai/manifest.json'), '{"DRAFT":"SENTINEL"}\n')] }),
          diff: fF('APPLY_MANIFEST_DRAFT', 3, MSG.MANIFEST_DRAFT), prepare: pP([{ target: T_MANIFEST, code: 'APPLY_MANIFEST_DRAFT', error: MSG.MANIFEST_DRAFT }]),
        });
        row('a vault file for a non-template target', {
          build: (root, id) => ({ forbid: [sentinel(projPath(root, 'docs/x.md'), 'TARGET-SENTINEL\n'), sentinel(vaultPath(root, id, 'docs/x.md'), 'VAULT-SENTINEL\n')] }),
          diff: fF('APPLY_VAULT_TARGET', 3, MSG.VAULT_TARGET), prepare: pP([{ target: 'docs/x.md', code: 'APPLY_VAULT_TARGET', error: MSG.VAULT_TARGET }]),
        });
        row('a target that is not a regular file', {
          build: (root, id) => { fs.mkdirSync(projPath(root, 'docs/dir.md'), { recursive: true }); return { forbid: [sentinel(draftOf(root, id, 'docs/dir.md'), 'DRAFT-SENTINEL\n'), projPath(root, 'docs/dir.md')] }; },
          diff: fF('APPLY_TARGET_TYPE', 3, MSG.TARGET_TYPE), prepare: pP([{ target: 'docs/dir.md', code: 'APPLY_TARGET_TYPE', error: MSG.TARGET_TYPE }]),
        });
        // prepare reports several affected targets in JavaScript string order, one entry each
        const root = cloneBase(dir, plain, `row${++n}`);
        if (kit.begin(root, 'run-c2-saf1')) {
          putDraft(root, 'run-c2-saf1', 'src/x.ts', 'x\n');
          putDraft(root, 'run-c2-saf1', '.claude/settings.local.json', '{}\n');
          putDraft(root, 'run-c2-saf1', 'docs/ok.md', '# ok\n');
          expectP(check, 'several affected targets', kit.prepare(root, 'run-c2-saf1'), [
            { target: '.claude/settings.local.json', code: 'APPLY_WRITE_DENIED', error: MSG.DENIED('.claude/settings.local.json') },
            { target: 'src/x.ts', code: 'APPLY_WRITE_SCOPE', error: MSG.SCOPE('src/x.ts') },
          ]);
        }
        // immediate filesystem-safety failures are never downgraded into aggregate exit-3 errors
        const mix = cloneBase(dir, plain, `row${++n}`);
        if (kit.begin(mix, 'run-c2-saf1')) {
          putDraft(mix, 'run-c2-saf1', 'src/x.ts', 'x\n');
          const out = path.join(dir, `out-${++n}`);
          fs.mkdirSync(out, { recursive: true });
          fs.mkdirSync(path.join(runDirOf(mix, 'run-c2-saf1'), 'drafts', 'docs'), { recursive: true });
          if (junction(out, path.join(runDirOf(mix, 'run-c2-saf1'), 'drafts', 'docs', 'nested'), 'a junction beside a scope violation')) {
            unsafeF(2)(check, 'a junction beside a scope violation (prepare)', kit.prepare(mix, 'run-c2-saf1'));
          }
        }
      });
      await step('7.9/D2 secret refusal: shipped and installed policy refuse draft targets; a drafted policy does not widen the set; invalid installed policy fails closed', async () => {
        row('a shipped-policy secret draft target', {
          build: (root, id) => ({ forbid: [sentinel(projPath(root, 'docs/secrets/a.md'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, 'docs/secrets/a.md'), 'DRAFT-SENTINEL\n')] }),
          diff: fF('APPLY_SECRET_TARGET', 3, MSG.SECRET_DIFF('docs/secrets/a.md')), prepare: pP([{ target: 'docs/secrets/a.md', code: 'APPLY_SECRET_TARGET', error: MSG.SECRET_PREPARE }]),
        });
        row('an installed-policy-only secret draft target (D2)', {
          build: (root, id) => {
            putFile(projPath(root, T_POLICY), POLICY_PRIVATE);
            return { forbid: [sentinel(projPath(root, 'docs/private/a.md'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, 'docs/private/a.md'), 'DRAFT-SENTINEL\n')] };
          },
          diff: fF('APPLY_SECRET_TARGET', 3, MSG.SECRET_DIFF('docs/private/a.md')), prepare: pP([{ target: 'docs/private/a.md', code: 'APPLY_SECRET_TARGET', error: MSG.SECRET_PREPARE }]),
        });
        const okBoth = (what, files) => ({
          diff: (check2, label, r) => {
            check2(r.code === 0 && r.json && r.json.ok === true && Array.isArray(r.json.files) && eq(r.json.files.map((f) => f.target), files),`${label}: ${what}: exit 0 and the listed files`, { code: r.code, out: r.stdout.slice(0, 300) });
          },
          prepare: (check2, label, r) => check2(r.code === 0 && r.json && r.json.ok === true, `${label}: ${what}: prepare succeeds`, { code: r.code, out: r.stdout.slice(0, 300) }),
          prepareFails: false,
        });
        row('a drafted-only secret match (D2: the drafted policy is not part of the refusal set)', {
          build: (root, id) => { putDraft(root, id, T_POLICY, POLICY_DRAFTED); putDraft(root, id, 'docs/drafted/b.md', '# b\n'); return {}; },
          ...okBoth('the drafted policy adds nothing to the refusal set', [T_POLICY, 'docs/drafted/b.md']),
        });
        row('an invalid drafted policy alone (ordinary draft handling, no refusal-policy error)', {
          build: (root, id) => { putDraft(root, id, T_POLICY, POLICY_BAD_GLOB); putDraft(root, id, 'docs/ok.md', '# ok\n'); return {}; },
          ...okBoth('a drafted policy with bad grammar is an ordinary draft', [T_POLICY, 'docs/ok.md']),
        });
        row('an installed policy with unsupported grammar fails closed with the C1 error', {
          build: (root, id) => {
            putFile(projPath(root, T_POLICY), POLICY_BAD_GLOB);
            return { forbid: [sentinel(projPath(root, 'docs/ok.md'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, 'docs/ok.md'), 'DRAFT-SENTINEL\n')] };
          },
          diff: (check2, label, r) => {
            expectF(check2, label, r, { code: 'POLICY_GLOBSTAR', exit: 3, error: C1_GLOBSTAR('patterns[0]'), extra: ['target'] });
            check2(r.json && r.json.target === T_POLICY, `${label}: F names the control policy file as its target`, r.json && r.json.target);
          },
          prepare: pP([{ target: T_POLICY, code: 'POLICY_GLOBSTAR', error: C1_GLOBSTAR('patterns[0]') }]),
        });
        row('an installed policy that is not JSON fails closed with POLICY_JSON', {
          build: (root, id) => {
            putFile(projPath(root, T_POLICY), '{ "leak-marker-aa1": ');
            return { forbid: [sentinel(projPath(root, 'docs/ok.md'), 'TARGET-SENTINEL\n'), sentinel(draftOf(root, id, 'docs/ok.md'), 'DRAFT-SENTINEL\n')] };
          },
          diff: (check2, label, r) => {
            expectF(check2, label, r, { code: 'POLICY_JSON', exit: 3, error: 'POLICY_JSON: policy text must be valid JSON', extra: ['target'] });
            check2(r.json && r.json.target === T_POLICY && !r.stdout.includes('leak-marker-aa1'), `${label}: the target is the policy file and no source text is printed`, r.stdout.slice(0, 200));
          },
          prepare: (check2, label, r) => {
            expectP(check2, label, r, [{ target: T_POLICY, code: 'POLICY_JSON', error: 'POLICY_JSON: policy text must be valid JSON' }]);
            check2(!r.stdout.includes('leak-marker-aa1'), `${label}: no source text is printed`);
          },
        });
      });
      await step('7.9 request paths and containers: bad metadata target and declared-input paths, invalid JSON, wrong container, wrong typed values', async () => {
        const pathP = (p) => (check2, label, r) => {
          check2(r.code === 3 && r.stderr === '' && r.json !== null && fmtOk(r), `${label}: exit 3, empty stderr, two-space JSON`, { code: r.code, out: r.stdout.slice(0, 300) });
          const j = r.json || {};
          check2(j.ok === false && j.code === 'APPLY_PLAN_REJECTED' && j.error === MSG.PLAN_REJECTED && Array.isArray(j.errors) && j.errors.length === 1 && j.errors[0].code === 'APPLY_PATH' && j.errors[0].error === `unsafe path: ${p}` && typeof j.errors[0].target === 'string', `${label}: one APPLY_PATH entry with the path as written (PLAN-GAP: its target is not pinned)`, j);
        };
        const pathF = (p) => fF('APPLY_PATH', 3, `unsafe path: ${p}`);
        row('a bad metadata target path (non-canonical)', {
          build: (root, id) => { writeRequests(root, id, { 'ownership.json': { 'docs//x.md': 'full' } }); return { forbid: [sentinel(projPath(root, 'docs/x.md'), 'TARGET-SENTINEL\n')] }; },
          diff: pathF('docs//x.md'), prepare: pathP('docs//x.md'),
        });
        row('a bad metadata target path (traversal)', {
          build: (root, id) => { writeRequests(root, id, { 'managed-keys.json': { '../outside.md': {} } }); return { forbid: [sentinel(path.join(path.dirname(root), 'outside.md'), 'OUTSIDE-SENTINEL\n')] }; },
          diff: pathF('../outside.md'), prepare: pathP('../outside.md'),
        });
        row('a bad declared-input path', {
          build: (root, id) => { writeRequests(root, id, { 'transaction-inputs.json': ['docs//y.md'] }); return { forbid: [sentinel(projPath(root, 'docs/y.md'), 'TARGET-SENTINEL\n')] }; },
          diff: pathF('docs//y.md'), prepare: pathP('docs//y.md'),
        });
        row('invalid run-metadata JSON', {
          build: (root, id) => { putRequest(root, id, 'managed-keys.json', '{ bad json'); putDraft(root, id, 'docs/a.md', 'DRAFT\n'); return { forbid: [sentinel(projPath(root, 'docs/a.md'), 'TARGET-SENTINEL\n')] }; },
          diff: fF('APPLY_INPUT_JSON', 3, MSG.INPUT_JSON('managed-keys.json')), prepare: pP([{ target: 'managed-keys.json', code: 'APPLY_INPUT_JSON', error: MSG.INPUT_JSON('managed-keys.json') }]),
        });
        row('an invalid run-metadata container', {
          build: (root, id) => { putRequest(root, id, 'ownership.json', '[]\n'); putDraft(root, id, 'docs/a.md', 'DRAFT\n'); return { forbid: [sentinel(projPath(root, 'docs/a.md'), 'TARGET-SENTINEL\n')] }; },
          diff: fF('APPLY_INPUT_SHAPE', 3, MSG.INPUT_SHAPE('ownership.json')), prepare: pP([{ target: 'ownership.json', code: 'APPLY_INPUT_SHAPE', error: MSG.INPUT_SHAPE('ownership.json') }]),
        });
        row('an invalid typed managed value', {
          build: (root, id) => { putDraft(root, id, T_SETTINGS, '{}\n'); writeRequests(root, id, { 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': [5] } } }); return {}; },
          diff: fF('OWNERSHIP_SHAPE', 3, 'OWNERSHIP_SHAPE: managed.permissions.deny'), prepare: pP([{ target: T_SETTINGS, code: 'OWNERSHIP_SHAPE', error: 'OWNERSHIP_SHAPE: managed.permissions.deny' }]),
        });
        row('an invalid typed omission value', {
          build: (root, id) => { putDraft(root, id, T_SETTINGS, '{}\n'); writeRequests(root, id, { 'omissions.json': { [T_SETTINGS]: { 'permissions.allow': 'x' } } }); return {}; },
          diff: (check2, label, r) => {
            check2(r.code === 3 && r.stderr === '' && r.json && fmtOk(r) && r.json.ok === false && r.json.code === 'OMISSIONS_SHAPE' && String(r.json.error).startsWith('OMISSIONS_SHAPE: ') && eq(sorted(Object.keys(r.json)), ['code', 'error', 'ok']), `${label}: exit 3 with the shared OMISSIONS_SHAPE code and message`, { code: r.code, out: r.stdout.slice(0, 300) });
          },
          prepare: (check2, label, r) => expectPLoose(check2, label, r, T_SETTINGS, 'OMISSIONS_SHAPE'),
        });
      });
      await step('7.9 non-text content: NUL and invalid UTF-8 documents fail the review without printing any body or partial review; prepare keeps its content path', async () => {
        for (const [label, bytes] of [['a NUL byte', Buffer.from([0x41, 0x00, 0x42, 0x0a])], ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x41, 0x0a])]]) {
          row(`an ordinary document with ${label}`, {
            build: (root, id) => {
              putDraft(root, id, 'docs/bin.md', bytes);
              putDraft(root, id, 'docs/ok.md', 'SAFE-DIFF-BODY\n');
              return {};
            },
            prepareFails: false,
            diff: (check2, lbl, r) => {
              expectF(check2, lbl, r, { code: 'APPLY_DIFF_TEXT', exit: 3, error: MSG.DIFF_TEXT('docs/bin.md') });
              check2(!r.stdout.includes('SAFE-DIFF-BODY') && !r.stdout.includes('"files"'), `${lbl}: no earlier safe diff and no partial review is printed`, r.stdout.slice(0, 200));
            },
            prepare: (check2, lbl, r) => check2(r.code === 0 && r.json && r.json.ok === true && !/APPLY_DIFF_TEXT/.test(r.stdout), `${lbl}: prepare follows the existing content path (not a review error)`, { code: r.code, out: r.stdout.slice(0, 200) }),
          });
        }
      });
      await step('7.9 unreadable input: APPLY_DIFF_IO (exit 2) for the review, APPLY_INPUT_IO (exit 3) for prepare, with the path relative to the root', async () => {
        const ioRel = (prefix, tail) => new RegExp(`^${prefix}: [^\\\\:]*${tail.replace(/\./g, '\\.')}$`);
        row('an unreadable target body', {
          build: (root, id) => {
            const t = sentinel(projPath(root, 'docs/a.md'), 'TARGET-SENTINEL\n');
            putDraft(root, id, 'docs/a.md', 'DRAFT-SENTINEL\n');
            return { failRead: [t] };
          },
          // PLAN-GAP: 7.9 pins the codes, exits and envelopes; which path the message prints (target or source) is not, so only a relative path ending in docs/a.md is required.
          diff: (check2, label, r) => expectF(check2, label, r, { code: 'APPLY_DIFF_IO', exit: 2, error: ioRel('cannot read draft review input', 'docs/a.md') }),
          prepare: (check2, label, r) => {
            check2(r.code === 3 && r.stderr === '' && r.json && fmtOk(r) && r.json.ok === false && r.json.code === 'APPLY_PLAN_REJECTED' && r.json.errors.length === 1 && r.json.errors[0].code === 'APPLY_INPUT_IO' && ioRel('cannot read transaction input', 'docs/a.md').test(r.json.errors[0].error), `${label}: one APPLY_INPUT_IO entry`, { code: r.code, out: r.stdout.slice(0, 300) });
          },
        });
        // a declared input that cannot be read (prepare only: an unprepared review does not hash declared inputs)
        const root = cloneBase(dir, plain, `row${++n}`);
        if (kit.begin(root, 'run-c2-saf1')) {
          const consumer = sentinel(projPath(root, 'docs/consumer.md'), 'CONSUMER\n');
          writeRequests(root, 'run-c2-saf1', { 'transaction-inputs.json': ['docs/consumer.md'] });
          const g = makeGuard(dir, [consumer], 'fail');
          const r = kit.prepare(root, 'run-c2-saf1', { preload: g.file });
          // PLAN-GAP: the entry target for an unreadable declared input is not pinned; the code, the exact message and the envelope are.
          const j = r.json || {};
          check(r.code === 3 && r.stderr === '' && fmtOk(r) && j.ok === false && j.code === 'APPLY_PLAN_REJECTED' && j.error === MSG.PLAN_REJECTED && Array.isArray(j.errors) && j.errors.length === 1 && j.errors[0].code === 'APPLY_INPUT_IO' && j.errors[0].error === 'cannot read transaction input: docs/consumer.md' && typeof j.errors[0].target === 'string', 'an unreadable declared input: one APPLY_INPUT_IO entry with the exact message', { code: r.code, out: r.stdout.slice(0, 300) });
        }
      });
    });
  });
}

// ===================================================== V2/C2/recovery ====
// Plan 4.6 (journal, exit meanings, rollback) and 7.10: fault injection through external preloads (a destination rename that throws EIO, an
// exit 137 after a selected rename, a failing journal or restore rename). Message prefixes, exit codes and journal states are the oracle;
// native operating-system wording is not.
async function recovery(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const kit = makeKit(context, check);
    const v2 = await useBase(failures, 'genuine v2', getV2Base, context);
    const v2p = await useBase(failures, 'v2 with preserved settings', getV2pBase, context);
    if (!v2 || !v2p) return;
    await withScratch(context, 'rec', async (dir) => {
      let n = 0;
      // Scenario builders: M1 (schema conversion only), M5 (settings metadata only) and M6 (a document plus the M5 metadata).
      const m1 = () => {
        const root = cloneBase(dir, v2, `s${++n}`);
        const id = `run-c2-rec${n}`;
        const p = runSpec(kit, root, id, {});
        check(p.ok === true, `M1 scenario ${n}: prepare succeeds`, p.prep && p.prep.stdout.slice(0, 200));
        return { root, id, p, oldManifest: readBytes(manifestPath(root)) };
      };
      const metaReqs = (root) => {
        const f = baseFacts(root);
        return { f, reqs: { 'ownership.json': { [T_SETTINGS]: 'keys' }, 'managed-keys.json': { [T_SETTINGS]: { 'permissions.deny': f.denyMinus } }, 'omissions.json': { [T_SETTINGS]: { 'permissions.deny': [f.npmrcEntry] } } } };
      };
      const m5 = () => {
        const root = cloneBase(dir, v2p, `s${++n}`);
        const id = `run-c2-rec${n}`;
        const { reqs } = metaReqs(root);
        const p = runSpec(kit, root, id, { requests: reqs, o: { approve: [T_SETTINGS] } });
        check(p.ok === true, `M5 scenario ${n}: prepare succeeds`, p.prep && p.prep.stdout.slice(0, 200));
        return { root, id, p, oldManifest: readBytes(manifestPath(root)), settings: readBytes(projPath(root, T_SETTINGS)), policy: readBytes(projPath(root, T_POLICY)) };
      };
      const NEW_DOC = '# api-conventions\n\nchanged by the run\n';
      const m6 = () => {
        const root = cloneBase(dir, v2p, `s${++n}`);
        const id = `run-c2-rec${n}`;
        const { reqs } = metaReqs(root);
        const p = runSpec(kit, root, id, { drafts: { [DOC_API]: NEW_DOC }, requests: reqs, o: { approve: [T_SETTINGS] } });
        check(p.ok === true, `M6 scenario ${n}: prepare succeeds`, p.prep && p.prep.stdout.slice(0, 200));
        return { root, id, p, oldManifest: readBytes(manifestPath(root)), oldDoc: readBytes(projPath(root, DOC_API)), settings: readBytes(projPath(root, T_SETTINGS)) };
      };
      const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0;
      const fired = (f, rule, action, label) => check(eq(f.fired().map((x) => x.action), [action]) && f.fired()[0].rule === rule, `${label}: the injected fault fired exactly once`, f.fired());
      const stateOf = (root, id) => { const s = kit.status(root, id); return s.json && s.json.state; };

      await step('pre-write failure: the first journal rename fails before any project write; targets and manifest are preserved', async () => {
        const s = m1();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: runFile(s.root, s.id, 'journal.json'), nth: 1, action: 'throw' }]);
        const before = treeWithout(s.root);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'throw', 'journal');
        // PLAN-GAP: the exit code of a failure before the first journal write is not pinned; only that nothing was written and it did not succeed.
        check(c.code !== 0 && !(c.json && c.json.ok === true), 'the commit does not succeed', { code: c.code, out: c.stdout.slice(0, 200) });
        check(!exists(runFile(s.root, s.id, 'journal.json')), 'no journal exists');
        check(same(readBytes(manifestPath(s.root)), s.oldManifest) && treeWithout(s.root) === before, 'the manifest and every project file are unchanged');
        check(!exists(runFile(s.root, s.id, 'vault', 'backup', '.ai', 'manifest.json')), 'no backup was written before the journal');
        check(stateOf(s.root, s.id) === 'fresh', 'the run is still fresh (no journal)');
      });
      await step('mid-commit failure on a content write: exit 5, a recoverable journal and backups; rollback restores everything', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: projPath(s.root, DOC_API), nth: 1, action: 'throw' }]);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'throw', 'document rename');
        check(c.code === 5 && c.json && c.json.ok === false && /^apply failed mid-way:/.test(c.json.error) && eq(c.json.appliedSoFar, []) && /rollback --run-id/.test(c.json.recovery), 'exit 5 with the existing mid-way message, nothing applied, the recovery command', { code: c.code, out: c.stdout.slice(0, 300) });
        const j = readJournal(s.root, s.id);
        check(j && eq(j.entries.map((e) => [e.target, e.state]), [[DOC_API, 'backed-up']]), 'the journal lists the document as backed up', j && j.entries);
        check(same(readBytes(runFile(s.root, s.id, 'vault', 'backup', ...DOC_API.split('/'))), s.oldDoc), 'the backup holds the old document bytes');
        check(same(readBytes(projPath(s.root, DOC_API)), s.oldDoc) && same(readBytes(manifestPath(s.root)), s.oldManifest) && same(readBytes(projPath(s.root, T_SETTINGS)), s.settings), 'the document, the manifest and the settings are unchanged');
        check(stateOf(s.root, s.id) === 'partial', 'the run state is partial');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true, 'rollback completes', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(same(readBytes(projPath(s.root, DOC_API)), s.oldDoc) && same(readBytes(manifestPath(s.root)), s.oldManifest), 'nothing changed by the rollback');
      });
      await step('failure of the manifest write after a content write: the content is applied, the manifest is not; rollback restores the content only', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: manifestPath(s.root), nth: 1, action: 'throw' }]);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'throw', 'manifest rename');
        check(c.code === 5 && c.json && /^apply failed mid-way:/.test(c.json.error) && eq(c.json.appliedSoFar, [DOC_API]), 'exit 5 listing the applied document', { code: c.code, out: c.stdout.slice(0, 300) });
        check(readText(projPath(s.root, DOC_API)) === NEW_DOC && same(readBytes(manifestPath(s.root)), s.oldManifest), 'the document is new and the manifest keeps its pre-run raw bytes');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true && eq(rb.json.restored, [DOC_API]) && eq(rb.json.untouched, [T_MANIFEST]), 'rollback restores the document and finds the manifest untouched', rb.json);
        check(same(readBytes(projPath(s.root, DOC_API)), s.oldDoc) && same(readBytes(manifestPath(s.root)), s.oldManifest), 'the pre-run state is back');
      });
      await step('a metadata-only failure never writes settings or policy; the manifest is the only candidate', async () => {
        const s = m5();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: manifestPath(s.root), nth: 1, action: 'throw' }]);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'throw', 'manifest rename');
        check(c.code === 5 && c.json && eq(c.json.appliedSoFar, []), 'exit 5 with nothing applied', { code: c.code, out: c.stdout.slice(0, 300) });
        const j = readJournal(s.root, s.id);
        check(j && eq(j.entries.map((e) => e.target), [T_MANIFEST]), 'the only journal entry is the manifest (no dummy settings or policy write)', j && j.entries.map((e) => e.target));
        check(same(readBytes(projPath(s.root, T_SETTINGS)), s.settings) && same(readBytes(projPath(s.root, T_POLICY)), s.policy) && same(readBytes(manifestPath(s.root)), s.oldManifest), 'settings, policy and manifest bytes are unchanged');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true, 'rollback completes', rb.json);
      });
      await step('crash after the manifest rename: recovery through expectedWriteSha restores the exact schema 2 bytes; the used run refuses reuse with exit 7', async () => {
        const s = m5();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: manifestPath(s.root), nth: 1, action: 'exit-after', exitCode: 137 }]);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'exit-after', 'manifest rename');
        check(c.code === 137, 'the process died with exit 137 right after the manifest rename', { code: c.code, out: c.stdout.slice(0, 200) });
        const man = readText(manifestPath(s.root));
        check(man === JSON.stringify(s.p.plan.manifestAfter, null, 2) + '\n', 'the new schema 3 manifest is on disk');
        const j = readJournal(s.root, s.id);
        check(j && j.entries.length === 1 && j.entries[0].target === T_MANIFEST && j.entries[0].state === 'backed-up' && j.entries[0].expectedWriteSha === sha(Buffer.from(man || '')), 'the journal still says backed-up, with the expected write hash of the new manifest', j && j.entries);
        check(stateOf(s.root, s.id) === 'partial', 'the run state is partial');
        const again = kit.commit(s.root, s.id, s.p.sha);
        check(again.code === 7 && again.json && /^commit refused: run .* is partial/.test(again.json.error), 'commit of the unresolved run exits 7', { code: again.code, out: again.stdout.slice(0, 300) });
        const rep = kit.prepare(s.root, s.id);
        check(rep.code === 7, 'prepare of the unresolved run exits 7', { code: rep.code, out: rep.stdout.slice(0, 300) });
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true && eq(rb.json.restored, [T_MANIFEST]), 'rollback restores the manifest through expectedWriteSha', rb.json);
        check(same(readBytes(manifestPath(s.root)), s.oldManifest), 'the exact schema 2 manifest bytes are back');
        check(same(readBytes(projPath(s.root, T_SETTINGS)), s.settings), 'the settings bytes were never touched');
        check(stateOf(s.root, s.id) === 'rolled-back', 'the run state is rolled-back');
      });
      await step('crash after a content rename: rollback restores the content and the manifest equals its pre-run raw bytes', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: projPath(s.root, DOC_API), nth: 1, action: 'exit-after', exitCode: 137 }]);
        const c = kit.commit(s.root, s.id, s.p.sha, { preload: f.file });
        fired(f, 0, 'exit-after', 'document rename');
        check(c.code === 137, 'the process died with exit 137', { code: c.code });
        check(readText(projPath(s.root, DOC_API)) === NEW_DOC && same(readBytes(manifestPath(s.root)), s.oldManifest), 'the document is new and the manifest is still the pre-run file');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true, 'rollback completes', rb.json);
        check(same(readBytes(projPath(s.root, DOC_API)), s.oldDoc) && same(readBytes(manifestPath(s.root)), s.oldManifest), 'the document is restored and the manifest equals its pre-run raw bytes');
      });
      await step('rollback faults: a failing manifest restore is incomplete (exit 6) and retains state; retrying without the fault succeeds', async () => {
        const s = m1();
        if (!s.p.ok) return;
        const c = kit.commit(s.root, s.id, s.p.sha);
        check(c.code === 0 && c.json && c.json.committed === true, 'the conversion commits', c.stdout.slice(0, 200));
        const newManifest = readBytes(manifestPath(s.root));
        const f = makeFault(dir, [{ dest: manifestPath(s.root), nth: 1, action: 'throw' }]);
        const rb = kit.rollback(s.root, s.id, { preload: f.file });
        fired(f, 0, 'throw', 'manifest restore');
        check(rb.code === 6 && rb.json && rb.json.ok === false && /^rollback incomplete:/.test(rb.json.error) && Array.isArray(rb.json.skipped) && rb.json.skipped.length === 1 && rb.json.skipped[0].target === T_MANIFEST, 'exit 6 with the existing incomplete-rollback message and the manifest skipped', { code: rb.code, out: rb.stdout.slice(0, 400) });
        check(same(readBytes(manifestPath(s.root)), newManifest), 'the manifest was left as found');
        check(same(readBytes(runFile(s.root, s.id, 'vault', 'backup', '.ai', 'manifest.json')), s.oldManifest), 'the backup is retained');
        const st = kit.status(s.root, s.id);
        check(st.json && st.json.state === 'rollback-incomplete' && st.json.rollbackComplete === false, 'the run state is rollback-incomplete', st.json && { state: st.json.state, complete: st.json.rollbackComplete });
        const retry = kit.rollback(s.root, s.id);
        check(retry.code === 0 && retry.json && retry.json.complete === true, 'retrying the rollback without the fault succeeds', { code: retry.code, out: retry.stdout.slice(0, 300) });
        check(same(readBytes(manifestPath(s.root)), s.oldManifest), 'the exact schema 2 manifest bytes are restored');
      });
      await step('rollback faults: a failing journal write after the in-progress marker stops the rollback in a resumable state', async () => {
        const s = m1();
        if (!s.p.ok) return;
        const c = kit.commit(s.root, s.id, s.p.sha);
        check(c.code === 0, 'the conversion commits');
        const f = makeFault(dir, [{ dest: runFile(s.root, s.id, 'journal.json'), nth: 2, action: 'throw' }]);
        const rb = kit.rollback(s.root, s.id, { preload: f.file });
        fired(f, 0, 'throw', 'rollback journal');
        check(rb.code === 6 && rb.json && /^rollback stopped: cannot record progress/.test(rb.json.error), 'exit 6 with the existing progress-recording message', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(stateOf(s.root, s.id) === 'rollback-in-progress', 'the run stays rollback-in-progress, never committed');
        const retry = kit.rollback(s.root, s.id);
        check(retry.code === 0 && retry.json && retry.json.complete === true, 'rollback resumes and completes', { code: retry.code, out: retry.stdout.slice(0, 300) });
        check(same(readBytes(manifestPath(s.root)), s.oldManifest), 'the schema 2 manifest is back');
      });
      await step('a corrupt manifest backup: exit 6, target and backup bytes preserved', async () => {
        const s = m1();
        if (!s.p.ok) return;
        const c = kit.commit(s.root, s.id, s.p.sha);
        check(c.code === 0, 'the conversion commits');
        const newManifest = readBytes(manifestPath(s.root));
        const backup = runFile(s.root, s.id, 'vault', 'backup', '.ai', 'manifest.json');
        putFile(backup, 'CORRUPTED BACKUP\n');
        const corrupt = readBytes(backup);
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 6 && rb.json && /^rollback incomplete:/.test(rb.json.error) && rb.json.skipped.some((x) => x.target === T_MANIFEST), 'exit 6 with the manifest skipped', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(same(readBytes(manifestPath(s.root)), newManifest) && same(readBytes(backup), corrupt), 'neither the manifest nor the corrupt backup was touched');
      });
      await step('later edits stay untouched: a content edit or a manifest edit after the commit makes the rollback incomplete (exit 6)', async () => {
        const a = m6();
        if (!a.p.ok) return;
        check(kit.commit(a.root, a.id, a.p.sha).code === 0, 'the transaction commits');
        fs.appendFileSync(projPath(a.root, DOC_API), 'LATER USER EDIT\n');
        const edited = readBytes(projPath(a.root, DOC_API));
        const rb = kit.rollback(a.root, a.id);
        check(rb.code === 6 && rb.json && rb.json.skipped.some((x) => x.target === DOC_API), 'a later content edit is skipped, exit 6', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(same(readBytes(projPath(a.root, DOC_API)), edited), 'the user edit is untouched');
        const b = m6();
        if (!b.p.ok) return;
        check(kit.commit(b.root, b.id, b.p.sha).code === 0, 'the second transaction commits');
        fs.appendFileSync(manifestPath(b.root), '\n');
        const laterManifest = readBytes(manifestPath(b.root));
        const rb2 = kit.rollback(b.root, b.id);
        check(rb2.code === 6 && rb2.json && rb2.json.skipped.some((x) => x.target === T_MANIFEST), 'a later manifest edit is skipped, exit 6', { code: rb2.code, out: rb2.stdout.slice(0, 300) });
        check(same(readBytes(manifestPath(b.root)), laterManifest), 'the later manifest bytes are untouched');
      });
      await step('a later committed manifest keeps an earlier rollback from overwriting it', async () => {
        const s = m1();
        if (!s.p.ok) return;
        check(kit.commit(s.root, s.id, s.p.sha).code === 0, 'run A commits the schema conversion');
        check(kit.lock(s.root, ['release', '--run-id', s.id]).code === 0, 'run A releases the lock');
        const idB = `${s.id}b`;
        // run B creates a new document, so its manifest (a new record) differs from run A's and cannot be mistaken for it
        const pb = runSpec(kit, s.root, idB, { drafts: { 'docs/run-b.md': '# run B\n' } });
        check(pb.ok === true, 'run B prepares on the converted project', pb.prep && pb.prep.stdout.slice(0, 200));
        if (!pb.ok) return;
        check(kit.commit(s.root, idB, pb.sha).code === 0, 'run B commits');
        const manifestB = readBytes(manifestPath(s.root));
        const journalB = readBytes(runFile(s.root, idB, 'journal.json'));
        check(kit.lock(s.root, ['release', '--run-id', idB]).code === 0 && kit.lock(s.root, ['acquire', '--run-id', s.id]).code === 0, 'the lock moves back to run A');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 6 && rb.json && rb.json.skipped.some((x) => x.target === T_MANIFEST), 'rolling back run A finds the later manifest and exits 6', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(same(readBytes(manifestPath(s.root)), manifestB) && same(readBytes(runFile(s.root, idB, 'journal.json')), journalB), 'run B\'s manifest and journal are untouched');
      });
      await step('a journaled run cannot be re-prepared or re-committed (exit 7), also after a partial apply', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const f = makeFault(dir, [{ dest: manifestPath(s.root), nth: 1, action: 'throw' }]);
        check(kit.commit(s.root, s.id, s.p.sha, { preload: f.file }).code === 5, 'the commit fails mid-way (exit 5)');
        const c = kit.commit(s.root, s.id, s.p.sha);
        const r = kit.prepare(s.root, s.id);
        check(c.code === 7 && c.json && /^commit refused: run .* is partial/.test(c.json.error) && r.code === 7 && r.json && /^prepare refused: run .* is partial/.test(r.json.error), 'both are refused with exit 7', { c: c.code, r: r.code });
      });
      await step('exit 4 with no journal permits re-prepare and a new approval for the same run ID', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const draft = draftPath(s.root, s.id, DOC_API);
        fs.appendFileSync(draft, 'UNREVIEWED\n');
        const c = kit.commit(s.root, s.id, s.p.sha);
        check(c.code === 4 && c.json && c.json.code === 'APPLY_DRIFT' && !exists(runFile(s.root, s.id, 'journal.json')), 'the drift exits 4 with no journal', { code: c.code, out: c.stdout.slice(0, 300) });
        const p2 = kit.prepare(s.root, s.id, { approve: [T_SETTINGS] });
        check(p2.code === 0 && p2.json && p2.json.ok === true, 're-prepare with the same run ID succeeds', p2.stdout.slice(0, 300));
        const c2 = kit.commit(s.root, s.id, p2.json && p2.json.planSha256);
        check(c2.code === 0 && c2.json && c2.json.committed === true, 'the new approval commits', c2.stdout.slice(0, 300));
      });
      await step('exit 2 with no journal permits re-prepare after the unsafe path is restored; nothing is written outside', async () => {
        const s = m6();
        if (!s.p.ok) return;
        const runDrafts = path.join(runDirOf(s.root, s.id), 'drafts');
        const out = path.join(dir, `out-drafts-${++n}`);
        fs.renameSync(runDrafts, out);
        if (!linkDir(out, runDrafts)) { check(false, 'a junction (a directory symlink off Windows) could be created for the draft directory'); return; }
        const outBefore = snapshotTree(out);
        const treeBefore = treeWithout(s.root);
        const c = kit.commit(s.root, s.id, s.p.sha);
        check(c.code === 2 && c.json && c.json.ok === false && !exists(runFile(s.root, s.id, 'journal.json')), 'a linked draft directory exits 2 with no journal', { code: c.code, out: c.stdout.slice(0, 300) });
        check(snapshotTree(out) === outBefore && treeWithout(s.root) === treeBefore, 'nothing was written outside or in the project');
        dropLink(runDrafts);
        fs.renameSync(out, runDrafts);
        const p2 = kit.prepare(s.root, s.id, { approve: [T_SETTINGS] });
        check(p2.code === 0 && p2.json && p2.json.ok === true, 're-prepare with the same run ID succeeds after the restore', p2.stdout.slice(0, 300));
        const c2 = kit.commit(s.root, s.id, p2.json && p2.json.planSha256);
        check(c2.code === 0 && c2.json && c2.json.committed === true, 'the restored run commits', c2.stdout.slice(0, 300));
      });
      await step('4.3 existing v2 journals remain recoverable: the rollback undoes a run written by the tagged v2 scripts', async () => {
        const root = cloneBase(dir, v2, `s${++n}`);
        const id = 'v2-baseline-0001';
        const acquire = kit.lock(root, ['acquire', '--run-id', id]);
        check(acquire.code === 0, 'the lock can be taken for the old run', acquire.stdout.slice(0, 200));
        const j = readJournal(root, id);
        check(j && j.committed === true && Array.isArray(j.entries) && j.entries.length > 20 && !hasOwn(j, 'metadataOps'), 'the journal is a v2 journal (committed, many entries, no metadataOps)', j && Object.keys(j));
        const rb = kit.rollback(root, id);
        check(rb.code === 0 && rb.json && rb.json.ok === true && rb.json.complete === true, 'the new rollback completes on a v2 journal', { code: rb.code, out: rb.stdout.slice(0, 300) });
        check(!exists(manifestPath(root)) && !exists(projPath(root, T_SETTINGS)) && !exists(projPath(root, 'AGENTS.md')), 'the installation the run created is removed');
        check(stateOf(root, id) === 'rolled-back', 'the run state is rolled-back');
      });
      await step('rollback of a committed schema conversion restores the exact schema 2 bytes; the rolled-back run keeps its history', async () => {
        const s = m1();
        if (!s.p.ok) return;
        check(kit.commit(s.root, s.id, s.p.sha).code === 0, 'the conversion commits');
        const rb = kit.rollback(s.root, s.id);
        check(rb.code === 0 && rb.json && rb.json.complete === true && eq(rb.json.restored, [T_MANIFEST]), 'rollback restores only the manifest', rb.json);
        check(same(readBytes(manifestPath(s.root)), s.oldManifest), 'the manifest is byte-identical to the schema 2 original');
        check(stateOf(s.root, s.id) === 'rolled-back' && exists(runFile(s.root, s.id, 'journal.json')), 'the journal is kept as history');
      });
    });
  });
}

// ================================================= V2/C2/module-contract ====
// Plan 2.1 (API conventions and exact exports), 7.1 (registration), 7.11 (module and baseline contracts) and 9 (the exact component records).
const PLAN9_RECORDS = [
  'PASS  R79/C2/policy-schema  complete policy ownership metadata',
  'PASS  R79/C2/settings-schema  permission and hook ownership schemas',
  'PASS  R79/C2/manifest-schema  manifest schema 3 and legacy input',
  'PASS  R86/C2/omissions  exact persistent omission identities',
  'PASS  R86/C2/metadata-only  approved metadata without content writes',
  'PASS  R86/C2/mixed-transaction  one content and metadata transaction',
  'PASS  R80/C2/input-binding  all approved inputs remain bound',
  'PASS  R02/C2/diff-output  deterministic read-only draft review',
  'PASS  R02/C2/no-git  draft review invokes no Git',
  'PASS  R02/C2/diff-safety  secret and unsafe targets are refused',
  'PASS  R15/C2/metadata-binding  metadata presence and bytes are approved',
  'PASS  R29/C2/approval-noop  unchanged-file approvals and genuine no-op',
  'PASS  V2/C2/recovery  metadata transaction recovery preserves later edits',
  'PASS  V2/C2/module-contract  shared exports and component registration',
];
const RC1_CASES_EXPORTS = ['BASELINE_CASE_IDS', 'COMPONENT_ASSERTIONS', 'COMPONENT_IMPLEMENTATIONS', 'RC1_CASE_IDS', 'REQUIRED_CASE_IDS', 'registerRc1Cases', 'runComponentAssertions', 'selectSuiteCases'];

// Runs fn with filesystem, process-spawning, process-stream and environment access observed (and still allowed), to show a pure function
// touches none of them. The window is one synchronous call, so nothing else interleaves.
function observeEffects(fn) {
  const fsMethods = ['readFileSync', 'writeFileSync', 'appendFileSync', 'statSync', 'lstatSync', 'readdirSync', 'existsSync', 'openSync', 'mkdirSync', 'rmSync', 'renameSync', 'realpathSync', 'accessSync', 'readSync'];
  const log = [];
  const saved = [];
  for (const k of fsMethods) { if (typeof fs[k] === 'function') { const o = fs[k]; saved.push([fs, k, o]); fs[k] = function (...a) { log.push(`fs.${k}`); return o.apply(this, a); }; } }
  for (const k of ['spawnSync', 'execSync', 'execFileSync', 'spawn', 'exec', 'execFile', 'fork']) { const o = spawnSyncHolder[k]; if (typeof o === 'function') { saved.push([spawnSyncHolder, k, o]); spawnSyncHolder[k] = function (...a) { log.push(`child_process.${k}`); return o.apply(this, a); }; } }
  const envDesc = Object.getOwnPropertyDescriptor(process, 'env');
  const realEnv = process.env;
  process.env = new Proxy(realEnv, { get(t, k, r) { if (typeof k === 'string') log.push(`env.${k}`); return Reflect.get(t, k, r); }, has(t, k) { log.push(`env.has.${String(k)}`); return Reflect.has(t, k); }, ownKeys(t) { log.push('env.keys'); return Reflect.ownKeys(t); } });
  let value; let thrown = null;
  try { value = fn(); } catch (e) { thrown = e; } finally {
    process.env = realEnv;
    if (envDesc && envDesc.configurable === false) { /* nothing to restore */ }
    for (const [obj, k, o] of saved) obj[k] = o;
  }
  return { value, thrown, log };
}
// The child_process module object (the default import of a builtin is the live module object, so patching it is observable).
const spawnSyncHolder = childProcessModule;

async function moduleContract(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const ownership = await needOwnership(failures, context);
    const lib = await needScript(failures, context, 'lib.mjs');
    const schemas = await needScript(failures, context, 'schemas.mjs');

    await step('2.1/7.11 import safety and the exact export sets of the new and extended modules', async () => {
      await withScratch(context, 'imp', async (dir) => {
        checkImportSafe(check, 'scripts/ownership.mjs', context, dir, ownershipUrl(context), OWNERSHIP_EXPORTS);
        checkImportSafe(check, 'scripts/lib.mjs (existing exports kept, setFilesystemRoot and classifyEnvTemplate added)', context, dir, scriptUrl(context, 'lib.mjs'), [...LIB_OLD_EXPORTS, ...LIB_NEW_EXPORTS]);
        checkImportSafe(check, 'scripts/schemas.mjs (its three exports kept)', context, dir, scriptUrl(context, 'schemas.mjs'), SCHEMAS_EXPORTS);
        checkImportSafe(check, 'tests/c2.test.mjs', context, dir, import.meta.url, CASE_EXPORTS);
      });
    });
    if (ownership && needFns(failures, ownership, OWNERSHIP_EXPORTS) && lib && needFns(failures, lib, LIB_NEW_EXPORTS)) {
      await step('2.1 the new pure functions are synchronous and touch no filesystem, process spawning, process stream, exit or environment; results are fresh, mutable data', async () => {
        const policy = { schema: 2, patterns: [{ anchor: 'any', glob: '**/.env' }] };
        const settings = { 'permissions.deny': ['Read(x)'], hooks: [{ event: 'Stop', matcher: '', command: 'c' }], heldBack: [] };
        const manifest = { schema: 3, skill: 'project-setup', skillVersion: '2.0.0', mode: 'update', agents: ['claude'], sourceCommit: null, files: { 'a.md': { ownership: 'merged' } } };
        const calls = [
          () => ownership.readManagedMetadata(T_POLICY, deepFreeze(clone(policy))), () => ownership.readManagedMetadata(T_SETTINGS, deepFreeze(clone(settings))),
          () => ownership.readOmissions(T_POLICY, { patterns: [{ anchor: 'any', glob: '**/.env' }] }), () => ownership.readOmissions(T_SETTINGS, { 'permissions.allow': ['Bash(a)'] }),
          () => ownership.hookIdentity({ event: 'E', matcher: '', command: 'c' }), () => ownership.isPolicyOmitted({ anchor: 'any', glob: '**/.env' }, [{ anchor: 'any', glob: '**/.ENV' }]),
          () => ownership.readManifest(deepFreeze(clone(manifest))), () => lib.classifyEnvTemplate(ENV_FIXTURE),
          // the error paths too
          () => { try { ownership.readManagedMetadata('TODO.md', {}); } catch (e) { return e.code; } return null; },
          () => { try { ownership.readManifest(null); } catch (e) { return e.code; } return null; },
          () => { try { ownership.isPolicyOmitted({ anchor: 'any', glob: '**/.env' }, null); } catch (e) { return e.code; } return null; },
          () => { try { lib.classifyEnvTemplate(5); } catch (e) { return e.code; } return null; },
        ];
        const rec = await withStreamGuard(async () => {
          const out = [];
          for (const c of calls) { const o = observeEffects(c); out.push(o); }
          return out;
        });
        check(rec.threw === null && Array.isArray(rec.value), 'the observed calls complete', rec.threw && errMsg(rec.threw));
        check(rec.out.length === 0 && rec.err.length === 0 && rec.exits.length === 0 && !rec.exitCodeChanged, 'no stdout, no stderr, no process.exit, no exit code', { out: rec.out.join('').slice(0, 100), err: rec.err.join('').slice(0, 100), exits: rec.exits });
        const results = rec.value || [];
        results.forEach((o, i) => {
          check(o.thrown === null, `call ${i}: does not throw`, o.thrown && errMsg(o.thrown));
          check(o.log.length === 0, `call ${i}: no filesystem, spawn or environment access`, o.log.slice(0, 5));
          check(!(o.value && typeof o.value === 'object' && typeof o.value.then === 'function'), `call ${i}: synchronous`);
          if (o.value && typeof o.value === 'object') check(!Object.isFrozen(o.value), `call ${i}: the returned data is mutable (never frozen)`);
        });
        check(eq(results.slice(8).map((o) => o.value), ['OWNERSHIP_TARGET', 'MANIFEST_INVALID', 'OMISSIONS_SHAPE', 'ENV_TEMPLATE_TEXT']), 'the error paths report their codes', results.slice(8).map((o) => o.value));
      });
    }

    // -------------------------------------------------------------- registry ----
    await step('7.1/7.11 the C2 inventory, registration and the unchanged C1 and C11a inventories', async () => {
      const rc = await needSibling(failures, 'rc1-cases.mjs');
      if (!rc) return;
      check(eq(sorted(Object.keys(rc)), RC1_CASES_EXPORTS), 'rc1-cases.mjs keeps its exports (registerRc1Cases is unchanged)', Object.keys(rc));
      const exp = rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C2;
      check(Array.isArray(exp) && eq(JSON.parse(JSON.stringify(exp)), EXPECTED_DESCRIPTORS), 'COMPONENT_ASSERTIONS.C2 is the fourteen descriptors of plan 7.1, written independently, in order', exp);
      check(deepFrozen(exp) && Array.isArray(exp), 'COMPONENT_ASSERTIONS.C2 and every descriptor are deep-frozen');
      const impls = rc.COMPONENT_IMPLEMENTATIONS && rc.COMPONENT_IMPLEMENTATIONS.C2;
      check(Array.isArray(impls) && Object.isFrozen(impls), 'COMPONENT_IMPLEMENTATIONS.C2 is a frozen array', impls && Object.isFrozen(impls));
      check(Array.isArray(impls) && impls.length === C2_IMPLEMENTATIONS.length && impls.every((x, i) => x === C2_IMPLEMENTATIONS[i]), 'it holds exactly the descriptor objects of C2_IMPLEMENTATIONS, in order (identity preserved)');
      check(Object.isFrozen(C2_IMPLEMENTATIONS) && eq(C2_IMPLEMENTATIONS.map((x) => x.id), EXPECTED_DESCRIPTORS.map((d) => d.id)) && C2_IMPLEMENTATIONS.every((x) => typeof x.run === 'function'), 'C2_IMPLEMENTATIONS is a frozen array of the fourteen IDs with callable run functions');
      check(eq(JSON.parse(JSON.stringify(rc.COMPONENT_ASSERTIONS.C1)), C1_DESCRIPTORS) && eq(rc.COMPONENT_IMPLEMENTATIONS.C1.map((x) => x.id), C1_DESCRIPTORS.map((d) => d.id)), 'the C1 inventory and implementations are unchanged', rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C1);
      check(eq(JSON.parse(JSON.stringify(rc.COMPONENT_ASSERTIONS.C11a)), C11A_DESCRIPTORS) && eq(rc.COMPONENT_IMPLEMENTATIONS.C11a.map((x) => x.id), C11A_DESCRIPTORS.map((d) => d.id)), 'the C11a inventory and implementations are unchanged', rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C11a);
      const calls = [];
      const ret = rc.registerRc1Cases((...a) => calls.push(a), context);
      check(calls.length === 0 && (ret === undefined || (ret && typeof ret.then === 'function')), 'registerRc1Cases registers no complete numbered rc.1 case (C11b owns R79, R80 and R86)', calls.length);
      check(!rc.REQUIRED_CASE_IDS.includes('R79/C2/policy-schema') && rc.BASELINE_CASE_IDS.length === 60 && rc.RC1_CASE_IDS.length === 40, 'the baseline and rc.1 case ID lists are untouched', { baseline: rc.BASELINE_CASE_IDS.length, rc1: rc.RC1_CASE_IDS.length });
    });
    await step('7.11/9 the runner seam with the C2 inventory: fourteen successful outcomes print the exact section 9 records; a missing group, a failure and a forbidden skip fail as before', async () => {
      const rcm = await needSibling(failures, 'run-component-tests.mjs');
      if (!rcm) return;
      const results = path.join(context.tmp, 'component-results.json');
      const ran = [];
      const impl = (id, make) => ({ id, run: () => { ran.push(id); return make ? make() : { failures: [], skipped: null }; } });
      const exp = () => EXPECTED_DESCRIPTORS.map((d) => ({ ...d }));
      let captured = null;
      const seam = async (impls, writeEvidence = (report) => { captured = report; return results; }) => {
        ran.length = 0;
        const rec = await withStreamGuard(() => rcm.main(['--component', 'C2'], { context, registry: { expected: { C2: exp() }, implementations: { C2: impls } }, writeEvidence }));
        check(rec.threw === null && rec.out.length === 0 && rec.err.length === 0 && rec.exits.length === 0, 'main resolves and writes no process stream', rec.threw && errMsg(rec.threw));
        return rec.value;
      };
      const passing = EXPECTED_DESCRIPTORS.map((d) => impl(d.id));
      const ok = await seam(passing);
      const okLines = [...PLAN9_RECORDS, '14 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${results}`];
      check(ok && ok.exitCode === 0 && ok.stderr === '' && ok.stdout === `${okLines.join('\n')}\n`, 'fourteen successful outcomes yield exactly the section 9 records, totals and RESULTS line: exit 0, empty stderr, every line ending in LF', ok && ok.stdout);
      check(eq(ran, EXPECTED_DESCRIPTORS.map((d) => d.id)), 'each implementation ran once, in expected order', ran);
      check(captured && captured.component === 'C2' && captured.ok === true && eq(captured.errors, []) && eq(captured.summary, { passed: 14, failed: 0, skipped: 0 }) && Array.isArray(captured.results) && captured.results.length === 14
        && captured.results.every((r, i) => r.id === EXPECTED_DESCRIPTORS[i].id && r.name === EXPECTED_DESCRIPTORS[i].name && r.status === 'PASS' && eq(r.failures, [])), 'the report is { component C2, ok true, errors [], summary 14/0/0 } with fourteen PASS results matching the inventory', captured && { c: captured.component, ok: captured.ok, s: captured.summary });
      const missing = await seam(passing.slice(1));
      check(missing && missing.exitCode === 1 && missing.stderr === '' && missing.stdout === `COMPONENT  FAIL  missing-group  R79/C2/policy-schema\n0 PASS / 0 FAIL / 0 SKIP\nRESULTS  ${results}\n`, 'a missing first implementation yields missing-group and exit 1', missing && missing.stdout);
      check(ran.length === 0, 'a structural failure executes no implementation', ran);
      for (const index of [0, 7, 13]) {
        for (const [make, diag, label] of [[() => ({ failures: ['sentinel'], skipped: null }), 'sentinel', 'failures [sentinel]'], [() => ({ failures: [], skipped: 'sentinel' }), 'skip-forbidden: sentinel', 'skipped "sentinel"']]) {
          const impls = EXPECTED_DESCRIPTORS.map((d, i) => (i === index ? impl(d.id, make) : impl(d.id)));
          const v = await seam(impls);
          const lines = [...EXPECTED_DESCRIPTORS.flatMap((d, i) => (i === index ? [`FAIL  ${d.id}  ${d.name}`, `        - ${diag}`] : [`PASS  ${d.id}  ${d.name}`])), '13 PASS / 1 FAIL / 0 SKIP', `RESULTS  ${results}`];
          check(v && v.exitCode === 1 && v.stderr === '' && v.stdout === `${lines.join('\n')}\n`, `${label} at position ${index}: the FAIL record, the exact diagnostic, 13 PASS / 1 FAIL / 0 SKIP, exit 1`, v && v.stdout);
          check(ran.length === 14, `${label} at position ${index}: the remaining implementations still ran`, ran.length);
        }
      }
      const boom = await seam(passing, () => { throw new Error('disk full'); });
      check(boom && boom.exitCode === 1 && boom.stderr === '' && boom.stdout === 'COMPONENT  FAIL  evidence-write\n', 'a throwing evidence writer yields only COMPONENT  FAIL  evidence-write', boom);
    });
    await step('7.1/7.11 tests/run-tests.mjs: R15 embeds the C2 assertions, S01 and S02 assert schema 3, names and baseline protections are unchanged', async () => {
      const src = readText(path.join(context.skillRoot, 'tests', 'run-tests.mjs'));
      if (src === null) { check(false, 'tests/run-tests.mjs is readable'); return; }
      check(/test\('R15', 'ownership metadata is bound to the approved plan', async \(\) =>/.test(src), 'R15 keeps its ID and name and is now async');
      check((src.match(/runComponentAssertions\('C2'/g) || []).length === 1 && src.includes("path.join(TMP, 'c2')") && /repository: path\.resolve\(SKILL, '\.\.'\), skillRoot: SKILL, tmp: path\.join\(TMP, 'c2'\), env: \{ \.\.\.ENV \}/.test(src), 'R15 embeds exactly one runComponentAssertions(\'C2\', context) with the exact context of plan 7.1');
      check(src.includes("test('S01', 'fresh setup end to end, validate clean'") && src.includes("test('S02', 'rerun with identical inputs is a zero diff (files and manifest)'"), 'S01 and S02 keep their IDs and names');
      const s01 = src.slice(src.indexOf("test('S01'"), src.indexOf("test('S02'"));
      const s02 = src.slice(src.indexOf("test('S02'"), src.indexOf("test('S03'"));
      check(/metadataChanged/.test(s01) && /schema === 3/.test(s01) && /needsUpdate/.test(s01) && /'current'/.test(s01), 'S01 asserts metadataChanged 0, schema 3 and the detect update/current report');
      check(/schema === 3/.test(s02) && /byte-identical/.test(s02), 'S02 asserts the schema 3 manifest stays byte-identical');
      check(!/schema\s*===?\s*2|schema:\s*2\b/.test(src), 'no baseline assertion hardcodes a newly written manifest as schema 2');
      check(src.includes("test('R29', 'prepare: files the skill does not own may only gain new blocks; everything else needs explicit approval'"), 'R29 (including its (d) regression guard) is unchanged');
    });
  });
}

// ============================================================ registration ====
// The array wired into COMPONENT_IMPLEMENTATIONS.C2 (plan 7.1): frozen, descriptors frozen, in the plan order.
export const C2_IMPLEMENTATIONS = Object.freeze([
  { id: 'R79/C2/policy-schema', run: (context) => policySchema(context) },
  { id: 'R79/C2/settings-schema', run: (context) => settingsSchema(context) },
  { id: 'R79/C2/manifest-schema', run: (context) => manifestSchema(context) },
  { id: 'R86/C2/omissions', run: (context) => omissions(context) },
  { id: 'R86/C2/metadata-only', run: (context) => metadataOnly(context) },
  { id: 'R86/C2/mixed-transaction', run: (context) => mixedTransaction(context) },
  { id: 'R80/C2/input-binding', run: (context) => inputBinding(context) },
  { id: 'R02/C2/diff-output', run: (context) => diffOutput(context) },
  { id: 'R02/C2/no-git', run: (context) => noGit(context) },
  { id: 'R02/C2/diff-safety', run: (context) => diffSafety(context) },
  { id: 'R15/C2/metadata-binding', run: (context) => metadataBinding(context) },
  { id: 'R29/C2/approval-noop', run: (context) => approvalNoop(context) },
  { id: 'V2/C2/recovery', run: (context) => recovery(context) },
  { id: 'V2/C2/module-contract', run: (context) => moduleContract(context) },
].map((d) => Object.freeze(d)));
