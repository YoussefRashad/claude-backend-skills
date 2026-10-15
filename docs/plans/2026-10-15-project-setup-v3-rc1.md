<!--
FROZEN 2026-10-15 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Implements docs/design/project-setup-v3.md part A and the rc.1 items (frozen at 54ad312),
with the maintainer's implementation decisions Q1-Q7 and DQ1 (design commits ced3a58, 98e8601).
Drafted by the plan lane (Codex, 3 revisions); plan-critique (Claude) round 3 found no BLOCKING gap.
-->

# project-setup 3.0.0-rc.1 architecture and scope plan

## 1. Scope and out-of-scope

Implement the frozen rc.1 scope in `docs/design/project-setup-v3.md`, including the maintainer's
implementation decisions and corrected archive command at commit `98e8601`.

Repository: `D:/ContactRepos/claude-backend-skills`.
Branch: `feat/project-setup-v3-rc1`.
Observed HEAD: `98e8601`.
Original design freeze: `54ad312`.

In scope:

- A1: policy anchors, shared grammar, rendering, migration and relative-deny warnings.
- A2: Claude raw-Git guard, settings merge and documented parser limitations.
- A3: trusted-checkout review, commit-object commands, safe arguments and bounded output.
- A4: allow-rule classification and explicitly approved retirement of v2 managed allows.
- A5: agent restrictions, launcher prerequisite documentation and doctor checks.
- A6: project policy, ownership schemas, migration, synchronized rendering and installed baselines.
- N5: review-diff, literal path selection, local changes and safe orchestrator artifacts.
- N6: automatic template resolution and script-only template handling.
- N8: Node hooks, self-test, validation and doctor diagnostics applicable to rc.1.
- B5/B6 subset moved by R2-2: persistent omissions and manifest-only transactions.
- Q1-Q7, including manifest schema 3 and the corrected scripted release procedure.
- Regression coverage, genuine v2-installed fixtures, migration data and release documentation.

Out of scope:

- All remaining DRAFT work, including general B5 missing-entry validation and B6 integrity,
  managed-block keep/adopt/replace behavior and associated migration.
- D3, N1-N4, N7, N8's pre-push work and remaining rc.2/rc.3 backlog.
- Execution of all TO VERIFY host measurements. Document their procedures and pending status;
  they block final `3.0.0`, not rc.1 implementation acceptance.
- The external lane launcher. Document and audit its prerequisites; do not implement it here.
- Out-of-tree git-safe installation, Codex project hooks and user-level configuration writes.
- Application changes, dependency upgrades, CI changes and unrelated repository cleanup.
- Publishing or broadly deploying the candidate before the remaining release gates.

The recorded v2 baseline is 59 PASS / 0 FAIL / 1 SKIP. R13d was skipped because Windows
file-symlink privilege was unavailable. This read-only lane did not rerun the suite.

The historical v2 archive is not rebuilt. The maintainer verified that its 53 files match
`project-setup/` at tag `project-setup-v2.0.0` byte for byte:

```text
Commit: 13566046529bf51fb8fb6d0c83f79c03e1b90eaa
Tree:   4d032fb8fd7023aef233e94f59c0827f24a7a91a
SHA256: 97185CE84C28F0D9D32E4766B2579E47811980D0B38736C24C4F42A7F1127CE8
```

This lane made no file changes, ran no write-producing tests, and used no MCP server, connector,
app or network service.

## 2. Components

Paths in this section are relative to `project-setup/`. New filenames are proposed implementation
boundaries. Each component lands with its focused assertions and documentation.

Landing sequence:

```text
C11a -> C1 -> C2 -> C3 -> C4 -> C5 -> C6 -> C7 -> C8 -> C9 -> C10 -> C11b
```

C11a establishes baseline data and test infrastructure. C11b gates complete integration.
Component acceptance does not claim that assertions belonging to later consumers have passed.

### C1. Shared policy grammar, matcher and version contract

Purpose: provide one policy implementation for source scripts and installed tools.

Design: A1, A3, A6 and migration compatibility.

Existing files:

```text
scripts/globs.mjs
scripts/lib.mjs
scripts/schemas.mjs
tests/run-tests.mjs
```

New files:

```text
assets/tools/security-policy.mjs
tests/fixtures/security-policy-corpus.json
```

Use the asset module from source scripts and install the same module beside git-safe as
`.ai/tools/security-policy.mjs`. Do not maintain a second matcher.

Contracts:

- Policy schema 1 is legacy input. New consumers adapt it in memory: `**/` entries get
  `anchor: any`; other relative entries get `anchor: root`.
- Preserve fields and validate the adapted grammar. The adapter does not write policy, restore
  entries or migrate ownership.
- Policy schema 2 uses explicit anchors and strict validation.
- Unknown schemas, malformed policies and unsupported grammar fail closed.
- Manifest schema 3 is separate from policy schema 2.
- Structural path validation, case-insensitive matching and exact-case Git lookup are separate.
- Deduplicate effective matching by anchor and normalized glob without discarding source metadata.

Keep generic write-allowlist semantics separate from policy anchors. Preserve conservative
overlap handling for user permission exceptions.

Dependencies: C11a.
Landing position: first production component.

### C2. Ownership, approvals, metadata operations and draft diffs

Purpose: make metadata changes and draft review explicit parts of the existing transaction.

Design: A6 ownership; B5/B6 rc.1 subset; Q1, Q2, Q6.

Existing files:

```text
scripts/schemas.mjs
scripts/apply.mjs
scripts/lib.mjs
references/state-and-apply.md
tests/run-tests.mjs
```

New file:

```text
scripts/ownership.mjs
```

Use shared file-specific ownership schemas:

- Policy metadata records complete managed entries.
- Permission metadata records managed strings within specific arrays.
- Hook identity is event, matcher and command.
- Preserve unrelated fields, user order and hook options.

Write manifest schema 3. Accept a structurally valid schema-2 manifest as migration input.
Current detect and validate report it as "needs update", not as a schema failure. Invalid legacy
data still reports its actual validation failures. Unknown manifest schemas fail explicitly.

Preserve existing block hashes and unrelated records. Do not introduce deferred manifest integrity
or managed-block adoption.

An omission identifies an exact anchor/glob entry using the shared case-normalization rule.
Replacement or broader coverage requires a separate decision. Record the approved installed
managed list and store omissions separately.

Represent content and metadata operations separately. Metadata operations can require
`--approve-user-content` for an affected file whose bytes remain unchanged.

Therefore:

