// v2 baseline helper (C11a): the trusted project-setup-v2.0.0 tag, the byte snapshots shipped under data/, and
// genuine v2-installed fixtures built by running the tagged scripts themselves.
//
// Plan: docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md sections 2.4 and 3.4-3.6, with the maintainer decisions
// in docs/plans/2026-10-15-project-setup-v3-rc1-c11a-decisions.md (G1-G7).
//
// Importing this module performs no filesystem write and starts no process. Every failure throws an Error with
// { code, phase }: code is one of the V2_* codes, phase is the tagged-script phase or null, and the message starts
// with the code, optionally followed by a path or phase name. File contents are never put into a message.
//
// Git isolation (plan 3.5): every child (git reads and tagged Node scripts) gets an environment without inherited
// GIT_* variables, an isolated HOME/USERPROFILE and global config, no system config, no prompts and
// GIT_NO_REPLACE_OBJECTS=1. Direct git reads pass "-c safe.directory=<canonical forward-slash repository root>";
// the isolated global config lists the exact synthetic project root for the git calls the tagged scripts make.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

// ------------------------------------------------------------ constants ----
const deepFreeze = (v) => { if (v && typeof v === 'object') { for (const x of Object.values(v)) deepFreeze(x); Object.freeze(v); } return v; };

export const V2_IDENTITY = deepFreeze({
  tag: 'project-setup-v2.0.0',
  commit: '13566046529bf51fb8fb6d0c83f79c03e1b90eaa',
  tree: '4d032fb8fd7023aef233e94f59c0827f24a7a91a',
  skillVersion: '2.0.0',
});

// Plan 3.4: every versioned data file and the tagged source it is a raw byte copy of.
export const V2_SNAPSHOTS = deepFreeze([
  { snapshot: 'data/secret-paths-v2.0.0.json', source: 'data/secret-paths.json' },
  { snapshot: 'data/v2.0.0/assets/agents/reviewer.md', source: 'assets/agents/reviewer.md' },
  { snapshot: 'data/v2.0.0/assets/agents/docs-sync.md', source: 'assets/agents/docs-sync.md' },
  { snapshot: 'data/v2.0.0/assets/wrappers/claude-reviewer.md', source: 'assets/wrappers/claude-reviewer.md' },
  { snapshot: 'data/v2.0.0/assets/wrappers/claude-docs-sync.md', source: 'assets/wrappers/claude-docs-sync.md' },
  { snapshot: 'data/v2.0.0/assets/wrappers/codex-reviewer.toml', source: 'assets/wrappers/codex-reviewer.toml' },
  { snapshot: 'data/v2.0.0/assets/wrappers/codex-docs_sync.toml', source: 'assets/wrappers/codex-docs_sync.toml' },
]);

// Plan 3.6: the 23 targets a tagged v2 fresh install manages, in table order, with their manifest ownership.
export const V2_INSTALL_TARGETS = deepFreeze([
  { target: 'AGENTS.md', ownership: 'blocks' },
  { target: 'CLAUDE.md', ownership: 'blocks' },
  { target: '.gitignore', ownership: 'blocks' },
  { target: '.ai/security-paths.json', ownership: 'full' },
  { target: '.ai/tools/git-safe.mjs', ownership: 'full' },
  { target: '.ai/agents/reviewer.md', ownership: 'full' },
  { target: '.ai/agents/docs-sync.md', ownership: 'full' },
  { target: '.claude/agents/reviewer.md', ownership: 'full' },
  { target: '.claude/agents/docs-sync.md', ownership: 'full' },
  { target: '.codex/agents/reviewer.toml', ownership: 'full' },
  { target: '.codex/agents/docs_sync.toml', ownership: 'full' },
  { target: '.claude/settings.json', ownership: 'keys' },
  { target: '.ai/context/project-tree.md', ownership: 'merged' },
  { target: '.ai/context/critical-modules.md', ownership: 'merged' },
  { target: '.ai/context/code-patterns.md', ownership: 'merged' },
  { target: '.ai/context/error-contract.md', ownership: 'merged' },
  { target: '.ai/context/configuration.md', ownership: 'merged' },
  { target: '.ai/context/glossary.md', ownership: 'merged' },
  { target: '.ai/decisions/README.md', ownership: 'merged' },
  { target: 'docs/api-conventions.md', ownership: 'merged' },
  { target: 'docs/database.md', ownership: 'merged' },
  { target: 'docs/observability.md', ownership: 'merged' },
  { target: 'TODO.md', ownership: 'merged' },
]);

