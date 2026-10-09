# rc.3 Windows review → rc.4

Evidence: `rc3-review-evidence.zip` (Windows 10.0.26100, Node v24.14.1, Git 2.53.0.windows.2). Bundled source is
identical to rc.3. Upstream result on that machine: 32 PASS, 0 FAIL, 1 SKIP (R13d, no file-symlink privilege).

## Reproduction

`review-recovery.mjs`, unchanged, against rc.3 on Linux (Node v22.22.2, git 2.43.0): exit 1. Second prepare/commit
on the partially applied run succeeded, the journal was replaced, rollback reported `complete: true`, and
`docs/a.md` stayed `NEW A`. Same result as on Windows. Finding accepted as stated.

## Fix

Lifecycle guard in `scripts/apply.mjs` (no redesign):
- a run writes at most once; its journal is never reset;
- prepare and commit are refused with exit 7 once the run has a journal, checked before any other commit check;
- prepare and commit in any run are refused while another run in the repo is `partial` or `rollback-incomplete`;
- exit 2/4 aborts happen before a journal exists, so re-prepare in the same run stays allowed there;
- `status` reports `state`: fresh · committed · partial · rollback-incomplete · rolled-back · aborted-before-write.

## Regression tests

| Test | Covers |
|---|---|
| R18 | Exact repro: partial commit → same-run prepare and commit refused (7), journal byte-identical; new run blocked while partial; rollback restores both files; rolled-back run not reusable; retry in a new run commits and is itself fully reversible |
| R19 | Retry after an incomplete rollback: same-run prepare/commit and a new run are refused; journal and backup kept; cleanup refused without confirmation; resolution by fixing the file + second rollback; resolution by explicit `cleanup --confirm-manual-resolution` keeps the user's edit |
| R20 | Committed run: prepare/commit refused, journal and file unchanged; exit-4 drift leaves no journal and allows re-prepare |

Evidence: the rc.4 suite on unmodified rc.3 fails R18, R19, R20 (33 pass). rc.4: 36/36 pass, three consecutive
runs on Linux. `review-recovery.mjs` unchanged on rc.4: exit 0; retry refused (state `partial`), rollback complete,
`finalA = ORIGINAL A`, `finalB = ORIGINAL B`.

## Not verified

- rc.4 has not been run on Windows. Expected there: 35 PASS + R13d SKIP (no file-symlink privilege). Do not read
  "36/36" as a Windows result.
- Live Claude/Codex skill discovery, custom-agent execution, and sandbox enforcement remain unverified; canary unit
  tests do not establish runtime protection.
