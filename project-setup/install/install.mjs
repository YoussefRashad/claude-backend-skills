#!/usr/bin/env node
// Installs ONE versioned source of project-setup into both tools' user skill directories.
// Copies (not symlinks): Windows symlinks need admin/Developer Mode, and a copy is verifiable.
//
// Guarantees (rc.2):
//   - All targets are checked BEFORE anything changes; one blocked target means nothing is changed.
//   - A locally edited installed copy is never treated as "unchanged" and never overwritten.
//   - An existing copy without install metadata (v1/unversioned) is replaced only with --replace-unversioned.
//   - Targets are switched together; if one switch fails, the ones already switched are reverted.
//   - Exit code is non-zero whenever the requested state was not reached.
//
// Usage:
//   node install/install.mjs [--targets claude,codex] [--claude-dir <dir>] [--codex-dir <dir>]
//                            [--dry-run] [--plugin-handled] [--replace-unversioned]
//   node install/install.mjs verify   [target flags]   exit 0 only if every target matches this source
//   node install/install.mjs rollback [target flags] [--accept-unverified-backup]
//                                     restore each target's most recent backup, only after every one is verified
//
// Exit codes: 0 ok · 1 usage · 2 plugin copy needs handling · 3 blocked (nothing changed)
//             4 switch or rollback failed and was reverted · 5 verify mismatch · 6 rollback impossible (nothing changed)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'project-setup';
const INCLUDE = ['SKILL.md', 'VERSION', 'CHANGELOG.md', 'references', 'assets', 'data', 'scripts'];

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'install';
const flag = (k) => { const i = argv.indexOf(`--${k}`); return i === -1 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const die = (msg, extra = {}, code = 1) => { out({ ok: false, error: msg, ...extra }); process.exit(code); };

const home = os.homedir();
const targets = String(flag('targets') || 'claude,codex').split(',').map((s) => s.trim()).filter(Boolean);
const dirs = {
  claude: path.resolve(String(flag('claude-dir') || path.join(home, '.claude', 'skills'))),
  codex: path.resolve(String(flag('codex-dir') || path.join(home, '.agents', 'skills'))),
};
for (const t of targets) if (!dirs[t]) die(`unknown target: ${t}`);
// Same canonicalisation as scripts/lib.mjs canonicalPath (native resolver: 8.3 aliases and links collapse).
const canonical = (p) => {
  let real; try { real = fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); } catch { real = path.resolve(p); }
  real = path.resolve(real);
  return process.platform === 'win32' ? real.toLowerCase() : real;
};
if (new Set(targets.map((t) => canonical(dirs[t]))).size !== targets.length) die('two targets point at the same directory');

for (const required of ['SKILL.md', 'VERSION', 'scripts/lib.mjs', 'data/secret-paths.json']) {
  if (!fs.existsSync(path.join(SRC, required))) die(`incomplete skill source: ${required} missing in ${SRC}`);
}
const version = fs.readFileSync(path.join(SRC, 'VERSION'), 'utf8').trim();