const RUN_ID = 'v2-baseline-0001';
const DEFAULT_ALLOWS = Object.freeze(['Bash(npm test)', 'Bash(node .ai/tools/git-safe.mjs *)']);
// AGENTS.md placeholders after PROJECT_NAME, in plan 3.6 table order.
const PLACEHOLDERS = Object.freeze([
  ['ONE_LINE_PURPOSE', 'Synthetic v2 fixture.'],
  ['STACK_WITH_VERSIONS', 'Node.js'],
  ['PACKAGE_MANAGER', 'npm'],
  ['RUNTIME_VERSION', 'unknown'],
  ['DB_CHANGE_POLICY', 'unknown'],
  ['VERIFIED_COMMANDS', '- No project commands verified.'],
  ['NESTED_INSTRUCTION_INDEX', '- none'],
]);
// Full-ownership targets and their tagged source; the two canonical agents get the project name rendered.
const FULL_SOURCES = Object.freeze([
  ['.ai/security-paths.json', 'data/secret-paths.json', false],
  ['.ai/tools/git-safe.mjs', 'assets/tools/git-safe.mjs', false],
  ['.ai/agents/reviewer.md', 'assets/agents/reviewer.md', true],
  ['.ai/agents/docs-sync.md', 'assets/agents/docs-sync.md', true],
  ['.claude/agents/reviewer.md', 'assets/wrappers/claude-reviewer.md', false],
  ['.claude/agents/docs-sync.md', 'assets/wrappers/claude-docs-sync.md', false],
  ['.codex/agents/reviewer.toml', 'assets/wrappers/codex-reviewer.toml', false],
  ['.codex/agents/docs_sync.toml', 'assets/wrappers/codex-docs_sync.toml', false],
]);
const EXEC_OPTIONS = Object.freeze({ shell: false, windowsHide: true, encoding: null, timeout: 60000, maxBuffer: 16777216 });
const VERSIONED_RE = /(^|[\/._-])v?\d+\.\d+\.\d+([\/._-]|$)/i;
const OID_RE = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

// --------------------------------------------------------------- errors ----
function v2Error(code, phase = null, detail = '') {
  const e = new Error(detail ? `${code} ${detail}` : code);
  e.code = code;
  e.phase = phase;
  return e;
}
const optionsInvalid = (what) => v2Error('V2_OPTIONS_INVALID', null, what);

// ---------------------------------------------------------------- paths ----
const fwd = (p) => String(p).replace(/\\/g, '/');
// Resolves the longest existing prefix through realpath, so an alias (junction, symlink) is seen as its target.
function canonical(p) {
  let cur = path.resolve(p);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(cur), ...rest.reverse()); } catch {
      const up = path.dirname(cur);
      if (up === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}
// Decision H4: outside only when the relative path is exactly "..", starts with ".." plus a separator, or is absolute.
// A name that merely begins with two dots ("..work") is inside.
const insideOrEqual = (parent, child) => { const rel = path.relative(parent, child); return !(/^\.\.([\\/]|$)/.test(rel) || path.isAbsolute(rel)); };
// Any kind of existing entry counts, links included; an lstat error other than "missing" is treated as present.
function lexists(p) { try { fs.lstatSync(p); return true; } catch (e) { return !(e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')); } }
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// A relative POSIX path that is safe to materialize on every supported platform.
function safeSourcePath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((s) => s && s !== '.' && s !== '..' && !/[\x00-\x1f<>:"|?*]/.test(s) && !/[. ]$/.test(s)
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(s));
}
function safeMappingPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((s) => s && s !== '.' && s !== '..');
}

// ------------------------------------------------- mapping and predicate ----
/** Throws V2_SNAPSHOT_MAPPING_INVALID for any malformed mapping; returns undefined. Never mutates its argument. */
export function validateSnapshotMapping(mappings) {
  const bad = (why) => { throw v2Error('V2_SNAPSHOT_MAPPING_INVALID', null, why); };
  if (!Array.isArray(mappings) || mappings.length === 0) bad('mapping must be a nonempty array');
  const snaps = new Set();
  const sources = new Set();
  mappings.forEach((m, i) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) bad(`entry ${i} is not an object`);
    if (Object.keys(m).sort().join(',') !== 'snapshot,source') bad(`entry ${i} must have exactly snapshot and source`);
    if (!safeMappingPath(m.snapshot)) bad(`entry ${i} snapshot path`);
    if (!safeMappingPath(m.source)) bad(`entry ${i} source path`);
    if (!m.snapshot.startsWith('data/')) bad(`entry ${i} snapshot outside data/`);
    const s = m.snapshot.toLowerCase();
    const r = m.source.toLowerCase();
    if (snaps.has(s)) bad(`entry ${i} duplicate destination`);
    if (sources.has(r)) bad(`entry ${i} duplicate source`);
    snaps.add(s);
    sources.add(r);
  });
  return undefined;
}

/** Plan 3.4: a path under data/ whose remainder starts with v2.0.0/ (any case) or carries a version triple. */
export function isVersionedSnapshotPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('data/')) return false;
  const rest = relativePath.slice('data/'.length);
  return rest.toLowerCase().startsWith('v2.0.0/') || VERSIONED_RE.test(rest);
}

