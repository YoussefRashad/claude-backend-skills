---
name: toolchain-config
description: >-
  Apply the unified team toolchain config (ESLint, Prettier, tsconfig,
  Husky, lint-staged) to a NestJS / TypeScript backend. Use this whenever the user
  wants to set up, unify, standardize, align, fix, or refresh linting / formatting
  / TypeScript-compiler / git-hook configuration across projects — including
  phrasings like "unify the eslint config", "set up prettier + husky", "make this
  repo match our standard tooling", "why is my formatting inconsistent", or "align
  tsconfig with the other services". Prefer this skill over hand-writing config
  files, so every repo ends up with the same reviewed baseline instead of drifting
  copies.
---

# Toolchain Config — Unified ESLint / Prettier / tsconfig / Husky

> **When to use:** unifying ESLint / Prettier / tsconfig / Husky / lint-staged across a NestJS/TypeScript backend. Invoke with `/toolchain-config`, or "unify the eslint config" / "align tsconfig with the other services".

Bring a NestJS / TypeScript backend onto the team's single reviewed toolchain
baseline.

The canonical config lives in `templates/` next to this skill. This skill is the
source of truth until it is promoted to shared npm packages
(`@<org>/*`).

Propagation is **pull-based**: re-run this skill on a project to sync it, and use
the version stamp to identify projects that are behind.

The canonical version MUST be read from:

`templates/version.json`

Example:

```json
{
  "version": "1.1.0"
}
```

**Never hardcode the canonical version inside this skill.** (The example above is
illustrative only — always read the real value from `templates/version.json`.)

## Template → target filename mapping

Templates are stored WITHOUT a leading dot (and `.prettierrc` is stored as JSON) so
they are easy to read in the repo. When applying, map them to their real target
names:

| Template under `templates/` | Target file in repo                                               |
| --------------------------- | ----------------------------------------------------------------- |
| `eslint.config.mjs`         | `eslint.config.mjs`                                               |
| `prettierrc.json`           | `.prettierrc`                                                     |
| `prettierignore`            | `.prettierignore`                                                 |
| `editorconfig`              | `.editorconfig`                                                   |
| `tsconfig.json`             | `tsconfig.json`                                                   |
| `tsconfig.build.json`       | `tsconfig.build.json`                                             |
| `tsconfig.eslint.json`      | `tsconfig.eslint.json` — also the `typecheck` target (see step 8) |
| `husky/pre-commit`          | `.husky/pre-commit`                                               |
| `husky/pre-push`            | `.husky/pre-push`                                                 |
| `scripts/security-scan.mjs` | `scripts/security-scan.mjs` (Docker-based scanners — see below)   |
| `package-fragments.md`      | merged into `package.json` (see step 4)                           |
| `version.json`              | source for the `.toolchain-config.json` stamp                     |

### Security scanners (`scripts/security-scan.mjs` + `scan*` scripts)

Recommended. The canonical `package.json` scripts include `scan`, `scan:sast`,
`scan:deps`, `scan:secrets`, which call the companion runner
`scripts/security-scan.mjs` (copy it verbatim from the template). It runs
**semgrep**, **osv-scanner** and **trufflehog** in Docker and mounts only `src/`,
`package-lock.json` and `.git/` — never `env/`, `cert/`, or `*.pem`.

- `.git` is mounted (read-only) because `02` §12 is explicit that git history retains
  a leaked secret after it is deleted from the working tree. A secret scan that reads
  only the working tree cannot see the commit that introduced one.
- The trade that buys: an uncommitted secret in a working-tree file **outside `src/`**
  is not scanned, because scanning it would mean mounting `env/`. That is the right
  way round — `02` §8 forbids tooling from reading those at all.
- **These exit non-zero on findings by default.** `04` Part A lists the dependency
  scan (A4) and the secret scan (A5) as blocking, and a command that always exits 0
  cannot block. Pass `-- --no-strict` for an exploratory local run.
- Requires **Docker** on the machine running the scan. If the target repo/team
  cannot use Docker, diff-and-ask as usual and skip the four `scan*` keys **and**
  the runner file — do not add scripts that will always fail. Say explicitly that
  A4 and A5 then have nothing behind them locally and must be wired in CI.
- These are a pre-merge gate, not a lint gate. The lint-time security coverage comes
  from `eslint-plugin-security` (below), which runs on every `npm run lint` and
  pre-commit.

`eslint-plugin-security` is part of the canonical `eslint.config.mjs`: the
high-signal rules (`detect-child-process`, `detect-non-literal-fs-filename`,
`detect-unsafe-regex`, `detect-eval-with-expression`, `detect-pseudoRandomBytes`,
…) are enabled as `warn` (ratchet — surface without breaking existing code).
`detect-object-injection` stays `warn` but is the only noisy one;
`detect-possible-timing-attacks` is intentionally off (high false-positive rate).

