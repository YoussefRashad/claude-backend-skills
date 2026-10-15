<!--
FROZEN 2026-10-15 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Maintainer decisions on the six PLAN-GAP points the tests lane found while covering the
review-round-1 findings R1-R8 of the C11a implementation. They complete
docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md and the G1-G14 decisions file; where those are
silent, these bind both the tests and the implementation.
-->

# C11a: decisions on the review-round-1 plan gaps

Review round 1 of the C11a implementation found seven BLOCKING defects and one NON-BLOCKING defect
(R1-R8). The maintainer accepted the reviewer's fix for each. Covering them with tests exposed six
behaviours the plan did not pin to one value. Each point below now has one answer, and the tests
assert it exactly.

## Error codes

- **H1 (R1; plan 3.6, G4, G6).** When any path the helper is about to stage beneath the drafts
  directory already exists (a file, a directory, a junction or a symlink, at any depth), the helper
  fails with `V2_DESTINATION_EXISTS` and phase `init`, before it writes any draft. Nothing is
  written through a link, the drafts directory is left as it was, and nothing outside the project
  changes. Staging belongs to the `init` step, the last tagged script that ran.
- **H2 (R3; plan 3.6).** `root` must be the top-level directory of a Git repository, as Git
  discovers it under the helper's isolated configuration, and its `HEAD` must resolve to a commit.
  A root that is not a repository, is a subdirectory of another repository, or has no commit fails
  with `V2_OPTIONS_INVALID` and phase `null`, before materialization, before any tagged script runs
  and before any write to the root, the work directory or an enclosing repository.
- **H3 (R5; plan 3.4).** A failure to list or stat any entry while enumerating `data/` for unmapped
  versioned snapshots fails verification with the new code `V2_SNAPSHOT_UNREADABLE`, phase `null`,
  carrying the path relative to the skill root. Verification succeeds only after a complete
  traversal. The existing snapshot codes keep their meaning.

## Containment

- **H4 (R2; plans 3.6, 3.7, 4.3).** A path is outside a parent only when the relative path is
  exactly `..`, starts with `..` followed by a path separator, or is absolute. A name that merely
  begins with two dots, such as `..work` or `..meta`, is inside. Both the helper's work-directory
  check and the live fixture's metadata-beneath-output check compare canonical paths: each path is
  resolved through its longest existing ancestor (following junctions and symlinks) before the
  comparison. A `--meta` that reaches the output directory through a junction alias is rejected
  like a direct one, with exit 1 and nothing created.

## Live fixture

- **H5 (R7; G7, plan 3.7).** The extracted tagged source is kept until every v2 fixture output has
  been written. Any failure after `createV2InstalledFixture` succeeds (base commit, tag, skill
  copies, isolation checks, metadata or environment scripts) exits 1, prints no success JSON, and
  writes to stderr the error followed by the same retained-path line the helper failures use:
  `v2-baseline: tagged source kept at <absolute path>`. The directory is deleted only after the
  fixture has fully succeeded.
- **H6 (R4; G6, plan 3.7).** For `--kind v2` the output and metadata destinations are each created
  non-recursively and exclusively: creation fails if the path exists in any form, including an
  empty directory, a junction or a symlink, even when it appears after the initial existence check.
  A destination whose parent directory does not exist is refused with exit 1, and no parent is
  created. The fresh and v1 kinds keep their existing creation behavior.
