---
name: project-setup
description: Set up, migrate, or update shared AI-agent scaffolding for a backend repository so Claude Code and Codex work from the same rules - AGENTS.md as the shared source of truth, CLAUDE.md importing it, shared reviewer and docs-sync agents with thin per-tool wrappers, secret-path protection for both tools, and project docs generated from the actual code. Use this whenever the user wants to set up, install, initialize, re-run, upgrade, or migrate project setup, AGENTS.md, CLAUDE.md, agent docs, or reviewer/docs-sync agents in a repo, including repos already configured by the older Claude-only project-setup (v1), repos with hand-written CLAUDE.md or AGENTS.md, and new or empty repos. Treats the codebase as sensitive (fintech-grade), never reads secrets, enforces plan-and-confirm gates, and changes documentation and agent configuration only.
---

# project-setup v2

One skill, one source, two tools. Produces a repository layout that Claude Code and Codex both follow:

```
AGENTS.md                      shared rules (canonical, <=150 lines, managed blocks)
CLAUDE.md                      @AGENTS.md + Claude-only notes
<dir>/AGENTS.md + CLAUDE.md    optional local rules next to sensitive code (always as a pair)
.ai/manifest.json              install state: version, ownership, hashes (written last, by apply.mjs)
.ai/agents/{reviewer,docs-sync}.md   canonical agent definitions
.ai/context/*.md  .ai/decisions/     navigation maps and evidenced decisions
docs/*.md                      conventions, database, integrations, observability
.claude/settings.json          managed Read/command denies merged into user settings
.claude/agents/*.md            Claude wrappers -> .ai/agents/*
.codex/agents/*.toml           Codex wrappers  -> .ai/agents/*
TODO.md                        everything uncertain, unverified, or out of scope
```

Read this file fully, then read references only when the step says so.

## Non-negotiable rules

1. **Documentation and agent configuration only.** Never change application code, tests, dependencies,
   migrations, schema, infrastructure, or CI/CD. Findings go to `TODO.md`. `scripts/apply.mjs` enforces a write
   allowlist; do not write project files any other way.
2. **Never read secrets.** No tool, command, or script you write may open a path matched by
   `data/secret-paths.json` (`.env`, `.env.*` including `.env.example`, keys, certs, `secrets/`, `credentials/`,
   `.npmrc`, the run vault). Env variable **names** come from config/validation code or from
   `scripts/env-keys.mjs` (names and value classification only). Read diffs and history only through
   `.ai/tools/git-safe.mjs` (or `assets/tools/git-safe.mjs` before it is installed), never raw `git diff/log -p/show`. If a value surfaces anyway:
   do not repeat it, do not store it, report file and variable name only.
   Files listed under `contentRisk` (compose files, config modules, k8s/helm) may be read for structure; never
   reproduce values from them.
3. **Nothing is overwritten silently.** All content goes to drafts first, is reviewed as a diff, and is applied by
   `apply.mjs commit`, which re-verifies every file and writes the manifest last. The skill owns only managed
   blocks (Markdown and `#`-comment files), managed keys (`.claude/settings.json`), and files it created in full.
   Everything else belongs to the user and is merged, never replaced.
4. **Evidence or nothing.** Never invent architecture, business rules, ADR rationale, security controls, or
   behaviour. Label inferences *inferred*. Dependency presence is not evidence of a decision. Gaps go to `TODO.md`.
5. **Generated is not verified.** The report distinguishes *generated*, *statically validated*, and *verified at
   runtime in <tool>*. A security control is claimed only for the paths, tools, and version actually tested.
   A model refusing to read a file is not proof the file is protected.
6. **Read incrementally.** Listings and targeted reads; never bulk-load the codebase.
7. **No retry recommendation without verified idempotency**, in any generated doc.
8. **Project scope only.** Never write user-level or managed config (`~/.claude/settings.json`,
   `~/.codex/config.toml`, `requirements.toml`, managed settings). Produce reviewed snippets for the user instead.
   Installing the skill itself (`install/install.mjs`) is the only user-level write, and it is a separate,
   explicit step.
9. **No git state changes.** Never commit, push, stash, reset, restore, checkout, or clean.

## Scripts

