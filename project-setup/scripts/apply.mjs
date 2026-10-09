#!/usr/bin/env node
// The ONLY component that writes into the project tree.
//
// Run layout (.ai/.run/<run-id>/, self-gitignored, every segment a real directory inside the repo):
//   drafts/<repo-rel>        agent-authored content (docs, wrappers, instruction files)
//   vault/files/<repo-rel>   script-produced env templates only (.env.example/.sample/.template)
//   vault/backup/<repo-rel>  pre-apply copies; covered by the secret deny list
//   ownership.json           optional { "<repo-rel>": "full" | "blocks" | "keys" | "merged" }
//   managed-keys.json        optional, written by merge-claude-settings.mjs
//   plan.json                produced by `prepare`; its SHA-256 is what the user approves
//   journal.json             produced by `commit` and `rollback`
//
// Commands:
//   init     --run-id <id>
//   prepare  --run-id <id> --mode <mode> [--agents claude,codex] [--approve-user-content <path,path>]
//   commit   --run-id <id> --approved-plan <planSha256 printed by prepare>
//   status   --run-id <id>
//   rollback --run-id <id>
//   cleanup  --run-id <id> [--confirm-manual-resolution]
//
// Exit codes: 1 usage/error · 2 lock/path safety · 3 plan rejected · 4 drift since prepare (nothing written)
//             5 partial apply (run rollback) · 6 rollback incomplete (backups kept)
//             7 run lifecycle: this run (or another run in the repo) already wrote files / is unresolved
//
// Run lifecycle (a run writes at most once; its journal is never reset):
//   fresh/prepared --commit--> committed | partial
//   committed|partial --rollback--> rolled-back | rollback-incomplete --(fix files, rollback again)--> rolled-back
//   prepare/commit are refused once a journal exists; a retry uses a NEW run id. prepare/commit in any run are also
//   refused while another run in the repo is partial or rollback-incomplete (its entries/backups would be orphaned).
import fs from 'node:fs';
import path from 'node:path';
import {
  parseArgs, repoRoot, git, safeResolve, assertWritable, loadSecretSpec, isSecretPath,
  normalizeText, normalizedHash, rawFileHash, sha256, detectEol, atomicWrite, readJsonFile,
  skillVersion, hostId, toPosix, ok, fail, validateRunId, secureDir, secureDirRel, ENV_TEMPLATE_RE,
  writeInRepo, readInRepo, assertNotLink,
} from './lib.mjs';
import { blockHashes, outsideContent } from './blocks.mjs';

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const root = repoRoot();
if (!root) fail('not inside a git repository');
let runId;
try { runId = validateRunId(args['run-id']); } catch (e) { fail(e.message); }

const spec = loadSecretSpec();
const MANIFEST_REL = '.ai/manifest.json';

// Every path inside the run is re-validated from the repository root at the moment it is used:
// any segment (".ai", ".run", the run dir, drafts, vault, backup, nested dirs) may have been replaced
// by a link or junction after init.
const RUN = ['.ai', '.run', runId];
const RUN_REL = RUN.join('/');
const runSub = (...segs) => secureDir(root, [...RUN, ...segs]);
let runDir;
try {
  if (cmd === 'init') {
    runDir = secureDir(root, RUN, { create: true });
    for (const sub of [['drafts'], ['vault'], ['vault', 'files'], ['vault', 'backup']]) secureDir(root, [...RUN, ...sub], { create: true });
    // Self-ignoring: the run dir can never be committed, even before .gitignore is updated.
    writeInRepo(root, '.ai/.run/.gitignore', '*\n');
  } else {
    runDir = secureDir(root, RUN);
    if (!runDir) fail(`run ${runId} does not exist; run init first`);
  }
} catch (e) { fail(e.message, 2); }

const draftsDir = path.join(runDir, 'drafts');
const vaultFiles = path.join(runDir, 'vault', 'files');
const planPath = path.join(runDir, 'plan.json');
const journalPath = path.join(runDir, 'journal.json');
const PLAN_REL = `${RUN_REL}/plan.json`;
const JOURNAL_REL = `${RUN_REL}/journal.json`;
const backupRel = (target) => `${RUN_REL}/vault/backup/${target}`;

