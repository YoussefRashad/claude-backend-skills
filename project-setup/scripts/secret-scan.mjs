#!/usr/bin/env node
// Optional local secret scan. Scope and limits are explicit:
//   - runs only if `gitleaks` is installed locally; nothing is uploaded anywhere;
//   - uses --redact; the raw JSON report stays in the run vault (denied to agents);
//   - prints only file, line, rule id, and commit; never the match;
//   - if gitleaks is missing or fails, the result is "not-scanned", never "clean".
//
// Usage: node secret-scan.mjs --run-id <id> [--scope worktree|history]
//   worktree (default): files currently in the working tree (gitleaks dir)
//   history: full git history (gitleaks git); slower, finds secrets that were committed and later removed
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, repoRoot, run, IS_WINDOWS, ok, fail, validateRunId, secureDir, assertNotLink } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const root = repoRoot();
if (!root) fail('not inside a git repository');
let runId;
try { runId = validateRunId(args['run-id']); } catch (e) { fail(e.message); }
const scope = args.scope === 'history' ? 'history' : 'worktree';

let vault;
try { vault = secureDir(root, ['.ai', '.run', runId, 'vault']); } catch (e) { fail(e.message, 2); }
if (!vault) fail('run not initialised; run apply.mjs init first');
const report = path.join(vault, `gitleaks-${scope}.json`);
try { assertNotLink(report); } catch (e) { fail(e.message, 2); }

const bin = args.gitleaks && args.gitleaks !== true ? String(args.gitleaks) : 'gitleaks';
const probe = IS_WINDOWS ? run(`${bin} version`, [], { shell: true }) : run(bin, ['version']);
if (probe.status !== 0) { ok({ status: 'not-scanned', reason: 'gitleaks not installed', scope }); process.exit(0); }

const common = ['--redact', '--no-banner', '--report-format', 'json', '--report-path', report, '--exit-code', '0'];
const argv = scope === 'history' ? ['git', ...common, root] : ['dir', ...common, root];
const r = IS_WINDOWS ? run([bin, ...argv.map((a) => `"${a}"`)].join(' '), [], { shell: true, cwd: root }) : run(bin, argv, { cwd: root });
if (r.status !== 0 || !fs.existsSync(report)) {
  ok({ status: 'not-scanned', reason: `gitleaks failed (exit ${r.status})`, scope, version: probe.stdout });
  process.exit(0);
}
let findings = [];
try { findings = JSON.parse(fs.readFileSync(report, 'utf8') || '[]'); } catch { ok({ status: 'not-scanned', reason: 'unreadable report', scope }); process.exit(0); }
const rel = (f) => path.relative(root, path.isAbsolute(f) ? f : path.join(root, f)).split(path.sep).join('/');
const items = findings
  .map((f) => ({ file: rel(f.File || ''), line: f.StartLine ?? null, rule: f.RuleID || 'unknown', commit: f.Commit ? String(f.Commit).slice(0, 8) : null }))
  .filter((f) => !f.file.startsWith('.ai/.run/') && !f.file.startsWith('.ai/.canary/'));
ok({ status: 'scanned', scope, tool: `gitleaks ${probe.stdout}`, findings: items, count: items.length, note: 'Matches are redacted and not shown. Report file:line:rule to the user; never open the files.' });
