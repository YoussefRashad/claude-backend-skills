# 03 — Project Architecture — TEMPLATE

> **Copy this file to `.ai/standards/03-project-architecture.md` in the project and fill it in.**
> Every `<…>` is a blank you must complete. `01` and `02` reference this document by name —
> an unfilled blank is a rule that cannot be followed.
>
> **This document describes what the project ACTUALLY IS**, not what it should be. Aspirations
> go in a ticket. Intentional differences from the standard go in `.ai/standards/known-deviations.md`.
>
> **Maintenance rule:** when a change makes a statement here false, updating this file is part
> of that change — not a follow-up. Documentation that drifts is worse than none, because it
> is trusted.

---

## 1. Identity

|                            |                                          |
| -------------------------- | ---------------------------------------- |
| Service name               | `<name>`                                 |
| Purpose                    | `<one sentence>`                         |
| Owner                      | `<team / person>`                        |
| Repository                 | `<url>`                                  |
| Sensitivity                | `<e.g. fintech-grade: money, PII, auth>` |
| Last verified against code | `<date>` by `<who>`                      |

---

## 2. Stack — actual versions

Read from the lockfile, not from memory.

| Layer          | Technology              | Version                                  |
| -------------- | ----------------------- | ---------------------------------------- |
| Runtime        | Node.js                 | `<version + engines field?>`             |
| Language       | TypeScript              | `<version>`                              |
| Framework      | `<framework>`           | `<version>`                              |
| ORM            | `<orm>`                 | `<version>`                              |
| Database       | PostgreSQL              | `<version>`                              |
| Cache / locks  | `<client>`              | `<version>`                              |
| Queue          | `<queue>`               | `<version>`                              |
| Auth           | `<mechanism>`           | `<version>`                              |
| Validation     | `<library>`             | `<version>`                              |
| i18n           | `<library>`             | `<version>` · fallback locale `<locale>` |
| Object storage | `<sdk + major version>` | `<version>`                              |

**Internal packages performing a security function** (`02` §11):

| Package | Version            | Security function                       | Behaviour verified on |
| ------- | ------------------ | --------------------------------------- | --------------------- |
| `<pkg>` | `<pinned version>` | `<e.g. request signing, log redaction>` | `<date>`              |

---

## 3. Configuration

- Mechanism: `<class name and file path>`
- Loading: `<file mode / injected / both — and how the choice is made>`
- Validation: `<library; what happens on a missing required variable>`
- Access pattern in code: `<the exact call shape>`
- Values read outside the validated layer (`02` §8 — these escape validation):
  `<list, or "none">`
- Environment file location: `<path>` — **never read or printed**

---

## 4. Module layout

```
<paste the actual tree>
```

| Question                                                     | Answer                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| Canonical repository pattern (`01` §1)                       | `<describe; note others present>`                            |
| Entity base class — what it **actually** provides            | `<exact fields; state explicitly whether it provides an id>` |
| Primary key convention                                       | `<type, naming, exceptions>`                                 |
| Table naming (`01` §2 — no house convention; match the area) | `<what each area uses>`                                      |
| Entity file location                                         | `<path pattern>`                                             |
| DTO folder convention                                        | `<dto/ or dtos/; response location>`                         |

---

## 5. API surface

| Question                                                 | Answer                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| Global route prefix                                      | `<prefix, or "none">`                                         |
| **Versioning strategy** (`01` §3)                        | `<URL prefix / client-version header / other>`                |
| Version gate mechanism                                   | `<decorator or guard, and the header it reads>`               |
| Success envelope (`01` §4 — all-or-nothing per service)  | `<the shape, or "none — this service does not use one">`      |
| Error contract                                           | `<number of filters; the shapes they emit>`                   |
| Does any endpoint return HTTP 200 with an error body?    | `<yes/no — if yes, this MUST also be in known-deviations.md>` |
| Pagination request contract (`01` §3)                    | `<fields, defaults, **maximum**>`                             |
| Pagination response shape                                | `<shape>`                                                     |
| Sort allowlist mechanism (`01` §3)                       | `<where enforced — DTO, query layer, or both>`                |
| `forbidNonWhitelisted` (`01` §5 — house default **off**) | `<on/off; any per-route exceptions>`                          |
| Request body size limit                                  | `<value; explicit or framework default>`                      |

