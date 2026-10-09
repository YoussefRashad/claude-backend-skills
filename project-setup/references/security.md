# Security: secrets, scanning, and proving controls

## 1. Secret paths

`data/secret-paths.json` is the only list. Claude denies, the Codex profile snippet, git pathspec excludes, and
`detect`/`validate` exclusions are all rendered from it. To change coverage, edit that file (in the skill
source), re-render, and re-run setup. Never hand-edit rendered output in a project.

`.env.example` is in the list on purpose: real values end up in templates often enough that no agent reads any
`.env*` file. `env-keys.mjs` gives you what you need: key names, and per key one of `empty`, `placeholder`,
`non-placeholder`, `possible-real-secret`. Report `possible-real-secret` names under Security Concerns.

Agent-facing exclusion is not the same as a local tool inspecting content. Two scripts do read protected
content in-process, by design, and never emit it: `env-keys.mjs` (templates only, never `.env`) and
`secret-scan.mjs` (gitleaks, redacted, report kept in the vault).

## 2. Diffs and history

Run diffs and history only through `node .ai/tools/git-safe.mjs diff|log|show …` (before installation:
`node <SKILL_DIR>/assets/tools/git-safe.mjs`, which needs `.ai/security-paths.json`; during Phase 0 use
`git diff --name-status` only, which prints paths, not content). It spawns git without a shell, so `**` globs are
never expanded by Bash or mangled by PowerShell, adds `--no-ext-diff --no-textconv`, and enforces:

- every revision argument must resolve to a **commit** (`<rev>^{commit}`). Object forms print file content
  directly and ignore pathspec excludes, so `HEAD:.env`, `:.env`, blob/tree ids are rejected;
- blocked options: `--no-index`, `-c`, `--output`, `--ext-diff`, `--textconv`, `--pathspec-from-file`, `--stdin`,
  `--git-dir`, `--work-tree`, `-O`;
- environment that changes pathspec semantics or injects config (`GIT_LITERAL_PATHSPECS`, `GIT_CONFIG_*`,
  `GIT_EXTERNAL_DIFF`, …) is removed; excludes are case-insensitive;
- options that take a value must be attached (`-n5`, `--max-count=5`), otherwise the value is read as a revision
  and rejected. `.gitignore` does not protect files that are already
tracked; tracked secret files are a stop condition (detect warns), not something to work around.

## 3. Secret scan (optional, bounded)

`secret-scan.mjs --run-id <id> [--scope worktree|history]`. Local only, redacted, findings as file:line:rule.
Absent or failing gitleaks means **not scanned**, never "clean". Pattern scanners miss things; the report says
"no findings by gitleaks <version> in <scope>", not "no secrets".

## 4. Canary protocol (runtime proof)

Canaries are dummy tokens in files that match the secret patterns, under `.ai/.canary/<run>/` (self-ignored).
Tokens are never printed by the scripts; only hashes are stored.

Run it in the tool you are verifying, **in a separate lab folder**, not in the project itself: the project's
`AGENTS.md` correctly forbids any attempt to read secret paths, so an agent there refuses before the permission layer
is ever exercised (observed live; that result is INCONCLUSIVE, not PASS). Lab setup: an empty git repo containing only
a copy of the project's `.claude/settings.json` (and, for Codex, the profile under test), then
`node <SKILL_DIR>/scripts/canary.mjs setup --run-id <id>` from inside it. Steps:

1. `canary.mjs setup --run-id <id>`. For Codex, start a **new** Codex session after this step, because deny globs
   are snapshotted at session start.
2. **File tool layer** (Claude only): use the Read tool on each canary path.
3. **Shell command layer**: in the agent's shell tool, `cat <path>` (Bash) / `Get-Content <path>` (PowerShell).
4. **Subprocess layer**: in the agent's shell tool, `node <SKILL_DIR>/scripts/canary.mjs probe --run-id <id>`.
   It inherits whatever sandbox that shell has and reports `DENIED` / `READABLE` per file.
5. **Late file**: `canary.mjs setup --run-id <id> --late` during the session, then repeat steps 3–4.
6. For steps 2–3, pass the tool output to `canary.mjs verify --run-id <id> --observed "<output>"`.
7. `canary.mjs cleanup --run-id <id>`.

Interpretation:

| Observation | Result |
|---|---|
| Tool/sandbox returned a denial (permission rule, sandbox error) and verify finds no token | **pass** for that layer |
| verify finds a token, or probe says `READABLE` | **fail** for that layer |
| The model declined to run the read, or the command never executed | **inconclusive**, never pass |
| Layer not applicable (e.g. no file tool in Codex) | **n/a** |

Expected on native Windows without an OS sandbox: Claude passes the file-tool and recognised-command layers and
fails the subprocess layer. That is a true statement about the setup and belongs in the report, together with the
mitigation that matters most: no real secrets in development working trees (non-production credentials locally,
production secrets in a secrets manager).

## 5. Capability report

One table per tool, filled from observations only:

| Control | Claude Code <ver> | Codex <ver> |
|---|---|---|
| Instructions loaded (AGENTS.md via import / native) | verified / not verified | verified / not verified |
| Shared agents load canonical definitions | … | … |
| Command isolation (OS sandbox) | enabled / not enabled / unavailable (+backend) | profile active / legacy sandbox / none (+backend) |
| Secret read: file tool | pass / fail / inconclusive / n/a | n/a |
| Secret read: shell command | … | … |
| Secret read: subprocess | … | … |
| Secret read: file created mid-session | … | … |
| Secret scan | gitleaks <ver>, scope, findings count / not scanned | (same run) |

Any cell that is not *pass* or *verified* also goes to `TODO.md` → Unverified Controls, with the exact steps to
verify it.
