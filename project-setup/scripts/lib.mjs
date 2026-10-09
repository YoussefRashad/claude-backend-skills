// Shared helpers for project-setup scripts. Zero dependencies, Node >= 18.
// Runs on Windows native, WSL, macOS and Linux.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const IS_WINDOWS = process.platform === 'win32';

/** Paths the skill may ever write inside a project. apply.mjs refuses anything else. */
export const WRITE_ALLOWLIST = [
  'AGENTS.md', '**/AGENTS.md',
  'CLAUDE.md', '**/CLAUDE.md',
  'TODO.md',
  '.gitignore',
  '.env.example',
  '.ai/**',
  'docs/**',
  '.claude/settings.json',
  '.claude/agents/**',
  '.codex/agents/**',
];

/** Paths the skill must never write, even if an allowlist entry matches. */
export const WRITE_DENYLIST = [
  '.git/**', '**/.git/**',
  '.claude/settings.local.json', 'CLAUDE.local.md',
  '.codex/config.toml',
  'node_modules/**', '**/node_modules/**',
];

export function fail(message, code = 1, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + '\n');
  process.exit(code);
}

export function ok(payload) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }, null, 2) + '\n');
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, shell: false, ...opts });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), error: r.error };
}

export function git(args, cwd) {
  return run('git', args, { cwd });
}

let REPO_ROOT = null;
export function repoRoot(start = process.cwd()) {
  const r = git(['rev-parse', '--show-toplevel'], start);
  if (r.status === 0 && r.stdout) { REPO_ROOT = path.resolve(r.stdout); return REPO_ROOT; }
  return null;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** gitignore-flavoured glob -> RegExp, matched against repo-relative POSIX paths. */
export function globToRegExp(glob) {
  let g = glob.replace(/^\.\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const prevSlash = i === 0 || g[i - 1] === '/';
        const nextSlash = g[i + 2] === '/';
        if (prevSlash && nextSlash) { re += '(?:.*/)?'; i += 2; continue; }
        if (prevSlash && i + 2 === g.length) { re += '.*'; i += 1; continue; }
        re += '.*'; i += 1; continue;
      }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  // A bare name with no slash matches at any depth (gitignore semantics).
  if (!g.includes('/')) re = '(?:.*/)?' + re;
  return new RegExp('^' + re + '$', IS_WINDOWS ? 'i' : '');
}

export function matchesAny(relPosix, globs) {
  return globs.some((g) => globToRegExp(g).test(relPosix));
}

export function loadSecretSpec() {
  return JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'data', 'secret-paths.json'), 'utf8'));
}

export function secretGlobs(spec = loadSecretSpec()) {
  return spec.patterns.map((p) => p.glob);
}

export function isSecretPath(relPosix, spec) {
  return matchesAny(relPosix, secretGlobs(spec));
}

/**
 * Throws if a file passed to a script as input (content, keys, allow lists) is, or resolves to, a secret-pattern
 * path, inside or outside the repository. Checked BEFORE the file is opened, so its bytes can never reach drafts or
 * error messages. Both the spelling given and the canonical destination (links/junctions resolved with the native
 * resolver) are checked; if the destination cannot be resolved the input is refused. Returns the canonical path,
 * which is what callers read (so a link swapped after the check cannot redirect the read).
 */
export function assertNotSecretInput(p, spec = loadSecretSpec()) {
  const abs = path.resolve(String(p));
  let real;
  try { real = fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs); } catch {
    throw new Error(`refusing input that cannot be resolved: ${path.basename(abs)}`);
  }
  const root = REPO_ROOT;
  let realRoot = null;
  if (root) { try { realRoot = fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root); } catch { realRoot = null; } }
  const forms = new Set();
  const addForms = (filePath, base) => {
    const rel = base ? path.relative(base, filePath) : null;
    if (rel !== null && !rel.startsWith('..') && !path.isAbsolute(rel)) forms.add(toPosix(rel));
    forms.add(toPosix(filePath).replace(/^[A-Za-z]:/, '').replace(/^\/+/, ''));
    forms.add(path.basename(filePath));
  };
  addForms(abs, root);
  addForms(real, realRoot);
  for (const f of forms) {
    if (isSecretPath(f, spec)) throw new Error(`refusing to read a secret-pattern file as input: ${path.basename(abs)}`);
  }
  return real;
}

/** Normalize text for hashing so CRLF/LF and BOM differences (git autocrlf on Windows) do not register as user edits. */
export function normalizeText(input) {
  let s = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n?/g, '\n');
  if (!s.endsWith('\n')) s += '\n';
  return s;
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function normalizedHash(text) {
  return sha256(normalizeText(text));
}

/** Hash of the exact bytes on disk; used for apply preconditions. null when missing. */
export function rawFileHash(absPath) {
  try { return sha256(fs.readFileSync(absPath)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

export function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

export const ENV_TEMPLATE_RE = /(^|\/)\.env\.(example|sample|template)$/;

/** Run ids become directory names. Strict charset, no separators, no dot-only segments. */
export function validateRunId(id) {
  const s = id === undefined || id === null || id === true ? '' : String(id);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,63}$/.test(s) || s.includes('..')) {
    throw new Error(`invalid run id "${s}": use 4-64 chars [A-Za-z0-9._-], starting alphanumeric, no ".."`);
  }
  return s;
}

/**
 * Canonical identity of an existing path for comparisons. Uses the native resolver when available: on Windows,
 * fs.realpathSync (JS) can keep 8.3 short names (C:/Users/ABCDEF~1.XYZ) while realpathSync.native returns the long
 * name, so the same directory would otherwise compare as two. Case-folded on Windows. Missing paths fall back to
 * path.resolve.
 */
export function canonicalPath(p) {
  let real;
  try { real = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); } catch { real = path.resolve(p); }
  real = path.resolve(real);
  return IS_WINDOWS ? real.toLowerCase() : real;
}

