---
name: project-setup
description: Set up Claude Code documentation structure, reviewer agent, and docs-sync agent for any backend project. Detects stack automatically and generates tailored files. Treats the codebase as sensitive by default (fintech-grade), enforces a plan-and-confirm gate before writing, and never reads secrets.
---

# Project Setup — Documentation & Agent Scaffolding

Set up the full Claude Code configuration for a backend project: documentation structure, reviewer agent, docs-sync agent, `CLAUDE.md`, and settings — all generated from the **actual code**, never from templates.

## Prerequisites

- Must be run from the root of a git repository.
- The project should have source code to analyze (not an empty repo).

## Critical Rules (read first — these override everything below)

1. **NEVER read secret files.** No `.env`, `.env.*`, `**/.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `**/secrets/**`, `**/credentials/**`, `**/.aws/**`, `**/.ssh/**`. Derive environment variables from `ConfigModule`/`ConfigService`, validation schemas (Joi/Zod/`class-validator`/env parsers), `*.config.ts`, `docker-compose.yml`, or `.env.example` **only**.
2. **NEVER overwrite existing docs.** If `docs/`, `README.md`, `CLAUDE.md`, or any target file exists, READ it first, MERGE additions, and ASK before replacing.
3. **NEVER invent unverifiable information.** If unsure, put it in `TODO.md` — do not guess. Every inferred fact must be labeled as inferred.
4. **Read incrementally.** Do not load the whole codebase. Read only what each phase requires, then move on. Prefer directory listings and targeted reads over bulk file loads.
5. **Treat the codebase as sensitive by default.** Assume fintech/PII/compliance context unless the user says otherwise.

---

## PHASE 0 — Planning (DO THIS FIRST, THEN STOP)

Read **only** these:

- `package.json` (or the language's manifest — see Step 1 table)
- `tsconfig.json` (or equivalent config)
- `README.md` (if exists)
- `docker-compose.yml` (if exists)
- `src/` directory listing — **tree only, do not read file contents yet**
- `app.module.ts` / `main.ts` (or the framework's entrypoint)

Then present this summary and **STOP**:

```
## Project Understanding
- Project name / Framework (version) / Language (version)
- ORM (version) / Database / Cache / Queue / Auth

## Modules Found
- module/ — (inferred responsibility)

## External Integrations Detected
- service (source: package.json dep / import path)

## Assumptions
## Unknowns (need to read more code)

## Execution Plan
I will create N files in this order: ...
```

**HARD STOP. Wait for explicit user confirmation before Phase 1.** Do not create directories or files during Phase 0.

---

## Step 1 — Detect Stack (during Phase 0)

| File | Detects |
|------|---------|
| `package.json` | Node.js: NestJS/Express/Fastify, TypeORM/Prisma/Sequelize, Jest/Vitest, BullMQ/ioredis |
| `tsconfig.json` | TypeScript version, module system, target, path aliases |
| `requirements.txt` / `pyproject.toml` | Python: Django/Flask/FastAPI, SQLAlchemy/Tortoise |
| `go.mod` | Go: Gin/Echo/Fiber, GORM |
| `Gemfile` | Ruby: Rails, ActiveRecord |
| `pom.xml` / `build.gradle` | Java: Spring Boot, Hibernate |
| `docker-compose.yml` | Databases (PostgreSQL, MySQL, Redis, MongoDB), message brokers |
| `.env.example` | Environment variables and services used (read this, never `.env`) |

Also record: package manager (which lockfile actually exists), Node/runtime version (`engines`, `.nvmrc`, `Dockerfile`), and whether a linter/formatter is configured.

---

## Step 2 — Scan Codebase (after approval)

Explore the source directory to map:
- **Modules/packages:** what exists, dependencies between them
- **Entities/models:** tables and relationships (flag anything money/balance/points/PII)
- **Controllers/routes:** endpoints and grouping, API versioning scheme
- **Services:** business logic layer
- **Integrations:** external API clients, HTTP services, retry/timeout config
- **Guards/middleware/interceptors:** auth, validation, rate limiting, logging
- **Config:** how configuration is loaded and validated

---

## PHASE 1 — Directory Structure & Security/Config (after approval)

### 1a — Create directories
```
.claude/agents/
.ai/decisions/
.ai/context/
docs/business-rules/
docs/integrations/
```

### 1b — `.claude/settings.json`
Read `package.json` scripts and build `allow` from **actual** scripts + safe git commands. Use this **explicit, literal** deny list (do not soften it):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(git status)", "Bash(git diff *)", "Bash(git log *)", "Bash(git branch *)"
    ],
    "deny": [
      "Read(.env)", "Read(.env.*)", "Read(**/.env)", "Read(**/.env.*)",
      "Read(**/*.pem)", "Read(**/*.key)", "Read(**/*.p12)", "Read(**/*.pfx)",
      "Read(**/*.crt)", "Read(**/*.cer)", "Read(**/id_rsa*)",
      "Read(**/secrets/**)", "Read(**/credentials/**)",
      "Read(**/.aws/**)", "Read(**/.ssh/**)", "Read(**/.gnupg/**)",
      "Read(**/*.keystore)", "Read(**/*.jks)",
      "Bash(rm -rf *)", "Bash(docker rm *)", "Bash(docker rmi *)",
      "Bash(DROP DATABASE *)", "Bash(DROP TABLE *)", "Bash(TRUNCATE *)",
      "Bash(psql * -c DROP *)", "Bash(curl * | bash)", "Bash(curl * | sh)",
      "Bash(wget * | bash)", "Bash(npm publish *)", "Bash(git push --force *)",
      "Bash(git push -f *)", "Bash(kubectl delete *)", "Bash(terraform destroy *)"
    ]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "Write|Edit", "command": "<lint-fix-cmd> \"$CLAUDE_FILE_PATH\" 2>/dev/null || true" }
    ]
  }
}
```
Only include the hook if a linter is actually installed; substitute the real command (e.g. `npx eslint --fix`, `ruff --fix`, `gofmt -w`). Add actual npm scripts (`dev`, `build`, `test`, `lint`, `migration:*`) to `allow`.

### 1c — `.claudeignore`
Based on what **actually exists** (don't add non-existent entries):
- `node_modules/`, `dist/`, `build/`, `coverage/`, `.turbo/`, `.next/`
- `.env`, `.env.*`
- The one lockfile that exists (`package-lock.json` OR `yarn.lock` OR `pnpm-lock.yaml`)
- `*.pem`, `*.key`, `*.pfx`, `*.p12`, `*.crt`
- IDE folders that exist (`.idea/`, `.vscode/`)
- Logs, snapshots, generated files, migration snapshots

### 1d — `.env.example`
Derive vars from `ConfigModule`/`ConfigService`/validation schema — **not** from `.env`. Group by category (App, Database, Redis, Auth/JWT, External Integrations, Observability), add a one-line description per var, **no real values**. Mark required vs optional. If a var is referenced in code but absent from any schema, list it and note it in `TODO.md`.

### 1e — Update `.gitignore` (append, never replace)
```
# Claude Code personal settings
.claude/settings.local.json
CLAUDE.local.md
```

---

## PHASE 2 — Core Documentation

### 2a — `CLAUDE.md` (**MAX 80 lines** — thin router using `@imports`)
```markdown
# <project-name>

