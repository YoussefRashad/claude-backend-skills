#!/usr/bin/env node
// Regression + success-path suite for project-setup. Self-contained, zero dependencies.
//   node tests/run-tests.mjs [--keep] [--only <substring>]
// Every fixture lives under a fresh temp directory. HOME/USERPROFILE are redirected there, and git
// global/system config is isolated, so the suite never reads or writes the real user environment.
// Exit code: 0 all passed · 1 at least one failure. Skipped tests are listed and never count as passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-tests-'));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME);
const GITCFG = path.join(TMP, 'gitconfig');
fs.writeFileSync(GITCFG, '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[core]\n\tautocrlf = false\n\thooksPath = ' + path.join(TMP, 'nohooks').replace(/\\/g, '/') + '\n[init]\n\tdefaultBranch = main\n');
const ENV = { ...process.env, HOME, USERPROFILE: HOME, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GITCFG, GIT_TERMINAL_PROMPT: '0' };
for (const k of Object.keys(ENV)) if (/^GIT_(LITERAL|GLOB|NOGLOB|ICASE)_PATHSPECS$|^GIT_DIR$|^GIT_WORK_TREE$/.test(k)) delete ENV[k];

const results = [];
let current = null;
const check = (cond, msg, detail) => { if (!cond) current.failures.push(detail === undefined ? msg : `${msg} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 600)}`); };
const skip = (why) => { current.skipped = why; };

function proc(exe, args, cwd, extraEnv = {}) {
  const r = spawnSync(exe, args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...ENV, ...extraEnv }, timeout: 60000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* not json */ }
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json };
}
const node = (rel, args, cwd, extraEnv) => proc(process.execPath, [path.join(SKILL, rel), ...args], cwd, extraEnv);
const S = (name, args, cwd, extraEnv) => node(`scripts/${name}.mjs`, args, cwd, extraEnv);
const git = (args, cwd) => proc('git', args, cwd);
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const read = (p) => fs.readFileSync(p, 'utf8');
let n = 0;
function repo(files = {}, commit = true) {
  const d = path.join(TMP, `repo-${++n}`);
  fs.mkdirSync(d);
  git(['init', '-q'], d);
  for (const [f, c] of Object.entries(files)) put(path.join(d, f), c);
  if (commit && Object.keys(files).length) { git(['add', '-A'], d); git(['commit', '-qm', 'init'], d); }
  return d;
}
function begin(d, id = 'run-0001') {
  const a = S('lock', ['acquire', '--run-id', id], d); const b = S('apply', ['init', '--run-id', id], d);
  if (a.code || b.code) throw new Error(`setup failed: ${a.stdout}${b.stdout}`);
  return path.join(d, '.ai', '.run', id);
}
// Tests that are not about user-content approval play the user who approves the reviewed diff: if prepare asks
// for --approve-user-content (rc.10: pre-existing files the skill does not own), retry once with exactly those files.
// Tests about approval itself pass { strict: true }.
const prepare = (d, id = 'run-0001', extra = [], { strict = false } = {}) => {
  let r = S('apply', ['prepare', '--run-id', id, '--mode', 'fresh', ...extra], d);
  const errs = r.json?.errors || [];
  if (!strict && r.code === 3 && errs.length && errs.every((e) => /--approve-user-content/.test(e.error))) {
    r = S('apply', ['prepare', '--run-id', id, '--mode', 'fresh', ...extra, '--approve-user-content', errs.map((e) => e.target).join(',')], d);
  }
  return r;
};
const commit = (d, prep, id = 'run-0001') => S('apply', ['commit', '--run-id', id, '--approved-plan', prep.json?.planSha256 ?? 'none'], d);
function linkDir(target, link) {
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); return true; } catch { return false; }
}

const tests = [];
const test = (id, name, fn) => tests.push({ id, name, fn });

// ============================================================ regressions ====
test('R01', 'git-safe blocks object forms that bypass pathspec excludes', () => {
  const d = repo({ '.env': 'DUMMY_SECRET=NOT_REAL_1\n', 'safe.txt': 'safe-1\n' });
  put(path.join(d, '.ai', 'security-paths.json'), read(path.join(SKILL, 'data', 'secret-paths.json')));
  const gs = (...a) => node('assets/tools/git-safe.mjs', a, d);
  for (const a of [['show', 'HEAD:.env'], ['show', ':.env'], ['diff', 'HEAD:.env', 'HEAD:safe.txt'], ['log', '-p', 'HEAD:.env']]) {
    const r = gs(...a); check(r.code !== 0 && !r.stdout.includes('DUMMY_SECRET'), `${a.join(' ')} must fail without content`, r);
  }
  const blob = git(['rev-parse', 'HEAD:.env'], d).stdout.trim();
  const tree = git(['rev-parse', 'HEAD^{tree}'], d).stdout.trim();
  for (const obj of [blob, tree]) { const r = gs('show', obj); check(r.code !== 0 && !r.stdout.includes('DUMMY_SECRET'), `show ${obj.slice(0, 8)} (blob/tree) must fail`, r); }
  const ni = gs('diff', '--no-index', '.env', 'safe.txt'); check(ni.code !== 0 && !ni.stdout.includes('DUMMY_SECRET'), '--no-index must be blocked', ni);
  put(path.join(d, '.env'), 'DUMMY_SECRET=NOT_REAL_2\n'); put(path.join(d, 'safe.txt'), 'safe-2\n'); git(['commit', '-qam', 'second'], d);
  const lit = proc(process.execPath, [path.join(SKILL, 'assets/tools/git-safe.mjs'), 'show', 'HEAD'], d, { GIT_LITERAL_PATHSPECS: '1' });
  check(lit.code === 0 && !lit.stdout.includes('DUMMY_SECRET') && lit.stdout.includes('safe-2'), 'GIT_LITERAL_PATHSPECS must not disable excludes', lit);
  const up = gs('show', 'HEAD'); check(up.code === 0 && !up.stdout.includes('DUMMY_SECRET') && up.stdout.includes('safe-2'), 'show HEAD works with secret diff excluded', up);
  const rng = gs('log', '-p', 'HEAD~1..HEAD'); check(rng.code === 0 && !rng.stdout.includes('DUMMY_SECRET'), 'ranges allowed, secret excluded', rng);
  const c = gs('diff', '-c'); check(c.code === 2, '-c stays blocked', c);
});

test('R02', 'commit rejects drafts changed after prepare and unapproved plans', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' });
  const r = begin(d); put(path.join(r, 'drafts', 'TODO.md'), 'APPROVED\n');
  const p = prepare(d); check(p.code === 0 && /^[0-9a-f]{64}$/.test(p.json?.planSha256 || ''), 'prepare prints planSha256', p);
  put(path.join(r, 'drafts', 'TODO.md'), 'UNREVIEWED\n');
  const c = commit(d, p); check(c.code === 4, 'changed draft -> exit 4', c);
  check(read(path.join(d, 'TODO.md')) === 'ORIGINAL\n', 'target untouched');
  put(path.join(r, 'drafts', 'TODO.md'), 'APPROVED\n');
  const noFlag = S('apply', ['commit', '--run-id', 'run-0001'], d); check(noFlag.code !== 0, 'commit without --approved-plan fails', noFlag);
  const plan = JSON.parse(read(path.join(r, 'plan.json'))); plan.ops[0].sourceSha256 = '0'.repeat(64); put(path.join(r, 'plan.json'), JSON.stringify(plan));
  const t = commit(d, p); check(t.code === 4, 'tampered plan -> exit 4', t);
  check(read(path.join(d, 'TODO.md')) === 'ORIGINAL\n', 'target still untouched');
});

test('R03a', 'run ids cannot escape the repository', () => {
  const d = repo({ 'a.txt': 'a\n' });
  put(path.join(d, 'keys.json'), JSON.stringify([{ name: 'DUMMY', secret: true }]));
  for (const bad of ['../../../escaped-env', '..', 'a/b', 'a\\b', '.hidden', 'x']) {
    for (const [script, args] of [['env-keys', ['merge', '--keys', path.join(d, 'keys.json')]], ['apply', ['init']], ['lock', ['acquire']], ['canary', ['setup']], ['merge-claude-settings', []]]) {
      const r = S(script, [...args, '--run-id', bad], d);
      check(r.code !== 0, `${script} rejects run id "${bad}"`, r);
    }
  }
  check(!fs.existsSync(path.join(TMP, 'escaped-env')), 'nothing written outside the repo');
});

test('R03b', 'lock and run dirs refuse junction/symlink redirection of .ai', () => {
  const d = repo({ 'a.txt': 'a\n' });
  const outside = path.join(TMP, `outside-${n}`); fs.mkdirSync(outside);
  if (!linkDir(outside, path.join(d, '.ai'))) return skip('cannot create junction/symlink on this machine');
  const l = S('lock', ['acquire', '--run-id', 'run-0001'], d);
  check(l.code !== 0, 'lock acquire fails', l);
  check(!fs.existsSync(path.join(outside, '.setup.lock')), 'no lock written outside');
  const a = S('apply', ['init', '--run-id', 'run-0001'], d); check(a.code !== 0, 'apply init fails', a);
  check(fs.readdirSync(outside).length === 0, 'outside dir untouched');
  const d2 = repo({ 'a.txt': 'a\n' }); fs.mkdirSync(path.join(d2, '.ai'));
  const out2 = path.join(TMP, `outside-run-${n}`); fs.mkdirSync(out2);
  linkDir(out2, path.join(d2, '.ai', '.run'));
  const b = S('apply', ['init', '--run-id', 'run-0001'], d2); check(b.code !== 0 && fs.readdirSync(out2).length === 0, 'linked .ai/.run rejected', b);
});

test('R04a', 'rollback of a backed-up entry never overwrites a later user edit', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' });
  const r = begin(d);
  put(path.join(r, 'vault', 'backup', 'TODO.md'), 'ORIGINAL\n');
  put(path.join(d, 'TODO.md'), 'USER EDIT AFTER INTERRUPTION\n');
  const sha = (s) => spawnSync(process.execPath, ['-e', `process.stdout.write(require('crypto').createHash('sha256').update(${JSON.stringify(s)}).digest('hex'))`], { encoding: 'utf8' }).stdout;
  put(path.join(r, 'journal.json'), JSON.stringify({ runId: 'run-0001', committed: false, entries: [{ target: 'TODO.md', existed: true, state: 'backed-up', preRawSha: sha('ORIGINAL\n'), expectedWriteSha: sha('NEW\n') }] }));
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 6, 'incomplete rollback exits 6', rb);
  check(read(path.join(d, 'TODO.md')) === 'USER EDIT AFTER INTERRUPTION\n', 'user edit preserved');
  // Same state, but the write had landed and nobody touched it afterwards -> restore.
  put(path.join(d, 'TODO.md'), 'NEW\n');
  put(path.join(r, 'journal.json'), JSON.stringify({ runId: 'run-0001', committed: false, entries: [{ target: 'TODO.md', existed: true, state: 'backed-up', preRawSha: sha('ORIGINAL\n'), expectedWriteSha: sha('NEW\n') }] }));
  const rb2 = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb2.code === 0 && read(path.join(d, 'TODO.md')) === 'ORIGINAL\n', 'our landed write is restored', rb2);
});

test('R04b', 'skipped rollback is reported incomplete and backups are kept', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' });
  const r = begin(d); put(path.join(r, 'drafts', 'TODO.md'), 'APPLIED\n');
  const p = prepare(d); const c = commit(d, p); check(c.code === 0, 'commit ok', c);
  put(path.join(d, 'TODO.md'), 'LATER USER EDIT\n');
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 6 && rb.json?.ok === false && rb.json.skipped?.length === 1, 'rollback reports incomplete', rb);
  check(read(path.join(d, 'TODO.md')) === 'LATER USER EDIT\n', 'user edit preserved');
  const st = S('apply', ['status', '--run-id', 'run-0001'], d);
  check(st.json?.rollbackComplete === false, 'status shows incomplete', st);
  const cl = S('apply', ['cleanup', '--run-id', 'run-0001'], d);
  check(cl.code !== 0 && fs.existsSync(path.join(r, 'vault', 'backup', 'TODO.md')), 'cleanup refuses and keeps backup', cl);
  const cl2 = S('apply', ['cleanup', '--run-id', 'run-0001', '--confirm-manual-resolution'], d);
  check(cl2.code === 0 && !fs.existsSync(r), 'explicit confirmation allows cleanup', cl2);
});

function sourceCopy(ver) {
  const src = path.join(TMP, `src-${++n}`);
  fs.cpSync(SKILL, src, { recursive: true, filter: (p) => !p.includes(`${path.sep}tests${path.sep}`) || !p.includes('fixtures') });
  if (ver) fs.writeFileSync(path.join(src, 'VERSION'), `${ver}\n`);
  return src;
}
const inst = (src, args, extraEnv) => proc(process.execPath, [path.join(src, 'install', 'install.mjs'), ...args], TMP, extraEnv);
const installedVersion = (dir) => { try { return JSON.parse(read(path.join(dir, 'project-setup', '.installed.json'))).version; } catch { return null; } };

test('R05', 'installer never leaves targets on different versions', () => {
  const src = sourceCopy('9.0.0-a'); const c = path.join(TMP, `c-${n}`), x = path.join(TMP, `x-${n}`);
  const args = ['--claude-dir', c, '--codex-dir', x];
  check(inst(src, args).code === 0, 'initial install');
  fs.appendFileSync(path.join(x, 'project-setup', 'SKILL.md'), '\nUSER MODIFICATION\n');
  fs.writeFileSync(path.join(src, 'VERSION'), '9.0.0-b\n');
  const up = inst(src, args);
  check(up.code === 3 && up.json?.ok === false, 'blocked upgrade exits 3', up);
  check(installedVersion(c) === '9.0.0-a' && installedVersion(x) === '9.0.0-a', 'neither target changed', [installedVersion(c), installedVersion(x)]);
  // Injected switch failure on the second target reverts the first.
  const src2 = sourceCopy('9.1.0-a'); const c2 = path.join(TMP, `c2-${n}`), x2 = path.join(TMP, `x2-${n}`);
  const a2 = ['--claude-dir', c2, '--codex-dir', x2];
  inst(src2, a2); fs.writeFileSync(path.join(src2, 'VERSION'), '9.1.0-b\n');
  const f = inst(src2, a2, { PROJECT_SETUP_TEST_FAILPOINT: 'codex:install' });
  check(f.code === 4, 'switch failure exits 4', f);
  check(installedVersion(c2) === '9.1.0-a' && installedVersion(x2) === '9.1.0-a', 'both targets reverted to previous version', [installedVersion(c2), installedVersion(x2)]);
  check(inst(src2, ['verify', ...a2]).code === 5, 'verify reports mismatch with source after revert');
});

