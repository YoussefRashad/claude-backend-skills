---
name: backend-standards
description: >-
  Create a new backend service (NestJS / TypeScript / PostgreSQL / Redis)
  that follows the team's engineering standards from the first commit, or bring an
  existing service onto those standards. Use this whenever the user wants to start,
  scaffold, bootstrap, generate or set up a new backend project or microservice —
  including phrasings like "create a new service for X", "start a backend project",
  "scaffold a new API", "set up a new microservice", "build me a backend for X", or
  "apply our backend standards to this repo". Ships the standards as files plus real
  source templates (money arithmetic, distributed locks, webhook verification,
  pagination, sort allowlists, the exception filter) rather than describing them,
  because a description drifts from the code and a file does not.
---

# Backend Standards

> **When to use:** starting a new NestJS/TypeScript service, or bringing an existing one onto the team standard. Invoke with `/backend-standards`, or a phrase like "create a new backend service for X" / "apply our backend standards to this repo".

Scaffold a service that follows the team standard from the first commit, and leave
behind a repo that keeps following it without anyone remembering to.

The standards live in `references/` next to this skill. The files that get copied
into the new project live in `templates/`. **This skill is the source of truth until
these are promoted to shared npm packages.**

Propagation is **pull-based**: re-run this skill on a project to sync it. Read the
canonical version from `templates/version.json` — never hardcode it.

---

## Requirements

### `toolchain-config` — required

ESLint, Prettier, tsconfig, Husky and lint-staged are owned by the **`toolchain-config`**
skill. This skill deliberately does not ship them: two skills shipping the same eslint config
is how they drift apart.

It must be installed alongside this one, at `~/.claude/skills/toolchain-config/`.

`toolchain-config` is an interactive **diff-and-ask** workflow with per-file approval. On
a brand-new project there is nothing project-specific to preserve, so tell the person that
and offer to approve the whole set at once — otherwise they answer roughly ten prompts in
the middle of a scaffold.

**Before step 3, check that it exists.** If it does not:

> State plainly that `toolchain-config` is not installed, that lint, formatting, compiler
> settings and git hooks will therefore be missing, and that the project is not fully on the
> standard until it is applied. Then continue with the remaining steps.

**MUST NOT** hand-write eslint/prettier/tsconfig/husky files as a substitute. A second copy
that drifts is worse than a missing one that is known to be missing.

### `project-setup` — optional, existing projects only

A general-purpose skill that reads an existing codebase and generates context documentation
plus reviewer/docs-sync agents. It lives in this repo (see `project-setup/`), but is still
**not required** — nothing here depends on it.

If it happens to be installed and you are working on an **existing** project, running it
first gives you a reverse-engineered picture of the codebase that makes filling
`03-project-architecture.md` faster. Nothing here depends on it.

The two skills point in opposite directions: `project-setup` infers documentation from code
that exists; this skill creates code to a standard. Do not expect one to substitute for the
other.

---

## Before you start — ask, do not assume

Gather these. Several are decisions the person must make, and a wrong guess is
expensive to undo once code exists.

| #   | Question                                                   | Why it cannot be guessed                                           |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Service name and one-line purpose                          | Goes in `CLAUDE.md`, `03`, `package.json`                          |
| 2   | Sensitivity — money? PII? auth?                            | Decides how much of `02` applies                                   |
| 3   | Versioning strategy — URL prefix or client-version header? | `01` §3. Changing it later breaks clients                          |
| 4   | Will clients be a released mobile app?                     | Turns `01` §13 from advice into the dominant constraint            |
| 5   | External systems it will call                              | Each needs a client with an explicit timeout, and a row in `03` §9 |
| 6   | Does it receive provider webhooks?                         | Pulls in `02` §7 and the signature template                        |
| 7   | Does it move money?                                        | Pulls in the money util, idempotency and lock templates            |

If the person says "just make something standard", use the **Defaults** section below and
**tell them what you chose**, so the decisions are visible rather than buried.

---

## Procedure

### 1. Create the NestJS project, and initialise git

Use the Nest CLI. Do not hand-roll the skeleton.

```bash
npx @nestjs/cli@11 new <name> --package-manager npm --skip-git
cd <name>
git init
```