### Required request headers

| Header     | Required?              | Purpose     |
| ---------- | ---------------------- | ----------- |
| `<header>` | `<always / per route>` | `<purpose>` |

---

## 6. Authentication and authorization

| Question                         | Answer                                            |
| -------------------------------- | ------------------------------------------------- |
| Authentication layers            | `<e.g. request signature + per-route user token>` |
| Are routes public by default?    | `<yes/no — if yes, say so loudly>`                |
| Identity source in code          | `<the exact decorator/accessor>`                  |
| How to load the full user record | `<mechanism>`                                     |

### Token secrets (`02` §4) — names only, never values

| Purpose     | Secret variable | Expiry variable | Actual lifetime | Algorithm allowlist set? |
| ----------- | --------------- | --------------- | --------------- | ------------------------ |
| `<purpose>` | `<VAR_NAME>`    | `<VAR_NAME>`    | `<value>`       | `<yes/no>`               |

### Routes exempt from request-signature verification (`02` §4)

| Route     | Reason                 | Compensating control                 |
| --------- | ---------------------- | ------------------------------------ |
| `<route>` | `<why it cannot sign>` | `<e.g. provider HMAC, IP allowlist>` |

### Routes that act on a subject other than the caller (`02` §5)

| Route     | Guard     | Why        |
| --------- | --------- | ---------- |
| `<route>` | `<guard>` | `<reason>` |

---

## 7. Database

| Question                                         | Answer                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Topologies                                       | `<names and how selected>`                                          |
| Read/write split                                 | `<yes/no; default read target>`                                     |
| **How to force a read to the primary** (`01` §7) | `<the exact mechanism — if none exists, say so, it is a known gap>` |
| Statement timeout                                | `<value per topology>`                                              |
| Lock timeout                                     | `<value>`                                                           |
| Idle-in-transaction timeout                      | `<value>`                                                           |
| Pool size                                        | `<min/max per topology>`                                            |
| Do all topologies share these settings?          | `<yes/no — differences are a deployment risk>`                      |
| Canonical transaction mechanism (`01` §7)        | `<name + path>`                                                     |
| Isolation level policy                           | `<default; where a stricter level is used>`                         |

### Schema changes

| Question                        | Answer                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Migration runner                | `<name, or "none — DDL is manual">`                                            |
| `synchronize` / `migrationsRun` | `<values; hard-coded or env-driven>`                                           |
| How DDL is actually applied     | `<the real process, including who reviews it>`                                 |
| Where applied DDL is recorded   | `<location, or "nowhere">`                                                     |
| Rollout model                   | `<e.g. rolling update, N instances — determines the compatibility constraint>` |

### Money (`01` §6)

| Question                          | Answer                                                |
| --------------------------------- | ----------------------------------------------------- |
| Storage type                      | `<numeric(p,s) / decimal(p,s)>`                       |
| Entity property type              | `<string / number + transformer>`                     |
| Money utility (`01` §6)           | `<path>`                                              |
| Normalizes after every operation? | `<yes/no>`                                            |
| How lists of amounts are summed   | `<per-step rounding / integer minor units / neither>` |
| Minor units per provider          | `<provider → unit>`                                   |

---

## 8. Cache, locks and queues

| Question                                          | Answer                                       |
| ------------------------------------------------- | -------------------------------------------- |
| Cache/lock store                                  | `<technology, single instance or cluster>`   |
| Shared across environments?                       | `<yes/no>`                                   |
| Key prefix / logical DB per environment (`01` §8) | `<mechanism, or "none — keys collide">`      |
| Key naming convention                             | `<pattern; where keys are declared>`         |
| Lock release mechanism                            | `<Lua compare-and-delete / bare delete>`     |
| Lock behaviour when store is unavailable          | `<fail closed / skipped>`                    |
| Queues                                            | `<names + whether each has a live consumer>` |
| Queue drain on shutdown (`01` §12)                | `<implemented / not>`                        |

---

## 9. Outbound integrations

