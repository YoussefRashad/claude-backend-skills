// C11a tests lane: the eight component assertions of "Shipped v2 baselines and test infrastructure".
//
// Written from the frozen plans only, before any implementation exists:
//   docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md   (sections 2.2, 3, 4, 5 and the N-a / N-b addendum)
//   docs/plans/2026-10-15-project-setup-v3-rc1.md        (takes precedence)
//   docs/plans/2026-10-15-project-setup-v3-rc1-c11a-decisions.md   (maintainer decisions G1-G14; they complete the plan)
// The implementer wires C11A_IMPLEMENTATIONS into COMPONENT_IMPLEMENTATIONS.C11a and must not edit this file.
//
// Importing this module runs nothing. The implementation modules (tests/helpers/v2-baseline.mjs, rc1-cases.mjs,
// run-component-tests.mjs, accept-rc1.mjs) are imported lazily inside run(context): rc1-cases.mjs imports this file,
// so a static import back would be circular, and a missing module must fail one assertion, not the whole import.
//
// Every run(context) returns { failures, skipped: null }. There is no skip path (plan 3.1: a skip is a failure).
// Scratch data lives under context.tmp only. Nothing is written inside the repository working tree.
// Positive v2 tests use the real local tag; negative tests use temporary copies and injected executor responses.
// Every value below is exact. Where the plan was silent, the decisions G1-G14 fix it and the tests cite them by number.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const modUrl = (rel) => new URL(rel, import.meta.url).href;

// ============================================================ literals ====
// Written out independently of the implementation (plan 4.6: "independently written literal copy").
const PIN = Object.freeze({ tag: 'project-setup-v2.0.0', commit: '13566046529bf51fb8fb6d0c83f79c03e1b90eaa', tree: '4d032fb8fd7023aef233e94f59c0827f24a7a91a', skillVersion: '2.0.0' });
const RUN_ID = 'v2-baseline-0001';
const NESTED_ENV = 'PS_C11A_NESTED';

const COMPONENT_INVENTORY = [
  ['V2/C11a/tag-identity', 'trusted v2 tag identity'],
  ['V2/C11a/snapshot-inventory', 'exhaustive v2 snapshot mapping'],
  ['V2/C11a/snapshot-bytes', 'raw tagged snapshot byte parity'],
  ['V2/C11a/installed-fixture', 'tagged v2 installation and provenance'],
  ['V2/C11a/fixture-failures', 'v2 fixture failures are fatal'],
  ['V2/C11a/live-v2', 'live v2 fixture and existing kinds'],
  ['V2/C11a/component-records', 'strict component result contract'],
  ['V2/C11a/strict-gate', 'strict rc1 acceptance contract'],
];

const SNAPSHOT_MAP = [
  ['data/secret-paths-v2.0.0.json', 'data/secret-paths.json'],
  ['data/v2.0.0/assets/agents/reviewer.md', 'assets/agents/reviewer.md'],
  ['data/v2.0.0/assets/agents/docs-sync.md', 'assets/agents/docs-sync.md'],
  ['data/v2.0.0/assets/wrappers/claude-reviewer.md', 'assets/wrappers/claude-reviewer.md'],
  ['data/v2.0.0/assets/wrappers/claude-docs-sync.md', 'assets/wrappers/claude-docs-sync.md'],
  ['data/v2.0.0/assets/wrappers/codex-reviewer.toml', 'assets/wrappers/codex-reviewer.toml'],
  ['data/v2.0.0/assets/wrappers/codex-docs_sync.toml', 'assets/wrappers/codex-docs_sync.toml'],
];
const SNAPSHOT_ENTRIES = SNAPSHOT_MAP.map(([snapshot, source]) => ({ snapshot, source }));

const CONTEXT_DOCS = ['project-tree', 'critical-modules', 'code-patterns', 'error-contract', 'configuration', 'glossary'];
const TARGETS = [
  ['AGENTS.md', 'blocks'], ['CLAUDE.md', 'blocks'], ['.gitignore', 'blocks'],
  ['.ai/security-paths.json', 'full'], ['.ai/tools/git-safe.mjs', 'full'],
  ['.ai/agents/reviewer.md', 'full'], ['.ai/agents/docs-sync.md', 'full'],
  ['.claude/agents/reviewer.md', 'full'], ['.claude/agents/docs-sync.md', 'full'],
  ['.codex/agents/reviewer.toml', 'full'], ['.codex/agents/docs_sync.toml', 'full'],
  ['.claude/settings.json', 'keys'],
  ...CONTEXT_DOCS.map((f) => [`.ai/context/${f}.md`, 'merged']),
  ['.ai/decisions/README.md', 'merged'],
  ['docs/api-conventions.md', 'merged'], ['docs/database.md', 'merged'], ['docs/observability.md', 'merged'],
  ['TODO.md', 'merged'],
];
const TARGET_ENTRIES = TARGETS.map(([target, ownership]) => ({ target, ownership }));
const AGENTS_BLOCK_IDS = ['overview', 'critical-rules', 'commands', 'navigation', 'local-instructions', 'agents'];

// Tagged source for each full-ownership target (relative to project-setup/ at the tag).
const FULL_SOURCES = {
  '.ai/security-paths.json': 'data/secret-paths.json',
  '.ai/tools/git-safe.mjs': 'assets/tools/git-safe.mjs',
  '.ai/agents/reviewer.md': 'assets/agents/reviewer.md',
  '.ai/agents/docs-sync.md': 'assets/agents/docs-sync.md',
  '.claude/agents/reviewer.md': 'assets/wrappers/claude-reviewer.md',
  '.claude/agents/docs-sync.md': 'assets/wrappers/claude-docs-sync.md',
  '.codex/agents/reviewer.toml': 'assets/wrappers/codex-reviewer.toml',
  '.codex/agents/docs_sync.toml': 'assets/wrappers/codex-docs_sync.toml',
};
const RENDERED_TARGETS = new Set(['.ai/agents/reviewer.md', '.ai/agents/docs-sync.md']);

const DENY_GLOBS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx', '**/*.crt', '**/*.cer', '**/*.jks', '**/*.keystore',
  '**/id_rsa*', '**/id_ed25519*', '**/secrets/**', '**/credentials/**', '**/.aws/**', '**/.ssh/**', '**/.gnupg/**', '**/.npmrc',
  '**/.ai/.run/*/vault/**',
];
const DENY_COMMANDS = [
  'Bash(rm -rf *)', 'Bash(git reset --hard*)', 'Bash(git clean *)', 'Bash(git push --force*)', 'Bash(git push -f*)',
  'Bash(git checkout -- *)', 'Bash(git restore *)', 'Bash(curl * | bash*)', 'Bash(curl * | sh*)', 'Bash(wget * | bash*)',
  'Bash(npm publish*)', 'Bash(terraform apply*)', 'Bash(terraform destroy*)', 'Bash(kubectl delete *)', 'Bash(helm uninstall *)',
  'PowerShell(Remove-Item * -Recurse*)', 'PowerShell(git reset --hard*)', 'PowerShell(git clean *)',
  'PowerShell(git push --force*)', 'PowerShell(git push -f*)', 'PowerShell(npm publish*)',
  'PowerShell(Invoke-Expression *)', 'PowerShell(iex *)',
];
const DENY = [...DENY_GLOBS.map((g) => `Read(${g})`), ...DENY_COMMANDS];
const DEFAULT_ALLOWS = ['Bash(npm test)', 'Bash(node .ai/tools/git-safe.mjs *)'];
const SETTINGS_SCHEMA = 'https://json.schemastore.org/claude-code-settings.json';

const PHASES = ['lock-acquire', 'init', 'blocks', 'merge', 'prepare', 'commit', 'validate', 'lock-release'];
const PHASE_SCRIPTS = ['scripts/lock.mjs', 'scripts/apply.mjs', 'scripts/blocks.mjs', 'scripts/merge-claude-settings.mjs', 'scripts/apply.mjs', 'scripts/apply.mjs', 'scripts/validate.mjs', 'scripts/lock.mjs'];
const PLACEHOLDERS = {
  ONE_LINE_PURPOSE: 'Synthetic v2 fixture.', STACK_WITH_VERSIONS: 'Node.js', PACKAGE_MANAGER: 'npm', RUNTIME_VERSION: 'unknown',
  DB_CHANGE_POLICY: 'unknown', VERIFIED_COMMANDS: '- No project commands verified.', NESTED_INSTRUCTION_INDEX: '- none',
};

const BASELINE_IDS = ('R01 R02 R03a R03b R04a R04b R05 R06 R06b R07 R08 R09 R10 R11 R12 ' +
  'R13a R13b R13c R13d R14a R14b R15 R16 R17 R18 R19 R20 R21 R22 ' +
  'R23a R23b R24 R25 R26 R27a R27b R27c R27d R28 R29 R30 R31 R32 ' +
  'R33 R34 R35 R36 R37 R38 R39 R40 S01 S02 S03 S04 S05 S06 S07 S08 S09').split(' ');
const NUMBERED_IDS = ('R41 R42 R43 R44 R45 R46 R47 R48 R49 R50 R51 R52 R53 R54 ' +
  'R65 R66 R67 R68 R72 R73 R74 R75 R76 R77 R78 R79 R80 R81 R82 R84 R85 R86 R90 R91 R92 R93 R97 R100').split(' ');
const NAMED_IDS = ['A5-templates', 'N8-doctor'];
const ADDITIONAL_IDS = [...NUMBERED_IDS, ...NAMED_IDS];
const REQUIRED_IDS = [...BASELINE_IDS, ...ADDITIONAL_IDS];
const R13D_REASON = 'cannot create file symlink (Windows without Developer Mode)';
const GATE_ENV = Object.freeze({ platform: 'win32', release: 'fixture', node: 'fixture', git: 'fixture' });

// ===================================================== generic utilities ====
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const fwd = (p) => String(p).replace(/\\/g, '/');
const normText = (input) => { let s = Buffer.isBuffer(input) ? input.toString('utf8') : String(input); if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); s = s.replace(/\r\n?/g, '\n'); return s.endsWith('\n') ? s : s + '\n'; };
const eq = (a, b) => isDeepStrictEqual(a, b);
const isErr = (e) => e instanceof Error;
const plain = (o) => JSON.parse(JSON.stringify(o));
function fmt(d) {
  if (typeof d === 'string') return d.slice(0, 600);
  try { return (JSON.stringify(d, (k, v) => (typeof v === 'bigint' ? String(v) : v)) ?? String(d)).slice(0, 600); } catch { return String(d).slice(0, 600); }
}
function mkCheck(failures) { return (cond, msg, detail) => { if (!cond) failures.push(detail === undefined ? msg : `${msg} :: ${fmt(detail)}`); }; }
function deepFrozen(v) { if (v === null || typeof v !== 'object') return true; return Object.isFrozen(v) && Object.values(v).every(deepFrozen); }
function deepFreeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }
const errMsg = (e) => String((e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) || e).slice(0, 500);

// Runs one assertion body. `step` isolates sections so one failing section never hides the others.
async function runAssertion(body) {
  const failures = [];
  const check = mkCheck(failures);
  const step = async (name, fn) => { try { await fn(); } catch (e) { failures.push(`${name}: threw: ${errMsg(e)}`); } };
  try { await body({ failures, check, step }); } catch (e) { failures.push(`threw: ${errMsg(e)}`); }
  return { failures, skipped: null };
}
async function need(failures, rel) {
  try { return await import(modUrl(rel)); } catch (e) { failures.push(`cannot import ${rel}: ${errMsg(e)}`); return null; }
}

function canon(p) {
  let cur = path.resolve(p); const rest = [];
  for (;;) {
    try { const r = fs.realpathSync.native(cur); return path.join(r, ...rest.reverse()); } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur)); cur = up;
    }
  }
}
const samePath = (a, b) => { const x = canon(a), y = canon(b); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };
const isInside = (parent, child) => { const rel = path.relative(canon(parent), canon(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };
const write = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
function listFiles(dir, skipGit = false) {
  const out = [];
  const walk = (d, rel) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (skipGit && rel === '' && e.name === '.git') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}
// Links (junctions, symlinks) are hashed by their target text and never followed.
const treeHashes = (dir) => Object.fromEntries(listFiles(dir, true).map((r) => { const p = path.join(dir, r); return [r, fs.lstatSync(p).isSymbolicLink() ? `link:${fs.readlinkSync(p)}` : sha256(fs.readFileSync(p))]; }));
function tryLink(target, link, kind) { try { fs.symlinkSync(target, link, kind); return true; } catch { return false; } }

// ------------------------------------------------------ scope and git ----
function newScope(context, label) {
  fs.mkdirSync(context.tmp, { recursive: true });
  const dir = fs.mkdtempSync(path.join(context.tmp, `c11a-${label}-`));
  const home = path.join(dir, 'iso-home'), hooks = path.join(dir, 'iso-hooks'), tpl = path.join(dir, 'iso-tpl'), cfg = path.join(dir, 'iso-gitconfig');
  for (const d of [home, hooks, tpl]) fs.mkdirSync(d);
  fs.writeFileSync(cfg, ['[user]', '\tname = Fixture', '\temail = fixture@example.invalid', '[core]', '\tautocrlf = false', `\thooksPath = ${fwd(hooks)}`,
    '[commit]', '\tgpgsign = false', '[tag]', '\tgpgsign = false', '[init]', '\tdefaultBranch = main', `\ttemplateDir = ${fwd(tpl)}`, ''].join('\n'));
  const iso = {};
  for (const [k, v] of Object.entries({ ...process.env, ...context.env })) if (!/^GIT_/i.test(k) && typeof v === 'string') iso[k] = v;
  Object.assign(iso, { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: cfg, GIT_TERMINAL_PROMPT: '0' });
  let n = 0;
  return { dir, iso, cfg, sub: (name) => path.join(dir, `${name}${++n}`) };
}
function git(env, cwd, args, extra = {}) {
  const r = spawnSync('git', args, { cwd, env, encoding: null, windowsHide: true, shell: false, timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...extra });
  const out = r.stdout || Buffer.alloc(0), err = r.stderr || Buffer.alloc(0);
  return { status: r.status, error: r.error || null, stdout: out, stderr: err.toString('utf8'), text: out.toString('utf8').trim() };
}
function mustGit(env, cwd, args, what) {
  const r = git(env, cwd, args);
  if (r.status !== 0) throw new Error(`${what || `git ${args.join(' ')}`} failed: ${r.stderr.slice(0, 300)}`);
  return r;
}
function makeProject(scope, dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  mustGit(scope.iso, dir, ['init', '-q'], 'git init');
  for (const [rel, content] of Object.entries(files || { 'package.json': '{"name":"fixture-app"}\n', 'src/a.ts': 'export {}\n' })) write(path.join(dir, rel), content);
  mustGit(scope.iso, dir, ['add', '-A'], 'git add');
  mustGit(scope.iso, dir, ['commit', '-q', '-m', 'init'], 'git commit');
  return dir;
}
// Reads the real repository. The tag is read by the pinned commit id, not by name, so these helpers do not
// depend on the code under test.
const repoSafe = (context) => ['-c', `safe.directory=${fwd(canon(context.repository))}`];
const repoGit = (scope, context, args) => git({ ...scope.iso, GIT_NO_REPLACE_OBJECTS: '1' }, context.repository, [...repoSafe(context), ...args]);
const BLOB_CACHE = new Map();
function tagBlob(scope, context, rel) {
  const key = `${canon(context.repository)}|${rel}`;
  if (!BLOB_CACHE.has(key)) {
    const r = repoGit(scope, context, ['cat-file', 'blob', `${PIN.commit}:project-setup/${rel}`]);
    if (r.status !== 0) throw new Error(`cannot read tagged blob ${rel}: ${r.stderr.slice(0, 200)}`);
    BLOB_CACHE.set(key, r.stdout);
  }
  return Buffer.from(BLOB_CACHE.get(key));
}
function tagLeaves(scope, context) {
  const r = repoGit(scope, context, ['ls-tree', '-r', '-z', `${PIN.commit}:project-setup`]);
  if (r.status !== 0) throw new Error(`cannot list the tagged tree: ${r.stderr.slice(0, 200)}`);
  return r.stdout.toString('latin1').split('\0').filter(Boolean).map((rec) => {
    const m = rec.match(/^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s);
    return { mode: m[1], type: m[2], oid: m[3], path: m[4] };
  });
}

// ------------------------------------------------- executor test doubles ----
// The helper's optional executor is execute(executable, args, options) -> ProcessResult<Buffer> (plan 2.4).
const proc = (over = {}, stdout = '') => ({ status: 0, signal: null, error: null, timedOut: false, truncated: false, stdout: Buffer.from(stdout), stderr: Buffer.alloc(0), ...over });
const FAULTS = {
  timeout: () => proc({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'spawnSync ETIMEDOUT' }, timedOut: true }),
  timeoutFlagOnly: () => proc({ timedOut: true }),
  truncated: () => proc({ status: null, signal: 'SIGTERM', error: { code: 'ENOBUFS', message: 'spawnSync ENOBUFS' }, truncated: true }),
  truncatedFlagOnly: () => proc({ truncated: true }),
  both: () => proc({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'spawnSync ETIMEDOUT' }, timedOut: true, truncated: true }),
  spawnError: () => proc({ status: null, error: { code: 'ENOENT', message: 'spawn ENOENT' } }),
  signal: () => proc({ status: null, signal: 'SIGKILL' }),
};
const FAULT_CODES = { timeout: 'V2_PROCESS_TIMEOUT', timeoutFlagOnly: 'V2_PROCESS_TIMEOUT', truncated: 'V2_PROCESS_TRUNCATED', truncatedFlagOnly: 'V2_PROCESS_TRUNCATED', both: 'V2_PROCESS_TIMEOUT', spawnError: 'V2_PROCESS_FAILED', signal: 'V2_PROCESS_FAILED' };

function realExecute(executable, args, options) {
  const r = spawnSync(executable, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true, encoding: null, timeout: options.timeout, maxBuffer: options.maxBuffer });
  const code = r.error && r.error.code ? r.error.code : null;
  return { status: r.status === undefined ? null : r.status, signal: r.signal || null, error: r.error ? { code, message: String(r.error.message) } : null, timedOut: code === 'ETIMEDOUT', truncated: code === 'ENOBUFS', stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0) };
}
function gitSub(args) {
  for (let i = 0; i < args.length; i++) { const a = String(args[i]); if (a === '-c' || a === '-C') { i++; continue; } if (a.startsWith('-')) continue; return a; }
  return null;
}
function phaseOf(script, sub) {
  if (script === 'merge-claude-settings.mjs') return 'merge';
  if (script === 'validate.mjs') return 'validate';
  if (script === 'blocks.mjs') return 'blocks';
  if (script === 'lock.mjs') return sub === 'acquire' ? 'lock-acquire' : sub === 'release' ? 'lock-release' : sub;
  if (script === 'apply.mjs') return sub;
  return null;
}
function classify(executable, args, options, n) {
  const isGit = executable === 'git', isNode = executable === process.execPath;
  const script = isNode ? path.basename(String(args[0] || '')) : null;
  return { n, executable, args: [...args], options, optionKeys: Object.keys(options || {}).sort(), env: options && options.env ? { ...options.env } : {}, cwd: options && options.cwd, isGit, isNode, sub: isGit ? gitSub(args) : null, script, phase: isNode ? phaseOf(script, args[1]) : null };
}
// handler(call, run) may return a ProcessResult (or a Promise of one) to replace the real execution, or undefined to
// run the real process. run(argsOverride) executes the real process. A handler that throws makes the executor throw.
function makeExec(handler, { async: asyncMode = false } = {}) {
  const calls = [];
  const exec = (executable, args, options) => {
    const call = classify(executable, args, options, calls.length);
    calls.push(call);
    const compute = () => { const run = (a) => realExecute(executable, a || args, options); const r = handler ? handler(call, run, calls) : undefined; return r === undefined ? run() : r; };
    if (!asyncMode) return compute();
    return new Promise((resolve, reject) => setImmediate(() => { try { resolve(compute()); } catch (e) { reject(e); } }));
  };
  exec.calls = calls;
  return exec;
}
// Git reads are deterministic, so a cache keeps the many parity runs fast while still recording every call.
function makeCachedExec(extraHandler) {
  const cache = new Map();
  return makeExec((call, run, calls) => {
    if (extraHandler) { const r = extraHandler(call, run, calls); if (r !== undefined) return r; }
    if (!call.isGit) return undefined;
    const key = JSON.stringify([call.args, String(call.cwd), call.env.GIT_NO_REPLACE_OBJECTS]);
    if (!cache.has(key)) cache.set(key, run());
    const r = cache.get(key);
    return { ...r, stdout: Buffer.from(r.stdout), stderr: Buffer.from(r.stderr) };
  });
}
const nodeCalls = (calls) => calls.filter((c) => c.isNode);
const phaseSeq = (calls) => nodeCalls(calls).map((c) => c.phase);
const isRecursiveLs = (c) => c.isGit && c.sub === 'ls-tree' && c.args.some((a) => a === '--recursive' || /^-[A-Za-z]*r[A-Za-z]*$/.test(a));
const swapHex = (buf, from, to) => Buffer.from(buf.toString('latin1').split(from).join(to), 'latin1');
const FAKE_COMMIT = 'a'.repeat(40), FAKE_TREE = 'b'.repeat(40);
// Pretends the tag peels to a different commit (or its subtree to a different tree): output ids are swapped on the
// way out and swapped back on the way in, so every other read behaves normally.
function swapExec(from, to) {
  return makeExec((call, run) => {
    if (!call.isGit || call.sub === 'show-ref') return undefined;
    const r = run(call.args.map((a) => String(a).split(to).join(from)));
    return { ...r, stdout: swapHex(r.stdout, from, to) };
  });
}
// The cursor for ls-tree surgery: mutates one record of the recursive listing. Decision G1: git ls-tree -r -z is read in git's default
// record format, "<mode> SP <type> SP <oid> TAB <path>" with a NUL after each record, and no --format option is used.
function lsTreeMutator(which, fn) {
  return makeExec((call, run) => {
    if (!isRecursiveLs(call)) return undefined;
    const r = run();
    const recs = r.stdout.toString('latin1').split('\0'); const tail = recs.pop();
    if (!recs.length || r.status !== 0) return r;
    const i = which === 'first' ? 0 : recs.length - 1;
    const m = recs[i].match(/^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s);
    if (!m) return r;
    recs[i] = fn({ mode: m[1], type: m[2], oid: m[3], path: m[4] });
    return { ...r, stdout: Buffer.from(recs.join('\0') + '\0' + (tail || ''), 'latin1') };
  });
}
const lsRecord = (o) => `${o.mode} ${o.type} ${o.oid}\t${o.path}`;
// G1: the recursive listing is NUL-delimited and read in the default record format (no --format, no size column, no names-only).
function checkLsFormat(check, label, calls) {
  const ls = calls.filter(isRecursiveLs);
  check(ls.length >= 1, `${label}: the tagged subtree is listed with a recursive ls-tree`, ls.length);
  for (const c of ls) {
    check(c.args.some((a) => a === '-z' || /^-[A-Za-z]*z[A-Za-z]*$/.test(String(a))), `${label}: the listing is NUL-delimited (-z)`, c.args);
    check(!c.args.some((a) => /^--format/.test(String(a)) || ['-l', '--long', '--name-only', '--name-status', '--object-only'].includes(String(a))), `${label}: the listing uses git's default record format (no --format, -l, --name-only, --name-status, --object-only)`, c.args);
  }
}

// ------------------------------------------------------- error helpers ----
async function attempt(fn) { try { return { threw: false, value: await fn() }; } catch (e) { return { threw: true, error: e }; } }
// Helper failures are Error objects with code, phase and a message that starts with the code (plan 2.4). Decision G4: phase is the
// phase name for every phase-related error and null only for a failure before any tagged script runs, so the default expectation is
// null and every script-phase call site passes its phase.
async function expectCode(check, label, fn, code, opts = {}) { return expectFail(check, label, await attempt(fn), code, opts); }
function expectFail(check, label, r, code, opts = {}) {
  if (!r.threw) { check(false, `${label}: expected ${code}, got a result`, r.value && typeof r.value === 'object' ? Object.keys(r.value) : r.value); return null; }
  const e = r.error;
  check(isErr(e), `${label}: the thrown value is an Error`, e);
  check(e && e.code === code, `${label}: code is ${code}`, { code: e && e.code, message: e && e.message });
  check(typeof (e && e.message) === 'string' && e.message.startsWith(code), `${label}: message starts with the code`, e && e.message);
  const wantPhase = opts.phase === undefined ? null : opts.phase;
  check(e !== null && typeof e === 'object' && 'phase' in e && e.phase === wantPhase, `${label}: phase is ${wantPhase === null ? 'null (before any tagged script runs)' : wantPhase}`, e && e.phase);
  for (const needle of opts.noLeak || []) check(!String(e && e.message).includes(needle), `${label}: message never carries file contents`);
  return e;
}
const errToken = (e) => (e && typeof e.code === 'string' ? e.code : (String((e && e.message) || '').match(/^[A-Z][A-Z0-9_]+/) || [null])[0]);

