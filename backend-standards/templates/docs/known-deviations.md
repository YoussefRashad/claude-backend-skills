# known-deviations — TEMPLATE

> **Copy to `.ai/standards/known-deviations.md` in the project.**
>
> This file records where the project **intentionally** differs from `01` and `02`.
> It sits **above** those documents in the precedence order (`00` §2) — an entry here is
> binding, and an agent that reads it will stop trying to "fix" the thing it describes.
>
> That power is exactly why this file needs discipline. Without an owner and a review date
> it becomes a permanent excuse list, and the standard quietly stops applying.

---

## Rules for this file

1. Every entry **MUST** have an owner and a review date. No exceptions.
2. An entry **MUST** state the _actual_ behaviour, not a euphemism for it.
3. An entry **MUST NOT** relax a rule in `.ai/standards/02-security-and-compliance.md`. Security rules are
   a floor. A genuine security deviation is a **risk acceptance** — it belongs in §3 below,
   signed by someone who can accept it, not filed as a convention.
4. An entry that has passed its review date without action **MUST** be raised, not renewed by
   default.
5. When a deviation is resolved, **delete the entry.** A resolved-items list becomes noise.

---

## 1. Accepted deviations

Things that differ from the standard and are staying that way, at least for now.

### D-001 — `<short title>`

|                          |                                               |
| ------------------------ | --------------------------------------------- |
| **Standard rule**        | `<document §section — quote it>`              |
| **Actual behaviour**     | `<what the code really does, with path:line>` |
| **Reason**               | `<why — the real reason>`                     |
| **Risk accepted**        | `<what could go wrong because of this>`       |
| **Compensating control** | `<what limits the risk, or "none">`           |
| **Owner**                | `<name>`                                      |
| **Review date**          | `<YYYY-MM-DD>`                                |
| **Convergence planned**  | `<yes + when / no + why not>`                 |

---

<details>
<summary><strong>Worked example — what a real entry looks like</strong></summary>

### D-001 — Error responses return HTTP 200 with an error body

|                          |                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standard rule**        | `.ai/standards/01-engineering-standards.md` §4: _"MUST NOT return 200 OK with an error payload in new code."_                                     |
| **Actual behaviour**     | The bad-request and not-found filters return **HTTP 200** unless the thrown payload carries `throw: true`. The body still says `statusCode: 400`. |
| **Reason**               | Released mobile clients branch on the body's `statusCode`, not the HTTP status line. Changing the status line breaks every version in the field.  |
| **Risk accepted**        | Monitoring that keys on HTTP status under-counts errors. New developers and agents are surprised by it.                                           |
| **Compensating control** | New endpoints set `throw: true` and return real status codes.                                                                                     |
| **Owner**                | `<name>`                                                                                                                                          |
| **Review date**          | `<date>`                                                                                                                                          |
| **Convergence planned**  | Only behind a client version gate, once field telemetry shows the old versions are gone.                                                          |

**Agent instruction:** do **not** change this behaviour on an existing endpoint. Set
`throw: true` on anything new.

</details>

---

## 2. Temporary deviations

Things that are wrong, acknowledged, and being fixed. Each **MUST** have a ticket.

| ID    | Deviation | Rule      | Ticket     | Owner    | Target date |
| ----- | --------- | --------- | ---------- | -------- | ----------- |
| T-001 | `<…>`     | `<doc §>` | `<ticket>` | `<name>` | `<date>`    |

---

## 3. Risk acceptances (security)

**Only for deviations from `.ai/standards/02-security-and-compliance.md`.** These require a named accepter
with the authority to accept the risk, and an expiry date. An expired acceptance is not an
acceptance.

| ID    | Rule deviated from | Actual behaviour | Risk  | Compensating control | Accepted by     | Expires  |
| ----- | ------------------ | ---------------- | ----- | -------------------- | --------------- | -------- |
| R-001 | `<02 §…>`          | `<…>`            | `<…>` | `<…>`                | `<name + role>` | `<date>` |

> An agent encountering a security deviation **without** an entry here **MUST** report it
> rather than assume it is intentional.

---

## 4. Documentation drift log

Where `.ai/standards/03-project-architecture.md` or other project docs were found to be wrong. Record it
here when found, fix the doc, then delete the row.

Drift is not a footnote — a document that is trusted and wrong is more dangerous than one
that is missing, because nobody verifies it.

| Found    | Document | Claimed   | Actually    | Fixed           |
| -------- | -------- | --------- | ----------- | --------------- |
| `<date>` | `<doc>`  | `<claim>` | `<reality>` | `<date / open>` |

---

## Review log

| Date     | Reviewer | Entries reviewed | Outcome                            |
| -------- | -------- | ---------------- | ---------------------------------- |
| `<date>` | `<name>` | `<ids>`          | `<renewed / resolved / escalated>` |