function listFiles(base) {
  const files = [];
  for (const entry of INCLUDE) {
    const abs = path.join(base, entry);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const p = stack.pop();
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) die(`symlink or junction in skill tree rejected: ${p}`);
      if (st.isDirectory()) for (const c of fs.readdirSync(p)) stack.push(path.join(p, c));
      else files.push(path.relative(base, p).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function treeHash(base) {
  const h = createHash('sha256');
  for (const rel of listFiles(base)) {
    // Line-ending-insensitive for text so an autocrlf checkout of the source hashes like the original.
    const buf = fs.readFileSync(path.join(base, rel));
    const norm = /\.(md|mjs|json|toml|txt)$|^VERSION$/.test(rel) ? Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')) : buf;
    h.update(rel).update('\0').update(norm).update('\0');
  }
  return h.digest('hex');
}

/**
 * Digest of an entire directory: every entry (not only INCLUDE), exact bytes, links refused. Recorded when a copy
 * is moved to a backup, verified before that backup is ever restored.
 */
function snapshot(dir) {
  const files = [];
  const stack = [''];
  while (stack.length) {
    const relDir = stack.pop();
    for (const e of fs.readdirSync(path.join(dir, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isSymbolicLink()) throw new Error(`link in backup: ${rel}`);
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) files.push(rel);
      else throw new Error(`unsupported entry in backup: ${rel}`);
    }
  }
  files.sort();
  const h = createHash('sha256');
  for (const rel of files) h.update(rel).update('\0').update(fs.readFileSync(path.join(dir, ...rel.split('/')))).update('\0');
  return { sha256: h.digest('hex'), files: files.length };
}

/**
 * Verify a backup before it may be restored. Never derives trust from the backup's current content.
 *  - snapshot recorded in <backup>.meta.json (rc.9+): full-directory digest must match;
 *  - otherwise an installed copy with .installed.json: no unexpected entries, no links, tree hash must match;
 *  - otherwise (legacy unversioned backup with no recorded digest): unverifiable.
 */
function verifyBackup(full) {
  let st; try { st = fs.lstatSync(full); } catch (e) { return { ok: false, reason: `missing: ${e.message}` }; }
  if (st.isSymbolicLink() || !st.isDirectory()) return { ok: false, reason: 'backup is not a real directory' };
  let meta = null; try { meta = JSON.parse(fs.readFileSync(`${full}.meta.json`, 'utf8')); } catch { /* none */ }
  if (meta?.snapshot?.sha256) {
    let now; try { now = snapshot(full); } catch (e) { return { ok: false, reason: e.message }; }
    return now.sha256 === meta.snapshot.sha256 && now.files === meta.snapshot.files
      ? { ok: true, method: 'snapshot' } : { ok: false, reason: `snapshot mismatch (recorded ${meta.snapshot.files} files, found ${now.files})` };
  }
  const inst = readMeta(full);
  if (inst?.treeSha256) {
    const extra = unexpectedEntries(full);
    if (extra.length) return { ok: false, reason: `unexpected entries: ${extra.join(', ')}` };
    try { snapshot(full); } catch (e) { return { ok: false, reason: e.message }; } // link scan over everything
    let h; try { h = treeHash(full); } catch (e) { return { ok: false, reason: e.message }; }
    return h === inst.treeSha256 ? { ok: true, method: 'install-tree-hash' } : { ok: false, reason: 'tree hash does not match the recorded install' };
  }
  return { ok: false, unverifiable: true, reason: 'no recorded digest (legacy unversioned backup); cannot prove it is intact' };
}

const readMeta = (dest) => { try { return JSON.parse(fs.readFileSync(path.join(dest, '.installed.json'), 'utf8')); } catch { return null; } };
/** Top-level entries an installed copy may contain. Anything else (files, dirs, links) is a local modification. */
const ALLOWED_TOP = new Set([...INCLUDE, '.installed.json']);
const unexpectedEntries = (dest) => fs.readdirSync(dest).filter((n) => !ALLOWED_TOP.has(n));

function findPluginCopies() {
  const found = [];
  const stack = [{ d: path.join(home, '.claude', 'plugins'), depth: 0 }];
  while (stack.length) {
    const { d, depth } = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(d, e.name);
      if (e.name === NAME && fs.existsSync(path.join(full, 'SKILL.md'))) found.push(full);
      else if (depth < 6) stack.push({ d: full, depth: depth + 1 });
    }
  }
  return found;
}

/** Backups sorted oldest -> newest by recorded time, then trailing timestamp in the name, then mtime. */
function backups(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(`.${NAME}.bak-`) && !n.endsWith('.meta.json')); } catch { return []; }
  const keyed = names.map((n) => {
    const full = path.join(dir, n);
    let t = null;
    // rc.3+: sibling "<backup>.meta.json"; rc.2: ".backup.json" inside the backup.
    for (const m of [`${full}.meta.json`, path.join(full, '.backup.json')]) {
      if (Number.isFinite(t)) break;
      try { t = Date.parse(JSON.parse(fs.readFileSync(m, 'utf8')).backedUpAt); } catch { /* none */ }
    }
    if (!Number.isFinite(t)) { const m = n.match(/-(\d{3,})$/); t = m ? Number(m[1]) : null; }
    if (!Number.isFinite(t)) { try { t = fs.statSync(full).mtimeMs; } catch { t = 0; } }
    return { name: n, full, t };
  });
  return keyed.filter((k) => fs.statSync(k.full).isDirectory()).sort((a, b) => a.t - b.t || a.name.localeCompare(b.name));
}