---

## When this applies

- Target is a **NestJS / TypeScript backend** with a `package.json` and TypeScript,
  usually including `@nestjs/*` dependencies.
- If the target is a frontend (React/Next/etc.) or a non-TypeScript project,
  STOP and tell the user that this baseline is backend-only.
- Run from the **repo root** where `package.json` lives.

---

## Core principle — canonical vs project-specific

Some settings are **canonical** and must be unified across projects.
Others are **project-specific** and must be preserved from the target repository.
Never overwrite project-specific configuration as part of unification.

| File                                   | Canonical                                                     | Project-specific / Preserve                                             |
| -------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `eslint.config.mjs`                    | effective ESLint configuration                                | project-specific behavior unless explicitly covered by canonical config |
| `.prettierrc`                          | whole file                                                    | —                                                                       |
| `.prettierignore`                      | canonical entries                                             | append existing repo-only ignore patterns                               |
| `.editorconfig`                        | whole file                                                    | —                                                                       |
| `tsconfig.json`                        | canonical `compilerOptions` baseline                          | existing `extends`, `baseUrl`, `paths`, `include`, `exclude`            |
| `tsconfig.build/eslint/test.json`      | whole file                                                    | —                                                                       |
| `package.json`                         | canonical scripts, `lint-staged`, toolchain `devDependencies` | everything else                                                         |
| `.husky/pre-commit`, `.husky/pre-push` | canonical hook body                                           | explicitly identified project-specific commands                         |

---

## ⚠️ Critical TypeScript footgun — `useDefineForClassFields`

The canonical `tsconfig.json` sets:

```json
"useDefineForClassFields": false
```

and:

```json
"target": "ES2022"
```

With an ES2022-or-later target, TypeScript uses standard class-field semantics,
which differ from the legacy assignment semantics used by some existing
NestJS/TypeORM decorated classes.

In affected decorated classes/entities, class-field initialization can overwrite
values assigned by decorators or ORM hydration, potentially resetting properties
to `undefined`.

The template explicitly pins:

```json
"useDefineForClassFields": false
```

to preserve the existing backend baseline while still targeting ES2022.

**Never remove this setting while keeping `"target": "ES2022"` unless the project
has been explicitly verified against standard class-field semantics.**

If changing this setting causes `TS2612` or `TS2729`, fix the configuration first.
Do not modify individual application call sites to work around a configuration
problem.

---

## ⚠️ Critical decorator footgun — `emitDecoratorMetadata` vs `import type`

NestJS resolves constructor dependencies from the `design:paramtypes` metadata that
`emitDecoratorMetadata` emits. That metadata only carries a real class reference if
the import is a **value** import:

```ts
import { Redis } from 'ioredis'; //  → design:paramtypes: [Redis]
import type { Redis } from 'ioredis'; //  → design:paramtypes: [Object]   ← DI breaks
```

With the type-only form, the container fails at runtime with
`Nest can't resolve dependencies of the XService (?)`. Nothing in lint, `tsc` or a
unit test catches it — the code compiles and builds perfectly.

**This is why `@typescript-eslint/consistent-type-imports` is `off` in the canonical
`eslint.config.mjs`.** The rule treats a constructor parameter type as type-only usage
and `--fix` rewrites the import — and because `lint-staged` runs `eslint --fix` on
every commit, the rule does not merely tolerate the bug, it _introduces_ it into code
that was correct.

- **MUST NOT** re-enable `consistent-type-imports` while `emitDecoratorMetadata` is on.
- A hand-written `import type` is still fine for genuinely type-only imports
  (interfaces, `Observable`, `Request`/`Response`). It is only injected _classes_ that
  must be value imports.
- The import-cycle benefit the rule offered is already covered by `import/no-cycle`.

### `esModuleInterop`

The canonical `tsconfig.json` sets both:

```json
"allowSyntheticDefaultImports": true,
"esModuleInterop": true
```

`allowSyntheticDefaultImports` alone only silences the _type_ error on
`import x from 'cjs-pkg'`. The emit still resolves `cjs_pkg_1.default`, which is
`undefined` for a plain CommonJS module (`module.exports = fn` — e.g. `compression`).
The result type-checks, builds, and throws at boot.

**Migration note for an existing repo:** enabling `esModuleInterop` can surface new
errors where `import * as x from 'cjs'` is then _called_ as a function. That is a real
source change, so report it (step 8) — do not fix it silently, and do not resolve it by
dropping `esModuleInterop` back out.

---

# Workflow

This is an interactive **diff-and-ask** workflow.
**Never overwrite configuration files silently.**

---

## 1. Detect & confirm