> **The CLI major is pinned, and removing the pin breaks the scaffold.** Verified
> 2026-09-20: an unpinned `npx @nestjs/cli new` resolves to **12.x**, which generates a
> materially different baseline that this skill's templates and `toolchain-config` do
> not target — see **Nest 12** below. Pin it until that work is done.

**`git init` before step 2.** Husky installs its hooks into `.git/`, and `npm install`
runs `prepare` — without a repository it fails with `.git can not be found` and the
hooks are silently absent. Pass `--skip-git` to the CLI and init yourself, so the
initial commit is yours rather than the generator's.

Note the Nest major the CLI installed. Step 3 depends on it.

### 2. Install the dependencies the templates need

The Nest CLI installs a bare skeleton. Every source template in step 6 imports
something that is not in it, so **the scaffold does not compile until these are added**.

Install only what the service actually uses:

| Need                 | Packages                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| Always               | `helmet` `compression` `express` `@nestjs/throttler` `@types/compression` (dev) |
| Database             | `@nestjs/typeorm@^<nest-major>` `typeorm@^1` `pg`                               |
| DTOs / Swagger       | `@nestjs/swagger@^<nest-major>` `class-validator` `class-transformer`           |
| Redis locks or cache | `ioredis`                                                                       |
| Outbound HTTP        | `axios`                                                                         |

**Pin every `@nestjs/*` package to the major the CLI installed.** An unpinned
`npm install @nestjs/swagger` resolves to the newest major and fails with `ERESOLVE`
against a peer `@nestjs/common` one major behind. Read the installed version first:

```bash
node -p "require('./package.json').dependencies['@nestjs/common']"
```

**TypeORM: new services use `1.x`.**

> **Decision — Youssef Farag, 2026-09-20.** New services adopt TypeORM 1.x rather than
> matching an existing service at 0.3.22. Existing services stay where they are;
> this is not a migration mandate.
>
> **Registry check, 2026-09-20:** `npm view typeorm dist-tags` returns
> `latest: 1.1.1`, `legacy: 0.3.31`. 1.x is the published current line, so
> `typeorm@^1` resolves. Re-check before quoting this decision in a year.
>
> **What was actually verified:** the decorators `AbstractEntity` uses
> (`@PrimaryGeneratedColumn`, `@CreateDateColumn`, `@UpdateDateColumn`, `@Entity`,
> `@Column`, `@Index`) exist on 1.x, and an entity extending `AbstractEntity` with a
> `numeric` column compiles. **Repository and query-builder behaviour was not
> exercised** — no connection was opened and no query was run. Treat the first service
> that actually talks to a database as the real compatibility test, and record anything
> surprising in its `known-deviations.md`.

**Check every major against the services already running**, not just `@nestjs/*`. A
fresh `npm install typeorm` today resolves to a different major than an existing service
may be on, and nothing warns you — the new project simply compiles and behaves differently.
Before installing, compare:

```bash
node -p "require('<an-existing-service>/package.json').dependencies.typeorm"
```

If they differ across a major boundary, that is a **decision to raise**, not a default to
accept. Matching the fleet makes engineers portable between services and keeps this skill's
templates behaving the same everywhere. Deliberately moving ahead is fine — say so, and
record it in `known-deviations.md`.

`express` must be a **direct** dependency, not just transitive via
`@nestjs/platform-express` — `main.ts` imports from it, and the lint config rejects
importing a package that is not declared.

### 3. Apply the toolchain

Check that the `toolchain-config` skill is available, then invoke it. Let it own ESLint,
Prettier, tsconfig, Husky and lint-staged.

If it is not installed, say so explicitly (see **Requirements**) and carry on. Do not
substitute hand-written config.

### 4. Copy the standards into the repo

The repo must be self-contained — a developer without this skill still needs the
rules. Copy into `.ai/standards/`:

| From                                        | To                                            |
| ------------------------------------------- | --------------------------------------------- |
| `references/00-ai-agent-instructions.md`    | `.ai/standards/00-ai-agent-instructions.md`   |
| `references/01-engineering-standards.md`    | `.ai/standards/01-engineering-standards.md`   |
| `references/02-security-and-compliance.md`  | `.ai/standards/02-security-and-compliance.md` |
| `references/04-review-and-dod.md`           | `.ai/standards/04-review-and-dod.md`          |
| `templates/docs/03-project-architecture.md` | `.ai/standards/03-project-architecture.md`    |
| `templates/docs/known-deviations.md`        | `.ai/standards/known-deviations.md`           |