// The recording-executor contract of plan 4.1: every direct Git call and every tagged-script child.
function checkCalls(check, label, calls, context, { synthetic = [] } = {}) {
  const want = `safe.directory=${fwd(canon(context.repository))}`;
  const optKeys = ['cwd', 'encoding', 'env', 'maxBuffer', 'shell', 'timeout', 'windowsHide'];
  calls.forEach((c, i) => {
    const at = `${label} call ${i} (${c.isGit ? `git ${c.sub}` : c.isNode ? `node ${c.script}` : c.executable})`;
    check(c.isGit || c.isNode, `${at}: executable is git or process.execPath`, c.executable);
    check(eq(c.optionKeys, optKeys), `${at}: exact option set`, c.optionKeys);
    const o = c.options || {};
    check(o.shell === false && o.windowsHide === true && o.encoding === null && o.timeout === 60000 && o.maxBuffer === 16777216, `${at}: shell false, windowsHide, encoding null, timeout 60000, maxBuffer 16777216`, { shell: o.shell, windowsHide: o.windowsHide, encoding: o.encoding, timeout: o.timeout, maxBuffer: o.maxBuffer });
    check(typeof c.cwd === 'string' && path.isAbsolute(c.cwd), `${at}: cwd is an absolute path`, c.cwd);
    check(c.env.GIT_NO_REPLACE_OBJECTS === '1', `${at}: GIT_NO_REPLACE_OBJECTS is "1"`, c.env.GIT_NO_REPLACE_OBJECTS);
    check(c.env.GIT_CONFIG_NOSYSTEM === '1' && c.env.GIT_TERMINAL_PROMPT === '0', `${at}: system git config ignored, prompts disabled`, { nosystem: c.env.GIT_CONFIG_NOSYSTEM, prompt: c.env.GIT_TERMINAL_PROMPT });
    check(typeof c.env.GIT_CONFIG_GLOBAL === 'string' && c.env.GIT_CONFIG_GLOBAL !== process.env.GIT_CONFIG_GLOBAL, `${at}: isolated global git config`, c.env.GIT_CONFIG_GLOBAL);
    if (process.env.USERPROFILE) check(c.env.USERPROFILE !== process.env.USERPROFILE, `${at}: isolated USERPROFILE`);
    if (process.env.HOME) check(c.env.HOME !== process.env.HOME, `${at}: isolated HOME`);
    if (c.isGit) {
      check(c.args[0] === '-c' && typeof c.args[1] === 'string' && c.args[1].startsWith('safe.directory='), `${at}: starts with -c safe.directory=`, c.args.slice(0, 2));
      check(!c.args.some((a) => /safe\.directory=\*/.test(String(a))), `${at}: never a wildcard safe.directory`, c.args.slice(0, 2));
      if (samePath(c.cwd, context.repository)) check(c.args[1] === want, `${at}: safe.directory is the canonical forward-slash repository root`, c.args[1]);
      else if (!synthetic.some((s) => samePath(c.cwd, s))) check(false, `${at}: git runs in the distribution repository or the synthetic project`, c.cwd);
      check(!NETWORK_SUBS.includes(c.sub) && !c.args.some((a) => /:\/\//.test(String(a)) || /^git@/.test(String(a))), `${at}: no fetch and no network remote`, c.args);
    }
  });
}
const NETWORK_SUBS = ['fetch', 'pull', 'clone', 'ls-remote', 'push', 'remote', 'submodule'];
const noContentOrScripts = (calls) => calls.every((c) => !c.isNode && !isRecursiveLs(c));

// ------------------------------------------------------- import safety ----
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
// Plan 2.3: imports perform no filesystem writes, subprocess execution, test execution or CLI dispatch.
function checkImportSafe(check, label, scope, rel, expectNames) {
  const file = `${scope.sub('probe')}.mjs`;
  fs.writeFileSync(file, PROBE_SOURCE);
  const r = spawnSync(process.execPath, [file, modUrl(rel)], { cwd: scope.dir, env: { ...scope.iso }, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  let log = null; try { log = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch { /* reported below */ }
  check(r.status === 0 && log, `${label}: the import probe ran`, { status: r.status, stderr: String(r.stderr).slice(0, 300), stdout: String(r.stdout).slice(0, 300) });
  if (!log) return null;
  check(log.err === null, `${label}: imports cleanly`, log.err);
  check(log.spawns.length === 0, `${label}: import spawns no subprocess`, log.spawns);
  check(log.writes.length === 0, `${label}: import writes nothing`, log.writes);
  check(log.stdout.length === 0 && log.stderr.length === 0, `${label}: import prints nothing (no CLI dispatch, no test run)`, { out: log.stdout.join('').slice(0, 200), err: log.stderr.join('').slice(0, 200) });
  check(log.exits.length === 0 && log.exitCode === null, `${label}: import neither exits nor sets an exit code`, { exits: log.exits, exitCode: log.exitCode });
  for (const n of expectNames || []) check(log.names.includes(n), `${label}: exports ${n}`, log.names);
  return log;
}

// ---------------------------------------------------- hostile environment ----
async function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined;
  try { for (const [k, v] of Object.entries(vars)) process.env[k] = v; return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
// Failing hooks, mandatory signing with a broken gpg, a template that installs a hook, stray GIT_* variables.
function hostileSetup(scope) {
  const h = path.join(scope.dir, 'hostile'), hooks = path.join(h, 'hooks'), home = path.join(h, 'home'), sentinel = path.join(h, 'hook-ran.txt');
  fs.mkdirSync(hooks, { recursive: true }); fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(path.join(h, 'template', 'hooks'), { recursive: true });
  const cfg = `[core]\n\thooksPath = ${fwd(hooks)}\n[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n[init]\n\ttemplateDir = ${fwd(path.join(h, 'template'))}\n[user]\n\tname = Hostile\n\temail = hostile@example.invalid\n`;
  for (const name of ['pre-commit', 'post-commit', 'commit-msg', 'post-checkout', 'reference-transaction', 'post-index-change']) {
    const body = `#!/bin/sh\necho ${name} >> "${fwd(sentinel)}"\nexit 1\n`;
    write(path.join(hooks, name), body); write(path.join(h, 'template', 'hooks', name), body);
    try { fs.chmodSync(path.join(hooks, name), 0o755); fs.chmodSync(path.join(h, 'template', 'hooks', name), 0o755); } catch { /* not supported */ }
  }
  write(path.join(h, 'gitconfig'), cfg); write(path.join(home, '.gitconfig'), cfg);
  const vars = {
    GIT_DIR: path.join(h, 'missing-gitdir'), GIT_WORK_TREE: h, GIT_INDEX_FILE: path.join(h, 'bogus-index'),
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: fwd(hooks), GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'true',
    GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true' 'gpg.program'='false'", GIT_CONFIG_GLOBAL: path.join(h, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '0',
    GIT_AUTHOR_NAME: 'Hostile', GIT_COMMITTER_NAME: 'Hostile', GIT_NO_REPLACE_OBJECTS: '0', GIT_TERMINAL_PROMPT: '1', HOME: home, USERPROFILE: home,
  };
  return { vars, home, sentinel };
}
// The only variables a child may still carry are the isolated replacements; every other hostile one must be gone.
function checkHostileGone(check, label, calls, hostile) {
  const replaced = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_NO_REPLACE_OBJECTS', 'GIT_TERMINAL_PROMPT', 'HOME', 'USERPROFILE'];
  const gone = Object.keys(hostile.vars).filter((k) => !replaced.includes(k));
  check(calls.length > 0, `${label}: the executor was used`);
  calls.forEach((c, i) => {
    for (const k of gone) check(!(k in c.env), `${label} call ${i}: inherited ${k} is removed`, c.env[k]);
    check(c.env.GIT_CONFIG_GLOBAL !== hostile.vars.GIT_CONFIG_GLOBAL && c.env.GIT_CONFIG_NOSYSTEM === '1', `${label} call ${i}: hostile global/system git config is replaced`, { global: c.env.GIT_CONFIG_GLOBAL, nosystem: c.env.GIT_CONFIG_NOSYSTEM });
    check(c.env.HOME !== hostile.home && c.env.USERPROFILE !== hostile.home, `${label} call ${i}: HOME and USERPROFILE are isolated`);
    check(c.env.GIT_NO_REPLACE_OBJECTS === '1' && c.env.GIT_TERMINAL_PROMPT === '0', `${label} call ${i}: replacement disabled and prompts off`);
  });
}

// ============================================ review-defect support (R1-R8) ====
// Shared by the tests that cover the eight defects a review found after the first implementation. Each test that uses them quotes the
// plan clause or maintainer decision (H1-H6, docs/plans/2026-10-15-project-setup-v3-rc1-c11a-review-decisions.md) it rests on.
// Makes the named filesystem operations fail with EACCES for exactly one path while fn runs: the synchronous, callback and promise forms.
// The helper under test shares this process's fs module, so this is a real fault at the boundary of the code being tested; nothing in the
// helper's interface is involved. Returns the attempt result of fn and the operations that were actually hit.
async function withFsFault(target, operations, fn) {
  const norm = (p) => { if (typeof p !== 'string') return null; const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const want = norm(target), saved = [], hits = [];
  const fail = (op, p) => Object.assign(new Error(`EACCES: permission denied, ${op} '${p}'`), { errno: -13, code: 'EACCES', syscall: op, path: String(p) });
  const patch = (obj, name, wrap) => { if (typeof obj[name] !== 'function') return; saved.push([obj, name, obj[name]]); obj[name] = wrap(obj[name]); };
  for (const op of operations) {
    patch(fs, `${op}Sync`, (orig) => function (p, ...rest) { if (norm(p) === want) { hits.push(`${op}Sync`); throw fail(op, p); } return orig.call(this, p, ...rest); });
    patch(fs, op, (orig) => function (p, ...rest) { if (norm(p) === want) { hits.push(op); const cb = rest.find((x) => typeof x === 'function'); process.nextTick(() => { if (cb) cb(fail(op, p)); }); return undefined; } return orig.call(this, p, ...rest); });
    patch(fs.promises, op, (orig) => function (p, ...rest) { if (norm(p) === want) { hits.push(`promises.${op}`); return Promise.reject(fail(op, p)); } return orig.call(this, p, ...rest); });
  }
  try { return { result: await attempt(fn), hits }; } finally { for (const [obj, name, orig] of saved.reverse()) obj[name] = orig; }
}
// A full inventory of a tree without following links: every directory (empty ones included), every file with its hash, and every link entry
// (junction or symlink) with its target text. treeHashes lists files only, so a directory created or removed beneath a tree goes unseen by it.
function inventoryOf(dir) {
  const out = {};
  const walk = (d, rel) => {
    let names = []; try { names = fs.readdirSync(d).sort(); } catch { out[rel || '.'] = 'unreadable'; return; }
    for (const name of names) {
      const p = path.join(d, name), r = rel ? `${rel}/${name}` : name;
      let st; try { st = fs.lstatSync(p); } catch { out[r] = 'unreadable'; continue; }
      if (st.isSymbolicLink()) out[r] = `link:${fs.readlinkSync(p)}`;
      else if (st.isDirectory()) { out[r] = 'dir'; walk(p, r); }
      else out[r] = `file:${sha256(fs.readFileSync(p))}`;
    }
  };
  walk(dir, '');
  return out;
}
// Decision H5: the retained-path line is exactly "v2-baseline: tagged source kept at <absolute path>". Returns the path of the one such
// line, or null when the line is absent or repeated.
function keptLinePath(stderr) {
  const prefix = 'v2-baseline: tagged source kept at ';
  const hits = String(stderr).split(/\r?\n/).filter((l) => l.startsWith(prefix));
  return hits.length === 1 && hits[0].length > prefix.length ? hits[0].slice(prefix.length) : null;
}
// Preload for make-fixture.mjs only (tagged scripts and git are untouched): PS_C11A_LATE_FAIL=tag makes `git tag fx-base` fail, and
// PS_C11A_LATE_FAIL=last makes the final write of the run (live-env.sh) throw. Both happen after the v2 helper has already succeeded.
const LATE_FAIL_PRELOAD = [
  "const path = require('node:path');",
  "if (path.basename(String(process.argv[1] || '')) === 'make-fixture.mjs') {",
  "  const mode = process.env.PS_C11A_LATE_FAIL;",
  "  const cp = require('node:child_process'), fs = require('node:fs');",
  "  const spawnSync = cp.spawnSync;",
  "  cp.spawnSync = function (cmd, args) {",
  "    if (mode === 'tag' && cmd === 'git' && Array.isArray(args) && args.includes('tag') && args.includes('fx-base')) return { status: 1, signal: null, pid: 0, output: [null, '', 'injected failure'], stdout: '', stderr: 'injected failure', error: undefined };",
  "    return spawnSync.apply(this, arguments);",
  "  };",
  "  const writeFileSync = fs.writeFileSync;",
  "  fs.writeFileSync = function (file) {",
  "    if (mode === 'last' && /live-env\\.sh$/.test(String(file))) throw new Error('injected failure writing ' + file);",
  "    return writeFileSync.apply(this, arguments);",
  "  };",
  "  require('node:module').syncBuiltinESMExports();",
  "}",
].join('\n') + '\n';

// Preload for make-fixture.mjs only (tagged scripts and git are untouched): the first time make-fixture calls fs.mkdirSync on exactly
// PS_C11A_RACE_PATH, an empty directory (PS_C11A_RACE_MODE=dir) or a junction to PS_C11A_RACE_TARGET (PS_C11A_RACE_MODE=junction) is created at
// that path immediately before the real call, and a marker file is written to PS_C11A_RACE_MARK. It models a destination that appears after the
// script's initial existence check.
const RACE_PRELOAD = [
  "const path = require('node:path');",
  "if (path.basename(String(process.argv[1] || '')) === 'make-fixture.mjs' && process.env.PS_C11A_RACE_PATH) {",
  "  const fs = require('node:fs');",
  "  const norm = (p) => { const r = path.resolve(String(p)); return process.platform === 'win32' ? r.toLowerCase() : r; };",
  "  const want = norm(process.env.PS_C11A_RACE_PATH);",
  "  const mkdirSync = fs.mkdirSync, symlinkSync = fs.symlinkSync, writeFileSync = fs.writeFileSync;",
  "  let fired = false;",
  "  fs.mkdirSync = function (p) {",
  "    if (!fired && typeof p === 'string' && norm(p) === want) {",
  "      fired = true;",
  "      if (process.env.PS_C11A_RACE_MODE === 'junction') symlinkSync.call(fs, process.env.PS_C11A_RACE_TARGET, p, 'junction');",
  "      else mkdirSync.call(fs, p);",
  "      writeFileSync.call(fs, process.env.PS_C11A_RACE_MARK, 'fired\\n');",
  "    }",
  "    return mkdirSync.apply(this, arguments);",
  "  };",
  "  require('node:module').syncBuiltinESMExports();",
  "}",
].join('\n') + '\n';

// ================================================ V2/C11a/tag-identity ====
async function tagIdentity(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'tag');
    const h = await need(failures, 'helpers/v2-baseline.mjs');
    if (!h) return;
    const verify = (execute, extra) => h.verifyV2Tag({ repository: context.repository, ...(execute ? { execute } : {}), ...(extra || {}) });
    let total = 0;

    await step('4.1 identity constant', async () => {
      check(eq({ ...h.V2_IDENTITY }, PIN), 'V2_IDENTITY has exactly the four pins', h.V2_IDENTITY);
      check(deepFrozen(h.V2_IDENTITY), 'V2_IDENTITY is deeply frozen');
    });
    await step('2.3 helper import safety', async () => {
      checkImportSafe(check, 'helpers/v2-baseline.mjs', scope, 'helpers/v2-baseline.mjs',
        ['V2_IDENTITY', 'V2_SNAPSHOTS', 'V2_INSTALL_TARGETS', 'validateSnapshotMapping', 'isVersionedSnapshotPath', 'verifyV2Tag', 'verifyV2Snapshots', 'materializeV2Source', 'createV2InstalledFixture']);
    });
    await step('4.1 trusted local tag identity and the git-call contract', async () => {
      const real = await verify();
      check(eq({ ...real }, PIN), 'default executor: all four identity fields equal the pins', real);
      const rec = makeExec();
      const r = await verify(rec);
      check(eq({ ...r }, PIN), 'recording executor: all four identity fields equal the pins', r);
      check(eq(Object.keys(r).sort(), ['commit', 'skillVersion', 'tag', 'tree']), 'the result has exactly the four fields', Object.keys(r));
      checkCalls(check, 'verifyV2Tag', rec.calls, context);
      const first = rec.calls[0] || { args: [] };
      const i = first.args.indexOf('show-ref');
      check(i >= 2 && eq(first.args.slice(i), ['show-ref', '--verify', '--quiet', `refs/tags/${PIN.tag}`]), 'the existence check is show-ref --verify --quiet refs/tags/<tag>', first.args);
      check(rec.calls.every((c) => c.isGit), 'verifying the tag runs no script');
      total = rec.calls.length;
      const ar = await verify(makeExec(null, { async: true }));
      check(eq({ ...ar }, PIN), 'an asynchronous executor is awaited', ar);
    });
    await step('2.4 an alternate tag or identity pin is not accepted', async () => {
      const rec = makeExec();
      const r = await attempt(() => verify(rec, { tag: 'project-setup-v1.0.0', commit: '0'.repeat(40), tree: '1'.repeat(40), identity: { tag: 'other', commit: '2'.repeat(40), tree: '3'.repeat(40), skillVersion: '9.9.9' } }));
      if (r.threw) check(r.error && r.error.code === 'V2_OPTIONS_INVALID', 'rejected with V2_OPTIONS_INVALID (or ignored)', r.error && r.error.code);
      else check(eq({ ...r.value }, PIN), 'ignored: the result is still the pinned identity', r.value);
      check(rec.calls.every((c) => !c.args.some((a) => /project-setup-v1\.0\.0/.test(String(a)) || String(a).includes('0'.repeat(40)))), 'no git call names the alternate tag or commit');
    });

    const dependentsStop = async (label, code, mkRec) => {
      let rec = mkRec();
      await expectCode(check, `${label}: verifyV2Snapshots`, () => h.verifyV2Snapshots({ repository: context.repository, skillRoot: context.skillRoot, execute: rec }), code);
      check(noContentOrScripts(rec.calls), `${label}: verifyV2Snapshots reads no content and runs no script`);
      rec = mkRec();
      const dest = scope.sub('mat');
      await expectCode(check, `${label}: materializeV2Source`, () => h.materializeV2Source({ repository: context.repository, destination: dest, execute: rec }), code);
      check(noContentOrScripts(rec.calls) && listFiles(dest).length === 0, `${label}: nothing is materialized`, listFiles(dest).slice(0, 5));
      rec = mkRec();
      const root = makeProject(scope, scope.sub('proj')); const before = treeHashes(root);
      await expectCode(check, `${label}: createV2InstalledFixture`, () => h.createV2InstalledFixture({ repository: context.repository, root, workDir: scope.sub('work'), projectName: 'fixture-wallet-api', execute: rec }), code);
      check(nodeCalls(rec.calls).length === 0 && eq(treeHashes(root), before), `${label}: no tagged script runs and the project is untouched`, phaseSeq(rec.calls));
    };

    await step('4.1 tag existence command returns status 1', async () => {
      const miss = () => makeExec((c) => (c.sub === 'show-ref' ? proc({ status: 1 }) : undefined));
      const rec = miss();
      await expectCode(check, 'missing tag', () => verify(rec), 'V2_TAG_MISSING');
      check(rec.calls.length === 1 && rec.calls[0].sub === 'show-ref', 'only the existence check ran: no content read, no script', rec.calls.map((c) => c.sub));
      check(rec.calls.every((c) => c.isGit), 'no tagged script ran');
      await dependentsStop('tag missing', 'V2_TAG_MISSING', miss);
    });
    await step('4.1 other tag lookup failures are not absence', async () => {
      for (const [label, res] of [['status 128', () => proc({ status: 128, stderr: Buffer.from('fatal: not a git repository\n') })], ['status 2', () => proc({ status: 2 })]]) {
        const rec = makeExec((c) => (c.sub === 'show-ref' ? res() : undefined));
        await expectCode(check, `show-ref ${label}`, () => verify(rec), 'V2_GIT_FAILED');
        check(rec.calls.every((c) => c.sub === 'show-ref'), `show-ref ${label}: nothing runs after the failure`);
      }
    });
    await step('4.1 peeled commit differs', async () => {
      const rec = swapExec(PIN.commit, FAKE_COMMIT);
      await expectCode(check, 'different peeled commit', () => verify(rec), 'V2_TAG_COMMIT_MISMATCH');
      check(noContentOrScripts(rec.calls), 'the identity error comes before any content read or script');
      await dependentsStop('commit mismatch', 'V2_TAG_COMMIT_MISMATCH', () => swapExec(PIN.commit, FAKE_COMMIT));
    });
    await step('4.1 expected commit, different subtree', async () => {
      const rec = swapExec(PIN.tree, FAKE_TREE);
      await expectCode(check, 'different project subtree', () => verify(rec), 'V2_TAG_TREE_MISMATCH');
      check(noContentOrScripts(rec.calls), 'the identity error comes before any content read or script');
      await dependentsStop('tree mismatch', 'V2_TAG_TREE_MISMATCH', () => swapExec(PIN.tree, FAKE_TREE));
    });
    await step('4.1 malformed object response or ordinary git failure', async () => {
      const variants = {
        garbage: () => proc({}, 'not-an-object-id\n'),
        empty: () => proc({}, ''),
        'status 128': () => proc({ status: 128, stderr: Buffer.from('fatal: bad revision\n') }),
        'status 1': () => proc({ status: 1 }),
      };
      for (const [label, mk] of Object.entries(variants)) {
        const rec = makeExec((c) => (c.isGit && c.sub !== 'show-ref' ? mk() : undefined));
        await expectCode(check, `a git read answers ${label}`, () => verify(rec), 'V2_GIT_FAILED');
      }
    });
    await step('4.2 process failures on git reads (timeout, truncation, spawn error, signal)', async () => {
      const last = Math.max(total - 1, 0);
      for (const [where, idx] of [['first', 0], ['last', last]]) {
        for (const [fault, mk] of Object.entries(FAULTS)) {
          const rec = makeExec((c) => (c.n === idx ? mk() : undefined), { async: fault.length % 2 === 0 });
          await expectCode(check, `${fault} on the ${where} git read`, () => verify(rec), FAULT_CODES[fault]);
          check(rec.calls.length === idx + 1, `${fault} on the ${where} git read: nothing runs after it and nothing is retried`, rec.calls.length);
        }
      }
    });
    await step('G3 an executor that throws or rejects fails with V2_EXECUTOR_FAILED, never V2_PROCESS_FAILED', async () => {
      // V2_PROCESS_FAILED stays the code for a process that was started and then failed; an exception from the executor itself,
      // before any process result exists, is V2_EXECUTOR_FAILED. Before any tagged script runs the phase is null (G4).
      for (const idx of [0, Math.max(total - 1, 0)]) {
        for (const [mode, thrower, asyncMode] of [['throws an Error', () => { throw new Error('executor blew up'); }, false], ['throws a non-Error', () => { throw 'executor blew up'; }, false], ['rejects', () => { throw new Error('executor blew up'); }, true]]) {
          const rec = makeExec((c) => { if (c.n === idx) thrower(); return undefined; }, { async: asyncMode });
          await expectCode(check, `executor ${mode} on git read ${idx}`, () => verify(rec), 'V2_EXECUTOR_FAILED');
          check(rec.calls.length === idx + 1, `executor ${mode} on git read ${idx}: nothing runs after it and nothing is retried`, rec.calls.length);
        }
      }
      const spawnFailed = makeExec((c) => (c.n === 0 ? FAULTS.spawnError() : undefined));
      const e = await expectCode(check, 'a process-level spawn error stays V2_PROCESS_FAILED', () => verify(spawnFailed), 'V2_PROCESS_FAILED');
      check(e && e.code !== 'V2_EXECUTOR_FAILED', 'V2_EXECUTOR_FAILED is distinct from V2_PROCESS_FAILED');
    });
    await step('4.1 an ownership refusal stays V2_GIT_FAILED with no retry or broader trust', async () => {
      const refusal = () => proc({ status: 128, stderr: Buffer.from(`fatal: detected dubious ownership in repository at '${fwd(context.repository)}'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory ${fwd(context.repository)}\n`) });
      for (const idx of [0, Math.max(total - 1, 0)]) {
        const rec = makeExec((c) => (c.n === idx ? refusal() : undefined));
        await expectCode(check, `ownership refusal on git read ${idx}`, () => verify(rec), 'V2_GIT_FAILED');
        check(rec.calls.length === idx + 1, `refusal on git read ${idx}: no retry of any kind`, rec.calls.length);
        check(rec.calls.every((c) => !c.args.some((a) => /safe\.directory=\*/.test(String(a))) && c.env.GIT_CONFIG_GLOBAL !== process.env.GIT_CONFIG_GLOBAL), `refusal on git read ${idx}: no wildcard safe.directory and no inherited global config`);
        checkCalls(check, `refusal ${idx}`, rec.calls, context);
      }
    });
    await step('4.1 replacement objects are disabled on every read (control executor)', async () => {
      const control = (c, run) => { if (!c.isGit || c.env.GIT_NO_REPLACE_OBJECTS === '1') return undefined; const r = run(); return { ...r, stdout: Buffer.concat([r.stdout, Buffer.from('REPLACED\n')]) }; };
      const rel = 'assets/wrappers/claude-reviewer.md';
      const expected = tagBlob(scope, context, rel);
      const probeArgs = [...repoSafe(context), 'cat-file', 'blob', `${PIN.commit}:project-setup/${rel}`];
      const opts = (env) => ({ cwd: context.repository, env, shell: false, windowsHide: true, encoding: null, timeout: 60000, maxBuffer: 16777216 });
      const ctl = makeExec(control);
      const without = await ctl('git', probeArgs, opts({ ...scope.iso }));
      check(Buffer.compare(without.stdout, expected) !== 0, 'control: without the disabling field the bytes differ from the tagged bytes');
      const withVar = await ctl('git', probeArgs, opts({ ...scope.iso, GIT_NO_REPLACE_OBJECTS: '1' }));
      check(Buffer.compare(withVar.stdout, expected) === 0, 'control: with the field the original tagged bytes come back');
      const rec = makeExec(control);
      const r = await verify(rec);
      check(eq({ ...r }, PIN), 'the helper supplies the field on every read: identity verifies through the control executor', r);
    });
    await step('3.5 hostile inherited git environment does not reach the git reads', async () => {
      const hostile = hostileSetup(scope);
      const rec = makeExec();
      const r = await withEnv(hostile.vars, () => verify(rec));
      check(eq({ ...r }, PIN), 'identity still verifies under a hostile environment', r);
      checkHostileGone(check, 'verifyV2Tag', rec.calls, hostile);
      checkCalls(check, 'hostile verifyV2Tag', rec.calls, context);
    });
  });
}

// =========================================== V2/C11a/snapshot-inventory ====
function copySkill(scope, context) {
  const dst = scope.sub('skill');
  fs.cpSync(context.skillRoot, dst, { recursive: true, filter: (s) => !/[\\/]node_modules([\\/]|$)/.test(s) });
  return dst;
}
const MAPPING_INVALID = (() => {
  const base = () => SNAPSHOT_ENTRIES.map((e) => ({ ...e }));
  const one = (snapshot, source) => [{ snapshot, source }];
  const cases = {
    'empty array': [], null: null, undefined: undefined, 'plain object': {}, string: 'data/x.json', number: 7,
    'null entry': [null], 'string entry': ['data/x.json'], 'array entry': [['data/x.json', 'x.json']],
    'missing source': [{ snapshot: 'data/x.json' }], 'missing snapshot': [{ source: 'x.json' }],
    'non-string snapshot': one(5, 'x.json'), 'non-string source': one('data/x.json', null),
    'duplicate source': [{ snapshot: 'data/a.json', source: 's.json' }, { snapshot: 'data/b.json', source: 's.json' }],
    'duplicate destination': [{ snapshot: 'data/a.json', source: 's1.json' }, { snapshot: 'data/a.json', source: 's2.json' }],
    'valid mapping plus a duplicate destination': [...base(), { snapshot: SNAPSHOT_MAP[0][0], source: 'assets/other.json' }],
    'valid mapping plus a duplicate source': [...base(), { snapshot: 'data/extra.json', source: SNAPSHOT_MAP[0][1] }],
    'absolute destination': one('/data/a.json', 's.json'), 'absolute source': one('data/a.json', '/etc/a.json'),
    'backslash in destination': one('data\\a.json', 's.json'), 'backslash in source': one('data/a.json', 'assets\\a.md'),
    'empty destination segment': one('data//a.json', 's.json'), 'empty source segment': one('data/a.json', 'assets//a.md'),
    'dot destination segment': one('data/./a.json', 's.json'), 'dot source segment': one('data/a.json', './a.json'),
    'dotdot destination segment': one('data/../a.json', 's.json'), 'dotdot source segment': one('data/a.json', '../a.json'),
    'destination outside data/': one('assets/a.json', 's.json'), 'destination in a data-like directory': one('database/a.json', 's.json'),
    'empty destination': one('', 's.json'), 'empty source': one('data/a.json', ''),
  };
  if (process.platform === 'win32') { cases['drive-absolute destination'] = one('C:/data/a.json', 's.json'); cases['drive-absolute source'] = one('data/a.json', 'C:/a.json'); }
  return cases;
})();
const PREDICATE_CONTROLS = [
  ['data/v2.0.0/assets/agents/reviewer.md', true], ['data/extra-v2.0.0.json', true], ['data/archive/2.0.0/source.json', true],
  ['data/extra-v3.0.0.json', true], ['data/secret-paths.json', false], ['assets/agents/reviewer.md', false],
];
// Derived from the exact predicate in plan 3.4: "data/" prefix, then v2.0.0/ (any case) or the semver expression.
const PREDICATE_DERIVED = [
  ['data/V2.0.0/x.json', true], ['data/v2.0.0', true], ['data/pkg.10.20.30.json', true], ['data/a-1.2.3.json', true], ['data/EXTRA-V3.0.0.JSON', true],
  ['data/x1.2.3y.json', false], ['data/1.2.json', false], ['data/notes-v2.0.json', false], ['data/control.json', false],
  ['database/v2.0.0.json', false], ['data', false], ['scripts/v2.0.0.mjs', false],
];

async function snapshotInventory(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'inv');
    const h = await need(failures, 'helpers/v2-baseline.mjs');
    if (!h) return;
    const validate = (m) => h.validateSnapshotMapping(m);

    await step('2.4 V2_SNAPSHOTS constant', async () => {
      check(eq(h.V2_SNAPSHOTS.map((e) => ({ ...e })), SNAPSHOT_ENTRIES), 'V2_SNAPSHOTS lists the seven {snapshot, source} entries of plan 3.4 in order', h.V2_SNAPSHOTS);
      check(deepFrozen(h.V2_SNAPSHOTS), 'V2_SNAPSHOTS is deeply frozen');
    });
    await step('4.1 seven valid mapping entries', async () => {
      const raw = validate(SNAPSHOT_ENTRIES.map((e) => ({ ...e })));
      check(raw === undefined, 'validateSnapshotMapping returns undefined (synchronously) for the seven entries', raw);
      const frozen = deepFreeze(SNAPSHOT_ENTRIES.map((e) => ({ ...e }))); const before = JSON.stringify(frozen);
      check(validate(frozen) === undefined, 'a frozen argument validates (nothing is written to it)');
      check(JSON.stringify(frozen) === before, 'the argument is not mutated');
      check(validate(h.V2_SNAPSHOTS) === undefined, 'the exported mapping itself validates');
    });
    await step('4.1 empty, malformed, duplicate, absolute or traversing mappings', async () => {
      for (const [label, mapping] of Object.entries(MAPPING_INVALID)) {
        const e = await expectCode(check, `mapping: ${label}`, () => validate(mapping), 'V2_SNAPSHOT_MAPPING_INVALID');
        if (e) check(!/\{\{|BEGIN/.test(e.message), `mapping: ${label}: message carries no file contents`);
      }
    });
    await step('3.4 versioned-path predicate (six controls and derived cases)', async () => {
      for (const [p, want] of [...PREDICATE_CONTROLS, ...PREDICATE_DERIVED]) {
        const got = h.isVersionedSnapshotPath(p);
        check(got === want, `isVersionedSnapshotPath(${p}) is exactly ${want}`, got);
      }
    });
    await step('4.1 enumeration and mapping checks on a temporary skill copy', async () => {
      const skill = copySkill(scope, context);
      const exec = makeCachedExec();
      const run = () => h.verifyV2Snapshots({ repository: context.repository, skillRoot: skill, execute: exec });
      const abs = (rel) => path.join(skill, ...rel.split('/'));
      const base = await attempt(run);
      check(!base.threw, 'the untouched copy verifies', base.threw ? { code: base.error && base.error.code, message: base.error && base.error.message } : null);
      for (const [snap] of SNAPSHOT_MAP) {
        const f = abs(snap), orig = fs.readFileSync(f);
        try { fs.rmSync(f); await expectCode(check, `missing ${snap}`, run, 'V2_SNAPSHOT_MISSING'); } finally { write(f, orig); }
      }
      for (const rel of ['data/v2.0.0/assets/agents/extra.md', 'data/v2.0.0/unmapped.json', 'data/extra-v3.0.0.json', 'data/archive/2.0.0/source.json', 'data/extra-v2.0.0.json']) {
        try { write(abs(rel), 'unmapped\n'); await expectCode(check, `unmapped candidate ${rel}`, run, 'V2_SNAPSHOT_UNMAPPED'); } finally { rmrf(abs(rel)); }
      }
      rmrf(abs('data/archive'));
      try {
        write(abs('data/control.json'), '{}\n');
        check(h.isVersionedSnapshotPath('data/control.json') === false, 'data/control.json is not classified as a versioned snapshot');
        const ok = await attempt(run);
        check(!ok.threw, 'an unversioned data file does not need a mapping', ok.threw ? { code: ok.error && ok.error.code } : null);
      } finally { rmrf(abs('data/control.json')); }
      for (const [snap] of SNAPSHOT_MAP) {
        const f = abs(snap), orig = fs.readFileSync(f);
        try { fs.rmSync(f); fs.mkdirSync(f); await expectCode(check, `directory at ${snap}`, run, 'V2_SNAPSHOT_NOT_FILE'); } finally { rmrf(f); write(f, orig); }
      }
      const alt = path.join(scope.dir, 'link-target');
      fs.mkdirSync(alt, { recursive: true }); write(path.join(alt, 'inner.txt'), 'x\n');
      for (const [snap] of [SNAPSHOT_MAP[0], SNAPSHOT_MAP[2]]) {
        const f = abs(snap), orig = fs.readFileSync(f);
        try {
          fs.rmSync(f);
          const made = tryLink(alt, f, 'junction');
          check(made, `a directory link can be created at ${snap} (junction or directory symlink)`);
          if (made) await expectCode(check, `directory link at ${snap}`, run, 'V2_SNAPSHOT_NOT_FILE');
        } finally { rmrf(f); write(f, orig); }
      }
      // A file link whose target holds different bytes: following it would give V2_SNAPSHOT_BYTES_DIFFER, so the
      // expected V2_SNAPSHOT_NOT_FILE also proves the content was not read. File symlinks need a privilege on some
      // Windows machines; when one cannot be created the directory-link case above is the link coverage.
      const otherFile = path.join(scope.dir, 'other-bytes.txt'); fs.writeFileSync(otherFile, 'different bytes\n');
      for (const [snap] of [SNAPSHOT_MAP[1]]) {
        const f = abs(snap), orig = fs.readFileSync(f);
        try {
          fs.rmSync(f);
          if (tryLink(otherFile, f, 'file')) await expectCode(check, `file link at ${snap}`, run, 'V2_SNAPSHOT_NOT_FILE');
        } finally { rmrf(f); write(f, orig); }
      }
      const again = await attempt(run);
      check(!again.threw, 'the copy verifies again after every restore', again.threw ? { code: again.error && again.error.code } : null);
    });
    // R5. Plan 3.4: "Enumerate without following links ... Every candidate file must be mapped ... an unmapped future version also requires an
    // explicit mapping rather than escaping enumeration"; plan 4.1 (unmapped candidate -> V2_SNAPSHOT_UNMAPPED); architecture plan C11a: "unmapped
    // versioned data fails". Verification is only as good as its traversal: a directory that cannot be listed, or an entry that cannot be
    // inspected, would let an unmapped versioned file escape, so such a failure must fail the verification, never pass it silently.
    // Decision H3: a failure to list or stat any entry while enumerating data/ fails verification with V2_SNAPSHOT_UNREADABLE, phase null (no
    // tagged script runs, G4), carrying the path relative to the skill root; verification succeeds only after a complete traversal.
    await step('R5 an enumeration or stat failure under data/ fails verification instead of passing it', async () => {
      const skill = copySkill(scope, context);
      const exec = makeCachedExec();
      const run = () => h.verifyV2Snapshots({ repository: context.repository, skillRoot: skill, execute: exec });
      const abs = (rel) => path.join(skill, ...rel.split('/'));
      write(abs('data/archive/extra-v3.0.0.json'), 'hidden unmapped candidate\n');
      try {
        await expectCode(check, 'control: with no fault the hidden unmapped candidate is found', run, 'V2_SNAPSHOT_UNMAPPED');
        const faults = [
          ['data/ itself cannot be listed', abs('data'), ['readdir', 'opendir'], 'data'],
          ['data/archive cannot be listed (a versioned candidate sits inside it)', abs('data/archive'), ['readdir', 'opendir'], 'data/archive'],
          ['data/archive cannot be inspected (a versioned candidate sits inside it)', abs('data/archive'), ['lstat', 'stat'], 'data/archive'],
        ];
        for (const [label, target, ops, rel] of faults) {
          // A result here means the traversal skipped a part of data/ that could not be read and verified the rest: that is the defect.
          const { result } = await withFsFault(target, ops, run);
          const e = expectFail(check, `fault: ${label}`, result, 'V2_SNAPSHOT_UNREADABLE');
          check(!!e && String(e.message).split(path.sep).join('/').includes(rel), `fault: ${label}: the message carries the path relative to the skill root (${rel})`, e && e.message);
        }
      } finally { rmrf(abs('data/archive')); }
      const clean = await attempt(run);
      check(!clean.threw, 'after the faults and the cleanup the copy verifies again', clean.threw ? { code: clean.error && clean.error.code } : null);
    });
  });
}

// =============================================== V2/C11a/snapshot-bytes ====
async function snapshotBytes(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'bytes');
    const h = await need(failures, 'helpers/v2-baseline.mjs');
    if (!h) return;
    const tagged = SNAPSHOT_MAP.map(([snap, src]) => ({ snap, src, bytes: tagBlob(scope, context, src) }));
    const absIn = (skill, rel) => path.join(skill, ...rel.split('/'));

    await step('3.4 each shipped snapshot is byte-identical to its tagged source (independent read)', async () => {
      for (const t of tagged) {
        const f = absIn(context.skillRoot, t.snap);
        let st = null; try { st = fs.lstatSync(f); } catch { /* missing */ }
        check(st && st.isFile() && !st.isSymbolicLink(), `${t.snap} is a shipped regular file`);
        if (st && st.isFile()) check(Buffer.compare(fs.readFileSync(f), t.bytes) === 0, `${t.snap} equals ${PIN.tag}:project-setup/${t.src} byte for byte`);
      }
    });
    await step('4.1 seven untouched snapshot files: seven raw byte comparisons', async () => {
      const exec = makeCachedExec();
      const before = treeHashes(context.skillRoot);
      const r = await h.verifyV2Snapshots({ repository: context.repository, skillRoot: context.skillRoot, execute: exec });
      check(eq(Object.keys(r).sort(), ['files', 'identity']), 'the result has exactly identity and files', Object.keys(r));
      check(eq({ ...r.identity }, PIN), 'identity equals the pins', r.identity);
      check(Array.isArray(r.files) && r.files.length === 7, 'seven files are reported', r.files && r.files.length);
      (r.files || []).forEach((f, i) => {
        const t = tagged[i] || {};
        check(eq(Object.keys(f).sort(), ['bytes', 'sha256', 'snapshot', 'source']), `file ${i}: exactly snapshot, source, bytes, sha256`, Object.keys(f));
        check(f.snapshot === t.snap && f.source === t.src, `file ${i}: mapping order is the plan 3.4 order`, { snapshot: f.snapshot, source: f.source });
        check(t.bytes && f.bytes === t.bytes.length && f.sha256 === sha256(t.bytes), `file ${i}: bytes and sha256 are those of the tagged blob`, { bytes: f.bytes, sha256: f.sha256 });
      });
      check(eq(treeHashes(context.skillRoot), before), 'verification does not modify the skill root');
      checkCalls(check, 'verifyV2Snapshots', exec.calls, context);
      const real = await h.verifyV2Snapshots({ repository: context.repository, skillRoot: context.skillRoot });
      check(eq(plain(real), plain(r)), 'the default executor gives the same result as the recording executor');
    });
    await step('4.1 altered bytes, LF to CRLF, BOM, final newline and rendered placeholders', async () => {
      const skill = copySkill(scope, context);
      const exec = makeCachedExec();
      const run = () => h.verifyV2Snapshots({ repository: context.repository, skillRoot: skill, execute: exec });
      const muts = {
        'one altered byte': (b) => { const c = Buffer.from(b); const i = Math.floor(c.length / 2); c[i] = c[i] ^ 0x01; return c; },
        'LF changed to CRLF': (b) => Buffer.from(b.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1'),
        'BOM added': (b) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), b]),
        'final newline toggled': (b) => (b[b.length - 1] === 0x0a ? b.subarray(0, b.length - 1) : Buffer.concat([b, Buffer.from('\n')])),
        'trailing space added': (b) => Buffer.concat([b, Buffer.from(' ')]),
        'whitespace collapsed': (b) => Buffer.from(b.toString('latin1').replace(/ {2,}/g, ' ').replace(/\n{2,}/g, '\n'), 'latin1'),
      };
      for (const t of tagged) {
        const sample = (t.bytes.toString('utf8').split('\n').sort((a, b) => b.length - a.length)[0] || '').trim().slice(0, 50);
        for (const [name, fn] of Object.entries(muts)) {
          const mutated = fn(t.bytes);
          if (Buffer.compare(mutated, t.bytes) === 0) continue; // a no-op mutation proves nothing
          const f = absIn(skill, t.snap);
          try { write(f, mutated); await expectCode(check, `${name} in ${t.snap}`, run, 'V2_SNAPSHOT_BYTES_DIFFER', { noLeak: sample.length >= 20 ? [sample] : [] }); } finally { write(f, t.bytes); }
        }
      }
      for (const t of tagged.filter((x) => /assets\/agents\/(reviewer|docs-sync)\.md$/.test(x.snap))) {
        const rendered = Buffer.from(t.bytes.toString('utf8').split('{{PROJECT_NAME}}').join('pay-svc'), 'utf8');
        check(Buffer.compare(rendered, t.bytes) !== 0, `${t.snap} carries the unrendered {{PROJECT_NAME}} placeholder`);
        const f = absIn(skill, t.snap);
        try { write(f, rendered); await expectCode(check, `agent placeholder rendered in ${t.snap}`, run, 'V2_SNAPSHOT_BYTES_DIFFER'); } finally { write(f, t.bytes); }
      }
      const again = await attempt(run);
      check(!again.threw, 'the copy verifies again after every restore', again.threw ? { code: again.error && again.error.code } : null);
    });
    await step('4.1 replacement objects: a control executor that alters content when replacement is not disabled', async () => {
      const control = (c, run) => { if (!c.isGit || c.env.GIT_NO_REPLACE_OBJECTS === '1') return undefined; const r = run(); return { ...r, stdout: Buffer.concat([r.stdout, Buffer.from('REPLACED\n')]) }; };
      const rec = makeExec(control);
      const r = await attempt(() => h.verifyV2Snapshots({ repository: context.repository, skillRoot: context.skillRoot, execute: rec }));
      check(!r.threw, 'every read carries GIT_NO_REPLACE_OBJECTS=1, so the control never alters a byte', r.threw ? { code: r.error && r.error.code, message: r.error && r.error.message } : null);
      check(rec.calls.length > 0 && rec.calls.every((c) => c.env.GIT_NO_REPLACE_OBJECTS === '1'), 'all recorded git reads set the field');
    });
    await step('3.5 a real replace ref in a temporary clone does not change the verified or materialized bytes', async () => {
      const clone = scope.sub('clone');
      const cl = git(scope.iso, scope.dir, ['-c', `safe.directory=${fwd(canon(context.repository))}`, 'clone', '-q', '--no-checkout', fwd(context.repository), fwd(clone)]);
      check(cl.status === 0, 'a local clone for the replace-ref control can be made', cl.stderr);
      if (cl.status !== 0) return;
      const peeled = git(scope.iso, clone, ['rev-parse', `${PIN.tag}^{commit}`]);
      check(peeled.text === PIN.commit, 'the clone carries the pinned tag', peeled.text || peeled.stderr);
      const rel = 'assets/agents/reviewer.md';
      const orig = tagBlob(scope, context, rel);
      { // plan 3.4: never substitute HEAD. A commit on top of HEAD that changes the project-setup tree must not matter.
        const idx = path.join(scope.dir, 'clone-index'), env2 = { ...scope.iso, GIT_INDEX_FILE: idx };
        mustGit(env2, clone, ['read-tree', 'HEAD'], 'git read-tree');
        const headBlob = git(scope.iso, clone, ['hash-object', '-w', '--stdin'], { input: Buffer.from('HEAD HAS DIFFERENT CONTENT\n') }).text;
        mustGit(env2, clone, ['update-index', '--add', '--cacheinfo', `100644,${headBlob},project-setup/${rel}`], 'git update-index');
        const newTree = mustGit(env2, clone, ['write-tree'], 'git write-tree').text;
        const newHead = mustGit(scope.iso, clone, ['commit-tree', newTree, '-p', 'HEAD', '-m', 'head differs from the tag'], 'git commit-tree').text;
        mustGit(scope.iso, clone, ['update-ref', 'HEAD', newHead], 'git update-ref');
        const hv = await attempt(() => h.verifyV2Snapshots({ repository: clone, skillRoot: context.skillRoot, execute: makeExec() }));
        check(!hv.threw, 'a HEAD that differs from the tag does not change the result: the pinned commit is read, never HEAD', hv.threw ? { code: hv.error && hv.error.code } : null);
      }
      const oid = mustGit({ ...scope.iso, GIT_NO_REPLACE_OBJECTS: '1' }, clone, ['rev-parse', `${PIN.commit}:project-setup/${rel}`]).text;
      const altOid = git(scope.iso, clone, ['hash-object', '-w', '--stdin'], { input: Buffer.concat([orig, Buffer.from('REPLACED\n')]) }).text;
      mustGit(scope.iso, clone, ['replace', oid, altOid], 'git replace');
      const seen = git(scope.iso, clone, ['cat-file', 'blob', oid]);
      check(Buffer.compare(seen.stdout, orig) !== 0, 'control: a plain read in the clone returns the replaced bytes');
      const cctx = { ...context, repository: clone };
      const rec = makeExec();
      const r = await attempt(() => h.verifyV2Snapshots({ repository: clone, skillRoot: context.skillRoot, execute: rec }));
      check(!r.threw, 'verification in the clone still passes: replacement objects are ignored', r.threw ? { code: r.error && r.error.code, message: r.error && r.error.message } : null);
      checkCalls(check, 'clone verifyV2Snapshots', rec.calls, cctx);
      const dest = scope.sub('mat');
      const m = await attempt(() => h.materializeV2Source({ repository: clone, destination: dest }));
      check(!m.threw, 'materialization in the clone passes', m.threw ? { code: m.error && m.error.code } : null);
      if (!m.threw) check(Buffer.compare(fs.readFileSync(path.join(m.value.skillRoot, ...rel.split('/'))), orig) === 0, 'the materialized reviewer.md is the original tagged blob, not the replacement');
    });
    await step('1/5 the existing data inclusion carries the snapshots into both installed copies', async () => {
      // The installer is not edited by C11a (plan 2.2): its existing "data" inclusion must deliver the snapshots offline.
      const inst = path.join(context.skillRoot, 'install', 'install.mjs');
      check(/INCLUDE\s*=\s*\[[^\]]*'data'/.test(readText(inst) || ''), 'install.mjs still includes the data directory');
      const c = scope.sub('inst-c'), x = scope.sub('inst-x');
      const r = runNode([inst, '--claude-dir', c, '--codex-dir', x], scope.dir, { ...scope.iso }, 120000);
      check(r.code === 0 && !r.error, 'the installer installs the skill under test into isolated targets', { code: r.code, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 300) });
      for (const dir of [c, x]) {
        for (const t of tagged) {
          const f = path.join(dir, 'project-setup', ...t.snap.split('/'));
          check(exists(f) && Buffer.compare(fs.readFileSync(f), t.bytes) === 0, `installed ${path.basename(dir)}: ${t.snap} is byte-identical to its tagged source`);
        }
      }
    });
  });
}