test('R06', 'same-version reinstall detects local edits; verify fails on mismatch', () => {
  const src = sourceCopy(); const x = path.join(TMP, `x-${n}`); const args = ['--targets', 'codex', '--codex-dir', x];
  check(inst(src, args).code === 0, 'install');
  check(inst(src, ['verify', ...args]).code === 0, 'verify ok right after install');
  fs.appendFileSync(path.join(x, 'project-setup', 'SKILL.md'), '\nLOCAL EDIT\n');
  const re = inst(src, args); check(re.code === 3 && re.json?.blocked?.[0]?.target === 'codex', 'reinstall blocked, not "unchanged"', re);
  check(read(path.join(x, 'project-setup', 'SKILL.md')).includes('LOCAL EDIT'), 'local edit not overwritten');
  const v = inst(src, ['verify', ...args]); check(v.code === 5 && v.json?.report?.[0]?.state === 'locally-modified', 'verify exits 5', v);
});

test('R06b', 'existing unversioned (v1) copy is not replaced without explicit consent', () => {
  const src = sourceCopy(); const c = path.join(TMP, `c-${n}`);
  put(path.join(c, 'project-setup', 'SKILL.md'), '---\nname: project-setup\n---\nV1\n');
  const r = inst(src, ['--targets', 'claude', '--claude-dir', c]);
  check(r.code === 3 && read(path.join(c, 'project-setup', 'SKILL.md')).includes('V1'), 'v1 copy untouched without --replace-unversioned', r);
  const r2 = inst(src, ['--targets', 'claude', '--claude-dir', c, '--replace-unversioned']);
  check(r2.code === 0 && fs.readdirSync(c).some((f) => f.startsWith('.project-setup.bak-unversioned-')), 'replaced with a backup when explicitly allowed', r2);
  const rb = inst(src, ['rollback', '--targets', 'claude', '--claude-dir', c]);
  check(rb.code === 0 && read(path.join(c, 'project-setup', 'SKILL.md')).includes('V1'), 'rollback restores v1', rb);
});

test('R07', 'apply preserves content outside managed blocks unless explicitly approved', () => {
  const d = repo({ 'AGENTS.md': 'USER SECTION MUST SURVIVE\n\n<!-- project-setup:begin id=rules -->\nOLD\n<!-- project-setup:end id=rules -->\n' });
  const r = begin(d);
  put(path.join(r, 'drafts', 'AGENTS.md'), '<!-- project-setup:begin id=rules -->\nNEW\n<!-- project-setup:end id=rules -->\n');
  const p = prepare(d, 'run-0001', [], { strict: true }); check(p.code === 3 && JSON.stringify(p.json).includes('outside managed blocks'), 'prepare rejects', p);
  const wrong = prepare(d, 'run-0001', ['--approve-user-content', 'TODO.md'], { strict: true }); check(wrong.code === 3, 'approval for an unrelated file is rejected', wrong);
  const ok2 = prepare(d, 'run-0001', ['--approve-user-content', 'AGENTS.md'], { strict: true });
  check(ok2.code === 0 && ok2.json.ops[0].userContentChange === true, 'explicit approval recorded in plan', ok2);
  // A block-only change passes without approval.
  put(path.join(r, 'drafts', 'AGENTS.md'), 'USER SECTION MUST SURVIVE\n\n<!-- project-setup:begin id=rules -->\nNEW\n<!-- project-setup:end id=rules -->\n');
  const p3 = prepare(d, 'run-0001', [], { strict: true }); check(p3.code === 0 && p3.json.ops[0].userContentChange === false, 'block-only change needs no approval', p3);
  check(commit(d, p3).code === 0 && read(path.join(d, 'AGENTS.md')).startsWith('USER SECTION MUST SURVIVE'), 'committed with user section intact');
});

test('R08', 'vault may only target env templates', () => {
  const d = repo({ 'a.txt': 'a\n' });
  const r = begin(d);
  put(path.join(r, 'vault', 'files', 'docs', 'secrets', 'dummy.key'), 'FAKE\n');
  const p = prepare(d); check(p.code === 3, 'secret path from vault rejected', p);
  check(!fs.existsSync(path.join(d, 'docs', 'secrets', 'dummy.key')), 'not written');
  fs.rmSync(path.join(r, 'vault', 'files', 'docs'), { recursive: true });
  put(path.join(r, 'vault', 'files', 'docs', 'readme.md'), 'x\n');
  check(prepare(d).code === 3, 'non-template vault file rejected');
  fs.rmSync(path.join(r, 'vault', 'files', 'docs'), { recursive: true });
  put(path.join(r, 'vault', 'files', '.env.example'), 'PORT=\n');
  const ok3 = prepare(d); check(ok3.code === 0 && commit(d, ok3).code === 0 && fs.existsSync(path.join(d, '.env.example')), 'env template allowed', ok3);
});

test('R09', 'merge holds back deny rules that would cancel user exceptions', () => {
  const d = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(.env.*)', 'Read(!.env.example)'] } }) });
  begin(d);
  const m = S('merge-claude-settings', ['--run-id', 'run-0001'], d);
  const rep = m.json?.report;
  check(m.code === 0 && m.json.needsDecision === true, 'needsDecision', m);
  check(rep?.conflicts.some((c) => c.rule === 'Read(**/.env.*)'), 'conflict reported for Read(**/.env.*)', rep);
  check(rep?.heldBack.includes('Read(**/.env.*)') && !rep.added.deny.includes('Read(**/.env.*)'), 'rule held back', rep);
  const draft = JSON.parse(read(path.join(d, '.ai', '.run', 'run-0001', 'drafts', '.claude', 'settings.json')));
  check(!draft.permissions.deny.includes('Read(**/.env.*)') && draft.permissions.deny.indexOf('Read(!.env.example)') === 1, 'draft keeps the exception effective', draft.permissions.deny);
  const m2 = S('merge-claude-settings', ['--run-id', 'run-0001', '--override-user-exceptions'], d);
  check(m2.json?.report.added.deny.includes('Read(**/.env.*)'), 'appended only with explicit override', m2);
});

test('R10', 'validator rejects invalid TOML and wrongly typed JSON', () => {
  const sp = read(path.join(SKILL, 'data', 'secret-paths.json'));
  const base = { '.ai/agents/reviewer.md': '# reviewer\n', '.ai/security-paths.json': sp, '.ai/tools/git-safe.mjs': '// x\n', '.gitignore': '.claude/settings.local.json\nCLAUDE.local.md\n' };
  const bad = repo({ ...base, '.claude/settings.json': '{"permissions":{"deny":"NOT_AN_ARRAY"},"hooks":{"PostToolUse":[{"matcher":"Write","command":"x"}]}}\n', '.codex/agents/reviewer.toml': 'name = "reviewer"\ndescription = "x"\ndeveloper_instructions = """\nRead .ai/agents/reviewer.md\n' });
  const v = S('validate', [], bad);
  const fails = (v.json?.results || []).filter((r) => r.level === 'fail').map((r) => r.check);
  check(v.code === 1 && v.json?.ok === false, 'exit 1', v);
  check(fails.includes('toml-syntax') && fails.includes('json-schema'), 'toml-syntax and json-schema failures', fails);
  check(v.json.results.some((r) => /legacy shape/.test(r.detail)), 'legacy hook flagged', v.json.results);
  const good = repo({ ...base, '.claude/settings.json': '{"permissions":{"deny":["Read(**/.env)"]}}\n', '.codex/agents/reviewer.toml': read(path.join(SKILL, 'assets', 'wrappers', 'codex-reviewer.toml')) });
  const g = S('validate', [], good); check(g.code === 0 && g.json?.ok === true, 'valid fixture passes', g.json?.results?.filter((r) => r.level !== 'pass'));
});

test('R11', 'installer rollback restores the newest backup, not the alphabetically last', () => {
  const src = sourceCopy(); const x = path.join(TMP, `x-${n}`);
  put(path.join(x, '.project-setup.bak-2.0.0-rc.9-100', 'VERSION'), 'OLD BACKUP\n');
  put(path.join(x, '.project-setup.bak-2.0.0-rc.10-200', 'VERSION'), 'LATEST BACKUP\n');
  put(path.join(x, 'project-setup', 'VERSION'), 'CURRENT\n');
  // These hand-made backups carry no recorded digest: refused by default (rc.9), ordering checked with explicit acceptance.
  const refused = inst(src, ['rollback', '--targets', 'codex', '--codex-dir', x]);
  check(refused.code === 6 && refused.json?.failed?.[0]?.unverifiable === true && read(path.join(x, 'project-setup', 'VERSION')).trim() === 'CURRENT', 'undigested backup refused, nothing changed', refused);
  const r = inst(src, ['rollback', '--targets', 'codex', '--codex-dir', x, '--accept-unverified-backup']);
  check(r.code === 0 && read(path.join(x, 'project-setup', 'VERSION')).trim() === 'LATEST BACKUP', 'latest restored', r);
  const empty = path.join(TMP, `empty-${n}`); fs.mkdirSync(empty);
  check(inst(src, ['rollback', '--targets', 'codex', '--codex-dir', empty]).code === 6, 'no backup -> exit 6');
});

test('R12', 'canary probe/verify without canaries is INCONCLUSIVE, not ok', () => {
  const d = repo({ 'a.txt': 'a\n' });
  const p = S('canary', ['probe', '--run-id', 'none-yet'], d);
  check(p.code === 3 && p.json?.ok === false && p.json?.verdict === 'INCONCLUSIVE', 'probe exits 3 INCONCLUSIVE', p);
  const v = S('canary', ['verify', '--run-id', 'none-yet', '--observed', 'x'], d);
  check(v.code === 3 && v.json?.verdict === 'INCONCLUSIVE', 'verify exits 3', v);
});

// ======================================================= rc.2 review (R13+) ====
function fileLink(target, link) { try { fs.symlinkSync(target, link, 'file'); return true; } catch { return false; } }
const listAll = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }) : []);

test('R13a', 'commit refuses a vault/backup replaced by a junction after init (nothing written anywhere)', () => {
  const d = repo({ 'TODO.md': 'old\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'new\n');
  const p = prepare(d); check(p.code === 0, 'prepare', p);
  const outside = path.join(TMP, `outside-backup-${n}`); fs.mkdirSync(outside);
  fs.rmdirSync(path.join(r, 'vault', 'backup'));
  if (!linkDir(outside, path.join(r, 'vault', 'backup'))) return skip('cannot create junction/symlink');
  const c = commit(d, p);
  check(c.code === 2, 'commit exits 2', c);
  check(listAll(outside).length === 0, 'nothing written outside the repo', listAll(outside));
  check(read(path.join(d, 'TODO.md')) === 'old\n' && !fs.existsSync(path.join(d, '.ai', 'manifest.json')), 'repo untouched');
});

test('R13b', 'junctions at other run levels are rejected (vault, nested backup dir, drafts)', () => {
  { const d = repo({ 'TODO.md': 'old\n' }); const r = begin(d); put(path.join(r, 'drafts', 'TODO.md'), 'new\n'); const p = prepare(d);
    const out = path.join(TMP, `outside-vault-${n}`); fs.mkdirSync(path.join(out, 'backup'), { recursive: true });
    fs.rmSync(path.join(r, 'vault'), { recursive: true });
    if (!linkDir(out, path.join(r, 'vault'))) return skip('cannot create junction/symlink');
    const c = commit(d, p); check(c.code === 2 && listAll(path.join(out, 'backup')).length === 0, 'vault junction rejected', c); }
  { const d = repo({ 'docs/x.md': 'old\n' }); const r = begin(d); put(path.join(r, 'drafts', 'docs', 'x.md'), 'new\n'); const p = prepare(d);
    const out = path.join(TMP, `outside-nested-${n}`); fs.mkdirSync(out);
    linkDir(out, path.join(r, 'vault', 'backup', 'docs'));
    const c = commit(d, p);
    check(c.code !== 0 && listAll(out).length === 0, 'nested backup junction rejected, nothing written outside', c);
    check(read(path.join(d, 'docs', 'x.md')) === 'old\n', 'target untouched (backup failed before the write)'); }
  { const d = repo({ 'a.txt': 'a\n' }); const r = begin(d);
    const out = path.join(TMP, `outside-drafts-${n}`); put(path.join(out, 'TODO.md'), 'OUTSIDE CONTENT\n');
    fs.rmdirSync(path.join(r, 'drafts')); linkDir(out, path.join(r, 'drafts'));
    const p = prepare(d); check(p.code === 2, 'prepare refuses linked drafts dir', p); }
});

test('R13c', 'rollback refuses to restore from a backup directory replaced by a junction', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'APPLIED\n'); check(commit(d, prepare(d)).code === 0, 'commit');
  const out = path.join(TMP, `outside-restore-${n}`); put(path.join(out, 'TODO.md'), 'ATTACKER CONTENT\n');
  fs.rmSync(path.join(r, 'vault', 'backup'), { recursive: true });
  if (!linkDir(out, path.join(r, 'vault', 'backup'))) return skip('cannot create junction/symlink');
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 6, 'incomplete rollback (exit 6)', rb);
  check(!read(path.join(d, 'TODO.md')).includes('ATTACKER'), 'outside content never restored into the repo');
});

