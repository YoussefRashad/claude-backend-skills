# ADR-002: Propagate by pull, and stamp every project

## Status

Accepted.

## Context

The standards and templates live in one repository but are consumed by many services.
When a rule or template changes, those services need a way to converge — and someone
needs a way to tell which ones have not.

## Decision

Nothing is pushed. A project is updated by **re-running the skill on it**, and each skill
stamps its version into the target repository so drift is detectable.

Two stamps per project: `CLAUDE.md` carries a sentence for a human reader, and
`.backend-standards.json` / `.toolchain-config.json` carry the machine-readable version
for a fleet sweep. Both are compared against `templates/version.json` in this repo.

## Alternatives Considered

| Option                        | Pros                                                            | Cons                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Pull-based + stamp (chosen)   | No write access to other repos; each team re-syncs deliberately | A project falls behind **silently** until someone acts                                                                                    |
| Publish as npm packages       | Real dependency resolution; `npm outdated` works                | Needs registry infrastructure and a release process; the skills are the source of truth "until these are promoted to shared npm packages" |
| Push via automation (bot PRs) | Convergence without anyone remembering                          | Requires write access to every service; a bad template lands everywhere at once                                                           |

## Consequences

- **Falling behind is the default failure mode**, and it is silent. The stamp is the only
  countermeasure, which is why a change that ships without a version bump is worse than
  no stamp at all — it asserts currency that was never checked.
- That risk is now mechanical rather than remembered: `scripts/check-versions.mjs` fails
  a pull request that changes `*/templates/` or `*/references/` without moving the stamp.
- Both skills read the canonical version from `templates/version.json` at run time and
  **never** hardcode it.

## Consequences — inferred

Nothing in this repo can enumerate which services exist or which versions they carry. The
fleet table in `backend-standards/SKILL.md` is maintained by hand, and a sweep is a manual
act. That is a known gap, not a solved problem.

## Evidence

- `README.md` § "Propagation is pull-based" and § "Versioning these skills".
- `backend-standards/SKILL.md` — "Propagation is **pull-based**: re-run this skill on a
  project to sync it. Read the canonical version from `templates/version.json` — never
  hardcode it." Step 11 writes the JSON stamp.
- `toolchain-config/SKILL.md` § 6 "Version stamp", and § 9's closing reminder.
- `scripts/check-versions.mjs`.