/** State of a run from its journal (null = no journal yet). */
function runState(journal) {
  if (!journal) return 'fresh';
  if (journal.rollback) {
    if (journal.rollback.inProgress) return 'rollback-in-progress'; // interrupted or failed mid-way: unresolved
    return journal.rollback.complete ? 'rolled-back' : 'rollback-incomplete';
  }
  if (journal.committed) return 'committed';
  return (journal.entries || []).some((e) => e.state === 'applied' || e.state === 'backed-up') ? 'partial' : 'aborted-before-write';
}
function loadJournalOf(id) {
  try { return JSON.parse(readInRepo(root, `.ai/.run/${id}/journal.json`).toString('utf8')); } catch (e) {
    if (e.code === 'ENOENT' || /directory missing/.test(e.message)) return null;
    fail(`cannot read journal of run ${id}: ${e.message}`, 2);
  }
}
/** Refuse to (re)write when this run already has a journal, or any run in the repo is unresolved. */
function assertWritableLifecycle(action) {
  const own = loadJournalOf(runId);
  const ownState = runState(own);
  if (own) {
    const next = {
      committed: 'This run already wrote its changes. To change more, start a NEW run id; to undo, run rollback.',
      partial: 'This run was partially applied. Run `apply.mjs rollback` first; then retry with a NEW run id.',
      'rollback-in-progress': 'A rollback was interrupted or failed mid-way. Run rollback again (it resumes), or resolve with the user and cleanup --confirm-manual-resolution; then retry with a NEW run id.',
      'rollback-incomplete': 'Rollback left files unresolved. Resolve them with the user and run rollback again (or cleanup --confirm-manual-resolution); then retry with a NEW run id.',
      'rolled-back': 'This run was rolled back. Retry with a NEW run id (its journal and backups are kept as history).',
      'aborted-before-write': 'This run has a journal from an aborted commit. Retry with a NEW run id.',
    }[ownState];
    fail(`${action} refused: run ${runId} is ${ownState}; its journal is never reset`, 7, { state: ownState, next });
  }
  let others = [];
  try { const d = secureDir(root, ['.ai', '.run']); others = d ? fs.readdirSync(d, { withFileTypes: true }).filter((x) => x.isDirectory() && x.name !== runId).map((x) => x.name) : []; } catch (e) { fail(e.message, 2); }
  const unresolved = others
    .map((id) => { let j = null; try { validateRunId(id); j = loadJournalOf(id); } catch { return null; } return { runId: id, state: runState(j) }; })
    .filter((r) => r && (r.state === 'partial' || r.state === 'rollback-incomplete' || r.state === 'rollback-in-progress'));
  if (unresolved.length) {
    fail(`${action} refused: another run left the repository unresolved`, 7, { unresolved, next: 'Run `apply.mjs rollback --run-id <that run>` (repeat after resolving skipped files) or, with the user, `cleanup --confirm-manual-resolution`.' });
  }
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) fail(`link inside run directory rejected: ${toPosix(path.relative(root, full))}`, 2);
      if (e.isDirectory()) stack.push(full); else out.push(full);
    }
  }
  return out;
}

const saveRunJson = (rel, obj) => writeInRepo(root, rel, JSON.stringify(obj, null, 2) + '\n', { createDirs: false });
const fileSha = (p) => sha256(fs.readFileSync(p));
const runFileSha = (name) => { try { return sha256(readInRepo(root, `${RUN_REL}/${name}`)); } catch (e) { if (/ENOENT|missing/.test(e.message) || e.code === 'ENOENT') return null; throw e; } };
const OWNERSHIP_VALUES = new Set(['full', 'blocks', 'keys', 'merged']);
const lineCount = (text) => (text == null ? 0 : normalizeText(text).split('\n').length - 1);
const withEol = (buf, eol) => {
  const n = normalizeText(buf.toString('utf8'));
  return Buffer.from(eol === '\r\n' ? n.replace(/\n/g, '\r\n') : n, 'utf8');
};

function requireLock() {
  let lockDir;
  try { lockDir = secureDir(root, ['.ai', '.setup.lock']); } catch (e) { fail(e.message, 2); }
  const owner = (() => { try { return readJsonFile(path.join(lockDir, 'owner.json')); } catch { return null; } })();
  if (!lockDir || !owner || owner.runId !== runId) fail('lock is not held by this run; run lock.mjs acquire first', 2, { owner });
  owner.heartbeatAt = new Date().toISOString();
  writeInRepo(root, '.ai/.setup.lock/owner.json', JSON.stringify(owner, null, 2) + '\n', { createDirs: false });
}