// ============================================== V2/C11a/installed-fixture ====
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
// Same marker rules as the tagged blocks.mjs: markdown <!-- ... --> or #-comment markers, fenced code is documentation.
const BLOCK_MARK = /^\s*(?:<!--\s*|#\s*)project-setup:(begin|end)\s+id=([A-Za-z0-9._-]+)\s*(?:-->)?\s*$/;
function parseBlocks(text) {
  const lines = normText(text).split('\n'); const blocks = []; let open = null; let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(\x60\x60\x60|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const m = line.match(BLOCK_MARK); if (!m) return;
    if (m[1] === 'begin') open = { id: m[2], start: i };
    else if (open && open.id === m[2]) { blocks.push({ id: open.id, inner: lines.slice(open.start + 1, i).join('\n') }); open = null; }
  });
  return blocks;
}
const blockHashes = (text) => Object.fromEntries(parseBlocks(text).map((b) => [b.id, sha256(normText(b.inner))]));

function renderAgentsMd(scope, context, projectName) {
  let t = tagBlob(scope, context, 'assets/templates/AGENTS.md').toString('utf8');
  for (const [k, v] of Object.entries({ PROJECT_NAME: projectName, ...PLACEHOLDERS })) t = t.split(`{{${k}}}`).join(v);
  return t;
}
function expectedGitignore(scope, context, original) {
  const inner = normText(tagBlob(scope, context, 'assets/templates/gitignore-block.txt')).replace(/\n$/, '');
  const block = ['# project-setup:begin id=gitignore', ...inner.split('\n'), '# project-setup:end id=gitignore'];
  if (original === null || original === undefined) return block.join('\n') + '\n';
  const base = normText(original).split('\n'); while (base.length && base[base.length - 1] === '') base.pop();
  return [...base, '', ...block].join('\n') + '\n';
}
function mergedText(target) {
  if (target === 'TODO.md') return '# TODO\n';
  if (target === '.ai/decisions/README.md') return '# Decisions\n';
  return `# ${path.posix.basename(target, '.md')}\n`;
}
function expectedText(scope, context, target, exp) {
  if (target === 'AGENTS.md') return renderAgentsMd(scope, context, exp.projectName);
  if (target === 'CLAUDE.md') return tagBlob(scope, context, 'assets/templates/CLAUDE.md').toString('utf8');
  if (target === '.gitignore') return expectedGitignore(scope, context, exp.gitignore);
  if (FULL_SOURCES[target]) { let t = tagBlob(scope, context, FULL_SOURCES[target]).toString('utf8'); if (RENDERED_TARGETS.has(target)) t = t.split('{{PROJECT_NAME}}').join(exp.projectName); return t; }
  return mergedText(target);
}

function prepareProject(scope, o = {}) {
  const base = scope.sub(o.label || 'fx');
  const root = o.root || path.join(base, 'root'), work = o.work || path.join(base, 'work');
  const files = { 'package.json': '{"name":"fixture-app"}\n', 'src/a.ts': 'export {}\n', ...(o.files || {}) };
  if (o.gitignore !== undefined && o.gitignore !== null) files['.gitignore'] = o.gitignore;
  makeProject(scope, root, files);
  return { base, root, work, files, headShort: git(scope.iso, root, ['rev-parse', '--short', 'HEAD']).text, before: treeHashes(root), gitignore: o.gitignore === undefined ? null : o.gitignore };
}
async function callFixture(h, context, prep, o = {}, exec) {
  const args = { repository: context.repository, root: prep.root, workDir: prep.work, ...(exec ? { execute: exec } : {}) };
  if ('projectName' in o) args.projectName = o.projectName; else args.projectName = 'fixture-wallet-api';
  if (o.managedAllows !== undefined) args.managedAllows = o.managedAllows;
  return attempt(() => h.createV2InstalledFixture(args));
}
// Argument vectors are compared exactly, except path-valued positions, which compare as resolved paths.
function argsMatch(actual, expected, pathIdx, root) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((e, i) => (pathIdx.includes(i) ? typeof actual[i] === 'string' && samePath(path.resolve(root, actual[i]), e) : actual[i] === e));
}
function expectedCommands(root, skillRoot, plan) {
  const runDir = path.join(root, '.ai', '.run', RUN_ID);
  const list = [
    [['acquire', '--run-id', RUN_ID], []],
    [['init', '--run-id', RUN_ID], []],
    [['upsert', '--file', '.gitignore', '--id', 'gitignore', '--content', path.join(skillRoot, 'assets', 'templates', 'gitignore-block.txt'), '--run-id', RUN_ID], [6]],
    [['--run-id', RUN_ID, '--allow-file', path.join(runDir, 'fixture-allows.json')], [3]],
    [['prepare', '--run-id', RUN_ID, '--mode', 'fresh', '--agents', 'claude,codex'], []],
    [['commit', '--run-id', RUN_ID, '--approved-plan', plan], []],
    [[], []],
    [['release', '--run-id', RUN_ID], []],
  ];
  return PHASES.map((phase, i) => ({ phase, script: PHASE_SCRIPTS[i], args: list[i][0], pathIdx: list[i][1], status: 0 }));
}

// The installed project's manifest, per-target content and ownership (plan 3.6). Used for the helper result and the live fixture.
function checkProject(check, scope, context, root, exp) {
  const L = exp.label;
  const mFile = path.join(root, '.ai', 'manifest.json');
  const mRaw = fs.readFileSync(mFile); const m = JSON.parse(mRaw.toString('utf8'));
  check(eq(Object.keys(m).sort(), ['agents', 'files', 'mode', 'schema', 'skill', 'skillVersion', 'sourceCommit']), `${L}: manifest keys`, Object.keys(m));
  check(m.schema === 2 && m.skill === 'project-setup' && m.skillVersion === '2.0.0' && m.mode === 'fresh' && eq(m.agents, ['claude', 'codex']), `${L}: schema 2, project-setup, 2.0.0, fresh, claude+codex`, { schema: m.schema, skill: m.skill, skillVersion: m.skillVersion, mode: m.mode, agents: m.agents });
  // Addendum N-a: the abbreviated id that tagged apply.mjs records (git rev-parse --short HEAD), never the 40-character id.
  check(m.sourceCommit === exp.headShort && /^[0-9a-f]{7,12}$/.test(String(m.sourceCommit)), `${L}: sourceCommit is the abbreviated initial HEAD`, { got: m.sourceCommit, want: exp.headShort });
  check(eq(Object.keys(m.files || {}).sort(), TARGETS.map((t) => t[0]).sort()), `${L}: files holds exactly the 23 targets and not the manifest itself`, Object.keys(m.files || {}));

  for (const [target, ownership] of TARGETS) {
    const entry = (m.files || {})[target]; const text = readText(path.join(root, ...target.split('/')));
    check(text !== null, `${L}: ${target} exists`);
    if (text === null) continue;
    const want = expectedText(scope, context, target, exp);
    if (ownership === 'full') {
      check(normText(text) === normText(want), `${L}: ${target} is the tagged source${RENDERED_TARGETS.has(target) ? ' with the project name rendered' : ''}`);
      check(eq(entry, { ownership: 'full', sha256: sha256(normText(want)) }), `${L}: ${target} manifest entry is {ownership, sha256} of the normalized content`, entry);
    } else if (ownership === 'merged') {
      check(normText(text) === normText(want), `${L}: ${target} is the synthetic living document`, text.slice(0, 80));
      check(eq(entry, { ownership: 'merged' }), `${L}: ${target} manifest entry is exactly {ownership: "merged"}`, entry);
    } else if (ownership === 'blocks') {
      check(normText(text) === normText(want), `${L}: ${target} is the tagged template with the deterministic substitutions`);
      const ids = parseBlocks(want).map((b) => b.id);
      if (target === 'AGENTS.md') check(eq(ids, AGENTS_BLOCK_IDS), `${L}: AGENTS.md block ids in source order`, ids);
      if (target === 'CLAUDE.md') check(eq(ids, ['claude']), `${L}: CLAUDE.md has the claude block`, ids);
      if (target === '.gitignore') check(eq(ids, ['gitignore']), `${L}: .gitignore has the gitignore block`, ids);
      check(eq(entry, { ownership: 'blocks', blocks: blockHashes(want) }), `${L}: ${target} manifest entry is {ownership, blocks: {id: inner-content hash}}`, entry);
      check(eq(blockHashes(text), blockHashes(want)), `${L}: ${target} block contents on disk match`);
    } else {
      let s = null; try { s = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { /* reported below */ }
      check(s && eq(Object.keys(s).sort(), ['$schema', 'permissions']), `${L}: settings.json holds the tagged merger's $schema and permissions only (no hook)`, s && Object.keys(s));
      check(s && s.$schema === SETTINGS_SCHEMA, `${L}: settings.json $schema`, s && s.$schema);
      check(s && eq(s.permissions && s.permissions.deny, DENY), `${L}: settings.json deny is the 19 Read globs then the 23 command denies, in order`, s && s.permissions && s.permissions.deny && s.permissions.deny.length);
      check(s && eq(s.permissions && s.permissions.allow, exp.allows), `${L}: settings.json allow equals the requested managed allows`, s && s.permissions && s.permissions.allow);
      check(eq(entry, { ownership: 'keys', managed: { 'permissions.deny': DENY, 'permissions.allow': exp.allows, heldBack: [] } }), `${L}: settings.json manifest entry is the exact managed-key shape`, entry);
    }
  }
  for (const f of ['.codex/config.toml', '.claude/settings.local.json', 'CLAUDE.local.md', '.ai/.setup.lock']) check(!exists(path.join(root, ...f.split('/'))), `${L}: ${f} is not installed (the setup lock is released)`);
  check(!Object.keys(m.files || {}).some((k) => /^(src|package\.json|\.env)/.test(k)), `${L}: the host's application files are not manifest entries`);
  check(exists(path.join(root, '.ai', '.run', '.gitignore')), `${L}: tagged run state keeps its self-ignore file`);
}

// The whole plan 3.6 contract for one successful installation by the helper.
function checkInstalled(check, scope, context, prep, run, exp) {
  const L = exp.label;
  if (run.r.threw) { check(false, `${L}: the fixture is created`, { code: run.r.error && run.r.error.code, message: run.r.error && run.r.error.message, phase: run.r.error && run.r.error.phase }); return; }
  const v = run.r.value, { root, work } = prep;
  check(eq(Object.keys(v).sort(), ['installed', 'provenance', 'root']), `${L}: the result has exactly root, installed and provenance`, Object.keys(v));
  check(typeof v.root === 'string' && samePath(v.root, root), `${L}: root is the supplied project root`, v.root);
  check(eq(plain(v.installed), TARGET_ENTRIES), `${L}: installed lists exactly the 23 targets in table order with their actual ownership`, v.installed);
  checkProject(check, scope, context, root, { ...exp, headShort: prep.headShort });
  check(!exists(path.join(root, '.env.example')) && !exists(path.join(root, '.env')), `${L}: no environment template or file is installed`);
  const mRaw = fs.readFileSync(path.join(root, '.ai', 'manifest.json'));
  const now = treeHashes(root);
  for (const [rel, hash] of Object.entries(prep.before)) if (rel !== '.gitignore') check(now[rel] === hash, `${L}: ${rel} is untouched`);

  const prov = v.provenance || {};
  const sk = path.join(work, 'source', 'project-setup');
  check(eq(Object.keys(prov).sort(), ['commands', 'commit', 'managedAllows', 'manifestRawSha256', 'planSha256', 'projectName', 'runId', 'skillVersion', 'tag', 'tree'].sort()), `${L}: provenance has exactly its ten fields`, Object.keys(prov));
  check(prov.tag === PIN.tag && prov.commit === PIN.commit && prov.tree === PIN.tree && prov.skillVersion === '2.0.0' && prov.runId === RUN_ID, `${L}: provenance carries the pinned identity and run id`, { tag: prov.tag, commit: prov.commit, tree: prov.tree, skillVersion: prov.skillVersion, runId: prov.runId });
  check(prov.projectName === exp.projectName && eq(prov.managedAllows, exp.allows), `${L}: provenance records the project name and the managed allows`, { projectName: prov.projectName, managedAllows: prov.managedAllows });
  const planBytes = (() => { try { return fs.readFileSync(path.join(root, '.ai', '.run', RUN_ID, 'plan.json')); } catch { return null; } })();
  check(/^[0-9a-f]{64}$/.test(String(prov.planSha256)) && planBytes && prov.planSha256 === sha256(planBytes), `${L}: planSha256 is the lowercase hash of the run's plan.json`, prov.planSha256);
  check(prov.manifestRawSha256 === sha256(mRaw), `${L}: manifestRawSha256 covers the exact manifest bytes`, prov.manifestRawSha256);
  const want = expectedCommands(root, sk, prov.planSha256);
  check(Array.isArray(prov.commands) && prov.commands.length === 8, `${L}: eight command records`, prov.commands && prov.commands.length);
  want.forEach((w, i) => {
    const c = (prov.commands || [])[i] || {};
    check(eq(Object.keys(c).sort(), ['args', 'phase', 'script', 'status']), `${L}: command ${i} has exactly phase, script, args, status`, Object.keys(c));
    check(c.phase === w.phase && c.script === w.script && c.status === 0, `${L}: command ${i} is ${w.phase} via ${w.script} with status 0`, { phase: c.phase, script: c.script, status: c.status });
    check(argsMatch(c.args, w.args, w.pathIdx, root), `${L}: command ${i} args exclude the script path and follow plan 3.6`, c.args);
  });
  const nodes = nodeCalls(run.exec.calls);
  check(eq(nodes.map((c) => c.phase), PHASES), `${L}: the tagged scripts ran once each in the exact phase order`, nodes.map((c) => c.phase));
  nodes.forEach((c, i) => {
    check(c.executable === process.execPath && samePath(String(c.args[0]), path.join(sk, ...PHASE_SCRIPTS[i].split('/'))), `${L}: ${PHASES[i]} runs the materialized tagged script with process.execPath`, c.args[0]);
    check(samePath(c.cwd, root), `${L}: ${PHASES[i]} runs in the synthetic project`, c.cwd);
    if (want[i]) check(argsMatch(c.args.slice(1), want[i].args, want[i].pathIdx, root), `${L}: ${PHASES[i]} child args equal the recorded command args`, c.args.slice(1));
  });
  check(execIsolation(run.exec.calls).length === 0, `${L}: every child had replacement objects disabled and git config isolated`, execIsolation(run.exec.calls).slice(0, 3));
  check(Buffer.compare(fs.readFileSync(path.join(sk, 'scripts', 'apply.mjs')), tagBlob(scope, context, 'scripts/apply.mjs')) === 0 && readText(path.join(sk, 'VERSION')) === '2.0.0\n', `${L}: the tagged source is materialized under <workDir>/source/project-setup`);
  check(!isInside(root, work), `${L}: the work directory is outside the project`);
}
function execIsolation(calls) {
  const bad = [];
  calls.forEach((c, i) => { if (c.env.GIT_NO_REPLACE_OBJECTS !== '1' || c.env.GIT_CONFIG_NOSYSTEM !== '1' || !c.env.GIT_CONFIG_GLOBAL || c.env.GIT_TERMINAL_PROMPT !== '0') bad.push(i); });
  return bad;
}
// Plan 3.5: the isolated global config lists the exact synthetic root for git calls made inside tagged scripts.
// The file is read while the first tagged script is about to run, so a helper that tidies its scratch files later
// cannot make this look like a missing config.
function snapshotGitConfig(file) {
  const text = file ? readText(file) : null;
  if (text === null) return { file, text: null };
  const vals = {}; let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); const sm = line.match(/^\[(.+)\]$/);
    if (sm) { section = sm[1].trim().toLowerCase(); continue; }
    const kv = line.match(/^([A-Za-z0-9.-]+)\s*=\s*(.*)$/); if (!kv) continue;
    (vals[`${section}.${kv[1].toLowerCase()}`] ||= []).push(kv[2].trim().replace(/^"(.*)"$/, '$1').replace(/\\/g, '/'));
  }
  const emptyDir = (d) => { try { return !!d && fs.statSync(d).isDirectory() && fs.readdirSync(d).length === 0; } catch { return false; } };
  return { file, text, vals, hooksEmpty: emptyDir((vals['core.hookspath'] || [])[0]), templateEmpty: emptyDir((vals['init.templatedir'] || [])[0]) };
}
function checkIsolatedConfig(check, label, snap, root) {
  check(snap && snap.text !== null, `${label}: the isolated global git config is a readable generated file`, snap && snap.file);
  if (!snap || snap.text === null) return;
  const vals = snap.vals;
  check(snap.hooksEmpty, `${label}: core.hooksPath is an empty directory`, (vals['core.hookspath'] || [])[0]);
  check(snap.templateEmpty, `${label}: init.templateDir is an empty directory`, (vals['init.templatedir'] || [])[0]);
  check((vals['commit.gpgsign'] || [])[0] === 'false' && (vals['tag.gpgsign'] === undefined || vals['tag.gpgsign'][0] === 'false'), `${label}: signing is disabled`);
  check((vals['core.autocrlf'] || [])[0] === 'false', `${label}: core.autocrlf is false`);
  const safe = vals['safe.directory'] || [];
  check(safe.some((s) => s === fwd(canon(root))) && !safe.includes('*'), `${label}: safe.directory lists the exact forward-slash synthetic root and never a wildcard`, safe);
}

async function installedFixture(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'fx');
    const h = await need(failures, 'helpers/v2-baseline.mjs');
    if (!h) return;
    const GITIGNORE = 'node_modules/\n.env\n';

    await step('2.4 V2_INSTALL_TARGETS constant', async () => {
      check(eq(h.V2_INSTALL_TARGETS.map((e) => ({ ...e })), TARGET_ENTRIES), 'V2_INSTALL_TARGETS lists the 23 {target, ownership} entries in table order', h.V2_INSTALL_TARGETS.length);
      check(deepFrozen(h.V2_INSTALL_TARGETS), 'V2_INSTALL_TARGETS is deeply frozen');
      check(h.V2_INSTALL_TARGETS.every((e) => ['full', 'blocks', 'keys', 'merged'].includes(e.ownership)), 'ownership is exactly full, blocks, keys or merged');
    });

    await step('4.2 tagged leaves (100644 and 100755 blobs) materialize to their exact blob bytes', async () => {
      const leaves = tagLeaves(scope, context);
      check(leaves.length > 40 && leaves.every((l) => l.type === 'blob' && ['100644', '100755'].includes(l.mode)), 'the pinned tagged subtree is all regular blobs', leaves.length);
      const statusBefore = repoGit(scope, context, ['--no-optional-locks', 'status', '--porcelain']).text, headBefore = repoGit(scope, context, ['rev-parse', 'HEAD']).text;
      for (const [label, rec] of [['as tagged', makeExec()], ['first leaf listed as 100755', lsTreeMutator('first', (r) => lsRecord({ ...r, mode: '100755' }))]]) {
        const dest = scope.sub('mat');
        const r = await attempt(() => h.materializeV2Source({ repository: context.repository, destination: dest, execute: rec }));
        check(!r.threw, `materialize ${label}`, r.threw ? { code: r.error && r.error.code, message: r.error && r.error.message } : null);
        if (r.threw) continue;
        check(eq(Object.keys(r.value).sort(), ['identity', 'skillRoot']) && eq({ ...r.value.identity }, PIN), `materialize ${label}: result is { identity, skillRoot } with the pinned identity`, Object.keys(r.value));
        // G2: the tagged project-setup/ tree is written directly into destination; skillRoot is the destination itself.
        check(typeof r.value.skillRoot === 'string' && samePath(r.value.skillRoot, dest), `materialize ${label}: skillRoot equals the destination`, r.value.skillRoot);
        check(!exists(path.join(dest, 'project-setup')), `materialize ${label}: there is no inner project-setup folder`);
        check(exists(path.join(dest, 'scripts', 'lock.mjs')) && exists(path.join(dest, 'VERSION')), `materialize ${label}: scripts/ and VERSION sit directly in the destination`);
        const got = listFiles(r.value.skillRoot);
        check(eq(got, leaves.map((l) => l.path).sort()), `materialize ${label}: exactly the tagged leaves are written`, { have: got.length, want: leaves.length });
        const bad = leaves.filter((l) => !exists(path.join(r.value.skillRoot, ...l.path.split('/'))) || Buffer.compare(fs.readFileSync(path.join(r.value.skillRoot, ...l.path.split('/'))), tagBlob(scope, context, l.path)) !== 0).map((l) => l.path);
        check(bad.length === 0, `materialize ${label}: every file equals its blob bytes`, bad.slice(0, 5));
        checkCalls(check, `materialize ${label}`, rec.calls, context);
        checkLsFormat(check, `materialize ${label}`, rec.calls);
      }
      check(repoGit(scope, context, ['--no-optional-locks', 'status', '--porcelain']).text === statusBefore && repoGit(scope, context, ['rev-parse', 'HEAD']).text === headBefore, 'the distribution repository is not checked out or altered');
    });

    const scenarios = [
      { key: 'default allows', label: 'fresh project, default allows', projectName: 'fixture-wallet-api', allows: DEFAULT_ALLOWS, gitignore: GITIGNORE, o: {}, observe: true },
      { key: 'empty allows', label: 'explicit empty allow array', projectName: 'Fixture Wallet', allows: [], gitignore: null, o: { managedAllows: [] }, asyncExec: true },
    ];
    for (const sc of scenarios) {
      await step(`4.2 ${sc.label}`, async () => {
        const prep = prepareProject(scope, { gitignore: sc.gitignore });
        const manifestFile = path.join(prep.root, '.ai', 'manifest.json'), seen = [];
        let cfgSnap = null;
        const exec = makeExec((call, real) => {
          if (!call.isNode) return undefined;
          if (!cfgSnap) cfgSnap = snapshotGitConfig(call.env.GIT_CONFIG_GLOBAL);
          const before = exists(manifestFile); let allow = null;
          if (call.phase === 'merge') { const i = call.args.indexOf('--allow-file'); allow = i >= 0 ? { path: path.resolve(prep.root, String(call.args[i + 1])), text: readText(path.resolve(prep.root, String(call.args[i + 1]))) } : null; }
          const r = real(); seen.push({ phase: call.phase, before, after: exists(manifestFile), allow }); return r;
        }, { async: !!sc.asyncExec });
        const res = { r: await callFixture(h, context, prep, { ...sc.o, projectName: sc.projectName }, exec), exec };
        checkInstalled(check, scope, context, prep, res, { label: sc.label, projectName: sc.projectName, allows: sc.allows, gitignore: sc.gitignore });
        checkCalls(check, sc.label, exec.calls, context, { synthetic: [prep.root] });
        const commitAt = seen.findIndex((s) => s.phase === 'commit');
        check(seen.length >= 6 && seen.slice(0, Math.max(commitAt, 0)).every((s) => !s.before && !s.after), `${sc.label}: the manifest is absent before the tagged commit`, seen.map((s) => `${s.phase}:${s.before}/${s.after}`));
        check(commitAt >= 0 && !seen[commitAt].before && seen[commitAt].after, `${sc.label}: the manifest is created by the tagged commit and not by the helper`, seen[commitAt]);
        const mg = seen.find((s) => s.phase === 'merge');
        check(mg && mg.allow && mg.allow.text !== null && eq(JSON.parse(mg.allow.text), sc.allows), `${sc.label}: the allow-file exists at merge time and holds only the requested allows (an empty array stays a file)`, mg && mg.allow && mg.allow.text);
        check(mg && mg.allow && isInside(path.join(prep.root, '.ai', '.run', RUN_ID), mg.allow.path) && !/[\\/]drafts[\\/]/.test(mg.allow.path), `${sc.label}: the allow-file is inside the run directory and outside the drafts`, mg && mg.allow && mg.allow.path);
        checkIsolatedConfig(check, sc.label, cfgSnap, prep.root);
        if (sc.gitignore !== null) check(normText(readText(path.join(prep.root, '.gitignore')) || '').startsWith(normText(sc.gitignore)), `${sc.label}: the user's existing .gitignore lines are kept ahead of the managed block`);
      });
    }

    await step('4.2 installed canonical agents render the project name and the snapshots stay unchanged', async () => {
      const snaps = SNAPSHOT_MAP.map(([s]) => path.join(context.skillRoot, ...s.split('/')));
      const before = snaps.map((f) => sha256(fs.readFileSync(f)));
      const prep = prepareProject(scope, {});
      const exec = makeExec();
      const res = { r: await callFixture(h, context, prep, { projectName: 'Agent Name Check' }, exec), exec };
      check(!res.r.threw, 'a fixture with another project name is created', res.r.threw ? { code: res.r.error && res.r.error.code } : null);
      for (const f of ['reviewer.md', 'docs-sync.md']) {
        const t = readText(path.join(prep.root, '.ai', 'agents', f)) || '';
        check(t.includes('Agent Name Check') && !t.includes('{{PROJECT_NAME}}'), `.ai/agents/${f} has the project name rendered`);
      }
      check(eq(snaps.map((f) => sha256(fs.readFileSync(f))), before), 'the seven shipped snapshot files are byte-for-byte unchanged by fixture creation');
      const sn = readText(path.join(context.skillRoot, 'data', 'v2.0.0', 'assets', 'agents', 'reviewer.md')) || '';
      check(sn.includes('{{PROJECT_NAME}}'), 'the shipped agent snapshot still carries the unrendered placeholder');
    });

    await step('3.5 hostile inherited git config, hooks, signing and GIT_* variables', async () => {
      const hostile = hostileSetup(scope);
      const prep = prepareProject(scope, {});
      const exec = makeExec();
      const r = await withEnv(hostile.vars, () => callFixture(h, context, prep, { managedAllows: DEFAULT_ALLOWS }, exec));
      checkInstalled(check, scope, context, prep, { r, exec }, { label: 'hostile environment', projectName: 'fixture-wallet-api', allows: DEFAULT_ALLOWS, gitignore: null });
      checkHostileGone(check, 'hostile fixture', exec.calls, hostile);
      check(!exists(hostile.sentinel), 'no hostile hook ran', readText(hostile.sentinel));
    });

    await step('4.2 work paths containing spaces and a non-ASCII character', async () => {
      const base = scope.sub('sp');
      const prep = prepareProject(scope, { root: path.join(base, 'pro ject \u00e9'), work: path.join(base, 'wo rk \u00e9'), gitignore: GITIGNORE });
      const name = 'Wallet $& API \u00e9';
      const exec = makeExec();
      const res = { r: await callFixture(h, context, prep, { projectName: name }, exec), exec };
      // The project name carries "$&" on purpose: a literal substitution must not interpret it.
      checkInstalled(check, scope, context, prep, res, { label: 'spaces and \u00e9', projectName: name, allows: DEFAULT_ALLOWS, gitignore: GITIGNORE });
      if (!res.r.threw) check(eq(plain(res.r.value.installed), TARGET_ENTRIES), 'same ownership result as the plain-path fixture');
    });
  });
}

