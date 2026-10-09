# Live acceptance (rc.7 fixtures, rc.7/rc.9 skill) → rc.10

Environment: Windows 11 native, Claude Code 2.1.295 (isolated `CLAUDE_CONFIG_DIR`), Codex 0.160.1 (isolated
`CODEX_HOME`, `-p skill-isolation`, non-admin sandbox), Node 24.14.1, synthetic fixtures only.

## Results

| ID | Claude | Codex | Evidence |
|---|---|---|---|
| Discovery, Phase 0 hard stop | PASS | PASS | Phase 0 summaries, no file changes (hash compare) |
| Approval gate, commit with approved hash | PASS | PASS | plan hashes 3a7aa35e… (Claude), 897fc012… (Codex) |
| AGENTS.md loading | PASS | PASS | session context / quoted rule |
| Custom reviewer: defective vs control range | PASS | PASS | Codex threads `/root/reviewer`; oracle: change-1 defective (total 160), change-2 correct |
| L11 zero-diff update | – | PASS | 15 drafts identical, `committed:false` zero diff, hashes unchanged |
| L12 lock respected | – | PASS | stopped, showed owner, did not break after refusal |
| L13 migrate-v1 | PASS with defect | – | 17 files; `--approve-user-content` not required for v1 CLAUDE.md (fixed in rc.10) |
| L14 refuse `.env` | PASS | – | refused, no content |
| Canary: file tool / shell / late file | PASS / PASS / PASS | n/a / FAIL / – | lab folder, permission-denial messages |
| Canary: subprocess (Node) | FAIL (expected) | FAIL | 4/4 READABLE |
| Codex deny profile, non-admin sandbox | – | refuses to start | "cannot enforce deny-read restrictions directly" |

Invalid runs (discarded): Codex session started in the home folder with real config; an L10b run that spawned an
ad-hoc agent and read a user-level skill; an L13 attempt in auto permission mode.

## Mapping to rc.10

| Live finding | Fix | Test |
|---|---|---|
| prepare did not require approval for v1 CLAUDE.md / reviewer.md | unowned files may only gain blocks; settings append-only | R29 |
| validate failed on a user-kept legacy hook | user-owned keys → warn | R30 |
| detect missed `synced/` copies and disables | nested scan, skillOverrides, skills.config, profile-only | R31 |
| canary duplicated index entries | replace on re-run | R32 |
| Codex ad-hoc agent | AGENTS.md names agents; runbook judges by thread | docs |
| Windows profile refusal | snippet warning, codex.md | docs |
| (self-review) secret files as script input | refuse before opening | R34 |
| (self-review) git -L/--contents | blocked | R33 |

## Not verified

- rc.10 itself has not run on Windows or in live sessions.
- Codex with the admin-installed Windows sandbox or WSL2; Claude under WSL2 with the sandbox.
- Organization-plugin variant of v1 retirement.