Before making any changes:

1. Read `package.json`.
2. Confirm the project is a NestJS / TypeScript backend.
3. Read `templates/version.json` to determine the canonical version.
4. Read `.toolchain-config.json` if present.
5. Report:
   - current project toolchain version, if stamped
   - canonical version
   - whether the project appears up to date
   - whether configuration drift exists
6. Check git status.

If the working tree is dirty:

- Warn the user.
- Recommend committing or stashing existing work first.
- Do **not** block the operation unless the user explicitly requires a clean
  working tree.

Do not create a branch automatically.
If the user wants a dedicated branch, recommend:

```text
chore/toolchain-config
```

but ask before creating it.

---

## 2. Compare configuration files

For every file listed in the canonical table (mapping template names to their real
target names per the **Template → target filename mapping** above):

1. Read the existing target file, if present.
2. Read the matching template.
3. Compute the effective canonical content.

### Verbatim-template files

For these files, use the template as the canonical content:

- `eslint.config.mjs`
- `.prettierrc`
- `.editorconfig`
- `tsconfig.build/eslint/test.json`
- `.husky/pre-commit`
- `.husky/pre-push`

### `tsconfig.json`

Do NOT replace the entire file.
Merge the canonical template `compilerOptions` into the existing
`tsconfig.json`.

Preserve existing project-specific:

- `extends`
- `baseUrl`
- `paths`
- `include`
- `exclude`

If `tsconfig.json` contains `extends`:

- Preserve the existing `extends` relationship.
- Inspect effective inherited compiler options before deciding whether a
  canonical option is already satisfied.
- Never flatten or remove `extends`.
- Never replace an existing `extends` relationship unless the user explicitly
  requests it.

Always preserve:

```json
"useDefineForClassFields": false
```

### `.prettierignore`

Create the effective content as:

```text
canonical template entries
+
existing project-only ignore entries
```

Remove duplicate entries.
Keep canonical entries in template order and append preserved project-only
entries afterward.

### Content normalization

Compare configuration content semantically rather than byte-for-byte.
Ignore:

- CRLF vs LF
- trailing-newline differences
- irrelevant whitespace differences
- comments where they have no semantic effect

Do not rewrite a file solely because of EOL or trailing-newline differences.
EOL behavior is governed by the canonical Prettier and EditorConfig settings.

### ESLint-specific comparison

For `eslint.config.mjs`, compare the **effective ESLint configuration**, not only
the `rules` object.

Do NOT ignore differences in:

- plugins
- parser
- parser options
- settings
- language options
- ignores
- files/globs
- rules
- linter options

Comments, whitespace, and line wrapping may be ignored.
Only offer a cosmetic rewrite when the effective configuration already matches
and the user wants the canonical formatting/comments.

---

## 3. Diff-and-ask

For every file:

1. Show whether it is:
   - already in sync
   - missing
   - changed
2. If changed, show a clear diff.
3. Explain any project-specific values being preserved.
4. Ask for approval **before writing**.

Approval is **per file**.
Do not batch multiple file writes under a single approval unless the user
explicitly asks to approve the whole toolchain change at once.

If the user rejects a file, leave it unchanged and continue only with explicitly
approved files.

---

## 4. Merge `package.json`

Follow:

```text
templates/package-fragments.md
```

Modify **only**:

- canonical toolchain scripts
- `prepare`
- `lint-staged`
- canonical toolchain `devDependencies`

Preserve everything else in `package.json`.

### Dependency versions

Canonical pinned versions are authoritative.
If the repository uses a different version, including a newer version:

- show the version difference
- explain that alignment may upgrade or downgrade the dependency
- ask for approval

**Never silently upgrade or downgrade a dependency.**

### `prepare`

The canonical:

```json
"prepare": "husky"
```

is part of the canonical toolchain scripts and must be handled through the same
`package.json` diff-and-ask flow. If the project already has a `prepare` doing
something else, append `&& husky` rather than overwriting — and show the diff.

### Cruft removal

Remove the following only if present and explicitly listed by
`templates/package-fragments.md`:

```text
eslint-plugin-prettier
eslint-plugin-import-helpers
i
install
npm
```

Do not remove unrelated dependencies or scripts.
Show the complete package.json diff and ask for approval before writing.

---

## 5. Husky

Ensure `husky` is included in the canonical toolchain `devDependencies`.

If `.husky/` does not exist:

1. Tell the user that Husky initialization is required.
2. Ask for approval before running:

```bash
npx husky init
```

3. Only run it after approval.
4. Show the resulting changes.
5. Ask before replacing hook files with canonical versions.

Husky v9 hook files should contain only the required command body.
Do not add the deprecated:

```bash
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"
```

header.

### Existing project-specific hook commands