// ------------------------------------------------------------- children ----
function defaultExecute(executable, args, options) {
  const r = spawnSync(executable, args, options);
  const code = r.error && r.error.code ? r.error.code : null;
  return {
    status: r.status === undefined ? null : r.status, signal: r.signal || null,
    error: r.error ? { code, message: String(r.error.message) } : null,
    timedOut: code === 'ETIMEDOUT', truncated: code === 'ENOBUFS',
    stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0),
  };
}
const toBuffer = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x === undefined || x === null ? '' : String(x)));

// Runs one child through the executor. Transport failures win, in this order: timeout, truncation, spawn error or
// signal (plan 4.2). An executor that throws, rejects or returns no result is V2_EXECUTOR_FAILED (decision G3).
async function runChild(ctx, executable, args, cwd, phase) {
  const options = { cwd, env: { ...ctx.env }, ...EXEC_OPTIONS };
  let r;
  try { r = await ctx.execute(executable, [...args], options); } catch { throw v2Error('V2_EXECUTOR_FAILED', phase, phase || ''); }
  if (!r || typeof r !== 'object') throw v2Error('V2_EXECUTOR_FAILED', phase, phase || '');
  if (r.timedOut) throw v2Error('V2_PROCESS_TIMEOUT', phase, phase || '');
  if (r.truncated) throw v2Error('V2_PROCESS_TRUNCATED', phase, phase || '');
  if ((r.error !== null && r.error !== undefined) || (r.signal !== null && r.signal !== undefined)) throw v2Error('V2_PROCESS_FAILED', phase, phase || '');
  return { status: r.status, stdout: toBuffer(r.stdout), stderr: toBuffer(r.stderr) };
}
const gitRead = (ctx, args) => runChild(ctx, 'git', ['-c', `safe.directory=${ctx.safeDir}`, ...args], ctx.repo, null);

// ------------------------------------------------------------ isolation ----
const quoteConfig = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
// Creates <base> (which must not exist) holding an empty home, hooks and template directory and a global config.
function createIsolation(base, safeDirs) {
  fs.mkdirSync(base);
  const home = path.join(base, 'home');
  const hooks = path.join(base, 'hooks-empty');
  const templates = path.join(base, 'templates-empty');
  for (const d of [home, hooks, templates]) fs.mkdirSync(d);
  const cfg = path.join(base, 'gitconfig');
  fs.writeFileSync(cfg, [
    '[user]', '\tname = Fixture', '\temail = fixture@example.invalid',
    '[core]', '\tautocrlf = false', `\thooksPath = ${quoteConfig(fwd(hooks))}`, '\tfsmonitor = false',
    '[commit]', '\tgpgsign = false', '[tag]', '\tgpgsign = false',
    '[init]', '\tdefaultBranch = main', `\ttemplateDir = ${quoteConfig(fwd(templates))}`,
    ...(safeDirs.length ? ['[safe]', ...safeDirs.map((d) => `\tdirectory = ${quoteConfig(d)}`)] : []),
    '',
  ].join('\n'), { flag: 'wx' });
  return { home, cfg };
}
function isolatedEnv(iso) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && typeof v === 'string') env[k] = v;
  Object.assign(env, { HOME: iso.home, USERPROFILE: iso.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: iso.cfg, GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' });
  return env;
}
// Git reads that have no work directory of their own use a temporary isolation under the OS temp dir, removed after.
async function withTempIsolation(fn) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-v2-iso-'));
  try { return await fn(createIsolation(path.join(parent, 'iso'), [])); } finally { fs.rmSync(parent, { recursive: true, force: true }); }
}

