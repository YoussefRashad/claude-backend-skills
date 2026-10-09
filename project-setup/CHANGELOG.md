# Changelog

## 2.0.0
Release of the `2.0.0-rc.13` source, unchanged in function. Only `VERSION` and release documentation changed
(`RELEASE-NOTES-2.0.0.md`, `README.md` status and limitations, this entry, the version placeholder in
`tests/live/LIVE-ACCEPTANCE.md`). Final review of rc.13: "no remaining findings within scope; ready for 2.0.0".
Known environmental limitation, documented and not a release blocker: on Windows native, secret-path controls stop
the agents' tools and commands that name a file, but not a subprocess that reads files itself; see
`RELEASE-NOTES-2.0.0.md`.

## 2.0.0-rc.13
Single fix from the rc.12 Windows review (no design change, no features). Regression test R40.
- P2 detect: only the documented `skillOverrides` states (`on`, `off`, `name-only`, `user-invocable-only`, exact
  spelling) take part in the precedence merge. Invalid values (null, booleans, numbers, objects, arrays, other
  strings, other case or surrounding whitespace) are skipped, so the lower valid value stays in effect, and they are
  reported in `invalidOverrides` and as warnings. rc.12 let an invalid higher-layer value displace a valid lower
  "off" and re-count a disabled copy.

## 2.0.0-rc.12
Single fix from the rc.11 Windows review (no design change, no features). Regression test R39.
- P2 detect: `skillOverrides` values are merged per key in precedence order (user -> shared project -> project-local)
  and only keys whose effective value is "off" disable a copy. rc.11 collected any "off" from any layer, so a
  higher-precedence "on"/"name-only" was ignored and an active copy could be dropped from conflict accounting.
  Managed policy and command-line settings are not visible to detect and are not inferred.

## 2.0.0-rc.11
Fixes from the scoped rc.10 Windows review (no design change, no new agents). Regression tests R35–R38.
- P1 secret-input guard: checks the canonical destination as well as the spelling (a junction/symlink alias of a
  protected directory, inside or outside the repo, is refused); refuses input that cannot be resolved; callers read the
  canonical path. rc.10 copied synthetic secret bytes into a draft through `innocent -> secrets`.
- P2 detect overrides: a `skillOverrides` key disables a copy only if it equals that copy's runtime identity
  (`project-setup` for user/repo, `anthropic-skills:project-setup` for claude.ai-synced). Plugin skills are never
  reported as disabled by `skillOverrides` (excluded by Claude Code); a note explains instead.
- P2 detect links: linked skill folders are reported (tools follow them), de-duplicated by canonical target; the
  scanner never recurses through links (no cycles) and ignores dangling links.
- P2 prepare: a present-but-malformed user `permissions`, `permissions.allow` or `permissions.deny` value is user
  content; replacing or "repairing" it needs `--approve-user-content`.

## 2.0.0-rc.10
Fixes from the first live acceptance run (Windows 11, Claude Code 2.1.295, Codex 0.160.1) plus a self-review.
Regression tests R29–R34. No design change, no new agents.

Live findings
- prepare (P1): pre-existing files the skill does not own (no manifest entry, no managed blocks) could be changed
  without `--approve-user-content` (live: v1 `CLAUDE.md` and `.claude/agents/reviewer.md` in migrate-v1). Now any
  change to such a file other than adding new managed blocks needs explicit approval; managed files may not lose or
  reorder blocks; `.claude/settings.json` drafts must keep every user key and only append to `permissions.allow/deny`.
  A rejected target no longer cascades into a misleading "not a target" ownership error.
- validate: problems in user-owned settings keys (hooks, env, an existing `$schema`) are warnings. Live: a legacy hook
  the user chose to keep made validation fail. Broken managed permissions still fail.
- detect: scans nested `skills/synced/<id>/` folders for both tools; honours Claude `skillOverrides: "off"` and Codex
  `config.toml` `[[skills.config]] enabled = false`; reports profile-only disables without discounting them; warns
  when the repo copy itself is disabled; finds `claude.cmd` / `.exe` shims; reports when running inside Claude Code.