test('R13d', 'a pre-placed backup leaf symlink is never written through', () => {
  const d = repo({ 'TODO.md': 'old\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'new\n'); const p = prepare(d);
  const victim = path.join(TMP, `victim-${n}.txt`); put(victim, 'VICTIM\n');
  if (!fileLink(victim, path.join(r, 'vault', 'backup', 'TODO.md'))) return skip('cannot create file symlink (Windows without Developer Mode)');
  const c = commit(d, p);
  check(c.code !== 0 && read(victim) === 'VICTIM\n', 'pre-placed backup symlink not followed', c);
  check(read(path.join(d, 'TODO.md')) === 'old\n', 'target untouched');
});

test('R14a', 'installer blocks a copy with unexpected entries (the .backup.json directory repro)', () => {
  const src = sourceCopy('8.0.0-a'); const c = path.join(TMP, `c-${n}`), x = path.join(TMP, `x-${n}`); const a = ['--claude-dir', c, '--codex-dir', x];
  check(inst(src, a).code === 0, 'install A');
  fs.mkdirSync(path.join(x, 'project-setup', '.backup.json'));
  fs.writeFileSync(path.join(src, 'VERSION'), '8.0.0-b\n');
  const up = inst(src, a);
  check(up.code === 3 && JSON.stringify(up.json).includes('.backup.json'), 'blocked with the unexpected entry named', up);
  check(installedVersion(c) === '8.0.0-a' && installedVersion(x) === '8.0.0-a', 'both targets still A', [installedVersion(c), installedVersion(x)]);
});

test('R14b', 'installer restores every target when any phase fails (incl. backup metadata write)', () => {
  for (const fp of ['codex:metadata', 'claude:metadata', 'codex:before-backup', 'codex:install', 'claude:install']) {
    const src = sourceCopy('7.0.0-a'); const c = path.join(TMP, `c-${n}`), x = path.join(TMP, `x-${n}`); const a = ['--claude-dir', c, '--codex-dir', x];
    inst(src, a); fs.writeFileSync(path.join(src, 'VERSION'), '7.0.0-b\n');
    const r = inst(src, a, { PROJECT_SETUP_TEST_FAILPOINT: fp });
    check(r.code === 4 && r.json?.revertFailures?.length === 0, `${fp}: exit 4 with clean revert`, r);
    for (const [dir, name] of [[c, 'claude'], [x, 'codex']]) {
      check(fs.existsSync(path.join(dir, 'project-setup', 'SKILL.md')) && installedVersion(dir) === '7.0.0-a', `${fp}: ${name} present on A`, installedVersion(dir));
      const leftovers = fs.readdirSync(dir).filter((f) => f !== 'project-setup');
      check(leftovers.length === 0, `${fp}: ${name} has no leftover tmp/backup/meta`, leftovers);
    }
    check(r.json?.after?.every((t) => t.state === 'other-version'), `${fp}: reported end state is the old version`, r.json?.after);
    check(inst(src, a).code === 0 && installedVersion(c) === '7.0.0-b' && installedVersion(x) === '7.0.0-b', `${fp}: clean retry upgrades both`);
  }
});

test('R15', 'ownership metadata is bound to the approved plan', () => {
  const d = repo({ 'TODO.md': 'old\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'new\n');
  const p = prepare(d);
  put(path.join(r, 'ownership.json'), JSON.stringify({ 'TODO.md': 'full' }));
  const c = commit(d, p);
  check(c.code === 4 && JSON.stringify(c.json).includes('ownership.json'), 'ownership added after prepare -> exit 4', c);
  check(read(path.join(d, 'TODO.md')) === 'old\n', 'nothing written');
  const p2 = prepare(d); check(p2.code === 0 && p2.json.ownershipOverrides?.['TODO.md'] === 'full', 'override shown for review at prepare', p2);
  put(path.join(r, 'managed-keys.json'), JSON.stringify({ '.claude/settings.json': { 'permissions.deny': [] } }));
  check(commit(d, p2).code === 4, 'managed-keys added after prepare -> exit 4');
  fs.rmSync(path.join(r, 'managed-keys.json'));
  const c2 = commit(d, p2); check(c2.code === 0, 'approved metadata commits', c2);
  check(JSON.parse(read(path.join(d, '.ai', 'manifest.json'))).files['TODO.md'].ownership === 'full', 'approved ownership recorded');
  const d2 = repo({ 'TODO.md': 'old\n' }); const r2 = begin(d2); put(path.join(r2, 'drafts', 'TODO.md'), 'new\n');
  put(path.join(r2, 'ownership.json'), JSON.stringify({ 'TODO.md': 'owned-by-me' })); check(prepare(d2).code === 3, 'invalid ownership value rejected at prepare');
  put(path.join(r2, 'ownership.json'), JSON.stringify({ 'src/app.ts': 'full' })); check(prepare(d2).code === 3, 'ownership for a non-target rejected');
  put(path.join(r2, 'ownership.json'), JSON.stringify({ 'TODO.md': 'keys' })); check(prepare(d2).code === 3, '"keys" only valid for .claude/settings.json');
});

test('R16', 'TOML validation matches tomllib on the conformance corpus; invalid escapes fail validate', () => {
  const corpusFile = path.join(SKILL, 'tests', 'fixtures', 'toml-corpus.json');
  const corpus = JSON.parse(read(corpusFile)).cases;
  const probe = path.join(TMP, `toml-probe-${++n}.mjs`);
  fs.writeFileSync(probe, `import { parseToml } from ${JSON.stringify(pathToFileURL(path.join(SKILL, 'scripts', 'toml.mjs')).href)};
import fs from 'node:fs';
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).cases;
process.stdout.write(JSON.stringify(cases.map((c) => { const r = parseToml(c.toml); return r.unsupported.length ? 'unsupported' : r.errors.length ? 'invalid' : 'valid'; })));`);
  const r = proc(process.execPath, [probe, corpusFile], TMP);
  const got = JSON.parse(r.stdout || '[]');
  corpus.forEach((c, i) => check(got[i] === c.expect, `${c.name}: expected ${c.expect}`, got[i]));
  check(corpus.length >= 70, 'corpus size', corpus.length);
  const sp = read(path.join(SKILL, 'data', 'secret-paths.json'));
  const BS = String.fromCharCode(92);
  const d = repo({ '.ai/agents/reviewer.md': '# Reviewer\n', '.ai/security-paths.json': sp, '.ai/tools/git-safe.mjs': '// x\n', '.gitignore': '.claude/settings.local.json\nCLAUDE.local.md\n',
    '.codex/agents/reviewer.toml': `name = "reviewer"\ndescription = "x"\ndeveloper_instructions = """\nRead .ai/agents/reviewer.md ${BS}q\n"""\n` });
  const v = S('validate', [], d);
  check(v.code === 1 && v.json?.ok === false && v.json.results.some((x) => x.check === 'toml-syntax' && /escape/.test(x.detail)), 'GPT repro: \\q fails validate', v.json?.results);
  put(path.join(d, '.codex', 'agents', 'reviewer.toml'), 'name = "reviewer"\ndescription = "x"\ndeveloper_instructions = "Read .ai/agents/reviewer.md"\ncreated = 2026-10-09\n');
  const u = S('validate', [], d); check(u.code === 1 && u.json.results.some((x) => x.check === 'toml-unsupported'), 'unsupported syntax is a failure, not a pass', u.json?.results);
});

test('R17', 'wildcard user exceptions are held back unless provably disjoint', () => {
  for (const exc of ['Read(!*.example)', 'Read(!**/*.example)', 'Read(!.env.?xample)', 'Read(!*)', 'Read(![.]env.example)']) {
    const d = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: [exc] } }) }); begin(d);
    const m = S('merge-claude-settings', ['--run-id', 'run-0001'], d);
    check(m.code === 0 && m.json?.needsDecision === true && m.json.report.heldBack.includes('Read(**/.env.*)'), `${exc}: Read(**/.env.*) held back`, m.json?.report?.heldBack);
    check(!m.json?.report?.added?.deny?.includes('Read(**/.env.*)'), `${exc}: not appended`);
  }
  // Disjoint from every managed rule (no path can match both), so nothing is held back.
  for (const exc of ['Read(!docs/README.md)', 'Read(!/README.md)']) {
    const d = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: [exc] } }) }); begin(d);
    const m = S('merge-claude-settings', ['--run-id', 'run-0001'], d);
    check(m.json?.needsDecision === false && m.json.report.heldBack.length === 0, `${exc}: provably disjoint, nothing held back`, m.json?.report?.heldBack);
  }
  // A bare name overlaps directory rules (secrets/README.md matches both), so those are deferred.
  { const d = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(!README.md)'] } }) }); begin(d);
    const m = S('merge-claude-settings', ['--run-id', 'run-0001'], d);
    check(m.json?.report.heldBack.includes('Read(**/secrets/**)') && !m.json.report.heldBack.includes('Read(**/.env)'), 'bare-name exception: only overlapping rules deferred', m.json?.report?.heldBack); }
  const probe = path.join(TMP, `glob-probe-${++n}.mjs`);
  fs.writeFileSync(probe, `import { globsMayOverlap } from ${JSON.stringify(pathToFileURL(path.join(SKILL, 'scripts', 'globs.mjs')).href)};
import { globToRegExp, loadSecretSpec } from ${JSON.stringify(pathToFileURL(path.join(SKILL, 'scripts', 'lib.mjs')).href)};
const rules = loadSecretSpec().patterns.map((p) => p.glob);
const exc = ['*.example', '*.md', 'docs/**', 'README.md', '*.json', 'config/*', '?env*', 'secrets', 'x/*/y.*', '*.pem.txt', '.env*', 'id_*', '**/public/*'];
const segs = ['a', 'docs', 'config', 'secrets', 'public', 'x', 'y', '.env', '.env.example', '.env.local', 'README.md', 'k.pem', 'k.pem.txt', 'id_rsa', 'id_rsa.pub', 'a.json', '.npmrc', 'credentials', '.ai', '.run', 'r1', 'vault', 'y.z', 'env.md'];
const paths = [];
for (const a of segs) { paths.push(a); for (const b of segs) { paths.push(a + '/' + b); for (const c of ['.env.example', 'k.pem', 'a.json', 'y.z']) paths.push(a + '/' + b + '/' + c); } }
paths.push('.ai/.run/r1/vault/a');
const unsound = [];
for (const r of rules) for (const e of exc) {
  const ra = globToRegExp(r), rb = globToRegExp(e);
  const witness = paths.find((p) => ra.test(p) && rb.test(p));
  if (witness && !globsMayOverlap(r, e)) unsound.push([r, e, witness]);
}
process.stdout.write(JSON.stringify({ unsound, checked: rules.length * exc.length, paths: paths.length }));`);
  const pr = proc(process.execPath, [probe], TMP);
  check(pr.json && pr.json.unsound.length === 0, 'no pair matched by a common path is reported disjoint', pr.json || pr.stderr);
});

// ===================================================== rc.3 review (R18+) ====
function partialRun(d, id = 'run-0001') {
  // docs/a.md and docs/b.md updated; b's backup is obstructed so commit stops after applying a (exit 5).
  const r = begin(d, id);
  put(path.join(r, 'drafts', 'docs', 'a.md'), 'NEW A\n'); put(path.join(r, 'drafts', 'docs', 'b.md'), 'NEW B\n');
  const p = prepare(d, id); check(p.code === 0, 'prepare', p);
  fs.mkdirSync(path.join(r, 'vault', 'backup', 'docs', 'b.md'), { recursive: true });
  const c = commit(d, p, id);
  check(c.code === 5, 'first commit is partial (exit 5)', c);
  check(read(path.join(d, 'docs', 'a.md')) === 'NEW A\n' && read(path.join(d, 'docs', 'b.md')) === 'ORIGINAL B\n', 'a applied, b not');
  fs.rmdirSync(path.join(r, 'vault', 'backup', 'docs', 'b.md'));
  return { r, p };
}

test('R18', 'retrying prepare/commit after a partial apply is refused; journal is preserved; rollback restores everything', () => {
  const d = repo({ 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n' });
  const { r, p } = partialRun(d);
  const journalBefore = read(path.join(r, 'journal.json'));
  const p2 = prepare(d); check(p2.code === 7 && p2.json?.state === 'partial', 'same-run prepare refused (exit 7, partial)', p2);
  const c2 = commit(d, p); check(c2.code === 7, 'same-run commit with the old approval refused', c2);
  check(read(path.join(r, 'journal.json')) === journalBefore, 'journal byte-identical after refused retries');
  S('lock', ['release', '--run-id', 'run-0001'], d);
  check(S('lock', ['acquire', '--run-id', 'run-0002'], d).code === 0 && S('apply', ['init', '--run-id', 'run-0002'], d).code === 0, 'second run initialised');
  put(path.join(d, '.ai', '.run', 'run-0002', 'drafts', 'docs', 'b.md'), 'NEW B\n');
  const p3 = prepare(d, 'run-0002'); check(p3.code === 7 && p3.json?.unresolved?.[0]?.runId === 'run-0001', 'new run blocked while run-0001 is partial', p3);
  S('lock', ['release', '--run-id', 'run-0002'], d); S('lock', ['acquire', '--run-id', 'run-0001'], d);
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 0 && rb.json?.complete === true, 'rollback complete', rb);
  check(read(path.join(d, 'docs', 'a.md')) === 'ORIGINAL A\n' && read(path.join(d, 'docs', 'b.md')) === 'ORIGINAL B\n', 'both files back to ORIGINAL', [read(path.join(d, 'docs', 'a.md')), read(path.join(d, 'docs', 'b.md'))]);
  check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'rolled-back', 'status rolled-back');
  check(prepare(d).code === 7, 'rolled-back run is not reusable');
  S('lock', ['release', '--run-id', 'run-0001'], d); S('lock', ['acquire', '--run-id', 'run-0002'], d);
  put(path.join(d, '.ai', '.run', 'run-0002', 'drafts', 'docs', 'a.md'), 'NEW A\n');
  const p4 = prepare(d, 'run-0002'); check(p4.code === 0 && p4.json.changed === 2, 'retry in a new run sees both changes', p4.json);
  const c4 = commit(d, p4, 'run-0002'); check(c4.code === 0, 'retry commits', c4);
  const rb2 = S('apply', ['rollback', '--run-id', 'run-0002'], d);
  check(rb2.code === 0 && read(path.join(d, 'docs', 'a.md')) === 'ORIGINAL A\n' && read(path.join(d, 'docs', 'b.md')) === 'ORIGINAL B\n', 'retry run is itself fully reversible', rb2);
});