function checkOptions(options, allowed) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw optionsInvalid('options must be an object');
  for (const k of Object.keys(options)) if (!allowed.includes(k)) throw optionsInvalid(`unknown option ${k}`);
  if (typeof options.repository !== 'string' || !options.repository) throw optionsInvalid('repository');
  if (options.execute !== undefined && typeof options.execute !== 'function') throw optionsInvalid('execute');
}
function makeCtx(repository, execute, env) {
  const repo = canonical(repository);
  return { repo, safeDir: fwd(repo), execute: execute || defaultExecute, env };
}

// ----------------------------------------------------------- tag reads ----
function oneOid(buf) {
  const m = buf.toString('utf8').match(/^([0-9a-f]+)\r?\n?$/);
  return m && OID_RE.test(m[1]) ? m[1] : null;
}
async function verifyTagWith(ctx) {
  const ref = `refs/tags/${V2_IDENTITY.tag}`;
  const has = await gitRead(ctx, ['show-ref', '--verify', '--quiet', ref]);
  if (has.status === 1) throw v2Error('V2_TAG_MISSING', null, V2_IDENTITY.tag);
  if (has.status !== 0) throw v2Error('V2_GIT_FAILED', null, 'show-ref');
  const c = await gitRead(ctx, ['rev-parse', '--verify', `${ref}^{commit}`]);
  const commit = c.status === 0 ? oneOid(c.stdout) : null;
  if (!commit) throw v2Error('V2_GIT_FAILED', null, 'rev-parse commit');
  if (commit !== V2_IDENTITY.commit) throw v2Error('V2_TAG_COMMIT_MISMATCH', null, V2_IDENTITY.tag);
  // The pinned id is a tree object, so equality with it also proves the object type.
  const t = await gitRead(ctx, ['rev-parse', '--verify', `${commit}:project-setup`]);
  const tree = t.status === 0 ? oneOid(t.stdout) : null;
  if (!tree) throw v2Error('V2_GIT_FAILED', null, 'rev-parse tree');
  if (tree !== V2_IDENTITY.tree) throw v2Error('V2_TAG_TREE_MISMATCH', null, V2_IDENTITY.tag);
  return { tag: V2_IDENTITY.tag, commit, tree, skillVersion: V2_IDENTITY.skillVersion };
}

// Decision G1: "<mode> SP <type> SP <oid> TAB <path>", each record terminated by NUL, no --format.
function parseLsTree(buf) {
  if (!buf.length || buf[buf.length - 1] !== 0) throw v2Error('V2_GIT_FAILED', null, 'ls-tree output');
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) continue;
    const rec = buf.subarray(start, i);
    start = i + 1;
    const tab = rec.indexOf(0x09);
    const m = tab < 0 ? null : /^([0-7]{6}) ([a-z]+) ([0-9a-f]+)$/.exec(rec.subarray(0, tab).toString('latin1'));
    if (!m || !OID_RE.test(m[3])) throw v2Error('V2_GIT_FAILED', null, 'ls-tree record');
    out.push({ mode: m[1], type: m[2], oid: m[3], path: rec.subarray(tab + 1).toString('utf8') });
  }
  return out;
}
async function listTaggedTree(ctx, identity) {
  const ls = await gitRead(ctx, ['ls-tree', '-r', '-z', identity.tree]);
  if (ls.status !== 0) throw v2Error('V2_GIT_FAILED', null, 'ls-tree');
  return parseLsTree(ls.stdout);
}
// The blob is read by its listed id and checked against that id, so the bytes are exactly the tagged object.
async function readBlob(ctx, oid) {
  const r = await gitRead(ctx, ['cat-file', 'blob', oid]);
  if (r.status !== 0) throw v2Error('V2_GIT_FAILED', null, 'cat-file');
  const h = crypto.createHash(oid.length === 64 ? 'sha256' : 'sha1');
  h.update(`blob ${r.stdout.length}\0`);
  h.update(r.stdout);
  if (h.digest('hex') !== oid) throw v2Error('V2_GIT_FAILED', null, 'cat-file object id');
  return r.stdout;
}
const isRegularBlob = (e) => e.type === 'blob' && (e.mode === '100644' || e.mode === '100755');