- canary: re-running `setup` for a run id replaced entries instead of duplicating them (live: 8 results for 4 files).
- AGENTS.md template names the custom agents and forbids ad-hoc substitutes (live: Codex once spawned `review_range`).
- Codex snippet header and `references/codex.md`: on the non-admin Windows sandbox Codex 0.160.1 refuses to start with
  the deny-read profile (measured).

Self-review (gaps found before handing over)
- `blocks.mjs upsert --content`, `merge-claude-settings --allow-file`, `env-keys --keys` refuse secret-pattern files
  before opening them. rc.9 copied a secret into a draft (`--content .env`) and printed its value in a JSON parse
  error (`--allow-file .env`). Verified on rc.9.
- git-safe blocks `-L`/`--line-range`/`--contents` (prints file content directly). Defense in depth: rc.9 was not
  exploitable because git refuses `-L` together with the pathspec git-safe always adds.

Documentation
- `references/claude.md`: three ways v1 reaches a session and how to retire each; CLAUDE_CONFIG_DIR does not isolate
  claude.ai-synced skills; `--continue` keeps the old skill list; measured protection matrix on Windows native;
  use `--permission-mode default` for setup.
- `references/codex.md`: subagents default-on, judge by thread name, user skills visible under custom CODEX_HOME,
  `--no-daemon` for SUN_LEN, measured profile refusal.
- `references/security.md`: run canaries in a lab folder (AGENTS.md makes in-project attempts inconclusive).
- `references/modes.md`: update mode never rephrases unchanged facts (zero diff).
- `references/migration-v1.md`: expected `--approve-user-content` for v1 files.
- `tests/live/LIVE-ACCEPTANCE.md`: setup rules learned live.

## 2.0.0-rc.9
Two recovery fixes from the rc.8 Windows review (no design change). Regression tests R27a–d, R28; R11 updated.
- P1 apply rollback: `inProgress` is written to the journal before the first change, every restored file is
  checkpointed, per-file rename/write/delete errors are captured (backup kept, entry unresolved), and completion is
  recorded only if the final journal write succeeds. New state `rollback-in-progress` blocks prepare/commit in every
  run; `cleanup` now fails closed for any state other than fresh/committed/rolled-back/aborted-before-write unless
  `--confirm-manual-resolution`. Previously an I/O error left `committed: true`, a new run could start, and cleanup
  deleted the only recovery copy.
- P2 installer rollback: every selected backup is verified before any target changes — the full-directory snapshot
  digest recorded when the copy was moved aside (new), or, for installed-copy backups, inventory + no links + install
  tree hash. Undigested legacy backups are refused unless `--accept-unverified-backup`. Previously a corrupted
  backup was restored and reported as ok.

## 2.0.0-rc.8
Fixes from the consolidated rc.7 Windows review (no design change). Regression tests R24–R26.
- P1 apply rollback: backup bytes must match the journal's pre-run hash before the target is touched; altered,
  truncated, partial or wrong-file backups leave target and backup as found and make the rollback incomplete (exit 6).
- P2 installer rollback: one transaction across targets (registered before the first mutation, phase recorded,
  full revert on any failure, measured end state of every target reported; backups/displaced copies kept if the
  revert itself fails). Exit 4 now covers a reverted rollback as well as a reverted install.
- P2 lock: missing, unreadable, or malformed `owner.json` is unknown ownership; release fails closed (exit 2), even
  for the claimed owner. Recovery is a separate `break --confirm-unknown-owner`, which cannot break a lock whose
  owner is known. `status` reports `ownerReadable`.
- reviewer: findings must be reachable in the current code; hypothetical future components go to Open questions or
  INFO suggestions (from the live Claude review of the fixture).