function dirtyPaths() {
  const r = git(['status', '--porcelain=v1', '-z'], root);
  return new Set(r.stdout.split('\0').filter(Boolean).map((l) => l.slice(3)));
}

function loadManifest() {
  const p = path.join(root, MANIFEST_REL);
  if (!fs.existsSync(p)) return null;
  try { return readJsonFile(p); } catch (e) { fail(`.ai/manifest.json is not valid JSON: ${e.message}`, 3); }
}

/** Ensure the target's parent directories are real directories inside the repo, creating them if needed. */
function ensureParent(rel) {
  const dir = path.posix.dirname(rel);
  if (dir !== '.') secureDirRel(root, dir, { create: true });
}


// ---------------------------------------------------------------- user-content rules
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const trimTrailingBlank = (lines) => { const out = [...lines]; while (out.length && out[out.length - 1] === '') out.pop(); return out; };

/** null if the draft only adds new managed blocks to the current text; otherwise the reason. */
function onlyAddsBlocks(curText, draftText) {
  const cur = outsideContent(curText);
  const nxt = outsideContent(draftText);
  if (cur.errors.length) return `current file has broken markers: ${cur.errors.join('; ')}`;
  if (nxt.errors.length) return `draft has broken markers: ${nxt.errors.join('; ')}`;
  if (cur.ids.some((id) => !nxt.ids.includes(id))) return 'draft removes a managed block';
  if (!sameJson(nxt.ids.filter((id) => cur.ids.includes(id)), cur.ids)) return 'draft reorders managed blocks';
  const added = new Set(nxt.ids.filter((id) => !cur.ids.includes(id)));
  const kept = [];
  for (const line of normalizeText(nxt.outside).split('\n')) {
    const m = line.match(/^<<project-setup block (.+)>>$/);
    if (m && added.has(m[1])) { if (kept.length && kept[kept.length - 1] === '') kept.pop(); continue; }
    kept.push(line);
  }
  const before = trimTrailingBlank(normalizeText(cur.outside).split('\n'));
  return sameJson(trimTrailingBlank(kept), before) ? null : 'draft changes content outside managed blocks';
}

/** null if the settings draft keeps every user key/value and only appends to permissions.allow/deny. */
function settingsPreserved(curText, draftText) {
  let cur; let nxt;
  try { cur = JSON.parse(curText.replace(/^\uFEFF/, '')); } catch { return 'current .claude/settings.json is not valid JSON'; }
  try { nxt = JSON.parse(draftText.replace(/^\uFEFF/, '')); } catch { return 'draft .claude/settings.json is not valid JSON'; }
  if (!isPlainObj(cur) || !isPlainObj(nxt)) return 'settings root must be an object';
  for (const k of new Set([...Object.keys(cur), ...Object.keys(nxt)])) {
    if (k === 'permissions') continue;
    if (k === '$schema' && !('$schema' in cur)) continue; // the merge may add $schema to a file that had none
    if (!sameJson(cur[k], nxt[k])) return `draft changes user settings key "${k}"`;
  }
  // A present-but-malformed value is still the user's content: replacing or "repairing" it needs approval.
  if ('permissions' in cur && !isPlainObj(cur.permissions)) {
    return sameJson(cur.permissions, nxt.permissions) ? null : 'draft replaces a malformed user permissions value';
  }
  if ('permissions' in nxt && !isPlainObj(nxt.permissions)) return 'draft permissions value is not an object';
  const cp = isPlainObj(cur.permissions) ? cur.permissions : {};
  const np = isPlainObj(nxt.permissions) ? nxt.permissions : {};
  for (const k of new Set([...Object.keys(cp), ...Object.keys(np)])) {
    if (k === 'allow' || k === 'deny') {
      if (k in cp && !Array.isArray(cp[k])) {
        if (!sameJson(cp[k], np[k])) return `draft replaces a malformed user permissions.${k} value`;
        continue;
      }
      if (k in np && !Array.isArray(np[k])) return `draft permissions.${k} is not an array`;
      const a = cp[k] ?? []; const b = np[k] ?? [];
      if (!sameJson(b.slice(0, a.length), a)) return `draft removes or reorders existing permissions.${k} entries`;
    } else if (!sameJson(cp[k], np[k])) return `draft changes permissions.${k}`;
  }
  return null;
}