const srcHash = treeHash(SRC);

function state(t) {
  const dest = path.join(dirs[t], NAME);
  if (!fs.existsSync(dest)) return { target: t, dest, kind: 'absent' };
  if (fs.lstatSync(dest).isSymbolicLink()) return { target: t, dest, kind: 'symlink' };
  const meta = readMeta(dest);
  if (!meta) return { target: t, dest, kind: 'unversioned' };
  const extra = unexpectedEntries(dest);
  if (extra.length) return { target: t, dest, kind: 'locally-modified', version: meta.version, extra };
  const current = treeHash(dest);
  if (current !== meta.treeSha256) return { target: t, dest, kind: 'locally-modified', version: meta.version };
  if (current === srcHash) return { target: t, dest, kind: 'current', version: meta.version };
  return { target: t, dest, kind: 'other-version', version: meta.version };
}

// ------------------------------------------------------------------ verify ----
if (cmd === 'verify') {
  const report = targets.map((t) => {
    const s = state(t);
    return { target: t, path: s.dest, installed: s.kind !== 'absent', state: s.kind, version: s.version ?? null, matchesThisSource: s.kind === 'current' };
  });
  const allMatch = report.every((r) => r.matchesThisSource);
  out({ ok: allMatch, sourceVersion: version, report, pluginCopies: findPluginCopies() });
  process.exit(allMatch ? 0 : 5);
}

// ---------------------------------------------------------------- rollback ----
if (cmd === 'rollback') {
  // Preflight: every target must have a restorable backup; nothing changes otherwise.
  const plans = targets.map((t) => ({ t, list: backups(dirs[t]) }));
  const missing = plans.filter((p) => !p.list.length).map((p) => p.t);
  if (missing.length) die('no backup to restore for some targets; nothing was changed', { missing }, 6);
  const unsafe = plans.filter(({ t }) => { const d = path.join(dirs[t], NAME); return fs.existsSync(d) && fs.lstatSync(d).isSymbolicLink(); }).map((p) => p.t);
  if (unsafe.length) die('installed path is a symlink/junction; nothing was changed', { unsafe }, 6);
  // Every selected backup must be proven intact before ANY target changes.
  const acceptUnverified = Boolean(flag('accept-unverified-backup'));
  const checks = plans.map(({ t, list }) => ({ target: t, backup: list[list.length - 1].full, ...verifyBackup(list[list.length - 1].full) }));
  const bad = checks.filter((c) => !c.ok && !(c.unverifiable && acceptUnverified));
  if (bad.length) {
    die('backup integrity check failed; nothing was changed', {
      failed: bad.map(({ target, backup, reason, unverifiable }) => ({ target, backup, reason, unverifiable: Boolean(unverifiable) })),
      next: bad.some((b) => b.unverifiable) ? 'A legacy backup has no recorded digest. Inspect it manually; only then re-run with --accept-unverified-backup.' : 'Do not restore a corrupted backup. Keep the current version or reinstall from source.',
    }, 6);
  }

  // Transaction across all targets: register before the first mutation, record the phase, revert everything on failure.
  const stamp = Date.now();
  const txn = [];
  try {
    for (const { t, list } of plans) {
      const latest = list[list.length - 1];
      const e = { target: t, dest: path.join(dirs[t], NAME), backup: latest.full, displaced: path.join(dirs[t], `.${NAME}.rolledback-${stamp}`), phase: 'registered' };
      txn.push(e);
      if (fs.existsSync(e.dest)) { fs.renameSync(e.dest, e.displaced); e.phase = 'displaced'; } else e.displaced = null;
      fs.renameSync(e.backup, e.dest);
      e.phase = 'restored';
    }
  } catch (err) {
    const revertFailures = [];
    for (const e of [...txn].reverse()) {
      try {
        if (e.phase === 'restored') fs.renameSync(e.dest, e.backup);           // put the backup back where it was
        if (e.displaced && fs.existsSync(e.displaced)) fs.renameSync(e.displaced, e.dest); // and the current version back in place
      } catch (re) { revertFailures.push({ target: e.target, error: re.message, backup: e.backup, displaced: e.displaced }); }
    }
    const after = targets.map((t) => { const m = readMeta(path.join(dirs[t], NAME)); return { target: t, present: fs.existsSync(path.join(dirs[t], NAME, 'SKILL.md')), version: m?.version ?? null }; });
    die(revertFailures.length ? 'rollback failed AND revert failed for some targets; backups and displaced copies were kept' : 'rollback failed; every target was returned to its version before the rollback',
      { operation: 'rollback', cause: err.message, revertFailures, after }, 4);
  }
  for (const e of txn) {
    try { fs.rmSync(`${e.backup}.meta.json`, { force: true }); } catch { /* ignore */ }
    try { if (fs.statSync(path.join(e.dest, '.backup.json')).isFile()) fs.rmSync(path.join(e.dest, '.backup.json')); } catch { /* legacy rc.2 only */ }
  }
  out({ ok: true, restored: txn.map((e) => ({ target: e.target, from: e.backup, displacedTo: e.displaced, version: readMeta(e.dest)?.version ?? 'unversioned', verifiedBy: checks.find((c) => c.target === e.target)?.method ?? 'accepted-unverified' })) });
  process.exit(0);
}

