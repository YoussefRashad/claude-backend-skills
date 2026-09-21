# Glossary

Terms used across the two NestJS-specific skills (`backend-standards`, `toolchain-config`),
including the ones whose names mislead. The three framework-agnostic skills
(`project-setup`, `pr-review`, `audit`) carry their own self-contained vocabulary and are
not covered here.

## The documents, by number

Referred to by number everywhere — `01` §6, `02` §7. Inside a scaffolded project they
live at `.ai/standards/`.

| Number | File                            | What it is                                                  |
| ------ | ------------------------------- | ----------------------------------------------------------- |
| `00`   | `00-ai-agent-instructions.md`   | Read-first. RFC 2119 key, precedence, escalation            |
| `01`   | `01-engineering-standards.md`   | Portable engineering standards, 19 sections                 |
| `02`   | `02-security-and-compliance.md` | The security **floor**                                      |
| `03`   | `03-project-architecture.md`    | What a project **actually is**. Per-project, filled by hand |
| `04`   | `04-review-and-dod.md`          | Review checklist and definition of done                     |

There is deliberately no `03` in `references/` — it is a per-project document, so its
template lives in `templates/docs/`.

## Normative keywords (RFC 2119)

| Term                    | Meaning here                                                          |
| ----------------------- | --------------------------------------------------------------------- |
| **MUST / MUST NOT**     | Absolute. No exception without an entry in `known-deviations.md`      |
| **SHOULD / SHOULD NOT** | Strong default. Deviating is allowed but must be stated with a reason |
| **MAY**                 | Genuinely optional                                                    |

Prose without one of these is **explanation, not a rule**. Do not enforce it as one.

## Data classification (`02` §1)

| Class | Examples                                                            | Logging                                    |
| ----- | ------------------------------------------------------------------- | ------------------------------------------ |
| **A** | PIN, password, PAN, CVV, card token, private key                    | **Never**, in any environment              |
| **B** | OTP, access/refresh token, `Authorization`, API key, signing secret | In full, **inside the audited store only** |
| **C** | National ID, phone, name, DOB, address, IBAN, device ID             | In full, **inside the audited store only** |
| **D** | Correlation ID, user ID, order ID, path, status, duration           | Unrestricted — prefer these for tracing    |

**The four conditions** — the Class B/C decision depends on all four staying true: no API
exposes the log store, access is restricted, retention is 90 days and mechanical, and logs
never reach a lower-trust environment. Breaking one is a change to the decision, not a
feature.

## Repo-specific terms

| Term                       | Meaning                                                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pull-based propagation** | Nothing is pushed to a project. It falls behind silently until someone re-runs the skill. See `ADR-002`                                                                    |
| **The stamp**              | `templates/version.json` here; `.backend-standards.json` / `.toolchain-config.json` in a target repo. The only way to spot a stale project                                 |
| **The ratchet**            | Shipping a rule at `warn` so an untyped project still builds, then tightening per-folder as modules are cleaned. Applies to `no-unsafe-*`, **not** to rules backing a MUST |
| **The fleet**              | The set of backend services. Table in `backend-standards/SKILL.md`; step 2 compares dependency majors against it                                                           |
| **Vendored**               | `.ai/standards/` and `.claude/agents/` inside a target repo: formatted at source, re-synced, and prettier-ignored so a sync produces no spurious diff                      |
| **Diff-and-ask**           | `toolchain-config`'s workflow — show a diff, get per-file approval, never overwrite silently                                                                               |
| **Known deviation**        | A recorded, owned, dated place a project intentionally differs. **Outranks** `01`/`02`. Never used for a security relaxation — that is a risk acceptance                   |
| **Risk acceptance**        | A deviation from `02`, signed by someone who can accept it, with an expiry                                                                                                 |
| **The envelope**           | The `{ message, statusCode, data, timestamp }` success shape. All-or-nothing per service                                                                                   |
| **Part A / Part B**        | `04`'s split: machine-checkable gates vs human judgment. An agent may assert Part A only                                                                                   |

## Things whose names mislead

| Name                               | The trap                                                                                                                          |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ApiEnvelope`                      | Named to avoid colliding with `@nestjs/swagger`'s `ApiResponse` **decorator**. Do not "fix" it back                               |
| `tsconfig.eslint.json`             | Not just for ESLint — it is also the `typecheck` target, because `tsconfig.json` excludes specs                                   |
| `reviewer.md` / `docs-sync.md`     | Under `templates/agents/` these are for a **scaffolded service**. This repo's own agents are `skill-reviewer` / `skill-docs-sync` |
| "the templates were validated"     | Always ask _against which Nest major_. 2.0.0 is verified on Nest 11 and **not supported on Nest 12**                              |
| `security-scan.mjs` "Docker check" | Checks the daemon, not just the CLI — `docker --version` succeeds with the daemon stopped                                         |

<!-- Generated by project-setup · Source: 560e0d8 + uncommitted 2.0.0 changes -->