- An unchanged policy can receive approved ownership/schema migration.
- A deny omission can require settings approval without a settings write.
- An unchanged content operation does not bypass approved metadata refresh.
- Unrelated or blanket approvals remain rejected.
- A genuine no-op changes neither files nor manifest.

Content and metadata operations share one prepared plan, one commit and one journal.
A metadata-only run uses the same mechanism without dummy content edits.

Add:

```text
apply.mjs diff --project <root> --run-id <id>
```

This operation renders target-versus-draft diffs in-process and performs no Git invocation,
including root discovery.

Address the existing call sites explicitly:

- Dispatch the diff operation before `apply.mjs:42` calls `repoRoot()`.
- Bypass `lib.mjs:68-70`, where `repoRoot()` invokes `git rev-parse`.
- Establish a filesystem-validated explicit root context before using secure path helpers.
- Prevent `secureDir()` at `lib.mjs:216` from falling back to `repoRoot()` for this operation.

Do not weaken containment or link checks. The diff operation is read-only: no lock heartbeat,
journal initialization or directory creation.

Reject secret targets and unsafe paths before reading content. Never render vault content as
a textual diff; use names/classifications reports.

Drafts can be previewed before approval. Once prepared, identify the plan being reviewed and
reject changed inputs instead of presenting stale approval evidence. Replace raw draft-diff
instructions in prepare output and workflow documentation.

Dependencies: C1.
Landing position: second.

### C3. Policy migration and synchronized controls

Purpose: preserve project decisions and prevent policy/reader version skew.

Design: A1, A6, Q2, Q4; A4 migration support.

Existing files:

```text
data/secret-paths.json
scripts/lib.mjs
scripts/detect.mjs
scripts/render-permissions.mjs
scripts/merge-claude-settings.mjs
scripts/apply.mjs
scripts/secret-scan.mjs
scripts/validate.mjs
tests/run-tests.mjs
```

New files:

```text
scripts/migrate-security-paths.mjs
tests/fixtures/rc1-migrations.json
```

Consume the byte-preserved v2 policy data supplied by C11a.

Baseline identity comes from the installed manifest's
`files['.ai/security-paths.json'].sha256`, compared with the shipped v2 policy's normalized hash.
It does not come from hashing the current policy and assuming ownership.

If that entry is missing, malformed or unrecognized, treat baseline identity as unknown:
every current entry is modified and requires an explicit decision.

Classify current entries against the recognized installed baseline. Preserve other entry and
file fields. A changed glob is deletion plus addition. Move project additions into
`projectPatterns` only through the required approval.

Replace the two environment patterns with `**/.env*`; add `**/*.cert` and `**/.htpasswd`.
Show new/replacing coverage explicitly. An old omission neither suppresses replacement coverage
nor authorizes restoring coverage automatically.

Prepare computes one migrated effective snapshot. Bind policy, decisions, omissions, ownership,
rendered outputs and every consulted file hash. Commit uses the approved outputs without
independent re-rendering.

Version-skew gate:

- Treat installed `.ai/tools/*` runtime assets as one versioned update unit.
- Before accepting policy schema 2, require every in-project consumer and helper to be the
  reviewed v3 version already, or become that version in the same plan.
- Verify actual files against reviewed/recorded hashes; version labels alone are insufficient.
- Declining replacement of edited git-safe or a shared module rejects the coupled migration.
- Bind unchanged consumers as preconditions.
- Write compatible readers/helpers before policy changes; write the manifest last.

New readers support schema 1 through C1's validated, non-writing adapter.

Deny ownership belongs to this component:

- Identical pre-existing user denies stay user-owned and are reported as "already covered".
- Do not adopt user `Read(/env/**)` or `Read(/cert/**)` entries.
- Preserve retired v2 managed deny entries during policy migration, including old environment
  denies and entries associated with omissions.
- Preserve their ownership unless dropping it is explicitly approved.
- Dropping ownership leaves existing settings bytes intact.
- Do not derive removal of rules or ownership from the new renderer's desired list.

Record the installed managed pattern list and last rendered Codex snippet hash. Support
validation of managed edits, older installed baselines, project additions and stale snippets.

Under Q4, secret-scan continues inspecting protected paths. Effective policy labels those
findings; it does not filter scanner inputs or discard findings. Preserve redaction.

Dependencies: C1, C2.
Landing position: third. Complete parity waits for C4/C5/C9 and C11b.

### C4. Git object commands and bounded argument builders

Purpose: inspect reviewed commits without checking them out.

Design: A3 and A1/A6 policy consumption.

Existing files:

```text
assets/tools/git-safe.mjs
references/security.md
tests/run-tests.mjs
```

New files:

```text
assets/tools/git-safe-core.mjs
tests/fixtures/git-safe-cases.json
```

Add `cat`, `ls` and `grep`; retain supported `diff`, `log` and `show` behavior.

All six consume the effective anchored policy. Apply the 1 MiB whole-result limit to log/show
too, replacing their inherited-stdio streaming path.

Use subcommand-specific builders:

- Resolve revisions before content operations.
- Use `cat-file blob`, `-e` for grep patterns and path separators where supported.
- Reject unsafe options, object-form arguments and malformed policy.
- Preserve Git environment sanitization.
- Disable textconv and external diff.
- Parse path listings as NUL-delimited records.
- Preserve exact-case lookup after case-insensitive secret checks.
- Distinguish grep no-match from Git failure.

Bound the complete result before emission. Exactly 1,048,576 bytes passes; larger output fails
without partial content.

Errors explain how to narrow: `-- <paths>`, attached `-n<k>` for log, or smaller commit ranges.
A refused result is not a completed review.

Dependencies: C1 and C2/C3 policy/tool-unit contracts.
Landing position: fourth.

### C5. Review-diff and artifact lifecycle

Purpose: provide one sanctioned review interface and safe orchestrator output.

Design: A3, N5, R2-3.

Existing files:

```text
assets/tools/git-safe.mjs
scripts/lib.mjs
scripts/apply.mjs
references/security.md
tests/run-tests.mjs
tests/live/LIVE-ACCEPTANCE.md
```

New internal file:

```text
assets/tools/review-diff.mjs
```

The only public interface is:

```text
node .ai/tools/git-safe.mjs review-diff --base <ref> [--head <ref>]
```

It also accepts `--out <file>` and `-- <paths>...`. Helpers are internal, full-owned files in the
versioned tool unit; document no separate executable interface.

Committed-head mode compares merge-base to resolved head, excluding trusted-checkout changes.
Local-worktree mode includes staged, unstaged and untracked non-ignored changes without modifying
the index.

Use literal selection consistently for tracked and untracked files. Refuse a secret selector and
exclude secret descendants beneath selected directories.

