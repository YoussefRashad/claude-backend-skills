<!--
FROZEN 2026-10-16 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Maintainer decision on the one gap that review round 2 of the C11a implementation
exposed. It completes docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md, the G1-G14 decisions
and the H1-H6 review decisions; where those are silent, it binds both the tests and the
implementation.
-->

# C11a: decision from review round 2

Review round 2 found that the fix for R6 still let some malformed totals lines through
(`.5 PASS / 0 FAIL / 0 SKIP`, `1e2 PASS / 0 FAIL / 0 SKIP`). The fix had guessed the shape of a
malformed line, and any guess leaves shapes out. The decision below removes the guess.

- **H7 (R6, review round 2 C11a-R2-1; plan 3.3).** In the suite stdout the gate validates, a
  totals candidate is every line that contains the word `PASS` in any letter case and is not a
  well-formed record line as plan sections 3.2 and 3.3 define it (`PASS`, `FAIL` or `SKIP`, then
  the ID and name in the record format). The transcript must hold exactly one candidate, and it
  must match `<n> PASS / <n> FAIL / <n> SKIP` exactly, where each `<n>` is a decimal integer.
  Zero candidates, more than one, or one that does not match exactly yields the verdict
  `summary-invalid`. This check runs before the record-inventory checks, and G12 still applies to
  the report.
