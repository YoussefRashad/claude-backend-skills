#!/usr/bin/env node
/**
 * security-scan.mjs — run the Docker-based security scanners against this repo.
 *
 * Cross-platform (resolves paths in Node, so it works from cmd / PowerShell /
 * Git Bash alike). Requires Docker to be installed and running.
 *
 * WHAT IS MOUNTED, AND WHY IT MATTERS
 * ──────────────────────────────────────────────────────────────────────────────
 * Only `src/`, `package-lock.json` and `.git/` are ever mounted into a container —
 * never `env/`, `cert/`, `*.pem` or any other secret file. 02 §8 forbids tooling
 * from reading those, and a scanner is tooling. `.git` is mounted read-only because
 * 02 §12 is explicit that git history retains a leaked secret after it is removed
 * from the working tree, so history is exactly where a secret scan has to look.
 *
 * Consequence worth knowing: an uncommitted secret sitting in a working-tree file
 * OUTSIDE `src/` is not scanned. That is the deliberate trade for never mounting
 * `env/`. Pair this with the CI secret-scan job, which scans the pushed history.
 *
 * EXIT CODES — strict by DEFAULT
 * ──────────────────────────────────────────────────────────────────────────────
 * 04 Part A lists the dependency scan (A4) and the secret scan (A5) as BLOCKING.
 * A gate that always exits 0 cannot block, so findings fail the command. Pass
 * `--no-strict` for an exploratory local run where you just want to read the output.
 *
 * Usage:
 *   npm run scan                  # all three, non-zero exit on findings
 *   npm run scan:sast             # semgrep  (SAST — OWASP / security-audit rulesets)
 *   npm run scan:deps             # osv-scanner (lockfile vs OSV vuln DB)
 *   npm run scan:secrets          # trufflehog (src/ working tree + git history)
 *   npm run scan -- --no-strict   # report findings but always exit 0
 *   npm run scan -- --unverified  # secrets: include unverified candidates too
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
// Docker on every platform accepts forward-slash bind-mount sources.
const p = (rel) => resolve(root, rel).replace(/\\/g, '/');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const which = argv.find((a) => !a.startsWith('--')) ?? 'all';

const strict = !flags.has('--no-strict');
// `--only-verified` trades recall for precision: it reports only credentials
// TruffleHog could actively confirm are live. That keeps the default quiet enough
// to stay in a pre-merge gate. Widen it when triaging an actual incident.
const verifiedOnly = !flags.has('--unverified');

/**
 * `docker --version` only proves the CLI is on PATH — it succeeds with the daemon
 * stopped, and every scan then fails with a raw "cannot connect to the Docker API"
 * per container. `docker info` is the one that needs the daemon, so the two cases get
 * told apart here and reported once, rather than three times in the scanners' output.
 */
function dockerStatus() {
  if (spawnSync('docker', ['--version'], { stdio: 'ignore' }).status !== 0) return 'missing';
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) return 'down';
  return 'ready';
}

function run(label, args) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync('docker', args, { stdio: 'inherit', shell: false });
  // semgrep / trufflehog / osv-scanner exit non-zero when they FIND something.
  console.log(`(${label} exit: ${r.status})`);
  return r.status ?? 1;
}

const scanners = {
  sast: () =>
    run('semgrep (SAST)', [
      'run',
      '--rm',
      '-v',
      `${p('src')}:/src:ro`,
      'semgrep/semgrep:latest',
      'semgrep',
      '--config',
      'p/security-audit',
      '--config',
      'p/owasp-top-ten',
      '--metrics=off',
      '--error',
      '/src',
    ]),

  deps: () => {
    if (!existsSync(resolve(root, 'package-lock.json'))) {
      console.error('scan:deps — package-lock.json not found at repo root.');
      return 1;
    }
    // NOTE: osv-scanner reports every severity. 04 A4 blocks on High/Critical only,
    // so triage the output rather than treating every row as a merge blocker.
    return run('osv-scanner (deps)', [
      'run',
      '--rm',
      '-v',
      `${p('package-lock.json')}:/pl/package-lock.json:ro`,
      'ghcr.io/google/osv-scanner:latest',
      'scan',
      '--lockfile=/pl/package-lock.json',
    ]);
  },

  secrets: () => {
    const common = ['--no-update', ...(verifiedOnly ? ['--only-verified'] : [])];

    const working = run('trufflehog (secrets — src/ working tree)', [
      'run',
      '--rm',
      '-v',
      `${p('src')}:/repo:ro`,
      'trufflesecurity/trufflehog:latest',
      'filesystem',
      '/repo',
      ...common,
    ]);

    if (!existsSync(resolve(root, '.git'))) {
      console.error('scan:secrets — no .git directory; skipping the history scan.');
      return working;
    }

    // 02 §12: "Removing it from code does not un-leak it. Git history and log stores
    // retain it." A secret scan that only reads the working tree cannot see the
    // commit that introduced it and the commit that quietly deleted it.
    const history = run('trufflehog (secrets — git history)', [
      'run',
      '--rm',
      '-v',
      `${p('.git')}:/repo/.git:ro`,
      'trufflesecurity/trufflehog:latest',
      'git',
      'file:///repo',
      ...common,
    ]);

    return working === 0 && history === 0 ? 0 : 1;
  },
};

const docker = dockerStatus();
if (docker !== 'ready') {
  if (docker === 'missing') {
    console.error('Docker is required for the security scanners but was not found on PATH.');
    console.error('Install Docker Desktop (or run these tools natively) and retry.');
  } else {
    console.error('Docker is installed but the daemon is not running — start it and retry.');
  }
  // Exit non-zero either way. A4/A5 are blocking gates (04 Part A): a scan that could
  // not run has NOT passed, and reporting success here is how an unscanned change
  // merges with a green checklist.
  process.exit(127);
}

const order = which === 'all' ? ['sast', 'deps', 'secrets'] : [which];
if (order.some((k) => !Object.hasOwn(scanners, k))) {
  console.error(`Unknown scan target "${which}". Use: all | sast | deps | secrets`);
  process.exit(2);
}

// Run every requested scanner even if an earlier one reported findings — a partial
// picture is how a second problem stays hidden behind the first.
const statuses = order.map((k) => scanners[k]());
const found = statuses.some((s) => s !== 0);

console.log(`\nScan complete: ${order.join(', ')}.`);
if (found && !strict) {
  console.log('Findings above. Exiting 0 because --no-strict was passed.');
}
process.exit(strict && found ? 1 : 0);
