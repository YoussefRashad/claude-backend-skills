# Architecture decisions

Decisions that are **settled**. Do not re-litigate them, and do not suggest replacing a
technology or setting recorded here without raising it first.

Each ADR cites where the decision is established in the repository. Nothing here was
inferred from the presence of a dependency — the bar is an explicit, argued decision.

| ADR                                                 | Decision                                                           | Signed                    |
| --------------------------------------------------- | ------------------------------------------------------------------ | ------------------------- |
| [001](ADR-001-two-skills-not-one.md)                | Split the standards and the toolchain into two skills              | —                         |
| [002](ADR-002-pull-based-propagation.md)            | Propagate by pull, and stamp every project                         | —                         |
| [003](ADR-003-source-templates-not-descriptions.md) | Ship real source files, not descriptions                           | —                         |
| [004](ADR-004-no-decimal-library.md)                | Money arithmetic with zero dependencies                            | Youssef Farag, 2026-09-20 |
| [005](ADR-005-forbid-non-whitelisted-off.md)        | Strip unknown request fields silently                              | Youssef Farag, 2026-09-20 |
| [006](ADR-006-class-b-c-logging-posture.md)         | Log credentials and personal data in full, inside an audited store | Youssef Farag, 2026-09-20 |

## Owner and escalation

The standards owner signs the decisions in `01`, `02` and `backend-standards/SKILL.md`.
Several rules end in "raise it with the owner" — `02` §1 (any change breaking one of the
four logging conditions), `01` §6 (introducing a decimal library), `00` §4 (a MUST that
cannot be satisfied), and `SKILL.md` step 2 (a major-version divergence from the fleet).

See § "Owner and escalation" in `backend-standards/SKILL.md` for who that is.

## Decisions NOT recorded here

Deliberately, because they are settled in one place and repeating them creates a second
source of truth that can drift:

| Decision                                                                           | Where it lives                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| TypeORM 1.x for new services                                                       | `backend-standards/SKILL.md` step 2 (signed, with the registry check)   |
| The `Defaults` table — envelope, 400-not-422, table naming, pagination, versioning | `backend-standards/SKILL.md` § Defaults                                 |
| `useDefineForClassFields: false`                                                   | `toolchain-config/SKILL.md` footgun box                                 |
| `consistent-type-imports` off                                                      | `toolchain-config/SKILL.md` footgun box + the config comment            |
| Dependency pins held behind current majors                                         | `toolchain-config/templates/package-fragments.md` § Dependency currency |
| Nest CLI pinned to 11                                                              | `backend-standards/SKILL.md` § Nest 12                                  |

Those six are as binding as the ADRs above. They are listed here so the absence of an ADR
is not read as the absence of a decision.