// ------------------------------------------------------- tag verification ----
/** Verifies the local tag exists and peels to the pinned commit and project-setup tree. */
export async function verifyV2Tag(options) {
  checkOptions(options, ['repository', 'execute']);
  return withTempIsolation((iso) => verifyTagWith(makeCtx(options.repository, options.execute, isolatedEnv(iso))));
}

// ------------------------------------------------------ snapshot parity ----
// Mapped leaves must be regular files whose ancestors inside the skill root are real directories.
function checkMappedLeaves(skillRoot) {
  for (const { snapshot } of V2_SNAPSHOTS) {
    const segs = snapshot.split('/');
    let cur = skillRoot;
    segs.forEach((seg, i) => {
      cur = path.join(cur, seg);
      let st;
      try { st = fs.lstatSync(cur); } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw v2Error('V2_SNAPSHOT_MISSING', null, snapshot);
        throw v2Error('V2_SNAPSHOT_NOT_FILE', null, snapshot);
      }
      const last = i === segs.length - 1;
      if (st.isSymbolicLink() || (last ? !st.isFile() : !st.isDirectory())) throw v2Error('V2_SNAPSHOT_NOT_FILE', null, snapshot);
    });
  }
}
// Every versioned candidate under data/ must be mapped. Links are reported, never followed. Decision H3: a directory
// that cannot be listed or an entry that cannot be inspected fails with V2_SNAPSHOT_UNREADABLE (path relative to the
// skill root); skipping it would let an unmapped versioned file escape, so success needs a complete traversal.
function checkUnmapped(skillRoot) {
  const mapped = new Set(V2_SNAPSHOTS.map((m) => m.snapshot));
  const walk = (dir, rel) => {
    let names;
    try { names = fs.readdirSync(dir); } catch { throw v2Error('V2_SNAPSHOT_UNREADABLE', null, rel); }
    for (const name of names.sort()) {
      const abs = path.join(dir, name);
      const r = `${rel}/${name}`;
      let st;
      try { st = fs.lstatSync(abs); } catch { throw v2Error('V2_SNAPSHOT_UNREADABLE', null, r); }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(abs, r);
      else if (isVersionedSnapshotPath(r) && !mapped.has(r)) throw v2Error('V2_SNAPSHOT_UNMAPPED', null, r);
    }
  };
  walk(path.join(skillRoot, 'data'), 'data');
}

/** Compares every shipped snapshot with its tagged source, raw Buffer against raw Buffer. */
export async function verifyV2Snapshots(options) {
  checkOptions(options, ['repository', 'skillRoot', 'execute']);
  if (typeof options.skillRoot !== 'string' || !options.skillRoot) throw optionsInvalid('skillRoot');
  validateSnapshotMapping(V2_SNAPSHOTS);
  const skillRoot = path.resolve(options.skillRoot);
  return withTempIsolation(async (iso) => {
    const ctx = makeCtx(options.repository, options.execute, isolatedEnv(iso));
    const identity = await verifyTagWith(ctx);
    checkMappedLeaves(skillRoot);
    checkUnmapped(skillRoot);
    const byPath = new Map((await listTaggedTree(ctx, identity)).map((e) => [e.path, e]));
    const tagged = [];
    for (const { snapshot, source } of V2_SNAPSHOTS) {
      const entry = byPath.get(source);
      if (!entry || !isRegularBlob(entry)) throw v2Error('V2_SOURCE_ENTRY_INVALID', null, source);
      tagged.push({ snapshot, source, bytes: await readBlob(ctx, entry.oid) });
    }
    const files = [];
    for (const t of tagged) {
      checkMappedLeaves(skillRoot); // a leaf swapped for a link between the checks is still never read
      const shipped = fs.readFileSync(path.join(skillRoot, ...t.snapshot.split('/')));
      if (Buffer.compare(shipped, t.bytes) !== 0) throw v2Error('V2_SNAPSHOT_BYTES_DIFFER', null, t.snapshot);
      files.push({ snapshot: t.snapshot, source: t.source, bytes: t.bytes.length, sha256: sha256(t.bytes) });
    }
    return { identity: V2_IDENTITY, files };
  });
}

