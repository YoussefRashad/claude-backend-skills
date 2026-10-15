<!--
FROZEN 2026-10-16 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Maintainer decision H7a. It narrows H7 in
docs/plans/2026-10-15-project-setup-v3-rc1-c11a-review2-decisions.md, which stays as written.
Where the two differ, H7a governs.
-->

# C11a: decision H7a, narrowing H7

Writing tests for H7 showed that its candidate rule was too broad for the plan. Plan section 3.1
prefixes every failure diagnostic with eight spaces and `- `, and section 3.3 says non-record
diagnostics do not count as results. Such a line may contain the word `PASS`, and H7 would have
counted it as a second totals line. Read as a substring, H7 would also have caught `PASSED` and
an ANSI-prefixed record, which the plan's section 4.6 table resolves as `missing-record`.

- **H7a (R6; plans 3.1, 3.3, 4.6).** A totals candidate is a line that meets all three conditions:
  1. It contains `PASS` as a whole word, in any letter case. A whole word means the letters are not
     preceded or followed by an ASCII letter, digit or underscore. So `PASSED`, and `PASS` directly
     after an ANSI sequence ending in `m`, are not candidates.
  2. It is not a well-formed record line.
  3. It is not a failure diagnostic line, meaning a line that begins with exactly eight spaces
     followed by `- `.

  Everything else in H7 is unchanged:
  - There must be exactly one candidate.
  - It must match `<n> PASS / <n> FAIL / <n> SKIP` exactly, with decimal integers.
  - Any other case is `summary-invalid`.
  - The check runs before the record-inventory checks.

  As a result, a record-shaped line indented by any other amount, such as four spaces, is a
  candidate, and its transcript is `summary-invalid`.
