#!/usr/bin/env node
// Merge managed permission entries into .claude/settings.json. Writes a DRAFT only.
//
// Rules (see references/claude.md):
//   - Only permissions.deny and permissions.allow are touched; every other key is left byte-for-byte equivalent.
//   - User entries are never removed or reordered.
//   - Missing managed entries are APPENDED at the end of their array. Gitignore-style "!" negations carve
//     exceptions out of rules listed BEFORE them, so appending keeps user negations from weakening managed rules.
//   - A managed rule that already sits before a user negation is reported as a conflict, not "fixed".
//   - Allow entries are only added when explicitly confirmed (--allow-file), never inferred from package.json.
//
// Usage: node merge-claude-settings.mjs --run-id <id> [--allow-file <json array of rules>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, repoRoot, detectEol, normalizeText, ok, fail, SKILL_DIR, validateRunId, secureDir, writeInRepo, readInRepo, assertNotSecretInput } from './lib.mjs';
import { globsMayOverlap } from './globs.mjs';

const args = parseArgs(process.argv.slice(2));
let runId;
try { runId = validateRunId(args['run-id']); } catch (e) { fail(e.message); }
const root = repoRoot();
if (!root) fail('not inside a git repository');
let runDir;
try { runDir = secureDir(root, ['.ai', '.run', runId]); } catch (e) { fail(e.message, 2); }
if (!runDir) fail('run not initialised; run apply.mjs init first');
const overrideExceptions = Boolean(args['override-user-exceptions']);

const rendered = JSON.parse(spawnSync(process.execPath, [path.join(SKILL_DIR, 'scripts', 'render-permissions.mjs'), 'json'], { encoding: 'utf8' }).stdout);
const managedDeny = rendered.claude.permissionsDeny;
let managedAllow = [];
if (args['allow-file'] && args['allow-file'] !== true) {
  let p; try { p = assertNotSecretInput(args['allow-file']); } catch (e) { fail(e.message, 2); }
  try { managedAllow = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { fail('--allow-file is not valid JSON (content not shown)', 3); }
}
if (!Array.isArray(managedAllow) || managedAllow.some((x) => typeof x !== 'string')) fail('--allow-file must contain a JSON array of rule strings');
const broadAllow = managedAllow.filter((r) => /^(Bash|PowerShell)(\(\*\))?$/.test(r) || /^(Bash|PowerShell)\([^ )]*\*\)$/.test(r));
if (broadAllow.length) fail('refusing broad allow rules; allow specific commands only', 3, { broadAllow });

const target = path.join(root, '.claude', 'settings.json');
let original = null; let settings;
if (fs.existsSync(target)) {
  original = fs.readFileSync(target, 'utf8');
  try { settings = JSON.parse(original.replace(/^\uFEFF/, '')); } catch (e) { fail(`.claude/settings.json is not valid JSON; refusing to merge (${e.message})`, 3); }
} else {
  settings = { $schema: 'https://json.schemastore.org/claude-code-settings.json' };
}

const report = { added: { deny: [], allow: [] }, alreadyPresent: [], conflicts: [], ineffective: [], malformedHooks: [], info: [] };
settings.permissions ??= {};
const perms = settings.permissions;
perms.deny ??= [];
perms.allow ??= [];
if (!Array.isArray(perms.deny) || !Array.isArray(perms.allow)) fail('permissions.deny/allow must be arrays', 3);