Stdout is the default. Reviewers never use `--out`; the orchestrator creates and passes artifacts.

Before artifact output:

- Reserve the canonical run ID `review` against every setup lock/apply lifecycle operation.
- Canonicalize for this reserved-name comparison by stripping trailing dots/spaces and
  case-folding. Reject `review`, `REVIEW`, mixed-case variants and `review.` on every platform.
- Keep ordinary run-ID syntax validation; do not normalize an otherwise invalid ID into acceptance.
- Safely establish `.ai/.run/.gitignore` before writing an artifact.
- Confine output to `.ai/.run/review/`.
- Use exclusive creation and Windows-safe names.
- Reject linked ancestors/leaves and escapes.

Cleanup must reject reserved aliases before accessing or deleting the artifact directory.

Dependencies: C4 and C2 path-safety integration.
Landing position: fifth.

### C6. Raw-Git hook, merge and self-test

Purpose: block specified raw-history commands while preserving unrelated orchestrator commands.

Design: A2, A6 hook ownership, N8.

Existing files:

```text
scripts/merge-claude-settings.mjs
scripts/apply.mjs
scripts/validate.mjs
references/claude.md
README.md
tests/run-tests.mjs
```

New files:

```text
assets/tools/guard-raw-git.mjs
assets/tools/hooks-selftest.mjs
tests/fixtures/guard-raw-git-cases.json
```

Implement the frozen blocked list and parser behavior: executable paths, separators,
substitutions, PowerShell backticks, recognized options, standalone patch arguments and alias
overrides.

Merge one managed hook by event/matcher/command. Preserve user hooks, options and order.
Managed additions do not authorize replacement of user content.

Retain the root-anchored quoted candidate command and mark host portability TO VERIFY.
Malformed input exits 1 with the exact frozen stderr message.

Self-test known allowed, blocked and malformed cases. Validate fails when the installed
self-test fails. Do not exempt raw draft diffs; setup uses C2.

C6 owns hook portions of R52/R79, not the deny-ownership portions implemented by C3.

Dependencies: C2 ownership/diff support, C3 settings snapshot, C4 sanctioned command.
Landing position: sixth.

### C7. Allow classification and retirement

Purpose: report shared execution permissions and retire only approved managed allows.

Design: A4 and B5/B6 omission subset.

Existing files:

```text
scripts/detect.mjs
scripts/validate.mjs
scripts/merge-claude-settings.mjs
scripts/apply.mjs
references/claude.md
references/state-and-apply.md
tests/run-tests.mjs
```

New file:

```text
scripts/classify-allows.mjs
```

Share classification between detect, validate and merge. Apply the frozen managed/user severity
distinction for repository-code execution, broad permissions and other rules.

Warnings name the rule and remedy: move it to personal settings if the developer accepts the
risk. Include the required `settings.local.json` info line; do not manage that file.

List every v2 managed allow from installed metadata. Preserve unapproved entries and ownership.
Approved retirement updates settings and omissions together. Already absent entries use explicit
metadata operations.

Propose no new managed allows. Consume C3's deny-ownership behavior without reimplementing it.

C7 owns allow-retirement portions of R85 and allow-reconciliation portions of R86.
C3 owns the retained-deny assertions.

Dependencies: C2, C3.
Landing position: seventh.

### C8. Trusted-review instructions and customization migration

Purpose: preserve project instructions and make the trusted-checkout boundary actionable.

Design: A3, A5, N5; Q1 and Q6 documentation.

Existing files:

```text
assets/agents/reviewer.md
assets/agents/docs-sync.md
assets/wrappers/codex-reviewer.toml
assets/wrappers/codex-docs_sync.toml
SKILL.md
README.md
references/security.md
references/codex.md
references/modes.md
tests/run-tests.mjs
tests/live/make-fixture.mjs
tests/live/LIVE-ACCEPTANCE.md
evals/evals.json
```

New file:

```text
references/migration-v2.md
```

Require resolved base/head IDs, review mode and the conditional self-review warning.
Use object commands for code at a different commit. Prohibit reviewer checkout, switch, PR
checkout and worktree creation. Docs-sync remains on the user's trusted branch.

Add no-connector/no-fallback rules to both canonical agents and both Codex wrappers.
Preserve Claude wrappers' built-in tool restrictions.

Runtime migration compares installed files with the v2 snapshots shipped under `data/`.
It never requires the distribution repository, its tag or its Git history.

The installed v2 reviewer was rendered and only its hash was recorded. Do not claim that
customizations can be separated mechanically.

Compare against `data/v2.0.0/assets/agents/reviewer.md`. Account for every non-template line:
move approved project text to `.ai/agents/reviewer.project.md`, or list it for an explicit
decision. Include inline edits, substitutions and changes within template sections, not just
appended section 6.

Use the shipped docs-sync and wrapper baselines when reviewing their replacements. Preserve
existing project-file content and user-added Codex settings, including `default_permissions`.
Edited full files still require approval.

Assign these static documentation obligations to C8:

- The exact A3 team-policy sentence about reviewing others' branches from the base branch or
  GitHub and never starting an agent session on their branch.
- The A2/A3 warning that an untrusted checkout controls hooks and instructions.
- The A6 note that excluded files such as `.envrc` may contain code needing human review.
- The copied-secret-content limit, shell-parser gaps and launcher isolation prerequisite.
- Q6 text in `references/migration-v2.md`: schema 3, paired skill/project upgrade, v2 validation
  rejection, and the absence of a retrofitted pre-write guard in old commands.
- Narrowing guidance in both canonical agents and `references/security.md`: use `-- <paths>`,
  attached `-n<k>` for log, or smaller ranges after whole-result refusal. Record remaining scope;
  do not treat one narrowed subset as the entire review.

Assert this text under `A5-templates`. Replace raw draft-diff instructions with C2's command.
Replace Phase 0 raw-diff guidance with safe names-only inventory or git-safe where policy exists.

Dependencies: C11a shipped snapshots, C2, C4/C5, C6 and C7 messaging.
Landing position: eighth.

### C9. Template resolution and command hygiene

Purpose: implement the script-only template flow without emitted commands containing `.env`.

Design: N6, A6 environment coverage, Q3.

Existing files:

```text
scripts/env-keys.mjs
scripts/lib.mjs
scripts/apply.mjs
SKILL.md
assets/templates/AGENTS.md
assets/agents/reviewer.md
assets/agents/docs-sync.md
references/docs-generation.md
references/security.md
references/state-and-apply.md
references/report.md
tests/run-tests.mjs
evals/evals.json
```