test('R19', 'retry after an INCOMPLETE rollback is refused until the skipped files are resolved', () => {
  const d = repo({ 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n' });
  const { r } = partialRun(d);
  put(path.join(d, 'docs', 'a.md'), 'USER EDIT A\n'); // someone edits a after the run wrote it
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 6 && rb.json?.skipped?.[0]?.target === 'docs/a.md', 'rollback incomplete (exit 6)', rb);
  const journalBefore = read(path.join(r, 'journal.json'));
  const p = prepare(d); check(p.code === 7 && p.json?.state === 'rollback-incomplete', 'same-run prepare refused', p);
  check(S('apply', ['commit', '--run-id', 'run-0001', '--approved-plan', 'x'.repeat(64)], d).code === 7, 'same-run commit refused');
  S('lock', ['release', '--run-id', 'run-0001'], d); S('lock', ['acquire', '--run-id', 'run-0003'], d); S('apply', ['init', '--run-id', 'run-0003'], d);
  put(path.join(d, '.ai', '.run', 'run-0003', 'drafts', 'docs', 'a.md'), 'NEWER A\n');
  const pn = prepare(d, 'run-0003'); check(pn.code === 7 && pn.json?.unresolved?.some((u) => u.runId === 'run-0001' && u.state === 'rollback-incomplete'), 'new run blocked too', pn);
  check(read(path.join(r, 'journal.json')) === journalBefore, 'unresolved entries and journal kept');
  check(fs.existsSync(path.join(r, 'vault', 'backup', 'docs', 'a.md')), 'backup of a kept');
  check(S('apply', ['cleanup', '--run-id', 'run-0001'], d).code === 6, 'cleanup still refused without confirmation');
  // Resolution path 1: the user puts back what the run wrote, then rollback again -> complete.
  S('lock', ['release', '--run-id', 'run-0003'], d); S('lock', ['acquire', '--run-id', 'run-0001'], d);
  put(path.join(d, 'docs', 'a.md'), 'NEW A\n');
  const rb2 = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb2.code === 0 && rb2.json?.complete === true && read(path.join(d, 'docs', 'a.md')) === 'ORIGINAL A\n', 'second rollback completes and restores a', rb2);
  S('lock', ['release', '--run-id', 'run-0001'], d); S('lock', ['acquire', '--run-id', 'run-0003'], d);
  check(prepare(d, 'run-0003').code === 0, 'new run allowed once resolved');
  // Resolution path 2: user keeps their edit and explicitly discards the old run.
  const d2 = repo({ 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n' });
  partialRun(d2); put(path.join(d2, 'docs', 'a.md'), 'USER EDIT A\n');
  check(S('apply', ['rollback', '--run-id', 'run-0001'], d2).code === 6, 'incomplete');
  check(S('apply', ['cleanup', '--run-id', 'run-0001', '--confirm-manual-resolution'], d2).code === 0, 'explicit discard');
  S('lock', ['release', '--run-id', 'run-0001'], d2); S('lock', ['acquire', '--run-id', 'run-0004'], d2); S('apply', ['init', '--run-id', 'run-0004'], d2);
  put(path.join(d2, '.ai', '.run', 'run-0004', 'drafts', 'docs', 'b.md'), 'NEW B\n');
  check(prepare(d2, 'run-0004').code === 0 && read(path.join(d2, 'docs', 'a.md')) === 'USER EDIT A\n', 'new run allowed after explicit discard; user edit intact');
});

test('R20', 'a committed run cannot be re-prepared or re-committed; drift (exit 4) still allows re-prepare', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'V1\n');
  const p = prepare(d);
  put(path.join(d, 'TODO.md'), 'EDITED\n'); check(commit(d, p).code === 4, 'drift -> exit 4, nothing written, no journal');
  check(!fs.existsSync(path.join(r, 'journal.json')), 'no journal after a drift abort');
  const p2 = prepare(d); check(p2.code === 0, 're-prepare allowed after exit 4', p2);
  check(commit(d, p2).code === 0, 'commit');
  const journal = read(path.join(r, 'journal.json'));
  put(path.join(r, 'drafts', 'TODO.md'), 'V2\n');
  const p3 = prepare(d); check(p3.code === 7 && p3.json?.state === 'committed', 'prepare refused on committed run', p3);
  check(commit(d, p2).code === 7, 'second commit refused');
  check(read(path.join(r, 'journal.json')) === journal && read(path.join(d, 'TODO.md')) === 'V1\n', 'journal and file unchanged');
  check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'committed', 'status committed');
});

// ================================================= rc.5 preflight (R21+) ====
test('R21', 'detect counts skill copies per tool (one repo copy per tool is not a conflict)', () => {
  const d = repo({ 'src/a.ts': 'x\n' });
  const copy = (dest) => { for (const e of ['SKILL.md', 'VERSION']) put(path.join(dest, e), read(path.join(SKILL, e))); };
  copy(path.join(d, '.claude', 'skills', 'project-setup')); copy(path.join(d, '.agents', 'skills', 'project-setup'));
  const a = S('detect', [], d);
  check(a.code === 0 && Object.keys(a.json.installConflicts).length === 0 && !a.json.warnings.some((w) => /copies are visible/.test(w)), 'no conflict for one copy per tool', a.json?.warnings);
  check(a.json.installs.filter((i) => i.tool === 'claude').length === 1 && a.json.installs.filter((i) => i.tool === 'codex').length === 1, 'one install per tool recorded', a.json?.installs);
  // A user-level v1 copy visible to Claude in addition to the repo copy is a real conflict for Claude only.
  const ch = path.join(TMP, `claude-home-${n}`); put(path.join(ch, 'skills', 'project-setup', 'SKILL.md'), 'v1\n');
  const b = S('detect', [], d, { CLAUDE_CONFIG_DIR: ch });
  check(b.json?.installConflicts?.claude?.length === 2 && !b.json.installConflicts.codex, 'claude conflict only', b.json?.installConflicts);
  // Codex: ~/.agents/skills copy + repo copy.
  put(path.join(HOME, '.agents', 'skills', 'project-setup', 'SKILL.md'), 'v1\n');
  const c = S('detect', [], d);
  check(c.json?.installConflicts?.codex?.length === 2 && !c.json.installConflicts.claude, 'codex conflict only', c.json?.installConflicts);
  fs.rmSync(path.join(HOME, '.agents'), { recursive: true, force: true });
  // CODEX_HOME pointing at a dir already counted is not double-counted.
  const e = S('detect', [], d, { CODEX_HOME: path.join(d, '.agents') });
  check(!e.json?.installConflicts?.codex, 'same directory reached twice counts once', e.json?.installConflicts);
  // Aliases of the same directory must collapse too: a link/junction alias, and on Windows the 8.3 short name.
  const alias = path.join(TMP, `agents-alias-${n}`);
  if (linkDir(path.join(d, '.agents'), alias)) {
    const f = S('detect', [], d, { CODEX_HOME: alias });
    check(!f.json?.installConflicts?.codex, 'link/junction alias of the same directory counts once', f.json?.installConflicts);
  } else current.failures.push('could not create a directory link/junction for the alias case');
  if (process.platform === 'win32') {
    const sp = spawnSync('cmd', ['/d', '/s', '/c', `for %I in ("${path.join(d, '.agents')}") do @echo %~sI`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    if (sp && sp.toLowerCase() !== path.join(d, '.agents').toLowerCase()) {
      const g8 = S('detect', [], d, { CODEX_HOME: sp });
      check(!g8.json?.installConflicts?.codex, `8.3 short-name alias (${sp}) counts once`, g8.json?.installConflicts);
    }
  }
});

test('R22', 'make-fixture: real defect proven by oracle, neutral sources, isolated from hostile git config', () => {
  // Hostile parent environment: failing hooks, mandatory signing with a broken gpg, a template that installs a hook,
  // and stray GIT_* variables. make-fixture must ignore all of it.
  const hostile = path.join(TMP, `hostile-${++n}`);
  put(path.join(hostile, 'hooks', 'pre-commit'), '#!/bin/sh\necho HOSTILE_HOOK_RAN >&2\nexit 1\n'); fs.chmodSync(path.join(hostile, 'hooks', 'pre-commit'), 0o755);
  put(path.join(hostile, 'template', 'hooks', 'post-commit'), '#!/bin/sh\nexit 1\n'); fs.chmodSync(path.join(hostile, 'template', 'hooks', 'post-commit'), 0o755);
  put(path.join(hostile, 'gitconfig'), `[core]\n\thooksPath = ${hostile.replace(/\\/g, '/')}/hooks\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n[init]\n\ttemplateDir = ${hostile.replace(/\\/g, '/')}/template\n`);
  const out = path.join(TMP, `fx-${n}`);
  const r = proc(process.execPath, [path.join(SKILL, 'tests', 'live', 'make-fixture.mjs'), '--out', out], TMP,
    { GIT_CONFIG_GLOBAL: path.join(hostile, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '0', GIT_DIR: path.join(TMP, 'nonexistent-gitdir'), GIT_AUTHOR_NAME: 'Hostile' });
  check(r.code === 0 && r.json?.ok, 'fixture created despite hostile git environment', r.stderr || r.stdout);
  if (r.code !== 0) return;
  const metaFile = r.json.meta;
  check(path.relative(out, metaFile).startsWith('..'), 'metadata stored outside the fixture tree', metaFile);
  const m = JSON.parse(read(metaFile)).fixtures.fresh;
  check(m.oracle.base.correct === true, 'base ledger correct under concurrency', m.oracle.base);
  const def = m.expected.defective; const ctl = def === 'change-1' ? 'change-2' : 'change-1';
  check(m.oracle[def].correct === false && m.oracle[def].conservesMoney === false && m.oracle[def].noOverdraft === false, 'defective change loses money under concurrency', m.oracle[def]);
  check(m.oracle[ctl].correct === true, 'control change is correct', m.oracle[ctl]);
  const fr = path.join(out, 'fixture-fresh');
  const g = (...a) => proc('git', a, fr, { GIT_CONFIG_GLOBAL: path.join(out, '.fixture-git', 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }).stdout.trim();
  check(g('diff', '--stat', m.changes['change-1'].range).includes('wallet.ledger.ts') && g('diff', '--stat', m.changes['change-2'].range).includes('wallet.ledger.ts'), 'both review ranges are non-empty');
  check(!/HOSTILE|Hostile/.test(g('log', '--all', '--format=%an %s')), 'hostile identity not used');
  check(!/^gpgsig /m.test(g('cat-file', '-p', 'HEAD')), 'commits unsigned');
  const src = ['src/wallet/wallet.ledger.ts', 'src/wallet/wallet.service.ts'].map((f) => g('show', `${m.changes[def].tag}:${f}`)).join('\n');
  check(!/race|lost update|read-modify|double spend|FIXTURE|BUG|TODO/i.test(src), 'no hint comments in reviewed sources');
  check(!fs.existsSync(path.join(fr, '.git', 'hooks', 'post-commit')), 'hostile template not applied');
  check(Object.keys(proc(process.execPath, [path.join(SKILL, 'scripts', 'detect.mjs')], fr).json?.installConflicts || { x: 1 }).length === 0, 'detect on the fixture reports no conflict');
});

// ================================================= rc.6 Windows review (R23) ====
function liveEnvProbe(kind) {
  const out = path.join(TMP, `fx-env-${++n}`);
  const g = proc(process.execPath, [path.join(SKILL, 'tests', 'live', 'make-fixture.mjs'), '--out', out, '--kind', 'fresh'], TMP);
  check(g.code === 0, 'fixture generated', g.stderr || g.stdout);
  if (g.code !== 0) return null;
  const repoDir = path.join(out, 'fixture-fresh');
  const hostile = path.join(TMP, `hostile-env-${n}`);
  put(path.join(hostile, 'hooks', 'pre-commit'), '#!/bin/sh\necho HOSTILE_HOOK_RAN >&2\nexit 1\n'); fs.chmodSync(path.join(hostile, 'hooks', 'pre-commit'), 0o755);
  // Hostile inherited environment that must NOT survive loading live-env.
  const hostileEnv = {
    GIT_DIR: path.join(TMP, 'missing-gitdir'), GIT_WORK_TREE: TMP, GIT_INDEX_FILE: path.join(TMP, 'bogus-index'),
    GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: hostile.replace(/\\/g, '/') + '/hooks',
    GIT_CONFIG_KEY_1: 'user.name', GIT_CONFIG_VALUE_1: 'Hostile',
    GIT_CONFIG_PARAMETERS: "'commit.gpgsign'='true' 'gpg.program'='false'",
    GIT_CONFIG_GLOBAL: path.join(hostile, 'nonexistent-global'), GIT_CONFIG_NOSYSTEM: '0', GIT_AUTHOR_NAME: 'Hostile',
  };
  return { out, repoDir, hostileEnv };
}
function parseProbe(stdout) { return Object.fromEntries(stdout.split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])); }
function checkProbe(p, repoDir, kind) {
  check(p.RC === '0' && path.resolve(p.TOP || '').toLowerCase().endsWith(path.basename(repoDir).toLowerCase()), `${kind}: git finds the fixture repo despite GIT_DIR/GIT_WORK_TREE`, p);
  check(p.COMMITRC === '0', `${kind}: commit succeeds (no hostile hook, no forced signing)`, p);
  check(p.AUTHOR === 'Fixture', `${kind}: author comes from the isolated config`, p);
  check(p.SIG === '0', `${kind}: commit unsigned`, p);
  check(p.VARS === 'GIT_CONFIG_GLOBAL,GIT_CONFIG_NOSYSTEM,GIT_TERMINAL_PROMPT', `${kind}: only the isolated GIT_* variables remain`, p.VARS);
}

test('R23a', 'sourcing the generated live-env.sh clears hostile inherited GIT_* variables', () => {
  if (spawnSync('sh', ['-c', 'exit 0'], { windowsHide: true }).status !== 0) return skip('no POSIX sh on PATH');
  const ctx = liveEnvProbe('sh'); if (!ctx) return;
  const script = path.join(TMP, `probe-${n}.sh`);
  const q = (v) => `'${v.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
  const R = q(ctx.repoDir);
  fs.writeFileSync(script, [
    `. ${q(path.join(ctx.out, 'live-env.sh'))}`,
    `TOP=$(git -C ${R} rev-parse --show-toplevel); echo "RC=$?"; echo "TOP=$TOP"`,
    `echo x > ${q(path.join(ctx.repoDir, 'probe.txt'))}`,
    `git -C ${R} checkout -q -b probe-sh && git -C ${R} add probe.txt && git -C ${R} commit -q -m probe; echo "COMMITRC=$?"`,
    `echo "AUTHOR=$(git -C ${R} log -1 --format=%an)"`,
    `echo "SIG=$(git -C ${R} cat-file -p HEAD | grep -c '^gpgsig')"`,
    `echo "VARS=$(env | awk -F= '/^GIT_[A-Za-z0-9_]*=/{print $1}' | sort | paste -sd, -)"`,
    '',
  ].join('\n'));
  const r = proc('sh', [script], TMP, ctx.hostileEnv);
  checkProbe(parseProbe(r.stdout), ctx.repoDir, 'sh');
  check(!r.stderr.includes('HOSTILE_HOOK_RAN'), 'sh: hostile hook never ran', r.stderr);
});

test('R23b', 'dot-sourcing the generated live-env.ps1 clears hostile inherited GIT_* variables', () => {
  const ps = ['pwsh', 'powershell'].find((exe) => spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { windowsHide: true }).status === 0);
  if (!ps) return skip('no PowerShell (pwsh/powershell) on PATH');
  const ctx = liveEnvProbe('ps'); if (!ctx) return;
  const script = path.join(TMP, `probe-${n}.ps1`);
  const q = (v) => `'${v.replace(/'/g, "''")}'`;
  const R = q(ctx.repoDir);
  fs.writeFileSync(script, [
    `. ${q(path.join(ctx.out, 'live-env.ps1'))}`,
    `$top = git -C ${R} rev-parse --show-toplevel; "RC=$LASTEXITCODE"; "TOP=$top"`,
    `Set-Content -LiteralPath ${q(path.join(ctx.repoDir, 'probe.txt'))} -Value 'x'`,
    `git -C ${R} checkout -q -b probe-ps; git -C ${R} add probe.txt; git -C ${R} commit -q -m probe; "COMMITRC=$LASTEXITCODE"`,
    `"AUTHOR=" + (git -C ${R} log -1 --format=%an)`,
    `"SIG=" + @(git -C ${R} cat-file -p HEAD | Select-String -Pattern '^gpgsig').Count`,
    `"VARS=" + ((@(Get-ChildItem Env: | Where-Object { $_.Name -like 'GIT_*' }) | ForEach-Object { $_.Name.ToUpper() } | Sort-Object) -join ',')`,
    '',
  ].join('\r\n'));
  // -ExecutionPolicy Bypass applies to this child process only; no machine/user policy is changed.
  const r = proc(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], TMP, ctx.hostileEnv);
  checkProbe(parseProbe(r.stdout), ctx.repoDir, 'powershell');
  check(!r.stderr.includes('HOSTILE_HOOK_RAN') && !r.stdout.includes('HOSTILE_HOOK_RAN'), 'powershell: hostile hook never ran', r.stderr);
});