- detect: `installsNote` states the install list is a filesystem scan; SKILL.md Phase 0 confirms active copies from
  the running tool's own skill list (live Codex showed a synced location the scan cannot see).

## 2.0.0-rc.7
Two targeted fixes from the rc.6 Windows review (no design change).
- detect / installer: paths are canonicalised with `fs.realpathSync.native` when available (new `canonicalPath` in
  lib) before de-duplication. The JS `realpathSync` can keep Windows 8.3 short names, so one directory was counted as
  two (R21 failed on Windows). R21 now also covers a link/junction alias everywhere and an explicit 8.3 alias on
  Windows.
- make-fixture: generated `live-env.ps1` / `live-env.sh` first remove every inherited `GIT_*` variable (GIT_DIR,
  GIT_WORK_TREE, GIT_INDEX_FILE, GIT_CONFIG_COUNT/KEY_n/VALUE_n, GIT_CONFIG_PARAMETERS, ...), then set the isolated
  values. New R23a (sh) / R23b (PowerShell) source the generated files under a hostile environment and run real git
  (rev-parse, commit, author, signature, remaining variables). Each skips when its shell is not on PATH.

## 2.0.0-rc.6
Acceptance-kit and detector fixes from the rc.5 preflight review (no design change). Regression tests R21–R22.
- detect: skill copies are grouped per tool (Claude: user/repo/plugin; Codex: ~/.agents, legacy CODEX_HOME, repo);
  a warning is raised only for two copies visible to the same tool (`installConflicts`). Honours
  `CLAUDE_CONFIG_DIR` and `CODEX_HOME` for user-level locations and settings.
- tests/live/make-fixture.mjs: the wallet fixture now contains a real, executable lost-update defect in one of two
  neutral, randomly assigned change commits and a behaviour-preserving control change; no hint comments. An oracle
  executes base/control/defective ledgers under concurrency at creation time and the fixture fails to build unless
  the proof holds. Expected findings and the oracle live in `<out>.meta/`, outside the fixture tree.
  Full git isolation (inherited GIT_* dropped, generated global config, empty hooks/templates, signing off, fixed
  dates) plus `live-env.ps1/.sh` for live-test terminals.
- LIVE-ACCEPTANCE: L08/L10 review concrete SHA ranges (defective and control) with identical neutral prompts and a
  scoring rule applied only after all reviews are recorded; the empty `HEAD~0..HEAD` range is gone.

## 2.0.0-rc.5
Documentation only (rc.4 Windows review, P3). `references/state-and-apply.md` crash/interruption guidance now matches
the lifecycle guard: recover the unresolved run, then retry with a new run id; same-id `prepare` only when no journal
was created. Added the `aborted-before-write` row to the lifecycle table. No changes to skill code.
- Added `tests/live/` (not installed): `make-fixture.mjs` and `LIVE-ACCEPTANCE.md` for isolated live Claude/Codex
  acceptance testing.

## 2.0.0-rc.4
Fix from the rc.3 Windows review (no design change). Regression tests R18–R20.
- P1 run lifecycle: a run writes at most once and its journal is never reset. prepare/commit are refused (exit 7)
  once the run has a journal (committed, partial, rolled back, aborted mid-commit), and in any run while another run
  is partial or rollback-incomplete. Retries use a new run id. `status` reports `state`.
  Previously, re-preparing and committing a partially applied run replaced its journal, and a later rollback
  reported `complete` while leaving earlier writes in place.

## 2.0.0-rc.3
Fixes from the rc.2 Windows review (no design changes, no new agents). Regression tests R13–R17.
- P1 run-dir links: every read/write in the run, lock, and canary areas is re-validated from the repository root at
  the moment it happens (`secureDir` refuses any other anchor); linked leaf files refused; exclusive temp + rename;
  commit checks the run chain before the first write (exit 2). Covers `vault/backup` replaced after init, `vault`,
  nested backup dirs, drafts, rollback restore source, and pre-placed backup symlinks.
