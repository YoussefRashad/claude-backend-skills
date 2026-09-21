# backend-standards — installation

A Claude Code skill that scaffolds a backend service already following the team's
engineering standards, and leaves behind a repo that keeps following them.

---

## Install

Both skills go in the **same** directory. Copy the folders:

```
~/.claude/skills/backend-standards/     ← this folder
~/.claude/skills/toolchain-config/        ← required, ships separately
```

On Windows that is `C:\Users\<you>\.claude\skills\`.

Restart Claude Code, or start a new session. Verify with:

```
/backend-standards
```

If it does not appear, check that `SKILL.md` sits directly inside the skill folder —
not one level deeper.

## Both skills are required

`backend-standards` deliberately does **not** ship ESLint, Prettier, tsconfig, Husky or
lint-staged. Those belong to `toolchain-config`, and two skills shipping the same eslint
config is exactly how the two copies drift apart.

Install only `backend-standards` and you get the architecture, the source templates and
the standards — but no lint, formatting, compiler settings or git hooks. The skill will say
so rather than quietly hand-rolling substitutes.

## `project-setup` — related, but optional

`project-setup` is a separate general-purpose skill in this repo. It is optional and only
useful on existing projects, where it reverse-engineers documentation from code that
already exists. Nothing here depends on it.

---

## What you get

```
backend-standards/
├── SKILL.md                 The procedure
├── references/              The standards — copied into every project created
│   ├── 00-ai-agent-instructions.md
│   ├── 01-engineering-standards.md
│   ├── 02-security-and-compliance.md
│   └── 04-review-and-dod.md
└── templates/
    ├── version.json         Standards version, stamped into each project
    ├── docs/                CLAUDE.md · 03-project-architecture · known-deviations
    ├── agents/              reviewer · docs-sync
    ├── ci/                  GitHub Actions workflow — the 04 Part A gates
    └── src/                 Real source files, not descriptions
```

The `src/` templates exist because a description of `AbstractEntity` drifts from the real
`AbstractEntity`, and a file does not. Each one enforces a specific rule:

| File                               | What it prevents                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `money.util.ts` + `.spec.ts`       | Float drift when amounts accumulate. Exact, zero dependencies, with the tests that prove it |
| `correlation-id.middleware.ts`     | An untrusted trace header written into a log column; an ID the logger cannot reach          |
| `rate-limit.ts`                    | A service that ships violating the security floor from its first commit                     |
| `response-envelope.interceptor.ts` | A `POST` returning HTTP 201 with `"statusCode": 200` in the body                            |
| `redis-lock.service.ts`            | Releasing a lock you no longer own, and running unguarded when Redis is down                |
| `webhook-signature.util.ts`        | Mutating state before verifying a provider signature                                        |
| `sortable.ts`                      | SQL injection through a sort parameter, including via the prototype chain                   |
| `base.axios.ts`                    | An HTTP client with no timeout — it throws at construction instead                          |
| `pagination.dto.ts`                | An uncapped page size                                                                       |
| `all-exceptions.filter.ts`         | Five error shapes instead of one                                                            |
| `abstract.entity.ts`               | An entity with no primary key                                                               |

---

## Usage

### New service

> create a new backend service for <X>

The skill asks what it cannot guess — name, sensitivity, versioning strategy, whether
clients include a released mobile app, which external systems it calls. Answer those and it
scaffolds the rest.

### Existing service

> apply our backend standards to this repo

Different job, and more cautious: it documents what the project **actually is** into
`03-project-architecture.md`, records intentional differences in `known-deviations.md`,
and installs the two agents. It does **not** rewrite working code — a mismatch between the
standard and a working codebase is information to report, not a defect to fix.

---

## Keeping projects in sync

Propagation is **pull-based**. Nothing is pushed to a project, so one silently falls behind
until someone re-runs the skill on it.

Each project carries the standards version it was created with, in two places:
`CLAUDE.md` for a human reader, and `.backend-standards.json` for the fleet sweep.
Compare either against `templates/version.json` to find projects that are behind.

---

## The two agents

Copied into `.claude/agents/` of each project. Both are invoked manually — nothing wires
them to a merge.

- **`reviewer`** — pre-merge review against the standards, in priority order: backward
  compatibility first, then security, then money and data.
- **`docs-sync`** — keeps `03-project-architecture.md` honest as the code changes.

`docs-sync` is the one that gets skipped, and it is the one that decides whether the
architecture document is worth reading in a year. Documentation that is trusted and wrong
is more dangerous than documentation that is missing.