`.ai/standards/` and `.claude/agents/` are **vendored** — formatted at source in the skill
and re-synced from it. Letting the project reformat them makes every future sync produce a
spurious diff, and a diff that is always noise is a diff nobody reads.

Both are already in `toolchain-config`'s canonical `.prettierignore`, so if step 3 ran there
is nothing to do here. **Confirm they are present** rather than assuming — and if
`toolchain-config` was skipped, append them yourself:

```
.ai/standards/
.claude/agents/
```

### 5. Write `CLAUDE.md`

From `templates/docs/CLAUDE.md`. Substitute `{{SERVICE_NAME}}`,
`{{ONE_LINE_PURPOSE}}`, `{{SENSITIVITY}}`, `{{COMMANDS}}`, and
`{{STANDARDS_VERSION}}` (read from `templates/version.json`).

`{{COMMANDS}}` is the `04` Part A gate set. For a project scaffolded by this skill with
`toolchain-config` applied, that is:

```bash
npm run lint          # A1
npm run typecheck     # A2
npm test              # A3
npm run scan:deps     # A4
npm run scan:secrets  # A5
npm run format:check  # A6
npm run build         # A7
```

Include only the ones that actually exist. If `toolchain-config` was skipped, most of
these do not — write the ones that do and say which are missing, rather than listing a
command that will fail. The same list goes into `03` §12.

It preloads only `00`, `03` and `known-deviations` — the short, project-specific
ones. `01`, `02` and `04` are loaded on demand. Preloading 2,000 lines every session
costs more than it returns.

### 6. Copy the source templates

Copy only what the service actually needs. An unused template is dead code, and dead
code teaches the next person that the standard is decorative.

| Template                                                         | Copy when                    | Enforces                                           |
| ---------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `src/common/abstract.entity.ts`                                  | always                       | `01` §7                                            |
| `src/common/api-envelope.ts`                                     | always                       | `01` §4 — the envelope                             |
| `src/common/correlation-id.middleware.ts`                        | **always**                   | `01` §14 — MUST, and the exception filter reads it |
| `src/common/rate-limit.ts`                                       | **always**                   | `02` §9 — MUST, global rate limiting               |
| `src/interceptors/response-envelope.interceptor.ts` + `.spec.ts` | always                       | `01` §4 — all-or-nothing                           |
| `src/filters/all-exceptions.filter.ts`                           | always                       | `01` §4 — one filter, one shape                    |
| `src/main.ts`                                                    | always                       | body limits, validation, shutdown, CORS            |
| `src/common/pagination.dto.ts`                                   | any list endpoint            | `01` §3 — the `@Max` cap                           |
| `src/common/sortable.ts` + `.spec.ts`                            | any sortable list            | `01` §3 — allowlist at the query layer             |
| `src/common/money.util.ts` + `.spec.ts`                          | **service touches money**    | `01` §6                                            |
| `src/common/redis-lock.service.ts`                               | locks or concurrency control | `01` §8 — ownership + fail closed                  |
| `src/common/base.axios.ts`                                       | any outbound call            | `01` §10 — timeout required                        |
| `src/common/webhook-signature.util.ts`                           | receives provider callbacks  | `02` §7 — verify first                             |

**Copy each spec with the file it tests.** The spec is what turns a claim in the standard
into something checkable: `money.util.spec.ts` proves the exactness claim in `01` §6,
`sortable.spec.ts` proves the allowlist actually rejects inherited `Object.prototype` keys
(`toString`, `constructor`) rather than passing them into `ORDER BY`, and
`response-envelope.interceptor.spec.ts` proves the body's `statusCode` matches the HTTP
status line on a `POST` — which the obvious implementation gets wrong.

**Two of these are not optional even though nothing imports them yet.**
`correlation-id.middleware.ts` and `rate-limit.ts` each back a **MUST** (`01` §14, `02` §9).
Skipping them ships a service that violates its own security floor from the first commit.
`rate-limit.ts` needs two lines in `AppModule` — the wiring snippet is in the file, and it
does nothing until you add them.

### 7. Copy the review agents

Copy into `.claude/agents/`:

| Template                        | Job                                                           |
| ------------------------------- | ------------------------------------------------------------- |
| `templates/agents/reviewer.md`  | Pre-merge review against `01`, `02` and `04`                  |
| `templates/agents/docs-sync.md` | Keeps `03` and `known-deviations.md` truthful as code changes |

`docs-sync` is the one people skip, and it is the one that decides whether `03` is worth
reading in a year. `01` and `02` reference `03` by name and agents load it before touching
code — a statement in it that quietly stopped being true is worse than no documentation,
because nobody re-verifies a document they trust. Copy it.

Neither agent runs automatically. Tell the person they are invoked manually.

### 8. Fill `03-project-architecture.md`

Every `<…>` is a blank. `01` and `02` reference this document by name, so an
unfilled blank is a rule that cannot be followed.

Fill it from what you actually created — not from the template's suggestions.
State plainly where something does not exist yet ("no CI", "no readiness probe")
rather than leaving a placeholder that reads as if it does.

### 9. Normalise the generated files, then verify

The Nest CLI generates `src/app.*.ts` and `test/app.e2e-spec.ts` against its own defaults,
not the team config. They fail `simple-import-sort` and `consistent-type-imports` out of
the box:

```bash
npx eslint . --fix
npx prettier --write "src/**/*.ts" "test/**/*.ts" CLAUDE.md
```

This is generator boilerplate, not application source — `toolchain-config`'s rule about not
modifying source to satisfy lint does not apply to a file the generator wrote sixty seconds
ago.

**Then run every gate and report real output. Do not skip this.**

```bash
npm run lint           # expect 0 errors
npm run format:check   # expect all files pass
npm run typecheck      # tsc --noEmit -p tsconfig.eslint.json — covers src AND specs
npm test
npm run build
```

Use `npm run typecheck`, not `tsc -p tsconfig.json`. The build config excludes
`**/*.spec.ts`, so the latter type-checks zero test files and still reports success.

`security/detect-object-injection` **warnings** are expected where a keyed lookup is
guarded by an allowlist. The security plugin ships as a ratchet at `warn`. Errors are not
acceptable; these warnings are.

**Then boot it.** Every gate above is static, and a service can pass all five and still
throw on startup — a default import of a CommonJS package, a missing required environment
variable, a provider the container cannot resolve. None of those are type errors.

```bash
ALLOWED_ORIGINS= node dist/main.js    # expect: listening, no throw
```

A scaffold that lints, type-checks, tests and builds but does not start is the exact
failure this step exists to catch. Report what you observed — "it booted and logged
`Nest application successfully started`" — not "the gates passed".

### 10. Wire CI

`01` §18. Lint, type check, unit tests, dependency scan, secret scan — blocking.

Copy `templates/ci/github-actions.yml` → `.github/workflows/ci.yml`. It implements every
`04` Part A gate plus a boot smoke test, and carries the comments explaining each one.

**Copying the file is half the job.** The workflow makes the gates _run_; it cannot make
a merge _blocked_ on them — that is branch protection on the repository, which an agent
cannot set. Tell the person, in the report, that they must enable "Require status checks
to pass" and select these jobs. Until they do, `01` §18's "a merge MUST be blocked on
those gates" is unmet and `01` §17's four testing MUSTs stay SHOULDs. Say that plainly
rather than letting a green workflow imply otherwise.

If the project is not on GitHub, translate the jobs rather than skipping the step, and
say which runner you targeted.

### 11. Stamp the version

Write `.backend-standards.json` at the repository root, using the version from
`templates/version.json`:

```json
{
  "version": "<from templates/version.json>",
  "appliedBy": "backend-standards"
}
```

**Write it exactly like that — two-space indented, one key per line, trailing newline.**
`format:check` (gate A6) covers `*.json` at the repo root, so a compact one-liner makes a
freshly scaffolded project fail its own format gate on the first run. A scaffold that
ships failing a gate teaches the reader the gate is noise.

The same sentence also goes into `CLAUDE.md` (step 5) for a human reader. The JSON file
is for the fleet sweep — finding every repo that is behind should be one `jq`, not a
grep through prose. Do not add timestamps or generated values that cause file churn.

### 12. Report

Use the reporting template in `04-review-and-dod.md`. State which templates you copied,
which you skipped and why, what is in `03`, and what does not exist yet.