Implement `--template auto` for the permitted template only. Reject other environment-file inputs.
A missing template produces a manual step without creating or inspecting alternatives.

Preserve existing values without printing them. Report that the template contains values and
must be reduced to key names manually. Do not erase or automatically normalize values.

Keep the reviewed vault/apply flow and names/classifications-only reports. This exception does
not grant agents direct access or authorize arbitrary scripts.

Scan emitted commands, usage and recovery text under R67. Explanatory prose may name files.
Do not alter user-level denies.

Dependencies: C1/C3 policy input and C2 vault/approval integration.
Landing position: ninth.

### C10. Doctor and validation

Purpose: report control state and audit lane prerequisites without starting a model or probe.

Design: A1/A4/A6 validation, A5/N8 doctor, Q7.

Existing files:

```text
scripts/validate.mjs
scripts/detect.mjs
scripts/schemas.mjs
SKILL.md
references/report.md
references/security.md
tests/run-tests.mjs
```

New files:

```text
scripts/doctor.mjs
tests/fixtures/doctor-cases.json
```

Doctor runs the fixed operation `codex mcp list --json` with the effective lane options.
Parse caller input into an allowlisted argument vector:

- `--disable apps`.
- `--disable plugins`.
- `-c mcp_servers.<name>.enabled=false`, with a validated server identifier.
- Profile options and directory options, with validated values.

Accept documented profile/directory forms only. Restrict server names to simple identifiers
that cannot introduce TOML paths or assignments. Reject every other option, override, positional
command, control character or malformed option/value pair. Do not forward arbitrary CLI input.

Preserve the supplied effective directory/profile. Do not substitute default-session settings.
The external launcher remains responsible for enumerating configured servers.

Spawn without shell interpretation:

- Use an absolute native executable directly where available.
- For a standard Windows npm `codex.cmd`, resolve the known local package entrypoint
  `node_modules/@openai/codex/bin/codex.js` and invoke it with absolute `process.execPath`.
- Pass the fixed operation and validated options as an argument array with `shell: false`.
- Never execute the `.cmd` through `cmd /c`, build shell text or evaluate arbitrary shim content.
- If a supported native/package entrypoint cannot be established, report not ready.

Report server identifiers and disable coverage only. Enabled servers, CLI failures, malformed
output or unresolved effective configuration mean not ready.

Read the newest permitted sandbox log, as Q7 requires. Report the first setup-refresh error
when present; distinguish absent/unreadable logs from a clean measurement. The doctor never
runs a sandbox probe or starts a model session.

Check Windows Codex Desktop and `cua_node` processes, including tray-resident processes.
Never read auth or sandbox-secret files, kill processes or change sandbox mode.

Use synthetic CLI/process/log fixtures for automated acceptance. They verify doctor behavior,
not host negative capability.

Validation uses shared schemas, installed policy baselines, snippet hashes, the allow classifier
and installed hook self-test. A valid schema-2 manifest reports "needs update"; schema 3 receives
current checks. Keep static results separate from runtime evidence.

Dependencies by branch:

- Policy/manifest validation: C1-C3.
- Hook validation: C6.
- Allow reporting: C7.
- Doctor: Q7 interface and C8 prerequisite text.
- No dependency on C9 template behavior.

Landing position: tenth; independent doctor work can be planned earlier.

### C11a. Shipped v2 baselines and test infrastructure

Purpose: supply offline runtime migration data and realistic test fixtures.

Existing files:

```text
tests/run-tests.mjs
tests/live/make-fixture.mjs
```

New runtime migration data:

```text
data/secret-paths-v2.0.0.json
data/v2.0.0/assets/agents/reviewer.md
data/v2.0.0/assets/agents/docs-sync.md
data/v2.0.0/assets/wrappers/claude-reviewer.md
data/v2.0.0/assets/wrappers/claude-docs-sync.md
data/v2.0.0/assets/wrappers/codex-reviewer.toml
data/v2.0.0/assets/wrappers/codex-docs_sync.toml
```

Each file is byte-identical to its corresponding source at `project-setup-v2.0.0`.
Do not substitute rendered project files, normalize the snapshot bytes or edit the snapshots.

New test files:

```text
tests/helpers/v2-baseline.mjs
tests/rc1-cases.mjs
tests/run-component-tests.mjs
tests/accept-rc1.mjs
```

During development/testing, verify the trusted local tag's recorded commit/tree identity.
Assert that every versioned v2 data file matches its tagged source bytes, including the policy
snapshot outside `data/v2.0.0/`. Maintain an exhaustive mapping; unmapped versioned data fails.

Runtime installation receives these snapshots through the existing `data` inclusion.
No runtime migration performs a tag lookup.

Generate v2-installed test projects by running the tagged version's actual lock, init, merge,
prepare and commit scripts against synthetic projects. Do not hand-author v2 manifests.

R77/R78/R85/R86 start with those installations, followed by controlled fixture edits.
Record provenance in fixture metadata.

Add live fixture kind `v2`, preserving fresh/v1 behavior. Missing baseline tags fail test-fixture
generation; never fetch automatically or treat absence as a skip.

Dependencies: none.
Landing position: before C1.

### C11b. Integration and candidate release

Purpose: verify the complete candidate, installed payload and reproducible archive.

Existing files:

```text
tests/run-tests.mjs
tests/live/LIVE-ACCEPTANCE.md
evals/evals.json
SKILL.md
README.md
CHANGELOG.md
VERSION
```

New files:

```text
install/release.mjs
RELEASE-NOTES-3.0.0-rc.1.md
```

Set `VERSION` to `3.0.0-rc.1`. Record actual automated evidence and pending host measurements.

Release procedure:

1. Resolve and record the release tag, commit and `project-setup/` tree ID.
2. Produce the ZIP with the corrected command:

   ```text
   git archive --format=zip <tag> project-setup/
   ```

3. Use the tag/commit as archive input. Do not use `<tag>:project-setup`, `--mtime` or `--prefix`.
4. Calculate the archive SHA256.
5. Generate hash-bearing publication notes outside `project-setup/`.
6. Attach the ZIP and use those notes for the later GitHub release.

The script accepts `--out <directory>` and rejects output inside the source `project-setup/`
tree. For the acceptance command below, publication notes live at:

```text
C:/Temp/ps-rc1-release/RELEASE-NOTES.md
```

Those notes contain tag, resolved commit, tree ID and archive SHA256. Their contents are also
used as the GitHub release body.

