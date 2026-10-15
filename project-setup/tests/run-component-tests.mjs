#!/usr/bin/env node
// Component assertion runner: runs one component's sub-assertions from the rc1-cases registry.
//   node project-setup/tests/run-component-tests.mjs --component <component>
//
// Plan: docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md sections 2.6 and 3.1, with decision G10.
// Records are "PASS  <sub-assertion-id>  <name>" / "FAIL  ...", never a complete numbered case record. A structural
// registry error prints "COMPONENT  FAIL  <code>[  <id>]". The totals line and the RESULTS line always follow, except
// when the evidence report cannot be written, which prints only "COMPONENT  FAIL  evidence-write".
// Exit code: 0 only when the component report is ok; 1 otherwise. Skips are failures.
//
// main() is import-safe and never writes process streams or exits; the CLI block at the end does that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runComponentAssertions } from './rc1-cases.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = () => ({ exitCode: 1, stdout: 'COMPONENT  FAIL  usage\n', stderr: '' });

function parseArgv(argv) {
  if (!Array.isArray(argv)) return null;
  let component = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--component' || component !== null) return null;
    const v = argv[i + 1];
    if (typeof v !== 'string' || v === '' || v.startsWith('--')) return null;
    component = v;
    i++;
  }
  return component;
}

// An isolated temporary directory and fixture environment: no inherited GIT_* variable, an isolated HOME and
// global git config, no system config, no prompts. The directory is kept: it holds the retained report.
function defaultContext() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-component-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const gitconfig = path.join(tmp, 'gitconfig');
  const hooks = path.join(tmp, 'hooks-empty');
  fs.mkdirSync(hooks);
  fs.writeFileSync(gitconfig, `[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[core]\n\tautocrlf = false\n\thooksPath = ${hooks.replace(/\\/g, '/')}\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n`, { flag: 'wx' });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k) && typeof v === 'string') env[k] = v;
  Object.assign(env, { HOME: home, USERPROFILE: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, GIT_TERMINAL_PROMPT: '0' });
  return { repository: path.resolve(SKILL, '..'), skillRoot: SKILL, tmp, env };
}

function defaultWriteEvidence(report, context) {
  const file = path.join(context.tmp, 'component-results.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); // exclusive: never overwrite evidence
  return file;
}

const oneLine = (s) => String(s).replace(/\r\n|\r|\n/g, ' | ');

export async function main(argv, dependencies = {}) {
  const component = parseArgv(argv);
  if (component === null) return usage();
  const deps = dependencies || {};
  const context = deps.context !== undefined ? deps.context : defaultContext();
  const report = await runComponentAssertions(component, context, deps.registry !== undefined ? { registry: deps.registry } : {});
  const writer = typeof deps.writeEvidence === 'function' ? deps.writeEvidence : defaultWriteEvidence;
  let resultsFile;
  try { resultsFile = await writer(report, context); } catch { resultsFile = null; }
  if (typeof resultsFile !== 'string' || resultsFile === '' || !path.isAbsolute(resultsFile)) {
    return { exitCode: 1, stdout: 'COMPONENT  FAIL  evidence-write\n', stderr: '' };
  }
  const lines = [];
  for (const e of report.errors) lines.push(`COMPONENT  FAIL  ${e.code}${typeof e.id === 'string' ? `  ${e.id}` : ''}`);
  for (const r of report.results) {
    lines.push(`${r.status}  ${r.id}  ${r.name}`);
    for (const f of r.failures) lines.push(`        - ${oneLine(f)}`);
  }
  lines.push(`${report.summary.passed} PASS / ${report.summary.failed} FAIL / 0 SKIP`);
  lines.push(`RESULTS  ${resultsFile}`);
  return { exitCode: report.ok ? 0 : 1, stdout: lines.join('\n') + '\n', stderr: '' };
}

// No top-level await: the component's own assertions import this module, and an import of a module that is still
// evaluating a top-level await would wait for it forever.
const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
if (process.argv[1] && norm(process.argv[1]) === norm(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((r) => {
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    process.exitCode = r.exitCode;
  }, (e) => {
    process.stderr.write(`run-component-tests: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  });
}