// ================================================= rc.7 Windows review (R24+) ====
test('R24', 'rollback refuses backups that do not match the journal pre-run hash', () => {
  const tamper = {
    altered: (b) => put(b, 'ORIGINAL\u0000\n'.replace('\u0000', 'X')),
    truncated: (b) => put(b, ''),
    'wrong-file': (b) => put(b, 'UPDATED\n'),
    partial: (b) => put(b, 'ORIG'),
  };
  for (const [name, fn] of Object.entries(tamper)) {
    const d = repo({ 'TODO.md': 'ORIGINAL\n' }); const r = begin(d);
    put(path.join(r, 'drafts', 'TODO.md'), 'UPDATED\n'); check(commit(d, prepare(d)).code === 0, `${name}: commit`);
    const b = path.join(r, 'vault', 'backup', 'TODO.md'); fn(b); const tampered = fs.readFileSync(b);
    const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
    check(rb.code === 6 && rb.json?.skipped?.some((x) => x.target === 'TODO.md' && /pre-run hash/.test(x.reason)), `${name}: rollback incomplete with integrity reason`, rb);
    check(read(path.join(d, 'TODO.md')) === 'UPDATED\n', `${name}: target untouched`);
    check(Buffer.compare(fs.readFileSync(b), tampered) === 0, `${name}: backup left as found`);
    check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'rollback-incomplete', `${name}: state rollback-incomplete`);
  }
  const d = repo({ 'TODO.md': 'ORIGINAL\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'TODO.md'), 'UPDATED\n'); commit(d, prepare(d));
  const ok2 = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(ok2.code === 0 && read(path.join(d, 'TODO.md')) === 'ORIGINAL\n', 'control: intact backup restores', ok2);
});

test('R25', 'installer rollback is one transaction across targets (fault injected per target)', () => {
  // Fault injection from outside the installer: a preload makes one specific rename fail with EPERM.
  const preload = path.join(TMP, `rename-fault-${++n}.mjs`);
  fs.writeFileSync(preload, `import fs from 'node:fs';
import path from 'node:path';
const orig = fs.renameSync;
fs.renameSync = function (from, to) {
  const want = process.env.PS_FAIL_RENAME_TO;
  if (want && path.resolve(String(to)) === path.resolve(want) && /\\.project-setup\\.bak-/.test(path.basename(String(from)))) {
    const e = new Error('EPERM: injected rename failure (test)'); e.code = 'EPERM'; throw e;
  }
  return orig.apply(this, arguments);
};
`);
  for (const failTarget of ['codex', 'claude']) {
    const src = sourceCopy('6.0.0-a'); const c = path.join(TMP, `c-${n}-${failTarget}`), x = path.join(TMP, `x-${n}-${failTarget}`); const a = ['--claude-dir', c, '--codex-dir', x];
    inst(src, a); fs.writeFileSync(path.join(src, 'VERSION'), '6.0.0-b\n'); check(inst(src, a).code === 0, `${failTarget}: upgrade to B`);
    const dest = path.join(failTarget === 'codex' ? x : c, 'project-setup');
    const r = proc(process.execPath, ['--import', pathToFileURL(preload).href, path.join(src, 'install', 'install.mjs'), 'rollback', ...a], TMP, { PS_FAIL_RENAME_TO: dest });
    check(r.code === 4 && r.json?.revertFailures?.length === 0, `${failTarget}: exit 4 with clean revert`, r.json || r.stderr);
    check(installedVersion(c) === '6.0.0-b' && installedVersion(x) === '6.0.0-b', `${failTarget}: both targets still B (no mixed state)`, [installedVersion(c), installedVersion(x)]);
    check(r.json?.after?.every((t) => t.present && t.version === '6.0.0-b'), `${failTarget}: measured end state reported for every target`, r.json?.after);
    for (const dir of [c, x]) check(fs.readdirSync(dir).some((f) => /^\.project-setup\.bak-.*\d$/.test(f)), `${failTarget}: backup kept in ${path.basename(dir)}`, fs.readdirSync(dir));
    const again = inst(src, ['rollback', ...a]);
    check(again.code === 0 && installedVersion(c) === '6.0.0-a' && installedVersion(x) === '6.0.0-a', `${failTarget}: rollback without the fault restores both to A`, again.json);
  }
});

test('R26', 'lock release fails closed when ownership is unknown', () => {
  for (const [name, mutate] of [
    ['corrupt-json', (o) => put(o, '{ not json')],
    ['missing-owner (mkdir-to-write window)', (o) => fs.rmSync(o)],
    ['invalid-shape', (o) => put(o, '{}')],
    ['empty-runid', (o) => put(o, JSON.stringify({ runId: '' }))],
  ]) {
    const d = repo({ 'a.txt': 'a\n' });
    check(S('lock', ['acquire', '--run-id', 'owner-0001'], d).code === 0, `${name}: acquire`);
    const ownerFile = path.join(d, '.ai', '.setup.lock', 'owner.json'); mutate(ownerFile);
    const rel = S('lock', ['release', '--run-id', 'other-0002'], d);
    check(rel.code === 2 && fs.existsSync(path.join(d, '.ai', '.setup.lock')), `${name}: release by another run refused, lock kept`, rel);
    check(S('lock', ['release', '--run-id', 'owner-0001'], d).code === 2, `${name}: even the claimed owner cannot release an unverifiable lock`);
    check(S('lock', ['status'], d).json?.ownerReadable === false, `${name}: status shows ownerReadable:false`);
    check(S('apply', ['init', '--run-id', 'other-0002'], d).code === 0 && S('apply', ['commit', '--run-id', 'other-0002', '--approved-plan', 'x'], d).code === 2, `${name}: apply refuses without a verifiable lock`);
    check(S('lock', ['break'], d).code === 2, `${name}: plain break refused`);
    const br = S('lock', ['break', '--confirm-unknown-owner'], d);
    check(br.code === 0 && !fs.existsSync(path.join(d, '.ai', '.setup.lock')), `${name}: explicit unknown-owner break works`, br);
  }
  const d = repo({ 'a.txt': 'a\n' }); S('lock', ['acquire', '--run-id', 'owner-0001'], d);
  check(S('lock', ['break', '--confirm-unknown-owner'], d).code === 2, 'unknown-owner flag cannot break a lock whose owner is known');
  check(S('lock', ['release', '--run-id', 'owner-0001'], d).code === 0, 'control: owner releases its own valid lock');
});

// ================================================= rc.8 review (R27+) ====
function faultPreload(name, body) { const f = path.join(TMP, `${name}-${++n}.cjs`); fs.writeFileSync(f, body); return f; }
const endsWithPosix = (p, suffix) => `String(${p}).split(String.fromCharCode(92)).join('/').endsWith(${JSON.stringify(suffix)})`;
function committedTwoFiles(extraDrafts = {}) {
  const d = repo({ 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n' }); const r = begin(d);
  put(path.join(r, 'drafts', 'docs', 'a.md'), 'NEW A\n'); put(path.join(r, 'drafts', 'docs', 'b.md'), 'NEW B\n');
  for (const [f, c] of Object.entries(extraDrafts)) put(path.join(r, 'drafts', f), c);
  const c = commit(d, prepare(d)); check(c.code === 0, 'commit', c);
  return { d, r };
}
function assertUnresolvedAndRecover(d, r, label, expect = { 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n' }) {
  const st = S('apply', ['status', '--run-id', 'run-0001'], d).json?.state;
  check(['rollback-in-progress', 'rollback-incomplete'].includes(st), `${label}: state is unresolved, not committed/rolled-back`, st);
  check(S('apply', ['cleanup', '--run-id', 'run-0001'], d).code === 6 && fs.existsSync(path.join(r, 'vault', 'backup')), `${label}: cleanup refused, backups kept`);
  S('lock', ['release', '--run-id', 'run-0001'], d); S('lock', ['acquire', '--run-id', 'run-0002'], d); S('apply', ['init', '--run-id', 'run-0002'], d);
  put(path.join(d, '.ai', '.run', 'run-0002', 'drafts', 'docs', 'b.md'), 'LATER B\n');
  const np = prepare(d, 'run-0002'); check(np.code === 7 && np.json?.unresolved?.some((u) => u.runId === 'run-0001'), `${label}: new run blocked`, np.json);
  S('lock', ['release', '--run-id', 'run-0002'], d); S('lock', ['acquire', '--run-id', 'run-0001'], d);
  const retry = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(retry.code === 0 && retry.json?.complete === true, `${label}: retry without the fault completes`, retry.json || retry.stderr);
  for (const [f, c] of Object.entries(expect)) check(fs.existsSync(path.join(d, f)) ? read(path.join(d, f)) === c : c === null, `${label}: ${f} restored`, fs.existsSync(path.join(d, f)) ? read(path.join(d, f)) : '(absent)');
  check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'rolled-back', `${label}: state rolled-back after retry`);
  check(S('apply', ['cleanup', '--run-id', 'run-0001'], d).code === 0, `${label}: cleanup allowed once verified`);
}

test('R27a', 'rollback rename/write failure leaves the run unresolved (GPT repro) and resumes safely', () => {
  const { d, r } = committedTwoFiles();
  const pre = faultPreload('rename-a', `const fs=require('fs');const o=fs.renameSync;fs.renameSync=function(a,b){if(${endsWithPosix('b', '/docs/a.md')}){const e=new Error('EPERM injected');e.code='EPERM';throw e;}return o.apply(this,arguments);};`);
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d, { NODE_OPTIONS: `--require=${pre}` });
  check(rb.code === 6 && rb.json?.skipped?.some((x) => x.target === 'docs/a.md' && /I\/O error/.test(x.reason)), 'exit 6 with the I/O failure reported', rb.json || rb.stderr);
  check(read(path.join(d, 'docs', 'a.md')) === 'NEW A\n', 'a not restored (fault)');
  assertUnresolvedAndRecover(d, r, 'rename');
});

test('R27b', 'rollback delete failure for a created file leaves the run unresolved and resumes', () => {
  const { d, r } = committedTwoFiles({ 'docs/new.md': 'CREATED\n' });
  const pre = faultPreload('rm-new', `const fs=require('fs');const o=fs.rmSync;fs.rmSync=function(p){if(${endsWithPosix('p', '/docs/new.md')}){const e=new Error('EBUSY injected');e.code='EBUSY';throw e;}return o.apply(this,arguments);};`);
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d, { NODE_OPTIONS: `--require=${pre}` });
  check(rb.code === 6 && fs.existsSync(path.join(d, 'docs', 'new.md')), 'exit 6, created file still present', rb.json || rb.stderr);
  assertUnresolvedAndRecover(d, r, 'delete', { 'docs/a.md': 'ORIGINAL A\n', 'docs/b.md': 'ORIGINAL B\n', 'docs/new.md': null });
});

test('R27c', 'rollback interrupted mid-way (process killed) is unresolved, never "committed"', () => {
  const { d, r } = committedTwoFiles();
  const pre = faultPreload('kill-a', `const fs=require('fs');const o=fs.renameSync;fs.renameSync=function(a,b){if(${endsWithPosix('b', '/docs/a.md')}){process.exit(137);}return o.apply(this,arguments);};`);
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d, { NODE_OPTIONS: `--require=${pre}` });
  check(rb.code === 137, 'process died during rollback', rb.code);
  check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'rollback-in-progress', 'state rollback-in-progress');
  assertUnresolvedAndRecover(d, r, 'interrupt');
});

