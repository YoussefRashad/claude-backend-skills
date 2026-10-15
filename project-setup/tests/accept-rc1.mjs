#!/usr/bin/env node
// Strict rc.1 acceptance gate.
//   node project-setup/tests/accept-rc1.mjs                 full acceptance (all 100 required cases)
//   node project-setup/tests/accept-rc1.mjs --only <id>     focused acceptance of one required case
//
// Plan: docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md sections 2.7 and 3.3, with decisions G12-G14.
// Runs exactly one suite child (run-tests.mjs --keep [--only-id <id>]), forwards its stdout unchanged, retains the
// captured streams as evidence and validates the transcript plus the retained results file. Acceptance needs an
// anchored "PASS  <id>  " stdout record for every required case; the only permitted skip is R13d on win32 with the
// recorded privilege reason, and only in a full run. Focused acceptance never replaces full acceptance.
//
// validateSuiteEvidence() is pure. main() is import-safe and never writes process streams or exits.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_CASE_IDS } from './rc1-cases.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SKILL, '..');
const RUN_TESTS = path.join(SKILL, 'tests', 'run-tests.mjs');
const R13D_REASON = 'cannot create file symlink (Windows without Developer Mode)';
const FULL_TOTALS = [{ passed: 100, failed: 0, skipped: 0 }, { passed: 99, failed: 0, skipped: 1 }];
const FOCUSED_TOTALS = { passed: 1, failed: 0, skipped: 0 };

// ------------------------------------------------------------- parsing ----
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o, keys) => isObj(o) && Object.keys(o).sort().join(',') === [...keys].sort().join(',');
const count = (n) => Number.isInteger(n) && n >= 0;
const validSummary = (s) => exactKeys(s, ['passed', 'failed', 'skipped']) && count(s.passed) && count(s.failed) && count(s.skipped);
const validEnv = (e) => exactKeys(e, ['platform', 'release', 'node', 'git']) && Object.values(e).every((v) => typeof v === 'string' && v !== '');
const sameSummary = (a, b) => a.passed === b.passed && a.failed === b.failed && a.skipped === b.skipped;

// CRLF framing is accepted: lines split on LF with one trailing CR removed. Raw streams are never altered.
const linesOf = (text) => String(text).split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

// The envelope is usable only when exactly one envelope-shaped line exists, it is the last nonempty line, and it has
// the exact structure of plan 3.2 with an absolute results path.
function parseEnvelope(stdout) {
  const lines = linesOf(stdout);
  const candidates = lines.filter((l) => l.trimStart().startsWith('{'));
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const last = nonEmpty[nonEmpty.length - 1];
  if (candidates.length !== 1 || last === undefined || last !== candidates[0]) return null;
  let o;
  try { o = JSON.parse(last); } catch { return null; }
  if (!exactKeys(o, ['env', 'summary', 'resultsFile']) || !validEnv(o.env) || !validSummary(o.summary)) return null;
  if (typeof o.resultsFile !== 'string' || o.resultsFile === '' || !path.isAbsolute(o.resultsFile)) return null;
  return o;
}

const KEYWORD = /^(PASS|FAIL|SKIP)(\s|$)/;
const PASS_FAIL = /^(PASS|FAIL) {2}(\S+) {2}(\S.*)$/;
const SKIP_RE = /^SKIP {2}(\S+) {2}(\S.*?) {2}\((.+)\)$/;
function parseRecords(stdout) {
  const records = [];
  for (const line of linesOf(stdout)) {
    if (!KEYWORD.test(line)) continue;
    let m = PASS_FAIL.exec(line);
    if (m) { records.push({ kind: m[1], id: m[2], name: m[3], reason: null }); continue; }
    m = SKIP_RE.exec(line);
    if (m) { records.push({ kind: 'SKIP', id: m[1], name: m[2], reason: m[3] }); continue; }
    return null;
  }
  return records;
}
// Decisions H7/H7a: a totals candidate is any line that contains PASS as a whole word (any case; not preceded or
// followed by an ASCII letter, digit or underscore), is not a well-formed record line, and is not a failure
// diagnostic (exactly eight spaces then "- "). The shape of a malformed total is never guessed: candidates are found
// separately from their syntax, so a malformed or repeated candidate is never hidden by a valid one.
// Returns the parsed totals only when there is exactly one candidate and it is well formed; otherwise null.
const PASS_WORD = /(?<![A-Za-z0-9_])pass(?![A-Za-z0-9_])/i;
const DIAGNOSTIC = /^ {8}- /;
const TOTAL_LINE = /^(\d+) PASS \/ (\d+) FAIL \/ (\d+) SKIP$/;
const isTotalCandidate = (l) => PASS_WORD.test(l) && !PASS_FAIL.test(l) && !SKIP_RE.test(l) && !DIAGNOSTIC.test(l);
function totalLine(stdout) {
  const candidates = linesOf(stdout).filter(isTotalCandidate);
  const m = candidates.length === 1 ? TOTAL_LINE.exec(candidates[0]) : null;
  return m ? { passed: Number(m[1]), failed: Number(m[2]), skipped: Number(m[3]) } : null;
}

