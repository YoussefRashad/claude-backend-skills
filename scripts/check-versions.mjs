#!/usr/bin/env node
/**
 * check-versions.mjs — guard the version stamps.
 *
 * Propagation is pull-based: the stamp in `templates/version.json` is the only way
 * anyone can tell a stale project from a current one. A change to a template or a
 * reference document that ships without a bump makes every downstream project claim
 * currency it does not have — which is worse than no stamp at all, because now the
 * sweep reports clean.
 *
 * So this is mechanical rather than remembered.
 *
 * Two checks:
 *   1. Every skill has a readable `templates/version.json` with a semver `version`.
 *   2. In CI on a pull request: if a skill's shipped content changed, its version
 *      changed too. Locally (no BASE_REF) that half is skipped, because there is no
 *      meaningful base to diff against.
 *
 * Usage:
 *   node scripts/check-versions.mjs               # shape check only
 *   BASE_REF=origin/master node scripts/...       # + bump check against that ref
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKILLS = ['backend-standards', 'toolchain-config'];

/** Paths whose contents a project receives. A change here requires a bump. */
const SHIPPED = (skill) => [`${skill}/templates/`, `${skill}/references/`];

const SEMVER = /^\d+\.\d+\.\d+$/;

let failed = false;
const fail = (message) => {
  console.error(`✖ ${message}`);
  failed = true;
};

const versionPath = (skill) => `${skill}/templates/version.json`;

function readVersion(skill, ref) {
  const path = versionPath(skill);
  try {
    const raw = ref
      ? spawnSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' }).stdout
      : readFileSync(path, 'utf8');
    if (!raw) return undefined;
    return JSON.parse(raw).version;
  } catch {
    return undefined;
  }
}

// ── 1. shape ──────────────────────────────────────────────────────────────────
for (const skill of SKILLS) {
  const version = readVersion(skill);
  if (!version) {
    fail(`${versionPath(skill)} is missing or has no "version".`);
  } else if (!SEMVER.test(version)) {
    fail(`${versionPath(skill)} version "${version}" is not semver (x.y.z).`);
  } else {
    console.log(`✓ ${skill} @ ${version}`);
  }
}

// ── 2. bump ───────────────────────────────────────────────────────────────────
const baseRef = process.env.BASE_REF;
if (!baseRef) {
  console.log('\n(no BASE_REF — skipping the bump check; CI sets it on a pull request)');
} else {
  const changed = spawnSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    encoding: 'utf8',
  });
  if (changed.status !== 0) {
    fail(`could not diff against ${baseRef}: ${changed.stderr.trim()}`);
  } else {
    const files = changed.stdout.split('\n').filter(Boolean);
    for (const skill of SKILLS) {
      const touched = files.filter((f) => SHIPPED(skill).some((p) => f.startsWith(p)));
      // A change to version.json alone is the bump, not shipped content.
      const shipped = touched.filter((f) => f !== versionPath(skill));
      if (shipped.length === 0) continue;

      const before = readVersion(skill, baseRef);
      const after = readVersion(skill);
      if (before && after && before === after) {
        fail(
          `${skill}: ${shipped.length} shipped file(s) changed but ${versionPath(skill)} ` +
            `is still ${after}.\n    ${shipped.slice(0, 10).join('\n    ')}` +
            (shipped.length > 10 ? `\n    …and ${shipped.length - 10} more` : '') +
            `\n  Bump it — see "Versioning these skills" in README.md.`,
        );
      } else {
        console.log(`✓ ${skill}: shipped content changed and version moved ${before} → ${after}`);
      }
    }
  }
}

process.exit(failed ? 1 : 0);