if (cmd !== 'install') die(`unknown command: ${cmd}`);

// ----------------------------------------------------------------- install ----
const plugins = findPluginCopies();
if (plugins.length && !flag('plugin-handled')) {
  die('a plugin-provided project-setup is installed; two active skills with the same name are ambiguous', {
    plugins,
    next: [
      'Do NOT delete the plugin (it may ship other skills such as pr-review/audit).',
      'In Claude Code run /plugin and check what that plugin contains.',
      'If it only provides project-setup: disable it. If it bundles other skills: hide just this skill (references/claude.md "Retiring v1").',
      'Re-run with --plugin-handled once done.',
    ],
  }, 2);
}

// 1) Preflight every target. Nothing changes unless every target can proceed.
const states = targets.map(state);
const blocked = [];
for (const s of states) {
  if (s.kind === 'symlink') blocked.push({ target: s.target, path: s.dest, reason: 'installed path is a symlink/junction; remove it or install elsewhere' });
  if (s.kind === 'locally-modified') blocked.push({ target: s.target, path: s.dest, reason: `installed copy was edited locally${s.extra ? ` (unexpected entries: ${s.extra.join(', ')})` : ''}; move edits to the source repo, or remove the copy` });
  if (s.kind === 'unversioned' && !flag('replace-unversioned')) blocked.push({ target: s.target, path: s.dest, reason: 'existing copy has no install metadata (v1 or hand-installed). It will be backed up and replaced only with --replace-unversioned.' });
}
const plan = states.map((s) => ({ ...s, action: s.kind === 'current' ? 'unchanged' : s.kind === 'absent' ? 'install' : 'replace' }));
if (blocked.length) { out({ ok: false, error: 'blocked; nothing was changed', blocked, plan: plan.map(({ target, dest, kind, action }) => ({ target, path: dest, state: kind, action })) }); process.exit(3); }
if (flag('dry-run')) { out({ ok: true, dryRun: true, sourceVersion: version, plan: plan.map(({ target, dest, kind, version: v, action }) => ({ target, path: dest, state: kind, from: v ?? null, action })) }); process.exit(0); }