// -------------------------------------------------------- materializing ----
// Decision G6: the destination must not exist in any form; its parent must be an existing directory.
function assertUnusedDestination(dest) {
  if (lexists(dest)) throw v2Error('V2_DESTINATION_EXISTS', null, dest);
  let st = null;
  try { st = fs.statSync(path.dirname(dest)); } catch { /* reported below */ }
  if (!st || !st.isDirectory()) throw optionsInvalid('destination parent is not a directory');
}
function createDestination(dest) {
  try { fs.mkdirSync(dest); } catch (e) {
    if (e.code === 'EEXIST') throw v2Error('V2_DESTINATION_EXISTS', null, dest);
    throw optionsInvalid('destination cannot be created');
  }
}
// Lists and validates the whole tagged subtree and reads every blob before a single file is written.
async function materializeWith(ctx, dest) {
  const identity = await verifyTagWith(ctx);
  const entries = await listTaggedTree(ctx, identity);
  if (!entries.length) throw v2Error('V2_GIT_FAILED', null, 'empty tagged tree');
  for (const e of entries) if (!isRegularBlob(e)) throw v2Error('V2_SOURCE_ENTRY_INVALID', null, JSON.stringify(e.path));
  const files = new Set();
  const dirs = new Set();
  for (const e of entries) {
    if (!safeSourcePath(e.path)) throw v2Error('V2_SOURCE_PATH_INVALID', null, JSON.stringify(e.path));
    const key = e.path.toLowerCase();
    if (files.has(key)) throw v2Error('V2_SOURCE_PATH_INVALID', null, JSON.stringify(e.path));
    files.add(key);
    const segs = key.split('/');
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/'));
  }
  for (const f of files) if (dirs.has(f)) throw v2Error('V2_SOURCE_PATH_INVALID', null, JSON.stringify(f));
  const blobs = [];
  for (const e of entries) blobs.push({ e, bytes: await readBlob(ctx, e.oid) });
  createDestination(dest);
  for (const { e, bytes } of blobs) {
    const abs = path.join(dest, ...e.path.split('/'));
    if (!insideOrEqual(dest, abs) || abs === dest) throw v2Error('V2_SOURCE_PATH_INVALID', null, JSON.stringify(e.path));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes, { flag: 'wx', mode: e.mode === '100755' ? 0o755 : 0o644 });
  }
  return identity;
}

/** Writes the tagged project-setup/ tree directly into destination (decision G2). Never checks anything out. */
export async function materializeV2Source(options) {
  checkOptions(options, ['repository', 'destination', 'execute']);
  if (typeof options.destination !== 'string' || !options.destination) throw optionsInvalid('destination');
  const dest = path.resolve(options.destination);
  assertUnusedDestination(dest);
  return withTempIsolation(async (iso) => {
    await materializeWith(makeCtx(options.repository, options.execute, isolatedEnv(iso)), dest);
    return { identity: V2_IDENTITY, skillRoot: dest };
  });
}

