# 04 — Review and Definition of Done

> Two parts, deliberately separated.
>
> **Part A** is machine-checkable. A tool decides, not a person and not an agent.
> **Part B** requires judgment. A human decides.
>
> **An AI agent MAY assert Part A only**, and only by reporting what a command actually
> returned. It **MUST NOT** tick a Part B item — it **MUST** present Part B as findings for a
> reviewer. Ticking "no N+1 queries" or "SOLID followed" without a tool behind it is a
> self-assessment, and self-assessments are why checklists stop being read.

---

## Part A — Automated gates

These **MUST** pass before merge, and **MUST** run in CI (`01` §18). Report the command and
its result, not your impression.

| #   | Gate                       | Command                       | Blocking            |
| --- | -------------------------- | ----------------------------- | ------------------- |
| A1  | Lint                       | `<project lint command>`      | Yes                 |
| A2  | Type check                 | `<project typecheck command>` | Yes                 |
| A3  | Unit tests                 | `<project test command>`      | Yes                 |
| A4  | Dependency vulnerabilities | `<scan command>`              | Yes — High/Critical |
| A5  | Secret scan                | `<scan command>`              | Yes                 |
| A6  | Format                     | `<format check command>`      | Yes                 |
| A7  | Build                      | `<build command>`             | Yes                 |

Fill the commands in from `.ai/standards/03-project-architecture.md` §12.

> **"Blocking" means the merge cannot proceed, not that the job reports red.** A
> workflow that fails while merges continue anyway is a notification, not a gate. Check
> that branch protection actually requires these checks before ticking anything here —
> and if it does not, say so rather than reporting a passing Part A.

> **Two gates need care about their exit code.** A4 and A5 are commonly wired to a
> scanner that prints findings and exits 0. Confirm the command you fill in actually
> fails on a finding; otherwise the row is decorative.

### Lint rules that make Part B items automatic

These **SHOULD** be configured so a reviewer never has to check them by eye. The
`toolchain-config` baseline configures all of them:

| Rule                                                                         | Enforces                        | In the canonical config                          |
| ---------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| Ban `console.*`                                                              | `01` §14, `02` §2.5             | `no-console: error` (off in specs)               |
| Ban `any` or an inline object literal on `@Body()` / `@Query()` / `@Param()` | `01` §5                         | `no-restricted-syntax`                           |
| Ban empty catch blocks                                                       | `01` §4                         | `no-empty` (from `js.configs.recommended`)       |
| Ban interpolation or `+` inside query-builder calls                          | `01` §7 — catches SQL injection | `no-restricted-syntax`                           |
| Require `await` on floating promises                                         | Correctness                     | `@typescript-eslint/no-floating-promises: error` |
| Import cycle detection                                                       | `01` §1                         | `import/no-cycle: error`                         |

A rule listed here that your project's lint does **not** actually run is a Part B item
again, and **MUST** be checked by eye until it is configured. Verify rather than assume —
these were once listed here while nothing implemented them.

If a rule in Part B can be moved here, move it. That is the direction of travel.

---

## Part B — Human review

Judgment required. An agent **MUST** report on these as findings with evidence; a human
decides whether they pass.

### B1 — Scope and safety

- [ ] The change does only what was asked. No drive-by refactors, renames or reformatting.
- [ ] No guard, lock, HMAC check, idempotency key or status guard was removed or weakened.
- [ ] No dependency was added or upgraded as a side effect.
- [ ] Deviations from a **SHOULD** are stated, with reasons.

### B2 — Backward compatibility (`01` §13) — check first on any change to a live endpoint

- [ ] No response field removed or renamed.
- [ ] No field's JSON type changed.
- [ ] No status code changed for an existing outcome.
- [ ] No validation tightened on an existing field.
- [ ] No required request field added.
- [ ] Entity changes are additive and compatible with the currently deployed code.
- [ ] Breaking changes, if any, are behind a client version gate.