## Overview
One line. See @.ai/context/project-tree.md for module map.
See @.ai/context/glossary.md for terminology. See @.env.example for env vars.

## Stack
<ACTUAL versions from manifest — no guessing>

## Architecture Decisions
Do NOT suggest replacing decided technologies. See @.ai/decisions/ for rationale.

## Coding Rules
<inferred from ACTUAL code patterns — see @.ai/context/code-patterns.md>

## DB Rules
<actual ORM + migration approach>

## Security — CRITICAL
- NEVER log PII  - NEVER expose secrets
- Input validation on every endpoint  - Parameterized queries only

## API Standards
See @docs/api-conventions.md

## Commands
<ACTUAL npm scripts>

## Observability
See @docs/observability.md
```
Keep it a router: detail lives in imported files, not here. If it exceeds 80 lines, move content out.

### 2b — `.ai/context/` files (read from code, not templates)

| File | Content | How to generate |
|------|---------|-----------------|
| `project-tree.md` | Module map, dependencies, **flagged dangerous modules** (money/balance/payments/points/PII) | Walk `src/`, read each module's service + controller (not every file) |
| `glossary.md` | Domain terms, enum values, service names, abbreviations | Extract from entity/enum/service names and comments |
| `code-patterns.md` | How controllers/services/repos/DTOs/factories/guards are structured | Read 2–3 real examples of each and document the convention |
| `error-contract.md` | Error response shapes, exception filters, HTTP status mapping | Read exception filters, global pipes, error handlers. If inconsistent, propose one + note in `TODO.md` |
| `critical-modules.md` | Money/PII/auth modules with extra-scrutiny notes | User's sensitive-areas answer + detected patterns |
| `development-rules.md` | No unrelated changes; no schema change without migration; backward compat; prefer/reuse existing patterns & services | Infer from code style + linter config |

---

## PHASE 3 — Architecture & Integrations

### 3a — ADRs in `.ai/decisions/`
One ADR per major tech choice visible in code, plus a `README.md` index.
```markdown
# ADR-NNN: <decision>
## Status: Accepted
## Context: <why needed>
## Decision: <what was chosen>
## Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
## Consequences: <tradeoffs>
```

### 3b — `docs/observability.md`
Document what **exists**: logging library + patterns, correlation/request IDs, metrics, health checks, log levels, PII redaction. Don't invent what should exist — gaps go to `TODO.md`.

### 3c — `docs/api-conventions.md`
Infer from controllers: URL/versioning patterns, response shapes, pagination, filtering, sorting, auth headers, rate limiting, standardized errors. Add a mermaid `sequenceDiagram` **only** where a complex flow genuinely needs it.

### 3d — `docs/integrations/<vendor>.md` (one per external service)
- What it does · Auth approach (no credentials) · Endpoints used
- Error handling, retry, timeout, idempotency
- Known quirks (from comments/workarounds in code)

### 3e — `docs/business-rules/<flow>.md`
One per major flow **only if the domain is clear enough**. Skip otherwise (log the gap in `TODO.md`). Never invent business rules.

---

## PHASE 4 — Agents & Finalization

### 4a — `.claude/agents/reviewer.md` (tailored to this stack)
```markdown
---
name: reviewer
description: Security- and correctness-focused code reviewer for <project-name>.
tools: Read, Grep, Glob, Bash
model: opus
---
Review dimensions:
1. Security (stack-specific: guards/decorators, authz, JWT, input validation, injection, secret/PII leakage)
2. Performance (N+1, unbounded queries, missing indexes, memory, blocking I/O)
3. Correctness (edge cases, race conditions, idempotency, error handling)
4. ORM/DB (entity conventions, migrations, isolation levels, read/write split)
5. Integration layer (retries, timeouts, circuit breaking)
6. Error handling & API conventions (matches error-contract.md)
7. Maintainability
8. <Domain section — money/credit/PII modules> when touched
```

### 4b — `.claude/agents/docs-sync.md`
```markdown
---
name: docs-sync
description: Post-merge documentation sync for <project-name>.
tools: Read, Grep, Glob, Bash, Edit, Write
model: opus
---
On merge: check git diff, update every affected doc from the table below.
<Table of the docs actually generated>
Rules: read before editing, preserve existing content, never invent, never commit.
```

### 4c — `TODO.md`
Sections: **Needs Manual Review** (inferred-not-confirmed) · **Missing Information** (couldn't infer) · **Security Concerns** (found during scan) · **Inconsistencies** (pattern/naming/config deviations) · **Cleanup** (dead code, stale config, missing tests).

### 4d — Report
Present: (1) table of all files created with **line counts + Created/Merged/Skipped status**, (2) security concerns found, (3) codebase inconsistencies, (4) what needs manual review (→ `TODO.md`), (5) next steps (e.g. "review TODO.md", "run /audit for a full-codebase safety net").

---

## Rules

- **Never hard-code** project content into this skill — always detect from the codebase.
- **Never read** secret files during setup (see Critical Rule 1).
- **Plan-and-confirm gate is mandatory** — do not write anything before Phase 0 approval.
- **Ask before overwriting** any existing file; default to merge.
- **Label every inference** and route uncertainty to `TODO.md`.
- **Match existing style** — if docs already exist, match their tone/format.
- **Minimize** — skip files that would be empty/near-empty; skip `business-rules/` if the domain isn't clear.
- **`CLAUDE.md` ≤ 80 lines** — it's a router, not a manual.
