# package.json fragments to merge

Merge these into the target project's `package.json`. **Merge, do not replace** the
whole file — preserve every unrelated script, dependency, and field the project has.

## scripts (add/overwrite ONLY these keys)

```json
{
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "typecheck": "tsc --noEmit -p tsconfig.eslint.json",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "format:watch": "prettier --watch .",
  "lint-staged": "lint-staged",
  "prepare": "husky",
  "scan": "node scripts/security-scan.mjs all",
  "scan:sast": "node scripts/security-scan.mjs sast",
  "scan:deps": "node scripts/security-scan.mjs deps",
  "scan:secrets": "node scripts/security-scan.mjs secrets"
}
```

Notes:

- **`typecheck` targets `tsconfig.eslint.json`, not `tsconfig.json`.** `tsconfig.json`
  excludes `**/*.spec.ts` because specs are not part of the build — so
  `tsc --noEmit -p tsconfig.json` type-checks zero test files while still reporting a
  passing gate. `tsconfig.eslint.json` includes `src/**/*.ts` and `test/**/*.ts`, which
  is what 04 A2 actually means by "type check".
- If the project already has a `prepare` doing something else, append `&& husky`
  instead of overwriting.
- Remove any stale toolchain scripts the canonical replaces: `lint:check` (was a
  mislabelled prettier call — now `format:check`), a `prettier` watch script (now
  `format:watch`), and `initialize:husky` (redundant with `prepare`).
- `lint` deliberately has **no `--max-warnings 0`**. The `no-unsafe-*` family ships as
  `warn` on purpose so a not-yet-fully-typed project still builds (see "the ratchet" in
  SKILL.md); capping warnings at zero would defeat that. Rules that back a **MUST** —
  `no-console`, the `no-restricted-syntax` set — are `error` instead, so they block
  without taking the ratchet down with them.
- The `scan*` scripts require the companion runner `scripts/security-scan.mjs`
  (template: `scripts/security-scan.mjs`, see the mapping table in SKILL.md) and a
  working **Docker** install. They run semgrep / osv-scanner / trufflehog in
  containers and mount only `src/`, `package-lock.json` and `.git/` — never `env/`,
  `cert/`, or `*.pem`. They exit **non-zero on findings by default**, which is what
  lets 04 A4/A5 be real gates; pass `-- --no-strict` for an exploratory local run.
  If the target repo cannot use Docker, skip these four keys and the runner file
  (diff-and-ask like any other change) and wire the CI jobs instead.

## lint-staged (top-level key)

```json
{
  "lint-staged": {
    "*.{ts,js}": ["eslint --fix", "prettier --write"],
    "*.{json,md}": "prettier --write"
  }
}
```

Do NOT include the deprecated `git add` step — lint-staged v10+ stages
automatically.

## devDependencies (add/upgrade ONLY these keys)

```json
{
  "@eslint/js": "^9.39.5",
  "eslint": "^9.25.1",
  "eslint-config-prettier": "^10.1.2",
  "eslint-import-resolver-typescript": "^4.4.4",
  "eslint-plugin-import": "^2.31.0",
  "eslint-plugin-security": "^3.0.1",
  "eslint-plugin-simple-import-sort": "^12.1.1",
  "eslint-plugin-sonarjs": "^3.0.7",
  "eslint-plugin-unused-imports": "^4.4.1",
  "globals": "^17.9.0",
  "husky": "^9.1.7",
  "lint-staged": "^15.5.2",
  "prettier": "^3.5.3",
  "typescript": "^5.8.3",
  "typescript-eslint": "^8.59.4"
}
```

### Dependency currency — read before syncing a repo

These pins are **deliberately held**, not merely old. As of the `lastVerified` date in
`templates/version.json`, seven of them are one or more majors behind the registry:

| Package                            | Pinned | Latest seen | Why held                                                                                                       |
| ---------------------------------- | ------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `eslint` / `@eslint/js`            | `^9`   | `10.x`      | Flat-config behaviour changes; needs a validated pass across the fleet                                         |
| `typescript`                       | `^5.8` | `7.x`       | TS 7 is the native port. Decorator-metadata emit is load-bearing here (see SKILL.md); it is not a config sweep |
| `lint-staged`                      | `^15`  | `17.x`      | Config-format changes between majors                                                                           |
| `eslint-plugin-sonarjs`            | `^3`   | `4.x`       | Rule set changed; would move the cognitive-complexity baseline                                                 |
| `eslint-plugin-simple-import-sort` | `^12`  | `14.x`      | Grouping semantics; would reorder imports fleet-wide in one commit                                             |
| `eslint-plugin-security`           | `^3`   | `4.x`       | Rule renames; the ratchet list would need re-checking                                                          |

**Upgrading these is a deliberate initiative, not a toolchain sweep** — the same
position `01` §16 takes on any dependency change, and the same one SKILL.md takes on
`strict`. Do it in its own branch, against a real service, with `npm run lint`,
`npm run typecheck`, `npm test` and `npm run build` all green before the pins move
here. Re-check currency with:

```bash
npm outdated
```

## Cruft to REMOVE if present (accidental installs / superseded)

- `eslint-plugin-prettier` — Prettier runs standalone now (kept only
  `eslint-config-prettier`). Remove the dep, its import, and the
  `'prettier/prettier'` rule from the flat config.
- `eslint-plugin-import-helpers` — superseded by `eslint-plugin-simple-import-sort`.
- `i`, `install`, `npm` — junk packages from `npm i install` typos; never imported.

## Files retired from the canonical set

- `tsconfig.test.json` — never referenced by any script or tool, and its `include`
  covered only spec files, so it could not type-check anything they imported. The
  `typecheck` script uses `tsconfig.eslint.json` instead. If a project has this file
  and nothing references it, it may be deleted — diff-and-ask like any other change.