All scripts are zero-dependency Node (>=18) and print JSON. Run them from the repository root as
`node "<SKILL_DIR>/scripts/<name>.mjs" …`, where `<SKILL_DIR>` is the directory containing this file.

| Script | Purpose |
|---|---|
| `detect.mjs` | Read-only inventory: mode + evidence, instruction files, tool configs, secret paths (names only), installs, tool versions |
| `env-keys.mjs` | `keys`/`merge` for `.env.example`-style templates without exposing values |
| `render-permissions.mjs` | Renders Claude denies, Codex profile snippet, git pathspec excludes from `data/secret-paths.json` |
| `merge-claude-settings.mjs` | Order-preserving merge of managed entries into `.claude/settings.json` (draft + report) |
| `blocks.mjs` | `check`/`hashes`/`drift`/`upsert` managed blocks (upsert writes drafts only) |
| `lock.mjs` | One run per checkout; breaking a lock is a user decision |
| `apply.mjs` | `init`/`prepare`/`commit`/`status`/`rollback`/`cleanup`: the only writer |
| `validate.mjs` | Static checks: JSON shape, TOML syntax, sizes, imports, references, markers, drift, secret-shaped content (exit 1 on any failure) |
| `canary.mjs` | Runtime measurement of secret-read protection per tool layer (no canaries = INCONCLUSIVE, exit 3) |
| `secret-scan.mjs` | Optional local gitleaks scan, redacted; findings as file:line:rule only |
| `assets/tools/git-safe.mjs` | Installed into projects: diff/log/show with secret excludes, no shell |

## Workflow

Use a run id like `ps-<yyyymmdd>-<4 random chars>` for the whole run.

### Phase 0 — Discover (read-only), then STOP

1. `node scripts/detect.mjs`. Act on every warning before going further; tracked secret files or a held lock stop the run.
   Its install list is a filesystem scan; confirm which `project-setup` copies are active from the running tool's own
   skill list, and stop if more than one is active.
2. Read every existing instruction file in full (`AGENTS.md`, `CLAUDE.md`, nested ones, `.claude/agents/*`,
   `.codex/agents/*`), `README.md`, and existing `docs/`/`.ai/` indexes. Existing decisions outrank your inferences.
3. Read only: the manifest (`package.json` or equivalent), lockfile name, `tsconfig.json`, `docker-compose.yml`
   (structure only), `src/` tree listing, framework entrypoint (`main.ts`, `app.module.ts` or equivalent).
   Versions: required range from the manifest, installed version from the lockfile; `tsconfig.json` describes
   compiler settings, not the TypeScript version.
4. Classify the mode with `references/modes.md`. If `migrate-v1`, also read `references/migration-v1.md`.
5. Present this summary and **stop until the user explicitly approves**:

```
## Mode: <mode>  (evidence: …)
## Project
- Name · framework (version) · language (version) · ORM · DB · cache/queue · auth
- DB change policy as practiced: <ORM migrations | manual DDL | mixed> (evidence)
## Existing AI configuration
- files found, ownership guess, conflicts in meaning (not mere differences)
## Tools & environment
- Claude Code <version|not found> · Codex <version|not found> · OS/shell
- Codex user config: legacy sandbox vs profiles (from detect) · Claude instruction-files mode
## Security findings (names only)
## Assumptions / Unknowns
## Plan
- files to create / merge / leave untouched, in order; commands proposed for allow-listing (with why each is safe)
```

### Phase 1 — Draft (after approval)

1. `lock.mjs acquire --run-id <id> --agent <claude|codex>`, then `apply.mjs init --run-id <id>`.
2. Generate content into `.ai/.run/<id>/drafts/<repo-path>` following `references/docs-generation.md` and the
   templates in `assets/templates/`. For Markdown and `.gitignore`, write managed sections with
   `blocks.mjs upsert` so user content outside the markers is preserved.
3. Security tooling: copy `data/secret-paths.json` → `.ai/security-paths.json` and `assets/tools/git-safe.mjs` →
   `.ai/tools/git-safe.mjs` as drafts (both `full` ownership; the agents and AGENTS.md depend on them).
