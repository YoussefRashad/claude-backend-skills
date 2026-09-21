# Development rules

What a change to this repository must carry. Inferred from the existing conventions,
`README.md` § "Versioning these skills", and `.github/CODEOWNERS`.

## The one that is easiest to forget

**Any change under `*/templates/` or `*/references/` MUST bump that skill's
`templates/version.json`.**

Propagation is pull-based (`ADR-002`): nothing is pushed to a project, so the stamp is
the only way anyone can tell a stale project from a current one. A stamp that does not
move is worse than none — it asserts currency that was never checked.

`npm run check:versions` enforces it; CI runs it with `BASE_REF` on every PR.

| Bump      | When                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Major** | A re-syncing project would have to change code, or could break: a renamed export, a compiler option that alters emit, a rule promoted to `error` |
| **Minor** | Additive: a new template, a new section, a new optional rule                                                                                     |
| **Patch** | Wording, typos, a clarified comment with no behavioural change                                                                                   |

## Before pushing

```bash
npm run check    # format:check + version stamps
```

Templates **MUST** be prettier-clean against the canonical `.prettierrc` (which is a copy
of `toolchain-config/templates/prettierrc.json` — keep them identical). An unformatted
template means every new project starts with a failing `format:check`, and the person who
hits it has no idea why.

## Scope

- **No unrelated changes.** The repo's own `00` §3 rule applies to the repo itself: a
  mismatch you notice is information to report, not a defect to fix mid-change.
- **Do not bump the pinned devDependency versions** in `package-fragments.md` as a side
  effect. They are deliberately held behind current majors; moving them is its own
  validated initiative (`01` §16 takes the same position on any dependency change).
- Changes to `references/02`, `references/01`, `references/00`, `templates/src/`,
  `templates/ci/` and `toolchain-config/templates/` request code-owner review.

## Changing a rule

- **Rule strength is the change.** Promoting a SHOULD to a MUST, or a lint rule from
  `warn` to `error`, propagates into every service. Say so in the PR; it is a major bump.
- A new rule states the failure it prevents. A rule nobody can motivate gets ignored, and
  a standard that is partly ignored is worse than a shorter one that is followed.
- A rule that can be checked mechanically **SHOULD** move to lint or CI — `04` Part A says
  that is the direction of travel. If you add one, add it to the `04` table too.

## Changing a source template

- It must still compile and lint clean under the canonical config. **Verify, do not
  assume** — the structural rules (`simple-import-sort`, `no-restricted-syntax`,
  `import/first`) are easy to trip. See `working-notes.md` for how; it cannot be checked
  in this repo.
- If it carries a spec, update the spec in the same change.
- **Never weaken a guard, lock, HMAC check or allowlist** as part of unrelated work.
- Prefer adding the reason to the file's comment over adding it to a reference document.
  The comment travels with the code; the document does not.

## Claims about verification

State the **scope and date**, and what you actually ran. "Validated" on its own is the
failure this repo keeps correcting: the 1.2.0 templates were described as validated
end-to-end while nothing in that run ever started the process, which is how a boot-time
crash shipped. If you did not boot it, say you did not boot it.

## Never

- Never write a secret, credential or real token into any file here, including an example.
- Never relax a **MUST** in `references/02` (`00` §2 — the security floor is one-way).
- Never add a second copy of a config the other skill already owns (`ADR-001`).
- Never commit without the stamp bump the change requires.