// --------------------------------------------------------- v2 fixture ----
function parseJsonObject(buf) {
  try { const j = JSON.parse(buf.toString('utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
}
const render = (text, pairs) => pairs.reduce((t, [k, v]) => t.split(`{{${k}}}`).join(v), text);

// Drafts for every target except .gitignore (blocks.mjs) and .claude/settings.json (the merger), plus the allow-file.
function stageDrafts(root, sk, projectName, allows) {
  const runDir = path.join(root, '.ai', '.run', RUN_ID);
  const drafts = path.join(runDir, 'drafts');
  let st = null;
  try { st = fs.lstatSync(drafts); } catch { /* reported below */ }
  if (!st || !st.isDirectory() || st.isSymbolicLink() || !insideOrEqual(root, fs.realpathSync.native(drafts))) throw v2Error('V2_OUTPUT_INVALID', 'init', 'init');
  const asset = (rel) => fs.readFileSync(path.join(sk, ...rel.split('/')));
  const staged = [];
  staged.push(['AGENTS.md', render(asset('assets/templates/AGENTS.md').toString('utf8'), [['PROJECT_NAME', projectName], ...PLACEHOLDERS])]);
  staged.push(['CLAUDE.md', asset('assets/templates/CLAUDE.md')]);
  for (const [target, source, named] of FULL_SOURCES) staged.push([target, named ? render(asset(source).toString('utf8'), [['PROJECT_NAME', projectName]]) : asset(source)]);
  for (const t of V2_INSTALL_TARGETS) {
    if (t.ownership !== 'merged') continue;
    const title = t.target === 'TODO.md' ? 'TODO' : t.target === '.ai/decisions/README.md' ? 'Decisions' : path.posix.basename(t.target, '.md');
    staged.push([t.target, `# ${title}\n`]);
  }
  // Decision H1: every staged leaf and each of its ancestors beneath drafts/ must be absent before anything is written,
  // checked without following links. Any existing entry (file, directory, junction, symlink) is V2_DESTINATION_EXISTS.
  const dirs = new Set();
  for (const [rel] of staged) { const segs = rel.split('/'); for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join('/')); }
  const orderedDirs = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const rel of [...orderedDirs, ...staged.map(([r]) => r)]) {
    if (lexists(path.join(drafts, ...rel.split('/')))) throw v2Error('V2_DESTINATION_EXISTS', 'init', `drafts/${rel}`);
  }
  const allowFile = path.join(runDir, 'fixture-allows.json');
  if (lexists(allowFile)) throw v2Error('V2_DESTINATION_EXISTS', 'init', 'fixture-allows.json');
  // Every directory and file is created exclusively, parents first, so nothing is ever written through a link.
  for (const rel of orderedDirs) fs.mkdirSync(path.join(drafts, ...rel.split('/')));
  for (const [rel, data] of staged) fs.writeFileSync(path.join(drafts, ...rel.split('/')), data, { flag: 'wx' });
  fs.writeFileSync(allowFile, JSON.stringify(allows) + '\n', { flag: 'wx' });
  return allowFile;
}

// The manifest only the tagged commit wrote: exactly the 23 targets with their expected ownership.
function checkManifest(root) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, '.ai', 'manifest.json')); } catch { throw v2Error('V2_COMMIT_INVALID', 'commit', 'manifest missing'); }
  const m = parseJsonObject(raw);
  const files = m && m.files && typeof m.files === 'object' && !Array.isArray(m.files) ? m.files : null;
  const want = V2_INSTALL_TARGETS.map((t) => t.target);
  if (!m || m.schema !== 2 || m.skillVersion !== V2_IDENTITY.skillVersion || !files
    || Object.keys(files).sort().join('\n') !== [...want].sort().join('\n')) throw v2Error('V2_COMMIT_INVALID', 'commit', 'manifest');
  const installed = V2_INSTALL_TARGETS.map((t) => ({ target: t.target, ownership: files[t.target] && files[t.target].ownership }));
  installed.forEach((x, i) => { if (x.ownership !== V2_INSTALL_TARGETS[i].ownership) throw v2Error('V2_COMMIT_INVALID', 'commit', x.target); });
  return { raw, installed };
}

// Decision H2: root must be the top level git itself discovers (under the isolated config) and HEAD must be a commit.
// A subdirectory of another repository would let the tagged scripts write their lock and run files into that one.
async function verifyProjectRoot(ctx, root) {
  const run = (args) => runChild(ctx, 'git', ['-c', `safe.directory=${fwd(root)}`, ...args], root, null);
  const top = await run(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw optionsInvalid('root is not a git repository');
  let topLevel = null;
  try { topLevel = fs.realpathSync.native(path.resolve(top.stdout.toString('utf8').replace(/\r?\n$/, ''))); } catch { /* reported below */ }
  if (!topLevel || path.relative(root, topLevel) !== '') throw optionsInvalid('root is not the top level of its git repository');
  const head = await run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head.status !== 0 || !oneOid(head.stdout)) throw optionsInvalid('root has no commit');
}

/**
 * Builds a genuine v2 installation in an existing synthetic git repository by running the tagged scripts in plan
 * 3.6 phase order. A failure stops at that phase and leaves its state for diagnosis: no release, rollback or cleanup.
 */