test('R27d', 'a journal write failure during rollback never reports completion', () => {
  const { d, r } = committedTwoFiles();
  // Let the first journal write (the in-progress marker) succeed, fail every later journal write.
  const pre = faultPreload('journal', `const fs=require('fs');const o=fs.renameSync;let k=0;fs.renameSync=function(a,b){if(${endsWithPosix('b', '/journal.json')}&&++k>1){const e=new Error('EIO injected');e.code='EIO';throw e;}return o.apply(this,arguments);};`);
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d, { NODE_OPTIONS: `--require=${pre}` });
  check(rb.code === 6 && rb.json?.ok === false, 'nonzero exit, ok:false', rb.json || rb.stderr);
  check(S('apply', ['status', '--run-id', 'run-0001'], d).json?.state === 'rollback-in-progress', 'state stays rollback-in-progress');
  assertUnresolvedAndRecover(d, r, 'journal');
  // Marker itself cannot be written: nothing may change.
  const x = committedTwoFiles();
  const pre2 = faultPreload('journal0', `const fs=require('fs');const o=fs.renameSync;fs.renameSync=function(a,b){if(${endsWithPosix('b', '/journal.json')}){const e=new Error('EIO injected');e.code='EIO';throw e;}return o.apply(this,arguments);};`);
  const rb2 = S('apply', ['rollback', '--run-id', 'run-0001'], x.d, { NODE_OPTIONS: `--require=${pre2}` });
  check(rb2.code === 6 && read(path.join(x.d, 'docs', 'a.md')) === 'NEW A\n' && read(path.join(x.d, 'docs', 'b.md')) === 'NEW B\n' && fs.existsSync(path.join(x.d, '.ai', 'manifest.json')), 'marker write failure: nothing touched', rb2.json || rb2.stderr);
});

test('R28', 'installer verifies every backup before rollback; corrupted/missing/extra/linked backups change nothing', () => {
  const mutations = {
    'corrupted SKILL.md': (b) => put(path.join(b, 'SKILL.md'), 'CORRUPTED BACKUP\n'),
    'truncated file': (b) => put(path.join(b, 'references', 'modes.md'), ''),
    'missing file': (b) => fs.rmSync(path.join(b, 'references', 'modes.md')),
    'extra file': (b) => put(path.join(b, 'scripts', 'extra.mjs'), 'x\n'),
    'link inside': (b) => { if (!linkDir(path.join(TMP), path.join(b, 'assets', 'linked'))) throw new Error('nolink'); },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const src = sourceCopy('5.0.0-a'); const c = path.join(TMP, `c-${n}-i`), x = path.join(TMP, `x-${n}-i`); const a = ['--claude-dir', c, '--codex-dir', x];
    inst(src, a); fs.writeFileSync(path.join(src, 'VERSION'), '5.0.0-b\n'); check(inst(src, a).code === 0, `${name}: upgrade to B`);
    const bak = path.join(c, fs.readdirSync(c).find((f) => f.startsWith('.project-setup.bak-') && !f.endsWith('.meta.json')));
    try { mutate(bak); } catch { current.failures.push(`${name}: could not set up mutation`); continue; }
    const r = inst(src, ['rollback', ...a]);
    check(r.code === 6 && r.json?.failed?.[0]?.target === 'claude', `${name}: rollback refused (exit 6), failing target named`, r.json);
    check(installedVersion(c) === '5.0.0-b' && installedVersion(x) === '5.0.0-b' && !read(path.join(c, 'project-setup', 'SKILL.md')).includes('CORRUPTED'), `${name}: both targets untouched on B`);
    check(fs.existsSync(bak) && fs.readdirSync(x).some((f) => f.startsWith('.project-setup.bak-')), `${name}: all backups kept`);
  }
  // Adopted v1 copy: digest recorded at adoption, corruption detected later.
  const src = sourceCopy('5.1.0'); const c = path.join(TMP, `c-${n}-v1`);
  put(path.join(c, 'project-setup', 'SKILL.md'), 'V1\n'); put(path.join(c, 'project-setup', 'notes.txt'), 'v1 notes\n');
  check(inst(src, ['--targets', 'claude', '--claude-dir', c, '--replace-unversioned']).code === 0, 'adopt v1');
  const bak = path.join(c, fs.readdirSync(c).find((f) => f.startsWith('.project-setup.bak-') && !f.endsWith('.meta.json')));
  check(JSON.parse(read(`${bak}.meta.json`)).snapshot?.sha256?.length === 64, 'snapshot digest recorded at adoption');
  put(path.join(bak, 'notes.txt'), 'tampered\n');
  const r1 = inst(src, ['rollback', '--targets', 'claude', '--claude-dir', c]);
  check(r1.code === 6 && installedVersion(c) === '5.1.0', 'tampered adopted v1 backup refused', r1.json);
  put(path.join(bak, 'notes.txt'), 'v1 notes\n');
  const r2 = inst(src, ['rollback', '--targets', 'claude', '--claude-dir', c]);
  check(r2.code === 0 && read(path.join(c, 'project-setup', 'SKILL.md')) === 'V1\n' && r2.json?.restored?.[0]?.verifiedBy === 'snapshot', 'control: intact adopted backup restores, verified by snapshot', r2.json);
});

// ================================================= live acceptance findings (R29+) ====
test('R29', 'prepare: files the skill does not own may only gain new blocks; everything else needs explicit approval', () => {
  const P = (d, extra = []) => prepare(d, 'run-0001', extra, { strict: true });
  // a) v1-style CLAUDE.md without markers (the live L13 gap)
  { const d = repo({ 'CLAUDE.md': '# app\n<!-- Generated by project-setup -->\n\n## Overview\nSee @.ai/context/project-tree.md\n\n## Team note\nKeep.\n' }); const r = begin(d);
    put(path.join(r, 'drafts', 'CLAUDE.md'), '# app\n<!-- Generated by project-setup -->\n\n@AGENTS.md\n\n## Overview\nSee `.ai/context/project-tree.md`\n\n## Team note\nKeep.\n\n<!-- project-setup:begin id=claude -->\nx\n<!-- project-setup:end id=claude -->\n');
    const p = P(d); check(p.code === 3 && /does not own/.test(JSON.stringify(p.json)), 'unowned CLAUDE.md edit requires approval', p.json);
    const p2 = P(d, ['--approve-user-content', 'CLAUDE.md']); check(p2.code === 0 && p2.json.ops[0].userContentChange === true, 'explicit approval recorded', p2.json); }
  // b) .gitignore gains only a new block -> no approval
  { const d = repo({ '.gitignore': 'node_modules/\n.env\n' }); const r = begin(d);
    S('blocks', ['upsert', '--file', '.gitignore', '--id', 'gitignore', '--content', path.join(SKILL, 'assets', 'templates', 'gitignore-block.txt'), '--run-id', 'run-0001'], d);
    const p = P(d); check(p.code === 0 && p.json.ops[0].userContentChange === false, 'block-only append needs no approval', p.json); }
  // c) unowned file replaced entirely (v1 reviewer.md)
  { const d = repo({ '.claude/agents/reviewer.md': '---\nname: reviewer\nmodel: opus\n---\nv1\n' }); const r = begin(d);
    put(path.join(r, 'drafts', '.claude', 'agents', 'reviewer.md'), read(path.join(SKILL, 'assets', 'wrappers', 'claude-reviewer.md')));
    check(P(d).code === 3, 'replacing an unowned file requires approval'); }
  // d) settings.json: append-only merge passes; removing, reordering or touching user keys does not
  { const base = { $schema: 'https://json.schemastore.org/claude-code-settings.json', permissions: { allow: ['Bash(git status)'], deny: ['Read(.env)', 'Bash(DROP DATABASE *)'] }, hooks: { PostToolUse: [{ matcher: 'Write', command: 'x' }] } };
    const d = repo({ '.claude/settings.json': JSON.stringify(base, null, 2) + '\n' }); const r = begin(d);
    check(S('merge-claude-settings', ['--run-id', 'run-0001'], d).code === 0, 'merge');
    const p = P(d); check(p.code === 0 && p.json.ops.every((o) => !o.userContentChange), 'merge-script draft needs no approval', p.json);
    const draftPath = path.join(r, 'drafts', '.claude', 'settings.json');
    for (const [name, mutate] of [['changes $schema', (j) => { j.$schema = 'https://example.invalid/x.json'; }], ['removes a deny', (j) => { j.permissions.deny.splice(1, 1); }], ['reorders', (j) => { j.permissions.deny.reverse(); }], ['changes hooks', (j) => { delete j.hooks; }], ['changes allow', (j) => { j.permissions.allow = []; }]]) {
      const j = JSON.parse(JSON.stringify({ ...base, permissions: { ...base.permissions, deny: [...base.permissions.deny, 'Read(**/.env)'] } })); mutate(j);
      put(draftPath, JSON.stringify(j, null, 2) + '\n');
      check(P(d).code === 3, `settings draft that ${name} requires approval`);
    } }
  // e) env template: env-keys block append passes; changing an existing value needs approval and never prints it
  { const d = repo({ '.env.example': 'DB_PASSWORD=Sup3rSecretValue\nPORT=3000\n' }); const r = begin(d);
    put(path.join(d, 'k.json'), JSON.stringify([{ name: 'JWT_SECRET', secret: true }]));
    check(S('env-keys', ['merge', '--keys', path.join(d, 'k.json'), '--run-id', 'run-0001'], d).code === 0, 'env merge');
    check(P(d).code === 0, 'env-keys block append needs no approval');
    put(path.join(r, 'vault', 'files', '.env.example'), 'DB_PASSWORD=ChangedValue123\nPORT=3000\n');
    const p = P(d); check(p.code === 3 && !p.stdout.includes('Sup3rSecretValue') && !p.stdout.includes('ChangedValue123'), 'value change needs approval; values never printed', p.stdout); }
  // f) managed file losing a block
  { const d = repo({ 'AGENTS.md': '<!-- project-setup:begin id=a -->\nA\n<!-- project-setup:end id=a -->\n\n<!-- project-setup:begin id=b -->\nB\n<!-- project-setup:end id=b -->\n' }); const r = begin(d);
    put(path.join(r, 'drafts', 'AGENTS.md'), '<!-- project-setup:begin id=a -->\nA2\n<!-- project-setup:end id=a -->\n');
    const p = P(d); check(p.code === 3 && /removes a managed block/.test(JSON.stringify(p.json)), 'removing a managed block requires approval', p.json); }
  // g) living doc the skill created earlier (manifest "merged") is updated through the reviewed diff only
  { const d = repo({ 'src/a.ts': 'x\n' }); const r = begin(d);
    put(path.join(r, 'drafts', 'docs', 'database.md'), '# db\n'); check(commit(d, P(d)).code === 0, 'first run');
    S('lock', ['release', '--run-id', 'run-0001'], d); const r2 = begin(d, 'run-0002');
    put(path.join(r2, 'drafts', 'docs', 'database.md'), '# db\n\nupdated\n');
    const p = prepare(d, 'run-0002', [], { strict: true }); check(p.code === 0 && p.json.ops[0].userContentChange === false, 'skill-created living doc needs no extra approval', p.json); }
});

test('R30', 'validate: a user-owned legacy hook is a warning; broken managed permissions are a failure', () => {
  const sp = read(path.join(SKILL, 'data', 'secret-paths.json'));
  const base = { '.ai/agents/reviewer.md': '# r\n', '.ai/security-paths.json': sp, '.ai/tools/git-safe.mjs': '//\n', '.gitignore': '.claude/settings.local.json\nCLAUDE.local.md\n' };
  const d = repo({ ...base, '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Read(**/.env)'] }, hooks: { PostToolUse: [{ matcher: 'Write', command: 'x' }] } }) });
  const v = S('validate', [], d);
  check(v.code === 0 && v.json?.ok === true && v.json.results.some((x) => x.level === 'warn' && /legacy shape/.test(x.detail)), 'legacy hook -> warn, validate ok', v.json?.results);
  const d2 = repo({ ...base, '.claude/settings.json': JSON.stringify({ permissions: { deny: 'Read(**/.env)' } }) });
  const v2 = S('validate', [], d2); check(v2.code === 1 && v2.json.results.some((x) => x.level === 'fail' && /permissions\.deny/.test(x.detail)), 'broken managed key -> fail', v2.json?.results);
});

test('R31', 'detect: synced copies, Claude skillOverrides, Codex config disables, profile-only disables', () => {
  const d = repo({ 'src/a.ts': 'x\n' });
  const copy = (dest, ver) => { put(path.join(dest, 'SKILL.md'), '---\nname: project-setup\n---\n'); if (ver) put(path.join(dest, 'VERSION'), ver + '\n'); };
  copy(path.join(d, '.claude', 'skills', 'project-setup'), '2.0.0'); copy(path.join(d, '.agents', 'skills', 'project-setup'), '2.0.0');
  const ch = path.join(TMP, `ch-${++n}`); copy(path.join(ch, 'skills', 'synced', 'abc', 'project-setup'));
  const cx = path.join(TMP, `cx-${n}`); fs.mkdirSync(cx);
  const syncedCodex = path.join(HOME, '.agents', 'skills', 'synced', 'xyz', 'project-setup'); copy(syncedCodex);
  const env = { CLAUDE_CONFIG_DIR: ch, CODEX_HOME: cx };
  const a = S('detect', [], d, env);
  check(a.json?.installConflicts?.claude?.length === 2 && a.json.installConflicts.codex?.length === 2, 'synced copies found for both tools', a.json?.installs);
  put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'anthropic-skills:project-setup': 'off' } }));
  const tomlPath = path.join(syncedCodex, 'SKILL.md').replace(/\\/g, '/');
  put(path.join(cx, 'iso.config.toml'), `[[skills.config]]\npath = '${tomlPath}'\nenabled = false\n`);
  const b = S('detect', [], d, env);
  check(!b.json?.installConflicts?.claude && b.json.installs.some((i) => i.scope === 'synced' && i.tool === 'claude' && i.disabled), 'skillOverrides off disables the synced Claude copy', b.json?.installs);
  check(b.json.installConflicts?.codex?.length === 2 && b.json.installs.some((i) => i.tool === 'codex' && i.disabledOnlyInProfiles.includes('iso')), 'profile-only disable is reported but still counted', b.json?.installs);
  put(path.join(cx, 'config.toml'), `[[skills.config]]\npath = '${tomlPath}'\nenabled = false\n`);
  const c = S('detect', [], d, env);
  check(!c.json?.installConflicts?.codex, 'config.toml disable removes the Codex conflict', c.json?.installConflicts);
  put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'project-setup': 'off' } }));
  const e = S('detect', [], d, env);
  check(e.json?.warnings?.some((w) => /repo copy of project-setup is disabled/.test(w)), 'warns when the repo copy itself is switched off', e.json?.warnings);
  fs.rmSync(path.join(HOME, '.agents'), { recursive: true, force: true });
});