If existing hooks contain project-specific commands not present in the canonical
template:

- identify them explicitly
- do not silently remove them
- show them separately in the diff
- ask whether they should be retained

Never discard project-specific hook behavior without approval.

---

## 6. Version stamp

After the approved configuration changes are applied, write:

```text
.toolchain-config.json
```

at the repository root.
Use the version from:

```text
templates/version.json
```

Example:

```json
{
  "version": "1.0.0",
  "appliedBy": "toolchain-config"
}
```

**Write it exactly like that — two-space indented, one key per line, trailing newline.**
`format:check` covers `*.json` at the repo root, so a compact one-liner makes the project
fail the very format gate this skill just installed.

Do not add timestamps or generated values that cause unnecessary file churn.
Only update the version stamp after the approved toolchain changes have actually
been applied.

---

## 7. Dependency installation

Do not automatically run:

```bash
npm install
npm ci
```

or other dependency installation commands.

If dependency changes require installation before verification:

- tell the user
- explain why
- ask for approval before running the install

Do not assume authentication, registry access, or private package credentials
are available.

---

## 8. Verify — never claim success without real output

After approved changes:

Choose an existing representative `.ts` source file that is covered by the
canonical ESLint configuration.
Prefer a normal application/service/controller file over:

- generated files
- migrations
- configuration files
- unrelated test fixtures

Run:

```bash
npx eslint <representative source file>
npx prettier --check <representative source file>
npm run typecheck        # tsc --noEmit -p tsconfig.eslint.json
```

The `tsc` check is mandatory and must report zero errors.

**Use `tsconfig.eslint.json`, not `tsconfig.json`.** `tsconfig.json` excludes
`**/*.spec.ts` because specs are not part of the build, so
`tsc --noEmit -p tsconfig.json` checks zero test files and still reports success —
a green gate over an unchecked surface. `tsconfig.eslint.json` covers `src/` and
`test/`, which is what 04 A2 means.
If dependency changes require installation first, stop and report that verification
is blocked until dependencies are installed.

### Important

Toolchain unification must **not modify application source code** to satisfy newly
enabled lint or formatting rules.

If ESLint or Prettier exposes existing source-code violations:

- report them
- do not automatically fix them
- do not modify application source files
- only fix source-code violations if the user explicitly requests it

If `TS2612` or `TS2729` appears after the target change, verify
`useDefineForClassFields` first.
Do not fix configuration-related TypeScript errors by changing application code.

---

## 9. Summary

At the end, report:

- files changed
- files skipped/rejected
- project-specific configuration preserved
- dependencies added/updated/removed
- cruft removed
- Husky changes
- verification commands and their real results
- current git branch
- whether the working tree was already dirty
- canonical toolchain version
- project stamped version

Remind the user that propagation is **pull-based**:

> Other repositories will not update automatically. Re-run this skill on each
> repository that needs to be aligned.

---

# The ratchet

The `no-unsafe-*` family ships as `warn` so a not-yet-fully-typed project can
continue building.
To tighten a cleaned module back to `error` without fixing the whole repository,
add a folder-scoped override at the END of `eslint.config.mjs`.
Last matching configuration wins:

```js
{
  files: ['src/modules/<module>/**/*.ts'],
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
  },
},
```

Only recommend this when the relevant module has been sufficiently cleaned and
typed.

## The other direction — rules that ship as `error`

Not everything is a ratchet. Rules backing a **MUST** in `01` or `02` ship as `error`,
because a `warn` does not enforce a MUST and `lint` carries no `--max-warnings 0`
(which would defeat the ratchet above):

| Rule                                                                             | Backs                                               |
| -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `no-console`                                                                     | `02` §2.5 — stdout is outside the audited log store |
| `no-restricted-syntax` — `any`/inline-literal on `@Body()`/`@Query()`/`@Param()` | `01` §5 — bypasses validation entirely              |
| `no-restricted-syntax` — interpolation or `+` inside query-builder calls         | `01` §7 — SQL injection                             |
| `no-debugger`, `import/no-cycle`, `no-floating-promises`                         | correctness                                         |

Adopting these in a legacy repo can surface a lot at once. **That is a report, not a
fix** (step 8) — do not edit application source to clear them. If the volume blocks
adoption, scope a rule down to new code with a folder override and widen it as modules
are cleaned, exactly as with the `no-unsafe-*` ratchet. Deleting the rule is not the
answer; it is the only mechanical check standing behind those MUSTs.

---

# Out of scope

Do **not** enable as part of toolchain unification:

```text
strict
strictNullChecks
```

Turning them on is a large, deliberate typing initiative, not a configuration
sweep.
If requested, treat strictness adoption as a separate initiative and do not
include it in the normal toolchain-config operation.
