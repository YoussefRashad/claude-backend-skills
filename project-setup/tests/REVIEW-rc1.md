# rc.1 review → rc.2 fixes

Reviewed evidence: `rc1-review-evidence.zip` (GPT, Windows native, Node v24.14.1, git 2.53.0.windows.2).
The source inside it is byte-identical to rc.1 (checked with `diff -r --strip-trailing-cr`).

## Independent reproduction of the findings on rc.1

GPT's two scripts were re-run unchanged against rc.1 on Linux (Node v22.22.2, git 2.43.0). All 12 findings
reproduced with the same observable results. The `.ai` junction case reproduces with a directory symlink on Linux.

## Mapping

| # | Finding | Fix | Regression test |
|---|---|---|---|
| 1 | `git-safe show HEAD:.env` prints content | Revision args must resolve to commits; `rev:path`, `:path`, blob/tree ids, `--no-index`, `--stdin`, `--pathspec-from-file`, `--git-dir`, `-O` blocked; pathspec/config git env stripped; excludes icase | R01 |
| 2 | Draft changed after prepare is applied | Plan stores each draft SHA-256; commit requires `--approved-plan <planSha256>` and re-verifies plan + drafts + targets + manifest (exit 4, nothing written) | R02 |
| 3 | run-id traversal; `.ai` junction redirects lock writes | `validateRunId` in every script; `secureDir` rejects symlink/junction segments and checks real-path containment for `.ai`, run, lock, canary, vault | R03a, R03b |
| 4 | Rollback of `backed-up` can clobber a later edit; skipped rollback reported as done, cleanup deletes backups | Journal keeps `preRawSha` + `expectedWriteSha`; only the run's own bytes are undone; any skip → exit 6, `rollbackComplete:false`, cleanup refused without `--confirm-manual-resolution` | R04a, R04b |
| 5 | Installer updates Claude, leaves Codex old, exit 0 | All targets preflighted; one blocked target → exit 3, nothing changed; switch-all with revert on failure (exit 4) | R05 |
| 6 | Same-version reinstall ignores local edit; `verify` exits 0 on mismatch | Current tree hash compared with install metadata regardless of version → blocked; `verify` exit 5 unless every target matches | R06 |
| 7 | apply drops content outside managed blocks | prepare compares outside-block content (blocks collapsed to id placeholders) and user-edited full files; rejects unless `--approve-user-content <file>`; approvals for files that don't need it are rejected | R07 |
| 8 | Vault exception writes arbitrary secret paths | Vault accepts only `.env.example/.sample/.template` | R08 |
| 9 | Appended deny silently cancels user `!` exception | Covering rules are held back from the draft, reported as conflicts (`needsDecision`), added only with `--override-user-exceptions` | R09 |
| 10 | Validator accepts invalid TOML and wrongly typed JSON | TOML-subset parser for Codex wrappers; shape checks for settings (incl. legacy hook shape) and manifest; `ok:false` + exit 1 | R10 |
| 11 | Installer rollback picks alphabetically last backup | Ordered by `.backup.json` time, then trailing timestamp, then mtime; no backup → exit 6 | R11 |
| 12 | canary probe without index returns ok + empty | probe/verify without canaries → exit 3, verdict `INCONCLUSIVE` | R12 |
| + | (found while checking the evidence) rc.1 installer would silently back up and replace an existing v1 copy in `~/.claude/skills` / `~/.agents/skills` | Unversioned copies are blocked unless `--replace-unversioned` | R06b |

Success paths kept: S01 fresh end-to-end + validate clean, S02 zero diff (files + manifest byte-identical),
S03 CRLF no false drift + CRLF preserved, S04 complete rollback + cleanup, S05 lock contention/break,
S06 env-keys never opens `.env`, S07 installer install/unchanged/upgrade/verify/rollback/plugin stop,
S08 canary measurement, S09 scope rejection.

## Evidence that the tests detect the bugs

The same `tests/run-tests.mjs` run against unmodified rc.1: all 15 regression tests (R01–R12, R03b, R04b, R06b) FAIL;
rc.2: 24/24 PASS, three consecutive runs.

GPT's original scripts on rc.2 (adapter only forwards `planSha256` from prepare to commit, required by the new
contract; no test logic changed): every finding reports the safe outcome.

## Not verified

- Windows native: none of rc.2 has been run on Windows. Junction behaviour, `fs.realpathSync.native`, rename
  semantics under AV/indexer locks, and PowerShell invocation are reasoned about, not tested. Run
  `node tests/run-tests.mjs` on the Windows machine first; R03b uses a real junction there.
- Agent behaviour (Claude/Codex following SKILL.md, loading AGENTS.md, custom agents) is outside this suite.
- git-safe restrictions were tested with git 2.43; option semantics can differ across git versions.