Say explicitly whether `toolchain-config` was applied. If it was not, that is the first
thing the person needs to know, not a footnote.

---

## Defaults (already decided — do not re-litigate)

These were settled on 2026-09-20. They are recorded with their rationale in the
standards; the point of listing them here is that you apply them without asking.

| Area                   | Default                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Response envelope      | Yes for a new service. All-or-nothing within the service.                                                                                                         |
| `forbidNonWhitelisted` | **Off.** Unknown fields stripped silently.                                                                                                                        |
| Validation status      | 400 for validation failures. Never 422.                                                                                                                           |
| Money                  | Integer minor units. **No decimal library.**                                                                                                                      |
| Table naming           | No house convention — match the area. Beware PG reserved words.                                                                                                   |
| Testing                | MUST on four paths once CI runs: money state transitions, idempotency, authorization, webhook signatures. Coverage ratchet.                                       |
| Timestamps             | `timestamptz`.                                                                                                                                                    |
| Pagination             | `page` / `limit` / `sortBy` / `sortOrder`, limit capped.                                                                                                          |
| Versioning             | URL prefix `/api/v1` for a service with no released mobile client. Ask when there is one — a header gate may suit better, and the choice is expensive to reverse. |

---

## Applying this to an EXISTING project

Different job, and the failure mode is worse — here you can break something that
works.

0. If `project-setup` is installed, running it first gives you a reverse-engineered map of
   the codebase. Optional — verify whatever it produces against the source before you rely
   on it, because an inferred document is a hypothesis, not a fact.
1. **Read `00` §3 first.** A mismatch between the standard and a working codebase is
   information to report, not a defect to fix.
2. Copy the standards into `.ai/standards/` and write `CLAUDE.md`.
3. Fill `03` from **what the code actually does**, verified by reading it. Not from
   what the existing docs claim — those drift. Check the claims.
4. Fill `known-deviations.md` with every place the project intentionally differs.
   Each entry needs an owner and a review date.
5. **Do not** copy source templates over working code.

   For a **new module inside an existing service**, `00` §3 decides and it is not
   ambiguous: _follow the existing service._ If the service already has a money helper,
   a lock service or a pagination DTO, the new module uses **that one**, even where it
   differs from the template. A second pagination contract or a second money utility in
   one service is worse than a non-standard one, because now every reader has to work
   out which applies.

   Offer a template only where the service has **no** existing equivalent — and say so
   as an offer, not a change.

6. **Do not** change a live endpoint's shape, status code or validation. `01` §13
   overrides everything else for endpoints already in production.

7. Copy the two agents (step 7). On an existing project they are the highest-value thing
   this skill delivers — `docs-sync` is what stops `03` from going stale, and stale
   architecture docs are the normal outcome, not the exception.

The deliverable here is `03` + `known-deviations` + `CLAUDE.md` + the two agents. Nothing
else should change unless the person explicitly asks.

---

---

## Nest 12 — known gap, do not scaffold on it yet

Verified by scaffolding both, 2026-09-20. The Nest 12 CLI generates a different baseline
in six ways that matter, and nothing in this skill or `toolchain-config` targets it yet:

|                           | Nest 11 (targeted)              | Nest 12 (not yet supported)                             |
| ------------------------- | ------------------------------- | ------------------------------------------------------- |
| Linter                    | ESLint + `eslint.config.mjs`    | **oxlint** + `oxlint.json`                              |
| Tests                     | Jest                            | **Vitest** (`types: ["vitest/globals"]`)                |
| Modules                   | `commonjs` / `node`             | **`nodenext`** — relative imports need `.js` extensions |
| TypeScript                | 5.x                             | **6.x**                                                 |
| `strict`                  | off (out of scope, by decision) | **on**                                                  |
| `useDefineForClassFields` | pinned `false`                  | **absent**, with `target: ES2023`                       |

Each one breaks something concrete:

- **`nodenext`** — every source template imports extensionlessly (`from './common/api-envelope'`).
  Under `nodenext` those do not resolve.
- **Vitest** — `sortable.spec.ts` uses `jest.fn()`. Vitest exposes `vi.fn()`; there is no
  `jest` global.
