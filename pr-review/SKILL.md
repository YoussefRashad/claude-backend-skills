---
name: pr-review
description: Multi-lane review of a single PR or diff for any backend project — runs real automated security/dependency/secret scans, launches the project's reviewer agent and the audit skill's security checks, then a quality pass, and combines everything into a severity-ranked report with an explicit blocking verdict. Scoped to the diff (per-PR gate); for a full-codebase safety net use /audit. Treats the codebase as sensitive by default (fintech-grade).
---

# PR Review — Multi-Lane Diff Review & Vulnerability Scan

Run three independent lanes on the **same diff**, triage the results, and produce one severity-ranked report with a blocking verdict. Automated lanes catch what eyes miss; human-style lanes catch what tools miss. None alone is sufficient.

## Critical Rules (read first)

1. **Never read or review secret files:** `.env`, `.env.*`, `**/.env*`, `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `**/id_rsa*`, `**/secrets/**`, `**/credentials/**`, `**/.aws/**`, `**/.ssh/**`, `**/.gnupg/**`. If a secret appears **inside the diff**, that is itself a Critical finding — report the file:line and the secret *type*, never echo the value.
2. **Review only what changed.** Scope to the diff. Do not review `node_modules/`, `dist/`, `build/`, generated files, lockfiles (except to flag dependency risks), or migration snapshots — unless the change is *in* them.
3. **Every scanner finding is a candidate, not a verdict.** Triage for false positives before reporting (see Step 4). Label confidence.
4. **Never auto-fix or commit.** Review only. Suggest fixes as diffs/instructions.
5. **Fail loud, not silent.** If a lane can't run (tool missing, skill absent), say so in the report — don't drop it quietly.

---

## Step 1 — Determine the diff

Parse the user's argument:
- **PR URL / number** → `gh pr diff <number>` (also pull PR title/description for intent)
- **Branch name** → `git diff <base>...<branch>`
- **File paths** → diff those paths against base
- **No argument** → `git diff <base>...HEAD`

Detect the base branch (don't assume `main`):
```
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

Capture, for the report's provenance: changed files, `+/-` line counts, and `git log --oneline <base>..HEAD`. Save the diff once — **all lanes use the identical diff**. If the diff is empty, say so and stop.

---

## Step 2 — Lane A: Automated Scans (real tools)

Run whatever is available; skip-and-note the rest. Prefer scanning only changed files where the tool allows.

| Scan | Command (if tool present) | Catches |
|------|---------------------------|---------|
| Secrets | `gitleaks detect --no-git --source <changed> -v` or `trufflehog filesystem <changed>` | Committed keys/tokens |
| SAST | `semgrep --config auto <changed>` (or `--config p/security-audit p/owasp-top-ten`) | Injection, SSRF, weak crypto, authz gaps |
| Dependencies (SCA) | `npm audit --json` / `pnpm audit` / `pip-audit` / `govulncheck ./...` / `osv-scanner` | Known CVEs in deps |
| Lint (security rules) | project linter (`eslint` w/ `eslint-plugin-security`, `ruff`, `gosec`) | Language-specific footguns |
| Types (if TS) | `tsc --noEmit` on the branch | Type-safety regressions the diff introduces |

Rules for Lane A:
- If **no** scanner is installed, note it prominently and continue with lanes B/C — but downgrade the report's confidence and add a `TODO` to install scanners in CI.
- For `npm audit`, only surface advisories reachable from **direct** deps changed in this diff, or Critical/High transitive ones; don't dump the whole tree.
- Capture raw counts per tool for the report header.

---

## Step 3 — Lane B: Security Review (reviewer agent + audit checks)

Two sub-passes, both security-focused:

**B1 — Project reviewer agent.** If `.claude/agents/reviewer.md` exists, launch it (Agent tool, `subagent_type: "reviewer"`) with the diff — it's tailored to this project's domain/stack. If it doesn't exist, do the security review inline against the checklist below.

**B2 — `/audit` security checks.** If the `audit` skill exists in the project, apply its Security-lane checks (S1–S12) to the **changed files only** — PII logging, hard-coded secrets, SQL injection, missing validation, unguarded routes, broken auth, weak crypto, SSRF. If it doesn't exist, fold that checklist into B1. (Full-codebase scanning is `/audit`'s job, not this skill's — here it's diff-scoped.)

Inline security checklist (fallback / supplement):
- Secrets/credentials or PII in code **or logs**
- SQL/NoSQL injection, raw/unparameterized queries, dynamic query building
- Missing input validation / mass-assignment / unsafe deserialization
- Missing or wrong authz (guards, decorators, ownership checks, IDOR)
- Broken auth: JWT verification, token expiry/rotation, `deletedAt`/status checks on session refresh
- Error/stack details leaked to clients
- SSRF, path traversal, open redirect
- Unbounded retries/loops, missing rate limiting, missing idempotency on money/state-changing endpoints
- Race conditions on shared state (balances, points, locks) — check for atomicity (SELECT … FOR UPDATE, Redis Lua, DB constraints)
- Weak crypto / hardcoded IVs / ECB / MD5-SHA1 for security / missing HMAC / nonce reuse

---

## Step 4 — Lane C: Quality Review

Correctness, performance, maintainability on the same diff:
- **Correctness:** edge cases, null/undefined, off-by-one, error handling, transaction boundaries, backward compatibility of API/DB changes
- **Performance:** N+1 queries, unbounded/unindexed queries, blocking I/O on hot paths, missing pagination, cache stampede, memory retention
- **Maintainability:** naming, duplication, dead code, oversized functions/classes, leaky abstractions, SOLID violations
- **Tests:** are new paths covered? do changed behaviors have tests? assertions meaningful?

If a project `/code-review` skill exists, you may run it here instead of the inline pass — but note in the report which was used.

---

## Step 5 — Triage & Combine

1. **Deduplicate** across lanes by `file:line` — if a tool and the agent both flag it, merge and keep the richest description; note both sources (raises confidence).
2. **Triage scanner output for false positives.** For each Lane-A hit, verify it's reachable/real in context. Mark `Confirmed` / `Likely` / `Possible FP` and drop noise (with a one-line note on what was dropped and why).
3. **Assign severity by rubric** (below) — do not eyeball it.
4. **Sort** Critical → High → Medium → Low.

### Severity rubric
| Severity | Definition |
|----------|------------|
| **Critical** | Exploitable now: secret in diff, injection, auth bypass, money/PII integrity loss, known Critical CVE reachable |
| **High** | Serious but conditional: missing authz on sensitive route, race on shared state, High CVE, PII in logs |
| **Medium** | Real risk, bounded: missing validation on non-sensitive input, N+1, weak error handling |
| **Low / Nit** | Style, naming, minor perf, test gaps with low blast radius |

---

## Step 6 — Report

```
### Summary
1–2 sentences: what the change does + overall assessment.

### Scan Coverage
Diff: <N files, +X/-Y>. Base: <branch>. Commits: <n>.
Lanes run: A(secrets✓ SAST✓ SCA✓ lint✗) B(reviewer-agent✓ audit-checks✓) C(quality✓).
Tools missing: <list> → see TODO.

### Critical & High
| # | File:Line | Issue | Severity | Confidence | Source | Fix |
|---|-----------|-------|----------|------------|--------|-----|

### Medium & Low
| # | File:Line | Issue | Severity | Source | Fix |
|---|-----------|-------|----------|--------|-----|

### Dropped (likely false positives)
| Tool | File:Line | Why dropped |

### Verdict
🔴 Block Merge / 🟡 Approve with required changes / 🟢 Approve — one-line reason.
```

### Blocking policy (deterministic)
- **Any Critical → 🔴 Block Merge.** No exceptions from within this review.
- **Any unresolved High → 🟡 Approve with required changes** (must fix before merge).
- **Only Medium/Low → 🟢 Approve** (nits optional).
State the rule that produced the verdict so it's auditable.

---

## Rules

- **Run all three lanes.** Report which ran and which were skipped; never fake coverage.
- **Every finding is actionable** — each row has a concrete "fix by doing X".
- **Never echo secret values**, even when the finding *is* a leaked secret — report type + location only.
- **Provenance matters** (fintech/audit): include base branch, commit range, and file counts in every report.
- **No auto-fix, no commits.** Review only.