// =============================================== V2/C11a/fixture-failures ====
const checkNoNetwork = (check, label, calls) => check(!calls.some((c) => c.isGit && (NETWORK_SUBS.includes(c.sub) || c.args.some((a) => /:\/\//.test(String(a)) || /^git@/.test(String(a))))), `${label}: no fetch and no network remote in any command`);
const faultAt = (phase, fn) => (call, real) => (call.phase === phase ? fn(call, real) : undefined);
const mutateJson = (fn) => (call, real) => {
  const r = real(); let j = null;
  try { j = JSON.parse(r.stdout.toString('utf8')); } catch { return r; }
  return { ...r, stdout: Buffer.from(JSON.stringify(fn(j), null, 2) + '\n') };
};
const jsonOut = (o) => JSON.stringify(o, null, 2) + '\n';

async function fixtureFailures(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'ff');
    const h = await need(failures, 'helpers/v2-baseline.mjs');
    if (!h) return;
    const matArgs = (dest, execute) => ({ repository: context.repository, destination: dest, ...(execute ? { execute } : {}) });
    const holderDir = (label) => { const d = scope.sub(label); fs.mkdirSync(d, { recursive: true }); return d; };

    // ----- materialization: the tagged listing is validated in full before any source file is written -----
    await step('4.2 non-regular tagged entries are rejected before any file is written', async () => {
      const kinds = {
        'symlink 120000 blob': (r) => lsRecord({ ...r, mode: '120000', type: 'blob' }),
        'gitlink 160000 commit': (r) => lsRecord({ ...r, mode: '160000', type: 'commit' }),
        'tree entry in the leaf listing': (r) => lsRecord({ ...r, mode: '040000', type: 'tree' }),
        'unknown mode 100664': (r) => lsRecord({ ...r, mode: '100664' }),
        'unknown object type tag': (r) => lsRecord({ ...r, type: 'tag' }),
      };
      for (const [label, fn] of Object.entries(kinds)) {
        const holder = holderDir('mm'), dest = path.join(holder, 'dest');
        const rec = lsTreeMutator('last', fn);
        await expectCode(check, `${label} (last entry)`, () => h.materializeV2Source(matArgs(dest, rec)), 'V2_SOURCE_ENTRY_INVALID');
        check(listFiles(holder).length === 0, `${label}: no source file was written, not even those listed before the bad entry`, listFiles(holder).slice(0, 5));
        check(rec.calls.every((c) => !c.isNode), `${label}: no script ran`);
        checkNoNetwork(check, label, rec.calls);
      }
      { const holder = holderDir('mm'), dest = path.join(holder, 'dest');
        await expectCode(check, 'symlink 120000 blob (first entry)', () => h.materializeV2Source(matArgs(dest, lsTreeMutator('first', (r) => lsRecord({ ...r, mode: '120000' })))), 'V2_SOURCE_ENTRY_INVALID');
        check(listFiles(holder).length === 0, 'first-entry symlink: no source file was written'); }
      { const prep = prepareProject(scope, {}); const exec = lsTreeMutator('last', (r) => lsRecord({ ...r, mode: '120000' }));
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, 'fixture creation with a symlink leaf', res, 'V2_SOURCE_ENTRY_INVALID');
        check(nodeCalls(exec.calls).length === 0 && eq(treeHashes(prep.root), prep.before) && listFiles(prep.work).length === 0, 'fixture creation with a symlink leaf: no script ran, no project write, no source written', listFiles(prep.work).slice(0, 5)); }
    });
    await step('4.2 absolute or traversing tagged source paths', async () => {
      const bad = {
        'parent traversal': (pre) => `${pre}../escape.txt`,
        'nested traversal': (pre) => `${pre}sub/../../escape.txt`,
        'absolute path': (pre) => `${pre}/escape.txt`,
      };
      if (process.platform === 'win32') bad['drive-absolute path'] = () => 'C:/escape.txt';
      for (const [label, build] of Object.entries(bad)) {
        const holder = holderDir('pp'), dest = path.join(holder, 'dest');
        const rec = lsTreeMutator('last', (r) => lsRecord({ ...r, path: build(r.path.startsWith('project-setup/') ? 'project-setup/' : '') }));
        await expectCode(check, label, () => h.materializeV2Source(matArgs(dest, rec)), 'V2_SOURCE_PATH_INVALID');
        check(listFiles(holder).length === 0 && !exists(path.join(scope.dir, 'escape.txt')) && !exists(path.join(path.dirname(holder), 'escape.txt')), `${label}: nothing is written, inside or outside the destination`, listFiles(holder).slice(0, 5));
      }
    });
    // G6: every destination a C11a helper writes to must not exist. The helper creates it itself, non-recursively, and refuses an existing
    // path of any kind: an empty directory, a junction or a symlink as much as a file or a directory holding data. The parent exists in every
    // test; the destination never does, except in the refusal cases below.
    const kindOf = (p) => { try { const st = fs.lstatSync(p); return st.isSymbolicLink() ? 'link' : st.isDirectory() ? 'dir' : 'file'; } catch { return 'missing'; } };
    const OCCUPIED = ['existing empty directory', 'directory with a sentinel', 'file', 'junction to an empty directory', 'directory symlink to an empty directory', 'dangling symlink'];
    // Builds the occupied destination inside an existing holder. File symlinks and directory symlinks need a privilege on some Windows
    // machines, so those two variants are built only where the host allows it; the junction variant always is.
    const makeOccupied = (holder, label) => {
      const dest = path.join(holder, 'dest'), target = path.join(holder, 'link-target'); let made = true, linked = false;
      if (label === 'existing empty directory') fs.mkdirSync(dest);
      else if (label === 'directory with a sentinel') write(path.join(dest, 'sentinel.txt'), 'keep\n');
      else if (label === 'file') write(dest, 'keep\n');
      else if (label === 'junction to an empty directory') { fs.mkdirSync(target); made = tryLink(target, dest, 'junction'); linked = true; }
      else if (label === 'directory symlink to an empty directory') { fs.mkdirSync(target); made = tryLink(target, dest, 'dir'); linked = true; }
      else { made = tryLink(path.join(holder, 'nowhere'), dest, 'dir'); linked = true; }
      return { dest, target: linked && label !== 'dangling symlink' ? target : null, made };
    };
    const unchanged = (check, label, holder, o, kind, before) => {
      check(eq(treeHashes(holder), before) && kindOf(o.dest) === kind, `${label}: the destination is exactly as it was`, { kind: kindOf(o.dest), was: kind });
      if (kind === 'dir') check(fs.readdirSync(o.dest).length === (label.includes('sentinel') ? 1 : 0), `${label}: nothing was added to the directory`);
      if (o.target) check(fs.readdirSync(o.target).length === 0, `${label}: nothing was written through the link`);
    };
    await step('G6 a materialization destination that exists in any form is refused', async () => {
      for (const label of OCCUPIED) {
        const holder = holderDir('oc'), o = makeOccupied(holder, label);
        if (label === 'junction to an empty directory' || label === 'existing empty directory') check(o.made, `the ${label} destination can be created for the test`);
        if (!o.made) continue;
        const before = treeHashes(holder), kind = kindOf(o.dest), rec = makeExec();
        await expectCode(check, `occupied destination (${label})`, () => h.materializeV2Source(matArgs(o.dest, rec)), 'V2_DESTINATION_EXISTS');
        unchanged(check, `occupied destination (${label})`, holder, o, kind, before);
        check(rec.calls.every((c) => !c.isNode), `occupied destination (${label}): no script ran`);
        checkNoNetwork(check, `occupied destination (${label})`, rec.calls);
      }
    });

    // ----- createV2InstalledFixture preconditions -----
    await step('G6 a work directory that exists in any form is refused', async () => {
      for (const label of OCCUPIED) {
        const prep = prepareProject(scope, {}), holder = holderDir('wk'), o = makeOccupied(holder, label);
        if (label === 'junction to an empty directory' || label === 'existing empty directory') check(o.made, `the ${label} work directory can be created for the test`);
        if (!o.made) continue;
        prep.work = o.dest;
        const before = treeHashes(holder), kind = kindOf(o.dest), exec = makeExec();
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, `occupied work directory (${label})`, res, 'V2_DESTINATION_EXISTS');
        unchanged(check, `occupied work directory (${label})`, holder, o, kind, before);
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0, `occupied work directory (${label}): the project is untouched and no script ran`);
      }
    });
    await step('4.2 work directory equal to, beneath, or an alias into the project', async () => {
      const cases = [
        ['equal to the root', (p) => p.root],
        ['beneath the root', (p) => path.join(p.root, 'work')],
        ['beneath .ai in the root', (p) => path.join(p.root, '.ai', 'fx-work')],
      ];
      for (const [label, pick] of cases) {
        const prep = prepareProject(scope, {}); prep.work = pick(prep);
        const exec = makeExec();
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, `work directory ${label}`, res, 'V2_WORKDIR_INSIDE_PROJECT');
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0 && (label === 'equal to the root' || !exists(prep.work)), `work directory ${label}: no writes happened`, listFiles(prep.root, true).slice(0, 8));
      }
      const prep = prepareProject(scope, {});
      const inner = path.join(prep.root, 'inner'); fs.mkdirSync(inner);
      const alias = path.join(prep.base, 'alias');
      const made = tryLink(inner, alias, 'junction');
      check(made, 'a directory alias (junction or symlink) into the project can be created');
      if (made) {
        prep.work = path.join(alias, 'work');
        const exec = makeExec();
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, 'work directory reached through an alias into the project', res, 'V2_WORKDIR_INSIDE_PROJECT');
        check(eq(treeHashes(prep.root), prep.before) && !exists(path.join(inner, 'work')) && nodeCalls(exec.calls).length === 0, 'alias work directory: no writes through the alias', listFiles(prep.root, true).slice(0, 8));
        rmrf(alias);
      }
    });
    await step('4.2 an existing manifest or managed target', async () => {
      const cases = [
        ['.ai/manifest.json', '{"schema":2}\n'], ['AGENTS.md', '# user agents\n'], ['CLAUDE.md', '# user claude\n'], ['.claude/settings.json', '{"permissions":{"allow":[]}}\n'],
        ['.ai/security-paths.json', '{}\n'], ['.ai/agents/reviewer.md', 'user reviewer\n'], ['.codex/agents/docs_sync.toml', 'name = "x"\n'], ['docs/database.md', '# db\n'], ['TODO.md', '# mine\n'],
      ];
      for (const [rel, content] of cases) {
        const prep = prepareProject(scope, { files: { [rel]: content } });
        const exec = makeExec();
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, `existing ${rel}`, res, 'V2_FIXTURE_NOT_FRESH');
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0, `existing ${rel}: its bytes and the rest of the project are unchanged, no script ran`);
      }
    });
    await step('4.2 invalid project name or allow array', async () => {
      const names = { empty: '', 'newline inside': 'a\nb', 'carriage return inside': 'a\rb', number: 123, null: null, undefined: undefined, object: {} };
      for (const [label, value] of Object.entries(names)) {
        const prep = prepareProject(scope, {}); const exec = makeExec();
        const res = await callFixture(h, context, prep, { projectName: value }, exec);
        expectFail(check, `project name ${label}`, res, 'V2_OPTIONS_INVALID');
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0, `project name ${label}: nothing was written or run`);
      }
      const allows = { 'a string': 'Bash(npm test)', 'a plain object': {}, 'a non-string element': ['Bash(npm test)', 1], 'duplicate strings': ['Bash(npm test)', 'Bash(npm test)'] };
      for (const [label, value] of Object.entries(allows)) {
        const prep = prepareProject(scope, {}); const exec = makeExec();
        const res = await callFixture(h, context, prep, { managedAllows: value }, exec);
        expectFail(check, `managedAllows ${label}`, res, 'V2_OPTIONS_INVALID');
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0, `managedAllows ${label}: nothing was written or run`);
      }
    });

    // ----- tagged-script phases -----
    const failRun = async (o) => {
      const prep = prepareProject(scope, { gitignore: o.gitignore });
      const exec = makeExec(o.handler, { async: !!o.async });
      return { prep, exec, r: await callFixture(h, context, prep, o.call || {}, exec) };
    };
    const stopsAt = (label, run, phase) => {
      check(eq(phaseSeq(run.exec.calls), PHASES.slice(0, PHASES.indexOf(phase) + 1)), `${label}: no later phase runs (no release, rollback or cleanup either)`, phaseSeq(run.exec.calls));
      checkNoNetwork(check, label, run.exec.calls);
    };
    const preserved = (label, run, phase) => {
      const i = PHASES.indexOf(phase);
      if (i >= 1) check(exists(path.join(run.prep.root, '.ai', '.setup.lock')), `${label}: the setup lock is left in place (diagnostic state preserved)`);
      if (i >= 2) check(exists(path.join(run.prep.root, '.ai', '.run', RUN_ID)), `${label}: the run directory is left in place`);
    };
    await step('4.2 a required script exits nonzero (every phase through validate)', async () => {
      const canned = {
        'lock-acquire': () => proc({ status: 2 }, jsonOut({ ok: false, error: 'lock is held by another run' })),
        init: () => proc({ status: 2 }, jsonOut({ ok: false, error: 'link or junction rejected' })),
        blocks: () => proc({ status: 3 }, jsonOut({ ok: false, error: 'refusing to edit a file with broken markers' })),
        merge: () => proc({ status: 3 }, jsonOut({ ok: false, error: '--allow-file is not valid JSON (content not shown)' })),
        prepare: () => proc({ status: 3 }, jsonOut({ ok: false, error: 'plan rejected', errors: [] })),
        commit: () => proc({ status: 4 }, jsonOut({ ok: false, error: 'changes since prepare; nothing was written.' })),
        validate: () => proc({ status: 1 }, jsonOut({ ok: false, summary: { pass: 1, warn: 0, fail: 1 }, results: [] })),
      };
      for (const phase of PHASES.slice(0, 7)) {
        const run = await failRun({ handler: faultAt(phase, canned[phase]), async: phase === 'merge' });
        expectFail(check, `${phase} exits nonzero`, run.r, 'V2_SCRIPT_FAILED', { phase });
        stopsAt(`${phase} exits nonzero`, run, phase); preserved(`${phase} exits nonzero`, run, phase);
      }
    });
    await step('4.2 invalid successful output from prepare, commit and validate', async () => {
      const variants = [
        ['prepare without planSha256', 'prepare', mutateJson((j) => { delete j.planSha256; return j; }), 'V2_PREPARE_INVALID'],
        ['prepare with an uppercase hash', 'prepare', mutateJson((j) => ({ ...j, planSha256: String(j.planSha256).toUpperCase() })), 'V2_PREPARE_INVALID'],
        ['commit that does not report committed: true', 'commit', () => proc({}, jsonOut({ ok: true, committed: false, reason: 'nothing to change (zero diff)' })), 'V2_COMMIT_INVALID'],
        ['validate that reports ok: false with exit 0', 'validate', () => proc({}, jsonOut({ ok: false, summary: { pass: 1, warn: 0, fail: 1 }, results: [] })), 'V2_VALIDATE_FAILED'],
      ];
      for (const [label, phase, fn, code] of variants) {
        const run = await failRun({ handler: faultAt(phase, fn) });
        expectFail(check, label, run.r, code, { phase });
        stopsAt(label, run, phase);
        if (phase === 'prepare') check(!nodeCalls(run.exec.calls).some((c) => c.phase === 'commit'), `${label}: commit is not invoked`);
        preserved(label, run, phase);
      }
    });
    await step('4.2 lock release fails, or reports released: false', async () => {
      for (const [label, fn] of [['release exits nonzero', () => proc({ status: 2 }, jsonOut({ ok: false, error: 'refusing to release a lock owned by another run' }))], ['release reports released: false', () => proc({}, jsonOut({ ok: true, released: false, reason: 'not held' }))]]) {
        const run = await failRun({ handler: faultAt('lock-release', fn) });
        expectFail(check, label, run.r, 'V2_LOCK_RELEASE_FAILED', { phase: 'lock-release' });
        stopsAt(label, run, 'lock-release');
        check(exists(path.join(run.prep.root, '.ai', 'manifest.json')) && exists(path.join(run.prep.root, '.ai', '.setup.lock')), `${label}: a failed release is a failed fixture even though commit and validation succeeded (no fixture result, lock left in place)`);
      }
      const run = await failRun({ handler: faultAt('lock-release', FAULTS.timeout) });
      expectFail(check, 'release times out', run.r, 'V2_PROCESS_TIMEOUT', { phase: 'lock-release' });
    });
    await step('G5 a script that exits 0 without the valid JSON its phase requires: V2_OUTPUT_INVALID with that phase', async () => {
      // Applies to every phase without a dedicated code; prepare, commit and validate keep V2_PREPARE_INVALID, V2_COMMIT_INVALID and
      // V2_VALIDATE_FAILED for their own phases (covered above).
      const variants = [['lock-acquire', 'empty output', () => proc({}, '')], ['init', 'text that is not JSON', () => proc({}, 'this is not json\n')], ['blocks', 'truncated JSON', () => proc({}, '{"ok":')], ['merge', 'text that is not JSON', () => proc({}, 'merged!\n')]];
      for (const [phase, what, fn] of variants) {
        const run = await failRun({ handler: faultAt(phase, fn) });
        expectFail(check, `${phase} exits 0 with ${what}`, run.r, 'V2_OUTPUT_INVALID', { phase });
        stopsAt(`${phase} exits 0 with ${what}`, run, phase); preserved(`${phase} exits 0 with ${what}`, run, phase);
      }
    });
    await step('4.2 timeout, truncation, spawn error and signal on a tagged script', async () => {
      for (const fault of ['timeout', 'truncated', 'both', 'spawnError', 'signal']) {
        const run = await failRun({ handler: faultAt('lock-acquire', FAULTS[fault]), async: fault === 'both' });
        expectFail(check, `${fault} on the first tagged script`, run.r, FAULT_CODES[fault], { phase: 'lock-acquire' });
        stopsAt(`${fault} on the first tagged script`, run, 'lock-acquire');
      }
      const run = await failRun({ handler: faultAt('merge', FAULTS.truncated) });
      expectFail(check, 'truncation on a later tagged script (merge)', run.r, 'V2_PROCESS_TRUNCATED', { phase: 'merge' });
      stopsAt('truncation on merge', run, 'merge');
      // G3 and G4: an executor that throws or rejects is V2_EXECUTOR_FAILED, carrying the phase of the script it was running.
      for (const [phase, asyncMode, kind] of [['lock-acquire', false, 'throws'], ['lock-acquire', true, 'rejects'], ['merge', false, 'throws']]) {
        const thrown = await failRun({ handler: (c) => { if (c.phase === phase) throw new Error('executor blew up'); return undefined; }, async: asyncMode });
        expectFail(check, `an executor that ${kind} on ${phase}`, thrown.r, 'V2_EXECUTOR_FAILED', { phase });
        stopsAt(`an executor that ${kind} on ${phase}`, thrown, phase);
      }
    });
    await step('4.2 timeout, truncation, spawn error and signal on git reads during materialization', async () => {
      for (const [where, pick] of [['the recursive tree listing', (c, st) => isRecursiveLs(c)], ['the first read after the listing', (c, st) => st.seen && c.isGit]]) {
        for (const fault of Object.keys(FAULTS)) {
          if (where !== 'the recursive tree listing' && !['timeout', 'truncated'].includes(fault)) continue;
          const holder = holderDir('gf'), dest = path.join(holder, 'dest'); const st = { seen: false };
          const rec = makeExec((c) => { const hit = pick(c, st); if (isRecursiveLs(c)) st.seen = true; return hit ? FAULTS[fault]() : undefined; });
          await expectCode(check, `${fault} on ${where}`, () => h.materializeV2Source(matArgs(dest, rec)), FAULT_CODES[fault]);
          check(listFiles(holder).length === 0 && rec.calls.every((c) => !c.isNode), `${fault} on ${where}: the failure is final: nothing written, nothing run`, listFiles(holder).slice(0, 5));
          checkNoNetwork(check, `${fault} on ${where}`, rec.calls);
        }
      }
      // G3/G4: an executor that throws while materializing is V2_EXECUTOR_FAILED with a null phase (no tagged script has run).
      for (const [where, pick] of [['the recursive tree listing', (c) => isRecursiveLs(c)], ['the first call', (c) => c.n === 0]]) {
        const holder = holderDir('gf'), dest = path.join(holder, 'dest');
        const rec = makeExec((c) => { if (pick(c)) throw new Error('executor blew up'); return undefined; });
        await expectCode(check, `an executor that throws on ${where}`, () => h.materializeV2Source(matArgs(dest, rec)), 'V2_EXECUTOR_FAILED');
        check(listFiles(holder).length === 0 && rec.calls.every((c) => !c.isNode), `an executor that throws on ${where}: nothing written, nothing run`);
      }
    });

    // ----- review defects R1-R3 -----
    // R1. Plan 3.6 (stage drafts), G4, G6 ("every destination the C11a helpers write to must not exist ... refuses an existing path of any kind")
    // and decision H1: when any path the helper is about to stage beneath the drafts directory already exists (a file, a directory, a junction
    // or a symlink, at any depth), it fails with V2_DESTINATION_EXISTS and phase init, before it writes any draft; nothing is written through a
    // link, the drafts directory is left as it was and nothing outside the project changes. The drafts directory is created by the tagged init,
    // so the pre-existing path appears after init and before staging: the executor result of init is returned untouched and the path is put in
    // place right after it. No later phase runs, and the failed fixture keeps its diagnostic state (plan 3.6).
    await step('R1 draft staging refuses a pre-existing draft path before it writes anything', async () => {
      const junctionAt = (st, name) => {
        fs.mkdirSync(st.outside, { recursive: true }); write(path.join(st.outside, 'keep.txt'), 'keep\n');
        st.outsideBefore = inventoryOf(st.outside); st.linkPath = path.join(st.drafts, name);
        return tryLink(st.outside, st.linkPath, 'junction');
      };
      const variants = [
        ['a junction at drafts/.ai that leads to an outside directory', (st) => junctionAt(st, '.ai')],
        ['a junction at drafts/docs that leads to an outside directory', (st) => junctionAt(st, 'docs')],
        ['a regular file at drafts/AGENTS.md', (st) => { write(path.join(st.drafts, 'AGENTS.md'), 'user draft\n'); return true; }],
        ['a regular file at drafts/.ai/agents/reviewer.md', (st) => { write(path.join(st.drafts, '.ai', 'agents', 'reviewer.md'), 'user draft\n'); return true; }],
        ['an empty directory at drafts/docs', (st) => { fs.mkdirSync(path.join(st.drafts, 'docs')); return true; }],
        ['a directory at drafts/.ai/agents/reviewer.md where a file is staged', (st) => { fs.mkdirSync(path.join(st.drafts, '.ai', 'agents', 'reviewer.md'), { recursive: true }); return true; }],
        ['a junction at drafts/.ai/agents inside a real drafts/.ai (depth two)', (st) => { fs.mkdirSync(path.join(st.drafts, '.ai')); return junctionAt(st, '.ai/agents'); }],
      ];
      for (const [label, setup] of variants) {
        const prep = prepareProject(scope, {});
        const st = { runDir: path.join(prep.root, '.ai', '.run', RUN_ID), drafts: path.join(prep.root, '.ai', '.run', RUN_ID, 'drafts'), outside: scope.sub('outside'), snap: null, made: null, linkPath: null, outsideBefore: null };
        const exec = makeExec(faultAt('init', (call, real) => { const r = real(); st.made = setup(st); st.snap = inventoryOf(st.drafts); return r; }));
        const run = { prep, exec, r: await callFixture(h, context, prep, {}, exec) };
        const L = `staging with ${label}`;
        if (st.snap === null || st.made !== true) { check(false, `${L}: the pre-existing draft path could be put in place after init (test setup)`, { snap: st.snap !== null, made: st.made }); continue; }
        expectFail(check, L, run.r, 'V2_DESTINATION_EXISTS', { phase: 'init' });
        // The inventory lists directories, files (with hashes) and link entries without following links, so an empty staging directory created
        // before the refusal, or a pre-existing empty directory removed by it, is a difference too.
        check(eq(inventoryOf(st.drafts), st.snap), `${L}: nothing was staged: the drafts directory is exactly as it was before staging (directories, files and links)`, { now: Object.keys(inventoryOf(st.drafts)).slice(0, 8), was: Object.keys(st.snap).slice(0, 8) });
        check(!exists(path.join(st.runDir, 'fixture-allows.json')), `${L}: no allow-file was written`);
        if (st.linkPath) check(kindOf(st.linkPath) === 'link' && eq(inventoryOf(st.outside), st.outsideBefore), `${L}: the outside directory is unchanged: nothing was written through the junction`, Object.keys(inventoryOf(st.outside)));
        const now = treeHashes(prep.root);
        check(eq(Object.keys(now).filter((k) => !k.startsWith('.ai/')).sort(), Object.keys(prep.before).sort()) && Object.entries(prep.before).every(([k, v]) => now[k] === v), `${L}: nothing was written in the project outside .ai/`, Object.keys(now).filter((k) => !k.startsWith('.ai/')).slice(0, 8));
        stopsAt(L, run, 'init'); preserved(L, run, 'init');
        if (st.linkPath) rmrf(st.linkPath);
      }
    });

    // R2. Plan 3.6 ("workDir is unused, outside root, and not an alias resolving into root") and plan 4.2 ("workDir === root or beneath root ->
    // V2_WORKDIR_INSIDE_PROJECT; no writes", "Work-directory alias resolves inside root -> V2_WORKDIR_INSIDE_PROJECT; no writes"): the refusal
    // comes before any write and its phase is null. Decision H4: a path is outside a parent only when the relative path is exactly "..", starts
    // with ".." followed by a separator, or is absolute; a name that merely begins with two dots, such as <root>/..work, is inside. The work
    // directory check compares canonical paths (each resolved through its longest existing ancestor, following junctions), so the alias
    // variants hide the same directory behind a junction in an ancestor position or give root itself through an alias.
    await step('R2 a work directory named ..work inside the project is inside the project', async () => {
      const refused = async (label, prep, workAt) => {
        const exec = makeExec();
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, `work directory ${label}`, res, 'V2_WORKDIR_INSIDE_PROJECT');
        check(eq(treeHashes(prep.root), prep.before) && nodeCalls(exec.calls).length === 0 && !exists(workAt), `work directory ${label}: no writes happened and no script ran`, listFiles(prep.root, true).slice(0, 8));
      };
      for (const name of ['..work', '...work']) {
        const prep = prepareProject(scope, {}); prep.work = path.join(prep.root, name);
        await refused(`<root>/${name}`, prep, prep.work);
      }
      const prep = prepareProject(scope, {});
      const alias = path.join(prep.base, 'rootalias');
      const made = tryLink(prep.root, alias, 'junction');
      check(made, 'a junction that leads to the project root can be created');
      if (made) {
        await refused('<junction to root>/..work (the alias hides the containment)', { ...prep, work: path.join(alias, '..work') }, path.join(prep.root, '..work'));
        await refused('<real root>/work with root given through the junction', { ...prep, root: alias, work: path.join(prep.root, 'work') }, path.join(prep.root, 'work'));
        rmrf(alias);
      }
      // Control: a sibling directory named ..work next to the project is outside it and must still be accepted.
      const out = prepareProject(scope, {}); out.work = path.join(out.base, '..work');
      const exec = makeExec();
      const res = await callFixture(h, context, out, {}, exec);
      check(!res.threw && eq(plain(res.value.installed), TARGET_ENTRIES), 'control: a sibling ..work directory outside the project is accepted and the fixture is installed', res.threw ? { code: res.error && res.error.code, message: res.error && res.error.message } : null);
    });
    // R2, same root cause in materialization: plan 3.5 rejects "absolute, traversal or unsafe materialization paths" and plan 4.2 materializes
    // every regular blob to its exact bytes. By decision H4 a tagged leaf whose name only begins with two dots is not a traversal: it is a child
    // of the destination.
    await step('R2 a tagged leaf whose name begins with two dots is materialized, not rejected as a traversal', async () => {
      const leaves = tagLeaves(scope, context), last = leaves[leaves.length - 1];
      const holder = holderDir('dd'), dest = path.join(holder, 'dest'), name = '..dotdot-name.txt';
      const rec = lsTreeMutator('last', (r) => lsRecord({ ...r, path: name }));
      const r = await attempt(() => h.materializeV2Source(matArgs(dest, rec)));
      check(!r.threw, `a leaf renamed to ${name} is materialized`, r.threw ? { code: r.error && r.error.code, message: r.error && r.error.message } : null);
      const f = path.join(dest, name);
      check(exists(f) && Buffer.compare(fs.readFileSync(f), tagBlob(scope, context, last.path)) === 0, `${name} sits directly in the destination with the blob's exact bytes`);
      check(!exists(path.join(holder, name)), `${name} is not written outside the destination`);
    });

    // R3. Plan 3.6 preconditions ("root is an existing synthetic Git repository with an initial commit") and decision H2: root must be the
    // top-level directory of a Git repository, and its HEAD must resolve to a commit. A root that is not a repository, is a subdirectory of
    // another repository (the tagged scripts find the repository from the working directory and would write their lock and run files into the
    // enclosing one) or has no commit fails with V2_OPTIONS_INVALID and phase null, before materialization, before any tagged script runs and
    // before any write to the root, the work directory or an enclosing repository.
    await step('R3 a root that is not an existing git repository with an initial commit is refused before any write', async () => {
      const refuse = async (label, prep, enclosing) => {
        const exec = makeExec(), before = enclosing ? treeHashes(enclosing) : null;
        const res = await callFixture(h, context, prep, {}, exec);
        expectFail(check, label, res, 'V2_OPTIONS_INVALID');
        check(nodeCalls(exec.calls).length === 0, `${label}: no tagged script ran`, phaseSeq(exec.calls));
        check(eq(treeHashes(prep.root), prep.before) && !exists(path.join(prep.root, '.ai')) && !exists(prep.work), `${label}: nothing was written in the root or the work directory`, listFiles(prep.root, true).slice(0, 8));
        if (enclosing) check(eq(treeHashes(enclosing), before) && !exists(path.join(enclosing, '.ai')), `${label}: the enclosing repository got no lock or run files`, listFiles(enclosing, true).filter((f) => f.startsWith('.ai/')).slice(0, 5));
      };
      { const enclosing = makeProject(scope, scope.sub('enc'), { 'package.json': '{"name":"outer"}\n', 'pkg/inner/app.js': 'export {}\n' });
        const root = path.join(enclosing, 'pkg', 'inner');
        await refuse('root is a subdirectory of another repository', { root, work: scope.sub('work'), before: treeHashes(root) }, enclosing); }
      { const root = scope.sub('norepo'); write(path.join(root, 'package.json'), '{"name":"plain"}\n');
        const probe = git(scope.iso, root, ['rev-parse', '--show-toplevel']);
        check(probe.status !== 0, 'test setup: the plain directory is not inside any git repository', probe.text);
        await refuse('root is a directory that is not a git repository', { root, work: scope.sub('work'), before: treeHashes(root) }); }
      { const root = scope.sub('nocommit'); fs.mkdirSync(root, { recursive: true }); mustGit(scope.iso, root, ['init', '-q'], 'git init'); write(path.join(root, 'package.json'), '{"name":"empty"}\n');
        const probe = git(scope.iso, root, ['rev-parse', '--verify', 'HEAD']);
        check(probe.status !== 0, 'test setup: the repository has no commit', probe.text);
        await refuse('root is a git repository without an initial commit', { root, work: scope.sub('work'), before: treeHashes(root) }); }
    });
  });
}