test('R32', 'canary setup re-run replaces entries instead of duplicating them', () => {
  const d = repo({ 'a.txt': 'a\n' });
  S('canary', ['setup', '--run-id', 'cn-dup1'], d); S('canary', ['setup', '--run-id', 'cn-dup1'], d);
  const idx = JSON.parse(read(path.join(d, '.ai', '.canary', 'cn-dup1', 'index.json')));
  const p = S('canary', ['probe', '--run-id', 'cn-dup1'], d);
  check(idx.files.length === 4 && p.json?.results?.length === 4 && p.json.results.every((x) => x.result === 'READABLE'), '4 entries, all with current tokens', p.json);
});

test('R33', 'git-safe blocks -L/--contents, which print file content regardless of excludes', () => {
  const d = repo({ '.env': 'DUMMY_SECRET=NOT_REAL_L\n', 'safe.txt': 's\n' });
  put(path.join(d, '.ai', 'security-paths.json'), read(path.join(SKILL, 'data', 'secret-paths.json')));
  for (const a of [['log', '-L', '1,1:.env'], ['log', '-L1,1:.env'], ['log', '--line-range=1,1:.env'], ['diff', '--contents', '.env']]) {
    const r = node('assets/tools/git-safe.mjs', a, d);
    check(r.code === 2 && !r.stdout.includes('DUMMY_SECRET'), `${a.join(' ')} blocked`, r);
  }
});

test('R34', 'scripts refuse secret-pattern files as input before opening them', () => {
  const d = repo({ '.env': 'DUMMY_SECRET=NOT_REAL_INPUT\n', 'a.txt': 'a\n' }, false); begin(d);
  const outside = path.join(TMP, `outside-secret-${++n}`, '.env.local'); put(outside, 'DUMMY_SECRET=NOT_REAL_OUTSIDE\n');
  for (const [script, args] of [
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', '.env', '--run-id', 'run-0001']],
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', outside, '--run-id', 'run-0001']],
    ['merge-claude-settings', ['--run-id', 'run-0001', '--allow-file', '.env']],
    ['env-keys', ['merge', '--keys', outside, '--run-id', 'run-0001']],
  ]) {
    const r = S(script, args, d);
    check(r.code !== 0 && !/NOT_REAL_(INPUT|OUTSIDE)/.test(r.stdout + r.stderr), `${script} ${args.join(' ')} refused without leaking`, r);
  }
  check(!fs.existsSync(path.join(d, '.ai', '.run', 'run-0001', 'drafts', 'AGENTS.md')), 'no draft written from a secret');
});

// ======================================================= rc.10 review (R35+) ====
test('R35', 'secret-input guard checks the resolved destination (junction/symlink aliases inside and outside the repo)', () => {
  const d = repo({ 'secrets/input.txt': 'SYNTHETIC_SECRET_R35\n', 'a.txt': 'a\n' }, false); begin(d);
  const outDir = path.join(TMP, `outside-sec-${++n}`); put(path.join(outDir, 'secrets', 'k.json'), '["SYNTHETIC_SECRET_R35_OUT"]');
  const aliasIn = path.join(d, 'innocent'); const aliasOut = path.join(TMP, `alias-out-${n}`);
  if (!linkDir(path.join(d, 'secrets'), aliasIn) || !linkDir(path.join(outDir, 'secrets'), aliasOut)) return skip('cannot create directory links');
  const cases = [
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', 'innocent/input.txt', '--run-id', 'run-0001']],
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', path.join(aliasOut, 'k.json'), '--run-id', 'run-0001']],
    ['merge-claude-settings', ['--run-id', 'run-0001', '--allow-file', path.join(aliasOut, 'k.json')]],
    ['env-keys', ['merge', '--keys', path.join(aliasOut, 'k.json'), '--run-id', 'run-0001']],
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', 'secrets/input.txt', '--run-id', 'run-0001']], // direct control
    ['blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', 'does-not-exist.txt', '--run-id', 'run-0001']], // unresolvable
  ];
  for (const [script, args] of cases) {
    const r = S(script, args, d);
    check(r.code !== 0 && !/SYNTHETIC_SECRET_R35/.test(r.stdout + r.stderr), `${script} ${args.slice(-3).join(' ')} refused`, r);
  }
  check(!fs.existsSync(path.join(d, '.ai', '.run', 'run-0001', 'drafts', 'AGENTS.md')), 'no draft written');
  put(path.join(d, 'notes', 'block.md'), 'ordinary\n');
  check(S('blocks', ['upsert', '--file', 'AGENTS.md', '--id', 'x', '--content', 'notes/block.md', '--run-id', 'run-0001'], d).code === 0, 'control: ordinary input accepted');
});

test('R36', 'detect matches overrides by exact runtime identity; plugin skills are never "disabled" by skillOverrides', () => {
  const d = repo({ 'src/a.ts': 'x\n' });
  const copy = (dest) => put(path.join(dest, 'SKILL.md'), '---\nname: project-setup\n---\n');
  copy(path.join(d, '.claude', 'skills', 'project-setup'));
  const ch = path.join(TMP, `ch36-${++n}`); copy(path.join(ch, 'skills', 'synced', 'alpha', 'project-setup'));
  const env = { CLAUDE_CONFIG_DIR: ch, CODEX_HOME: path.join(TMP, `cx36-${n}`) };
  put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'unrelated:project-setup': 'off' } }));
  const a = S('detect', [], d, env);
  check(a.json?.installConflicts?.claude?.length === 2 && !a.json.installs.some((i) => i.disabled), 'unrelated namespace disables nothing', a.json?.installs);
  put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'anthropic-skills:project-setup': 'off' } }));
  const b = S('detect', [], d, env);
  check(!b.json?.installConflicts?.claude && b.json.installs.find((i) => i.scope === 'synced')?.disabled === true, 'exact synced identity disables the synced copy', b.json?.installs);
  copy(path.join(ch, 'plugins', 'org-plugin', 'skills', 'project-setup'));
  put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { 'anthropic-skills:project-setup': 'off', 'org-plugin:project-setup': 'off' } }));
  const c = S('detect', [], d, env);
  const plugin = c.json?.installs?.find((i) => i.scope === 'plugin');
  check(plugin && plugin.disabled === false && /plugin skills/.test(plugin.note || '') && c.json.installConflicts?.claude?.length === 2, 'plugin copy stays active and counted, with a note', c.json?.installs);
});

test('R37', 'detect reports linked skill folders, dedups by target, and survives link cycles and dangling links', () => {
  const d = repo({ 'src/a.ts': 'x\n' });
  const real = path.join(TMP, `real-skill-${++n}`, 'project-setup'); put(path.join(real, 'SKILL.md'), '---\nname: project-setup\n---\n');
  const ch = path.join(TMP, `ch37-${n}`); fs.mkdirSync(path.join(ch, 'skills'), { recursive: true });
  if (!linkDir(real, path.join(ch, 'skills', 'project-setup'))) return skip('cannot create directory links');
  put(path.join(d, '.claude', 'skills', 'project-setup', 'SKILL.md'), '---\nname: project-setup\n---\n');
  fs.mkdirSync(path.join(ch, 'skills', 'loop')); linkDir(path.join(ch, 'skills'), path.join(ch, 'skills', 'loop', 'back')); // cycle
  linkDir(path.join(TMP, `missing-${n}`), path.join(ch, 'skills', 'dangling'));
  const env = { CLAUDE_CONFIG_DIR: ch, CODEX_HOME: path.join(TMP, `cx37-${n}`) };
  const r = S('detect', [], d, env);
  check(r.code === 0 && r.json?.installConflicts?.claude?.length === 2, 'linked user copy + repo copy = conflict', r.json?.installs);
  linkDir(real, path.join(ch, 'skills', 'synced-alias'));
  fs.mkdirSync(path.join(ch, 'skills', 'synced'), { recursive: true }); linkDir(real, path.join(ch, 'skills', 'synced', 'project-setup'));
  const r2 = S('detect', [], d, env);
  check(r2.json?.installs?.filter((i) => i.tool === 'claude').length === 2, 'two links to one target count once', r2.json?.installs);
});

