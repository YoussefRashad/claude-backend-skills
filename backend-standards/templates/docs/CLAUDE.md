# {{SERVICE_NAME}}

{{ONE_LINE_PURPOSE}}

**Sensitivity: {{SENSITIVITY}}.** Treat every money, PII and auth path accordingly.

---

## Read first

@.ai/standards/00-ai-agent-instructions.md

That file is short and it is not optional. It carries the MUST/SHOULD/MAY key, the
source-of-truth order, the inspect-before-you-implement rule, and the escalation
path when a rule cannot be satisfied.

## This project's actual architecture

@.ai/standards/03-project-architecture.md

Describes what this service **is**, not what it should be. If a change makes a
statement in there false, updating it is part of that change — not a follow-up.

## Where this project intentionally differs from the standard

@.ai/standards/known-deviations.md

An entry there **outranks** the standard. Do not "fix" something it describes.

## Not preloaded — open on demand

| File                                          | When                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `.ai/standards/01-engineering-standards.md`   | Any code change. Load the relevant section.                                  |
| `.ai/standards/02-security-and-compliance.md` | **In full** for anything touching money, PII, auth, or an external provider. |
| `.ai/standards/04-review-and-dod.md`          | Before opening a PR.                                                         |

---

## Commands

```bash
{{COMMANDS}}
```

These are also the `04` Part A gate commands. Keep this block and
`.ai/standards/03-project-architecture.md` §12 in agreement — a checklist pointing at a
command that does not exist is a gate nobody runs.

## Standards version

Applied from the `backend-standards` skill, version `{{STANDARDS_VERSION}}`.

Re-run the skill to sync this project with a newer standard. Propagation is
pull-based: nothing is pushed to you, so a project silently falls behind until
someone re-runs it.
