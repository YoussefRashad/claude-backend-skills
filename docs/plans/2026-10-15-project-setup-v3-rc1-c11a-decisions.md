<!--
FROZEN 2026-10-15 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Maintainer decisions on the fourteen PLAN-GAP points the tests lane found while writing
project-setup/tests/c11a.test.mjs from docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md.
They complete that plan; where the plan is silent, these bind both the tests and the implementation.
-->

# C11a: decisions on the tests-lane plan gaps

The C11a plan described these behaviours without pinning one exact value, so the first test draft
accepted either reading. Each point below now has one answer, and the tests assert it exactly.

## Error codes

- **G3 (plan 2.4).** An exception thrown by the injected executor itself, before a process result
  exists, fails with the new code `V2_EXECUTOR_FAILED`. It is distinct from `V2_PROCESS_FAILED`,
  which stays the code for a process that was started and then failed (spawn error or signal).
- **G5 (plan 3.6).** A tagged script that exits 0 but prints output that is not the valid JSON its
  phase requires fails with the new code `V2_OUTPUT_INVALID`, carrying that phase. This applies to
  every phase that has no dedicated code; `V2_PREPARE_INVALID`, `V2_COMMIT_INVALID` and
  `V2_VALIDATE_FAILED` keep their meaning for their phases.
- **G14 (plan 2.7).** An executor rejection in the gate produces the verdict code
  `suite-execution`, the same as a spawn error, timeout or truncated capture.
- **G11 (plan 2.5).** Every `SUITE_*` error is thrown with the token in `err.code` (for example
  `err.code === 'SUITE_DUPLICATE_ID'`), and `err.message` starts with the same token.

## Fields in errors and reports

- **G4 (plans 2.4, 4.2).** Every phase-related `V2_*` error carries `phase` set to the phase name
  (`lock-acquire`, `init`, `blocks`, `merge`, `prepare`, `commit`, `validate`, `lock-release`, as
  plan 2.4 names them). `phase` is `null` only for a failure before any tagged script runs, such as a git
  read during tag resolution or materialization.
- **G9 (plan 3.1).** An `inventory-invalid` issue always carries an `id` field: the offending
  assertion ID, or `null` when the issue is not about one ID.
- **G12 (plan 3.3).** Every gate failure report always carries `summary` and `resultsFile`. Each is
  filled when it could be determined and is `null` otherwise, including for `suite-execution`,
  `suite-exit` and `malformed-record`.

## Printed output

- **G10 (plan 3.1).** The totals line is printed for every component run, including a structural
  failure, where it reads `0 PASS / 0 FAIL / 0 SKIP`, followed by the RESULTS line.
- **G13 (plan 2.7).** A `RESULTS` line follows every gate verdict whose results file is known,
  including a nonzero-exit verdict whose stdout still carries a valid envelope.

## Locations

- **G2 (plan 2.4).** `materializeV2Source` writes the tagged `project-setup/` tree directly into
  `destination`: `destination` is the skill root, and the returned `skillRoot` equals it. There is
  no inner `project-setup/` folder.
- **G6 (plan 3.6).** Every destination the C11a helpers write to must not exist. The helper creates
  it itself, non-recursively, and refuses an existing path of any kind, including an empty
  directory, a junction or a symlink. Reason: an empty-looking directory can be a junction to
  another tree, and creating the directory itself removes that case without further checks.
- **G7 (plan 3.7).** The live `--kind v2` fixture extracts the tagged source into a new directory
  under the OS temp directory, outside the output and the project. It is deleted when the fixture
  succeeds. On failure it is kept and its path is printed in the error.

## Technical details

- **G1 (plan 3.5).** `git ls-tree -r -z` is read in git's default record format,
  `<mode> SP <type> SP <oid> TAB <path>`, each record terminated by NUL. No `--format` option is
  used.
- **G8 (plans 2.5, 3.3).** `RC1_CASE_IDS` is exactly the 38 additional numbered IDs followed by
  `A5-templates` and `N8-doctor`, in the order plan 3.3 lists them (40 entries).
  `BASELINE_CASE_IDS`, `RC1_CASE_IDS` and `REQUIRED_CASE_IDS` are frozen with `Object.freeze`, and
  `REQUIRED_CASE_IDS` is the baseline IDs followed by `RC1_CASE_IDS` (100 entries).