function realRootOf(root) {
  return fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root);
}

function isInside(parentReal, childReal) {
  const rel = path.relative(parentReal, childReal);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve (and optionally create) a directory under the repo, one segment at a time.
 * Every existing segment must be a real directory: symlinks and Windows junctions are rejected
 * (Node reports junctions as symbolic links). The final real path must stay inside the repo.
 */
export function secureDir(root, segments, { create = false } = {}) {
  // Anchor is always the repository root. A subdirectory is never trusted as a root, because the
  // subdirectory itself may be a link (rc.2 bug: vault/backup replaced by a junction).
  if (!REPO_ROOT) repoRoot(root);
  if (!REPO_ROOT || path.resolve(root) !== REPO_ROOT) throw new Error(`secureDir must be anchored at the repository root (got ${root})`);
  const realRoot = realRootOf(root);
  let cur = root;
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || /[\\/]/.test(seg)) throw new Error(`invalid path segment "${seg}"`);
    cur = path.join(cur, seg);
    let st = null;
    try { st = fs.lstatSync(cur); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (st) {
      if (st.isSymbolicLink()) throw new Error(`link or junction rejected: ${toPosix(path.relative(root, cur))}`);
      if (!st.isDirectory()) throw new Error(`not a directory: ${toPosix(path.relative(root, cur))}`);
    } else if (create) {
      fs.mkdirSync(cur); // non-recursive on purpose: each segment is checked
    } else {
      return null;
    }
  }
  const real = realRootOf(cur);
  if (!isInside(realRoot, real)) throw new Error(`directory resolves outside the repository: ${toPosix(path.relative(root, cur))}`);
  return cur;
}

/** secureDir for a repo-relative POSIX path that may contain several segments. */
export function secureDirRel(root, relPosix, opts) {
  return secureDir(root, relPosix.split('/').filter(Boolean), opts);
}

/** Resolve a repo-relative path safely. Rejects absolute paths, traversal, and symlinked components. */
export function safeResolve(root, rel) {
  if (!rel || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error(`absolute or empty path rejected: ${rel}`);
  const posix = rel.replace(/\\/g, '/');
  if (posix.split('/').some((seg) => seg === '..')) throw new Error(`path traversal rejected: ${rel}`);
  const abs = path.resolve(root, posix);
  const relBack = path.relative(root, abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) throw new Error(`path escapes repository: ${rel}`);
  // Refuse to traverse or replace symlinks / junctions.
  let cur = root;
  for (const seg of posix.split('/')) {
    cur = path.join(cur, seg);
    try {
      if (fs.lstatSync(cur).isSymbolicLink()) throw new Error(`symlink in path rejected: ${toPosix(path.relative(root, cur))}`);
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
  }
  // Containment by real path for the deepest existing ancestor (defence in depth for junctions).
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  if (!isInside(realRootOf(root), realRootOf(probe))) throw new Error(`path resolves outside the repository: ${rel}`);
  return { abs, rel: posix };
}

export function assertWritable(relPosix) {
  if (matchesAny(relPosix, WRITE_DENYLIST)) throw new Error(`write denied by policy: ${relPosix}`);
  if (!matchesAny(relPosix, WRITE_ALLOWLIST)) throw new Error(`write outside documentation scope: ${relPosix}`);
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Write via temp file + rename in the same directory. Retries transient Windows locks (AV, indexer, editors). */
export function atomicWrite(absPath, data) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.ps-tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // 'wx' = exclusive create: never opens (or follows) something that already exists at the temp name.
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data); } finally { fs.closeSync(fd); }
  let lastErr;
  for (let attempt = 0; attempt < 8; attempt++) {
    try { fs.renameSync(tmp, absPath); return; } catch (e) {
      lastErr = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
      sleep(50 * 2 ** attempt);
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  throw lastErr;
}

export function readJsonFile(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8').replace(/^\uFEFF/, ''));
}

export function hostId() {
  return `${os.hostname()}:${os.userInfo().username}`;
}

export function skillVersion() {
  return fs.readFileSync(path.join(SKILL_DIR, 'VERSION'), 'utf8').trim();
}

/** Throws if `abs` exists and is a symlink/junction. Missing is fine. */
export function assertNotLink(abs) {
  let st = null;
  try { st = fs.lstatSync(abs); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (st && st.isSymbolicLink()) throw new Error(`link or junction rejected: ${abs}`);
  if (st && !st.isFile()) throw new Error(`not a regular file: ${abs}`);
}

/**
 * Write `data` to the repo-relative file `relPosix`: re-validate the whole directory chain from the
 * repository root (creating directories if asked), refuse a linked leaf, then write via exclusive temp +
 * rename (rename replaces a path; it never writes through a link).
 */
export function writeInRepo(root, relPosix, data, { createDirs = true } = {}) {
  const segs = relPosix.split('/').filter(Boolean);
  const dir = secureDir(root, segs.slice(0, -1), { create: createDirs });
  if (!dir) throw new Error(`directory missing: ${segs.slice(0, -1).join('/')}`);
  const abs = path.join(dir, segs[segs.length - 1]);
  assertNotLink(abs);
  atomicWrite(abs, data);
  return abs;
}

/** Read a repo-relative file after validating its directory chain and refusing a linked leaf. */
export function readInRepo(root, relPosix) {
  const segs = relPosix.split('/').filter(Boolean);
  const dir = secureDir(root, segs.slice(0, -1));
  if (!dir) throw new Error(`directory missing: ${segs.slice(0, -1).join('/')}`);
  const abs = path.join(dir, segs[segs.length - 1]);
  assertNotLink(abs);
  return fs.readFileSync(abs);
}
