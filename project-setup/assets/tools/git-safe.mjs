#!/usr/bin/env node
// Installed into projects by project-setup v2 as .ai/tools/git-safe.mjs (fully managed).
// Read-only git with secret paths excluded and no shell (identical behaviour in Bash and PowerShell).
//
//   node .ai/tools/git-safe.mjs diff <base>...HEAD [--name-status|--stat] [-- <paths>]
//   node .ai/tools/git-safe.mjs log -p <range> [-n5] [-- <paths>]
//   node .ai/tools/git-safe.mjs show <commit> [-- <paths>]
//
// Why revision arguments are restricted: pathspec excludes only filter the *diff* of commits.
// They do not apply to object forms such as `HEAD:.env`, `:.env`, a blob/tree id, or `--no-index`,
// which print file content directly. Every revision argument must therefore resolve to a commit.
// Options that take a separate value must be written attached (`-n5`, `--max-count=5`).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function die(msg) { process.stderr.write(`git-safe: ${msg}\n`); process.exit(2); }

// Strip environment that changes pathspec semantics or injects configuration/programs.
const env = { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' };
for (const k of Object.keys(env)) {
  if (/^GIT_(LITERAL|GLOB|NOGLOB|ICASE)_PATHSPECS$/.test(k) || /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/.test(k)
    || ['GIT_EXTERNAL_DIFF', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'].includes(k)) delete env[k];
}
const git = (args, opts = {}) => spawnSync('git', ['--no-pager', ...args], { encoding: 'utf8', env, windowsHide: true, ...opts });

const top = git(['rev-parse', '--show-toplevel']);
const root = (top.stdout || '').trim();
if (top.status !== 0 || !root) die('not inside a git repository');
let spec;
try { spec = JSON.parse(fs.readFileSync(path.join(root, '.ai', 'security-paths.json'), 'utf8')); } catch { die('.ai/security-paths.json missing or invalid; refusing to run without the secret list'); }
if (!Array.isArray(spec.patterns) || !spec.patterns.length) die('.ai/security-paths.json has no patterns');
const excludes = spec.patterns.map((p) => `:(exclude,glob,icase)${p.glob}`);

const [sub, ...rest] = process.argv.slice(2);
if (!['diff', 'log', 'show'].includes(sub)) die('only diff, log, show are allowed');

const dd = rest.indexOf('--');
const before = dd === -1 ? rest : rest.slice(0, dd);
const paths = dd === -1 ? [] : rest.slice(dd + 1);

// -L<range>:<file> prints file content directly (pathspec excludes do not apply); --contents/--no-follow-links read files.
const BLOCKED = /^(--no-index|--output|--ext-diff|--textconv|-c$|-c.|--exec|--upload-pack|--config|--git-dir|--work-tree|--pathspec-from-file|--pathspec-file-nul|--stdin|-O|--orderfile|-L|--line-range|--contents)/;
const options = [];
const revisions = [];
for (const a of before) {
  if (a.startsWith('-')) {
    if (BLOCKED.test(a)) die(`blocked option: ${a}`);
    options.push(a);
  } else revisions.push(a);
}

function assertCommit(rev) {
  if (rev === '') return; // open end of a range ("A..") means HEAD
  const r = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`], { cwd: root });
  if (r.status !== 0) die(`revision "${rev}" is not a commit (blob, tree, path, or unknown objects are not allowed)`);
}
for (const rev of revisions) {
  if (rev.includes(':')) die(`revision "${rev}" uses <rev>:<path> or :<path> syntax, which bypasses the secret excludes`);
  if (/[\s\0]/.test(rev)) die(`invalid revision "${rev}"`);
  const core = rev.replace(/^\^/, '').replace(/\^[!@]$/, '').replace(/\^-\d*$/, '');
  for (const part of core.split(/\.\.\.?/)) assertCommit(part);
}
for (const p of paths) if (p.includes('\0')) die('invalid path');

const args = [sub, '--no-ext-diff', '--no-textconv', ...options, ...revisions, '--', ...(paths.length ? paths : ['.']), ...excludes];
const r = spawnSync('git', ['--no-pager', ...args], { cwd: root, stdio: 'inherit', env, windowsHide: true });
process.exit(r.status ?? 1);