- P1 installer: each target is journalled before its first mutation; failure in any phase (before backup, backup
  metadata, install rename) restores that target and all earlier ones; the reported end state is re-measured.
  Backup metadata moved next to the backup; unexpected entries in an installed copy count as local modification.
  Failpoint env renamed to `PROJECT_SETUP_TEST_FAILPOINT=<target>:<phase>`.
- P2 ownership binding: `ownership.json` / `managed-keys.json` validated at prepare, embedded in the plan with
  hashes; commit uses the embedded copy and aborts if either changed.
- P2 TOML: new strict TOML 1.0 parser (`scripts/toml.mjs`) replaces the subset validator; agrees with Python
  `tomllib` on a 76-case corpus (verdicts and values); date/time = unsupported = failure.
- P2 wildcard exceptions: sound glob overlap (`scripts/globs.mjs`) replaces sample-path matching; unmodelled
  syntax defers. Soundness property-tested against the matcher used elsewhere.

## 2.0.0-rc.2
Implementation fixes from the rc.1 review (no design changes, no new agents). Each item has a regression test in
`tests/run-tests.mjs` (R01–R12).
- git-safe: revision arguments must resolve to commits (blocks `HEAD:.env`, `:.env`, blob/tree ids); `--no-index`,
  `--stdin`, `--pathspec-from-file`, `--git-dir`, `-O` blocked; pathspec/config-altering git env removed; excludes icase.
- apply: prepare records each draft's SHA-256 and prints `planSha256`; commit requires `--approved-plan` and aborts
  (exit 4, nothing written) if the plan or any draft changed.
- Run ids validated everywhere; `.ai` / run / lock / canary directories reject symlinks and junctions and must
  resolve inside the repo.
- Rollback undoes only the run's own writes (journal keeps pre-hash and expected-write hash); any skipped file makes
  it incomplete (exit 6) and cleanup refuses without `--confirm-manual-resolution`.
- Installer: preflights all targets, never changes anything if one is blocked, detects local edits regardless of
  version, refuses to replace unversioned (v1) copies without `--replace-unversioned`, switches all targets with
  revert on failure, non-zero exit codes, `verify` exits 5 on mismatch, rollback picks the newest backup by time.
- apply rejects drafts that change content outside managed blocks (or user-edited full files) unless the file is
  explicitly approved with `--approve-user-content`.
- Vault accepts env templates only.
- Settings merge holds back managed denies that would cancel a user `!` exception and reports them (`needsDecision`).
- validate: real TOML-subset parse for Codex wrappers; shape checks for `.claude/settings.json` and the manifest;
  `ok:false` + exit 1 on any failure.
- canary probe/verify without canaries: exit 3, verdict INCONCLUSIVE.

## 2.0.0-rc.1
Shared Claude Code + Codex setup.
- AGENTS.md is canonical; CLAUDE.md imports it. Nested instruction files are created as AGENTS.md/CLAUDE.md pairs.
- Canonical agents in `.ai/agents/` with thin Claude (`.claude/agents/*.md`) and Codex (`.codex/agents/*.toml`) wrappers.
- One secret list (`data/secret-paths.json`) renders Claude denies, a Codex permission-profile snippet, and git pathspec excludes.
- No agent reads any `.env*` file; `env-keys.mjs` exposes key names and value classification only.
- Transactional apply: drafts → prepare → reviewed diff → commit (re-verify, backup, journal, manifest last) → rollback.
- Ownership model: full files, managed blocks, managed keys, merged living docs. Line-ending-insensitive hashing.
- Modes: fresh, empty-repo, migrate-v1 (provenance only), adopt, add-claude, update.
- Canary protocol and capability report: controls are claimed only where measured.
- Fixes from v1: `.claudeignore` (no effect) retired; malformed PostToolUse hook reported; SQL "Bash" denies reported as
  ineffective; no automatic allow-listing of package scripts; DB change policy detected instead of imposed;
  TypeScript version taken from manifest/lockfile, not tsconfig.
