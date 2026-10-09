# rc.2 Windows review → rc.3

Evidence reviewed: `rc2-review-evidence.zip` (Windows 10.0.26100, Node v24.14.1, Git 2.53.0.windows.2).
The bundled source is identical to rc.2 (`diff -r --strip-trailing-cr`).

## Reproduction

`review-extra.mjs` was run unchanged against rc.2 on Linux (Node v22.22.2, git 2.43.0; directory symlink in place of
a junction). All five findings reproduced with the same observable outcomes; the `--out` abbreviation negative
control also did not reproduce (git exit 129, no file). No disagreement with any finding.

## Mapping

| Finding | Fix | Regression tests |
|---|---|---|
| P1 backup junction escapes the repo | `secureDir` refuses any anchor other than the repo root; every run/lock/canary read and write re-validates the full chain from the root at use time (`writeInRepo`/`readInRepo`); linked leaf files refused; exclusive temp + rename; commit checks drafts/vault/backup before its first write (exit 2) | R13a (exact repro), R13b (vault, nested backup dir, drafts), R13c (rollback restore source), R13d (pre-placed backup leaf symlink) |
| P1 installer metadata failure leaves a target missing | Target journalled before first mutation with its phase; any failure restores it and all earlier targets; end state re-measured and reported; metadata moved next to the backup (exclusive create); unexpected top-level entries = local modification | R14a (exact repro: blocked, nothing changed), R14b (failures injected at `before-backup`, `metadata`, `install` for both targets: both restored, no leftovers, clean retry) |
| P2 approved plan does not bind ownership metadata | `ownership.json` / `managed-keys.json` validated at prepare, embedded with hashes in the plan; commit uses the embedded copy, aborts (exit 4) on any change | R15 (exact repro + managed-keys + invalid values/targets) |
| P2 invalid TOML escape passes | New strict TOML 1.0 parser; unsupported constructs (date/time) fail | R16 (exact repro, 76-case corpus vs Python tomllib: verdicts and parsed values agree) |
| P2 wildcard exception not held back | Sound glob overlap over literals/`*`/`?`/`**`; unmodelled syntax defers | R17 (exact repro + 4 variants, 2 provably-disjoint controls, soundness property check) |

## Evidence the tests detect the bugs

The rc.3 suite run against unmodified rc.2: R13a–d, R14a–b, R15, R16, R17 all FAIL (R05 also fails there only
because the failpoint variable was renamed). rc.3: 33/33 pass, three consecutive runs.

`review-extra.mjs` on rc.3 (one guard added so it does not crash reading a manifest that rc.3 correctly refuses
to write; observation logic unchanged): backup-junction exit 2, nothing outside; unapproved-ownership exit 4,
target unchanged; invalid-toml-escape exit 1 ok:false; installer exit 3 blocked, both targets present;
wildcard-exception needsDecision:true, `Read(**/.env.*)` held back.

## Notes

- Wildcard deferral is intentionally conservative and intent-preserving: `Read(!*.example)` also defers
  `Read(**/id_rsa*)` and directory rules, because `id_rsa.example` / `secrets/x.example` match both. In Claude's
  documented semantics a `!` rule with no earlier rule in the same source carves nothing; the merge still asks,
  because the exception states the user's intent.
- The installer failpoint remains test-only (unset = no effect), now covering the metadata phase.

## Not verified

- rc.3 has not been run on Windows. R13d needs file-symlink privileges and will report SKIP (never PASS) without
  Developer Mode/admin; the junction cases (R13a–c) use real junctions there.
- Live Claude Code / Codex behaviour (instruction discovery, custom agents, sandbox enforcement) is not covered.
  The canary unit tests prove the harness, not the protection of a real session.
