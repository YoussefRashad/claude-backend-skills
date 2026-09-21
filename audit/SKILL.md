---
name: audit
description: Full-codebase safety-net audit for any backend project — the last line of defense that catches what per-PR /pr-review missed or what nobody reviewed. Framework-aware. Security-first by default; --full adds quality, performance, DB, tests, dependency/CVE, and observability lanes. Writes a persistent, trackable report the team can work through.
---

# Audit — Full-Codebase Safety Net

Audit the **entire codebase** (not a diff). This is the backstop: if `/pr-review` skipped a PR, or code merged without review, this scan catches it. Framework-aware, severity-ranked, and — critically — it **persists findings to a file** so you and the team can work through them.

## Modes

- **Default (`security-first`):** run only the Security lane (Checks S1–S12). Fast, low-noise, safe to run often.
- **`--full`:** run **all** lanes — Security + Quality + Performance/DB + Tests + Dependencies/CVE + Observability. This is the true safety net.
- Optional targeting: `--path <dir>` to scope to a subtree; `--since <git-ref>` to scan only files changed since a ref (catch-up mode for "what merged unreviewed").

## Critical Rules (read first)

1. **Never read secret files:** `.env`, `.env.*`, `**/.env*`, `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `**/id_rsa*`, `**/secrets/**`, `**/credentials/**`, `**/.aws/**`, `**/.ssh/**`, `**/.gnupg/**`. If a secret is found **in tracked source**, report type + `file:line` only — never echo the value (it's a Critical finding).
2. **Exclude from scan:** `node_modules/`, `dist/`, `build/`, `coverage/`, `vendor/`, `__pycache__/`, `.next/`, generated files, lockfiles (except for the dependency lane).
3. **Respect accepted risks.** Read `TODO.md` and `.ai/decisions/` first; drop findings that match a documented accepted risk (note how many were suppressed).
4. **No false positives over missed findings** — if unsure, list under "Needs Manual Review", don't inflate to Critical.
5. **Read incrementally** on large codebases — grep/scan first to locate, then open only the hits.
6. **No auto-fix, no commits.** Report only.

---

## Step 1 — Detect Stack & Scope

Read `package.json` (or `Gemfile`, `go.mod`, `requirements.txt`, `pom.xml`, `build.gradle`) to identify language, framework, ORM, auth, cache, queue. Note file count and which lanes apply. Record base facts for the report header (project, stack, files scanned, mode, timestamp).

---

## Step 2 — Security Lane (always runs)

Combine grep-based checks with real scanners where installed.

**Automated (if present):** `gitleaks`/`trufflehog` (secrets), `semgrep --config p/security-audit p/owasp-top-ten`, language security linter (`eslint-plugin-security`/`gosec`). Note any tool that's missing.

**Manual checks (framework-aware):**

| ID  | Check                                 | Sev  | What to grep / verify                                                                                                                                                                                |
| --- | ------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | PII logging                           | Crit | `console.*`/`logger.*` lines containing `nationalId`, `national_id`, `phone`, `mobile`, `otp`, `password`, `token`, `authorization`, `ssn`, `credit.?card`, `req.body`, `req.headers`. Exclude tests |
| S2  | Hard-coded secrets                    | Crit | `(password\|secret\|apiKey\|api_key\|token\|credential\|private.?key)\s*[:=]\s*['"][^'"]{8,}['"]`. Exclude `*.config.*`, `.env.example`, `*.d.ts`, tests, placeholders (`changeme`, `your-*`)        |
| S3  | SQL/NoSQL injection                   | Crit | `.query(`/`.execute(` with template literals or concat; TypeORM raw `.query()`; Prisma `$queryRawUnsafe`; Sequelize `sequelize.query()` concat                                                       |
| S4  | Missing input validation              | High | NestJS: `@Body/@Query/@Param` without DTO type + global `ValidationPipe`; Express: `req.body/query/params` without validator                                                                         |
| S5  | Unguarded routes                      | High | NestJS: controller methods without `@UseGuards` (or explicit `@Public()`/`@SkipGuard()` bypassing a global guard); Express: routes without auth middleware                                           |
| S6  | Missing rate limiting                 | High | Sensitive endpoints (login/auth/otp/token/reset/signup) without `@Throttle`/`ThrottlerGuard`/`express-rate-limit`                                                                                    |
| S7  | Broken auth logic                     | High | JWT verify present; token expiry/rotation; **`deletedAt`/`account_status` checks on refresh**; IDOR/ownership checks on `:id` routes                                                                 |
| S8  | Secrets in `.env.example`             | High | Real-looking values (long random/base64/URLs w/ creds) instead of placeholders                                                                                                                       |
| S9  | Exposed error details                 | Med  | `throw new *Exception(error)`/`(err)` — raw error/stack reaching client (vs `error.message`)                                                                                                         |
| S10 | Missing request timeouts              | Med  | axios/fetch/http clients without timeout → hung-connection risk                                                                                                                                      |
| S11 | Weak crypto                           | High | MD5/SHA1 for security, ECB mode, hardcoded IV, missing HMAC, nonce reuse, `Math.random()` for tokens                                                                                                 |
| S12 | SSRF / path traversal / open redirect | High | User input flowing into outbound URLs, `fs` paths, or redirects without allowlist/sanitization                                                                                                       |

---

## Step 3 — Extended Lanes (only with `--full`)

### Lane Q — Quality & Maintainability

- Duplicated logic / copy-paste blocks across modules
- Dead code, unused exports, unreachable branches
- Oversized functions/classes, deep nesting, God services
- SOLID violations, leaky abstractions, inconsistent patterns between modules
- Naming clarity, magic numbers, missing types (`any` in TS)

### Lane P — Performance & Database

- N+1 queries (loops issuing queries; missing `relations`/`join`/`select`)
- Unbounded queries (no `LIMIT`/pagination), unindexed hot columns (cross-ref entities vs migrations)
- Blocking I/O on request path, sync crypto/hashing on main thread
- Missing caching where obvious; **cache stampede** risk (no lock/jitter on hot keys)
- Redis: missing TTL, unbounded keys, `KEYS` in prod paths, non-atomic read-modify-write on counters/balances
- Transaction scope too wide/narrow; wrong isolation level for money/state ops

### Lane T — Tests

- Modules/services with **zero** test files
- New/critical paths (auth, money, points) lacking coverage
- Tests present but assertion-light or skipped (`.skip`, `xit`)
- Note overall coverage if a coverage report/config exists (don't run tests unless asked)

### Lane D — Dependencies & CVE

- `npm audit --json` / `pnpm audit` / `pip-audit` / `govulncheck` / `osv-scanner`
- Surface Critical/High CVEs; flag abandoned/outdated **direct** deps
- Flag deps pinned to `*`/`latest`, or duplicate/conflicting versions

### Lane O — Observability

- Endpoints/flows with no logging or no correlation/request ID
- Missing health checks, missing error tracking on critical paths
- Silent catches (`catch {}` swallowing errors), `console.log` left in prod code
- No metrics on money/auth flows

---

## Step 4 — Triage

1. Suppress findings matching accepted risks in `TODO.md`/`.ai/decisions/` (report count suppressed).
2. Mark scanner hits `Confirmed` / `Likely` / `Possible FP`; drop clear noise with a one-line reason.
3. Assign severity by rubric (Critical = exploitable/integrity-loss now; High = serious-conditional; Medium = bounded; Low = nit).
4. Sort Critical → High → Medium → Low.

---

## Step 5 — Output (screen **and** file)

### 5a — Write a persistent report file

Write to `docs/security/scan-report-<YYYY-MM-DD>.md` (create dir if missing; if a report for today exists, append a new timestamped section — never overwrite history). This is the artifact the team works from:

```markdown
# Security & Codebase Audit — <YYYY-MM-DD HH:MM>

Project: <name> | Stack: <framework>+<orm>+<db> | Mode: <security-first|full>
Files scanned: <n> | Lanes: S✓ Q✓ P✓ T✓ D✓ O✓ | Tools missing: <list>
Suppressed (accepted risks): <n>

## Findings

| #   | Status | Severity | Lane | File:Line   | Issue    | Recommended Fix          | Owner | Fixed? |
| --- | ------ | -------- | ---- | ----------- | -------- | ------------------------ | ----- | ------ |
| 1   | Open   | Critical | S1   | src/x.ts:42 | Logs OTP | Mask/remove PII from log |       | ☐      |

## Summary

Critical: N | High: N | Medium: N | Low: N | Files with issues: N/total

## Needs Manual Review

- <items that couldn't be auto-verified>
```

`Status` starts `Open`; `Owner`/`Fixed?` are blank for the team to fill. On re-runs, carry forward unresolved items so progress is trackable.

### 5b — Update `TODO.md`

Append every **Critical & High** finding under a `## Security Scan — <date>` section (dedupe against existing entries), so they surface in normal workflow. Link back to the full report path.

### 5c — Screen summary

Print the counts table, the Critical & High rows, the report file path, and how many findings were suppressed as accepted risks. Keep Medium/Low in the file, not the chat, unless asked.

---

## Rules

- **Default = security-first.** Only `--full` runs Q/P/T/D/O lanes.
- **Always persist** findings to `docs/security/scan-report-<date>.md` and mirror Critical/High into `TODO.md` — findings must be trackable, not ephemeral.
- **Never echo secret values.** Type + location only.
- **Respect accepted risks** from `TODO.md`/`.ai/decisions/`.
- **Every finding is actionable** (file:line + concrete fix) — no vague "improve security".
- **Fail loud** on missing tools; never fake a lane.
- **No auto-fix, no commits.**