// Required-inventory order first, then IDs outside it in lexical order.
function ordered(ids) {
  const req = REQUIRED_CASE_IDS.filter((id) => ids.has(id));
  return [...req, ...[...ids].filter((id) => !REQUIRED_CASE_IDS.includes(id)).sort()];
}

function reportMismatch(report, envelope, records) {
  let o;
  try { o = JSON.parse(report.text); } catch { return true; }
  if (!exactKeys(o, ['env', 'summary', 'results']) || !validEnv(o.env) || !validSummary(o.summary) || !Array.isArray(o.results)) return true;
  for (const k of ['platform', 'release', 'node', 'git']) if (o.env[k] !== envelope.env[k]) return true;
  if (!sameSummary(o.summary, envelope.summary)) return true;
  if (o.results.length !== records.length) return true;
  return o.results.some((r, i) => {
    const s = records[i];
    if (!exactKeys(r, ['id', 'name', 'failures', 'skipped']) || typeof r.id !== 'string' || typeof r.name !== 'string') return true;
    if (!Array.isArray(r.failures) || r.failures.some((f) => typeof f !== 'string')) return true;
    if (r.skipped !== null && typeof r.skipped !== 'string') return true;
    if (r.failures.length && r.skipped !== null) return true; // a result cannot both fail and skip
    const kind = r.failures.length ? 'FAIL' : r.skipped !== null ? 'SKIP' : 'PASS';
    return r.id !== s.id || r.name !== s.name || kind !== s.kind || (kind === 'SKIP' && r.skipped !== s.reason);
  });
}

// ----------------------------------------------------------- validation ----
/** Pure: validates one captured suite run. Returns at most one issue, the first in plan 3.3 order. */
export function validateSuiteEvidence(input) {
  const i = input || {};
  const stdout = typeof i.stdout === 'string' ? i.stdout : '';
  const envelope = parseEnvelope(stdout);
  // G12: both fields are always present, filled from a structurally valid envelope or null.
  const out = (issue) => ({ ok: !issue, errors: issue ? [issue] : [], summary: envelope ? { ...envelope.summary } : null, resultsFile: envelope ? envelope.resultsFile : null });
  const only = i.only;
  if (only !== null && (typeof only !== 'string' || !REQUIRED_CASE_IDS.includes(only))) return out({ code: 'usage' });
  if ((i.error !== null && i.error !== undefined) || i.timedOut || i.truncated || (i.signal !== null && i.signal !== undefined)) return out({ code: 'suite-execution' });
  if (i.status !== 0) return out({ code: 'suite-exit' });
  const records = parseRecords(stdout);
  if (!records) return out({ code: 'malformed-record' });
  const totals = totalLine(stdout);
  if (!totals || !envelope) return out({ code: 'summary-invalid' });

  const byId = new Map();
  for (const r of records) { if (!byId.has(r.id)) byId.set(r.id, []); byId.get(r.id).push(r); }
  const contradictory = new Set([...byId].filter(([, rs]) => new Set(rs.map((r) => r.kind)).size > 1).map(([id]) => id));
  if (contradictory.size) return out({ code: 'contradictory-record', id: ordered(contradictory)[0] });
  const duplicate = new Set([...byId].filter(([, rs]) => rs.length > 1).map(([id]) => id));
  if (duplicate.size) return out({ code: 'duplicate-record', id: ordered(duplicate)[0] });
  const expected = only === null ? REQUIRED_CASE_IDS : [only];
  const unexpected = [...byId.keys()].filter((id) => !expected.includes(id)).sort();
  if (unexpected.length) return out({ code: 'unexpected-record', id: unexpected[0] });
  const missing = expected.find((id) => !byId.has(id));
  if (missing !== undefined) return out({ code: 'missing-record', id: missing });
  const kindOf = (id) => byId.get(id)[0].kind;
  const failed = expected.find((id) => kindOf(id) === 'FAIL');
  if (failed !== undefined) return out({ code: 'failed-record', id: failed });
  const forbidden = expected.find((id) => kindOf(id) === 'SKIP' && (only !== null || id !== 'R13d'));
  if (forbidden !== undefined) return out({ code: 'forbidden-skip', id: forbidden });
  if (only === null && kindOf('R13d') === 'SKIP' && (envelope.env.platform !== 'win32' || byId.get('R13d')[0].reason !== R13D_REASON)) {
    return out({ code: 'invalid-skip', id: 'R13d' });
  }
  const tally = { passed: records.filter((r) => r.kind === 'PASS').length, failed: records.filter((r) => r.kind === 'FAIL').length, skipped: records.filter((r) => r.kind === 'SKIP').length };
  const allowed = only === null ? FULL_TOTALS : [FOCUSED_TOTALS];
  if (!sameSummary(totals, tally) || !sameSummary(envelope.summary, tally) || !allowed.some((t) => sameSummary(t, tally))) return out({ code: 'totals-mismatch' });
  const report = i.report;
  if (report === null || report === undefined || (isObj(report) && 'error' in report)) return out({ code: 'evidence-missing' });
  if (!isObj(report) || typeof report.text !== 'string' || reportMismatch(report, envelope, records)) return out({ code: 'evidence-mismatch' });
  return out(null);
}

