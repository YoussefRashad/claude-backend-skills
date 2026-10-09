#!/usr/bin/env node
// Renders all secret-path controls from data/secret-paths.json so the two tools can never drift.
//
// Usage:
//   node render-permissions.mjs json            -> { claude: {...}, gitPathspecExcludes: [...], codexSnippetPath }
//   node render-permissions.mjs codex-snippet   -> prints the TOML snippet (for the user's config; never written by the skill)
//   node render-permissions.mjs pathspec        -> prints the git pathspec excludes, one per line
import { parseArgs, loadSecretSpec, ok, fail } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const spec = loadSecretSpec();
const globs = spec.patterns.map((p) => p.glob);

// Claude: Read deny also blocks Edit/Write on the same path (v2.1.208+/v2.1.228+).
// Managed entries contain NO "!" negations: a negation carves exceptions out of every
// earlier rule from the same settings source, including the user's own rules.
const claudeReadDeny = globs.map((g) => `Read(${g})`);

// Noise reduction, NOT a security boundary (rules match command text only; see references/claude.md).
// Windows sessions may use the PowerShell tool, which Bash(...) rules do not cover.
const claudeCommandDeny = [
  'Bash(rm -rf *)', 'Bash(git reset --hard*)', 'Bash(git clean *)', 'Bash(git push --force*)', 'Bash(git push -f*)',
  'Bash(git checkout -- *)', 'Bash(git restore *)', 'Bash(curl * | bash*)', 'Bash(curl * | sh*)', 'Bash(wget * | bash*)',
  'Bash(npm publish*)', 'Bash(terraform apply*)', 'Bash(terraform destroy*)', 'Bash(kubectl delete *)', 'Bash(helm uninstall *)',
  'PowerShell(Remove-Item * -Recurse*)', 'PowerShell(git reset --hard*)', 'PowerShell(git clean *)',
  'PowerShell(git push --force*)', 'PowerShell(git push -f*)', 'PowerShell(npm publish*)',
  'PowerShell(Invoke-Expression *)', 'PowerShell(iex *)',
];

const gitPathspecExcludes = globs.map((g) => `:(exclude,glob)${g}`);

function codexSnippet() {
  const lines = [
    '# --- project-setup v2: Codex deny-read profile -------------------------------------------',
    '# REVIEW before use. Paste into your USER config (%USERPROFILE%\\.codex\\config.toml or ~/.codex/config.toml).',
    '# The skill never writes this file.',
    '#',
    '# CRITICAL: profiles do not compose with legacy sandbox settings. If `sandbox_mode` or',
    '# [sandbox_workspace_write] appears in ANY loaded config file, or you pass --sandbox, Codex uses',
    '# the legacy settings and this profile is silently inactive. Remove them first.',
    '#',
    '# WINDOWS: with the non-admin ("unelevated") sandbox, Codex 0.160.1 REFUSES TO START with this profile',
    '# ("cannot enforce deny-read restrictions directly; refusing to run unsandboxed"). Only use it with the',
    '# admin-installed Windows sandbox or under WSL2, and verify with a canary run.',
    '#',
    '# Deny-read globs are pre-expanded into a snapshot before the sandbox starts (Linux/WSL/native',
    '# Windows). Files created later in the session may not be covered: verify with canary.mjs.',
    'default_permissions = "project-setup"',
    '',
    '[permissions.project-setup]',
    'description = "Workspace write with secret paths denied (project-setup v2)"',
    'extends = ":workspace"',
    '',
    '[permissions.project-setup.filesystem]',
    `glob_scan_max_depth = ${spec.codexGlobScanMaxDepth}`,
    '"~/.ssh" = "deny"',
    '"~/.aws" = "deny"',
    '"~/.gnupg" = "deny"',
    '',
    '[permissions.project-setup.filesystem.":workspace_roots"]',
    ...globs.map((g) => `"${g}" = "deny"`),
    '',
    '# Optional: OS-enforced read-only profile for the reviewer agent. Only after this exists AND a',
    '# canary run passes, add `default_permissions = "project-setup-readonly"` to .codex/agents/reviewer.toml.',
    '[permissions.project-setup-readonly]',
    'description = "Read-only with secret paths denied (project-setup v2 reviewer)"',
    'extends = ":read-only"',
    '',
    '[permissions.project-setup-readonly.filesystem]',
    `glob_scan_max_depth = ${spec.codexGlobScanMaxDepth}`,
    '"~/.ssh" = "deny"',
    '"~/.aws" = "deny"',
    '"~/.gnupg" = "deny"',
    '',
    '[permissions.project-setup-readonly.filesystem.":workspace_roots"]',
    ...globs.map((g) => `"${g}" = "deny"`),
    '# -----------------------------------------------------------------------------------------',
  ];
  return lines.join('\n') + '\n';
}

const sub = args._[0] || 'json';
if (sub === 'json') {
  ok({
    source: 'data/secret-paths.json',
    claude: { permissionsDeny: [...claudeReadDeny, ...claudeCommandDeny], readDeny: claudeReadDeny, commandDeny: claudeCommandDeny },
    gitPathspecExcludes,
    codexSnippet: codexSnippet(),
  });
} else if (sub === 'codex-snippet') {
  process.stdout.write(codexSnippet());
} else if (sub === 'pathspec') {
  process.stdout.write(gitPathspecExcludes.join('\n') + '\n');
} else {
  fail('usage: render-permissions.mjs json|codex-snippet|pathspec');
}