4. Agents: render `assets/agents/*.md` into `.ai/agents/` (replace `{{PROJECT_NAME}}`; remove references to docs
   you did not generate). Copy wrappers from `assets/wrappers/` to `.claude/agents/` and `.codex/agents/`
   (Codex file names: `reviewer.toml`, `docs_sync.toml`). Keep existing agent names other skills rely on
   (e.g. `.claude/agents/reviewer.md`); check before renaming anything.
5. Settings: `merge-claude-settings.mjs --run-id <id> [--allow-file <confirmed.json>]` (run it before prepare: it
   writes `ownership.json`/`managed-keys.json`, which prepare embeds in the plan the user approves). Allow-list only commands
   the user confirmed after you read what they execute (a `migration:*` script is never auto-allowed).
   If it returns `needsDecision: true`, a managed deny may cancel a user exception (`Read(!…)`); those rules are
   held back from the draft. Overlap is decided soundly: a rule is appended only if no path can match both it and
   the exception (wildcards included); anything the check cannot model is deferred. Show the conflict; re-run with `--override-user-exceptions` only if the user chooses it.
6. Env template: derive keys from config/validation code, then `env-keys.mjs merge`.
7. Read `references/claude.md` and `references/codex.md` for tool-specific details before drafting wrappers,
   settings, or snippets.

### Phase 2 — Review gate, then STOP

1. `apply.mjs prepare --run-id <id> --mode <mode> --agents claude,codex`. It rejects (exit 3) any draft that
   changes user content: anything outside managed blocks, a user-edited fully managed file, any pre-existing file the
   skill does not own (only adding new blocks is free), or a `.claude/settings.json` draft that is not append-only. Show that diff; only if the user
   explicitly approves it, re-run prepare with `--approve-user-content <path>[,<path>]` for exactly those files.
2. Show each changed file as a diff (`git diff --no-index -- <target> .ai/.run/<id>/drafts/<target>`), the
   settings merge report (conflicts, held-back rules, ineffective rules, legacy hooks), and the env-keys report
   (names only). Never display vault files.
3. Resolve every conflict with the user. Show the `planSha256` printed by prepare. **Stop until the user
   approves the diff.** Do not edit drafts after this point; any change means a new prepare and a new approval.

### Phase 3 — Apply and validate

1. `apply.mjs commit --run-id <id> --approved-plan <planSha256>`. It re-checks the plan hash, every draft's
   hash, `ownership.json`/`managed-keys.json`, every target, and the manifest. Exit 2: a run directory was
   replaced by a link/junction; nothing was written. Exit 4: something changed since approval; nothing was
   written; prepare and ask again (same run id is fine: no journal exists yet). Exit 5: partial apply; run
   `apply.mjs rollback`. Exit 7: the run already wrote (committed, partial, or rolled back) or another run is
   unresolved. A run writes at most once and its journal is never reset: finish recovery first, then retry with a
   NEW run id. Rollback exit 6: some files were changed after
   the run wrote them; they and their backups were left alone. Tell the user; never clean up without
   `--confirm-manual-resolution` from them.
2. `validate.mjs`. Fix failures through a new draft/prepare/commit cycle, or record them in `TODO.md`.

### Phase 4 — Runtime verification (per tool, honestly scoped)

Follow `references/security.md`: load verification and the canary protocol for the tool you are running in.
You cannot verify the other tool from this session; list the exact steps for the user and mark it *not verified*.

### Phase 5 — Report and release

Report with `references/report.md`, then `lock.mjs release`. Keep `.ai/.run/<id>` until the user confirms the
result (rollback needs it), then `apply.mjs cleanup`.

## Reference index

| File | Read when |
|---|---|
| `references/modes.md` | Phase 0, always |
| `references/migration-v1.md` | mode is `migrate-v1`, or v1 artifacts exist |
| `references/docs-generation.md` | Phase 1, generating any doc |
| `references/claude.md` | drafting `.claude/*`, CLAUDE.md, retiring v1 |
| `references/codex.md` | drafting `.codex/*`, AGENTS.md sizing, Codex snippet |
| `references/security.md` | secret handling, scanning, canaries, capability report |
| `references/state-and-apply.md` | lock, drafts, manifest, ownership, recovery, concurrency |
| `references/report.md` | Phase 5 |