// ------------------------------------------------------------------ init ----
if (cmd === 'init') {
  ok({ runDir: toPosix(path.relative(root, runDir)), drafts: toPosix(path.relative(root, draftsDir)) });
}

// --------------------------------------------------------------- prepare ----
else if (cmd === 'prepare') {
  assertWritableLifecycle('prepare');
  const mode = args.mode && args.mode !== true ? String(args.mode) : fail('--mode is required');
  const agents = String(args.agents || 'claude,codex').split(',').map((s) => s.trim()).filter(Boolean);
  const approved = new Set(String(args['approve-user-content'] && args['approve-user-content'] !== true ? args['approve-user-content'] : '')
    .split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean));
  const manifest = loadManifest();
  const dirty = dirtyPaths();
  const ops = [];
  const errors = [];
  let dDir, vDir;
  try { dDir = runSub('drafts'); vDir = runSub('vault', 'files'); } catch (e) { fail(e.message, 2); }
  const sources = [
    ...(dDir ? walk(dDir).map((f) => ({ f, base: dDir, origin: 'draft' })) : []),
    ...(vDir ? walk(vDir).map((f) => ({ f, base: vDir, origin: 'vault' })) : []),
  ];
  const seenTargets = new Set();
  for (const { f, base, origin } of sources) {
    const rel = toPosix(path.relative(base, f));
    try {
      if (seenTargets.has(rel)) throw new Error('target appears in both drafts and vault');
      seenTargets.add(rel);
      if (rel === MANIFEST_REL) throw new Error('the manifest is written by commit, not drafted');
      assertWritable(rel);
      const { abs } = safeResolve(root, rel);
      if (origin === 'draft' && isSecretPath(rel, spec)) throw new Error('agent drafts may not target secret-pattern paths');
      // The vault exists for env templates produced by env-keys.mjs. Nothing else may come from it.
      if (origin === 'vault' && !ENV_TEMPLATE_RE.test(rel)) throw new Error('vault files may only target .env.example/.env.sample/.env.template');
      const exists = fs.existsSync(abs);
      if (exists && !fs.lstatSync(abs).isFile()) throw new Error('target is not a regular file');
      const secret = isSecretPath(rel, spec);
      const currentBuf = exists ? fs.readFileSync(abs) : null;
      const current = currentBuf && !secret ? currentBuf.toString('utf8') : null;
      const draftBuf = fs.readFileSync(f);
      const draft = draftBuf.toString('utf8');
      const unchanged = exists && normalizeText(currentBuf) === normalizeText(draftBuf);
      if (unchanged) { ops.push({ target: rel, action: 'unchanged' }); continue; }

      // User content protection. Anything the skill does not own may only GAIN new managed blocks; every other
      // change to it (including replacing a pre-existing file) needs the user's explicit --approve-user-content.
      const entry = manifest?.files?.[rel];
      const reasons = [];
      if (currentBuf !== null) {
        const curText = currentBuf.toString('utf8'); // in-process only; never printed (secret paths included)
        if (rel === '.claude/settings.json') {
          const why = settingsPreserved(curText, draft);
          if (why) reasons.push(why);
        } else if (entry?.ownership === 'full') {
          if (normalizedHash(curText) !== entry.sha256) reasons.push('fully managed file was edited by the user since install');
        } else if (entry?.ownership === 'merged' && !outsideContent(curText).ids.length) {
          // Living doc the skill created or already merged: reviewed through the plan diff.
        } else {
          const why = onlyAddsBlocks(curText, draft);
          if (why) reasons.push(entry ? why : `${why} (pre-existing file the skill does not own)`);
        }
      }
      const userContentChange = reasons.length > 0;
      if (userContentChange && !approved.has(rel)) {
        throw new Error(`${reasons.join('; ')}. Show the diff; re-run prepare with --approve-user-content ${rel} only after the user approves it`);
      }

      ops.push({
        target: rel,
        origin,
        source: toPosix(path.relative(runDir, f)),
        sourceSha256: sha256(draftBuf),
        action: exists ? 'modify' : 'create',
        preRawSha: rawFileHash(abs),
        eol: exists ? detectEol(currentBuf.toString('utf8')) : '\n',
        linesBefore: current !== null ? lineCount(current) : null,
        linesAfter: origin === 'vault' ? null : lineCount(draft),
        uncommittedUserChanges: dirty.has(rel),
        userContentChange,
        userContentReasons: reasons,
      });
    } catch (e) {
      errors.push({ target: rel, error: e.message });
    }
  }
  // Manifest metadata produced in the run dir is part of what the user approves: validate it and embed it.
  const readMeta = (name) => {
    let buf;
    try { buf = readInRepo(root, `${RUN_REL}/${name}`); } catch (e) { if (e.code === 'ENOENT') return { sha: null, data: null }; errors.push({ target: name, error: e.message }); return { sha: null, data: null }; }
    try { return { sha: sha256(buf), data: JSON.parse(buf.toString('utf8')) }; } catch (e) { errors.push({ target: name, error: `invalid JSON: ${e.message}` }); return { sha: null, data: null }; }
  };
  const ownershipMeta = readMeta('ownership.json');
  const keysMeta = readMeta('managed-keys.json');
  // Every drafted target counts, including ones rejected above, so one rejection never cascades into misleading errors.
  const known = new Set([...seenTargets, ...Object.keys(manifest?.files || {})]);
  if (ownershipMeta.data !== null) {
    if (typeof ownershipMeta.data !== 'object' || Array.isArray(ownershipMeta.data)) errors.push({ target: 'ownership.json', error: 'must be an object' });
    else for (const [t, v] of Object.entries(ownershipMeta.data)) {
      if (!OWNERSHIP_VALUES.has(v)) errors.push({ target: 'ownership.json', error: `${t}: invalid ownership "${v}"` });
      else if (!known.has(t)) errors.push({ target: 'ownership.json', error: `${t}: not a target of this plan or the manifest` });
      else if (v === 'keys' && t !== '.claude/settings.json') errors.push({ target: 'ownership.json', error: `${t}: "keys" ownership is only valid for .claude/settings.json` });
    }
  }
  if (keysMeta.data !== null) {
    const d = keysMeta.data;
    const okShape = d && typeof d === 'object' && !Array.isArray(d) && Object.entries(d).every(([t, v]) => t === '.claude/settings.json' && v && typeof v === 'object'
      && Object.values(v).every((arr) => Array.isArray(arr) && arr.every((x) => typeof x === 'string')));
    if (!okShape) errors.push({ target: 'managed-keys.json', error: 'must map ".claude/settings.json" to arrays of rule strings' });
  }
  const unknownApprovals = [...approved].filter((a) => !ops.some((o) => o.target === a && o.userContentChange));
  if (unknownApprovals.length) errors.push({ target: unknownApprovals.join(','), error: '--approve-user-content names files that do not need it; refusing broad approvals' });
  if (errors.length) fail('plan rejected', 3, { errors });
  const plan = {
    runId, mode, agents, skillVersion: skillVersion(), host: hostId(),
    preparedAt: new Date().toISOString(),
    head: git(['rev-parse', '--short', 'HEAD'], root).stdout || null,
    manifestPreRawSha: rawFileHash(path.join(root, MANIFEST_REL)),
    metadata: {
      ownershipSha256: ownershipMeta.sha, ownership: ownershipMeta.data,
      managedKeysSha256: keysMeta.sha, managedKeys: keysMeta.data,
    },
    ops,
  };
  saveRunJson(PLAN_REL, plan);
  const changed = ops.filter((o) => o.action !== 'unchanged');
  ok({
    plan: toPosix(path.relative(root, planPath)),
    planSha256: sha256(readInRepo(root, PLAN_REL)),
    changed: changed.length,
    unchanged: ops.length - changed.length,
    ops: changed.map(({ target, action, origin, linesBefore, linesAfter, uncommittedUserChanges, userContentChange, userContentReasons }) => ({ target, action, origin, linesBefore, linesAfter, uncommittedUserChanges, userContentChange, userContentReasons })),
    ownershipOverrides: ownershipMeta.data,
    review: 'Show each draft diff (git diff --no-index -- <target> <draft>); vault files: key-level report only. The user approves this planSha256; pass it to commit --approved-plan.',
  });
}