The in-tree `RELEASE-NOTES-3.0.0-rc.1.md` contains version, changes, verification and limitations.
It contains no resolved tree ID or archive hash. Do not insert post-build identity back into
the source being identified.

C11b owns Q6 release-notes text: schema 3, paired upgrade, v2 validation rejection and rollback
order. Assert its presence under S07 in both source and publication notes.

S07 also verifies that publication-note generation leaves the tagged tree ID and source
inventory/bytes unchanged.

Preserve v2 provenance; never rebuild or replace its historical archive. Publication is a later
authorized release action, not a network operation performed by this lane.

Use the existing installer inclusion and hashing process. Test all new runtime helpers and
migration data in installed copies. No inclusion-list change is required.

Dependencies: all production components.
Landing position: final.

## 3. Files touched overall

All paths below are relative to `project-setup/`.

Existing code and policy:

```text
assets/tools/git-safe.mjs
data/secret-paths.json
scripts/apply.mjs
scripts/detect.mjs
scripts/env-keys.mjs
scripts/globs.mjs
scripts/lib.mjs
scripts/merge-claude-settings.mjs
scripts/render-permissions.mjs
scripts/schemas.mjs
scripts/secret-scan.mjs
scripts/validate.mjs
```

New code:

```text
assets/tools/security-policy.mjs
assets/tools/git-safe-core.mjs
assets/tools/review-diff.mjs
assets/tools/guard-raw-git.mjs
assets/tools/hooks-selftest.mjs
scripts/ownership.mjs
scripts/migrate-security-paths.mjs
scripts/classify-allows.mjs
scripts/doctor.mjs
install/release.mjs
```

New migration data:

```text
data/secret-paths-v2.0.0.json
data/v2.0.0/assets/agents/reviewer.md
data/v2.0.0/assets/agents/docs-sync.md
data/v2.0.0/assets/wrappers/claude-reviewer.md
data/v2.0.0/assets/wrappers/claude-docs-sync.md
data/v2.0.0/assets/wrappers/codex-reviewer.toml
data/v2.0.0/assets/wrappers/codex-docs_sync.toml
```

Existing instructions and release documentation:

```text
assets/agents/reviewer.md
assets/agents/docs-sync.md
assets/wrappers/codex-reviewer.toml
assets/wrappers/codex-docs_sync.toml
assets/templates/AGENTS.md
references/claude.md
references/codex.md
references/docs-generation.md
references/modes.md
references/report.md
references/security.md
references/state-and-apply.md
SKILL.md
README.md
CHANGELOG.md
VERSION
```

New documentation:

```text
references/migration-v2.md
RELEASE-NOTES-3.0.0-rc.1.md
```

Existing tests:

```text
tests/run-tests.mjs
tests/live/make-fixture.mjs
tests/live/LIVE-ACCEPTANCE.md
evals/evals.json
```

New tests and fixtures:

```text
tests/helpers/v2-baseline.mjs
tests/rc1-cases.mjs
tests/run-component-tests.mjs
tests/accept-rc1.mjs
tests/fixtures/security-policy-corpus.json
tests/fixtures/rc1-migrations.json
tests/fixtures/git-safe-cases.json
tests/fixtures/guard-raw-git-cases.json
tests/fixtures/doctor-cases.json
```

Preserve the existing TOML corpus and baseline tests. Fixture content is synthetic.

Installed project changes:

- Policy, settings and manifest.
- The complete `.ai/tools/` runtime unit.
- Canonical agents, Codex wrappers and approved instruction blocks.
- Reviewer project customizations when present.
- The permitted template through the reviewed script flow.
- Run self-ignore and explicit orchestrator artifacts.

Installer and release requirements:

- `install/install.mjs` reads `VERSION` and includes `SKILL.md`, `VERSION`, `CHANGELOG.md`,
  `references`, `assets`, `data` and `scripts` recursively.
- New migration snapshots therefore ship without adding an inclusion entry.
- Source-tree hashes are calculated dynamically; there is no hardcoded installer digest to edit.
- Preserve generated `.installed.json`, backup digests, local-edit refusal and transactional
  multi-target installation/rollback.
- The release script, tests and publication notes are not installed payload.
- Keep `project-setup/` excluded from Prettier.
- Do not add `templates/version.json`; the repository stamp guard covers other skills.
- Distinguish installer hashes, archive SHA256 and backup snapshot digests.
- Preserve the historical v2 digest and provenance.
- Publication notes and ZIP output live outside the hashed source tree.

The orchestrator may save this plan at
`docs/plans/2026-10-15-project-setup-v3-rc1.md`. This lane does not create it.

## 4. Runnable acceptance criteria

### Baseline and final totals

The final suite contains 60 existing cases, 38 numbered rc.1 cases and two named cases.

Expected on the recorded Windows privilege configuration:

```text
99 PASS / 0 FAIL / 1 SKIP
SKIP: R13d only
```

Where R13d can run:

```text
100 PASS / 0 FAIL / 0 SKIP
```

No rc.1 case may skip. Missing tests and empty selections are failures.

Retain every existing case:

```text
R01 R02 R03a R03b R04a R04b R05 R06 R06b R07 R08 R09 R10 R11 R12
R13a R13b R13c R13d R14a R14b R15 R16 R17 R18 R19 R20 R21 R22
R23a R23b R24 R25 R26 R27a R27b R27c R27d R28 R29 R30 R31 R32
R33 R34 R35 R36 R37 R38 R39 R40
S01 S02 S03 S04 S05 S06 S07 S08 S09
```

Adapt intentional CLI changes without removing original protection assertions.
R29 is not evidence for the deferred B6 consent gate.

Required numbered rc.1 cases:

```text
R41 R42 R43 R44 R45 R46 R47 R48 R49 R50 R51 R52 R53 R54
R65 R66 R67 R68 R72 R73 R74 R75 R76 R77 R78 R79 R80 R81 R82
R84 R85 R86 R90 R91 R92 R93 R97 R100
```

Additional named cases:

```text
A5-templates
N8-doctor
```

Add revision assertions within these cases and existing baseline cases. Changing the top-level
inventory requires updating the expected totals explicitly.

### Strict acceptance commands

From the distribution repository root:

```powershell
node project-setup/tests/accept-rc1.mjs
npm run check
```

The strict gate must:

1. Run the full suite with retained evidence.
2. Require `^PASS  <escaped-id>  ` stdout records for every required case.
3. Permit only R13d to SKIP, with its privilege reason recorded.
4. Reject missing, duplicate, unexpected or contradictory result records.
5. Reject nonzero exit, any FAIL, other SKIPs and malformed/incomplete summary output.
6. Verify 100 results and the exact totals above.
7. Preserve suite output and its results path.

