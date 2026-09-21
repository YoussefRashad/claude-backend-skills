# ADR-005: Strip unknown request fields silently

## Status

Accepted. Owner-signed: **Youssef Farag, 2026-09-20**.

## Context

`class-validator`'s `forbidNonWhitelisted` decides what happens when a client sends a
field the DTO does not declare: reject the request with a 400, or strip the field and
carry on. Rejecting catches contract drift early. Stripping keeps older backends working
against newer clients.

The deciding factor is the client population: a backend serving released mobile apps
cannot assume its clients update, and old versions stay in the field indefinitely.

## Decision

`forbidNonWhitelisted` is **off** globally. Unknown fields are stripped silently.

Where an endpoint's contract matters enough to fail loudly, turn it on **for that route**
rather than globally.

## Alternatives Considered

| Option                 | Pros                                                                                                                   | Cons                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Off, globally (chosen) | A newer app sending an extra field keeps working; removing a DTO field does not start 400-ing clients still sending it | A field the client sends and the backend never reads fails **silently**                                     |
| On, globally           | Contract drift surfaces immediately                                                                                    | A released app version sending one extra field breaks entirely against an older backend                     |
| On, per-route          | Precision where it matters                                                                                             | Only works if someone remembers to opt in — which is why it is the documented escape hatch, not the default |

## Consequences

- **The cost is stated so it is not rediscovered later:** contract drift between mobile
  and backend stays invisible until someone asks why a value is not being saved.
- This is consistent with `01` §13, which makes backward compatibility override every
  other rule for endpoints already live.
- The setting appears in two places and they must agree: the rule in `01` §5 and the
  `ValidationPipe` in `main.ts`. Both carry the decision and its cost inline.
- `03-project-architecture.md` §5 asks each project to record its actual value and any
  per-route exceptions.

## Evidence

- `backend-standards/references/01-engineering-standards.md` §5 — the signed decision
  block, including the explicitly stated cost.
- `backend-standards/templates/src/main.ts` — the `ValidationPipe` comment restating the
  decision and the per-route escape hatch.
- `backend-standards/SKILL.md` § Defaults — "`forbidNonWhitelisted` — **Off.** Unknown
  fields stripped silently."
