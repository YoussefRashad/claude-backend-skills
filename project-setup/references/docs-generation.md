# Generating documentation

All content is derived from code you actually read. Docs are navigation maps, not copies of the codebase:
document conventions and where to look, not every file or method. Skip any file that would be near-empty.

## Root AGENTS.md (template: `assets/templates/AGENTS.md`)

Budget: <=150 lines, well under 32 KiB (Codex stops loading project docs past its byte budget; Claude
recommends <200 lines per file). Contains only what every task needs: overview, critical rules, verified
commands, navigation table, directory-specific index, shared agents. Write paths in backticks, never `@path`
(Codex treats `@` as text; Claude would eagerly expand it through the CLAUDE.md import).

- `{{STACK_WITH_VERSIONS}}`: from the manifest/lockfile only.
- `{{DB_CHANGE_POLICY}}`: what the project actually does (ORM migrations, manual reviewed DDL, mixed). Detect from
  migration folders, scripts, docs, and DDL files. Do not impose "no schema change without a migration" on a
  project that applies DDL manually; describe its policy and its review step instead.
- `{{VERIFIED_COMMANDS}}`: real scripts with one-line purpose. Mark destructive or production-affecting ones
  (`migration:run`, deploy scripts) with "ask before running".

## Directory-specific instructions (pairs)

Use only where there is evidence of local rules (money flows, auth, PII, generated code):
`src/payments/AGENTS.md` + `src/payments/CLAUDE.md` (`@AGENTS.md`). Always create both:

- Codex loads `AGENTS.md` files from the project root down to the directory it was started in.
- Claude, while a root `CLAUDE.md` exists, ignores nested `AGENTS.md` by default but loads a nested `CLAUDE.md`
  when it works on a file in that directory.
- Neither guarantees the file is loaded for every task, so the root `local-instructions` block lists each path
  with an explicit "read before changing files under …" instruction.

Never move the critical rules into nested files only; the root keeps the short version.

## Project-local security tooling (fully managed, always installed)

| File | Source |
|---|---|
| `.ai/security-paths.json` | Copy of the skill's `data/secret-paths.json` (byte-identical; drift = user edit) |
| `.ai/tools/git-safe.mjs` | Copy of `assets/tools/git-safe.mjs`: read-only diff/log/show with secret excludes, no shell |

The shared agents and AGENTS.md depend on both. They are what lets an agent in the project follow the secret
rules without knowing where the skill is installed.

## `.ai/context/`

| File | Content | Source |
|---|---|---|
| `project-tree.md` | Module map, dependencies, flagged dangerous modules | `src/` walk; each module's controller + service only |
| `critical-modules.md` | Money/balance/payment/points/auth/PII modules: invariants, locking, idempotency, review notes | Entities, services, guards; user's sensitive-area answers |
| `code-patterns.md` | How controllers/services/repositories/DTOs/guards are written here | 2–3 real examples of each |
| `error-contract.md` | Error shapes, exception filters, status mapping | Filters, pipes, handlers. If inconsistent: describe, propose one in `TODO.md` |
| `configuration.md` | Variable · required · secret/non-secret · used by · description · source | Config/validation code + `env-keys.mjs keys`; never values |
| `glossary.md` | Domain terms, enum values, abbreviations | Entity/enum/service names |
| `development-rules.md` | Scope discipline, backward compatibility, reuse of patterns | Code style + linter config |

## `.ai/decisions/` (ADRs, template `assets/templates/adr.md`)

Write an ADR only with evidence of an intentional choice: an existing design doc, an explicit code comment, a
commit/PR rationale, or a repeated constraint the code enforces. The `Evidence` line is mandatory. Without
evidence: describe the technology in context docs and add the missing rationale to `TODO.md`. Maintain
`.ai/decisions/README.md` as an index.

## `docs/`

- `api-conventions.md`: versioning, response envelope, pagination/filter/sort, auth headers, rate limits, error
  format. Mermaid `sequenceDiagram` only for a genuinely complex flow (e.g. OTP, payment confirmation).
- `database.md`: ORM, entities and key relationships, the DB change policy as practiced, transaction patterns and
  isolation levels in money/state flows. For PostgreSQL flag (document, never execute) blocking DDL, table
  rewrites, `NOT NULL` without default/backfill, non-`CONCURRENTLY` index builds, rename/drop without a
  compatibility window.
- `observability.md`: what exists (logger, correlation IDs, metrics, health checks, redaction). Gaps → `TODO.md`.
- `integrations/<vendor>.md`: purpose, auth approach (no credentials), endpoints used, timeouts, retry policy,
  **idempotency (never document a retry as safe without confirming it)**, circuit breaking/fallback, logging and
  redaction, quirks from code comments.
- `business-rules/<flow>.md`: only when the domain is clear from code; behaviour that looks like a bug is a
  `TODO.md` item, never a rule.

## `TODO.md` (template `assets/templates/TODO.md`)

Sections: Needs Manual Review · Missing Information · Security Concerns · Inconsistencies · Unverified Controls ·
Cleanup. Every item: file:line where possible, what to confirm, never a secret value.

## Ownership hints

Living docs (`docs/**`, `.ai/context/**`, `.ai/decisions/**`, `TODO.md`) default to `merged`: people and
docs-sync edit them, and they are not drift-tracked. Write an `ownership.json` in the run dir only to override.