| System     | Client    | Timeout           | Retries    | Idempotency key | Auth          | Notes                     |
| ---------- | --------- | ----------------- | ---------- | --------------- | ------------- | ------------------------- |
| `<system>` | `<class>` | `<value or NONE>` | `<policy>` | `<yes/no>`      | `<mechanism>` | `<e.g. system of record>` |

**Webhook endpoints** (`02` §7):

| Route     | Provider     | Signature     | Verified before state change? | Constant-time? | Replay protection     |
| --------- | ------------ | ------------- | ----------------------------- | -------------- | --------------------- |
| `<route>` | `<provider>` | `<algorithm>` | `<yes/no>`                    | `<yes/no>`     | `<mechanism or none>` |

---

## 10. Observability

| Question                                     | Answer                                                            |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Logger                                       | `<library, or "console">`                                         |
| Correlation ID                               | `<how generated/accepted; is a client-supplied value validated?>` |
| Request logging                              | `<what is stored, which table, success and/or failure>`           |
| Outbound logging                             | `<table>`                                                         |
| **Redaction: configured key list** (`02` §2) | `<explicit list, or "library defaults">`                          |
| **Are library defaults verified?**           | `<date checked; do they include token/authorization?>`            |
| Payload size cap                             | `<value, or "none">`                                              |
| Metrics                                      | `<what exists; which environments>`                               |
| Alerting                                     | `<channels and conditions>`                                       |
| Known blind spots                            | `<be honest — this is what someone reads at 2 AM>`                |

### Retention (`02` §3)

| Table     | Contains           | Retention                         | Enforced by                              |
| --------- | ------------------ | --------------------------------- | ---------------------------------------- |
| `<table>` | `<payloads / PII>` | `<period, or "NONE — unbounded">` | `<purge job / partition drop / nothing>` |

---

## 11. Health, shutdown, deployment

| Question                                  | Answer                                        |
| ----------------------------------------- | --------------------------------------------- |
| Liveness endpoint                         | `<path; what it checks>`                      |
| Readiness endpoint                        | `<path; what it checks>`                      |
| Dependencies **not** covered by readiness | `<list>`                                      |
| Shutdown hooks enabled                    | `<yes/no>`                                    |
| Shutdown steps actually implemented       | `<list against `01` §12's six>`               |
| Deployment                                | `<mechanism; manual or automated>`            |
| **Rollback procedure** (`01` §18)         | `<the actual steps>`                          |
| Scheduled jobs                            | `<list: schedule, environment gate, locking>` |

---

## 12. CI/CD and tooling

| Gate            | Runs where                    | Blocking?  |
| --------------- | ----------------------------- | ---------- |
| Lint            | `<CI / local hook / nowhere>` | `<yes/no>` |
| Type check      | `<…>`                         | `<…>`      |
| Unit tests      | `<…>`                         | `<…>`      |
| Dependency scan | `<…>`                         | `<…>`      |
| Secret scan     | `<…>`                         | `<…>`      |

| Question                       | Answer                     |
| ------------------------------ | -------------------------- |
| Lockfile committed? (`01` §16) | `<yes/no>`                 |
| Branch naming                  | `<actual prefixes in use>` |
| Long-lived branches            | `<names>`                  |
| Merge strategy                 | `<actual practice>`        |

---

## 13. Local development

```bash
# <the commands that actually work>
```

| Question                      | Answer                                              |
| ----------------------------- | --------------------------------------------------- |
| Required non-committed files  | `<e.g. env/, cert/ — say what, never contents>`     |
| Will a fresh clone boot?      | `<yes/no — and what is needed>`                     |
| Commands that MUST NOT be run | `<e.g. migration commands that would damage state>` |

---

## 14. Domain glossary

| Term     | Meaning                                               |
| -------- | ----------------------------------------------------- |
| `<term>` | `<meaning — especially anything whose name misleads>` |

---

## 15. Landmines

Non-obvious things that have caused, or will cause, an incident. Be specific and be blunt.

| Landmine | Why it bites | What to do instead |
| -------- | ------------ | ------------------ |
| `<…>`    | `<…>`        | `<…>`              |