`npm run check` is supplemental; it does not test or format the excluded release tree.

Diagnostic selection remains available:

```powershell
node project-setup/tests/run-tests.mjs --only "R86 "
```

Its exit status alone is not acceptance. Focused acceptance uses:

```powershell
node project-setup/tests/accept-rc1.mjs --only R86
node project-setup/tests/accept-rc1.mjs --only R91
node project-setup/tests/accept-rc1.mjs --only R100
```

Each invocation requires the requested PASS record. The full gate remains mandatory.

### Component assertions and integration ownership

Expose assertion groups through `tests/rc1-cases.mjs`. Component runs print sub-assertion labels,
such as `R74/C1/matcher`, never a complete `PASS  R74  ` for partial coverage.

Commands:

```powershell
node project-setup/tests/run-component-tests.mjs --component C1
node project-setup/tests/run-component-tests.mjs --component C2
node project-setup/tests/run-component-tests.mjs --component C3
node project-setup/tests/run-component-tests.mjs --component C4
node project-setup/tests/run-component-tests.mjs --component C5
node project-setup/tests/run-component-tests.mjs --component C6
node project-setup/tests/run-component-tests.mjs --component C7
node project-setup/tests/run-component-tests.mjs --component C8
node project-setup/tests/run-component-tests.mjs --component C9
node project-setup/tests/run-component-tests.mjs --component C10
node project-setup/tests/run-component-tests.mjs --component C11a
```

The runner has an explicit expected assertion inventory. Missing groups, empty selections,
failures and skipped groups fail the component run.

Ownership below is exclusive at the sub-assertion level. Complete numbered cases are composed
and gated only by C11b.

| Component | Owned assertions |
| --- | --- |
| C1 | R45 grammar; R44/R74 matcher; R75 path validation; R78 legacy adapter |
| C1 | R97 matching of environment-name variants |
| C2 | R79 ownership schemas; R80 transaction binding; R86 metadata engine |
| C2 | R02/R15/R29 draft-diff and metadata-approval regressions |
| C3 | R44/R47/R74 rendering; R48 migration moves; R78 baseline/policy migration |
| C3 | R52/R78/R85 deny ownership, user duplicates and retained legacy denies |
| C3 | R80 snapshot/tool-version gate; R81/R82 recorded state; R97 rendered coverage |
| C3 | Q4 protected-path labels, without scanner input or finding exclusions |
| C4 | R41-R43; R75 Git lookup; R76 Git arguments/limits; R47/R74/R97 Git consumers |
| C5 | R65/R66; R90-R92; R100; review-diff portions of R74/R76/R97 |
| C6 | R50 parser; R51 process contract; R52 hook merge; R72 self-test; R84 |
| C6 | R79 hook identity/order/options |
| C7 | R53 classifier; R54 refusal; R85 allow retirement; R86 allow reconciliation |
| C8 | R77 agent/wrapper migration; R66/R90/R92 instructions; A5-templates |
| C9 | R67/R68/R93; R97 script-only template access |
| C10 | N8-doctor; R46/R49 validation; R53 reporting; R73 self-test integration |
| C10 | R79 schema use; R81/R82 validation; schema-2 "needs update" reporting |
| C11a | V2 snapshot byte parity and actual-v2 fixture construction |
| C11b | Full numbered cases, baseline suite, installed payload and release acceptance |

The R78 legacy adapter belongs to C1; baseline migration and deny ownership belong to C3.
R52 hook merge belongs to C6; duplicate-deny ownership belongs to C3.
R85 allow retirement belongs to C7; retained-deny ownership belongs to C3.

Specific integration obligations:

- R47 combines C3 rendering with C4 Git enforcement.
- R74 runs the shared corpus through matcher, renderers and all Git/review consumers.
- R97 combines environment-name matching, controls, Git filtering and N6's script-only exception.
- R80 combines transaction binding with one policy snapshot and real reader compatibility.
- R78/R80 test both version-skew directions, unknown baseline metadata and declined reader updates.
- R77 tests inline reviewer edits, customization collisions and shipped-baseline migration from
  installed copies with no distribution-repository history.
- R86 tests unchanged-file approvals and mixed content/metadata operations in one run.
- R91 runs Windows junction containment even without file-symlink privilege. Record unavailable
  optional symlink subcases without skipping R91. Failure to run junction coverage fails acceptance.
- R92 tests `review`, `REVIEW`, mixed case, `review.` and trailing-space aliases. Cleanup attempts
  must leave sentinel artifacts and self-ignore bytes unchanged.
- R76 covers policy and 1 MiB limits for log/show, plus narrowing diagnostics.
- A5-templates asserts narrowing guidance in both canonical agents and security references,
  required README text and Q6 migration documentation.
- N8-doctor tests argument rejection, supported Windows shim resolution, direct argument passing,
  newest-log reading, process checks and absence of model/probe launches.
- S07 verifies all runtime modules and baseline data are installed, and checks Q6 release notes,
  release identity, reproducibility and unchanged source state after publication-note generation.

For Q1's no-Git guarantee, R02 must use a platform-appropriate failing/recording Git shim first on
PATH. Prove the shim intercepts a control invocation, reset its record, then run apply diff using
absolute Node. Require successful expected diff output and zero Git invocations. Cover secure
directory traversal too, so a hidden `secureDir()` fallback cannot escape the assertion.

For v2 data, C11a performs byte comparisons against the local tag for every mapped snapshot.
R77 and S07 also prove installed snapshots are present and usable without tag access.

Focused baseline coverage includes:

```text
R01-R04, R05-R11, R13-R20, R24-R30, R33-R35, R38, S01-S07, S09
```

Ranges include lettered variants. All baseline tests remain the final gate.

### Host and deferred tests

Pending host measurements:

- R83 in full.
- R44/R74 host enforcement portions.
- R51 Claude continuation/stderr behavior; direct Node behavior is required now.
- A3 trusted-checkout live review and A5 negative-capability tests.

Deferred with DRAFT scope:

```text
R55-R58  remaining B5/B6
R59      D3
R60-R64  N1/N2/N3
R69-R71  N7
R87-R88  remaining B6
R89      N4
R94-R95  N7
R96      deferred B6 baseline investigation
R98-R99  N7
```

Do not register pending host cases as additional skipped rc.1 tests.

Live fixture preparation in an authorized writable lane:

```powershell
node project-setup/tests/live/make-fixture.mjs --kind v2 --out C:/Temp/ps-rc1-v2
```

Require an unused destination and verified local baseline tag. This is preflight, not host proof.