> If any box here is unticked, stop. This section overrides the rest of the checklist.

### B3 — Security (`02`)

- [ ] No Class A data (PIN, password, PAN, CVV, card token, private key) reachable by any log
      path — including new error logs and new request/response logging.
- [ ] No Class B or Class C data written outside the audited log store — not to stdout, an
      error tracker, an APM, or any external service.
- [ ] Nothing added that exposes the log store through an API, export or dashboard. If the
      change does, it was raised with the owner first (`02` §1).
- [ ] Redaction covers **responses**, not only requests.
- [ ] Identity comes from the verified auth context — not a body, query or path parameter.
- [ ] Resource ownership verified by database lookup.
- [ ] New routes have an explicit auth guard. (Check this even if routes are not public by
      default — especially if they are.)
- [ ] Any new signature-verification exemption is justified and recorded.
- [ ] Webhook handlers verify the signature **before** any state change, in constant time.
- [ ] No user value interpolated into SQL. Dynamic identifiers come from an allowlist
      enforced at the query layer.
- [ ] No secret hard-coded or returned in a response. Class B secrets stay inside the
      audited log store; no other secret is logged at all.
- [ ] TLS verification not disabled anywhere.

### B4 — Data

- [ ] Money stored as `numeric`/`decimal`; entity property typed `string` or transformed.
- [ ] All amount math goes through the shared utility; minor units not mixed.
- [ ] Multi-write operations are transactional; no transaction spans an HTTP call.
- [ ] Read-after-write targets the primary where correctness depends on it.
- [ ] No N+1; no query per element of an unbounded collection.
- [ ] New indexes justified by a query plan, not by the presence of a `WHERE` clause.
- [ ] Idempotency backed by a unique constraint on any path that can receive a duplicate.
- [ ] New queries complete within the statement timeout.
- [ ] **Required DDL is stated explicitly in the change summary.**
- [ ] New retention obligations recorded (`02` §3).

### B5 — Integration and resilience

- [ ] Every new outbound client has an explicit timeout.
- [ ] No retry added to a non-idempotent operation.
- [ ] New queue jobs are idempotent and their failures are observable.
- [ ] New cron jobs are environment-gated and locked if they must run once.
- [ ] Error handlers do not assume a response object exists.

### B6 — Observability

- [ ] Correlation ID propagated through new code paths.
- [ ] New failure modes produce a log with enough context to diagnose without reproducing.
- [ ] No `console.*` added.
- [ ] No empty catch blocks.
- [ ] Stated explicitly: what would surface this change failing in production, and what
      would not.

### B7 — Design

- [ ] Layering respected: controller → service → repository.
- [ ] Existing helpers reused rather than duplicated.
- [ ] Module conventions match the module being edited, not a different one.
- [ ] New i18n keys added to **every** locale.
- [ ] Tests cover the state transitions, idempotency and authorization paths that exist.

---

## Reporting template

```markdown
## What changed

<one paragraph>

## Money / PII / auth paths touched

<which, and which invariant was relied on — or "none">

## Automated gates

| Gate            | Result               |
| --------------- | -------------------- |
| Lint            | <pass/fail + output> |
| Type check      | <…>                  |
| Tests           | <…>                  |
| Dependency scan | <…>                  |
| Secret scan     | <…>                  |

## Required DDL

<exact SQL, or "none">

## Deviations

<any SHOULD not followed, and why>

## Standard vs project mismatches found

<reported, NOT fixed — see 00 §3>

## What I actually verified

<the behaviour observed — not "the suite passed">

## What I did not do

<explicitly out of scope, and anything left incomplete>
```

---

## Reviewer notes

- Severity labels: **CRITICAL / HIGH / MEDIUM / LOW / NIT**.
- A review **MUST NOT** conclude "looks good" unless Part A passed and Part B was actually
  examined.
- Findings **MUST** cite `file:line`.
- A finding on a money, PII or auth path **MUST** be treated as blocking until explicitly
  waived by the owner.