// 2) Stage and verify every copy.
const work = plan.filter((p) => p.action !== 'unchanged');
const staged = [];
const cleanupStaged = () => staged.forEach((s) => fs.rmSync(s.tmp, { recursive: true, force: true }));
try {
  for (const p of work) {
    fs.mkdirSync(dirs[p.target], { recursive: true });
    const tmp = path.join(dirs[p.target], `.${NAME}.tmp-${process.pid}-${Date.now()}`);
    for (const rel of listFiles(SRC)) {
      const to = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(SRC, rel), to);
    }
    const h = treeHash(tmp);
    if (h !== srcHash) throw new Error(`copy verification failed for ${p.target}`);
    fs.writeFileSync(path.join(tmp, '.installed.json'), JSON.stringify({ name: NAME, version, treeSha256: h, source: SRC, installedAt: new Date().toISOString() }, null, 2) + '\n');
    staged.push({ ...p, tmp });
  }
} catch (e) { cleanupStaged(); die(`staging failed; nothing was changed: ${e.message}`, {}, 4); }

// 3) Switch all targets as one transaction.
// Each target is registered in the journal BEFORE its first mutation and records how far it got, so any
// failure (rename, metadata write, install rename) reverts that target and every target switched before it.
// PROJECT_SETUP_TEST_FAILPOINT=<target>:<phase> injects a failure (tests only; unset in normal use).
const failpoint = process.env.PROJECT_SETUP_TEST_FAILPOINT || '';
const maybeFail = (target, phase) => { if (failpoint === `${target}:${phase}`) throw new Error(`injected failure at ${target}:${phase} (test only)`); };
const txn = [];
try {
  for (const s of staged) {
    const e = { target: s.target, dest: s.dest, tmp: s.tmp, backup: null, metaFile: null, phase: 'registered' };
    txn.push(e);
    maybeFail(s.target, 'before-backup');
    if (fs.existsSync(s.dest)) {
      const backup = path.join(dirs[s.target], `.${NAME}.bak-${String(s.version ?? 'unversioned').replace(/[^\w.-]/g, '_')}-${Date.now()}`);
      fs.renameSync(s.dest, backup);
      e.backup = backup; e.phase = 'old-moved';
      maybeFail(s.target, 'metadata');
      // Metadata lives NEXT TO the backup, never inside a directory whose contents we did not create.
      const metaFile = `${backup}.meta.json`;
      // Digest of the copy exactly as it was moved aside (preflight already established its state).
      const snap = snapshot(backup);
      fs.writeFileSync(metaFile, JSON.stringify({ backedUpAt: new Date().toISOString(), replacedBy: version, from: s.version ?? 'unversioned', snapshot: snap }, null, 2) + '\n', { flag: 'wx' });
      e.metaFile = metaFile; e.phase = 'meta-written';
    }
    maybeFail(s.target, 'install');
    fs.renameSync(s.tmp, s.dest);
    e.phase = 'installed';
  }
} catch (err) {
  const reverted = []; const revertFailures = [];
  for (const e of [...txn].reverse()) {
    try {
      if (e.phase === 'installed') fs.rmSync(e.dest, { recursive: true, force: true });
      if (e.backup) {
        if (fs.existsSync(e.dest)) throw new Error(`refusing to overwrite ${e.dest} while restoring`);
        fs.renameSync(e.backup, e.dest);
      }
      if (e.metaFile) fs.rmSync(e.metaFile, { force: true });
      reverted.push(e.target);
    } catch (re) { revertFailures.push({ target: e.target, error: re.message, backup: e.backup }); }
  }
  cleanupStaged();
  // Report the real end state of every target, not what we hoped for.
  const after = targets.map((t) => { const st = state(t); return { target: t, state: st.kind, version: st.version ?? null }; });
  die(revertFailures.length ? 'switch failed AND revert failed for some targets; see backups' : 'switch failed; all switched targets were restored',
    { cause: err.message, reverted, revertFailures, after }, 4);
}
const switched = txn;

out({
  ok: true,
  sourceVersion: version,
  results: plan.map((p) => ({ target: p.target, path: p.dest, action: p.action, from: p.version ?? (p.kind === 'unversioned' ? 'unversioned' : null), to: version, backup: switched.find((s) => s.target === p.target)?.backup ?? null })),
  next: [
    'Claude Code: start a new session and confirm only one project-setup appears.',
    'Codex: start a new session and ask which skills are available; confirm project-setup comes from the expected directory (else re-run with --codex-dir).',
    'If a tool lists two copies, remove or hide the extra one before using the skill.',
  ],
});