Release acceptance after the reviewed tag exists:

```powershell
node project-setup/install/release.mjs --tag project-setup-v3.0.0-rc.1 --out C:/Temp/ps-rc1-release
```

S07 must produce two archives at different times and require identical SHA256 values, verify
the `project-setup/` inventory, and verify publication notes match the resolved identity and ZIP.
Source bytes and the tagged subtree ID must remain unchanged after note generation.

## 5. Edge cases and failure modes

### C1. Policy

- Root/any-depth anchors, mixed case, wildcard boundaries and unsupported grammar.
- Schema-1 `env/**` maps to root rather than invalid default-any semantics.
- Unknown schema or malformed input never falls back to weaker policy.
- Duplicate matching entries retain metadata.
- Structural checks do not rewrite Git names.
- User exception overlap remains conservative.

### C2. Transactions and draft review

- Wrong metadata types and hook identity collisions.
- Approval required despite unchanged content; unrelated approvals still rejected.
- Metadata refresh cannot be skipped with an unchanged file operation.
- Exact omissions cannot broaden across replacements.
- Content and metadata share one manifest precondition and journal.
- Any approved input, including an unchanged consumer, can drift after prepare.
- Secret paths and vault content receive no textual diff.
- Root dispatch and secure-directory helpers make no Git calls during diff.
- Partial writes, corrupt backups, crashes and later user edits.
- Valid schema-2 input reports "needs update"; no silent block rebaselining.

### C3. Migration and controls

- Known manifest baseline versus missing/unknown metadata.
- Current bytes do not establish installed ownership.
- Changed glob is deletion plus addition.
- Replacement coverage overlapping an old omission needs a new decision.
- Old reader/new policy plans fail; new readers adapt old policy without writing.
- Declined edited helper replacement blocks the coupled update.
- Identical user denies remain user-owned.
- Retired managed denies retain bytes and ownership without approval.
- Older baseline is behind; managed edits are drift.
- Protected scanner findings remain scanned, retained, labeled and redacted.

### C4. Git

- Leading-dash arguments, object forms and non-commit revisions.
- Historical secrets, valid empty results and actual Git failures.
- NUL-delimited whitespace/newline/non-ASCII paths.
- Injected configuration, textconv and external diff.
- Byte limits for multibyte data and log/show as well as new commands.
- No partial content in failure diagnostics.
- Narrowing guidance does not imply a subset is a complete review.

### C5. Review artifacts

- Dirty trusted checkout excluded from committed-head review.
- Local changes included without index mutation.
- Literal selectors, secret selectors and secret descendants.
- Nonregular files, linked ancestors/leaves, junctions and external destinations.
- Existing artifact, collisions and output escape.
- Canonical reserved-name aliases rejected before setup cleanup touches artifacts.
- Self-ignore exists before writing; later reviews do not ingest earlier artifacts.
- Oversized output leaves no usable partial artifact.
- Copied secret content under allowed names remains outside path-policy detection.

### C6. Hook

- Complete blocked list and at least 40 parser cases.
- Quoted patch argument versus a message value.
- PowerShell escapes, substitutions, separators and executable paths.
- git-safe followed by a separate raw-Git command.
- Every stash form blocked; ordinary orchestrator commit/push/checkout preserved.
- Exact malformed-input process contract.
- Hook collisions and preservation of user options/order.
- No draft-diff exemption; host portability remains TO VERIFY.

### C7. Permissions

- Managed/user broad permissions and repository-code execution.
- Every warning includes rule and remedy.
- Personal settings receive information only.
- Already absent managed allows use metadata operations.
- Unapproved retirement preserves settings and ownership.
- Allow logic does not reclassify or delete C3's deny records.

### C8. Instructions and baseline data

- Resolved-head warning independent of dirty-state inclusion.
- Missing canonical instructions stop the agent.
- Installed migration works without source tags/history.
- Inline edits and rendered substitutions require explicit disposition.
- Existing customization files and wrapper additions survive update/rollback.
- Missing or altered baseline data fails rather than inventing a comparison.
- Agent guidance accounts for whole-result limits and remaining review scope.
- Configuration coverage is not host absence evidence.

### C9. Templates

- Missing permitted template, alternate names and invalid inputs.
- Existing values preserved, never printed and reported for manual cleanup.
- No automatic names-only conversion.
- Keys-file aliases resolving to protected paths.
- Emitted commands/usage/recovery text contain no `.env`.
- No direct agent access or user-level permission changes.

### C10. Doctor

- Unsupported options, configuration injection and malformed server/profile/directory values.
- Windows `.cmd` without a supported local package entrypoint.
- No shell-quoted caller arguments, model session or sandbox probe.
- Invalid/enabled server output and wrong effective lane context.
- Tray-resident Desktop processes and unavailable process inventory.
- Newest log selection, missing/unreadable logs and first setup-refresh error.
- No authentication-file access, process termination or sandbox fallback.
- Unknown readiness is not reported as verified.

### C11. Fixtures and release

- Missing/moved baseline tag fails development fixture generation.
- Every shipped v2 snapshot matches tagged bytes.
- Runtime migration does not depend on that tag being available.
- Missing tests and skips cannot satisfy acceptance.
- File-symlink privilege absence does not skip R91 junction coverage.
- New helpers and data must appear in both installed copies.
- V2 validation rejects schema 3; no retrofitted old-command write guard is claimed.
- Installer hash, archive hash and backup digest stay distinct.
- Archive input is the tag/commit, never the subtree object.
- In-tree notes contain no tree ID/archive hash.
- External notes leave source inventory, bytes and tagged subtree identity unchanged.

## 6. Migration and rollback

There is no database migration. Project updates use one setup transaction.

1. Install the reviewed rc.1 skill first.

   Use the existing installer preflight, verified staging, backup and transactional target switch.
   Preserve local-edit refusal and verified installer rollback.

   The installed copy includes the v2 policy, agents and wrapper snapshots under `data/`.
   Runtime migration needs no distribution-repository history.

2. Discover from a trusted checkout.

   Inventory installed metadata, policy, shared settings and managed-file hashes.
   New consumers interpret schema 1 through the non-writing adapter.

   A valid schema-2 manifest is "needs update", not a schema error.
   Determine baseline identity from the manifest-recorded policy hash. Unknown identity requires
   explicit decisions for every current policy entry.

3. Present policy and ownership decisions.

   Show anchors, added/deleted/modified entries, replacement coverage, project moves, exact
   omissions and retained legacy denies.

   An old omission does not decide replacement coverage.
   Require policy approval even when only ownership/metadata changes.