// ---------------------------------------------------------------- commit ----
else if (cmd === 'commit') {
  requireLock();
  assertWritableLifecycle('commit'); // before any other check: a used run never commits again
  if (!fs.existsSync(planPath)) fail('no plan.json; run prepare first');
  const approvedSha = args['approved-plan'] && args['approved-plan'] !== true ? String(args['approved-plan']) : fail('--approved-plan <planSha256 from prepare> is required');
  let planBuf;
  try { planBuf = readInRepo(root, PLAN_REL); } catch (e) { fail(e.message, 2); }
  if (sha256(planBuf) !== approvedSha) fail('plan.json differs from the approved plan; re-run prepare and get approval again', 4);
  const plan = JSON.parse(planBuf.toString('utf8'));
  if (plan.runId !== runId) fail('plan belongs to another run', 4);
  const ops = plan.ops.filter((o) => o.action !== 'unchanged');
  if (!ops.length) { ok({ committed: false, reason: 'nothing to change (zero diff)' }); process.exit(0); }

  // 0) Every run directory must still be a real directory inside the repo before anything is written.
  //    (Each individual read/write re-validates again at the moment it happens.)
  try {
    for (const sub of [['drafts'], ['vault'], ['vault', 'backup']]) {
      if (!runSub(...sub)) throw new Error(`run directory missing: ${[...RUN, ...sub].join('/')}`);
    }
  } catch (e) { fail(`unsafe run directory; nothing was written: ${e.message}`, 2); }

  // 1) Re-verify every precondition before writing anything: targets, approved draft bytes, manifest.
  const drift = [];
  for (const op of ops) {
    const { abs } = safeResolve(root, op.target);
    if (rawFileHash(abs) !== op.preRawSha) drift.push({ target: op.target, what: 'target changed since prepare' });
    let srcSha = null;
    try { srcSha = sha256(readInRepo(root, `${RUN_REL}/${op.source}`)); } catch (e) { drift.push({ target: op.target, what: `approved draft unreadable: ${e.message}` }); continue; }
    if (srcSha !== op.sourceSha256) drift.push({ target: op.target, what: 'draft changed after prepare (unreviewed content)' });
  }
  // Ownership metadata is covered by the approval too: presence and bytes must be what prepare saw.
  const md = plan.metadata || {};
  for (const [name, sha] of [['ownership.json', md.ownershipSha256 ?? null], ['managed-keys.json', md.managedKeysSha256 ?? null]]) {
    let now;
    try { now = runFileSha(name); } catch (e) { drift.push({ target: name, what: e.message }); continue; }
    if (now !== sha) drift.push({ target: name, what: 'manifest metadata changed after prepare (unreviewed ownership)' });
  }
  if (rawFileHash(path.join(root, MANIFEST_REL)) !== plan.manifestPreRawSha) drift.push({ target: MANIFEST_REL, what: 'manifest changed since prepare' });
  if (drift.length) fail('changes since prepare; nothing was written. Re-run prepare and get approval again.', 4, { drift });

  // 2) Apply with backup + journal; manifest last.
  const journal = { runId, planSha256: approvedSha, startedAt: new Date().toISOString(), committed: false, entries: [] };
  if (loadJournalOf(runId)) fail('journal appeared during commit; refusing to reset it', 7);
  saveRunJson(JOURNAL_REL, journal);
  const apply = (target, outBuf) => {
    const { abs } = safeResolve(root, target);
    ensureParent(target);
    assertNotLink(abs);
    const existed = fs.existsSync(abs);
    const entry = { target, existed, preRawSha: rawFileHash(abs), expectedWriteSha: sha256(outBuf), state: 'planned' };
    if (existed) {
      // Backup path validated from the repo root at the moment of writing (vault/backup may be a junction).
      writeInRepo(root, backupRel(target), readInRepo(root, target));
    }
    entry.state = 'backed-up';
    journal.entries.push(entry);
    saveRunJson(JOURNAL_REL, journal);
    writeInRepo(root, target, outBuf);
    entry.writtenRawSha = rawFileHash(abs);
    entry.state = 'applied';
    saveRunJson(JOURNAL_REL, journal);
  };
  try {
    for (const op of ops) {
      const src = readInRepo(root, `${RUN_REL}/${op.source}`);
      if (sha256(src) !== op.sourceSha256) throw new Error(`draft for ${op.target} changed during commit`);
      apply(op.target, withEol(src, op.eol));
    }

    // 3) Manifest: merge previous entries with this run's results.
    const prev = loadManifest();
    // Only the metadata embedded in the approved plan is used, never the run-dir files directly.
    const ownership = md.ownership || {};
    const managedKeys = md.managedKeys || {};
    const files = { ...(prev?.files || {}) };
    for (const op of plan.ops) {
      const { abs } = safeResolve(root, op.target);
      if (!fs.existsSync(abs)) continue;
      if (op.action === 'unchanged' && prev?.files?.[op.target]) continue;
      if (isSecretPath(op.target, spec)) { files[op.target] = { ownership: 'merged', note: 'secret-pattern path; content never hashed into reports' }; continue; }
      const text = fs.readFileSync(abs, 'utf8');
      const hasBlocks = Object.keys(blockHashes(text).hashes).length > 0;
      const living = /^(docs\/|\.ai\/context\/|\.ai\/decisions\/)/.test(op.target) || op.target === 'TODO.md' || op.target === 'README.md';
      const own = ownership[op.target]
        || (living && !hasBlocks ? 'merged' : null)
        || (hasBlocks ? 'blocks'
          : (op.action === 'create' || prev?.files?.[op.target]?.ownership === 'full') ? 'full' : 'merged');
      if (own === 'blocks') files[op.target] = { ownership: 'blocks', blocks: blockHashes(text).hashes };
      else if (own === 'keys') files[op.target] = { ownership: 'keys', managed: managedKeys[op.target] || {} };
      else if (own === 'merged') files[op.target] = { ownership: 'merged' };
      else files[op.target] = { ownership: 'full', sha256: normalizedHash(text) };
    }
    const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    const manifest = {
      schema: 2, skill: 'project-setup', skillVersion: plan.skillVersion, mode: plan.mode, agents: plan.agents,
      sourceCommit: plan.head, // only reached when outputs change
      files: sorted,
    };
    apply(MANIFEST_REL, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
    journal.committed = true;
    journal.committedAt = new Date().toISOString();
    saveRunJson(JOURNAL_REL, journal);
    ok({ committed: true, written: journal.entries.map((e) => ({ target: e.target, created: !e.existed })), next: 'run validate.mjs, then report; keep the run dir until the user confirms (rollback needs it)' });
  } catch (e) {
    try { saveRunJson(JOURNAL_REL, journal); } catch { /* journal dir itself unsafe; report below */ }
    fail(`apply failed mid-way: ${e.message}`, 5, { appliedSoFar: journal.entries.filter((x) => x.state === 'applied').map((x) => x.target), recovery: `node apply.mjs rollback --run-id ${runId}` });
  }
}

// -------------------------------------------------------------- rollback ----
else if (cmd === 'rollback') {
  requireLock();
  if (!fs.existsSync(journalPath)) fail('no journal; nothing was applied by this run');
  const journal = JSON.parse(readInRepo(root, JOURNAL_REL).toString('utf8'));
  const prior = journal.rollback;
  // 1) Durably mark recovery as in progress BEFORE the first mutation. If anything later fails, crashes, or cannot
  //    be recorded, the run stays unresolved (state rollback-in-progress) instead of looking committed.
  journal.committed = false;
  journal.rollback = { at: new Date().toISOString(), inProgress: true, complete: false, attempt: (prior?.attempt ?? 0) + 1, restored: [], untouched: [], skipped: [] };
  try { saveRunJson(JOURNAL_REL, journal); } catch (e) { fail(`cannot record rollback start; nothing was changed: ${e.message}`, 6); }
  const rb = journal.rollback;
  const checkpoint = () => saveRunJson(JOURNAL_REL, journal);
  for (const e of [...journal.entries].reverse()) {
    if (e.state === 'rolled-back' || e.state === 'planned') continue;
    try {
      const { abs } = safeResolve(root, e.target);
      const cur = rawFileHash(abs);
      // Which version is on disk decides what to do. Only our own write is ever undone.
      const ours = e.state === 'applied' ? cur === e.writtenRawSha : cur === e.expectedWriteSha;
      if (!ours) {
        if (cur === e.preRawSha) { e.state = 'rolled-back'; rb.untouched.push(e.target); checkpoint(); continue; }
        rb.skipped.push({ target: e.target, reason: 'file changed after this run wrote it (or before the write landed); left untouched, backup kept' });
        continue;
      }
      if (e.existed) {
        let buf;
        try { buf = readInRepo(root, backupRel(e.target)); } catch (err) { rb.skipped.push({ target: e.target, reason: `backup unavailable or unsafe: ${err.message}` }); continue; }
        // The backup must be byte-identical to what was on disk before this run wrote the file.
        if (!e.preRawSha || sha256(buf) !== e.preRawSha) {
          rb.skipped.push({ target: e.target, reason: 'backup does not match the pre-run hash recorded in the journal (altered, truncated, or wrong file); target and backup left untouched' });
          continue;
        }
        writeInRepo(root, e.target, buf);
      } else {
        fs.rmSync(abs);
        for (let d = path.dirname(abs); d.startsWith(root) && d !== root; d = path.dirname(d)) {
          try { fs.rmdirSync(d); } catch { break; }
        }
      }
      e.state = 'rolled-back';
      rb.restored.push(e.target);
    } catch (err) {
      // Per-file I/O failure (rename/write/delete): record it, keep the backup, continue with the others.
      rb.skipped.push({ target: e.target, reason: `I/O error during restore: ${err.code || ''} ${err.message}`.trim() });
      continue;
    }
    // Checkpoint after every restored file. If progress cannot be recorded, stop: the journal still says
    // "in progress", which keeps the run unresolved and makes a later rollback resume safely (hash checks).
    try { checkpoint(); } catch (err) {
      fail(`rollback stopped: cannot record progress (${err.message}); run rollback again`, 6, { restoredSoFar: rb.restored, state: 'rollback-in-progress' });
    }
  }
  rb.inProgress = false;
  rb.complete = rb.skipped.length === 0;
  rb.finishedAt = new Date().toISOString();
  try { saveRunJson(JOURNAL_REL, journal); } catch (err) {
    fail(`rollback finished its file operations but could not record the result (${err.message}); the run stays rollback-in-progress; run rollback again`, 6, { restored: rb.restored, skipped: rb.skipped });
  }
  if (!rb.complete) fail('rollback incomplete: some files could not be restored; they and their backups were left as-is', 6, { restored: rb.restored, untouched: rb.untouched, skipped: rb.skipped });
  ok({ complete: true, restored: rb.restored, untouched: rb.untouched });
}

// ---------------------------------------------------------------- status ----
else if (cmd === 'status') {
  const plan = fs.existsSync(planPath) ? JSON.parse(readInRepo(root, PLAN_REL).toString('utf8')) : null;
  const journal = fs.existsSync(journalPath) ? JSON.parse(readInRepo(root, JOURNAL_REL).toString('utf8')) : null;
  ok({
    runId,
    state: runState(journal),
    prepared: Boolean(plan),
    planSha256: plan ? sha256(readInRepo(root, PLAN_REL)) : null,
    committed: journal?.committed ?? false,
    rolledBack: Boolean(journal?.rollback),
    rollbackComplete: journal?.rollback ? journal.rollback.complete : null,
    rollbackSkipped: journal?.rollback?.skipped ?? [],
    partial: journal ? !journal.committed && !journal.rollback && journal.entries.some((e) => e.state === 'applied' || e.state === 'backed-up') : false,
    entries: journal?.entries.map(({ target, state, existed }) => ({ target, state, existed })) ?? [],
  });
}

// --------------------------------------------------------------- cleanup ----
else if (cmd === 'cleanup') {
  // Backups are the only recovery copy. Delete them only for a run whose outcome is verified (committed and kept,
  // or fully rolled back), or when the user explicitly confirms a manual resolution.
  let journal = null;
  if (fs.existsSync(journalPath)) {
    try { journal = JSON.parse(readInRepo(root, JOURNAL_REL).toString('utf8')); } catch (e) {
      if (!args['confirm-manual-resolution']) fail(`journal unreadable (${e.message}); refusing to delete backups without --confirm-manual-resolution`, 6);
    }
  }
  const state = journal ? runState(journal) : (fs.existsSync(journalPath) ? 'unreadable' : 'fresh');
  const safe = ['fresh', 'committed', 'rolled-back', 'aborted-before-write'].includes(state);
  if (!safe && !args['confirm-manual-resolution']) {
    fail(`run is ${state}; backups are still needed. Run rollback (again), or resolve with the user and re-run cleanup with --confirm-manual-resolution`, 6, { state, skipped: journal?.rollback?.skipped ?? [] });
  }
  fs.rmSync(runDir, { recursive: true, force: true });
  ok({ removed: toPosix(path.relative(root, runDir)), state });
}

else fail('usage: apply.mjs init|prepare|commit|status|rollback|cleanup --run-id <id>');