export async function createV2InstalledFixture(options) {
  checkOptions(options, ['repository', 'root', 'workDir', 'projectName', 'managedAllows', 'execute']);
  const { root: rootIn, workDir: workIn, projectName } = options;
  if (typeof rootIn !== 'string' || !rootIn) throw optionsInvalid('root');
  if (typeof workIn !== 'string' || !workIn) throw optionsInvalid('workDir');
  if (typeof projectName !== 'string' || !projectName || /[\r\n\u2028\u2029]/.test(projectName)) throw optionsInvalid('projectName');
  let allows = [...DEFAULT_ALLOWS];
  if (options.managedAllows !== undefined) {
    const a = options.managedAllows;
    if (!Array.isArray(a) || a.some((x) => typeof x !== 'string') || new Set(a).size !== a.length) throw optionsInvalid('managedAllows');
    allows = [...a];
  }
  let rootStat = null;
  try { rootStat = fs.statSync(rootIn); } catch { /* reported below */ }
  if (!rootStat || !rootStat.isDirectory()) throw optionsInvalid('root is not a directory');
  const root = fs.realpathSync.native(path.resolve(rootIn));

  // Containment first: an equal, nested or aliased work directory is refused before anything else is looked at.
  if (insideOrEqual(root, canonical(workIn))) throw v2Error('V2_WORKDIR_INSIDE_PROJECT', null, workIn);
  for (const rel of ['.ai/manifest.json', ...V2_INSTALL_TARGETS.map((t) => t.target).filter((t) => t !== '.gitignore')]) {
    if (lexists(path.join(root, ...rel.split('/')))) throw v2Error('V2_FIXTURE_NOT_FRESH', null, rel);
  }
  assertUnusedDestination(path.resolve(workIn));
  const execute = options.execute || defaultExecute;

  // Both pins are verified before the work directory is created or any tagged content is read. Nothing but the
  // tagged source is written into the work directory until materialization has succeeded.
  let work;
  let sk;
  await withTempIsolation(async (tmpIso) => {
    const readCtx = makeCtx(options.repository, execute, isolatedEnv(tmpIso));
    await verifyProjectRoot(readCtx, root);
    await verifyTagWith(readCtx);
    createDestination(path.resolve(workIn));
    work = canonical(workIn);
    fs.mkdirSync(path.join(work, 'source'));
    sk = path.join(work, 'source', 'project-setup');
    await materializeWith(readCtx, sk);
  });
  const iso = createIsolation(path.join(work, 'git-isolation'), [fwd(root)]);
  const ctx = makeCtx(options.repository, execute, isolatedEnv(iso));

  const commands = [];
  const step = async (phase, script, args) => {
    const r = await runChild(ctx, process.execPath, [path.join(sk, 'scripts', script), ...args], root, phase);
    const j = parseJsonObject(r.stdout);
    if (phase === 'lock-release') {
      if (r.status !== 0 || !j || j.ok !== true || j.released !== true) throw v2Error('V2_LOCK_RELEASE_FAILED', phase, phase);
    } else {
      if (r.status !== 0) throw v2Error('V2_SCRIPT_FAILED', phase, phase);
      if (phase === 'prepare') { if (!j || j.ok !== true || typeof j.planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(j.planSha256)) throw v2Error('V2_PREPARE_INVALID', phase, phase); }
      else if (phase === 'commit') { if (!j || j.ok !== true || j.committed !== true) throw v2Error('V2_COMMIT_INVALID', phase, phase); }
      else if (phase === 'validate') { if (!j || j.ok !== true) throw v2Error('V2_VALIDATE_FAILED', phase, phase); }
      else if (!j || j.ok !== true || (phase === 'lock-acquire' && j.acquired !== true)) throw v2Error('V2_OUTPUT_INVALID', phase, phase);
    }
    commands.push({ phase, script: `scripts/${script}`, args: [...args], status: 0 });
    return j;
  };

  await step('lock-acquire', 'lock.mjs', ['acquire', '--run-id', RUN_ID]);
  await step('init', 'apply.mjs', ['init', '--run-id', RUN_ID]);
  const allowFile = stageDrafts(root, sk, projectName, allows);
  await step('blocks', 'blocks.mjs', ['upsert', '--file', '.gitignore', '--id', 'gitignore', '--content', path.join(sk, 'assets', 'templates', 'gitignore-block.txt'), '--run-id', RUN_ID]);
  await step('merge', 'merge-claude-settings.mjs', ['--run-id', RUN_ID, '--allow-file', allowFile]);
  const prepared = await step('prepare', 'apply.mjs', ['prepare', '--run-id', RUN_ID, '--mode', 'fresh', '--agents', 'claude,codex']);
  await step('commit', 'apply.mjs', ['commit', '--run-id', RUN_ID, '--approved-plan', prepared.planSha256]);
  const { raw, installed } = checkManifest(root);
  await step('validate', 'validate.mjs', []);
  await step('lock-release', 'lock.mjs', ['release', '--run-id', RUN_ID]);

  return {
    root: path.resolve(rootIn),
    provenance: {
      tag: V2_IDENTITY.tag, commit: V2_IDENTITY.commit, tree: V2_IDENTITY.tree, skillVersion: V2_IDENTITY.skillVersion,
      runId: RUN_ID, projectName, managedAllows: allows, planSha256: prepared.planSha256, manifestRawSha256: sha256(raw), commands,
    },
    installed,
  };
}
