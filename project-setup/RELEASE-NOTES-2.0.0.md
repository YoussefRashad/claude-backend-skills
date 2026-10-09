# project-setup 2.0.0

Shared Claude Code + Codex setup for backend repositories: `AGENTS.md` as the shared source of truth, `CLAUDE.md`
importing it, shared `reviewer` and `docs-sync` agents with thin per-tool wrappers, secret-path controls rendered for
both tools, and project documentation generated from the code. Built from the `2.0.0-rc.13` source without functional
changes (only `VERSION` and release documentation differ).

## What it does

- Phase 0 discovery with a hard stop; drafts only; `prepare` produces a plan hash; `commit` applies exactly the
  approved plan (drafts, ownership metadata and targets re-verified) and writes the manifest last.
- Files the skill does not own may only gain managed blocks; any other change needs `--approve-user-content`.
- Transactional apply with backups, journal, verified rollback, and a run lifecycle that never resets a journal.
- Installer that copies one versioned source to both tools, verifies, never replaces unversioned (v1) copies without
  consent, switches all targets or none, and rolls back from verified backups only.
- Migration from the Claude-only v1, keeping the paths other skills depend on.

## Verification behind this release

| Evidence | Result |
|---|---|
| Final Windows verification of rc.13 (Windows 11 10.0.26100, Node 24.14.1, Git 2.53) | 59 PASS / 0 FAIL / 1 SKIP (R13d: file-symlink privilege unavailable; directory junctions tested) |
| Independent adversarial harnesses (rc.10 adversarial, adoption, rc.11 extra, rc.12 precedence, rc.13 reporting), unmodified | all exit 0 |
| Live sessions (Claude Code 2.1.295, Codex 0.160.1, Windows native, isolated configs, synthetic fixtures) | discovery, Phase 0 stop, approval gate, commit by hash, AGENTS.md loading, shared reviewer on a real defect and a control (both tools), Codex zero-diff update, lock respected, v1 migration, `.env` refusal |
| Review decision on rc.13 | "no remaining findings within scope; ready for 2.0.0" |

Release criterion used: no reproducible P0/P1 finding, and no P2 finding inside the scope of the last fix.
That is not a claim that the code has no defects.

## Known limitations (environmental, not release blockers)

Secret protection is a set of tool-level controls, not an OS security boundary. Measured live on Windows 11 native:

| Layer | Claude Code 2.1.295 (managed denies) | Codex 0.160.1 |
|---|---|---|
| Agent file tool | denied | n/a |
| Shell command naming the file (`cat`, `Get-Content`) | denied | readable (no deny profile) |
| File created after the session started | denied | not tested |
| A script/subprocess that reads files itself (e.g. Node) | **readable** | **readable** |
| Deny-read profile on the non-admin Windows sandbox | n/a | Codex refuses to start (fail-closed) |

Consequences:
- On native Windows, a subprocess started by either agent can read secret files. Do not keep real secrets in
  development working trees (use non-production values locally, production secrets in a secrets manager).
- Do not add the Codex deny-read profile on machines that only have the non-admin Windows sandbox; Codex will not open.
- Agents follow the "never read secret paths" rule from `AGENTS.md`; that is an instruction, not enforcement.

## Backlog (not blocking 2.0.0)

- OS-level enforcement: Claude Code sandbox under WSL2; Codex with the admin-installed Windows sandbox or WSL2. Both
  untested; re-run the canary protocol (`references/security.md` §4, lab folder) before relying on either.
- v1 retirement when v1 is shipped inside an organization plugin together with other skills (needs the plugin owner).
- R13d (file symlinks on Windows) has never run on Windows; it needs Developer Mode or the symlink privilege.
- Re-run the full live acceptance matrix (`tests/live/LIVE-ACCEPTANCE.md`) with 2.0.0 itself; the live runs used the
  rc.7/rc.9/rc.10 skill copies, and later changes were verified by the suite and harnesses.

## Install

See `README.md`. Retire v1 first (`references/claude.md` "Retiring v1"), install on one project on a branch, review,
and keep the run directory until the result is confirmed (rollback needs it).
