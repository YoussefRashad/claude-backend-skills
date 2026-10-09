#!/usr/bin/env node
// Static validation of the generated setup. Reports evidence; it does NOT prove runtime loading
// (that is verified per tool in the session, see references/security.md "Load verification").
//
// Usage: node validate.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import {
  repoRoot, git, readJsonFile, normalizedHash, loadSecretSpec, isSecretPath, ok, fail, SKILL_DIR,
} from './lib.mjs';
import { parseBlocks, blockHashes } from './blocks.mjs';
import { checkClaudeSettings, checkManifest } from './schemas.mjs';
import { parseToml } from './toml.mjs';

const root = repoRoot();
if (!root) fail('not inside a git repository');
const spec = loadSecretSpec();
const results = [];
const add = (level, check, detail) => results.push({ level, check, detail });
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).stdout
  .split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'))
  .filter((p) => !p.startsWith('.ai/.run/') && !p.startsWith('.ai/.canary/') && !p.includes('node_modules/'));

// 1. JSON: syntax AND shape (valid JSON with wrong types is still broken configuration)
const jsonChecks = { '.claude/settings.json': checkClaudeSettings, '.ai/manifest.json': checkManifest };
for (const [rel, check] of Object.entries(jsonChecks)) {
  if (!exists(rel)) continue;
  let data;
  try { data = readJsonFile(path.join(root, rel)); } catch (e) { add('fail', 'json-syntax', `${rel}: ${e.message}`); continue; }
  const found = check(data).map((e) => (typeof e === 'string' ? { level: 'fail', msg: e } : e));
  found.forEach((e) => add(e.level, 'json-schema', `${rel}: ${e.msg}`));
  if (!found.some((e) => e.level === 'fail')) add('pass', 'json-schema', rel);
}

// 2. Codex agent wrappers: real TOML parse (subset), required string keys, no legacy sandbox
for (const rel of files.filter((p) => /^\.codex\/agents\/[^/]+\.toml$/.test(p))) {
  const { data, errors, unsupported } = parseToml(read(rel));
  errors.forEach((e) => add('fail', 'toml-syntax', `${rel}: ${e}`));
  // Unsupported constructs are never reported as a successful validation.
  unsupported.forEach((e) => add('fail', 'toml-unsupported', `${rel}: ${e}`));
  if (errors.length || unsupported.length) continue;
  for (const key of ['name', 'description', 'developer_instructions']) {
    if (typeof data[key] !== 'string' || !data[key].trim()) add('fail', 'codex-agent-schema', `${rel}: ${key} must be a non-empty string`);
  }
  if ('sandbox_mode' in data) add('fail', 'codex-agent-sandbox', `${rel}: sets sandbox_mode, which switches that agent to legacy sandbox settings and drops deny-read profiles`);
  const ref = (String(data.developer_instructions || '').match(/\.ai\/agents\/[A-Za-z0-9_-]+\.md/) || [])[0];
  if (!ref || !exists(ref)) add('fail', 'wrapper-target', `${rel}: canonical prompt ${ref || '(none)'} not found`);
  else add('pass', 'codex-agent', rel);
}
for (const rel of files.filter((p) => /^\.claude\/agents\/[^/]+\.md$/.test(p))) {
  const ref = (read(rel).match(/\.ai\/agents\/[A-Za-z0-9_-]+\.md/) || [])[0];
  if (ref && !exists(ref)) add('fail', 'wrapper-target', `${rel}: ${ref} not found`);
}

// 3. Instruction files: size, imports, sibling pairing
const agentsFiles = files.filter((p) => /(^|\/)AGENTS\.md$/.test(p));
const claudeFiles = files.filter((p) => /(^|\/)CLAUDE\.md$/.test(p));
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
for (const rel of agentsFiles) {
  const t = read(rel);
  const lines = t.split(/\r?\n/).length; const bytes = Buffer.byteLength(t);
  if (bytes > 32 * 1024) add('fail', 'agents-size', `${rel}: ${bytes} bytes exceeds Codex's default 32 KiB project-doc budget; content past it is not loaded`);
  else if (lines > 150) add('warn', 'agents-size', `${rel}: ${lines} lines (target <= 150)`);
  else add('pass', 'agents-size', `${rel}: ${lines} lines, ${bytes} bytes`);
  const dir = path.posix.dirname(rel); const sibling = dir === '.' ? 'CLAUDE.md' : `${dir}/CLAUDE.md`;
  if (!exists(sibling)) add('warn', 'claude-pairing', `${rel}: no sibling CLAUDE.md; Claude will not load it while a root CLAUDE.md exists (default mode)`);
  if (/@[\w./-]+\.md/.test(stripCode(t))) add('warn', 'agents-imports', `${rel}: contains @path text; Claude expands it eagerly through the CLAUDE.md import, Codex treats it as plain text`);
}
for (const rel of claudeFiles) {
  const t = read(rel); const lines = t.split(/\r?\n/).length;
  const dir = path.posix.dirname(rel); const agentsSibling = dir === '.' ? 'AGENTS.md' : `${dir}/AGENTS.md`;
  if (exists(agentsSibling) && !/(^|\s)@(\.\/)?AGENTS\.md(\s|$)/m.test(stripCode(t))) add('fail', 'claude-import', `${rel}: sibling AGENTS.md exists but is not imported with @AGENTS.md`);
  if (lines > 200) add('warn', 'claude-size', `${rel}: ${lines} lines (target < 200)`);
  for (const m of stripCode(t).matchAll(/(?:^|\s)@([\w./-]+)/g)) {
    const target = path.posix.normalize(path.posix.join(dir, m[1]));
    if (!exists(target)) add('fail', 'claude-import-target', `${rel}: @${m[1]} -> ${target} does not exist`);
  }
}