test('R38', 'prepare treats present-but-malformed user permissions as user content', () => {
  const P = (d, extra = []) => prepare(d, 'run-0001', extra, { strict: true });
  for (const [name, cur, draft] of [
    ['deny string -> []', { permissions: { deny: 'Read(.env)' } }, { permissions: { deny: [] } }],
    ['deny string -> managed list', { permissions: { deny: 'Read(.env)' } }, { permissions: { deny: ['Read(**/.env)'] } }],
    ['permissions array -> object', { permissions: [] }, { permissions: { deny: ['Read(**/.env)'] } }],
    ['allow object -> []', { permissions: { allow: { x: 1 } } }, { permissions: { allow: [] } }],
  ]) {
    const d = repo({ '.claude/settings.json': JSON.stringify(cur) }); const r = begin(d);
    put(path.join(r, 'drafts', '.claude', 'settings.json'), JSON.stringify(draft));
    const p = P(d); check(p.code === 3 && /malformed/.test(JSON.stringify(p.json)), `${name}: requires approval`, p.json);
  }
  const d = repo({ '.claude/settings.json': JSON.stringify({ permissions: { deny: 'Read(.env)' }, hooks: {} }) }); const r = begin(d);
  put(path.join(r, 'drafts', '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: 'Read(.env)', allow: ['Bash(npm test)'] }, hooks: {} }));
  check(P(d).code === 0, 'control: malformed value kept as-is, new key added -> no approval needed');
});

// ======================================================= rc.11 review (R39) ====
test('R39', 'detect resolves skillOverrides by precedence (user -> shared project -> project-local) before "off"', () => {
  const copy = (dest) => put(path.join(dest, 'SKILL.md'), '---\nname: project-setup\n---\n');
  const run = (layers, key) => {
    const d = repo({ 'src/a.ts': 'x\n' });
    copy(path.join(d, '.claude', 'skills', 'project-setup'));
    const ch = path.join(TMP, `ch39-${++n}`); copy(path.join(ch, 'skills', 'synced', 'a', 'project-setup'));
    if (key === 'project-setup') copy(path.join(ch, 'skills', 'project-setup'));
    const [user, shared, local] = layers;
    if (user) put(path.join(ch, 'settings.json'), JSON.stringify({ skillOverrides: { [key]: user } }));
    if (shared) put(path.join(d, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { [key]: shared } }));
    if (local) put(path.join(d, '.claude', 'settings.local.json'), JSON.stringify({ skillOverrides: { [key]: local } }));
    return S('detect', [], d, { CLAUDE_CONFIG_DIR: ch, CODEX_HOME: path.join(TMP, `cx39-${n}`) }).json;
  };
  const synced = (j) => j?.installs?.find((i) => i.scope === 'synced')?.disabled;
  const userCopy = (j) => j?.installs?.find((i) => i.tool === 'claude' && i.scope === 'user')?.disabled;
  const S1 = 'anthropic-skills:project-setup';
  check(synced(run(['off', null, 'on'], S1)) === false, 'user off, project-local on -> enabled');
  check(synced(run(['off', 'name-only', null], S1)) === false, 'user off, shared name-only -> enabled');
  check(synced(run(['off', 'off', 'on'], S1)) === false, 'user off, shared off, local on -> enabled');
  check(synced(run(['on', 'off', null], S1)) === true, 'control: user on, shared off -> disabled');
  check(synced(run(['on', null, 'off'], S1)) === true, 'control: user on, local off -> disabled');
  check(synced(run(['off', null, null], S1)) === true, 'control: user off only -> disabled');
  const j = run(['off', null, 'on'], 'project-setup');
  check(userCopy(j) === false && j?.installConflicts?.claude?.length >= 2, 'plain identity re-enabled by local -> counted in conflict', j?.installs);
  check(run(['off', null, 'on'], 'project-setup')?.warnings?.every((w) => !/repo copy of project-setup is disabled/.test(w)), 'no false "repo copy disabled" warning');
});

// ======================================================= rc.12 review (R40) ====
test('R40', 'detect ignores invalid skillOverrides values (exact documented states only) and reports them', () => {
  const copy = (dest) => put(path.join(dest, 'SKILL.md'), '---\nname: project-setup\n---\n');
  const K = 'anthropic-skills:project-setup';
  const run = (user, shared, local) => {
    const d = repo({ 'src/a.ts': 'x\n' });
    copy(path.join(d, '.claude', 'skills', 'project-setup'));
    const ch = path.join(TMP, `ch40-${++n}`); copy(path.join(ch, 'skills', 'synced', 'a', 'project-setup'));
    const w = (file, v) => { if (v !== undefined) put(file, JSON.stringify({ skillOverrides: { [K]: v } })); };
    w(path.join(ch, 'settings.json'), user); w(path.join(d, '.claude', 'settings.json'), shared); w(path.join(d, '.claude', 'settings.local.json'), local);
    return S('detect', [], d, { CLAUDE_CONFIG_DIR: ch, CODEX_HOME: path.join(TMP, `cx40-${n}`) }).json;
  };
  const synced = (j) => j?.installs?.find((i) => i.scope === 'synced')?.disabled;
  for (const bad of [null, false, 42, {}, [], 'OFF', 'invalid', ' off ', 'On', '']) {
    const j = run('off', undefined, bad);
    check(synced(j) === true, `local ${JSON.stringify(bad)} does not displace user "off"`, j?.installs);
    check(j?.invalidOverrides?.some((x) => x.layer === 'project-local' && x.key === K) && j.warnings.some((w) => /invalid value/.test(w)), `local ${JSON.stringify(bad)} reported as invalid`, j?.invalidOverrides);
  }
  check(synced(run('off', 'bogus', 'on')) === false, 'valid higher "on" still wins over lower "off" with an invalid middle layer');
  check(synced(run('on', null, 'off')) === true, 'valid local "off" still applies with an invalid middle layer');
  const only = run(null, undefined, undefined);
  check(synced(only) === false && only?.invalidOverrides?.length === 1, 'invalid value alone disables nothing and is reported', only);
  const clean = run('off', undefined, 'user-invocable-only');
  check(synced(clean) === false && clean?.invalidOverrides?.length === 0, 'control: documented value overrides, nothing reported invalid', clean);
});

// ========================================================== success paths ====
const fill = (t) => t.replace(/{{PROJECT_NAME}}/g, 'pay-svc');
function freshSetup(d, id = 'run-0001') {
  const r = begin(d, id); const D = path.join(r, 'drafts'); const A = path.join(SKILL, 'assets');
  const agents = fill(read(path.join(A, 'templates', 'AGENTS.md')))
    .replace('{{ONE_LINE_PURPOSE}}', 'Payments service.').replace('{{STACK_WITH_VERSIONS}}', 'NestJS').replace('{{PACKAGE_MANAGER}}', 'npm')
    .replace('{{RUNTIME_VERSION}}', 'unknown').replace('{{DB_CHANGE_POLICY}}', 'unknown').replace('{{VERIFIED_COMMANDS}}', '- `npm test`')
    .replace('{{NESTED_INSTRUCTION_INDEX}}', '- none');
  put(path.join(D, 'AGENTS.md'), agents);
  put(path.join(D, 'CLAUDE.md'), read(path.join(A, 'templates', 'CLAUDE.md')));
  put(path.join(D, '.ai', 'agents', 'reviewer.md'), fill(read(path.join(A, 'agents', 'reviewer.md'))));
  put(path.join(D, '.ai', 'agents', 'docs-sync.md'), fill(read(path.join(A, 'agents', 'docs-sync.md'))));
  put(path.join(D, '.claude', 'agents', 'reviewer.md'), read(path.join(A, 'wrappers', 'claude-reviewer.md')));
  put(path.join(D, '.claude', 'agents', 'docs-sync.md'), read(path.join(A, 'wrappers', 'claude-docs-sync.md')));
  put(path.join(D, '.codex', 'agents', 'reviewer.toml'), read(path.join(A, 'wrappers', 'codex-reviewer.toml')));
  put(path.join(D, '.codex', 'agents', 'docs_sync.toml'), read(path.join(A, 'wrappers', 'codex-docs_sync.toml')));
  put(path.join(D, '.ai', 'security-paths.json'), read(path.join(SKILL, 'data', 'secret-paths.json')));
  put(path.join(D, '.ai', 'tools', 'git-safe.mjs'), read(path.join(A, 'tools', 'git-safe.mjs')));
  for (const f of ['project-tree', 'critical-modules', 'code-patterns', 'error-contract', 'configuration', 'glossary']) put(path.join(D, '.ai', 'context', `${f}.md`), `# ${f}\n`);
  put(path.join(D, '.ai', 'decisions', 'README.md'), '# Decisions\n');
  for (const f of ['api-conventions', 'database', 'observability']) put(path.join(D, 'docs', `${f}.md`), `# ${f}\n`);
  put(path.join(D, 'TODO.md'), '# TODO\n');
  const g = S('blocks', ['upsert', '--file', '.gitignore', '--id', 'gitignore', '--content', path.join(A, 'templates', 'gitignore-block.txt'), '--run-id', id], d);
  const m = S('merge-claude-settings', ['--run-id', id], d);
  return { r, g, m };
}

test('S01', 'fresh setup end to end, validate clean', () => {
  const d = repo({ 'package.json': '{"name":"pay-svc"}\n', 'src/a.ts': 'export {}\n', '.env.example': 'PORT=3000\n' });
  const det = S('detect', [], d); check(det.json?.mode === 'fresh', 'mode fresh', det.json?.mode);
  const { g, m } = freshSetup(d); check(g.code === 0 && m.code === 0 && m.json.needsDecision === false, 'drafts ok', [g.stdout, m.stdout]);
  put(path.join(d, 'keys.json'), JSON.stringify([{ name: 'DATABASE_URL', required: true, secret: true, description: 'DSN', group: 'Database' }]));
  check(S('env-keys', ['merge', '--keys', path.join(d, 'keys.json'), '--run-id', 'run-0001'], d).code === 0, 'env merge');
  const p = prepare(d); check(p.code === 0 && p.json.changed > 20, 'prepare', p.json);
  const c = commit(d, p); check(c.code === 0 && c.json.committed, 'commit', c);
  const v = S('validate', [], d); check(v.code === 0 && v.json.ok, 'validate clean', v.json?.results?.filter((x) => x.level !== 'pass'));
  check(read(path.join(d, '.env.example')).includes('DATABASE_URL=<REDACTED>') && read(path.join(d, '.env.example')).startsWith('PORT=3000'), 'env template merged, existing lines kept');
  check(S('detect', [], d).json?.mode === 'update', 'mode becomes update');
});

test('S02', 'rerun with identical inputs is a zero diff (files and manifest)', () => {
  const d = repo({ 'package.json': '{}\n', 'src/a.ts': 'x\n' });
  freshSetup(d); const p = prepare(d); commit(d, p);
  const before = read(path.join(d, '.ai', 'manifest.json'));
  S('lock', ['release', '--run-id', 'run-0001'], d);
  freshSetup(d, 'run-0002');
  const p2 = prepare(d, 'run-0002'); check(p2.code === 0 && p2.json.changed === 0, 'no changes', p2.json);
  const c2 = commit(d, p2, 'run-0002'); check(c2.code === 0 && c2.json.committed === false, 'zero diff commit', c2);
  check(read(path.join(d, '.ai', 'manifest.json')) === before, 'manifest byte-identical');
});

test('S03', 'CRLF checkouts: no false drift, line endings preserved', () => {
  const d = repo({ 'package.json': '{}\n', 'src/a.ts': 'x\n' });
  freshSetup(d); commit(d, prepare(d)); S('lock', ['release', '--run-id', 'run-0001'], d);
  for (const f of ['AGENTS.md', '.ai/agents/reviewer.md']) put(path.join(d, f), read(path.join(d, f)).replace(/\n/g, '\r\n'));
  const dr = S('blocks', ['drift', '--file', 'AGENTS.md'], d); check(dr.json?.blocks?.every((b) => b.state === 'unchanged'), 'blocks unchanged', dr.json);
  const df = S('blocks', ['drift', '--file', '.ai/agents/reviewer.md'], d); check(df.json?.userModified === false, 'full file unchanged', df.json);
  const r = begin(d, 'run-0002'); put(path.join(r, 'drafts', 'TODO.md'), '# TODO\n\n- item\n');
  put(path.join(d, 'TODO.md'), '# TODO\r\n'); git(['add', '-A'], d); git(['commit', '-qm', 'crlf'], d);
  const p = prepare(d, 'run-0002'); check(commit(d, p, 'run-0002').code === 0 && read(path.join(d, 'TODO.md')) === '# TODO\r\n\r\n- item\r\n', 'CRLF kept on write', p);
});

test('S04', 'normal rollback after commit is complete and cleanup succeeds', () => {
  const d = repo({ 'TODO.md': 'ORIGINAL\n' });
  const r = begin(d); put(path.join(r, 'drafts', 'TODO.md'), 'APPLIED\n'); put(path.join(r, 'drafts', 'docs', 'new.md'), '# new\n');
  commit(d, prepare(d));
  const rb = S('apply', ['rollback', '--run-id', 'run-0001'], d);
  check(rb.code === 0 && rb.json.complete === true, 'complete', rb);
  check(read(path.join(d, 'TODO.md')) === 'ORIGINAL\n' && !fs.existsSync(path.join(d, 'docs')) && !fs.existsSync(path.join(d, '.ai', 'manifest.json')), 'restored, created files and dirs removed');
  check(S('apply', ['cleanup', '--run-id', 'run-0001'], d).code === 0, 'cleanup ok');
});

test('S05', 'lock contention and explicit break', () => {
  const d = repo({ 'a.txt': 'a\n' });
  check(S('lock', ['acquire', '--run-id', 'run-aaaa'], d).code === 0, 'acquire');
  check(S('lock', ['acquire', '--run-id', 'run-bbbb'], d).code === 2, 'second run blocked');
  check(S('lock', ['break', '--confirm-run-id', 'run-bbbb'], d).code === 2, 'break with wrong id refused');
  check(S('lock', ['break', '--confirm-run-id', 'run-aaaa'], d).code === 0, 'break with owner id');
  check(git(['status', '--porcelain'], d).stdout.trim() === '', 'lock dir never visible to git');
});

test('S06', 'env-keys never opens .env and never prints values', () => {
  const d = repo({ '.env': 'X=1\n', '.env.example': 'DB_PASSWORD=Sup3rSecretValue\nPORT=3000\nJWT_SECRET=\n' }, false);
  check(S('env-keys', ['keys', '--file', '.env'], d).code !== 0, '.env refused');
  const k = S('env-keys', ['keys', '--file', '.env.example'], d);
  check(k.code === 0 && !k.stdout.includes('Sup3rSecretValue') && k.json.possibleRealSecrets.includes('DB_PASSWORD'), 'names + classification only', k);
});

test('S07', 'installer happy path: install, unchanged rerun, upgrade, verify, rollback', () => {
  const src = sourceCopy('8.0.0-a'); const c = path.join(TMP, `c-${n}`), x = path.join(TMP, `x-${n}`); const a = ['--claude-dir', c, '--codex-dir', x];
  check(inst(src, ['--dry-run', ...a]).code === 0 && !fs.existsSync(path.join(c, 'project-setup')), 'dry run changes nothing');
  check(inst(src, a).code === 0, 'install');
  const re = inst(src, a); check(re.code === 0 && re.json.results.every((r) => r.action === 'unchanged'), 'rerun unchanged', re);
  fs.writeFileSync(path.join(src, 'VERSION'), '8.0.0-b\n');
  check(inst(src, a).code === 0 && installedVersion(c) === '8.0.0-b' && installedVersion(x) === '8.0.0-b', 'upgrade both');
  check(inst(src, ['verify', ...a]).code === 0, 'verify ok');
  const rb = inst(src, ['rollback', ...a]); check(rb.code === 0 && installedVersion(c) === '8.0.0-a' && installedVersion(x) === '8.0.0-a', 'rollback both to previous', rb);
  put(path.join(HOME, '.claude', 'plugins', 'm', 'skills', 'project-setup', 'SKILL.md'), 'x\n');
  check(inst(src, a).code === 2, 'plugin copy stops install');
  fs.rmSync(path.join(HOME, '.claude'), { recursive: true, force: true });
});

test('S08', 'canary setup/probe/verify measure readability', () => {
  const d = repo({ 'a.txt': 'a\n' });
  check(S('canary', ['setup', '--run-id', 'cn-0001'], d).code === 0, 'setup');
  const p = S('canary', ['probe', '--run-id', 'cn-0001'], d); check(p.code === 0 && p.json.results.length === 4, 'probe reports 4 files', p);
  const tok = read(path.join(d, '.ai', '.canary', 'cn-0001', '.env')).split('=')[1].trim();
  const v = S('canary', ['verify', '--run-id', 'cn-0001', '--observed', `x ${tok} y`], d); check(v.json?.verdict === 'READ-SUCCEEDED', 'leak detected', v);
  check(!p.stdout.includes(tok), 'probe never prints tokens');
  check(git(['status', '--porcelain'], d).stdout.trim() === '?? a.txt' || git(['status', '--porcelain'], d).stdout.trim() === '', 'canary dir ignored');
});

test('S09', 'rejects writes outside documentation scope and through secret drafts', () => {
  const d = repo({ 'a.txt': 'a\n' });
  const r = begin(d);
  put(path.join(r, 'drafts', 'src', 'x.ts'), 'x\n'); check(prepare(d).code === 3, 'src/ rejected');
  fs.rmSync(path.join(r, 'drafts', 'src'), { recursive: true });
  put(path.join(r, 'drafts', '.env.example'), 'X=\n'); check(prepare(d).code === 3, 'draft to env template rejected (vault only)');
});

// ================================================================ runner ====
for (const t of tests) {
  if (only && !`${t.id} ${t.name}`.includes(only)) continue;
  current = { id: t.id, name: t.name, failures: [], skipped: null };
  try { t.fn(); } catch (e) { current.failures.push(`threw: ${e.stack || e}`); }
  results.push(current);
  const tag = current.skipped ? 'SKIP' : current.failures.length ? 'FAIL' : 'PASS';
  process.stdout.write(`${tag}  ${t.id}  ${t.name}${current.skipped ? `  (${current.skipped})` : ''}\n`);
  for (const f of current.failures) process.stdout.write(`        - ${f}\n`);
}
const summary = {
  passed: results.filter((r) => !r.skipped && !r.failures.length).length,
  failed: results.filter((r) => r.failures.length).length,
  skipped: results.filter((r) => r.skipped).length,
};
const env = { platform: process.platform, release: os.release(), node: process.version, git: git(['--version'], TMP).stdout.trim() };
fs.writeFileSync(path.join(TMP, 'results.json'), JSON.stringify({ env, summary, results }, null, 2));
process.stdout.write(`\n${JSON.stringify({ env, summary, resultsFile: path.join(TMP, 'results.json') })}\n`);
if (!argv.includes('--keep') && !summary.failed) fs.rmSync(TMP, { recursive: true, force: true });
process.exit(summary.failed ? 1 : 0);
