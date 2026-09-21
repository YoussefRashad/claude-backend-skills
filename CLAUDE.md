# claude-backend-skills

## Overview

Distribution repo for five backend-engineering Claude Code skills. Two are opinionated and
NestJS-specific (`backend-standards`, `toolchain-config`); three are framework-agnostic
(`project-setup`, `pr-review`, `audit` — single `SKILL.md` files, no version stamp).
**It ships no runtime code.** Everything under `*/templates/` and `*/references/` is
payload copied into _other_ repositories.

See @.ai/context/project-tree.md for the map, @.ai/context/glossary.md for terminology.

## Stack

Markdown + TypeScript/JS **templates that are never compiled here**. Tooling: Prettier
3.x and Node (see `package.json`). No framework, database, cache, queue, auth or server —
if you are looking for `src/`, there isn't one.

## Architecture Decisions

Do NOT suggest replacing decided technologies or re-litigating settled questions. Six
decisions are recorded with evidence in @.ai/decisions/ — including why this is two
skills rather than one, why propagation is pull-based, and why the templates are real
source files rather than prose.

The dependency pins in `toolchain-config/templates/package-fragments.md` are
**deliberately held** behind current majors. Do not "helpfully" bump them.

## Authoring Rules

See @.ai/context/code-patterns.md for how a `SKILL.md`, a reference document and a
source template are each written. In short:

- RFC 2119 keywords are load-bearing. **MUST** and **SHOULD** are not interchangeable,
  and prose without a keyword is explanation, not a rule.
- Every rule states the failure it prevents. A rule nobody can motivate gets ignored.
- Source templates are real, compiling files — never pseudocode.

See @.ai/context/development-rules.md for what a change to this repo must carry.

## Critical Areas — read before touching

See @.ai/context/critical-modules.md. Highest-stakes: `references/02` (the security
floor and the logging posture), `templates/src/common/money.util.ts`, and
`templates/src/common/sortable.ts`.

## Security — CRITICAL

- The repo contains **no secrets**, and nothing here should ever introduce one.
- `references/02-security-and-compliance.md` is **internal**: it documents that OTPs,
  tokens, national IDs and card tokens are logged in full, and the four conditions that
  decision depends on. Read "Before sharing externally" in `README.md` before any
  of it is shared.
- A change that would break one of those four conditions is a change to an owner-level
  decision — stop and raise it, do not ship it.
- Never weaken a **MUST** in `02`. A project document may tighten it, never relax it.

## Versioning — the one rule that is easy to forget

Any change under `*/templates/` or `*/references/` **MUST** bump that skill's
`templates/version.json`. Propagation is pull-based: the stamp is the only way anyone
can tell a stale project from a current one. CI fails the PR if you forget.

Major = a re-syncing project must change code. Minor = additive. Patch = wording.

## Commands

```bash
npm run check          # format:check + version stamps — run before pushing
npm run format         # prettier --write .
npm run format:check   # prettier --check .
npm run check:versions # version stamp guard (CI also runs it with BASE_REF)
```

See @.ai/context/working-notes.md — template changes cannot be verified in this repo.

## Known gaps

@TODO.md — includes the Nest 12 incompatibility, which blocks scaffolding on the
current Nest CLI.
