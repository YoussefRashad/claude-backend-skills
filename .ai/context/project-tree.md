# Project tree

What each part of this repository is, and which parts are dangerous to change.

> **The central fact:** nothing here runs. `*/templates/` and `*/references/` are payload
> copied into other repositories. A defect in a template does not break this repo — it
> breaks every service scaffolded after it, silently, until someone notices.

```
claude-backend-skills/
├── backend-standards/          skill 1 — scaffold/align a backend service
│   ├── SKILL.md                the 12-step procedure
│   ├── README.md               install notes
│   ├── references/             the standards, copied into every project
│   └── templates/              docs · agents · ci · src
├── toolchain-config/           skill 2 — the canonical ESLint/Prettier/tsconfig baseline
│   ├── SKILL.md                diff-and-ask workflow
│   └── templates/              eslint · prettier · tsconfig · husky · security-scan
├── project-setup/SKILL.md      skill 3 — docs + agent scaffolding (general-purpose)
├── pr-review/SKILL.md          skill 4 — per-PR multi-lane review (general-purpose)
├── audit/SKILL.md              skill 5 — full-codebase safety net (general-purpose)
├── scripts/check-versions.mjs  version-stamp guard (run by `npm run check` and CI)
└── .github/workflows/ci.yml    format check + stamp guard for THIS repo
```

`project-setup` / `pr-review` / `audit` are **framework-agnostic** skills — single
`SKILL.md` files with no `templates/` or `references/`, so the CI version-stamp guard
(which covers only `backend-standards` and `toolchain-config`) does not apply to them and
they carry no `version.json`. They overlap with `backend-standards`' own reviewer/docs-sync
agents — see § "Relationship to the other review skills" in `backend-standards/SKILL.md`.

## `backend-standards/`

| Path                                       | What it is                                                                                                      | Ships to                     |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `SKILL.md`                                 | 12-step procedure; also holds the Defaults, the fleet table, the owner/escalation table and the **Nest 12** gap | —                            |
| `references/00-ai-agent-instructions.md`   | Read-first rules: RFC 2119 key, precedence order, inspect-before-implement, escalation                          | `.ai/standards/`             |
| `references/01-engineering-standards.md`   | 19 sections — architecture, API, money, DB, Redis, idempotency, backward compatibility, CI                      | `.ai/standards/`             |
| `references/02-security-and-compliance.md` | **The security floor.** Data classes A–D, the logging posture, retention, authn/authz, webhooks, secrets        | `.ai/standards/`             |
| `references/04-review-and-dod.md`          | Part A (machine-checkable) vs Part B (human judgment)                                                           | `.ai/standards/`             |
| `templates/docs/`                          | `CLAUDE.md` (placeholders), `03-project-architecture.md`, `known-deviations.md`                                 | `.ai/standards/` + repo root |
| `templates/agents/`                        | `reviewer.md`, `docs-sync.md` — **for the scaffolded service**, not for this repo                               | `.claude/agents/`            |
| `templates/ci/github-actions.yml`          | The 04 Part A gates plus a boot smoke test                                                                      | `.github/workflows/`         |
| `templates/src/`                           | 16 real TypeScript files (4 are specs)                                                                          | `src/`                       |
| `templates/version.json`                   | The stamp. **Bump on any change under `templates/` or `references/`.**                                          | —                            |

## `toolchain-config/`

| Path                                  | Notes                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `SKILL.md`                            | Also holds two footgun boxes: `useDefineForClassFields` and `emitDecoratorMetadata` vs `import type` |
| `templates/eslint.config.mjs`         | The ratchet (`no-unsafe-*` at `warn`) **and** the `error` rules backing MUSTs                        |
| `templates/tsconfig*.json`            | 3 files. `tsconfig.eslint.json` is also the `typecheck` target — `tsconfig.json` excludes specs      |
| `templates/package-fragments.md`      | Scripts, lint-staged, pinned devDeps + the **dependency-currency** table                             |
| `templates/scripts/security-scan.mjs` | semgrep / osv-scanner / trufflehog in Docker; strict by default                                      |

## Flagged — money, security, injection

These carry the most risk per line. See `critical-modules.md` before editing.

| File                                             | Why                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `references/02-security-and-compliance.md`       | Defines what may be logged. A relaxed rule here relaxes it fleet-wide    |
| `templates/src/common/money.util.ts`             | Exact integer-minor-unit arithmetic. A rounding change is a money change |
| `templates/src/common/sortable.ts`               | The only barrier between a `sortBy` parameter and `ORDER BY`             |
| `templates/src/common/webhook-signature.util.ts` | Constant-time comparison; verify-before-state-change                     |
| `templates/src/common/redis-lock.service.ts`     | Ownership-checked release; fails closed                                  |
| `templates/scripts/security-scan.mjs`            | Exit codes decide whether the A4/A5 gates can block                      |

## Dependencies between the two skills

`backend-standards` **requires** `toolchain-config` and invokes it at step 3. It
deliberately ships no lint/compiler/hook config — see `ADR-001`. The dependency is
one-way: `toolchain-config` knows nothing about `backend-standards`, except that its
canonical `.prettierignore` lists `.ai/standards/` and `.claude/agents/` so a re-sync
does not reformat vendored files.

<!-- Generated by project-setup · Source: 560e0d8 + uncommitted 2.0.0 changes -->