4. Present permission decisions.

   List v2 managed allows. Preserve unapproved entries and metadata.
   Approved retirement removes only selected allows and records omissions.

   Already absent allows and deny-ownership changes become explicit metadata operations.
   Deny omissions require settings approval even without settings-byte changes.

   Preserve identical user denies as user-owned and report "already covered".
   Preserve retired v2 denies; do not silently delete their ownership.

5. Present the complete tools and agents update.

   Include all runtime helpers as one compatible unit. Declining an edited helper replacement
   prevents the coupled policy migration.

   Compare installed agents/wrappers against the shipped `data/v2.0.0/` snapshots, never a tag.
   Account for every reviewer non-template line, including inline edits, before approving
   replacement and customization extraction.

   Preserve wrapper additions and existing project customization files.

6. Draft and review one plan.

   Content, ownership, omissions, baseline records, snippet hash and schema migration share the
   same run. Metadata-only updates use the same engine without dummy file edits.

   ```text
   node <SKILL_DIR>/scripts/apply.mjs diff --project . --run-id <id>
   ```

   The command performs no Git calls. Protected template content is never displayed as a diff.
   Preserve existing values and report Q3's manual cleanup.

7. Prepare, approve and commit.

   ```text
   node <SKILL_DIR>/scripts/apply.mjs prepare --run-id <id> --mode update
   node <SKILL_DIR>/scripts/apply.mjs commit --run-id <id> --approved-plan <hash>
   node <SKILL_DIR>/scripts/validate.mjs
   ```

   Add only the required approval paths. Approval eligibility includes metadata operations.

   Prepare refuses incompatible tool/policy combinations. Commit rechecks all bound inputs,
   writes compatible readers before dependent policy changes, and writes manifest schema 3 last.

   Do not run another setup or review operation while the transaction is unresolved.

8. Report and retain recovery material.

   Separate static results from pending host evidence. Keep backups until confirmation.
   Do not install user-level snippets or alter personal settings.

Rollback:

```text
node <SKILL_DIR>/scripts/apply.mjs rollback --run-id <id>
```

- Restore policy, settings, tools, agents and manifest through the journal.
- Remove newly created files only if their bytes still match this run.
- Metadata-only rollback restores the previous manifest without changing settings bytes.
- Preserve later user edits and retain backups when rollback is incomplete.
- Exit 2/4 before a journal permits re-prepare; exit 5 requires recovery.
- Exit 6 reports incomplete rollback; do not discard unresolved backups.
- Exit 7 prevents reuse of written runs or bypassing unresolved recovery.
- Retry after a journaled run uses a new run ID.
- A genuine no-op leaves content and manifest bytes unchanged.
- Roll back project state using rc.1 tooling before reverting the installed skill.

Do not split one migration into successive manifest commits. If later independent update runs
exist, roll them back newest first. An earlier run encountering a later manifest must return
incomplete rollback/exit 6 rather than overwrite it.

Q6 is a compatibility signal: v2 validation rejects schema 3. It does not retrofit a pre-write
guard into every old command. Document and test that limit; update the known v2 project together
with its skill, and do not use v2 commands to repair a schema-3 project.

## 7. Risks

Policy version skew is the largest migration risk. The legacy adapter, compatible tool-unit gate
and single transaction prevent a new policy from being accepted with an old reader.

Ownership changes can widen permissions or erase decisions. Exact omissions, preserved legacy
denies, non-adoption of user duplicates and metadata approval contain that risk.

Apply changes affect every update. Preserve existing lock, precondition, journal and recovery
machinery rather than introducing another writer. The no-Git diff test must exercise root and
directory helpers, not just its rendering function.

Partial tests can overstate completion. Exclusive sub-assertion ownership and a full PASS-record
gate prevent component results from masquerading as complete parity.

Hand-authored migration fixtures can hide compatibility failures. Generate them through actual
tagged v2 scripts, while shipping byte-verified baseline data for runtime use.

Reviewer edits cannot be reconstructed from a hash. Shipped-template comparison and explicit
disposition of every non-template line prevent silent loss.

Git safety combines argument handling, filenames, links and output limits. Shared builders,
bounded emission and installed-tool tests cover those boundaries, including log/show.

The hook remains an incomplete shell parser. Document its gaps and retain the trusted-checkout
boundary. In-process draft review avoids weakening the hook for setup.

Doctor options and Windows shims can introduce command injection. Fixed operations, allowlisted
arguments and shell-free native/Node execution prevent caller input from becoming shell code.

Doctor configuration checks do not prove host tool absence. Keep host measurements pending and
report unknown/error states accurately.

Release notes can create self-referential hashes if written into the identified tree. Generate
hash-bearing notes externally, archive the tag's `project-setup/` path and assert unchanged source
state and reproducible ZIP bytes.

## 8. Design questions

None. The corrected Q5 archive command resolves DQ1.

## Revision disposition

| Item | Disposition |
| --- | --- |
| B1 | FIXED: C11a ships byte-verified baselines; C8/section 6 use them without tag access. |
| N1 | FIXED: section 4 assigns exclusive portions; deny-ownership assertions belong to C3. |
| N2 | FIXED: C10 reads logs, runs no probe, allowlists options and avoids shell invocation. |
| N3 | FIXED: C8/C11b own Q6 text; C2/C10 report valid schema 2 as "needs update". |
| N4 | FIXED: C11b names external publication notes; S07 verifies unchanged tree/source. |
| N5 | FIXED: C5 reserves canonical aliases; R92 covers REVIEW, review. and cleanup safety. |
| N6 | FIXED: C2 names both root-discovery paths; R02 detects any Git invocation. |
| N7 | FIXED: C4/C8 add narrowing guidance; R76 and A5-templates assert it. |
| DQ1 | FIXED: C11b uses git archive with the tag and project-setup/ path, without --mtime. |

Remaining design questions: none.
## Addendum at freeze: plan-critique round 3, R1 (NON-BLOCKING)

Added by the orchestrator when freezing; it clarifies test mechanics and changes no scope.

- S07 never depends on the real release tag. It builds a temporary repository with isolated git
  config and a synthetic tag, and runs `release.mjs` there; the real tag
  `project-setup-v3.0.0-rc.1` exists only after review and merge, so `accept-rc1` could not
  otherwise pass before C11b completes.
- The reproducibility check builds the two archives more than 2 seconds apart (zip timestamps have
  2-second granularity), or adds a control showing that the tree-input form `<tag>:project-setup`
  produces a different archive.
- The real-tag `release.mjs` run is a separate maintainer step after tagging, outside
  `accept-rc1`.