- **oxlint** — applying `toolchain-config` leaves a repo with two linters and two rule
  sets. The `no-restricted-syntax` rules backing `01` §5 and §7 exist only in the ESLint
  config, so `npm run lint` would pass while nothing enforces them.
- **`useDefineForClassFields`** — the generated config omits it at `target: ES2023`, so it
  defaults to **true**. That is exactly the footgun `toolchain-config` documents: decorated
  TypeORM fields overwrite hydrated values with `undefined`. On Nest 12 that trap is live
  out of the box.
- **`strict: true`** — applying the canonical `tsconfig.json` would turn it _off_, which is
  a regression, not unification. `toolchain-config` explicitly treats strictness as its own
  initiative; here the generator has already made the decision.

**Until this is resolved:** pin the CLI (step 1). Supporting Nest 12 is a deliberate piece
of work — a second toolchain profile, or a decision to move the fleet — not something to
improvise mid-scaffold. Raise it with the owner.

---

## The fleet

Step 2 says to compare major versions against the services already running. That check
needs a list, and a list nobody maintains is worse than none — so it lives here, and
updating it is part of standing up a new service.

| Service              | Repository | Notes                                                               |
| -------------------- | ---------- | ------------------------------------------------------------------- |
| `<existing-service>` | `<url>`    | TypeORM 0.3.22 — predates the 1.x decision; not a migration mandate |
| `<service>`          | `<url>`    | `<notes>`                                                           |

If a service you are working on is not in this table, **add it**. If the table is clearly
stale, say so in your report rather than trusting it — an inferred fleet is a hypothesis,
the same way an inferred architecture document is.

Where you cannot reach a listed repository, say that you could not perform the
version comparison. Do not silently accept whatever `npm install` resolves.

---

## Owner and escalation

Several rules end in "raise it with the owner": `02` §1 (any change breaking one of the
four logging conditions), `01` §6 (introducing a decimal library), `00` §4 (a MUST that
cannot be satisfied), step 2 (a major-version divergence from the fleet).

| Role                                                              | Who                                            | For                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Standards owner — signs the decisions in `01`, `02` and this file | **Youssef Farag**, Head of Backend Engineering | Security floor, logging posture, money rules, rule strength |
| Repository maintainer — reviews changes to this skill             | `@YoussefRashad` (see `.github/CODEOWNERS`)    | Templates, toolchain baseline, procedure                    |
| Escalation channel                                                | `<team channel / ticket queue>`                | Anything time-sensitive                                     |

An agent that cannot reach the owner **MUST** stop and report, not proceed on an
assumption. "Raise with the owner" is not satisfied by writing it in a summary nobody
is required to read.

---

## Relationship to the other review skills

`pr-review` and `audit` are **framework-agnostic skills in this repo** alongside this one.
They overlap with the `reviewer` agent this skill installs, and the difference is worth
being explicit about so neither gets skipped as "already covered":

|                               | Scope                    | Reviews against                                                                        |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `reviewer` agent (this skill) | One diff, pre-merge      | **This project's** `.ai/standards/` — including its `03` and its `known-deviations.md` |
| `pr-review`                   | One diff, pre-merge      | Generic backend security/quality lanes + real scanners                                 |
| `audit`                       | Whole codebase, periodic | Generic security-first sweep                                                           |

They are complements. `reviewer` is the only one that knows what this project has
intentionally deviated on, so it is the one that will not re-report a documented
deviation as a defect. Where both run, `reviewer`'s finding wins on any question of
"is this intentional here" — that is what `known-deviations.md` is for.

---

## Version

Read `templates/version.json`. Never hardcode it.

Stamp it in **two** places (steps 5 and 11):

| Where                                                                       | For                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------- |
| `CLAUDE.md` — "Applied from the `backend-standards` skill, version `x.y.z`" | A human opening the repo                              |
| `.backend-standards.json`                                                   | The fleet sweep — machine-readable, one `jq` per repo |

### What a version bump means

Bump whenever you change anything a project would receive — a rule, a template, a
dependency default:

- **Major** — an existing project re-syncing would have to change code or could break:
  a renamed export, a compiler option that alters emit, a rule promoted to `error`.
- **Minor** — new material that is additive: a new template, a new section, a new
  optional rule.
- **Patch** — wording, typos, a clarified comment with no behavioural change.

A stamp that does not move is worse than no stamp, because it asserts currency that
was never checked.