// ===================================================== V2/C11a/live-v2 ====
function runNode(args, cwd, env, timeout = 600000) {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, signal: r.signal || null, error: r.error || null, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const parseJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const noSuccessJson = (stdout) => { const j = parseJson(String(stdout).trim()); return !(j && j.ok === true) && !/"ok"\s*:\s*true/.test(String(stdout)); };
function childEnv(context, extra = {}) {
  const e = {};
  for (const [k, v] of Object.entries({ ...process.env, ...context.env })) if (!/^GIT_/i.test(k) && typeof v === 'string') e[k] = v;
  return { ...e, ...extra };
}
function fixtureGit(out, env) { return (cwd, args) => git({ ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(out, '.fixture-git', 'gitconfig'), GIT_TERMINAL_PROMPT: '0' }, cwd, args); }
// A throwaway distribution layout: <dist>/.git plus a copy of the skill under test at <dist>/project-setup.
function makeDist(scope, context, tagMode) {
  const dist = scope.sub('dist'); fs.mkdirSync(dist, { recursive: true });
  mustGit(scope.iso, dist, ['init', '-q'], 'git init'); write(path.join(dist, 'README.md'), 'distribution\n');
  mustGit(scope.iso, dist, ['add', '-A'], 'git add'); mustGit(scope.iso, dist, ['commit', '-q', '-m', 'init'], 'git commit');
  if (tagMode === 'moved') mustGit(scope.iso, dist, ['tag', PIN.tag], 'git tag');
  fs.cpSync(context.skillRoot, path.join(dist, 'project-setup'), { recursive: true, filter: (s) => !/[\\/]node_modules([\\/]|$)/.test(s) });
  return dist;
}

async function liveV2(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'live');
    const mf = path.join(context.skillRoot, 'tests', 'live', 'make-fixture.mjs');
    const env = childEnv(context);
    const version = (readText(path.join(context.skillRoot, 'VERSION')) || '').trim();
    let h = null; try { h = await import(modUrl('helpers/v2-baseline.mjs')); } catch { h = null; } // only used for a final tag sanity check
    const sentinelTree = (dir) => treeHashes(dir);

    // G7: the live fixture extracts the tagged source into a new directory under the OS temp directory, outside <out> and the project.
    // The child gets its own TEMP/TMP/TMPDIR so that directory is observable (and cannot litter the real temp directory).
    await step('4.3 a new --kind v2 destination', async () => {
      const out = scope.sub('v2out'), metaDir = `${out}.meta`;
      const osTmp = scope.sub('ostmp'); fs.mkdirSync(osTmp, { recursive: true });
      const r = runNode([mf, '--kind', 'v2', '--out', out], context.repository, { ...env, TEMP: osTmp, TMP: osTmp, TMPDIR: osTmp });
      check(r.code === 0 && !r.error, 'exit 0', { code: r.code, signal: r.signal, stderr: r.stderr.slice(0, 400) });
      const j = parseJson(r.stdout.trim());
      check(!!j, 'stdout is one JSON document', r.stdout.slice(0, 200));
      if (!j) return;
      check(j.ok === true && j.skillVersion === version, 'ok true and skillVersion is the skill under test (not the v2 baseline)', { ok: j.ok, skillVersion: j.skillVersion, version });
      check(Array.isArray(j.fixtures) && j.fixtures.length === 1 && path.isAbsolute(String(j.fixtures[0])) && samePath(j.fixtures[0], path.join(out, 'fixture-v2')), 'fixtures holds exactly the absolute fixture-v2 path', j.fixtures);
      check(typeof j.meta === 'string' && path.isAbsolute(j.meta) && samePath(j.meta, path.join(metaDir, 'fixture-meta.json')), 'meta is <out>.meta/fixture-meta.json', j.meta);
      check(typeof j.note === 'string' && j.note && typeof j.next === 'string' && j.next, 'the existing note and next fields are present', Object.keys(j));
      check(!('reviewRanges' in j), 'reviewRanges is omitted (no fresh-oracle branches)', j.reviewRanges);
      check(eq(Object.keys(j).sort(), ['fixtures', 'meta', 'next', 'note', 'ok', 'skillVersion']), 'the success JSON keeps exactly its existing fields', Object.keys(j));
      const fxDir = path.join(out, 'fixture-v2'), meta = parseJson(readText(j.meta) || '');
      check(!!meta, 'the metadata file is readable JSON outside the fixture tree');
      check(!isInside(out, j.meta || metaDir), 'the metadata is stored outside the fixture tree', j.meta);
      if (!meta) return;
      check(meta.skillVersion === version, 'root skillVersion in the metadata is the skill under test', meta.skillVersion);
      check(eq(Object.keys(meta.fixtures || {}), ['v2']), 'the metadata holds exactly fixtures.v2', Object.keys(meta.fixtures || {}));
      const e = (meta.fixtures || {}).v2 || {};
      check(samePath(String(e.path), fxDir), 'fixtures.v2.path is the fixture', e.path);
      check(!('changes' in e) && !('oracle' in e) && !('expected' in e), 'no fresh-oracle data is recorded for v2', Object.keys(e));
      const g = fixtureGit(out, env);
      const base = g(fxDir, ['rev-parse', 'fx-base^{commit}']);
      check(base.status === 0 && e.base === base.text, 'the fixture base is tagged fx-base and recorded', { tag: base.text, meta: e.base });
      check(g(fxDir, ['branch', '--list', 'fx/*']).text === '' && g(fxDir, ['tag', '--list']).text.split(/\r?\n/).filter(Boolean).join(',') === 'fx-base', 'no fresh-oracle branches or tags exist, only fx-base', g(fxDir, ['tag', '--list']).text);
      check(g(fxDir, ['status', '--porcelain']).text === '', 'the working tree is clean at fx-base (skill copies are git-excluded)', g(fxDir, ['status', '--porcelain']).text.slice(0, 200));
      const parent = g(fxDir, ['rev-parse', 'fx-base~1']);
      const names = g(fxDir, ['ls-tree', '-r', '--name-only', 'fx-base']).text.split(/\r?\n/);
      check(['.ai/manifest.json', 'package.json', 'src/wallet/wallet.ledger.ts', ...TARGETS.map((t) => t[0])].every((f) => names.includes(f)), 'fx-base contains the installed targets, the manifest and the application files');
      const mRaw = fs.readFileSync(path.join(fxDir, '.ai', 'manifest.json'));
      const committed = git({ ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(out, '.fixture-git', 'gitconfig') }, fxDir, ['cat-file', 'blob', 'fx-base:.ai/manifest.json']).stdout;
      check(Buffer.compare(mRaw, committed) === 0, 'the committed manifest is the installed manifest, byte for byte');
      const exp = { label: 'live v2', projectName: 'fixture-wallet-api', allows: DEFAULT_ALLOWS, gitignore: g(fxDir, ['show', 'fx-base~1:.gitignore']).text.replace(/$/, '\n'), headShort: g(fxDir, ['rev-parse', '--short', 'fx-base~1']).text };
      checkProject(check, scope, context, fxDir, exp);
      const prov = e.provenance || {};
      check(eq(Object.keys(prov).sort(), ['commands', 'commit', 'managedAllows', 'manifestRawSha256', 'planSha256', 'projectName', 'runId', 'skillVersion', 'tag', 'tree'].sort()), 'fixtures.v2.provenance has exactly its ten fields', Object.keys(prov));
      check(prov.tag === PIN.tag && prov.commit === PIN.commit && prov.tree === PIN.tree && prov.skillVersion === '2.0.0' && prov.runId === RUN_ID, 'provenance carries the pinned identity', prov);
      check(prov.projectName === 'fixture-wallet-api' && eq(prov.managedAllows, DEFAULT_ALLOWS), 'provenance records the project name and both default managed allows');
      check(prov.manifestRawSha256 === sha256(mRaw), 'provenance manifestRawSha256 covers the exact manifest bytes');
      check(/^[0-9a-f]{64}$/.test(String(prov.planSha256)), 'provenance planSha256 is a lowercase sha256', prov.planSha256);
      const content = (prov.commands && prov.commands[2] && prov.commands[2].args && prov.commands[2].args[6]) || '';
      const sk = path.dirname(path.dirname(path.dirname(String(content))));
      const srcWork = path.dirname(path.dirname(sk));
      check(sk.length > 10 && isInside(osTmp, sk), 'G7: the tagged source was extracted under the OS temp directory', sk);
      check(!isInside(out, sk) && !isInside(fxDir, sk), 'G7: the extraction directory is outside <out> and the project', sk);
      check(!exists(sk) && !exists(srcWork), 'G7: the extraction directory is deleted when the fixture succeeds', { sk: exists(sk), srcWork: exists(srcWork) });
      check(listFiles(osTmp).every((f) => !/(^|\/)lock\.mjs$/.test(f)), 'G7: no tagged source is left behind in the OS temp directory', listFiles(osTmp).slice(0, 5));
      const want = expectedCommands(fxDir, sk, prov.planSha256);
      check(Array.isArray(prov.commands) && prov.commands.length === 8 && want.every((w, i) => { const c = prov.commands[i] || {}; return c.phase === w.phase && c.script === w.script && c.status === 0 && argsMatch(c.args, w.args, w.pathIdx, fxDir) && eq(Object.keys(c).sort(), ['args', 'phase', 'script', 'status']); }), 'provenance holds the eight command records in phase order with the exact args', prov.commands);
      check(!!parent.text && /^[0-9a-f]+$/.test(parent.text), 'the fixture base has the pre-install initial commit as its parent');
      for (const dir of [path.join(fxDir, '.claude', 'skills', 'project-setup'), path.join(fxDir, '.agents', 'skills', 'project-setup')]) {
        check(readText(path.join(dir, 'VERSION')) === readText(path.join(context.skillRoot, 'VERSION')) && Buffer.compare(fs.readFileSync(path.join(dir, 'SKILL.md')), fs.readFileSync(path.join(context.skillRoot, 'SKILL.md'))) === 0, `${path.relative(fxDir, dir)} is a copy of the current skill under test`);
        check(exists(path.join(dir, 'data', 'secret-paths-v2.0.0.json')) && exists(path.join(dir, 'data', 'v2.0.0', 'assets', 'agents', 'reviewer.md')), `${path.relative(fxDir, dir)} carries the shipped v2 baselines (data is copied)`);
      }
      const exclude = readText(path.join(fxDir, '.git', 'info', 'exclude')) || '';
      check(exclude.includes('.claude/skills/') && exclude.includes('.agents/skills/'), 'both skill copies are git-excluded');
      for (const f of ['live-env.ps1', 'live-env.sh', path.join('.fixture-git', 'gitconfig')]) check(exists(path.join(out, f)), `${f} is generated`);
      const iso = e.isolation || {};
      check(iso.gpgsign === 'false' && iso.sampleHooksInGitDir === 0 && iso.unsignedHead === true && typeof iso.hooksPath === 'string' && iso.hooksPath.endsWith('hooks-empty'), 'the git isolation self-check is recorded as for the other kinds', iso);
      check(g(fxDir, ['config', '--get', 'core.hooksPath']).text.endsWith('hooks-empty') && g(fxDir, ['config', '--get', 'commit.gpgsign']).text === 'false', 'the fixture repository carries the isolated local config');
      if (h) { const m2 = await attempt(() => h.verifyV2Tag({ repository: context.repository })); check(!m2.threw && m2.value.commit === PIN.commit, 'the real tag still verifies after the run (nothing moved it)'); }
    });

    await step('G7 a failed live fixture keeps the extracted source and prints its path in the error', async () => {
      // A preload that makes only the tagged lock.mjs exit 7 fails the fixture after the source has been extracted; make-fixture itself,
      // git and the other children are unaffected.
      const out = scope.sub('v2out'), osTmp = scope.sub('ostmp'); fs.mkdirSync(osTmp, { recursive: true });
      const preload = path.join(scope.dir, 'inject-lock-failure.cjs');
      fs.writeFileSync(preload, "if (require('node:path').basename(String(process.argv[1] || '')) === 'lock.mjs') { process.stdout.write('{\"ok\":false,\"error\":\"injected failure\"}' + String.fromCharCode(10)); process.exit(7); }\n");
      const r = runNode([mf, '--kind', 'v2', '--out', out], context.repository, { ...env, TEMP: osTmp, TMP: osTmp, TMPDIR: osTmp, NODE_OPTIONS: `--require "${fwd(preload)}"` });
      check(r.code === 1 && noSuccessJson(r.stdout), 'the injected script failure fails the fixture: exit 1 and no success JSON', { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 300) });
      check(r.stderr.split(/\r?\n/).some((l) => l.startsWith('v2-baseline: V2_SCRIPT_FAILED')), 'stderr carries the v2-baseline: V2_SCRIPT_FAILED line', r.stderr.slice(0, 400));
      // The kept directory's path is printed in the error: take the longest existing prefix of every path-like run in stderr.
      let kept = null;
      for (const m of r.stderr.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^\r\n"'<>|*?]*/g)) {
        let c = m[0].trim();
        while (c.length > 3 && !exists(c)) c = c.slice(0, -1);
        if (exists(c) && isInside(osTmp, c) && !samePath(c, osTmp)) { kept = c; break; }
      }
      check(!!kept, 'the error prints the path of the kept extraction directory (inside the OS temp directory)', r.stderr.slice(0, 400));
      // Decision H5: the retained-path line the helper failures use is exactly "v2-baseline: tagged source kept at <absolute path>".
      const keptLine = keptLinePath(r.stderr);
      check(keptLine !== null && path.isAbsolute(keptLine) && !!kept && samePath(keptLine, kept), 'stderr carries the exact line "v2-baseline: tagged source kept at <absolute path>"', r.stderr.slice(0, 400));
      if (kept) {
        check(exists(path.join(kept, 'scripts', 'lock.mjs')) || exists(path.join(kept, 'source', 'project-setup', 'scripts', 'lock.mjs')) || listFiles(kept).some((f) => /(^|\/)lock\.mjs$/.test(f)), 'the printed directory still holds the extracted tagged source', listFiles(kept).slice(0, 5));
        check(!isInside(out, kept), 'the kept directory is outside <out>');
        if (isInside(osTmp, kept) && !samePath(kept, osTmp)) rmrf(kept);
      }
    });
    await step('4.3 a missing baseline tag fails the fixture, with no success output and no fallback', async () => {
      const dist = makeDist(scope, context, 'none'), out = scope.sub('v2out');
      const r = runNode([path.join(dist, 'project-setup', 'tests', 'live', 'make-fixture.mjs'), '--kind', 'v2', '--out', out], dist, env);
      check(r.code === 1, 'exit 1', { code: r.code, stderr: r.stderr.slice(0, 300) });
      check(noSuccessJson(r.stdout), 'no success JSON on stdout', r.stdout.slice(0, 200));
      check(r.stderr === 'v2-baseline: V2_TAG_MISSING\n', 'stderr is exactly the one error line', r.stderr);
      check(!exists(path.join(out, 'fixture-v2')) && !exists(path.join(`${out}.meta`, 'fixture-meta.json')), 'no fixture and no metadata are produced (no current-source fallback, no skip)');
    });
    await step('4.3 a moved baseline tag names the identity error', async () => {
      const dist = makeDist(scope, context, 'moved'), out = scope.sub('v2out');
      const r = runNode([path.join(dist, 'project-setup', 'tests', 'live', 'make-fixture.mjs'), '--kind', 'v2', '--out', out], dist, env);
      check(r.code === 1 && noSuccessJson(r.stdout), 'exit 1 and no success JSON', { code: r.code, stdout: r.stdout.slice(0, 200) });
      check(r.stderr === 'v2-baseline: V2_TAG_COMMIT_MISMATCH\n', 'stderr names the identity error', r.stderr);
      check(!exists(path.join(out, 'fixture-v2')) && !exists(path.join(`${out}.meta`, 'fixture-meta.json')), 'no fixture is produced from the current source as a fallback');
    });
    await step('4.3 occupied output or metadata destination, metadata beneath output, unknown kind', async () => {
      { const out = scope.sub('occ'); write(path.join(out, 'sentinel.txt'), 'keep\n'); const before = sentinelTree(out);
        const r = runNode([mf, '--kind', 'v2', '--out', out], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), 'occupied output: exit 1, no success result', { code: r.code, stdout: r.stdout.slice(0, 200) });
        check(eq(sentinelTree(out), before), 'occupied output: the sentinel is unchanged and nothing is added', listFiles(out)); }
      { const out = scope.sub('occ2'), metaDir = scope.sub('occmeta'); write(path.join(metaDir, 'sentinel.txt'), 'keep\n'); const before = sentinelTree(metaDir);
        const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', metaDir], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), 'occupied metadata destination: exit 1, no success result', { code: r.code, stdout: r.stdout.slice(0, 200) });
        check(eq(sentinelTree(metaDir), before), 'occupied metadata destination: the sentinel is unchanged and nothing is added', listFiles(metaDir)); }
      { const out = scope.sub('nest');
        const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', path.join(out, 'meta')], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), 'metadata beneath output: exit 1, no success result', { code: r.code, stdout: r.stdout.slice(0, 200) }); }
      { const out = scope.sub('bad');
        const r = runNode([mf, '--kind', 'bogus', '--out', out], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), 'unknown kind: exit 1, no success result', { code: r.code, stdout: r.stdout.slice(0, 200) }); }
    });

    // Existing kinds: default, explicit fresh, v1 and both. Branches, oracle, metadata and isolation are preserved.
    const kinds = [['default invocation', [], ['fresh', 'v1']], ['--kind both', ['--kind', 'both'], ['fresh', 'v1']], ['--kind fresh', ['--kind', 'fresh'], ['fresh']], ['--kind v1', ['--kind', 'v1'], ['v1']]];
    for (const [label, extra, want] of kinds) {
      await step(`4.3 ${label}: exactly ${want.join(' and ')}`, async () => {
        const out = scope.sub('k');
        const r = runNode([mf, '--out', out, ...extra], context.repository, env);
        check(r.code === 0, `${label}: exit 0`, { code: r.code, stderr: r.stderr.slice(0, 400) });
        const j = parseJson(r.stdout.trim());
        if (!j) { check(false, `${label}: stdout is one JSON document`, r.stdout.slice(0, 200)); return; }
        check(j.ok === true && j.skillVersion === version, `${label}: ok and skillVersion`, { ok: j.ok, skillVersion: j.skillVersion });
        check(eq((j.fixtures || []).map((f) => path.basename(f)), want.map((k) => `fixture-${k}`)), `${label}: exactly the ${want.join(' and ')} fixtures, never v2`, j.fixtures);
        check(!exists(path.join(out, 'fixture-v2')), `${label}: no fixture-v2 is created`);
        check(typeof j.note === 'string' && typeof j.next === 'string', `${label}: note and next`);
        check(want.includes('fresh') ? eq(Object.keys(j.reviewRanges || {}).sort(), ['change-1', 'change-2']) : j.reviewRanges === undefined, `${label}: reviewRanges present exactly when fresh is built`, j.reviewRanges);
        const meta = parseJson(readText(j.meta) || '') || {};
        check(eq(Object.keys(meta.fixtures || {}), want), `${label}: metadata fixtures are exactly ${want.join(' and ')}`, Object.keys(meta.fixtures || {}));
        const g = fixtureGit(out, env);
        for (const k of want) {
          const e = (meta.fixtures || {})[k] || {}; const dir = path.join(out, `fixture-${k}`);
          const iso = e.isolation || {};
          check(iso.gpgsign === 'false' && iso.sampleHooksInGitDir === 0 && iso.unsignedHead === true, `${label}/${k}: isolation self-check recorded`, iso);
          check(g(dir, ['rev-parse', 'fx-base^{commit}']).text === e.base, `${label}/${k}: fx-base is the recorded base`);
          for (const d of ['.claude', '.agents']) check(exists(path.join(dir, d, 'skills', 'project-setup', 'SKILL.md')), `${label}/${k}: ${d}/skills/project-setup is the skill under test`);
          check((readText(path.join(dir, '.git', 'info', 'exclude')) || '').includes('.claude/skills/'), `${label}/${k}: skill copies are git-excluded`);
          if (k === 'fresh') {
            check(e.oracle && e.oracle.base && e.oracle.base.correct === true && e.expected && /^change-[12]$/.test(String(e.expected.defective)), `${label}/fresh: the oracle proved the base correct and recorded the defective change`, e.expected);
            const def = e.expected && e.expected.defective, ctl = def === 'change-1' ? 'change-2' : 'change-1';
            check(e.oracle && e.oracle[def] && e.oracle[def].correct === false && e.oracle[ctl] && e.oracle[ctl].correct === true, `${label}/fresh: exactly the defective change fails the oracle`);
            check(g(dir, ['branch', '--list', 'fx/*']).text.split(/\r?\n/).map((s) => s.replace(/^[* ]+/, '').trim()).filter(Boolean).sort().join(',') === 'fx/change-1,fx/change-2', `${label}/fresh: the two oracle branches exist`);
            check(g(dir, ['tag', '--list']).text.split(/\r?\n/).filter(Boolean).sort().join(',') === 'fx-base,fx-change-1,fx-change-2', `${label}/fresh: fx-base and the two change tags exist`);
          } else {
            check(!e.oracle && !e.changes && /Generated by project-setup/.test(readText(path.join(dir, 'CLAUDE.md')) || '') && exists(path.join(dir, '.claudeignore')) && exists(path.join(dir, '.claude', 'agents', 'reviewer.md')), `${label}/v1: the v1 layout is intact`);
          }
        }
        for (const f of ['live-env.ps1', 'live-env.sh', path.join('.fixture-git', 'gitconfig')]) check(exists(path.join(out, f)), `${label}: ${f} is generated`);
      });
    }

    // ----- review defects R2 (live), R4 and R7 -----
    // R2 (live). Plan 3.7 ("Require unused output and metadata destinations"), plan 4.3 ("Metadata destination beneath output | Exit 1; no
    // success result") and decision H4: a path is outside a parent only when the relative path is exactly "..", starts with ".." followed by a
    // separator, or is absolute, so <out>/..meta is inside <out>. The metadata-beneath-output check compares canonical paths (each resolved
    // through its longest existing ancestor, following junctions), so a --meta that reaches the output directory through a junction alias is
    // rejected like a direct one: exit 1, no success JSON, nothing created.
    await step('R2 --meta <out>/..meta is metadata beneath the output and is refused with nothing created', async () => {
      for (const [label, extra] of [['--kind v2', ['--kind', 'v2']], ['the default kind', []]]) {
        const out = scope.sub('dd'), meta = path.join(out, '..meta');
        const r = runNode([mf, '--out', out, ...extra, '--meta', meta], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), `${label} with --meta <out>/..meta: exit 1 and no success result`, { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
        check(!exists(out) && !exists(meta), `${label} with --meta <out>/..meta: nothing is created (no output directory, no metadata directory)`, { out: exists(out), meta: exists(meta) });
      }
    });
    await step('R2 (H4) --meta reaching the output directory through a junction alias is metadata beneath the output', async () => {
      const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
      { // v2: neither destination exists yet; the alias is an ancestor of --meta and resolves to the directory that will hold --out.
        const target = scope.sub('aliastarget'), alias = scope.sub('alias'); fs.mkdirSync(target, { recursive: true });
        const made = tryLink(target, alias, 'junction');
        check(made, 'a junction to the directory that will hold --out can be created');
        if (made) {
          const out = path.join(target, 'o'), meta = path.join(alias, 'o', 'm');
          const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', meta], context.repository, env);
          check(r.code === 1 && noSuccessJson(r.stdout), '--kind v2 with --meta <junction to the parent of out>/o/m: exit 1 and no success result', { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
          check(fs.readdirSync(target).length === 0 && !exists(out) && isLink(alias), '--kind v2 with --meta <junction to the parent of out>/o/m: nothing is created through the alias or beside it', fs.readdirSync(target).slice(0, 5));
          rmrf(alias);
        }
      }
      { // the decision's own example: --meta <junction-to-out>/m with an existing empty --out (allowed for the existing kinds).
        const out = scope.sub('aliasout'), alias = scope.sub('alias'); fs.mkdirSync(out, { recursive: true });
        const made = tryLink(out, alias, 'junction');
        check(made, 'a junction to an existing empty output directory can be created');
        if (made) {
          const r = runNode([mf, '--kind', 'v1', '--out', out, '--meta', path.join(alias, 'm')], context.repository, env);
          check(r.code === 1 && noSuccessJson(r.stdout), '--kind v1 with --meta <junction to out>/m: exit 1 and no success result', { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
          check(fs.readdirSync(out).length === 0 && isLink(alias), '--kind v1 with --meta <junction to out>/m: nothing is created in the output directory or through the alias', fs.readdirSync(out).slice(0, 5));
          rmrf(alias);
        }
      }
      { // the same directory reached as --meta itself through the alias: it is the output directory, so it is not outside it.
        const out = scope.sub('aliasout'), alias = scope.sub('alias'); fs.mkdirSync(out, { recursive: true });
        const made = tryLink(out, alias, 'junction');
        check(made, 'a junction to a second existing empty output directory can be created');
        if (made) {
          const r = runNode([mf, '--kind', 'v1', '--out', out, '--meta', alias], context.repository, env);
          check(r.code === 1 && noSuccessJson(r.stdout), '--kind v1 with --meta <junction to out> itself: exit 1 and no success result', { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
          check(fs.readdirSync(out).length === 0 && isLink(alias), '--kind v1 with --meta <junction to out> itself: nothing is created in the output directory', fs.readdirSync(out).slice(0, 5));
          rmrf(alias);
        }
      }
    });

    // R4. Plan 3.7 ("For v2: Require unused output and metadata destinations"), plan 4.3 ("Occupied output or metadata destination | Exit 1;
    // sentinel unchanged"), G6 and decision H6: for --kind v2 the output and metadata destinations are each created non-recursively and
    // exclusively. Creation fails if the path exists in any form, including an empty directory, a junction or a symlink, even when it appears
    // after the initial existence check, and nothing is written through it or beside it; a destination whose parent directory does not exist is
    // refused with exit 1 and no parent is created. The "appears during the awaited tag verification" race is not tested: the plans give no seam
    // to make a destination appear at that moment. The exact stderr text is not asserted.
    await step('R4 --kind v2 refuses an existing empty or linked output or metadata destination and writes nothing through it', async () => {
      const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
      const cases = [
        ['an existing empty --out directory', 'out', 'dir'], ['an existing empty --meta directory', 'meta', 'dir'],
        ['a junction at --out that leads to an empty directory', 'out', 'junction'], ['a junction at --meta that leads to an empty directory', 'meta', 'junction'],
      ];
      for (const [label, which, shape] of cases) {
        const out = scope.sub('r4out'), meta = scope.sub('r4meta'), target = scope.sub('r4target');
        const occupied = which === 'out' ? out : meta, other = which === 'out' ? meta : out;
        let made = true;
        if (shape === 'dir') fs.mkdirSync(occupied, { recursive: true });
        else { fs.mkdirSync(target, { recursive: true }); made = tryLink(target, occupied, 'junction'); }
        check(made, `${label}: the occupied destination can be created for the test`);
        if (!made) continue;
        const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', meta], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), `${label}: exit 1 and no success result`, { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
        check(fs.readdirSync(shape === 'dir' ? occupied : target).length === 0, `${label}: nothing was written into the occupied destination${shape === 'dir' ? '' : ' or through the junction'}`, fs.readdirSync(shape === 'dir' ? occupied : target).slice(0, 5));
        check(shape === 'dir' ? !isLink(occupied) && fs.statSync(occupied).isDirectory() : isLink(occupied), `${label}: the occupied destination is still what it was`);
        check(!exists(other), `${label}: the other destination was not created`, { other: exists(other) });
        if (shape !== 'dir') rmrf(occupied);
      }
      const base = scope.sub('r4base'); fs.mkdirSync(base, { recursive: true });
      for (const [label, out, meta, missing] of [
        ['--out beneath a directory that does not exist', path.join(base, 'no-such-out-dir', 'out'), path.join(base, 'meta-a'), path.join(base, 'no-such-out-dir')],
        ['--meta beneath a directory that does not exist', path.join(base, 'out-b'), path.join(base, 'no-such-meta-dir', 'meta'), path.join(base, 'no-such-meta-dir')],
      ]) {
        const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', meta], context.repository, env);
        check(r.code === 1 && noSuccessJson(r.stdout), `${label}: exit 1 and no success result (destinations are created non-recursively)`, { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
        check(!exists(missing), `${label}: the missing parent directory was not created on the way`, { missing: exists(missing) });
      }
    });

    // R2-3. Decision H6: for --kind v2 the output and metadata destinations are each created non-recursively and exclusively, so creation fails if
    // the path exists in any form, "even when it appears after the initial existence check". A preload scoped to make-fixture.mjs (the technique
    // of the R7 test) puts an empty directory, or a junction to an empty directory, at the --out path and then, separately, at the --meta path,
    // immediately before make-fixture's own mkdirSync of that destination. Required: exit 1, no success JSON, the pre-placed entry unchanged
    // (still an empty directory, or still the junction) and nothing written through it. A marker file proves the destination was placed.
    await step('R2-3 (H6) a destination that appears after the existence check is refused, not reused', async () => {
      const preload = path.join(scope.dir, 'inject-race.cjs');
      fs.writeFileSync(preload, RACE_PRELOAD);
      const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
      for (const [which, shape] of [['out', 'dir'], ['meta', 'dir'], ['out', 'junction'], ['meta', 'junction']]) {
        const label = `a ${shape === 'dir' ? 'directory' : 'junction'} appears at --${which}`;
        const out = scope.sub('racout'), meta = scope.sub('racmeta'), target = scope.sub('ractarget'), mark = scope.sub('racmark');
        const placed = which === 'out' ? out : meta;
        if (shape === 'junction') fs.mkdirSync(target, { recursive: true });
        const r = runNode([mf, '--kind', 'v2', '--out', out, '--meta', meta], context.repository, { ...env, NODE_OPTIONS: `--require "${fwd(preload)}"`, PS_C11A_RACE_PATH: placed, PS_C11A_RACE_MODE: shape, PS_C11A_RACE_TARGET: target, PS_C11A_RACE_MARK: mark });
        check(exists(mark), `${label}: the destination was placed right before make-fixture's mkdirSync of it (test setup)`, r.stderr.slice(0, 200));
        check(r.code === 1 && !r.error && noSuccessJson(r.stdout), `${label}: exit 1 and no success result`, { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
        if (shape === 'dir') {
          let st = null; try { st = fs.lstatSync(placed); } catch { /* reported below */ }
          check(!!st && st.isDirectory() && !st.isSymbolicLink() && fs.readdirSync(placed).length === 0, `${label}: the pre-placed directory is still there and nothing was written into it`, st ? fs.readdirSync(placed).slice(0, 5) : 'missing');
        } else {
          check(isLink(placed) && fs.readdirSync(target).length === 0, `${label}: the pre-placed junction is still there and nothing was written through it`, { link: isLink(placed), target: exists(target) ? fs.readdirSync(target).slice(0, 5) : 'missing' });
          if (isLink(placed)) rmrf(placed);
        }
      }
    });

    // R7. Decisions G7 and H5: the extracted tagged source is kept until every v2 fixture output has been written, and deleted only after the
    // fixture has fully succeeded. Any failure after createV2InstalledFixture succeeds (base commit, tag, skill copies, isolation checks,
    // metadata or environment scripts) exits 1, prints no success JSON, and writes to stderr the error followed by the same retained-path line
    // the helper failures use: "v2-baseline: tagged source kept at <absolute path>". Two late failures are injected with a preload that touches
    // only make-fixture.mjs: git tag fx-base fails (right after the base commit), and the very last write of the run (live-env.sh) throws. The
    // success path (deletion) is covered by the first live test above.
    await step('R7 a failure after the v2 helper succeeded keeps the extracted source and prints its path', async () => {
      const preload = path.join(scope.dir, 'inject-late-failure.cjs');
      fs.writeFileSync(preload, LATE_FAIL_PRELOAD);
      for (const [label, mode] of [['git tag fx-base fails after the base commit', 'tag'], ['the last write of the run (live-env.sh) fails', 'last']]) {
        const out = scope.sub('v2out'), osTmp = scope.sub('ostmp'); fs.mkdirSync(osTmp, { recursive: true });
        const r = runNode([mf, '--kind', 'v2', '--out', out], context.repository, { ...env, TEMP: osTmp, TMP: osTmp, TMPDIR: osTmp, PS_C11A_LATE_FAIL: mode, NODE_OPTIONS: `--require "${fwd(preload)}"` });
        check(r.code === 1 && !r.error && noSuccessJson(r.stdout), `${label}: the fixture fails with exit code exactly 1 and no success JSON`, { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 300) });
        const kept = keptLinePath(r.stderr);
        check(kept !== null, `${label}: stderr has exactly one line "v2-baseline: tagged source kept at <path>"`, r.stderr.slice(0, 400));
        const lines = r.stderr.split(/\r?\n/).filter((l) => l !== '');
        check(kept !== null && lines.findIndex((l) => l === `v2-baseline: tagged source kept at ${kept}`) > 0, `${label}: the error comes first and the retained-path line follows it`, lines.slice(0, 6));
        if (kept !== null) {
          check(path.isAbsolute(kept) && kept === kept.trim() && exists(kept) && isInside(osTmp, kept) && !samePath(kept, osTmp), `${label}: the printed path is an absolute path of an existing directory inside the OS temp directory`, kept);
          check(listFiles(kept).some((f) => /(^|\/)lock\.mjs$/.test(f)), `${label}: the printed directory still holds the extracted tagged source`, listFiles(kept).slice(0, 5));
          check(!isInside(out, kept), `${label}: the kept directory is outside <out>`);
          rmrf(kept);
        }
        check(listFiles(osTmp).every((f) => !/(^|\/)lock\.mjs$/.test(f)), `${label}: after removing the kept directory nothing else of the tagged source is left in the OS temp directory`, listFiles(osTmp).slice(0, 5));
      }
    });
  });
}

// ============================================ V2/C11a/component-records ====
const EXPECTED = COMPONENT_INVENTORY.map(([id, name]) => ({ id, name }));
const nonEmptyLines = (s) => String(s).split('\n').filter((l) => l !== '');
// main() must not write process streams, call process.exit or set an exit code (plan 2.3); the guard records any attempt.
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
function quiet(check, label, rec) {
  check(rec.threw === null, `${label}: main resolves (never rejects)`, rec.threw && String(rec.threw.message));
  check(rec.out.length === 0 && rec.err.length === 0, `${label}: main writes no process stream`, { out: rec.out.join('').slice(0, 120), err: rec.err.join('').slice(0, 120) });
  check(rec.exits.length === 0 && !rec.exitCodeChanged, `${label}: main neither calls process.exit nor sets process.exitCode`, rec.exits);
}
function mainShape(check, label, v) {
  check(v && eq(Object.keys(v).sort(), ['exitCode', 'stderr', 'stdout']) && (v.exitCode === 0 || v.exitCode === 1) && typeof v.stdout === 'string' && typeof v.stderr === 'string', `${label}: main returns exactly { exitCode: 0|1, stdout, stderr }`, v && Object.keys(v));
  check(v && !/\r/.test(v.stdout) && (v.stdout === '' || v.stdout.endsWith('\n')), `${label}: every record line ends in LF`);
}
const passImpl = (id, log) => ({ id, run: () => { log.push(id); return { failures: [], skipped: null }; } });
const mkRegistry = (component, expected, impls) => ({ expected: { [component]: expected }, implementations: { [component]: impls } });
const mkWriter = (cap, behave) => (report, ctx) => { cap.push({ report, ctx }); return behave ? behave(report, ctx) : path.join(ctx.tmp, 'component-results.json'); };
const mkCase = (id, name = `case ${id}`) => ({ id, name, fn: () => undefined });

// Usage errors must exit at once. A CLI that ignores bad options could start a long run, so the first case that does not exit
// within the timeout ends the batch with one failure instead of repeating the wait.
function usageCli(check, context, cli, cases, want, label, stderrEmpty) {
  for (const [name, args] of cases) {
    const r = runNode([cli, ...args], context.repository, childEnv(context, { [NESTED_ENV]: '1' }), 40000);
    const dead = !!r.error || r.signal !== null;
    check(r.code === 1 && r.stdout === want && (!stderrEmpty || r.stderr === '') && !dead, `${label} ${name}: exit 1 and exactly ${JSON.stringify(want)}`, { code: r.code, signal: r.signal, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) });
    if (dead) { check(false, `${label}: the CLI did not exit on a usage error; the remaining usage cases are not run`); return; }
  }
}

async function componentRecords(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'cr');
    const rc = await need(failures, 'rc1-cases.mjs');
    const rcm = await need(failures, 'run-component-tests.mjs');
    if (!rc || !rcm) return;
    const resultsPath = path.join(context.tmp, 'component-results.json');
    let runTestsRejectsOptions = null;
    const expectedOf = () => EXPECTED.map((e) => ({ ...e }));
    const cm = async (argv, deps) => { const rec = await withStreamGuard(() => rcm.main(argv, deps)); quiet(check, `main ${argv.join(' ')}`, rec); return rec.value; };

    await step('2.3 import safety of the registry and the component runner', async () => {
      checkImportSafe(check, 'rc1-cases.mjs', scope, 'rc1-cases.mjs', ['BASELINE_CASE_IDS', 'RC1_CASE_IDS', 'REQUIRED_CASE_IDS', 'COMPONENT_ASSERTIONS', 'COMPONENT_IMPLEMENTATIONS', 'selectSuiteCases', 'runComponentAssertions', 'registerRc1Cases']);
      checkImportSafe(check, 'run-component-tests.mjs', scope, 'run-component-tests.mjs', ['main']);
      checkImportSafe(check, 'c11a.test.mjs', scope, 'c11a.test.mjs', ['C11A_IMPLEMENTATIONS']);
    });
    await step('3.1/3.3 frozen case-ID arrays and the expected C11a inventory', async () => {
      check(eq([...rc.BASELINE_CASE_IDS], BASELINE_IDS) && BASELINE_IDS.length === 60, 'BASELINE_CASE_IDS is the 60 baseline IDs in the frozen order', rc.BASELINE_CASE_IDS && rc.BASELINE_CASE_IDS.length);
      check(eq([...rc.REQUIRED_CASE_IDS], REQUIRED_IDS) && new Set(rc.REQUIRED_CASE_IDS).size === 100, 'REQUIRED_CASE_IDS is exactly 100 unique IDs: 60 baseline, 38 numbered, A5-templates, N8-doctor, in the frozen order', rc.REQUIRED_CASE_IDS && rc.REQUIRED_CASE_IDS.length);
      // G8: RC1_CASE_IDS is the 38 numbered IDs followed by A5-templates and N8-doctor (40 entries, plan 3.3 order); REQUIRED is BASELINE then RC1;
      // all three arrays are frozen with Object.freeze.
      check(eq([...rc.RC1_CASE_IDS], ADDITIONAL_IDS) && ADDITIONAL_IDS.length === 40 && eq([...rc.RC1_CASE_IDS.slice(0, 38)], NUMBERED_IDS) && eq([...rc.RC1_CASE_IDS.slice(38)], ['A5-templates', 'N8-doctor']), 'RC1_CASE_IDS is the 38 numbered IDs then A5-templates and N8-doctor, in plan 3.3 order', rc.RC1_CASE_IDS && rc.RC1_CASE_IDS.length);
      check(eq([...rc.REQUIRED_CASE_IDS], [...rc.BASELINE_CASE_IDS, ...rc.RC1_CASE_IDS]), 'REQUIRED_CASE_IDS is BASELINE_CASE_IDS followed by RC1_CASE_IDS');
      check(Object.isFrozen(rc.BASELINE_CASE_IDS) && Object.isFrozen(rc.RC1_CASE_IDS) && Object.isFrozen(rc.REQUIRED_CASE_IDS), 'BASELINE_CASE_IDS, RC1_CASE_IDS and REQUIRED_CASE_IDS are all Object.freeze-d', [Object.isFrozen(rc.BASELINE_CASE_IDS), Object.isFrozen(rc.RC1_CASE_IDS), Object.isFrozen(rc.REQUIRED_CASE_IDS)]);
      check(eq(plain(rc.COMPONENT_ASSERTIONS.C11a), EXPECTED), 'COMPONENT_ASSERTIONS.C11a is the exact expected inventory of plan 3.1, not derived from the implementations', rc.COMPONENT_ASSERTIONS && rc.COMPONENT_ASSERTIONS.C11a);
      const impls = (rc.COMPONENT_IMPLEMENTATIONS || {}).C11a || [];
      check(impls.length === 8 && eq(impls.map((i) => i.id), EXPECTED.map((e) => e.id)), 'COMPONENT_IMPLEMENTATIONS.C11a has exactly one implementation per expected ID', impls.map((i) => i.id));
      check(impls.every((i) => typeof i.run === 'function' && C11A_IMPLEMENTATIONS.some((m) => m.id === i.id && (m.run === i.run || String(m.run) === String(i.run)))), 'the implementations are the tests-lane C11A_IMPLEMENTATIONS (assertion bodies are not rewritten)');
      check(eq(C11A_IMPLEMENTATIONS.map((i) => i.id), EXPECTED.map((e) => e.id)) && C11A_IMPLEMENTATIONS.every((i) => typeof i.run === 'function'), 'C11A_IMPLEMENTATIONS holds the eight IDs of plan 3.1');
      const calls = []; const r = rc.registerRc1Cases((...a) => calls.push(a), context);
      check(calls.length === 0 && (r === undefined || (r && typeof r.then === 'function')), 'registerRc1Cases registers no complete rc.1 case at C11a landing (component assertions never masquerade as numbered cases)', calls.length);
    });
    await step('4.7 the 60 baseline cases stay registered in run-tests.mjs (the suite itself is not run here)', async () => {
      // No infrastructure test launches the complete baseline suite (plan 4). The full 59/0/1 (or 60/0/0) run is the
      // section 6 acceptance command; this only guards against a baseline case being removed or registered twice.
      const src = readText(path.join(context.skillRoot, 'tests', 'run-tests.mjs')) || '';
      for (const id of BASELINE_IDS) {
        const n = (src.match(new RegExp(`(^|[^A-Za-z0-9_])test\\(\\s*['"]${id}['"]\\s*,`, 'g')) || []).length;
        check(n === 1, `baseline case ${id} is registered exactly once`, n);
      }
    });
    await step('3.1 the default registry exists (component-unknown for an unknown component, nothing runs)', async () => {
      const rep = await rc.runComponentAssertions('C99-not-a-component', context);
      check(eq(plain(rep), { component: 'C99-not-a-component', ok: false, errors: [{ code: 'component-unknown' }], summary: { passed: 0, failed: 0, skipped: 0 }, results: [] }), 'default registry: unknown component returns the structural report', rep);
    });

    // ---- 4.4 eight passing groups ----
    await step('4.4 eight passing groups: eight exact records, 8/0/0, exit 0', async () => {
      const log = [], cap = [];
      const reg = mkRegistry('C11a', expectedOf(), EXPECTED.map((e) => passImpl(e.id, log)).reverse());
      const v = await cm(['--component', 'C11a'], { registry: reg, context, writeEvidence: mkWriter(cap) });
      mainShape(check, 'passing run', v);
      const want = [...EXPECTED.map((e) => `PASS  ${e.id}  ${e.name}`), '8 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${resultsPath}`];
      check(v && v.exitCode === 0 && v.stderr === '' && eq(nonEmptyLines(v.stdout), want), 'exit 0, empty stderr, the eight PASS records in expected order, totals and the RESULTS line', v && nonEmptyLines(v.stdout));
      check(eq(log, EXPECTED.map((e) => e.id)), 'each implementation ran exactly once, in expected order (not registration order)', log);
      check(cap.length === 1 && cap[0].ctx === context, 'the evidence writer ran once and received the supplied context', cap.length);
      check(cap.length === 1 && eq(plain(cap[0].report), { component: 'C11a', ok: true, errors: [], summary: { passed: 8, failed: 0, skipped: 0 }, results: EXPECTED.map((e) => ({ id: e.id, name: e.name, status: 'PASS', failures: [] })) }), 'the writer receives the complete report', cap[0] && cap[0].report);
      const log2 = [], cap2 = [];
      const rep = await rc.runComponentAssertions('C11a', context, { registry: mkRegistry('C11a', expectedOf(), EXPECTED.map((e) => passImpl(e.id, log2))) });
      check(eq(plain(rep), cap[0] && plain(cap[0].report)), 'runComponentAssertions returns the same report that main hands to the writer', rep);
      const v2 = await cm(['--component', 'C11a'], { registry: mkRegistry('C11a', expectedOf(), EXPECTED.map((e) => passImpl(e.id, cap2))), context, writeEvidence: async (rp, ctx) => path.join(ctx.tmp, 'component-results.json') });
      check(v2 && v2.exitCode === 0 && /^RESULTS {2}/.test(nonEmptyLines(v2.stdout).pop() || ''), 'an asynchronous evidence writer is awaited', v2 && v2.stdout.slice(-120));
    });

    // ---- 4.4 structural failures ----
    const A = { id: 'A', name: 'case a' }, B = { id: 'B', name: 'case b' }, C = { id: 'C', name: 'case c' };
    const noop = (id) => ({ id, run: () => ({ failures: [], skipped: null }) });
    const structural = [
      ['empty expected array', [], [], 'empty-inventory', undefined],
      ['empty expected array with an implementation present', [], [noop('A')], 'empty-inventory', undefined],
      ['expected descriptor with an empty id', [{ id: '', name: 'n' }], [noop('A')], 'inventory-invalid', null],
      ['expected descriptor without a name', [{ id: 'A' }], [noop('A')], 'inventory-invalid', 'A'],
      ['expected descriptor with an empty name', [{ id: 'A', name: '' }], [noop('A')], 'inventory-invalid', 'A'],
      ['expected name spanning two lines', [{ id: 'A', name: 'two\nlines' }], [noop('A')], 'inventory-invalid', 'A'],
      ['expected id spanning two lines', [{ id: 'A\nB', name: 'n' }], [noop('A')], 'inventory-invalid', null],
      ['expected descriptor that is null', [null], [noop('A')], 'inventory-invalid', null],
      ['implementation that is not callable', [A], [{ id: 'A', run: 'not callable' }], 'inventory-invalid', 'A'],
      ['implementation without run', [A], [{ id: 'A' }], 'inventory-invalid', 'A'],
      ['implementation that is null', [A], [null], 'inventory-invalid', null],
      ['implementation with a non-string id', [A], [{ id: 5, run: () => ({ failures: [], skipped: null }) }], 'inventory-invalid', null],
      ['duplicate expected ID', [A, B, { id: 'A', name: 'again' }], [noop('A'), noop('B')], 'duplicate-expected', 'A'],
      ['duplicate implementation', [A, B], [noop('A'), noop('B'), noop('A')], 'duplicate-group', 'A'],
      ['extra implementation', [A], [noop('A'), noop('Z')], 'unexpected-group', 'Z'],
      ['omitted implementation (first in expected order)', [A, B, C], [noop('A')], 'missing-group', 'B'],
      ['two unexpected implementations (first occurrence)', [A], [noop('A'), noop('Y'), noop('Z')], 'unexpected-group', 'Y'],
      ['two unexpected implementations (first occurrence, reversed)', [A], [noop('Z'), noop('A'), noop('Y')], 'unexpected-group', 'Z'],
      ['order: malformed implementation beats duplicate expected', [A, { id: 'A', name: 'again' }], [{ id: 'A', run: 'x' }], 'inventory-invalid', 'A'],
      ['order: duplicate expected beats unexpected implementation', [A, { id: 'A', name: 'again' }], [noop('A'), noop('Z')], 'duplicate-expected', 'A'],
      ['order: duplicate implementation beats unexpected implementation', [A], [noop('A'), noop('A'), noop('Z')], 'duplicate-group', 'A'],
      ['order: duplicate implementation beats missing implementation', [A, B], [noop('A'), noop('A')], 'duplicate-group', 'A'],
      ['order: unexpected implementation beats missing implementation', [A, B], [noop('A'), noop('Z')], 'unexpected-group', 'Z'],
    ];
    // G9: an inventory-invalid issue always has an id field: the offending assertion ID, or null when the issue is not about one ID (an
    // entry that is not an object, or an id that is itself empty, multi-line or not a string). The other codes carry an id only where they name one.
    // G10: the totals line is always printed, "0 PASS / 0 FAIL / 0 SKIP" for a structural failure, followed by the RESULTS line.
    await step('4.4 structural failures: first issue only, nothing runs, complete report retained', async () => {
      for (const [label, expected, impls, code, id] of structural) {
        const ran = [];
        const wrap = (list) => list.map((i) => (i && typeof i.run === 'function' ? { ...i, run: () => { ran.push(i.id); return i.run(); } } : i));
        const cap = [];
        const reg = mkRegistry('Cx', expected, wrap(impls));
        const v = await cm(['--component', 'Cx'], { registry: reg, context, writeEvidence: mkWriter(cap) });
        mainShape(check, label, v);
        const want = id === undefined ? { code } : { code, id };
        check(ran.length === 0, `${label}: no group runs after a structural failure`, ran);
        check(cap.length === 1 && cap[0].report && cap[0].report.component === 'Cx' && cap[0].report.ok === false && eq(plain(cap[0].report.results), []) && eq(plain(cap[0].report.summary), { passed: 0, failed: 0, skipped: 0 }), `${label}: the retained report has empty results and zero totals`, cap[0] && cap[0].report);
        check(cap.length === 1 && eq(plain(cap[0].report.errors), [want]), `${label}: exactly the first issue ${JSON.stringify(want)}`, cap[0] && cap[0].report.errors);
        check(v && v.exitCode === 1 && v.stderr === '' && eq(nonEmptyLines(v.stdout), [`COMPONENT  FAIL  ${code}${typeof id === 'string' ? `  ${id}` : ''}`, '0 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${resultsPath}`]), `${label}: exit 1, empty stderr, the issue line, zero totals and the RESULTS line`, v && nonEmptyLines(v.stdout));
        const direct = await rc.runComponentAssertions('Cx', context, { registry: mkRegistry('Cx', expected, impls) });
        check(direct && direct.ok === false && eq(plain(direct.results), []) && eq(plain(direct.summary), { passed: 0, failed: 0, skipped: 0 }) && eq(plain(direct.errors), [want]), `${label}: runComponentAssertions reports the same structural failure`, direct);
      }
    });
    await step('4.4 an unknown component runs no group', async () => {
      const ran = [], cap = [];
      const reg = mkRegistry('Cx', [A], [{ id: 'A', run: () => { ran.push('A'); return { failures: [], skipped: null }; } }]);
      const v = await cm(['--component', 'C99'], { registry: reg, context, writeEvidence: mkWriter(cap) });
      mainShape(check, 'unknown component', v);
      check(v && v.exitCode === 1 && v.stderr === '' && eq(nonEmptyLines(v.stdout), ['COMPONENT  FAIL  component-unknown', '0 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${resultsPath}`]) && ran.length === 0, 'component-unknown, exit 1, no group ran', v && nonEmptyLines(v.stdout));
      check(cap.length === 1 && eq(plain(cap[0].report), { component: 'C99', ok: false, errors: [{ code: 'component-unknown' }], summary: { passed: 0, failed: 0, skipped: 0 }, results: [] }), 'the retained report is the exact structural report', cap[0] && cap[0].report);
    });

    // R8. Plan 3.1: "Within a category, use expected order where available, otherwise first implementation occurrence. ID-specific errors include
    // id." The first issue of a category is therefore the first ID in the expected list that has the problem, not the first problem met while
    // scanning the registered implementations or the second occurrence of a duplicate. Same checks as the structural table above.
    const ordering = [
      ['duplicate-expected, expected [A, B, B, A]: A comes first in expected order', [A, B, { id: 'B', name: 'again' }, { id: 'A', name: 'again' }], [noop('A'), noop('B')], 'duplicate-expected', 'A'],
      ['duplicate-expected, expected [B, A, A, B]: B comes first in expected order', [B, A, { id: 'A', name: 'again' }, { id: 'B', name: 'again' }], [noop('A'), noop('B')], 'duplicate-expected', 'B'],
      ['inventory-invalid, expected [A, B], malformed callbacks registered [B, A]: A comes first in expected order', [A, B], [{ id: 'B', run: 'not callable' }, { id: 'A', run: 'not callable' }], 'inventory-invalid', 'A'],
      ['inventory-invalid, expected [B, A], malformed callbacks registered [A, B]: B comes first in expected order', [B, A], [{ id: 'A', run: 'not callable' }, { id: 'B', run: 'not callable' }], 'inventory-invalid', 'B'],
      ['duplicate-group, expected [A, B], implementations registered [B, A, B, A]: A comes first in expected order', [A, B], [noop('B'), noop('A'), noop('B'), noop('A')], 'duplicate-group', 'A'],
    ];
    await step('R8 structural errors are reported in expected order within a category', async () => {
      for (const [label, expected, impls, code, id] of ordering) {
        const ran = [], cap = [];
        const wrap = (list) => list.map((i) => (i && typeof i.run === 'function' ? { ...i, run: () => { ran.push(i.id); return i.run(); } } : i));
        const v = await cm(['--component', 'Cx'], { registry: mkRegistry('Cx', expected, wrap(impls)), context, writeEvidence: mkWriter(cap) });
        const want = { code, id };
        check(ran.length === 0, `${label}: no group runs after a structural failure`, ran);
        check(cap.length === 1 && eq(plain(cap[0].report.errors), [want]) && eq(plain(cap[0].report.results), []) && eq(plain(cap[0].report.summary), { passed: 0, failed: 0, skipped: 0 }), `${label}: exactly the first issue ${JSON.stringify(want)} in the retained report`, cap[0] && cap[0].report.errors);
        check(v && v.exitCode === 1 && v.stderr === '' && eq(nonEmptyLines(v.stdout), [`COMPONENT  FAIL  ${code}  ${id}`, '0 PASS / 0 FAIL / 0 SKIP', `RESULTS  ${resultsPath}`]), `${label}: exit 1 and the issue line, zero totals and the RESULTS line`, v && nonEmptyLines(v.stdout));
        const direct = await rc.runComponentAssertions('Cx', context, { registry: mkRegistry('Cx', expected, impls) });
        check(direct && direct.ok === false && eq(plain(direct.errors), [want]), `${label}: runComponentAssertions reports the same first issue`, direct && direct.errors);
      }
    });

    // ---- 4.4 execution outcomes ----
    const runWith = async (label, idx, make, { want, lines }) => {
      const log = [], cap = [];
      const impls = EXPECTED.map((e, i) => (i === idx ? { id: e.id, run: make(log) } : passImpl(e.id, log)));
      const v = await cm(['--component', 'C11a'], { registry: mkRegistry('C11a', expectedOf(), impls), context, writeEvidence: mkWriter(cap) });
      mainShape(check, label, v);
      const e = EXPECTED[idx];
      const wantReport = { component: 'C11a', ok: false, errors: [], summary: { passed: 7, failed: 1, skipped: 0 }, results: EXPECTED.map((x, i) => (i === idx ? { id: x.id, name: x.name, status: 'FAIL', failures: want } : { id: x.id, name: x.name, status: 'PASS', failures: [] })) };
      check(cap.length === 1 && eq(plain(cap[0].report), wantReport), `${label}: the group is FAIL with exactly ${JSON.stringify(want)}, the other seven PASS, skipped stays 0`, cap[0] && cap[0].report.results[idx]);
      const expLines = [...EXPECTED.flatMap((x, i) => (i === idx ? [`FAIL  ${x.id}  ${x.name}`, ...want.map((f) => `        - ${f}`)] : [`PASS  ${x.id}  ${x.name}`])), '7 PASS / 1 FAIL / 0 SKIP', `RESULTS  ${resultsPath}`];
      check(v && v.exitCode === 1 && v.stderr === '' && eq(nonEmptyLines(v.stdout), expLines), `${label}: exit 1, FAIL record with an eight-space "- " diagnostic, totals 7/1/0 and the RESULTS line`, v && nonEmptyLines(v.stdout));
      check(log.length === 7, `${label}: the remaining groups still run`, log.length);
    };
    await step('4.4 a group throws, skips, fails and skips, or returns a malformed outcome', async () => {
      await runWith('group throws Error("boom")', 3, () => () => { throw new Error('boom'); }, { want: ['threw: boom'] });
      await runWith('group rejects with Error("boom")', 5, () => async () => { throw new Error('boom'); }, { want: ['threw: boom'] });
      await runWith('group returns skip "unavailable"', 2, () => () => ({ failures: [], skipped: 'unavailable' }), { want: ['skip-forbidden: unavailable'] });
      await runWith('group returns failure "bad" and the same skip', 6, () => () => ({ failures: ['bad'], skipped: 'unavailable' }), { want: ['bad', 'skip-forbidden: unavailable'] });
      for (const [label, value] of [['undefined', undefined], ['null', null], ['a string', 'PASS'], ['failures not an array', { failures: 'x', skipped: null }], ['a non-string failure', { failures: [1], skipped: null }], ['no failures field', { skipped: null }]]) {
        await runWith(`group returns ${label}`, 0, () => () => value, { want: ['invalid-outcome'] });
      }
    });
    await step('4.4 the evidence writer fails: only COMPONENT  FAIL  evidence-write', async () => {
      const behaviours = {
        'throws': () => { throw new Error('disk full'); }, 'rejects': async () => { throw new Error('disk full'); },
        'returns a relative path': () => 'component-results.json', 'returns an empty path': () => '', 'returns undefined': () => undefined, 'returns a non-string': () => 5,
      };
      for (const [label, behave] of Object.entries(behaviours)) {
        const log = [], cap = [];
        const v = await cm(['--component', 'C11a'], { registry: mkRegistry('C11a', expectedOf(), EXPECTED.map((e) => passImpl(e.id, log))), context, writeEvidence: mkWriter(cap, behave) });
        mainShape(check, `writer ${label}`, v);
        check(v && v.exitCode === 1 && v.stdout === 'COMPONENT  FAIL  evidence-write\n' && v.stderr === '', `writer ${label}: exit 1 and only COMPONENT  FAIL  evidence-write`, v);
        check(cap.length === 1, `writer ${label}: the writer was called once`, cap.length);
      }
    });
    await step('2.6 the default evidence writer creates <context.tmp>/component-results.json exclusively', async () => {
      const ctx = { ...context, tmp: scope.sub('cctx') }; fs.mkdirSync(ctx.tmp, { recursive: true });
      const file = path.join(ctx.tmp, 'component-results.json');
      const mkReg = () => mkRegistry('C11a', expectedOf(), EXPECTED.map((e) => passImpl(e.id, [])));
      const v = await cm(['--component', 'C11a'], { registry: mkReg(), context: ctx });
      const last = nonEmptyLines((v && v.stdout) || '').pop() || '';
      check(v && v.exitCode === 0 && /^RESULTS {2}/.test(last) && path.isAbsolute(last.slice(9)) && samePath(last.slice(9), file), 'the RESULTS line names <context.tmp>/component-results.json', last);
      const rep = parseJson(readText(file) || '');
      check(rep && eq(rep, { component: 'C11a', ok: true, errors: [], summary: { passed: 8, failed: 0, skipped: 0 }, results: EXPECTED.map((e) => ({ id: e.id, name: e.name, status: 'PASS', failures: [] })) }), 'the retained JSON report is the complete report', rep && Object.keys(rep));
      const before = readText(file);
      const again = await cm(['--component', 'C11a'], { registry: mkReg(), context: ctx });
      check(again && again.exitCode === 1 && again.stdout === 'COMPONENT  FAIL  evidence-write\n' && readText(file) === before, 'creation is exclusive: a second run into the same directory is evidence-write and leaves the report untouched', again);
    });
    await step('2.6 usage errors invoke neither the registry nor the writer', async () => {
      const argvs = { 'no arguments': [], 'missing value': ['--component'], 'duplicate --component': ['--component', 'C11a', '--component', 'C11a'], 'unknown option': ['--bogus'], 'unknown option after a valid one': ['--component', 'C11a', '--bogus'] };
      for (const [label, argv] of Object.entries(argvs)) {
        let touched = 0, wrote = 0;
        const registry = new Proxy({}, { get() { touched++; return undefined; }, has() { touched++; return false; }, ownKeys() { touched++; return []; }, getOwnPropertyDescriptor() { touched++; return undefined; } });
        const v = await cm(argv, { registry, context, writeEvidence: () => { wrote++; return path.join(context.tmp, 'x.json'); } });
        mainShape(check, `usage: ${label}`, v);
        check(v && v.exitCode === 1 && v.stdout === 'COMPONENT  FAIL  usage\n' && v.stderr === '', `usage: ${label}: exit 1, exactly COMPONENT  FAIL  usage, empty stderr`, v);
        check(touched === 0 && wrote === 0, `usage: ${label}: the registry and the writer are not touched`, { touched, wrote });
      }
      usageCli(check, context, path.join(context.skillRoot, 'tests', 'run-component-tests.mjs'), [['--bogus', ['--bogus']], ['no arguments', []], ['missing value', ['--component']]], 'COMPONENT  FAIL  usage\n', 'CLI', true);
    });

    // ---- 4.5 selection and registration ----
    const sel = (cases, opts) => (opts === undefined ? rc.selectSuiteCases(cases) : rc.selectSuiteCases(cases, opts));
    await step('4.5 exact-ID selection versus substring selection', async () => {
      const r86 = mkCase('R86', 'first case'), r91 = mkCase('R91', 'covers R86 hooks');
      const cases = [r86, r91];
      const byId = sel(cases, { onlyId: 'R86' });
      check(byId.length === 1 && byId[0] === r86, 'onlyId R86 selects R86 only (R91 name contains "R86 ")', byId.map((c) => c.id));
      const bySub = sel(cases, { only: 'R86 ' });
      check(bySub.length === 2 && bySub[0] === r86 && bySub[1] === r91, 'only "R86 " keeps the diagnostic substring behaviour and selects both, in registration order', bySub.map((c) => c.id));
      const sub91 = sel(cases, { only: 'R91' });
      check(sub91.length === 1 && sub91[0] === r91, 'only "R91" matches "<id> <name>"', sub91.map((c) => c.id));
      for (const [label, o] of [['no options', undefined], ['empty options', {}], ['both null', { only: null, onlyId: null }]]) {
        const all = sel(cases, o); check(all.length === 2 && all[0] === r86 && all[1] === r91, `${label}: every case is selected`, all.map((c) => c.id));
      }
      const rev = sel([r91, r86], { only: 'R' }); check(rev[0] === r91 && rev[1] === r86, 'selected cases keep registration order');
      let ran = 0; const probe = { id: 'P1', name: 'probe', fn: () => { ran++; } };
      const frozen = Object.freeze([Object.freeze(probe)]);
      const out = sel(frozen, { onlyId: 'P1' }); check(out.length === 1 && out[0] === probe && ran === 0 && frozen.length === 1, 'selection is pure: frozen input is fine, fn is never called, original objects are returned');
    });
    await step('4.5 selection and case errors', async () => {
      const cases = [mkCase('R86'), mkCase('R91', 'covers R86 hooks')];
      const expectToken = async (label, fn, token) => {
        const r = await attempt(async () => fn());
        // G11: the token is err.code and err.message starts with the same token.
        check(r.threw && isErr(r.error) && r.error.code === token && typeof r.error.message === 'string' && r.error.message.startsWith(token), `${label}: throws an Error with code ${token} and a message that starts with it`, r.threw ? { code: r.error && r.error.code, message: r.error && r.error.message } : r.value);
      };
      await expectToken('duplicate IDs', () => sel([mkCase('A', 'one'), mkCase('A', 'two')]), 'SUITE_DUPLICATE_ID');
      await expectToken('duplicate IDs with an unrelated selector', () => sel([mkCase('A', 'one'), mkCase('A', 'two'), mkCase('B')], { onlyId: 'B' }), 'SUITE_DUPLICATE_ID');
      for (const [label, cs, o] of [['onlyId matching nothing', cases, { onlyId: 'R99' }], ['only matching nothing', cases, { only: 'zzz-matches-nothing' }], ['no cases at all', [], undefined], ['onlyId in another case', cases, { onlyId: 'r86' }], ['onlyId prefix of an id', cases, { onlyId: 'R8' }], ['onlyId with a trailing space', cases, { onlyId: 'R86 ' }]]) await expectToken(`empty selection (${label})`, () => sel(cs, o), 'SUITE_EMPTY_SELECTION');
      await expectToken('both selectors', () => sel(cases, { only: 'R8', onlyId: 'R86' }), 'SUITE_USAGE');
      for (const [label, o] of [['empty only', { only: '' }], ['empty onlyId', { onlyId: '' }], ['numeric only', { only: 5 }], ['numeric onlyId', { onlyId: 5 }], ['array only', { only: ['R86'] }], ['object onlyId', { onlyId: {} }]]) await expectToken(`selector value (${label})`, () => sel(cases, o), 'SUITE_USAGE');
      const fn = () => undefined;
      for (const [label, bad] of [['empty id', { id: '', name: 'n', fn }], ['empty name', { id: 'R1', name: '', fn }], ['multi-line id', { id: 'R1\nx', name: 'n', fn }], ['multi-line name', { id: 'R1', name: 'a\nb', fn }], ['non-callable fn', { id: 'R1', name: 'n', fn: 'x' }], ['missing fn', { id: 'R1', name: 'n' }], ['missing id', { name: 'n', fn }], ['null case', null]]) await expectToken(`malformed case (${label})`, () => sel([bad]), 'SUITE_CASE_INVALID');
    });
    await step('3.2 run-tests.mjs CLI: selector conflicts, missing values, unknown options and empty selections', async () => {
      if (process.env[NESTED_ENV] === '1') return; // a nested invocation must never launch another suite run
      const rt = path.join(context.skillRoot, 'tests', 'run-tests.mjs');
      const sandbox = scope.sub('rt'); fs.mkdirSync(sandbox, { recursive: true });
      const env = childEnv(context, { [NESTED_ENV]: '1', TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox });
      // Every case must be rejected immediately; the timeout stops a broken runner from executing the whole suite.
      const bad = { 'unknown option': ['--bogus-option'], 'both selectors': ['--only', 'R86', '--only-id', 'R86'], 'missing --only-id value': ['--only-id'], 'missing --only value': ['--only'], 'empty --only-id value': ['--only-id', ''], 'empty --only-id selection': ['--only-id', 'NO-SUCH-ID'], 'empty --only selection': ['--only', 'zzz-no-such-case'], '--only-id is exact, not a prefix': ['--only-id', 'S0'] };
      // The unknown-option probe runs first with a short timeout: a runner that ignores options would execute the whole suite, so
      // its result decides whether the remaining CLI cases (and the --only-id run) are safe to launch.
      for (const [label, args] of Object.entries(bad)) {
        const r = runNode([rt, ...args], context.repository, env, label === 'unknown option' ? 25000 : 40000);
        const dead = !!r.error || r.signal !== null;
        check(r.code === 1 && !dead, `run-tests ${label}: exit 1 straight away`, { code: r.code, signal: r.signal, error: r.error && r.error.code });
        check(!/^(PASS|SKIP) {2}/m.test(r.stdout), `run-tests ${label}: no successful record is printed`, r.stdout.slice(0, 200));
        if (label === 'unknown option') { runTestsRejectsOptions = r.code === 1 && !dead; if (!runTestsRejectsOptions) { check(false, 'run-tests.mjs does not reject unknown options, so its remaining CLI cases are not run (they could launch the whole suite)'); break; } }
      }
    });
    await step('3.2 run-tests.mjs CLI: --only-id runs exactly that case and emits the record, totals, envelope and evidence', async () => {
      if (process.env[NESTED_ENV] === '1') return;
      if (runTestsRejectsOptions !== true) { check(false, '--only-id cannot be exercised yet: run-tests.mjs does not reject unknown options, so the run could start the whole suite'); return; }
      const rt = path.join(context.skillRoot, 'tests', 'run-tests.mjs');
      const sandbox = scope.sub('rt'); fs.mkdirSync(sandbox, { recursive: true });
      const env = childEnv(context, { [NESTED_ENV]: '1', TEMP: sandbox, TMP: sandbox, TMPDIR: sandbox });
      for (const keep of [true, false]) {
        const r = runNode([rt, ...(keep ? ['--keep'] : []), '--only-id', 'S09'], context.repository, env, 240000);
        const label = `--only-id S09${keep ? ' --keep' : ''}`;
        check(r.code === 0 && !r.error, `${label}: exit 0`, { code: r.code, stderr: r.stderr.slice(0, 300), stdout: r.stdout.slice(-300) });
        const ls = r.stdout.split(/\r?\n/), ne = ls.filter(Boolean);
        const recs = ls.filter((l) => /^(PASS|FAIL|SKIP) {2}/.test(l));
        check(recs.length === 1 && /^PASS {2}S09 {2}\S.*$/.test(recs[0]), `${label}: exactly one PASS record for S09 (the id is matched exactly, other cases are not run)`, recs);
        const totals = ne.filter((l) => /^\d+ PASS \/ \d+ FAIL \/ \d+ SKIP$/.test(l));
        check(eq(totals, ['1 PASS / 0 FAIL / 0 SKIP']), `${label}: one totals line 1 PASS / 0 FAIL / 0 SKIP`, totals);
        const env0 = parseJson(ne[ne.length - 1] || '');
        check(env0 && eq(Object.keys(env0).sort(), ['env', 'resultsFile', 'summary']) && eq(Object.keys(env0.env || {}).sort(), ['git', 'node', 'platform', 'release']) && Object.values(env0.env || {}).every((x) => typeof x === 'string' && x !== ''), `${label}: the last nonempty line is the JSON envelope with env, summary and resultsFile`, ne[ne.length - 1] && ne[ne.length - 1].slice(0, 200));
        check(env0 && eq(env0.summary, { passed: 1, failed: 0, skipped: 0 }) && path.isAbsolute(String(env0.resultsFile)), `${label}: envelope summary 1/0/0 and an absolute resultsFile`, env0 && env0.summary);
        if (!env0) continue;
        const file = readText(env0.resultsFile);
        if (keep) {
          const rep = parseJson(file || '');
          check(rep && eq(Object.keys(rep).sort(), ['env', 'results', 'summary']) && eq(rep.env, env0.env) && eq(rep.summary, env0.summary) && rep.results.length === 1 && rep.results[0].id === 'S09' && eq(rep.results[0].failures, []) && rep.results[0].skipped === null && recs[0] === `PASS  S09  ${rep.results[0].name}`, `${label}: --keep retains a results file that matches stdout`, rep && rep.results);
        } else check(file === null, `${label}: without --keep a clean run leaves no results file`);
      }
    });
  });
}

// ================================================ V2/C11a/strict-gate ====
const tallyOf = (records) => ({ passed: records.filter((r) => r.kind === 'PASS').length, failed: records.filter((r) => r.kind === 'FAIL').length, skipped: records.filter((r) => r.kind === 'SKIP').length });
const recLine = (r) => (r.raw !== undefined ? r.raw : r.kind === 'SKIP' ? `SKIP  ${r.id}  ${r.name}  (${r.reason})` : `${r.kind}  ${r.id}  ${r.name}`);
const totalLine = (t) => `${t.passed} PASS / ${t.failed} FAIL / ${t.skipped} SKIP`;
// A synthetic suite transcript: "PASS  <id>  case <id>" per record, a totals line, a blank line, the JSON envelope last.
function gateModel(ids, resultsFile, over = {}) {
  return { only: null, env: { ...GATE_ENV }, resultsFile, records: ids.map((id) => ({ kind: 'PASS', id, name: `case ${id}` })), status: 0, signal: null, error: null, timedOut: false, truncated: false, stderr: '', eol: '\n', ...over };
}
function renderStdout(m) {
  const L = [...(m.pre || [])];
  for (const r of m.records) { L.push(recLine(r)); for (const d of r.diag || []) L.push(`        - ${d}`); }
  const t = tallyOf(m.records);
  if (m.totalLines !== undefined) L.push(...m.totalLines); else L.push(totalLine(t));
  L.push('');
  const env0 = { env: m.env, summary: m.summary || t, resultsFile: m.resultsFile };
  if (m.envelopeLines !== undefined) L.push(...m.envelopeLines); else L.push(JSON.stringify(m.envelopeEdit ? m.envelopeEdit(env0) : env0));
  if (m.after) L.push(...m.after);
  return L.join(m.eol) + m.eol;
}
function reportObject(m) {
  return { env: m.reportEnv || m.env, summary: m.reportSummary || tallyOf(m.records), results: m.records.map((r) => ({ id: r.id, name: r.name, failures: r.kind === 'FAIL' ? (r.diag && r.diag.length ? r.diag : ['failed']) : [], skipped: r.kind === 'SKIP' ? r.reason : null })) };
}
function renderReport(m) {
  if (m.reportOverride !== undefined) return m.reportOverride;
  const o = reportObject(m);
  return { text: JSON.stringify(m.reportEdit ? m.reportEdit(o) : o, null, 2) };
}
const gateInput = (m) => ({ only: m.only, status: m.status, signal: m.signal, error: m.error, timedOut: m.timedOut, truncated: m.truncated, stdout: renderStdout(m), stderr: m.stderr, report: renderReport(m) });
const setRec = (m, id, fn) => { const r = m.records.find((x) => x.id === id); fn(r); return m; };

async function strictGate(context) {
  return runAssertion(async ({ failures, check, step }) => {
    const scope = newScope(context, 'gate');
    const acc = await need(failures, 'accept-rc1.mjs');
    if (!acc) return;
    const RES = path.join(context.tmp, 'gate-fixture', 'results.json');
    const EVID = path.join(context.tmp, 'gate-evidence');
    const full = (over) => gateModel(REQUIRED_IDS, RES, over);
    const focus = (id, over) => gateModel([id], RES, { only: id, ...(over || {}) });
    const V = (m) => acc.validateSuiteEvidence(deepFreeze(gateInput(m)));
    const OKFULL = { passed: 100, failed: 0, skipped: 0 };
    const mut = (fn) => { const m = full(); fn(m); return m; };
    const expectOk = (label, m, summary) => {
      const r = V(m);
      check(r && r.ok === true && eq(r.errors, []) && eq(r.summary, summary) && r.resultsFile === RES && eq(Object.keys(r).sort(), ['errors', 'ok', 'resultsFile', 'summary']), `${label}: ok, no errors, summary ${JSON.stringify(summary)}, resultsFile`, r);
    };
    // G12: every failure carries summary and resultsFile. Each is the value from the stdout envelope when that envelope is structurally valid,
    // and null when it is not, for every error code (suite-execution, suite-exit and malformed-record included). A model flagged g12 'null' has an
    // unusable envelope; one flagged g12 'skip' (a repeated envelope, or text after the last envelope) is not asserted for the two fields.
    const expectErr = (label, m, issues, { summary, resultsFile, g12 } = {}) => {
      const r = V(m);
      check(r && r.ok === false && eq(r.errors, issues) && eq(Object.keys(r).sort(), ['errors', 'ok', 'resultsFile', 'summary']), `${label}: exactly ${JSON.stringify(issues)}`, r && { ok: r.ok, errors: r.errors });
      const mode = g12 || m.g12 || 'filled';
      if (mode === 'filled') check(r && eq(r.summary, m.summary || tallyOf(m.records)) && r.resultsFile === m.resultsFile, `${label}: summary and resultsFile are the structurally valid envelope values`, r && { summary: r.summary, resultsFile: r.resultsFile });
      else if (mode === 'null') check(r && r.summary === null && r.resultsFile === null, `${label}: summary and resultsFile are present and null (no usable envelope)`, r && { summary: r.summary, resultsFile: r.resultsFile });
      if (summary !== undefined) check(r && eq(r.summary, summary), `${label}: summary is ${JSON.stringify(summary)}`, r && r.summary);
      if (resultsFile !== undefined) check(r && r.resultsFile === resultsFile, `${label}: resultsFile is ${resultsFile === null ? 'null' : 'the envelope path'}`, r && r.resultsFile);
    };

    await step('2.3 import safety of the gate', async () => { checkImportSafe(check, 'accept-rc1.mjs', scope, 'accept-rc1.mjs', ['main', 'validateSuiteEvidence']); });
    await step('3.3 the literal inventory has 60 + 38 + 2 = 100 unique IDs', async () => {
      check(BASELINE_IDS.length === 60 && NUMBERED_IDS.length === 38 && NAMED_IDS.length === 2 && REQUIRED_IDS.length === 100 && new Set(REQUIRED_IDS).size === 100, 'independent literal copy of the required IDs is consistent', { b: BASELINE_IDS.length, n: NUMBERED_IDS.length, all: REQUIRED_IDS.length });
    });

    // ---- 4.6 all-pass and skip transcripts ----
    await step('4.6 all-pass transcript and the Windows R13d skip transcript', async () => {
      expectOk('100 PASS', full(), OKFULL);
      expectOk('99 PASS plus the Windows R13d skip', mut((m) => setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; })), { passed: 99, failed: 0, skipped: 1 });
      expectOk('CRLF line framing', full({ eol: '\r\n' }), OKFULL);
      expectOk('CRLF framing with the Windows R13d skip', mut((m) => { m.eol = '\r\n'; setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); }), { passed: 99, failed: 0, skipped: 1 });
      // H7a: a line that begins with exactly eight spaces and "- " is a failure diagnostic, never a totals candidate, even if it contains PASS.
      expectOk('non-record diagnostic lines before the records are not results', mut((m) => { m.pre = ['note: starting the suite', '        - PASS  R86  case R86 (an indented diagnostic is not a record)']; }), OKFULL);
      expectOk('record-shaped lines on stderr do not count', mut((m) => { m.stderr = 'PASS  R87  case R87\nFAIL  R01  case R01\n'; }), OKFULL);
      expectOk('a non-Windows platform with no skip', mut((m) => { m.env = { ...GATE_ENV, platform: 'linux' }; }), OKFULL);
      const noFinalLf = full(); const inp = gateInput(noFinalLf); inp.stdout = inp.stdout.replace(/\n$/, '');
      const r = acc.validateSuiteEvidence(inp);
      check(r && r.ok === true && eq(r.errors, []), 'a final envelope line without a trailing newline is accepted', r);
      for (const id of REQUIRED_IDS) { const m = focus(id); const rr = V(m); if (!(rr && rr.ok === true && eq(rr.summary, { passed: 1, failed: 0, skipped: 0 }))) check(false, `focused ${id} PASS is accepted with 1/0/0 (including R13d)`, rr); }
    });

    // ---- 4.6 record-level mutations ----
    await step('4.6 remove each required ID (all 100): missing-record with that ID', async () => {
      for (const id of REQUIRED_IDS) expectErr(`remove ${id}`, mut((m) => { m.records = m.records.filter((r) => r.id !== id); }), [{ code: 'missing-record', id }]);
      expectErr('remove two IDs: the first in required order is reported', mut((m) => { m.records = m.records.filter((r) => r.id !== 'R40' && r.id !== 'R03a'); }), [{ code: 'missing-record', id: 'R03a' }]);
    });
    await step('4.6 duplicate, unexpected, contradictory and failed records', async () => {
      expectErr('repeat R86 PASS', mut((m) => { m.records.push({ kind: 'PASS', id: 'R86', name: 'case R86' }); }), [{ code: 'duplicate-record', id: 'R86' }]);
      expectErr('add R87', mut((m) => { m.records.push({ kind: 'PASS', id: 'R87', name: 'case R87' }); }), [{ code: 'unexpected-record', id: 'R87' }]);
      expectErr('unexpected IDs are reported in lexical order', mut((m) => { m.records.push({ kind: 'PASS', id: 'R88', name: 'case R88' }, { kind: 'PASS', id: 'R87', name: 'case R87' }); }), [{ code: 'unexpected-record', id: 'R87' }]);
      expectErr('R86 has PASS and FAIL', mut((m) => { m.records.push({ kind: 'FAIL', id: 'R86', name: 'case R86', diag: ['boom'] }); }), [{ code: 'contradictory-record', id: 'R86' }]);
      expectErr('replace R86 PASS with FAIL', mut((m) => setRec(m, 'R86', (r) => { r.kind = 'FAIL'; r.diag = ['boom']; })), [{ code: 'failed-record', id: 'R86' }], { summary: { passed: 99, failed: 1, skipped: 0 }, resultsFile: RES });
      expectErr('replace R86 with R86/C2/metadata', mut((m) => setRec(m, 'R86', (r) => { r.id = 'R86/C2/metadata'; r.name = 'case R86/C2/metadata'; })), [{ code: 'unexpected-record', id: 'R86/C2/metadata' }]);
      expectErr('R86 record exists only on stderr', mut((m) => { m.records = m.records.filter((r) => r.id !== 'R86'); m.stderr = 'PASS  R86  case R86\n'; }), [{ code: 'missing-record', id: 'R86' }]);
      // H7a: PASS directly after an ANSI sequence ending in "m" is not a whole word, so this line is not a totals candidate; plan 4.6 table: missing-record.
      expectErr('R86 line has an ANSI prefix', mut((m) => setRec(m, 'R86', (r) => { r.raw = '\u001b[32mPASS  R86  case R86\u001b[0m'; })), [{ code: 'missing-record', id: 'R86' }]);
      // H7a: a record-shaped line indented by any other amount than a failure diagnostic's eight spaces (here four) holds the whole word PASS, is not a
      // well-formed record and is not a failure diagnostic, so it is a second totals candidate: summary-invalid (G12 fields filled from the valid envelope).
      expectErr('R86 line is indented', mut((m) => setRec(m, 'R86', (r) => { r.raw = '    PASS  R86  case R86'; })), [{ code: 'summary-invalid' }]);
      // H7a: PASSED is not the whole word PASS, so it is not a totals candidate either.
      expectErr('PASSED is not a result keyword line', mut((m) => setRec(m, 'R86', (r) => { r.raw = 'PASSED  R86  case R86'; })), [{ code: 'missing-record', id: 'R86' }]);
      expectErr('zero records with a valid 0/0/0 summary and report', mut((m) => { m.records = []; }), [{ code: 'missing-record', id: 'R01' }]);
    });
    await step('4.6 forbidden and invalid skips', async () => {
      for (const id of ADDITIONAL_IDS) expectErr(`skip ${id}`, mut((m) => setRec(m, id, (r) => { r.kind = 'SKIP'; r.reason = 'host cannot run it'; })), [{ code: 'forbidden-skip', id }]);
      expectErr('skip baseline R22', mut((m) => setRec(m, 'R22', (r) => { r.kind = 'SKIP'; r.reason = 'host cannot run it'; })), [{ code: 'forbidden-skip', id: 'R22' }]);
      expectErr('skip R91 (junction coverage cannot be skipped)', mut((m) => setRec(m, 'R91', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; })), [{ code: 'forbidden-skip', id: 'R91' }]);
      expectErr('R13d skip with the wrong reason', mut((m) => setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = 'cannot create symlink'; })), [{ code: 'invalid-skip', id: 'R13d' }]);
      expectErr('R13d skip with the reason plus a period', mut((m) => setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = `${R13D_REASON}.`; })), [{ code: 'invalid-skip', id: 'R13d' }]);
      expectErr('R13d skip on linux', mut((m) => { m.env = { ...GATE_ENV, platform: 'linux' }; setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); }), [{ code: 'invalid-skip', id: 'R13d' }]);
      expectErr('R13d skip on darwin', mut((m) => { m.env = { ...GATE_ENV, platform: 'darwin' }; setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); }), [{ code: 'invalid-skip', id: 'R13d' }]);
      expectErr('forbidden skips are reported in required order', mut((m) => { for (const id of ['R91', 'R22']) setRec(m, id, (r) => { r.kind = 'SKIP'; r.reason = 'x'; }); }), [{ code: 'forbidden-skip', id: 'R22' }]);
    });
    await step('4.6 malformed result-keyword lines', async () => {
      const bad = [['PASS R86 case R86', 'single spaces'], ['PASS  R86', 'no name'], ['PASS\tR86\tcase R86', 'tab separators'], ['FAIL R86 case R86', 'FAIL with single spaces'], ['PASS', 'the keyword alone'], ['SKIP  R13d  case R13d', 'SKIP without a reason'], ['SKIP  R13d  case R13d  no parentheses']];
      for (const [raw, label] of bad) expectErr(`malformed record (${label})`, mut((m) => setRec(m, raw.startsWith('SKIP') ? 'R13d' : 'R86', (r) => { r.raw = raw; })), [{ code: 'malformed-record' }]);
    });

    // ---- 4.6 summary, execution and evidence ----
    await step('4.6 totals: correct records with incorrect numeric totals', async () => {
      const mis = (label, over) => expectErr(label, mut((m) => Object.assign(m, over)), [{ code: 'totals-mismatch' }], { resultsFile: RES });
      mis('line and envelope both claim 99/0/1 for 100 PASS records', { totalLines: [totalLine({ passed: 99, failed: 0, skipped: 1 })], summary: { passed: 99, failed: 0, skipped: 1 } });
      mis('line 100/0/0 but envelope 99/0/1', { summary: { passed: 99, failed: 0, skipped: 1 } });
      mis('line 99/0/1 but envelope 100/0/0', { totalLines: [totalLine({ passed: 99, failed: 0, skipped: 1 })] });
      mis('zero totals for 100 records', { totalLines: [totalLine({ passed: 0, failed: 0, skipped: 0 })], summary: { passed: 0, failed: 0, skipped: 0 } });
      mis('101 claimed for 100 records', { totalLines: [totalLine({ passed: 100, failed: 0, skipped: 1 })], summary: { passed: 100, failed: 0, skipped: 1 } });
      expectErr('a skip record reported as 100 PASS', mut((m) => { setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); m.totalLines = [totalLine(OKFULL)]; m.summary = OKFULL; }), [{ code: 'totals-mismatch' }]);
      expectErr('focused R86 with totals 2/0/0', focus('R86', { totalLines: [totalLine({ passed: 2, failed: 0, skipped: 0 })], summary: { passed: 2, failed: 0, skipped: 0 } }), [{ code: 'totals-mismatch' }]);
    });
    await step('4.6 missing, repeated or malformed total line or envelope; bad counts', async () => {
      const tl = totalLine(OKFULL);
      const env0 = { env: { ...GATE_ENV }, summary: OKFULL, resultsFile: RES };
      const cases = {
        'no total line': { totalLines: [] }, 'repeated total line': { totalLines: [tl, tl] },
        'total line without SKIP': { totalLines: ['100 PASS / 0 FAIL'] }, 'total line with PASSED': { totalLines: ['100 PASSED / 0 FAIL / 0 SKIP'] },
        'total line with a trailing word': { totalLines: [`${tl} extra`] }, 'lowercase total line': { totalLines: ['100 pass / 0 fail / 0 skip'] },
        'fractional total line count': { totalLines: ['1.5 PASS / 0 FAIL / 0 SKIP'] }, 'negative total line count': { totalLines: ['-1 PASS / 101 FAIL / 0 SKIP'] },
        'no envelope': { envelopeLines: [] }, 'repeated envelope': { envelopeLines: [JSON.stringify(env0), JSON.stringify(env0)] },
        'text after the envelope': { after: ['trailing text'] }, 'truncated envelope JSON': { envelopeLines: ['{"env":'] },
        'envelope without resultsFile': { envelopeEdit: ({ env, summary }) => ({ env, summary }) }, 'envelope without summary': { envelopeEdit: ({ env, resultsFile }) => ({ env, resultsFile }) },
        'envelope without env': { envelopeEdit: ({ summary, resultsFile }) => ({ summary, resultsFile }) },
        'envelope env.git empty': { envelopeEdit: (o) => ({ ...o, env: { ...o.env, git: '' } }) }, 'envelope env.node a number': { envelopeEdit: (o) => ({ ...o, env: { ...o.env, node: 24 } }) },
        'envelope env.platform missing': { envelopeEdit: (o) => ({ ...o, env: { release: 'fixture', node: 'fixture', git: 'fixture' } }) },
        'relative resultsFile': { envelopeEdit: (o) => ({ ...o, resultsFile: 'results.json' }) }, 'empty resultsFile': { envelopeEdit: (o) => ({ ...o, resultsFile: '' }) }, 'non-string resultsFile': { envelopeEdit: (o) => ({ ...o, resultsFile: 5 }) },
        'negative summary count': { envelopeEdit: (o) => ({ ...o, summary: { ...o.summary, passed: -1 } }) }, 'fractional summary count': { envelopeEdit: (o) => ({ ...o, summary: { ...o.summary, passed: 99.5 } }) },
        'string summary count': { envelopeEdit: (o) => ({ ...o, summary: { ...o.summary, passed: '100' } }) }, 'null summary count': { envelopeEdit: (o) => ({ ...o, summary: { ...o.summary, failed: null } }) },
        'summary without skipped': { envelopeEdit: (o) => ({ ...o, summary: { passed: 100, failed: 0 } }) },
      };
      // An unusable envelope (missing, truncated, wrong keys, wrong types, relative path, bad counts) leaves both fields null; a bad total line
      // beside a valid envelope leaves them filled; a repeated envelope or text after it is not asserted for the two fields.
      const envNull = new Set(['no envelope', 'truncated envelope JSON', 'envelope without resultsFile', 'envelope without summary', 'envelope without env', 'envelope env.git empty', 'envelope env.node a number', 'envelope env.platform missing', 'relative resultsFile', 'empty resultsFile', 'non-string resultsFile', 'negative summary count', 'fractional summary count', 'string summary count', 'null summary count', 'summary without skipped']);
      const envSkip = new Set(['repeated envelope', 'text after the envelope']);
      for (const [label, over] of Object.entries(cases)) expectErr(label, mut((m) => Object.assign(m, over)), [{ code: 'summary-invalid' }], { g12: envNull.has(label) ? 'null' : envSkip.has(label) ? 'skip' : 'filled' });
      expectErr('a missing envelope leaves summary and resultsFile null', mut((m) => { m.envelopeLines = []; }), [{ code: 'summary-invalid' }], { summary: null, resultsFile: null, g12: 'null' });
      expectErr('a relative resultsFile leaves summary and resultsFile null', mut((m) => { m.envelopeEdit = (o) => ({ ...o, resultsFile: 'results.json' }); }), [{ code: 'summary-invalid' }], { summary: null, resultsFile: null, g12: 'null' });
    });
    // R6. Plan 3.3: "Require exactly one total line and one JSON envelope" and, in the first-violation list, "Missing, malformed, repeated or
    // incomplete total/envelope: summary-invalid". A malformed or repeated total line must not be ignored just because a valid one is also
    // present, whichever comes first: the envelope stays valid, so summary and resultsFile are filled (G12).
    await step('R6 a malformed or repeated total line beside a valid one is summary-invalid', async () => {
      const valid = totalLine(OKFULL);
      const beside = [
        ['100 PASS / 0 FAIL', 'a total line without the SKIP count'],
        [`${valid} extra`, 'a total line with a trailing word'],
        ['1.5 PASS / 0 FAIL / 0 SKIP', 'a total line with a fractional count'],
        ['-1 PASS / 101 FAIL / 0 SKIP', 'a total line with a negative count'],
        [totalLine({ passed: 99, failed: 0, skipped: 1 }), 'a second well-formed total line with other counts'],
        [valid, 'a repeated identical total line'],
      ];
      for (const [line, what] of beside) {
        expectErr(`${what} after the valid total line`, mut((m) => { m.totalLines = [valid, line]; }), [{ code: 'summary-invalid' }]);
        expectErr(`${what} before the valid total line`, mut((m) => { m.totalLines = [line, valid]; }), [{ code: 'summary-invalid' }]);
      }
      const one = totalLine({ passed: 1, failed: 0, skipped: 0 });
      expectErr('focused R86: a total line without the SKIP count after the valid one', focus('R86', { totalLines: [one, '1 PASS / 0 FAIL'] }), [{ code: 'summary-invalid' }]);
      expectErr('focused R86: a total line without the SKIP count before the valid one', focus('R86', { totalLines: ['1 PASS / 0 FAIL', one] }), [{ code: 'summary-invalid' }]);
    });
    // R2-1. Decision H7 as narrowed by H7a (plans 3.1, 3.3, 4.6): a totals candidate is a stdout line that (1) contains PASS as a whole word in any
    // letter case (not preceded or followed by an ASCII letter, digit or underscore, so PASSED, xPASS, PASS_1 and PASS right after an ANSI "m" are
    // not candidates), (2) is not a well-formed record line and (3) is not a failure diagnostic, that is, does not begin with exactly eight spaces
    // and "- ". The transcript must hold exactly one candidate and it must match "<n> PASS / <n> FAIL / <n> SKIP" exactly, each <n> a decimal
    // integer; zero candidates, more than one, or one that does not match exactly is summary-invalid, and this check runs before the
    // record-inventory checks. No shape of a malformed total is guessed: every one below sits next to a valid total, with valid records, envelope
    // and report, so only the candidate rule can reject it. The envelope stays valid, so summary and resultsFile are filled (G12).
    await step('R2-1 (H7) a line with the word PASS beside the one valid total line is summary-invalid, whatever its shape', async () => {
      const valid = totalLine(OKFULL), one = totalLine({ passed: 1, failed: 0, skipped: 0 });
      const shapes = [
        ['.5 PASS / 0 FAIL / 0 SKIP', 'a total with a leading decimal point'],
        ['1e2 PASS / 0 FAIL / 0 SKIP', 'a total with an exponent count'],
        ['0x64 PASS / 0 FAIL / 0 SKIP', 'a total with a hexadecimal count'],
        ['+100 PASS / 0 FAIL / 0 SKIP', 'a total with a signed count'],
        ['1,000 PASS / 0 FAIL / 0 SKIP', 'a total with a thousands separator'],
        ['PASS: 100', 'a PASS: label line'],
        ['100 pass / 0 fail / 0 skip', 'a lowercase total'],
        ['100 Pass / 0 Fail / 0 Skip', 'a mixed-case total'],
        ['100 PASS 0 FAIL 0 SKIP', 'a total without slashes'],
        [' 100 PASS / 0 FAIL / 0 SKIP', 'a total with a leading space'],
        ['100 PASS / 0 FAIL / 0 SKIP ', 'a total with a trailing space'],
        ['100 PASS / 0 FAIL / 0 SKIP.', 'a total with a trailing period'],
        ['100  PASS / 0 FAIL / 0 SKIP', 'a total with a doubled space'],
        ['100\tPASS / 0 FAIL / 0 SKIP', 'a total with a tab'],
        ['Totals: 100 PASS / 0 FAIL / 0 SKIP', 'a total with a text prefix'],
        ['all tests pass', 'a prose line with the whole word pass'],
        ['(PASS) 100', 'a line with PASS in parentheses (punctuation is not a word character)'],
        ['PASS-1', 'a line with PASS followed by a hyphen'],
        [`${' '.repeat(7)}- 100 PASS / 0 FAIL / 0 SKIP`, 'a seven-space "- " line that contains PASS'],
        [`${' '.repeat(9)}- 100 PASS / 0 FAIL / 0 SKIP`, 'a nine-space "- " line that contains PASS'],
        [`${' '.repeat(8)}100 PASS / 0 FAIL / 0 SKIP`, 'an eight-space line without the "- " marker'],
        [`${' '.repeat(8)}-100 PASS / 0 FAIL / 0 SKIP`, 'an eight-space line whose dash is not followed by a space'],
      ];
      for (const [line, what] of shapes) {
        for (const [place, order] of [['after', (v, l) => [v, l]], ['before', (v, l) => [l, v]]]) {
          expectErr(`${what} ${place} the valid total line`, mut((m) => { m.totalLines = order(valid, line); }), [{ code: 'summary-invalid' }]);
          expectErr(`focused R86: ${what} ${place} the valid total line`, focus('R86', { totalLines: order(one, line) }), [{ code: 'summary-invalid' }]);
        }
      }
      // The candidate check runs before the record-inventory checks: the same malformed line beside a valid total wins over a missing, failed
      // or duplicated record.
      const consistent = (m, line) => { m.totalLines = [totalLine(tallyOf(m.records)), line]; };
      expectErr('a malformed total beats a missing record', mut((m) => { m.records = m.records.filter((r) => r.id !== 'R86'); consistent(m, '.5 PASS / 0 FAIL / 0 SKIP'); }), [{ code: 'summary-invalid' }]);
      expectErr('a malformed total beats a failed record', mut((m) => { setRec(m, 'R86', (r) => { r.kind = 'FAIL'; r.diag = ['boom']; }); consistent(m, '1e2 PASS / 0 FAIL / 0 SKIP'); }), [{ code: 'summary-invalid' }]);
      expectErr('a malformed total beats a duplicated record', mut((m) => { m.records.push({ kind: 'PASS', id: 'R86', name: 'case R86' }); consistent(m, 'PASS: 100'); }), [{ code: 'summary-invalid' }]);
      expectErr('focused R86: a malformed total beats a missing record', focus('R86', { records: [], totalLines: [totalLine({ passed: 0, failed: 0, skipped: 0 }), '.5 PASS / 0 FAIL / 0 SKIP'] }), [{ code: 'summary-invalid' }]);
      // Negative controls: exactly one valid total with valid records still passes, and lines without the word PASS are not candidates.
      expectOk('control: exactly one valid total line and valid records', full(), OKFULL);
      expectOk('control (focused R86): exactly one valid total line and a valid record', focus('R86'), { passed: 1, failed: 0, skipped: 0 });
      expectOk('control: lines without the word PASS are not total candidates', mut((m) => { m.pre = ['note: 100 tests ran in 12 s', 'summary: 0 FAIL / 0 SKIP']; }), OKFULL);
      // H7a: a failure diagnostic (exactly eight spaces, then "- ") is never a totals candidate, even when it contains a perfect-looking total line.
      const diag = `${' '.repeat(8)}- 100 PASS / 0 FAIL / 0 SKIP`;
      expectOk('control: a failure diagnostic line that contains PASS next to the valid total is not a candidate', mut((m) => { m.pre = [diag]; }), OKFULL);
      expectOk('control (focused R86): a failure diagnostic line that contains PASS is not a candidate', focus('R86', { pre: [diag] }), { passed: 1, failed: 0, skipped: 0 });
      expectErr('a failure diagnostic that contains PASS under a FAIL record leaves the usual verdict', mut((m) => setRec(m, 'R86', (r) => { r.kind = 'FAIL'; r.diag = ['100 PASS / 0 FAIL / 0 SKIP']; })), [{ code: 'failed-record', id: 'R86' }]);
      // H7a: PASS must be a whole word. Letters, digits and underscores on either side make the line a non-candidate (and not a result keyword line).
      const notWords = ['xPASS', 'PASS_1', 'PASSED', 'bypass', '1PASS', 'PASS2', '_PASS', 'password'];
      expectOk('control: PASS inside a longer word is not a total candidate', mut((m) => { m.pre = [...notWords]; }), OKFULL);
      expectOk('control (focused R86): PASS inside a longer word is not a total candidate', focus('R86', { pre: [...notWords] }), { passed: 1, failed: 0, skipped: 0 });
      expectOk('control: the Windows R13d skip transcript with its one total line', mut((m) => setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; })), { passed: 99, failed: 0, skipped: 1 });
    });
    await step('4.6 exit status and execution failures', async () => {
      expectErr('status 1', mut((m) => { m.status = 1; }), [{ code: 'suite-exit' }]);
      expectErr('status 2', mut((m) => { m.status = 2; }), [{ code: 'suite-exit' }]);
      expectErr('status null with no execution flag', mut((m) => { m.status = null; }), [{ code: 'suite-exit' }]);
      expectErr('spawn error', mut((m) => { m.error = { code: 'ENOENT', message: 'spawn ENOENT' }; m.status = null; }), [{ code: 'suite-execution' }]);
      expectErr('signal', mut((m) => { m.signal = 'SIGKILL'; m.status = null; }), [{ code: 'suite-execution' }]);
      expectErr('timeout', mut((m) => { m.timedOut = true; m.status = null; m.signal = 'SIGTERM'; }), [{ code: 'suite-execution' }]);
      expectErr('truncation', mut((m) => { m.truncated = true; m.status = null; }), [{ code: 'suite-execution' }]);
      expectErr('timeout flag alone with status 0', mut((m) => { m.timedOut = true; }), [{ code: 'suite-execution' }]);
      expectErr('truncated flag alone with status 0', mut((m) => { m.truncated = true; }), [{ code: 'suite-execution' }]);
      expectErr('an error beats status 1', mut((m) => { m.error = { code: 'EPERM', message: 'x' }; m.status = 1; }), [{ code: 'suite-execution' }]);
    });
    await step('4.6 evidence: missing report, malformed report, and any disagreement with stdout', async () => {
      expectErr('null report', mut((m) => { m.reportOverride = null; }), [{ code: 'evidence-missing' }], { summary: OKFULL, resultsFile: RES });
      expectErr('report read error', mut((m) => { m.reportOverride = { error: { code: 'ENOENT', message: 'gone' } }; }), [{ code: 'evidence-missing' }], { summary: OKFULL, resultsFile: RES });
      const bad = {
        'malformed JSON': { reportOverride: { text: 'not json' } }, 'empty object': { reportOverride: { text: '{}' } }, 'an array': { reportOverride: { text: '[]' } },
        'empty text': { reportOverride: { text: '' } },
        'results missing': { reportEdit: (o) => ({ env: o.env, summary: o.summary }) }, 'results not an array': { reportEdit: (o) => ({ ...o, results: {} }) },
        'a result without skipped': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 0 ? { id: r.id, name: r.name, failures: r.failures } : r)) }) },
        'failures not an array': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 0 ? { ...r, failures: 'x' } : r)) }) },
        'env missing': { reportEdit: (o) => ({ summary: o.summary, results: o.results }) }, 'summary missing': { reportEdit: (o) => ({ env: o.env, results: o.results }) },
        'a result that both fails and skips': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 0 ? { ...r, failures: ['x'], skipped: 'why' } : r)) }) },
        'results swapped': { reportEdit: (o) => { const r = [...o.results]; [r[0], r[1]] = [r[1], r[0]]; return { ...o, results: r }; } },
        'a result renamed': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 5 ? { ...r, name: 'another name' } : r)) }) },
        'a result id changed': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 5 ? { ...r, id: 'R05x' } : r)) }) },
        'a result dropped': { reportEdit: (o) => ({ ...o, results: o.results.slice(1) }) },
        'a result added': { reportEdit: (o) => ({ ...o, results: [...o.results, { id: 'R87', name: 'case R87', failures: [], skipped: null }] }) },
        'status differs (report fails what stdout passed)': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 21 ? { ...r, failures: ['x'] } : r)) }) },
        'status differs (report skips what stdout passed)': { reportEdit: (o) => ({ ...o, results: o.results.map((r, i) => (i === 21 ? { ...r, skipped: 'x' } : r)) }) },
        'env.platform differs': { reportEnv: { ...GATE_ENV, platform: 'linux' } }, 'env.node differs': { reportEnv: { ...GATE_ENV, node: 'other' } },
        'env.release differs': { reportEnv: { ...GATE_ENV, release: 'other' } }, 'env.git differs': { reportEnv: { ...GATE_ENV, git: 'other' } },
        'report summary differs': { reportSummary: { passed: 99, failed: 0, skipped: 1 } },
      };
      for (const [label, over] of Object.entries(bad)) expectErr(`report ${label}`, mut((m) => Object.assign(m, over)), [{ code: 'evidence-mismatch' }], { summary: OKFULL, resultsFile: RES });
      expectErr('report reason differs from stdout (R13d skip)', mut((m) => { setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); m.reportEdit = (o) => ({ ...o, results: o.results.map((r) => (r.id === 'R13d' ? { ...r, skipped: 'another reason' } : r)) }); }), [{ code: 'evidence-mismatch' }]);
      expectErr('report has no skip where stdout skipped R13d', mut((m) => { setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = R13D_REASON; }); m.reportEdit = (o) => ({ ...o, results: o.results.map((r) => (r.id === 'R13d' ? { ...r, skipped: null } : r)) }); }), [{ code: 'evidence-mismatch' }]);
    });
    await step('4.6 focused acceptance', async () => {
      expectOk('valid focused R86', focus('R86'), { passed: 1, failed: 0, skipped: 0 });
      expectErr('focused R86 with no records and a valid empty summary', focus('R86', { records: [] }), [{ code: 'missing-record', id: 'R86' }]);
      expectErr('focused R86 that also ran R860', gateModel(['R86', 'R860'], RES, { only: 'R86' }), [{ code: 'unexpected-record', id: 'R860' }]);
      expectErr('focused R86 that also ran R91', gateModel(['R86', 'R91'], RES, { only: 'R86' }), [{ code: 'unexpected-record', id: 'R91' }]);
      expectErr('focused R86 with the full transcript (lexically first unexpected ID)', full({ only: 'R86' }), [{ code: 'unexpected-record', id: 'A5-templates' }]);
      expectErr('focused R86 reported FAIL', focus('R86', { records: [{ kind: 'FAIL', id: 'R86', name: 'case R86', diag: ['boom'] }] }), [{ code: 'failed-record', id: 'R86' }]);
      expectErr('focused R13d may not skip even with the right reason on win32', gateModel(['R13d'], RES, { only: 'R13d', records: [{ kind: 'SKIP', id: 'R13d', name: 'case R13d', reason: R13D_REASON }] }), [{ code: 'forbidden-skip', id: 'R13d' }]);
      expectErr('a full run that recorded only R86', full({ records: [{ kind: 'PASS', id: 'R86', name: 'case R86' }] }), [{ code: 'missing-record', id: 'R01' }]);
    });
    await step('4.6 an invalid --only value is a usage error before anything else', async () => {
      for (const [label, only] of [['empty', ''], ['not a required ID', 'R87'], ['trailing space', 'R86 '], ['leading space', ' R86'], ['lowercase', 'r86'], ['prefix of an ID', 'R8'], ['two IDs', 'R86|R91'], ['a number', 5], ['an array', ['R86']]]) {
        expectErr(`only ${label}`, mut((m) => { m.only = only; }), [{ code: 'usage' }]);
      }
      expectErr('usage beats a nonzero exit', mut((m) => { m.only = 'R87'; m.status = 1; }), [{ code: 'usage' }]);
    });
    await step('3.3 first-violation precedence', async () => {
      const c = (label, fn, issue) => expectErr(label, mut(fn), [issue]);
      c('error beats exit status', (m) => { m.error = { code: 'EPERM', message: 'x' }; m.status = 1; }, { code: 'suite-execution' });
      c('exit status beats a malformed record', (m) => { m.status = 1; setRec(m, 'R86', (r) => { r.raw = 'PASS R86 case R86'; }); }, { code: 'suite-exit' });
      c('a malformed record beats a malformed total', (m) => { setRec(m, 'R86', (r) => { r.raw = 'PASS R86 case R86'; }); m.totalLines = []; }, { code: 'malformed-record' });
      c('a malformed total beats a contradictory record', (m) => { m.totalLines = []; m.records.push({ kind: 'FAIL', id: 'R86', name: 'case R86', diag: ['x'] }); }, { code: 'summary-invalid' });
      c('contradictory beats duplicate', (m) => { m.records.push({ kind: 'FAIL', id: 'R86', name: 'case R86', diag: ['x'] }, { kind: 'PASS', id: 'R85', name: 'case R85' }); }, { code: 'contradictory-record', id: 'R86' });
      c('duplicate beats unexpected', (m) => { m.records.push({ kind: 'PASS', id: 'R86', name: 'case R86' }, { kind: 'PASS', id: 'R87', name: 'case R87' }); }, { code: 'duplicate-record', id: 'R86' });
      c('unexpected beats missing', (m) => setRec(m, 'R86', (r) => { r.id = 'R86/C2/metadata'; r.name = 'x'; }), { code: 'unexpected-record', id: 'R86/C2/metadata' });
      c('missing beats failed', (m) => { m.records = m.records.filter((r) => r.id !== 'R01'); setRec(m, 'R86', (r) => { r.kind = 'FAIL'; r.diag = ['x']; }); }, { code: 'missing-record', id: 'R01' });
      c('failed beats forbidden skip', (m) => { setRec(m, 'R86', (r) => { r.kind = 'FAIL'; r.diag = ['x']; }); setRec(m, 'R22', (r) => { r.kind = 'SKIP'; r.reason = 'x'; }); }, { code: 'failed-record', id: 'R86' });
      c('failed records are reported in required order', (m) => { for (const id of ['R91', 'R22']) setRec(m, id, (r) => { r.kind = 'FAIL'; r.diag = ['x']; }); }, { code: 'failed-record', id: 'R22' });
      c('forbidden skip beats invalid skip', (m) => { setRec(m, 'R22', (r) => { r.kind = 'SKIP'; r.reason = 'x'; }); setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = 'wrong'; }); }, { code: 'forbidden-skip', id: 'R22' });
      c('invalid skip beats totals mismatch', (m) => { setRec(m, 'R13d', (r) => { r.kind = 'SKIP'; r.reason = 'wrong'; }); m.totalLines = [totalLine(OKFULL)]; m.summary = OKFULL; }, { code: 'invalid-skip', id: 'R13d' });
      c('totals mismatch beats a missing report', (m) => { m.totalLines = [totalLine({ passed: 99, failed: 0, skipped: 1 })]; m.summary = { passed: 99, failed: 0, skipped: 1 }; m.reportOverride = null; }, { code: 'totals-mismatch' });
    });

    // ---- 4.6 gate main with injected dependencies ----
    const okRes = (stdout, stderr = '') => ({ status: 0, signal: null, error: null, timedOut: false, truncated: false, stdout, stderr });
    const gate = async (argv, o) => {
      const execCalls = [], readCalls = [], writeCalls = [];
      const deps = {
        execute: (exe, args, options) => { execCalls.push({ exe, args: [...args], options, envSeen: options && options.env ? { ...options.env } : null }); return o.exec(exe, args, options); },
        readReport: (p) => { readCalls.push(p); return o.report === undefined ? null : o.report; },
        writeEvidence: (input) => { writeCalls.push(input); return o.writer ? o.writer(input) : EVID; },
      };
      const rec = await withStreamGuard(() => withEnv({ C11A_GATE_SENTINEL: 'sentinel-value' }, () => acc.main(argv, deps)));
      quiet(check, `gate ${argv.join(' ') || '(full)'}`, rec);
      return { v: rec.value, execCalls, readCalls, writeCalls };
    };
    const runTests = path.join(context.skillRoot, 'tests', 'run-tests.mjs');
    const lines3 = (RESPATH, ev) => `RESULTS  ${RESPATH}\nEVIDENCE  ${ev}\n`;

    await step('4.6 gate main: the exact child invocation, reader, writer and verdict (full run)', async () => {
      const m = full(); const stdout = renderStdout(m);
      const g = await gate([], { exec: () => okRes(stdout, 'a stderr line\n'), report: renderReport(m) });
      mainShape(check, 'full gate', g.v);
      check(g.execCalls.length === 1, 'exactly one suite child is run', g.execCalls.length);
      const c = g.execCalls[0] || { args: [], options: {} };
      check(c.exe === process.execPath && c.args.length === 2 && samePath(String(c.args[0]), runTests) && c.args[1] === '--keep' && path.isAbsolute(String(c.args[0])), 'full run: process.execPath with [<absolute run-tests.mjs>, "--keep"]', { exe: c.exe, args: c.args });
      const o = c.options || {};
      check(eq(Object.keys(o).sort(), ['cwd', 'encoding', 'env', 'maxBuffer', 'shell', 'timeout', 'windowsHide']), 'the child options are exactly the seven of plan 2.7', Object.keys(o));
      check(o.shell === false && o.windowsHide === true && o.encoding === 'utf8' && o.timeout === 1800000 && o.maxBuffer === 33554432, 'shell false, windowsHide, utf8, timeout 1800000, maxBuffer 33554432', { shell: o.shell, windowsHide: o.windowsHide, encoding: o.encoding, timeout: o.timeout, maxBuffer: o.maxBuffer });
      check(typeof o.cwd === 'string' && samePath(o.cwd, context.repository), 'the child runs in the distribution repository root', o.cwd);
      check(o.env && o.env !== process.env && Object.values(o.env).every((x) => typeof x === 'string') && o.env.C11A_GATE_SENTINEL === 'sentinel-value', 'env is a string-valued copy of the gate environment', o.env && Object.keys(o.env).length);
      check(eq(g.readCalls, [RES]), 'the reader receives the exact envelope path, once', g.readCalls);
      check(g.writeCalls.length === 1 && eq(Object.keys(g.writeCalls[0]).sort(), ['resultsFile', 'stderr', 'stdout']) && g.writeCalls[0].stdout === stdout && g.writeCalls[0].stderr === 'a stderr line\n' && g.writeCalls[0].resultsFile === RES, 'the writer receives the unchanged stdout and stderr and the parsed results path, once', g.writeCalls[0] && { resultsFile: g.writeCalls[0].resultsFile, same: g.writeCalls[0].stdout === stdout });
      check(g.v && g.v.exitCode === 0 && g.v.stderr === 'a stderr line\n' && g.v.stdout === `${stdout}ACCEPT-RC1  PASS  full\n${lines3(RES, EVID)}`, 'exit 0; stdout is the captured stdout unchanged plus ACCEPT-RC1  PASS  full, RESULTS and EVIDENCE; stderr is the captured stderr', g.v && g.v.stdout.slice(-200));
    });
    await step('4.6 gate main: a separating LF only when needed, CRLF forwarded unchanged', async () => {
      const m = full(); const noLf = renderStdout(m).replace(/\n$/, '');
      const g = await gate([], { exec: () => okRes(noLf), report: renderReport(m) });
      check(g.v && g.v.exitCode === 0 && g.v.stdout === `${noLf}\nACCEPT-RC1  PASS  full\n${lines3(RES, EVID)}` && g.writeCalls[0] && g.writeCalls[0].stdout === noLf, 'a stream without a final LF gets exactly one separating LF; the writer still gets the raw capture', g.v && g.v.stdout.slice(-200));
      const mc = full({ eol: '\r\n' }); const crlf = renderStdout(mc);
      const g2 = await gate([], { exec: () => okRes(crlf), report: renderReport(mc) });
      check(g2.v && g2.v.exitCode === 0 && g2.v.stdout === `${crlf}ACCEPT-RC1  PASS  full\n${lines3(RES, EVID)}` && g2.writeCalls[0].stdout === crlf, 'CRLF captures are accepted and forwarded byte for byte', g2.v && g2.v.stdout.slice(-120));
    });
    await step('4.6 gate main: focused run uses --only-id and never the substring selector', async () => {
      const m = focus('R86'); const stdout = renderStdout(m);
      const g = await gate(['--only', 'R86'], { exec: () => okRes(stdout), report: renderReport(m) });
      const c = g.execCalls[0] || { args: [] };
      check(g.execCalls.length === 1 && c.exe === process.execPath && c.args.length === 4 && samePath(String(c.args[0]), runTests) && eq(c.args.slice(1), ['--keep', '--only-id', 'R86']), 'focused: [<run-tests.mjs>, "--keep", "--only-id", "R86"]', c.args);
      check(!c.args.includes('--only'), 'the substring selector --only is never passed');
      check(g.v && g.v.exitCode === 0 && g.v.stdout === `${stdout}ACCEPT-RC1  PASS  R86\n${lines3(RES, EVID)}`, 'the focused verdict substitutes the ID for "full"', g.v && g.v.stdout.slice(-160));
      const m13 = focus('R13d'); const s13 = renderStdout(m13);
      const g13 = await gate(['--only', 'R13d'], { exec: () => okRes(s13), report: renderReport(m13) });
      check(g13.v && g13.v.exitCode === 0 && g13.execCalls[0] && eq(g13.execCalls[0].args.slice(1), ['--keep', '--only-id', 'R13d']), 'focused R13d runs and passes only when it PASSes');
    });
    await step('4.6 gate main: failing evidence produces exit 1 and an exact failure verdict', async () => {
      const m = full(); const stdout = renderStdout(m);
      // Without an envelope there is no results file, so no RESULTS line follows the verdict.
      let g = await gate([], { exec: () => ({ ...okRes('boom\n', 'bad\n'), status: 1 }) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `boom\nACCEPT-RC1  FAIL  suite-exit\nEVIDENCE  ${EVID}\n` && g.v.stderr === 'bad\n', 'nonzero exit: ACCEPT-RC1  FAIL  suite-exit then EVIDENCE; stderr is the captured stderr', g.v);
      check(g.readCalls.length === 0 && g.writeCalls.length === 1 && g.writeCalls[0].stdout === 'boom\n' && g.writeCalls[0].stderr === 'bad\n' && g.writeCalls[0].resultsFile === null, 'nonzero exit: no envelope, so no report is read; the writer still runs once with a null results path', { reads: g.readCalls, writes: g.writeCalls });
      g = await gate([], { exec: () => ({ status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'spawnSync ETIMEDOUT' }, timedOut: true, truncated: false, stdout: 'partial output\n', stderr: '' }) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `partial output\nACCEPT-RC1  FAIL  suite-execution\nEVIDENCE  ${EVID}\n` && g.writeCalls.length === 1, 'timeout: exit 1, suite-execution, evidence retained', g.v);
      // G14: an executor rejection (a throw, or a rejected promise) is the verdict suite-execution, like a spawn error, timeout or truncation.
      for (const [label, rejecting] of [['throws', () => { throw new Error('spawn exploded'); }], ['rejects', () => Promise.reject(new Error('spawn exploded'))]]) {
        g = await gate([], { exec: rejecting });
        check(g.v && g.v.exitCode === 1 && eq(nonEmptyLines(g.v.stdout), ['ACCEPT-RC1  FAIL  suite-execution', `EVIDENCE  ${EVID}`]), `executor ${label}: the verdict is ACCEPT-RC1  FAIL  suite-execution, with no PASS and no RESULTS line`, g.v);
        check(g.readCalls.length === 0 && g.writeCalls.length === 1 && g.writeCalls[0].resultsFile === null && typeof g.writeCalls[0].stdout === 'string' && typeof g.writeCalls[0].stderr === 'string', `executor ${label}: no report is read and the attempt is retained once`, g.writeCalls);
      }
      // G13: a RESULTS line follows every verdict whose results file is known, including a nonzero exit (or any execution failure) whose
      // stdout still carries a valid envelope.
      const mv = full(), sv = renderStdout(mv);
      g = await gate([], { exec: () => ({ ...okRes(sv, 'bad\n'), status: 1 }), report: renderReport(mv) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${sv}ACCEPT-RC1  FAIL  suite-exit\n${lines3(RES, EVID)}` && g.v.stderr === 'bad\n' && eq(g.readCalls, [RES]), 'nonzero exit with a valid envelope: ACCEPT-RC1  FAIL  suite-exit, then RESULTS and EVIDENCE; the report is read once', g.v && g.v.stdout.slice(-200));
      g = await gate([], { exec: () => ({ ...okRes(sv), status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT', message: 'spawnSync ETIMEDOUT' }, timedOut: true }), report: renderReport(mv) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${sv}ACCEPT-RC1  FAIL  suite-execution\n${lines3(RES, EVID)}`, 'timeout with a valid envelope: suite-execution, then RESULTS and EVIDENCE', g.v && g.v.stdout.slice(-200));
      const mr = mut((x) => setRec(x, 'R86', (r) => { r.raw = 'PASS R86 case R86'; })), sr = renderStdout(mr);
      g = await gate([], { exec: () => okRes(sr), report: renderReport(mr) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${sr}ACCEPT-RC1  FAIL  malformed-record\n${lines3(RES, EVID)}`, 'malformed record with a valid envelope: malformed-record, then RESULTS and EVIDENCE', g.v && g.v.stdout.slice(-200));
      const mm = mut((x) => { x.records = x.records.filter((r) => r.id !== 'R86'); }); const sm = renderStdout(mm);
      g = await gate([], { exec: () => okRes(sm), report: renderReport(mm) });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${sm}ACCEPT-RC1  FAIL  missing-record  R86\n${lines3(RES, EVID)}` && eq(g.readCalls, [RES]), 'missing R86: ACCEPT-RC1  FAIL  missing-record  R86, RESULTS, EVIDENCE', g.v && g.v.stdout.slice(-200));
      g = await gate([], { exec: () => okRes(stdout), report: { text: 'garbage' } });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${stdout}ACCEPT-RC1  FAIL  evidence-mismatch\n${lines3(RES, EVID)}`, 'malformed report text: evidence-mismatch', g.v && g.v.stdout.slice(-160));
      g = await gate([], { exec: () => okRes(stdout), report: { error: { code: 'ENOENT', message: 'gone' } } });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${stdout}ACCEPT-RC1  FAIL  evidence-missing\n${lines3(RES, EVID)}`, 'unreadable report: evidence-missing', g.v && g.v.stdout.slice(-160));
      const noEnv = renderStdout(mut((x) => { x.envelopeLines = []; }));
      g = await gate([], { exec: () => okRes(noEnv), report: null });
      check(g.v && g.v.exitCode === 1 && g.v.stdout === `${noEnv}ACCEPT-RC1  FAIL  summary-invalid\nEVIDENCE  ${EVID}\n` && g.readCalls.length === 0 && g.writeCalls[0] && g.writeCalls[0].resultsFile === null, 'no envelope: summary-invalid, no RESULTS line, the report is not read', g.v && g.v.stdout.slice(-160));
    });
    await step('2.7 the default report reader reads the envelope path and reports a read failure as evidence-missing', async () => {
      const dir = scope.sub('rd'); fs.mkdirSync(dir, { recursive: true });
      const real = path.join(dir, 'results.json');
      const m = gateModel(REQUIRED_IDS, real); const stdout = renderStdout(m);
      fs.writeFileSync(real, renderReport(m).text);
      const run = (resultsFile, text) => {
        const mm = gateModel(REQUIRED_IDS, resultsFile); const so = renderStdout(mm);
        const rec = withStreamGuard(() => acc.main([], { execute: () => okRes(so), writeEvidence: () => EVID }));
        return rec.then((r) => { quiet(check, 'default reader', r); return r.value; });
      };
      const ok = await run(real);
      check(ok && ok.exitCode === 0 && ok.stdout === `${stdout}ACCEPT-RC1  PASS  full\nRESULTS  ${real}\nEVIDENCE  ${EVID}\n`, 'a readable results file is read from the envelope path and accepted', ok && ok.stdout.slice(-200));
      const missingPath = path.join(dir, 'missing-results.json');
      const gone = await run(missingPath);
      check(gone && gone.exitCode === 1 && /ACCEPT-RC1 {2}FAIL {2}evidence-missing\n/.test(gone.stdout) && !/ACCEPT-RC1 {2}PASS/.test(gone.stdout), 'an unreadable results file is evidence-missing', gone && gone.stdout.slice(-200));
    });
    await step('4.6 gate main: an evidence retention failure never ends in an acceptance PASS', async () => {
      const m = full(); const stdout = renderStdout(m);
      const modes = { 'throws': () => { throw new Error('disk full'); }, 'rejects': async () => { throw new Error('disk full'); }, 'returns a relative path': () => 'evidence', 'returns an empty path': () => '', 'returns undefined': () => undefined };
      for (const [label, writer] of Object.entries(modes)) {
        const g = await gate([], { exec: () => okRes(stdout), report: renderReport(m), writer });
        check(g.v && g.v.exitCode === 1 && g.v.stdout === `${stdout}ACCEPT-RC1  FAIL  evidence-write\nRESULTS  ${RES}\n`, `writer ${label}: exit 1, ACCEPT-RC1  FAIL  evidence-write and the RESULTS line; no EVIDENCE and no PASS`, g.v && g.v.stdout.slice(-200));
        check(g.writeCalls.length === 1 && g.v && !/ACCEPT-RC1 {2}PASS/.test(g.v.stdout), `writer ${label}: the writer ran once and no acceptance PASS was printed`);
      }
    });
    await step('4.6 gate main: usage errors invoke no dependency', async () => {
      const argvs = { 'missing --only value': ['--only'], 'ID that is not required': ['--only', 'R87'], 'duplicate --only': ['--only', 'R86', '--only', 'R86'], 'unknown option': ['--bogus'], 'positional ID': ['R86'], 'empty ID': ['--only', ''], 'relaxation attempt --keep': ['--keep'], 'lowercase ID': ['--only', 'r86'], 'two IDs': ['--only', 'R86', 'R91'] };
      for (const [label, argv] of Object.entries(argvs)) {
        const g = await gate(argv, { exec: () => okRes(''), report: null });
        mainShape(check, `usage ${label}`, g.v);
        check(g.v && g.v.exitCode === 1 && g.v.stdout === 'ACCEPT-RC1  FAIL  usage\n', `usage ${label}: exit 1 and exactly ACCEPT-RC1  FAIL  usage`, g.v);
        check(g.execCalls.length === 0 && g.readCalls.length === 0 && g.writeCalls.length === 0, `usage ${label}: no dependency is invoked`, { exec: g.execCalls.length, read: g.readCalls.length, write: g.writeCalls.length });
      }
    });
    await step('2.7 the gate CLI exposes no injection or relaxation (usage errors before any child)', async () => {
      const cli = path.join(context.skillRoot, 'tests', 'accept-rc1.mjs');
      usageCli(check, context, cli, [['unknown option', ['--bogus']], ['an executor option', ['--execute', 'node']], ['a relaxed total', ['--allow-skips']], ['an ID that is not required', ['--only', 'R87']], ['missing value', ['--only']]], 'ACCEPT-RC1  FAIL  usage\n', 'CLI', false);
    });
  });
}

// ===================================================== registration ====
// plan 4: the array wired into COMPONENT_IMPLEMENTATIONS.C11a. Each run(context) executes its assigned cases.
export const C11A_IMPLEMENTATIONS = [
  { id: 'V2/C11a/tag-identity', run: (context) => tagIdentity(context) },
  { id: 'V2/C11a/snapshot-inventory', run: (context) => snapshotInventory(context) },
  { id: 'V2/C11a/snapshot-bytes', run: (context) => snapshotBytes(context) },
  { id: 'V2/C11a/installed-fixture', run: (context) => installedFixture(context) },
  { id: 'V2/C11a/fixture-failures', run: (context) => fixtureFailures(context) },
  { id: 'V2/C11a/live-v2', run: (context) => liveV2(context) },
  { id: 'V2/C11a/component-records', run: (context) => componentRecords(context) },
  { id: 'V2/C11a/strict-gate', run: (context) => strictGate(context) },
];