const isNegation = (r) => /^(Read|Edit)\(!/.test(r);
const ruleTool = (r) => (r.match(/^(\w+)\(/) || [])[1];
const ruleBody = (r) => r.replace(/^\w+\(!?/, '').replace(/\)$/, '');
const userNegations = perms.deny.filter(isNegation);
report.heldBack = [];

for (const rule of managedDeny) {
  const idx = perms.deny.indexOf(rule);
  if (idx === -1) {
    // Appending after a user negation silently cancels that exception for every path the rule covers.
    const cancels = /^(Read|Edit)\(/.test(rule)
      // Sound overlap test: deferred unless the two patterns are provably disjoint (wildcards included).
      ? userNegations.filter((n) => ruleTool(n) === ruleTool(rule) && globsMayOverlap(ruleBody(rule), ruleBody(n)))
      : [];
    if (cancels.length) {
      report.conflicts.push({ rule, overridesUserExceptions: cancels, effect: 'appending this rule cancels the user exception(s); decision required' });
      if (!overrideExceptions) { report.heldBack.push(rule); continue; }
    }
    perms.deny.push(rule); report.added.deny.push(rule); continue;
  }
  report.alreadyPresent.push(rule);
  const laterNegations = perms.deny.slice(idx + 1).filter(isNegation);
  if (laterNegations.length && /^(Read|Edit)\(/.test(rule)) {
    report.conflicts.push({ rule, carvedBy: laterNegations, effect: 'user negations after this rule may exempt paths from it; review with the user' });
  }
}
for (const rule of managedAllow) {
  if (perms.allow.includes(rule)) { report.alreadyPresent.push(rule); continue; }
  perms.allow.push(rule); report.added.allow.push(rule);
}

// Known-ineffective v1 entries: SQL is not a shell command; these patterns never match a real invocation.
for (const rule of perms.deny) {
  if (/^Bash\((DROP|TRUNCATE|DELETE|ALTER)\b/i.test(rule)) report.ineffective.push({ rule, why: 'SQL text is not a shell command; protect databases with least-privilege DB users' });
}
const negations = perms.deny.filter(isNegation);
if (negations.length) report.info.push({ userNegations: negations });
const overlapping = perms.allow.filter((a) => /^(Read|Edit)\(/.test(a));
if (overlapping.length) report.info.push({ fileAllowRules: overlapping, note: 'deny is evaluated before allow, so managed Read denies still win' });

// v1 emitted {"matcher": ..., "command": ...}; the current schema nests {"hooks":[{"type":"command","command":...}]}.
for (const [event, entries] of Object.entries(settings.hooks || {})) {
  (Array.isArray(entries) ? entries : []).forEach((h, i) => {
    if (h && typeof h === 'object' && 'command' in h && !('hooks' in h)) report.malformedHooks.push({ event, index: i, matcher: h.matcher ?? null, note: 'legacy shape; Claude Code does not run it. Ask the user: remove or convert.' });
  });
}

const indentMatch = original?.match(/\n([ \t]+)"/);
const indent = indentMatch ? indentMatch[1] : 2;
let out = JSON.stringify(settings, null, indent) + '\n';
if (original && detectEol(original) === '\r\n') out = out.replace(/\n/g, '\r\n');

const changed = !original || normalizeText(original) !== normalizeText(out);
if (changed) {
  try { writeInRepo(root, `.ai/.run/${runId}/drafts/.claude/settings.json`, out); } catch (e) { fail(e.message, 2); }
}
const writeMerged = (file, key, value) => {
  const rel = `.ai/.run/${runId}/${file}`;
  let cur = {};
  try { cur = JSON.parse(readInRepo(root, rel).toString('utf8')); } catch (e) { if (e.code !== 'ENOENT') fail(`${file}: ${e.message}`, 2); }
  cur[key] = value;
  try { writeInRepo(root, rel, JSON.stringify(cur, null, 2) + '\n', { createDirs: false }); } catch (e) { fail(e.message, 2); }
};
writeMerged('ownership.json', '.claude/settings.json', 'keys');
const appliedDeny = managedDeny.filter((r) => !report.heldBack.includes(r));
writeMerged('managed-keys.json', '.claude/settings.json', { 'permissions.deny': appliedDeny, 'permissions.allow': managedAllow, heldBack: report.heldBack });

const needsDecision = report.conflicts.length > 0;
ok({
  changed, needsDecision,
  draft: changed ? '.ai/.run/' + runId + '/drafts/.claude/settings.json' : null,
  report,
  next: needsDecision ? 'Show conflicts to the user. Held-back rules are NOT in the draft. Re-run with --override-user-exceptions only if the user chooses to cancel their exceptions.' : undefined,
});