// 4. Path references in generated docs must exist
const REF = /`((?:\.ai|docs|\.claude|\.codex)\/[\w./-]+\.(?:md|json|toml|mjs))`|\]\(((?:\.\/)?(?:\.ai|docs|\.claude|\.codex)\/[^)#\s]+)\)/g;
for (const rel of [...agentsFiles, ...claudeFiles, ...files.filter((p) => /^\.ai\/agents\/.+\.md$/.test(p))]) {
  for (const m of read(rel).matchAll(REF)) {
    const target = (m[1] || m[2]).replace(/^\.\//, '');
    if (!exists(target)) add('fail', 'reference-exists', `${rel}: ${target} not found`);
  }
}

// 5. Managed markers and drift against the manifest
let manifest = null;
if (exists('.ai/manifest.json')) { try { manifest = readJsonFile(path.join(root, '.ai/manifest.json')); } catch { /* reported above */ } }
for (const rel of files.filter((p) => /\.(md|gitignore)$/.test(p) || p === '.gitignore')) {
  if (isSecretPath(rel, spec)) continue;
  const { errors } = parseBlocks(read(rel));
  if (errors.length) add('fail', 'markers', `${rel}: ${errors.join('; ')}`);
}
if (manifest?.files) {
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (!exists(rel)) { add('warn', 'drift', `${rel}: in manifest but missing on disk`); continue; }
    if (isSecretPath(rel, spec)) continue;
    if (entry.ownership === 'full' && normalizedHash(read(rel)) !== entry.sha256) add('warn', 'drift', `${rel}: fully-managed file edited since install (will not be overwritten without consent)`);
    if (entry.ownership === 'blocks') {
      const { hashes } = blockHashes(read(rel));
      for (const [id, sha] of Object.entries(entry.blocks || {})) {
        if (hashes[id] === undefined) add('warn', 'drift', `${rel}: managed block ${id} removed by user`);
        else if (hashes[id] !== sha) add('warn', 'drift', `${rel}: managed block ${id} edited by user`);
      }
    }
  }
}

// 6. Secret-shaped content in generated, non-secret files. Reports file:line:rule only.
const RULES = [
  ['canary-token', /PROJECT_SETUP_CANARY_[0-9a-f]{24}/],
  ['aws-access-key', /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['private-key-block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['url-credentials', /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@<>]{3,}@/i],
  ['assigned-secret', /\b(password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?(?!<|\$\{|process\.env|REDACTED|changeme|your)[^\s"'`]{8,}/i],
];
const generated = manifest?.files ? Object.keys(manifest.files) : [...agentsFiles, ...claudeFiles];
let hits = 0;
for (const rel of generated) {
  if (!exists(rel) || isSecretPath(rel, spec)) continue;
  read(rel).split(/\r?\n/).forEach((line, i) => {
    for (const [rule, re] of RULES) if (re.test(line)) { hits++; add('fail', 'secret-shaped-content', `${rel}:${i + 1} (${rule})`); }
  });
}
if (!hits) add('pass', 'secret-shaped-content', `${generated.length} generated files scanned (pattern-based; not a guarantee)`);

// 7. Project-local security tooling
if (exists('.ai/agents')) {
  for (const rel of ['.ai/security-paths.json', '.ai/tools/git-safe.mjs']) if (!exists(rel)) add('fail', 'security-tooling', `${rel} missing; shared agents depend on it`);
  if (exists('.ai/security-paths.json')) {
    const skillCopy = fs.readFileSync(path.join(SKILL_DIR, 'data', 'secret-paths.json'), 'utf8');
    if (normalizedHash(read('.ai/security-paths.json')) !== normalizedHash(skillCopy)) add('warn', 'security-tooling', '.ai/security-paths.json differs from this skill version (older install or local edit)');
  }
}

// 8. Hygiene
if (exists('.claudeignore')) add('warn', 'claudeignore', '.claudeignore has no effect in Claude Code; ensure its entries exist as Read deny rules');
const gi = exists('.gitignore') ? read('.gitignore') : '';
for (const needle of ['.claude/settings.local.json', 'CLAUDE.local.md']) if (!gi.includes(needle)) add('warn', 'gitignore', `${needle} not ignored`);
if (!exists('.ai/.run/.gitignore') && exists('.ai/.run')) add('fail', 'run-dir-ignored', '.ai/.run has no self-ignore file');

const summary = { pass: results.filter((r) => r.level === 'pass').length, warn: results.filter((r) => r.level === 'warn').length, fail: results.filter((r) => r.level === 'fail').length };
process.stdout.write(JSON.stringify({ ok: summary.fail === 0, summary, results }, null, 2) + '\n');
process.exitCode = summary.fail ? 1 : 0;