// ---------------------------------------------------------------- main ----
function defaultExecute(executable, args, options) {
  const r = spawnSync(executable, args, options);
  const code = r.error && r.error.code ? r.error.code : null;
  return {
    status: r.status === undefined ? null : r.status, signal: r.signal || null,
    error: r.error ? { code, message: String(r.error.message) } : null,
    timedOut: code === 'ETIMEDOUT', truncated: code === 'ENOBUFS',
    stdout: typeof r.stdout === 'string' ? r.stdout : '', stderr: typeof r.stderr === 'string' ? r.stderr : '',
  };
}
function defaultReadReport(absolutePath) {
  try { return { text: fs.readFileSync(absolutePath, 'utf8') }; } catch (e) { return { error: { code: (e && e.code) || null, message: String((e && e.message) || e) } }; }
}
function defaultWriteEvidence({ stdout, stderr }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-accept-rc1-'));
  fs.writeFileSync(path.join(dir, 'suite.stdout.txt'), stdout, { flag: 'wx' });
  fs.writeFileSync(path.join(dir, 'suite.stderr.txt'), stderr, { flag: 'wx' });
  return dir;
}

function parseArgv(argv) {
  if (!Array.isArray(argv)) return undefined;
  if (argv.length === 0) return null;
  if (argv.length === 2 && argv[0] === '--only' && typeof argv[1] === 'string' && REQUIRED_CASE_IDS.includes(argv[1])) return argv[1];
  return undefined;
}

export async function main(argv, dependencies = {}) {
  const only = parseArgv(argv);
  if (only === undefined) return { exitCode: 1, stdout: 'ACCEPT-RC1  FAIL  usage\n', stderr: '' };
  const deps = dependencies || {};
  const execute = typeof deps.execute === 'function' ? deps.execute : defaultExecute;
  const readReport = typeof deps.readReport === 'function' ? deps.readReport : defaultReadReport;
  const writeEvidence = typeof deps.writeEvidence === 'function' ? deps.writeEvidence : defaultWriteEvidence;

  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  const args = only === null ? [RUN_TESTS, '--keep'] : [RUN_TESTS, '--keep', '--only-id', only];
  const options = { cwd: REPO, env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 1800000, maxBuffer: 33554432 };
  let r;
  try { r = await execute(process.execPath, args, options); } catch (e) { r = null; void e; }
  // G14: an executor rejection is an execution failure, like a spawn error, timeout or truncated capture.
  const run = r && typeof r === 'object' && typeof r.stdout === 'string' && typeof r.stderr === 'string'
    ? r
    : { status: null, signal: null, error: { code: 'EXECUTOR', message: 'executor failed' }, timedOut: false, truncated: false, stdout: '', stderr: '' };

  const envelope = parseEnvelope(run.stdout);
  let report = null;
  if (envelope) {
    try { report = await readReport(envelope.resultsFile); } catch (e) { report = { error: { code: (e && e.code) || null, message: String((e && e.message) || e) } }; }
  }
  const verdict = validateSuiteEvidence({
    only, status: run.status === undefined ? null : run.status, signal: run.signal === undefined ? null : run.signal,
    error: run.error === undefined ? null : run.error, timedOut: !!run.timedOut, truncated: !!run.truncated,
    stdout: run.stdout, stderr: run.stderr, report,
  });

  let evidence;
  try { evidence = await writeEvidence({ stdout: run.stdout, stderr: run.stderr, resultsFile: envelope ? envelope.resultsFile : null }); } catch { evidence = null; }
  const retained = typeof evidence === 'string' && evidence !== '' && path.isAbsolute(evidence);

  const lines = [];
  if (!retained) lines.push('ACCEPT-RC1  FAIL  evidence-write'); // never an acceptance PASS without retained evidence
  else if (verdict.ok) lines.push(`ACCEPT-RC1  PASS  ${only === null ? 'full' : only}`);
  else { const e = verdict.errors[0]; lines.push(`ACCEPT-RC1  FAIL  ${e.code}${typeof e.id === 'string' ? `  ${e.id}` : ''}`); }
  if (verdict.resultsFile) lines.push(`RESULTS  ${verdict.resultsFile}`);
  if (retained) lines.push(`EVIDENCE  ${evidence}`);
  const sep = run.stdout !== '' && !run.stdout.endsWith('\n') ? '\n' : '';
  return { exitCode: retained && verdict.ok ? 0 : 1, stdout: `${run.stdout}${sep}${lines.join('\n')}\n`, stderr: run.stderr };
}

// No top-level await, so importing this module never waits on a running gate.
const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.exitCode;
  }, (e) => {
    process.stderr.write(`accept-rc1: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  });
}
