# project-setup v3.0.0 - design

Status: part A and the rc.1 items (N5, N6, N8, and the B5/B6 parts moved by R2-2) are FROZEN as of
commit 54ad312 (2026-10-15), after review round 3 found nothing. A change to them goes through the
maintainer. Everything else is DRAFT: early part-2/3 items and the rest of section N are specified;
the rest of parts 2 and 3 follows.

Baseline: project-setup 2.0.0, archive SHA256
`97185CE84C28F0D9D32E4766B2579E47811980D0B38736C24C4F42A7F1127CE8`. Every file reference below is
to that tree. Suite at baseline: 59 PASS / 0 FAIL / 1 SKIP (R13d).

Provenance of that archive (VERIFIED by the maintainer on 2026-10-15): it was built by hand in a
Claude session from rc.13 and downloaded, like the rc.5 to rc.13 archives, and hashed with
`Get-FileHash`. It was saved at 2026-10-10 01:09, before the tag commit `1356604` (01:41). Its 53
files are byte-identical to `project-setup/` at tag `project-setup-v2.0.0` (0 differences). Zip
entry times are the build time, so the archive cannot be reproduced byte for byte; it is not
rebuilt. From rc.1 on, releases follow the scripted procedure in "Implementation decisions".

Evidence sources: the contact-rewards-backend migration (run `ps-20261010-a780`, PR #2009), Codex
security review on PR #2009, the GitHub CI work (PRs #2010-#2017), and the live Codex test on
2026-10-12.

This document is ASCII only (see C3 in part 2).

---

## 0. Release plan

One release, v3.0.0, built in three reviewed release candidates. Each RC is reviewed adversarially
before the next starts. Nothing ships until all three pass and the live acceptance run is green.

| RC    | Scope                                        | Why this order                                                                         |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| rc.1  | A: security and permissions (this part)      | Changes git-safe, the secret list format and settings merge; later parts build on them |
| rc.2  | B + C: drift detection, Codex, Windows       | Depends on the file layout fixed in rc.1                                               |
| rc.3  | D + E: PII/logging policy, DX                | Templates and content; lowest risk                                                     |
| rc.4+ | Review fixes                                 |                                                                                        |
| final | Live acceptance (Claude + Codex), then 3.0.0 |                                                                                        |

Backlog-to-item map (v2 backlog numbers in brackets): A1 [4, 9], A2 [14], A3 [15, 17], A4 [16],
A5 [22], A6 [3]. Parts 2-3: B1 [8], B2 [10, 20], B3 [5], B4 [12], C1 [20], C2 [21], C3 [23],
C4 [24, 25, 20], C5 [11], D1 [18, 19], D2 [13], E1 [1], E2 [2], E3 [6], E4 [7].
Added after part 1: B5 [26], B6 [27], D3 [28].
Added from the delegate setup (2026-10-14): N1-N8, specified in section N. Slots: N5, N6, N8 go to
rc.1; N7 goes to rc.2; N1, N2, N3, N4 go to rc.3 (N2 moved from rc.1 with D2, review round 1 F17).
The omission and manifest-only parts of B5/B6 go to rc.1 (review round 2, R2-2).

### Compatibility rules for v3 (all parts)

- A 2.0.0 project must be updatable by v3 with no user-content approval except where this document
  says so explicitly. Every such case is listed under "Migration" in its item.
- No change may weaken an existing control without an explicit test that shows the replacement is at
  least as strong.
- Every claim about tool behaviour (Claude Code, Codex) is labelled VERIFIED (with the evidence) or
  TO VERIFY (with the test that will verify it). TO VERIFY items block the final release, not the RC.

---

## A. Security and permissions (rc.1)

### Threat model for this part

Primary actor: a teammate (or a compromised teammate account) who can push a branch to the
repository and open a PR. Fork PRs are out of scope (CI gives them no secrets; agents never run on
them by policy).

Asset: the reviewing developer's machine and credentials, and the secrets in that developer's
working tree (`env/`, `cert/`, `.env*`, cloud credentials in the user profile).

Codex's read-only sandbox blocks writes only; reads span the user profile (the sandbox log shows
a read ACE granted on `~/.claude.json`, 2026-10-15). A secret outside the repository is kept from
a Codex lane by deny rules and instructions, not by the sandbox.

Observation that drives A3: on a checkout of the attacker's branch, the attacker controls EVERY
in-repo input the agents read:

| Input read from the checked-out tree                 | Effect if attacker-controlled                          |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `.claude/agents/reviewer.md`, `.codex/agents/*.toml` | Rewrites the reviewer itself                           |
| `.ai/agents/reviewer.md`                             | Rewrites the reviewer's rules                          |
| `.ai/tools/git-safe.mjs`                             | Arbitrary code when the reviewer runs it               |
| `.ai/security-paths.json`                            | git-safe stops excluding secret paths                  |
| `.claude/settings.json` (permissions, hooks)         | Removes denies; adds hooks that run on every tool call |
| `AGENTS.md`, `CLAUDE.md`                             | Rewrites the instructions of every session             |

Moving only `git-safe.mjs` out of the tree (v2 backlog item 15) closes one row of six. The Codex P2
finding on PR #2009 (`.codex/agents/reviewer.toml:11`) is the same problem seen from another row.

Conclusion and design principle for A: **agents never run on a checkout of an untrusted branch.**
Untrusted changes are reviewed from a trusted checkout, reading the changed code from git objects,
never from the working tree. A2-A5 are guardrails inside that boundary, not substitutes for it.

---

### A3. Review without checkout (trusted-base review mode)

Replaces v2 backlog items 15 and 17.

**Problem.** The documented review flow is: check out the branch, then run the reviewer. That makes
every row of the table above attacker-controlled.

**Design.**

1. The reviewer runs on a trusted checkout: the base branch, or any branch the user states they
   trust. Agent definitions, rules, `git-safe.mjs`, `security-paths.json` and settings all come from
   that checkout.
2. The code under review is a git ref: `refs/remotes/origin/<branch>`, or a PR ref fetched by the
   user (`git fetch origin pull/<n>/head:refs/review/<n>`; fetching is the user's action, not the
   agent's). Base and head refs resolve to commit IDs before review commands are built. The report
   records both IDs and the review mode:
   - Committed-head mode: `review-diff --base <ref> --head <ref>` compares the merge-base of the
     resolved commits to the resolved head. The trusted checkout's staged, unstaged and untracked
     content is not part of that review.
   - Local-worktree mode: `review-diff --base <ref>` uses the resolved current HEAD as head and
     compares the merge-base to the user's working tree, including the local changes in N5.
     This mode is for the user's own branch.
3. `git-safe.mjs` gains three read-only subcommands so the reviewer never needs the working tree of
   the reviewed branch:

   | Subcommand                             | Prints                       | Secret check                   |
   | -------------------------------------- | ---------------------------- | ------------------------------ |
   | `cat <commit> -- <path>`               | File content at that commit  | Refuse a matching path, exit 2 |
   | `ls <commit> [-- <paths>]`             | Tracked paths at that commit | Omit matching paths            |
   | `grep <commit> <pattern> [-- <paths>]` | Matches in that tree         | Exclude matching paths         |

   All three, `diff` and `review-diff` use the A1/A6 policy grammar and shared matcher: literals,
   `*`, `?`, `**`; unsupported syntax fails validation. Secret matching is case-insensitive on
   every platform.

   Path handling has three separate steps:
   - Structural validation rejects absolute paths, `..` components, NUL and noncanonical path
     forms such as `./` prefixes. It does not case-fold or rewrite a valid name.
   - Secret matching checks the validated path case-insensitively.
   - Git object lookup uses the original, exact-case path. Git listings are NUL-delimited;
     whitespace, quoting and non-ASCII names are not parsed as line-delimited records.

   Every revision must resolve to a commit (R01); `rev:path` syntax stays blocked as an argument.
   `cat` builds `<resolved-commit>:<validated-path>` only after both checks pass.

   Each subcommand has its own argument builder. Resolved commit IDs, never unchecked ref
   strings, reach the content operation. Grep patterns follow `-e`; paths follow `--` where the
   git subcommand accepts paths. `cat` uses `cat-file blob`, never `show`. No content operation
   enables textconv or external diff. Invalid policy or a git failure is an error, not an empty
   successful review.

   An output size limit applies to these review commands, including diff output.
   DECIDED 2026-10-15: the limit is 1 MiB (1,048,576 bytes) of output per invocation. Above it,
   the command refuses the whole result, prints nothing partial, exits non-zero and tells the
   caller to narrow the paths (`-- <paths>` on `review-diff`, `ls` and `grep`; see N5). A
   truncated review is never emitted.

4. The canonical `reviewer.md` section 1 changes:
   - Determine the review mode and resolved base/head IDs first, and record them in the header.
   - If head is the current HEAD of the working tree, say so in the report header:
     "instructions loaded from the branch under review: trusted only if you authored it".
     This keeps the common "review my own branch" case working.
   - Read changed code with `git-safe cat|grep|ls <resolved-head> ...`, not with file tools,
     whenever head is not the checked-out commit.
   - Use the orchestrator-provided diff file or stdout-only commands as specified in N5.
   - Never run `git checkout`, `git switch`, `gh pr checkout` or `git worktree add`.

5. `docs-sync` is unchanged in principle (it edits the checked-out tree, so it only ever runs on
   the user's own branch). Its definition gains the same "never check out" rule.

**What this does not solve, stated in the README:** a developer who checks out an untrusted branch
and starts an agent session there has already given that branch control of the session. The skill
cannot detect or prevent that. Team policy text (README): "Review other people's branches with the
reviewer from your base branch, or on GitHub. Never open an agent session on someone else's
branch."

**Not doing (from v2 backlog item 15):** installing `git-safe.mjs` out of tree and allow-listing it
in user settings. Reason: with the trusted-checkout model it adds a cross-platform install path and a
second copy to keep in sync, and without that model it protects one input of six.
DECIDED 2026-10-15: no optional out-of-tree copy either; the trusted-checkout model covers the
case, and a second copy is one more thing to keep in sync.

**Migration.** `.ai/tools/git-safe.mjs` and `.ai/agents/reviewer.md` retain `full` ownership.
An unchanged installed file can receive a reviewed update without extra user-content approval.
An edited `full` file is shown as a diff and requires explicit approval before replacement.
VERIFIED in v2 source: `project-setup/scripts/apply.mjs:279` checks the installed hash and
`:289` rejects an unapproved replacement.

Project customisations, including an existing reviewer section 6, move to
`.ai/agents/reviewer.project.md`. The canonical reviewer includes that file by reference.
The migration shows the move and preserves the customisation text; it does not silently merge
template sections into an edited `full` file. The project file is user content and is preserved
on subsequent template updates.

User-added Codex wrapper settings, including `default_permissions`, survive the migration and
later updates. An edited wrapper remains subject to the `full`-file approval guard; preserving
its settings does not silently waive that guard.

Migration uses the existing draft/prepare/commit journal. Rollback restores the previous files and
manifest, or removes newly created files, subject to the existing protection for later user edits.

**Tests.**

- R41 `cat` prints a normal file at a commit; refuses a secret path, including case variants on
  every platform; refuses `./` prefixes, `a/../.env`, non-commit revisions and `rev:path` arguments.
- R42 `ls` omits secret paths; `grep` never returns a line from a secret path, including when the
  pattern matches only inside one.
- R43 `cat` on a commit where a secret file was added and later removed still refuses that path.
- R74 shared-policy parity across `cat`, `ls`, `grep`, `diff`, `review-diff` and every rendered
  control; both anchors, all supported wildcards, mixed case and rejected unsupported syntax.
  TO VERIFY host enforcement parity in Claude Code and Codex with the corresponding live cases.
- R75 structural validation does not alter exact-case git lookup; NUL-delimited listings preserve
  mixed-case, whitespace and non-ASCII names. Secret case variants remain denied.
- R76 adversarial argument tests: leading-dash refs cannot inject options; leading-dash grep
  patterns follow `-e`; paths cannot inject options; `cat` invokes `cat-file blob`; textconv and
  external diff never run; malformed policy and git failures fail the review. Output exactly at
  1 MiB passes; output above it is refused whole, with no partial output and a non-zero exit.
- R77 edited `full` files require approval; reviewer customisations survive the approved move;
  user-added Codex settings survive; rerun and rollback preserve the agreed ownership boundaries.
- R90 in N5 covers both review modes and recorded commit IDs.
- Live: reviewer on a trusted checkout reviews `refs/review/N` without touching the working tree
  (`git status` and `git stash list` identical before and after); the report header shows the
  self-review warning only when head equals HEAD.

---

### A1. Root-anchored Claude deny rules

Replaces v2 backlog items 4 and 9.

**Problem (VERIFIED in contact-rewards-backend, commit `c4b10d462`).** Claude Code resolves a
permission path with no leading `/` relative to the session's current directory. `Read(env/**)` in
project settings does not protect `<root>/env/**` when the session starts in a subdirectory. The
fix in that project was `Read(/env/**)`, where a leading `/` means "relative to the settings file's
project root".

The 2.0.0 base list only contains `**/`-prefixed globs, so the base rules are not affected. The bug
appears as soon as a project adds a root-relative path (A6 makes that a supported feature, so A1 and
A6 ship together). VERIFIED in `project-setup/data/secret-paths.json:4`.

**Design.**

- `security-paths.json` pattern entries gain `anchor`: `"any"` (default; glob must start with `**/`)
  or `"root"` (glob is relative to the repository root, no leading `/` in the file).
- One shared policy grammar and matcher serves all consumers: literals, `*`, `?`, `**`.
  Character classes, braces, escapes and other unsupported syntax fail validation. Matching is
  case-insensitive on every platform.
- Rendering:

  | Consumer                         | `anchor: any`               | `anchor: root`           |
  | -------------------------------- | --------------------------- | ------------------------ |
  | Claude `Read(...)`               | `Read(**/x)`                | `Read(/x)`               |
  | git pathspec                     | `:(exclude,glob,icase)**/x` | `:(exclude,glob,icase)x` |
  | Codex snippet `:workspace_roots` | `"**/x"`                    | `"x"`                    |
  | Shared matcher                   | Match at any depth          | Match from root only     |

  These are the anchor forms. Each rendered control must preserve the shared grammar's
  case-insensitive meaning, rather than assuming the host's native glob semantics are identical.
  TO VERIFY: Codex workspace-root semantics and Claude/Codex case-insensitive enforcement, using
  R44/R74 live parity cases. Static rendering alone is not runtime verification.

- Schema validation: an `any` glob that does not start with `**/`, or a `root` glob that starts with
  `/`, `**/`, `./` or contains a `..` path component, is a validation failure.
- `validate.mjs` adds a warning for user-owned `Read(...)`/`Edit(...)` deny rules in project
  settings that start with neither `**/`, `/`, `//` nor `~/`: "relative to the session's working
  directory, so it may not protect what it names". User rules are reported, never rewritten.

**Migration.** The versioned v2-to-v3 policy migration assigns `anchor: any` to entries beginning
with `**/` and `anchor: root` to entries without that prefix. Adding an anchor does not legalise
an otherwise invalid glob. Other entry fields and other fields in the policy file are preserved.

Entries are classified as added, modified or deleted against the installed v2 baseline, as
specified in A6. Restoring a deleted base entry or replacing a modified one requires approval.
The migration and any move to `projectPatterns` appear in the Phase 0 plan and require
`--approve-user-content` for `.ai/security-paths.json`.

contact-rewards-backend already has `Read(/env/**)` and `Read(/cert/**)` as user entries; after A6
they are also represented by managed entries rendered from `projectPatterns`. The duplicate user
entries are reported as "already covered" and are not removed. Rollback follows A6.

**Tests.** R44 rendering table above for both anchors, with live host cases labelled TO VERIFY
until measured; R45 schema rejects invalid anchors and unsupported grammar; R46 validate warns on
an unanchored user deny and stays silent on the four anchored forms. R74 checks shared-policy
parity and case-insensitive matching on every platform. R78 checks versioned anchor migration,
preservation of other fields, baseline classification and approval before restoring or replacing
a changed base entry.

---

### A6. Project secret paths drive every rendered control

Replaces v2 backlog item 3.

**Problem (VERIFIED, run `ps-20261010-a780`).** Claude deny rules and the Codex snippet are rendered
from the skill's `data/secret-paths.json`. Project additions in `.ai/security-paths.json` (in
contact-rewards-backend: `**/*.cert`, `env/**`, `cert/**`, `**/.htpasswd`) reach git-safe only; they
had to be added to Claude settings and to the Codex snippet by hand, and `validate.mjs` warns
forever ("differs from this skill version").

**Design.**

- `.ai/security-paths.json` gets two arrays: `patterns` (managed) and `projectPatterns`
  (user-owned). Ownership becomes `keys`, with an explicit schema for this file. Updates preserve
  `projectPatterns` and other existing fields, except for the approved versioned migration below.
- Ownership schemas are specific to each file; `keys` is not a generic permission to replace
  arbitrary JSON:

  | File                      | Managed data                                       | Preserved user data                |
  | ------------------------- | -------------------------------------------------- | ---------------------------------- |
  | `.ai/security-paths.json` | Versioned policy schema and `patterns` entries     | `projectPatterns` and other fields |
  | `.claude/settings.json`   | Recorded permission entries and A2 hook identities | Other entries, options and order   |

  Security-policy metadata records complete pattern entries, not arrays of permission strings.
  Claude permission entries remain strings identified within their permission array. A managed
  hook is identified by event, matcher and command together; command alone is insufficient.
  User hook order and options are preserved. Prepare, commit and validate use the same per-file
  schemas, including for ownership metadata embedded in the approved plan.

  VERIFIED v2 limitation: `project-setup/scripts/apply.mjs:326` restricts `keys` ownership to
  Claude settings; `:331` accepts managed-key metadata only as arrays of strings for that file.
  These checks must be extended together.

- Every consumer (render-permissions, git-safe, globs.mjs, detect, secret-scan) uses
  `patterns + projectPatterns`, deduplicated by anchor and case-normalised glob. Existing fields
  on entries are preserved; deduplication of effective matching does not discard source metadata.
- All consumers share the A1 grammar and matcher: literals, `*`, `?`, `**`; unsupported syntax
  fails validation; matching is case-insensitive on every platform.
- `prepare` computes one effective, migrated pattern snapshot. Every rendered control for that
  plan uses that same snapshot, including Claude denies, git exclusions and the Codex snippet.
  The approved plan binds the policy, ownership metadata and rendered outputs together.
  Changed inputs or outputs after approval require a new prepare and approval; commit must not
  independently re-render from a different policy.
- `render-permissions.mjs` takes `--project <root>` and renders from the project policy when it
  exists; without it, from the skill policy for Phase 0. A Phase 0 rendering does not substitute
  for prepare's migrated snapshot.
- The manifest records the installed managed pattern list. `validate.mjs` compares the project's
  `patterns` against that recorded list, not against the currently running skill's list:
  - A mismatch with the recorded installed list fails as managed content edited.
  - An unchanged older installed list reports "behind" when the current skill has a newer list.
  - `projectPatterns` are validated and listed in an info line, not reported as managed drift.
- The manifest records a hash of the last rendered Codex snippet. Validate renders from the
  current effective policy and reports an info line if its hash differs because project patterns
  changed. This reports a stale snippet; it does not claim that user-level Codex configuration
  was installed, inspected or verified.
- Base list changes: `**/.env` and `**/.env.*` are replaced by `**/.env*`, which also covers
  names such as `.envrc` and `.env-prod` (debate D1); `**/*.cert` and `**/.htpasswd` are added
  (generic; found in the first real migration). The change follows F6's migration and approval
  rules. `.env.example` stays denied to agents and reachable only through N6's scripts. Excluded
  files can hold review-relevant setup code (for example `.envrc`); that code needs human review.

**Migration.** Use a versioned migration from the installed v2 policy to the v3 schema.

- Compare entries with the installed v2 baseline and classify unchanged, added, modified and
  deleted entries before proposing the new managed list.
- An entry without a `**/` prefix gains `anchor: root`; a prefixed entry gains `anchor: any`.
  Preserve other entry fields and file fields, including `contentRisk` and scan settings.
- Extra project entries move from `patterns` to `projectPatterns`. Show the move in Phase 0 and
  require `--approve-user-content` for `.ai/security-paths.json`.
- Restoring a deleted base entry or replacing a modified one also requires approval. Do not
  silently turn a modified entry into an addition and restore its former base entry.
- Record approved omissions as in B5/B6 so later rendering does not repeatedly propose them.
- Existing v2 managed allow entries are identified using their installed ownership metadata;
  their removal follows A4 and is never an incidental effect of policy migration.
- DECIDED 2026-10-15 (baseline): v2 records a file hash, not the pattern entries. v3 ships the
  v2.0.0 base list as data, since 2.0.0 is the only v2 release. When the installed file's hash
  matches no known shipped list, every entry is treated as modified and the plan asks about each.
- DECIDED 2026-10-15 (changed glob): v2 entries have no stable ID, so a changed glob is a deletion
  plus an addition. Both appear in the Phase 0 plan and need approval.
- Apply the policy and dependent controls through the journaled prepare/commit flow. Rollback
  restores the policy, rendered files and manifest together, subject to the existing guard
  against overwriting later user edits.

**Tests.**

- R47 project additions appear in Claude denies, the Codex snippet and git-safe excludes.
- R97 `.envrc`, `.env-prod`, nested paths and mixed-case variants are excluded by every consumer;
  `.env.example` stays reachable only through N6's scripts.
- R48 an update moves stray `patterns` entries to `projectPatterns` only with approval.
- R49 validate fails when managed `patterns` differ from the installed manifest baseline and
  passes with valid additions in `projectPatterns`.
- R74 shared grammar, anchors and case-insensitive parity across every consumer and control.
- R78 versioned migration preserves other fields, assigns anchors, classifies baseline changes
  and requires approval for restoration/replacement. A changed glob is classified as deletion
  plus addition; a file matching no shipped list has every entry treated as modified. Rollback
  restores the inputs.
- R79 per-file ownership schemas accept policy entries and composite hook identities, reject
  metadata for the wrong file shape, and preserve user hook order, options and unrelated keys.
- R80 one prepare snapshot feeds every rendering; changing the policy, metadata or outputs after
  approval prevents commit. A migration cannot mix old git exclusions with new Claude denies.
- R81 an unchanged older installed list reports "behind", not "edited"; changing the recorded
  managed content produces the managed-drift failure.
- R82 commit records the snippet hash; unchanged policy is quiet; changed project patterns
  produce the stale-snippet info line without writing or claiming verification of user config.

---

### A2. Hook that blocks raw history commands (Claude)

Replaces v2 backlog item 14.

**Problem (VERIFIED, PR #2010 notes).** The rule "read history only through git-safe" is an
instruction. Deny rules such as `Bash(git diff *)` match command text from the start only;
`git -C . diff`, `git --no-pager log` and `cd x && git show` pass.

**Design.**

- New managed file `.ai/tools/guard-raw-git.mjs`, wired as a Claude `PreToolUse` hook on
  `Bash|PowerShell` in the managed part of `.claude/settings.json`.
- The hook command uses a quoted, project-root-anchored script path, independent of the tool's
  current directory. Candidate: `node "$CLAUDE_PROJECT_DIR/.ai/tools/guard-raw-git.mjs"`.
  TO VERIFY through Claude Code on Windows shells in R83: project-root expansion, quoting,
  launch from root/subdirectories, spaces, non-ASCII paths and the Node-missing failure.
  This is a candidate command, not a verified portable spelling.
- It reads hook JSON from stdin and takes `tool_input.command`. For PowerShell, remove backtick
  escapes from segments before matching, so escaped executable and subcommand tokens cannot
  evade the blocked list.
- Split shell command text into segments using separators (`;`, `&&`, `||`, `|`, newline,
  `$(...)` and shell backtick forms). For each segment, find a git executable token (`git`,
  `git.exe`, a path ending in `/git` or `\git.exe`) and inspect its options and subcommand.
  Recognised global options include `-C <x>`, `-c <x>`, `--no-pager`, `--git-dir=<x>`,
  `--work-tree=<x>`, `-P` and `--paginate`.
- Block these git subcommands:
  `diff show log blame cat-file grep archive format-patch whatchanged stash reflog diff-tree
range-diff`.
  `stash` is blocked as a whole, every stash subcommand included. Also block any git invocation in
  which `-p` or `--patch` is an argument of its own after shell quote removal, whatever quoting
  was used: `git commit "-p"` passes a real `-p` to git and is blocked. An argument that is the
  value of another option does not count: in `git commit -m "-p"` the `-p` is the message, so it
  is allowed (review round 2, R2-1). Block configuration overrides using `-c alias.*`.
  These checks take precedence over skipping recognised global options.
  Exit 2 with a one-line message pointing to `node .ai/tools/git-safe.mjs`.
- `git status`, `git branch`, `git fetch` and `git rev-parse` pass when they do not meet the
  blocking rules above. Commit, push and checkout are not added to this hook's blocked list:
  the hook also serves the orchestrator. Reviewer instructions still forbid git state changes.
  `git-safe.mjs` calls pass; a separate raw-git segment in the same shell command is still checked.
- Fails open but loudly on unparseable input (N8): the hook exits 1 with the fixed stderr message:
  `guard-raw-git: could not parse command; allowed without checking`.
  TO VERIFY on Claude Code 2.1.29x in R51/R83: exit 1 on PreToolUse lets the call proceed and
  surfaces stderr. This host behaviour is not established by testing the Node process alone.
- The hook is a guardrail, and the README says so. Known gaps remain: `sh -c "..."`, aliases,
  scripts that spawn git and `node -e`. PowerShell gaps include indirect or computed invocation,
  dynamically constructed command names, script blocks and encoded commands. Backtick removal
  does not make this a complete PowerShell parser.
- `merge-claude-settings.mjs` merges the managed hook under the per-file ownership schema in A6.
  Its identity is the tuple (event, matcher, command), not the command alone. Preserve user
  hook order and options, including entries sharing a command under another event or matcher.
  A rerun does not duplicate the managed hook.

**Codex.** Not in rc.1. Project-level Codex hooks would need `.codex/config.toml`, which the skill
does not write (user-owned). TO VERIFY in the part-2 capability test whether Codex reads hooks from
a project file the skill may own; if yes, part 2 adds it. Until then the Codex gap is documented.

**Security note.** The hook script runs on every Bash/PowerShell call. Under the A3 boundary the
checkout is trusted, so this adds no new attacker-controlled execution. Without the A3 boundary an
attacker's branch can already add any hook to `.claude/settings.json`; the README states this
alongside A3.

**Tests.** R50 table-driven: 40+ blocked and allowed command strings, including PowerShell
backtick escapes, quoted arguments, `git.exe`, separators and `$()`; R51 malformed stdin exits 1
and emits the fixed stderr message exactly; R52 merges the hook once, distinguishes event and
matcher collisions, preserves user hook order/options, and produces zero diff on rerun.
R83 runs the installed command through Claude Code from root and subdirectories, with spaces and
non-ASCII paths, with Node missing, and with malformed hook input; host behaviour remains
TO VERIFY until measured. R84 covers the four added subcommands (every `stash` form blocked),
`-p` and `--patch` as arguments of their own, quoted or not (`git commit "-p"` and
`git commit '--patch'` blocked), `-c alias.*`, `git commit -m "-p"` (allowed), and ordinary
orchestrator commit/push/checkout commands that must not be blocked. R84 parses the commands only;
it never runs git.
R50 also checks that the README lists the remaining PowerShell gaps.

---

### A4. Warn on shared allow rules that execute repository code

Replaces v2 backlog item 16.

**Problem (VERIFIED, PR #2009 Codex P2 and PR #2010).** A project-shared allow such as
`Bash(npm run test)` or `Bash(node .ai/tools/git-safe.mjs *)` runs code from the checked-out branch
without a prompt. contact-rewards-backend had 12 such rules.

**Design.**

- `detect.mjs` and `validate.mjs` classify every rule in `.claude/settings.json` `permissions.allow`
  (shared file only; `settings.local.json` is personal and only gets an info line):

  | Class          | Examples                                                       | Level                         |
  | -------------- | -------------------------------------------------------------- | ----------------------------- |
  | runs repo code | Package scripts, local executables and repository scripts      | warn                          |
  | broad          | Bare `Bash` or `PowerShell`, or `*` matching the whole command | fail if managed; warn if user |
  | other          | `git status`, `gh pr view *`                                   | none                          |

  "Runs repo code" includes `npm run *`, `npm test*`, `npm start*`, `yarn *`, `pnpm *`,
  `npx <local bin>`, `node <relative path>`, `./*`, `make *`, `bash <file>`, `sh <file>` and
  `pwsh -File *`.

- The warning text names the rule and the remedy (move it to `.claude/settings.local.json` if the
  developer accepts the risk on their own machine).
- `merge-claude-settings.mjs` already refuses broad managed allows; it now also refuses managed
  allows in the "runs repo code" class. The skill proposes no new managed allow rules in v3.
  VERIFIED v2 broad-allow refusal in `project-setup/scripts/merge-claude-settings.mjs:36`.

**Migration.** List every existing v2 managed allow rule in the Phase 0 plan, using installed
ownership metadata to distinguish it from user entries. Remove a rule only with approval; neither
the absence of new v3 allows nor a metadata rewrite authorises silent removal of an old one.

An approved settings removal uses `--approve-user-content` for `.claude/settings.json` and updates
the manifest consistently. Record approved omissions under B5/B6 so rendering does not propose
the rule again. If the rule is already absent, reconcile its ownership through B5's explicit
manifest-only plan item. Unapproved removals leave the existing rule and ownership intact.

The skill does not write `settings.local.json`. Rollback restores settings and ownership metadata
through the existing apply journal, subject to protection for later user edits.

**Tests.** R53 classification table; R54 the merge refuses a managed
`Bash(node .ai/tools/*)` allow. R85 lists all v2 managed allows in Phase 0, preserves them without
approval, removes only approved entries, preserves user rules, records omissions, and verifies
rerun and rollback. R86 covers reconciliation when a managed allow is already absent.

---

### A5. Agents stay inside their tools

Replaces v2 backlog item 22.

**Problem (VERIFIED, live Codex test 2026-10-12).** When shell commands failed, the Codex reviewer
tried `codex_apps.remote_desktop_commander.read_multiple_files`, a remote connector, to read
repository files, without asking. It failed only because no device was connected.

**Design.**

- Canonical `reviewer.md` and `docs-sync.md` hard rules gain: "Read repository content only with the
  local file tools and `git-safe.mjs`. If a read or command fails or is denied, stop and report it.
  Never use an MCP server, connector, browser or remote service to read repository files or history,
  and never send repository content to one."
- Claude: the wrappers already restrict `tools:` to built-in tools (reviewer: `Read, Grep, Glob,
Bash`), so MCP tools are not available to the subagent. TO VERIFY in the live run: a reviewer
  subagent cannot call an MCP tool that the parent session has.
- Codex: TO VERIFY whether a custom agent TOML can disable MCP servers or apps for that agent. If it
  can, the wrappers set it. Either way, connector isolation for review lanes is enforced by the
  external lane launcher, not by project-setup (debate D4). Disabling only file-reading
  connectors is not enough: any connector that sends data can carry out what was read.
- The launcher disables MCP in the worker's effective directory, configuration and profile.
  `--disable apps --disable plugins` removes apps and every plugin-provided server. Each server
  defined in `config.toml` is disabled by name with `-c mcp_servers.<name>.enabled=false`. Only
  config-defined names are passed: naming a plugin-provided server that way makes Codex fail to
  load its configuration ("invalid transport", Codex 0.162.1, 2026-10-15). The launcher then runs
  `codex mcp list --json` with the same flags, and refuses to launch unless every listed server
  shows `enabled: false`. project-setup documents this prerequisite in the README, and the N8
  doctor audits it: it reports server identifiers and disable coverage, never credentials, and an
  unresolved failure means the lane is not ready.
- Host evidence 2026-10-15: `codex mcp list` on this machine lists `code-review`, `codex_app`,
  `cua_repl` and `node_repl`. With the lane flags it lists only `node_repl`, `enabled: false`;
  without `--disable plugins`, `cua_repl` is enabled. This is host-reported configuration; that
  the tools are absent inside a session stays TO VERIFY (below).
- VERIFIED 2026-10-14 (review lane on this repository): when every sandboxed command failed
  ("setup refresh had errors"), Codex 0.162.1 called the `node_repl` MCP server (reading the
  repository with `node:fs`) and then `codex_apps.remote_desktop_commander.list_devices`,
  without asking. The run was stopped; nothing was sent (the device was offline). The brief did
  not forbid MCP, so this rule belongs in the agent definition, not only in a brief.
- Measured 2026-10-14: `-c mcp_servers.node_repl.enabled=false --disable apps --disable plugins`
  removes the `node_repl` and `codex_apps` tools while keeping the user config and
  `[windows] sandbox = "elevated"`. `--ignore-user-config` removes them too, but also drops the
  sandbox setting (commands are then "blocked by policy"). Audit evidence 2026-10-15, with the
  sandbox running: the model reported `node_repl` unavailable when asked to call it, and no
  `mcp_tool_call` event appeared. This is model-reported, not host evidence: launch arguments and
  zero calls show configuration and non-use, not that the tools were absent (debate D4).
- TO VERIFY, blocks release: a host-level negative-capability test shows that connector tools
  are unavailable to a lane launched as above.

**Tests.** Template tests check the rule text is present in both canonical files and both Codex
wrappers render it. Behaviour is covered by the live run only.

---

---

## Early part-2 items (received after part 1 was drafted)

These belong to rc.2 but are specified now because the evidence is fresh. Backlog numbers [26], [27]
and [28] are new.

Exception (review round 2, R2-2): A4 and A6 in rc.1 depend on part of B5 and B6. That part moves to
rc.1: approved-omission records in the manifest, renderers honouring them, explicit manifest-only
prepare/commit/rollback, and test R86. The rest of B5 and B6 stays in rc.2.

### B5. Managed permission entries must exist in the shared settings [26]

**Problem (VERIFIED, contact-rewards-backend, 2026-10-13).** `.ai/manifest.json` records
`Bash(node .ai/tools/git-safe.mjs *)` as a managed `permissions.allow` entry. The rule is in neither
`.claude/settings.json` nor `settings.local.json` (the user removed it in `c309d8939` after the Codex
P2 finding). `validate.mjs` passes: it checks JSON validity and schema, not that the managed entries
recorded in the manifest are present.

**Design.**

- `validate.mjs` compares, for every `keys`-owned file, each managed entry recorded in the manifest
  with the actual file, using that file's ownership schema:

  | Case                                         | Level                                               |
  | -------------------------------------------- | --------------------------------------------------- |
  | Managed `deny` missing from the shared file  | fail                                                |
  | Managed `allow` missing from the shared file | warn                                                |
  | Managed hook entry (A2) missing              | warn                                                |
  | Entry present only in `settings.local.json`  | Shared-file result stands, plus info                |
  | Entry present but changed                    | Treat as missing, plus info about the changed entry |
  | User-added entry                             | Never report as managed drift                       |

  A missing deny names the rule and file: "a managed security control was removed".
  A missing allow explains that removal only narrows permissions and requests manifest
  reconciliation on the next update. A local copy protects one developer, not the team.

- Nothing is restored automatically and nothing is widened. The next update run lists every
  missing managed entry in Phase 0 and asks per entry: restore, or drop from the manifest.
  Dropping a deny requires explicit approval for `.claude/settings.json`, including when only
  the manifest needs to change.
- An approved omission is recorded in the manifest, not merely deleted from its managed-entry
  list. Renderers honour that record and do not propose the omitted entry again on later runs.
  Static reporting distinguishes an approved omission from an unexpectedly missing control.
- A manifest-only change is an explicit plan item with its own `apply.mjs commit`. It must be
  reviewable and approvable even when no project file bytes change. It is not a git commit and
  does not require a dummy settings edit. The omission record and its approval are bound to
  the prepared plan and covered by the normal commit preconditions and rollback journal.
- A legacy manifest without `integrity` produces an info line and receives the field on the
  next approved commit, as specified in B6. Validation alone does not rewrite it.
- Every validate result carries `"scope": "static"`. The report keeps the separate runtime
  capability table; a static pass never appears in the "verified at runtime" column.

**Tests.** R55 fixture matrix: all present (pass); managed allow removed (warn); managed deny
removed (fail); deny present only locally (fail + info); changed rule treated as missing; missing
managed hook (warn); user-added allow and deny untouched (no finding). A rerun after an approved
omission is clean and rendering does not propose the omitted entry again.
R86 prepares, approves and commits an explicit manifest-only reconciliation; settings bytes stay
unchanged, unapproved omission fails, changed plan inputs prevent commit, and rollback restores
the previous manifest. R88 covers legacy manifests without `integrity`.

### B6. The manifest is written only by the skill's scripts [27]

**Problem (VERIFIED, contact-rewards-backend working tree, 2026-10-13).** An agent fixing docs
hand-edited `.ai/manifest.json`: it changed `mode` to `update` and `sourceCommit` to the current HEAD
with no run behind them, recomputed the hashes of a managed block (`AGENTS.md` `coding-rules`) and a
`full` file (`.ai/agents/reviewer.md`) after editing their content, and added `merged` ownership for
nine living docs the skill never wrote. Effect: the drift check is silenced, and the manifest claims
an update run that did not happen.

**Design.**

- `apply.mjs commit` writes `integrity`: SHA-256 over the canonical JSON of the manifest without
  that field. `validate.mjs` fails on a mismatch: "manifest edited outside project-setup; run an
  update to re-record, or restore it from git". This is an accident guard, not a security boundary:
  anyone can recompute it with the script, and the message says so.
- A legacy manifest without `integrity` gives an info line, not an integrity-mismatch failure.
  The next approved commit adds the field. Validation is read-only.
- `AGENTS.md` critical-rules template and both canonical agent definitions gain:
  "`.ai/manifest.json` is written only by the project-setup scripts. When you change content
  inside a managed block or a managed file, leave the manifest alone; the drift report is
  expected until the next update run."
- Record the hash of each managed block and compare the current block with that recorded hash
  before regenerating it. If it changed, show the diff and ask: keep, adopt or replace.
  - Keep: preserve the current block and its existing recorded baseline; drift remains visible.
  - Adopt: approve the current block as the new managed baseline and record its hash.
  - Replace: approve the shown replacement and record the resulting block hash after apply.
    No regeneration or hash adoption happens silently. Approval is part of the prepared plan.
- This consent gate is a new requirement, not existing R29 behaviour. VERIFIED in v2 source:
  `project-setup/scripts/apply.mjs:450` already records per-block hashes and
  `project-setup/scripts/validate.mjs:105` reports block drift. R29 is not evidence that
  regeneration of an edited block requires keep/adopt/replace.
  TO VERIFY with R96 whether a v2 update already loses an edit inside an existing managed block.
- Manifest-only changes, including adoption without content changes and B5 omission records,
  are explicit plan items with their own `apply.mjs commit`. Prepare shows their metadata diff
  and binds approval to it; commit must not discard the operation as "zero diff" merely because
  project-file bytes are unchanged. A true no-op remains a no-op.
- Approved omissions persist in the manifest and are consumed by renderers, so the same omitted
  control is not proposed again.

**Migration.** Preserve existing per-block hashes; do not rebaseline edited content merely to
upgrade the manifest. Legacy manifests gain integrity on their next approved commit. Adoption
and omission-only operations use the same manifest precondition checks, backups and journal as
content-changing operations. Rollback restores the previous manifest and any changed files,
subject to the existing guard against overwriting later user edits.

**Tests.** R56 a hand edit of any field in an integrity-bearing manifest fails validate; R57 a
normal commit and a true zero-diff rerun pass; R58 the template text is present in AGENTS.md and
both canonical agents. R86 covers explicit manifest-only commits and persistent omissions.
R87 edits a managed block and attempts regeneration: the diff and keep/adopt/replace choice are
required; keep preserves drift, adopt records only approved content, replace applies only the
approved replacement, and rollback restores the previous state. R88 checks that a legacy
manifest without integrity produces info, remains unchanged during validation, and gains
integrity on the next approved commit. R96 reproduces the v2 edited-block update path to settle
the TO VERIFY claim without treating its result as the new v3 acceptance criterion.

### D3. docs-sync propagates a changed claim to every copy of it [28]

**Problem (VERIFIED, contact-rewards-backend).** Partial updates: the deploy model was corrected to
"one pm2 process per environment" in `AGENTS.md`, while ADR-003, ADR-006, `docs/observability.md` and
`docs/business-rules/credit-approval-flow.md` kept "3 pods / replicas: 3"; the redaction list and
timeouts were updated on one page and kept the old claim elsewhere. A follow-up session fixed 11
files by hand.

**Design.** The canonical `docs-sync.md` gains a step between "map changes to docs" and "edit":

1. For each change, write down the claim that changed, old and new (for example "deploy runs 3 pods"
   -> "one pm2 process per environment").
2. Search for the old claim across the docs the agent may edit: `AGENTS.md`, `CLAUDE.md`,
   `.ai/context/`, `.ai/decisions/`, `docs/`, and `TODO.md` notes. Search by the distinctive terms
   (`replicas: 3`, `per pod`, `three pods`), not only the exact sentence.
3. For each hit, classify it:
   - current-state description: update it, or replace the duplicated detail with a link to the one
     authoritative place;
   - history (ADR context or consequences): keep the text, add a dated `Correction (YYYY-MM-DD):`
     line next to it; if the decision itself changed, follow the superseding-ADR rule instead;
   - not the same claim (a different subject that shares words): leave it.
4. Report every file changed, every hit left alone and why, and every conflict that needs a human
   decision (two docs disagree and the code does not settle it).

- Rules that stay: no new fact without code or commit evidence; no code changes; no refactor of docs
  beyond the claim; a no-op range produces no edits and says "no doc changes needed".
- Inside managed blocks the B6 rule applies: edit content if it is wrong, never the manifest.
- `docs/plans/` is never searched or edited: frozen delegate plans are history (N4).

**Tests.** Static: R59 the step and the three classifications are present in the canonical file;
both wrappers stay thin. Behaviour (evals/evals.json plus the live run): a fixture repo with the
deploy-model claim in five places, one of them an ADR; expected result: four updates, one dated
correction, nothing else touched; a second fixture where the range changes nothing documented;
expected result: zero edits.

---

## N. Coexistence with the delegate lanes (added 2026-10-14)

### Context (VERIFIED on the maintainer's machine, 2026-10-14)

- Lanes are defined in `~/.config/delegate-skills/config.json`: plan, review and review-sensitive
  run on Codex (read-only); plan-critique, tests, implement, sensitive, pr-draft, docs, docs-review
  and quick-fixes run on Claude. There is no git lane; the orchestrator does git itself.
- The delegation protocol lives in `~/.claude/CLAUDE.md` (orchestrator rules) and
  `~/.codex/AGENTS.md` (planner and reviewer roles). Both were written 2026-10-14.
- Load order, measured with a no-tool prompt in a v2 checkout of contact-rewards-backend:
  - Claude Code: `~/.claude/CLAUDE.md`, then project `CLAUDE.md`, then its imports (`AGENTS.md`,
    `critical-modules.md`), then `CLAUDE.local.md`, then auto-memory. Plugin hooks (remember,
    superpowers) also inject text.
  - Codex 0.162: global `~/.codex/AGENTS.md` and project `AGENTS.md` are both visible; the model
    reports them as one merged instruction block (it cannot tell them apart).
- User-level Claude permissions deny `Read(**/.env*)`, `Read(**/*.env)`, `Bash(*.env*)` and
  `PowerShell(*.env*)`, and ask before force-push, push to main, recursive deletes,
  `migration:run/revert` and psql DROP/TRUNCATE. Delegated workers cannot commit or push.

Conflicts observed in that test, which N1 resolves:

1. Who reviews: the protocol routes reviews to the review lane; the project `AGENTS.md` agents block
   says "use the named `reviewer` agent, never an ad-hoc one". Claude picked the project reviewer;
   Codex combined both (role from the protocol, checklist from the project).
2. A review of an existing branch has no frozen plan to compare against.
3. A third reviewer: the CodeRabbit `code-review` skill describes itself as the default for review
   requests, in both tools. (Resolved in the global protocol 2026-10-14: CodeRabbit runs only when
   asked by name, and on the GitHub PR.)
4. Claude's auto-memory holds won't-fix decisions that silently filter review findings.

### N1. Project instructions complement the global protocol (rc.3)

- The project `AGENTS.md` `agents` block changes from "use these named agents" to:
  "If a delegation protocol is active, it decides who reviews and who edits docs. Whoever reviews
  applies `.ai/agents/reviewer.md`; whoever syncs docs applies `.ai/agents/docs-sync.md`. Without a
  protocol, use the named `reviewer` and `docs-sync` agents." The skill never defines planner,
  orchestrator or lane roles.
- Canonical `reviewer.md` section 1 gains: "If there is no frozen plan, review against this checklist
  only and say so in the scope line."
- Canonical `reviewer.md` section 5 gains: "List every finding you suppressed because of a recorded
  decision (won't fix, accepted risk), with the decision's source. Never drop one silently."
- `detect.mjs` reports, names only: whether `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` exist and
  contain a delegation section; the skill never reads or writes them otherwise.
- Tests: R60 template text; live: the no-tool load test above must show no "who reviews" conflict.

### N2. Sensitive code paths, separate from secret paths (rc.3, with D2)

Deferred from rc.1 in review round 1 (F17): it has no consumer before D2. Sensitive code stays
readable and editable; until then, routing to the sensitive lanes stays in the global protocol.

- New managed+user file `.ai/sensitive-paths.json`: `patterns` (generic, from the skill) and
  `projectPatterns` (user). Meaning: "readable; changes here route to the sensitive lanes and need
  the maintainer's line-by-line review". It is NOT a secret list: git-safe, the Claude denies and the
  Codex snippet never consume it, so sensitive code is never hidden from a review.
- Generic patterns: `**/auth/**`, `**/*guard*.ts`, `**/payment*/**`, `**/*idempotenc*`,
  `**/migrations/**`, `**/*.sql`. contact-rewards-backend adds its modules (`src/modules/auth/**`,
  `src/modules/payment/**`, `src/modules/vlens/**`, `src/modules/instant-approvals/**`,
  `src/modules/contactSystem/**`, `ApiSignatureGuard` usages).
- `.ai/context/critical-modules.md` lists these paths; D2 makes the list rendered from this file so
  the two never disagree.
- Tests: R61 schema; R62 git-safe output is unchanged by a sensitive pattern (proves no exclusion).

### N3. Machine-readable verification commands (rc.3, item E5)

- New managed+user file `.ai/commands.json`: `{ "typecheck": "...", "lint": "...", "test": "...",
"i18n": "...", "migrationDryRun": null }`, each an exact command or null. Values come from
  `package.json` scripts the user confirmed in Phase 0; never inferred, never executed by the skill.
- The `AGENTS.md` `commands` block is rendered from it (fixes the stale block that missed
  `i18n:check` in contact-rewards-backend).
- Tests: R63 render; R64 validate fails when a listed script no longer exists in `package.json`.

### N4. Frozen plans (rc.3, item E6) - DECIDED 2026-10-14

- Path: `docs/plans/<yyyy-mm-dd>-<slug>.md`, tracked in git, committed with the change so the PR
  shows it. Never secrets or personal data.
- The skill adds `docs/plans/` to `.prettierignore` when the project runs prettier on `*.md` (a
  frozen plan must never be rewritten). Done by hand in contact-rewards-backend PR #2033.
- `.prettierignore` joins the write allowlist with `blocks` ownership. Add or update only the
  managed block; preserve user lines outside it. Use the normal draft/prepare/commit flow and
  B6's protection for edited managed blocks. Rollback restores the prior file, or removes a
  newly created file, subject to the existing protection for later user edits.
- docs-sync and every docs lane never edit `docs/plans/` (D3).
- Tests: R89 the allowlist permits `.prettierignore`, the manifest records `blocks` ownership,
  an existing file keeps its user lines, the conditional managed entry is correct, rerun is
  unchanged, and rollback restores the prior state. Frozen plan files remain untouched.

### N5. One sanctioned review diff (rc.1, part of A3)

- New `git-safe` subcommand:
  `review-diff --base <ref> [--head <ref>] [--out <file>] [-- <paths>...]`.
  Base and head resolve to commit IDs before building git arguments; both IDs and the review
  mode are recorded in the report.
- Optional `-- <paths>` limits the review to those repository-relative paths in both modes
  (review round 2, R2-3). Tracked changes are selected with literal pathspecs
  (`:(literal)<path>`, so no pathspec magic); untracked files in local-worktree mode are selected
  by the same paths. Each path passes A3's structural validation and the secret check; a secret
  path is refused, and secret files under a selected directory stay excluded. This is how a
  caller narrows a review that the 1 MiB limit refused.
- Committed-head mode (`--head` present) compares the merge-base of the resolved base and head
  commits to the resolved head. It reads git objects from the trusted checkout and excludes
  that checkout's staged, unstaged and untracked changes.
- Local-worktree mode (`--head` absent) resolves current HEAD as head and compares the merge-base
  of base and HEAD to the user's working tree, including staged, unstaged and untracked
  non-ignored files. This mode is for the user's own branch.
- Both modes apply the A1/A6 secret policy and A3 argument-building and output-limit rules.
  Untracked files in local-worktree mode are rendered as new-file diffs by reading them
  in-process; the index is never modified (no `git add -N`).
- Before reading an untracked file, require a regular file inside the repository. Check both
  its repository path and its resolved path against the secret policy. Reject symlinks and
  junctions, including traversal through linked directories; do not follow a link and then
  treat its target as an ordinary untracked file.
- Review-lane invocations print to stdout only: no implicit output file and no `--out`.
  The orchestrator writes the diff file and passes its path to the review lane. The `--out`
  form is for that orchestrator operation.
- File output is confined to `.ai/.run/review/` and uses exclusive creation of a new file.
  The default orchestrator artifact path is `.ai/.run/review/<timestamp>.diff`, with a
  Windows-safe timestamp. An explicit `--out` cannot escape that directory, overwrite an
  existing file or use a symlink/junction to redirect output.
- The review lane reads the supplied file or uses stdout-only git-safe commands. It never
  creates the artifact itself, even when its runtime would permit writes.
- The A2 hook allows git-safe calls; that allowance does not grant reviewers a write capability
  or permit a separate raw-git command in the same shell invocation.
- Documented limit: path rules cannot detect secret content copied to an unrelated allowed
  path. They are not a content scanner and cannot guarantee that such a diff is secret-free.
- Tests: R65 an ordinary untracked file appears, an untracked secret path does not, and the
  index is unchanged. R66 checks that the copied-secret-content limit is documented; it does
  not assert that path rules detect the copied content. R90 covers committed-head and
  local-worktree modes, merge-base selection, resolved IDs, and exclusion of trusted-checkout
  changes from committed-head output. R91 covers regular files, out-of-repository paths,
  resolved secret paths, symlinks, Windows junctions, output containment, existing-file
  rejection and Windows-safe artifact names. R92 verifies that the orchestrator creates and
  passes the artifact while reviewer invocations print only to stdout and leave files unchanged.
  R100 refuses an oversized review whole, then accepts narrower `-- <paths>` invocations that
  together cover the change, in both modes; a secret path in `<paths>` is refused, secret files
  under a selected directory stay excluded, and untracked files are filtered by the same paths.

### N6. No shell command mentions an env file (rc.1, item A7)

- VERIFIED in the recorded user-machine test: the user-level `Bash(*.env*)` deny blocks
  `node scripts/env-keys.mjs keys .env.example` and commands containing `process.env`.
  The 2.0.0 env-keys flow is therefore broken on this machine today.
- `env-keys.mjs` finds the template itself:
  `node scripts/env-keys.mjs keys --template auto` and
  `node scripts/env-keys.mjs merge --template auto --keys <file> --run-id <id>`.
  `auto` resolves `.env.example` only. It does not fall back to `.env.sample`, `.env.template`
  or any other `.env*` file. No command line the skill emits contains `.env`.
- If `.env.example` is missing, report that fact and give the user a manual step to create the
  key-name-only template. Do not automatically create a substitute or inspect another env file.
- DECIDED N6 / F15: `.env.example` holds key names only, with no secrets. Project-setup scripts
  may read and edit that file through the reviewed env-keys/apply flow; agents never open it
  directly. Script reports expose key names and classifications, never values.
- Every other `.env*` file remains denied. User-level denies stay unchanged; the global worker
  rule records the script-only exception (2026-10-15). The exception is not an agent read
  permission and does not authorise a general-purpose script to open env files.
- Every step that would copy or create another env file, such as creating `.env` from the
  template, becomes a manual instruction in the report.
- `SKILL.md` and references stop showing `grep process.env`; config names come from config code
  via file tools.
- Tests: R67 a scan of every emitted command string in SKILL.md, references and scripts' usage
  text finds no `.env`. R68 `--template auto` resolves only `.env.example`; when it is missing,
  neither keys nor merge opens an alternative or creates a template, and the report contains
  the manual step. R93 the script-only exception is present in instructions, user-level denies
  are unchanged, other `.env*` inputs are rejected, and script output never exposes values.

### N7. Secret scan before push, and a branch-protection report (rc.2, item B7)

- Opt-in in Phase 0. When accepted, the skill adds a managed block to `.husky/pre-push` (or
  creates it) that runs `node .ai/tools/secret-scan-push.mjs`, which runs gitleaks on the commits
  being pushed only.
- `.husky/pre-push` joins the write allowlist with `blocks` ownership. Preserve user lines and
  apply B6's protection to edited managed blocks. Installation uses the normal
  draft/prepare/commit journal; rollback restores the old hook or removes a newly created one,
  subject to the existing protection for later user edits.
- Hook composition (debate D3). An appended block is unreachable after an earlier `exit 0`, and
  an earlier stdin reader leaves it no input (`scripts/blocks.mjs:104` appends). So the N7 block
  is a minimal POSIX-sh adapter placed first, after the shebang and any Husky header line:
  - It copies stdin to `$(git rev-parse --git-dir)/project-setup/pre-push-input.<pid>` (quoted
    paths; never in the work tree), runs the Node scanner with that file as input, then reopens
    stdin from it for the rest of the hook (`exec < "<file>"`) and deletes the file at once. The
    open descriptor keeps reading, so no file is left behind and no sweep is needed. TO VERIFY on
    Git for Windows `sh`: reading continues after the file is deleted. If it does not, the file
    is left in place instead and there is no automatic sweep; the doctor reports leftovers.
  - It installs no EXIT trap, so it never changes user trap behaviour. The file holds ref names
    and object IDs only, no secret values.
  - Creating, copying, scanning or reopening failure stops the push and removes that
    invocation's file.
  - A hook that is not a POSIX sh script is not integrated automatically; the report gives a
    manual step.
- Report the hook as not installed unless Husky is active. Creating the file alone does not
  establish that git will invoke it.
  DECIDED 2026-10-15: Husky counts as active when `git config core.hooksPath` points into
  `.husky/` and `husky` is in `devDependencies`; otherwise the hook is reported as not installed.
  The report also states that `HUSKY=0` in the environment disables hooks and cannot be seen by a
  static check.
- DECIDED 2026-10-14: if gitleaks is not installed, the push stops with the install command
  (`winget install Gitleaks.Gitleaks`, `brew install gitleaks`). It never skips silently.
- Scanner errors fail closed: execution failure, scan failure or inability to determine the
  required commit set stops the push. An unsuccessful scan is never reported as clean.
- DECIDED 2026-10-15, revised by debate D2, commit set per pre-push input line:
  - Existing ref whose remote old commit exists locally: the commits in
    `<remote old>..<local new>`, non-fast-forward updates included.
  - New ref, or remote old commit not available locally: the commits reachable from the local
    tip, excluding those reachable from a fresh ref advertisement of the actual push endpoint
    (`$2`). Only advertised object IDs that exist locally exclude anything; an unavailable ID
    excludes nothing. Local remote-tracking refs alone are not enough: a remote can push to a
    different URL than it fetches from, be repointed, or keep stale refs.
  - Deleted ref (local ID is zero): nothing to scan.
  - Several refs in one push: the union of their commit sets, each commit scanned once.
    Failure to compute any of these stops the push; there is no empty-scan fallback.
- No lint-staged change and no prettier interaction: pre-push only, the scanner prints
  file:line:rule only (no secret values), and user hook lines stay.
- Branch protection: `detect.mjs` runs read-only `gh api` on the default branch's rules and
  reports whether a required status check exists and whether any bypass actor is set.
  Report only; the skill never changes GitHub settings. (contact-rewards-backend: `require-ci`
  with an "always" bypass for repository admins, by the maintainer's choice; reported, not
  flagged as a defect.)
- Tests: R69 hook block merge with an existing pre-push, preserving user lines; R70 missing
  gitleaks stops the push with exit 1 and the install command; R71 report on a fixture ruleset
  JSON. R94 checks the write allowlist, `blocks` ownership, rerun/rollback and "not installed"
  reporting when Husky is inactive, plus the active case (`core.hooksPath` into `.husky/` and
  `husky` in `devDependencies`) and the `HUSKY=0` note. R95 covers scanner errors and
  range-resolution failures as blocking outcomes, plus existing refs, non-fast-forward updates,
  new branches, deletions and several refs with overlapping commits scanned once. R98 covers
  differing fetch and push URLs, a repointed remote, stale tracking refs and advertised objects
  missing locally. R99 runs the adapter under Git for Windows `sh` with an earlier `exit 0`, an
  earlier stdin reader, a user EXIT trap, a user `exec`, a git directory path with spaces, a
  non-sh hook and each adapter failure. Where delete-after-open works, it checks that the input
  file is gone and stdin still replays. Where it does not (the documented fallback), it checks
  that stdin still replays, that invocation's file is kept, the doctor reports it, and no sweep
  runs (review round 2, R2-4).

### N8. Hooks on Windows (rc.1 for A2, rc.2 for N7)

- Every hook the skill installs is a Node script (`node <file>`); none calls python, bash-only
  syntax or PowerShell-only syntax. One exception (debate D3): N7's minimal POSIX-sh adapter at
  the top of `.husky/pre-push`. It only captures and replays stdin; the scanning stays in Node.
- The A2 hook command is root-anchored and quoted. Candidate:
  `node "$CLAUDE_PROJECT_DIR/.ai/tools/guard-raw-git.mjs"`.
  TO VERIFY through Claude Code on Windows shells in R83: the root variable and quoting resolve
  correctly from both the repository root and a subdirectory, including spaces and non-ASCII
  characters in the project path. The candidate is not a verified portable command.
- Every hook fails loudly: a blocking failure explains itself. For A2's unparseable-input path,
  the hook exits 1 and writes exactly:
  `guard-raw-git: could not parse command; allowed without checking`.
  R51 asserts that process result. TO VERIFY in R83 that Claude Code permits the tool call and
  shows stderr; do not infer host behaviour from the process exit code alone.
- `node .ai/tools/hooks-selftest.mjs` runs each installed hook with known inputs (allowed and
  blocked) and reports pass/fail; validate runs it and fails on any failure. Direct script tests
  are supplemented by R83's host-level tests, including a missing Node executable.
- VERIFIED 2026-10-15 (Codex CLI 0.162.1, Desktop 26.1007.9446.0): before every sandboxed
  command, the elevated sandbox's setup refresh re-validates the ACLs on the Desktop app's
  `cua_node` runtime (`...\runtimes\cua_node\<hash>\`). Any file a running Desktop process holds
  open fails with os error 32 (seen: `node_repl.exe`, and `VCRUNTIME140_1.dll` held by
  `codex-computer-use-swift.exe`), and every sandboxed command fails. The app keeps these
  processes when closed to the tray. Fully quit: `pwd` succeeds and writes are denied by the
  sandbox. Reopened: it fails again, so the app must be quit before every Codex lane run. No flag
  avoids it: disabling MCP, apps, plugins, browser and computer use does not; disabling
  `code_mode_host` disables commands entirely.
- The doctor detects any running process from the Codex Desktop package or its `cua_node`
  runtime, including an app closed to the tray, and, when a sandboxed probe fails, reads the
  newest `~/.codex/.sandbox/sandbox.<date>.log` and reports the first `setup refresh` error
  verbatim. It never reads `~/.codex/.sandbox-secrets/` or `auth.json`. Then it stops and asks;
  no fallback to full access.
- Tests: R72 self-test passes on the fixture; R73 a broken hook script makes validate fail.
  R51 checks exit 1 and the exact stderr message. R83 runs through Claude Code from root and
  subdirectories, with spaces and non-ASCII paths, with Node missing, and with malformed input.
  It verifies root anchoring and records host launch/error behaviour; failures remain visible
  and cannot be reported as successful hook verification.

### Decisions log (maintainer, 2026-10-14)

| Item     | Decision                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N4       | `docs/plans/`, tracked, prettier-ignored, never edited by docs lanes                                                                                                                                                                                                                                          |
| N7       | Missing gitleaks stops the push                                                                                                                                                                                                                                                                               |
| D1 / OTP | OTP values may be logged in every environment; never returned in a response or error body, never sent to a third party. Recorded as an accepted risk: anyone with read access to the log tables can use a logged OTP within its validity window. Mitigation outside the skill: keep log-table access minimal. |
| Reviews  | The review lane is the review of record; CodeRabbit runs when asked by name and on the GitHub PR                                                                                                                                                                                                              |
| N6 / F15 | `.env.example` holds key names only, no secrets; the skill may read and edit it. Every other `.env*` file stays denied.                                                                                                                                                                                       |

---

### Part 1 open questions for the reviewer

1. A3: is any residual case strong enough to keep an optional out-of-tree git-safe?
2. A3: should `cat` refuse files above a size limit (for example 1 MiB) to avoid flooding context
   with generated or binary files?
3. A2: resolved by N8 as fail-open-but-loud (exit 1, stderr shown). Challenge the exit-code
   semantics if Claude Code treats exit 1 on PreToolUse differently.
4. A6: one `--approve-user-content` for moving stray entries, or treat the move as content-preserving
   and skip the approval?

---

## Review round 1 (2026-10-14, decisions 2026-10-15)

Reviewer: the Codex review lane (gpt-6-astra, effort xhigh). The read-only sandbox failed on this
machine (cause in N8), and the maintainer chose to run the review with full access; git state was
identical before and after, and no MCP tool was called. The global protocol has since forbidden
that fallback. F1-F20 come from the reviewer (15 BLOCKING); X1-X4 come from the orchestrator's
cross-check (all NON-BLOCKING). Each decision below is the maintainer's. The next revision writes
each fix into its section; round 2 reviews that revision.

- **F1** (BLOCKING, A3/N5) - accepted. `review-diff` gains `--head <ref>`: a committed-head mode
  for reviews from a trusted checkout, and a local-worktree mode for the user's own branch. Both
  refs resolve to commit IDs, recorded in the report.
- **F2** (BLOCKING, N5) - accepted. Untracked files are read only when they are regular files
  inside the repository and their resolved path passes the secret check; symlinks and junctions
  are rejected. Output goes only under `.ai/.run/review/`, to a new file (exclusive create) with a
  Windows-safe name. Tests include Windows junctions.
- **F3** (BLOCKING, A1/A3/A6) - accepted. One shared matcher and grammar: literals, `*`, `?`,
  `**`. Anything else (`[]`, `{}`, escapes) fails validation. Matching is case-insensitive on
  every platform. Parity tests cover `cat`, `ls`, `grep`, `diff` and every rendered control.
- **F4** (NON-BLOCKING, N5) - accepted. R66 states the limit: path rules cannot detect secret
  content copied to an unrelated path. The test checks that the limit is documented.
- **F5** (BLOCKING, A3) - accepted. The v2 guard stays: an edited `full` file is shown and needs
  approval. Project customisations move to `.ai/agents/reviewer.project.md`, which the canonical
  file includes. User-added Codex wrapper settings (`default_permissions`) are preserved. This
  replaces the A3 "TO VERIFY" on section merging.
- **F6** (BLOCKING, A1/A6) - accepted. Versioned migration: an entry without a `**/` prefix becomes
  `anchor: root`; other fields in the file are preserved; entries are classified as added,
  modified or deleted against the installed v2 baseline. Restoring a deleted base entry or
  replacing a modified one needs approval.
- **F7** (BLOCKING, A2/A4/A6) - accepted. Ownership schemas per file. A managed hook is identified
  by event, matcher and command together; user hook order and options are preserved. Existing v2
  managed allow rules are listed in the Phase 0 plan and removed only with approval.
- **F8** (BLOCKING, B6) - accepted. New requirement, not existing R29 behaviour: the hash of each
  managed block is recorded, and before a changed block is regenerated the update shows the diff
  and asks: keep, adopt or replace. TO VERIFY whether v2 already loses such edits.
- **F9** (BLOCKING, B5/B6) - accepted. Manifest-only changes are explicit plan items with their own
  commit. Approved omissions are recorded, so the renderer does not propose them again. A legacy
  manifest without `integrity` gives an info line and gets the field on the next commit.
- **F10** (BLOCKING, A6) - accepted. `prepare` computes one effective, migrated pattern set, and
  every rendered control uses that snapshot.
- **F11** (BLOCKING, A3) - accepted. Structural path checks, case-insensitive secret matching and
  exact-case git lookup are separate steps. Git listings are NUL-delimited. Tests cover mixed-case
  and non-ASCII names.
- **F12** (BLOCKING, A2/N8) - accepted. The hook command is root-anchored and quoted (candidate:
  `$CLAUDE_PROJECT_DIR`, TO VERIFY on Windows shells). Tests run through Claude Code from the root
  and from a subdirectory, with spaces and non-ASCII in the path, and with Node missing.
- **F13** (NON-BLOCKING, A2) - accepted. Backticks are removed from PowerShell segments before
  matching; other PowerShell forms are listed as known gaps.
- **F14** (BLOCKING, N5) - accepted. The orchestrator writes the review diff file and passes it to
  the review lane. Commands available to reviewers print to stdout only.
- **F15** (BLOCKING, N6) - accepted and resolved by the Decisions log entry N6 / F15: the
  project-setup scripts read and edit `.env.example`; agents never open it directly. The
  user-level denies stay unchanged; the global worker rule states the exception (2026-10-15).
- **F16** (NON-BLOCKING, A2/N8) - accepted. R51 expects exit 1 and the fixed stderr message.
- **F17** (NON-BLOCKING, N2) - accepted as a deferral: N2 moves to rc.3 and ships with D2, its first
  consumer.
- **F18** (BLOCKING, A3) - accepted. Argument builders per subcommand: commit IDs resolved first;
  grep patterns passed with `-e`; `--` before paths; `cat-file blob`, never `show`; no textconv or
  external diff; an output size limit. Adversarial tests: leading-dash patterns and refs,
  malformed policy, git failure, oversized output.
- **F19** (BLOCKING, N6) - accepted. `--template auto` resolves `.env.example` only. When it is
  missing, the report gives a manual step.
- **F20** (NON-BLOCKING, N4/N7) - accepted. `.prettierignore` and `.husky/pre-push` join the write
  allowlist with `blocks` ownership. N7 reports the hook as not installed unless Husky is active.
  Before rc.2, N7 defines the push range (new branch, deletion, several refs) and fails closed on
  scanner errors.
- **X1** (NON-BLOCKING, A2) - option A. The blocked list adds `stash`, `reflog`, `diff-tree` and
  `range-diff`; `-p` or `--patch` is blocked when passed as an option, not when it appears inside
  a quoted argument; `-c alias.*` is blocked. Every `stash` form stays blocked (maintainer,
  2026-10-15, after the plan draft). An allowlist was rejected: the hook also runs for the
  orchestrator, which needs commit, push and checkout.
- **X2** (NON-BLOCKING, A6) - accepted. validate compares managed `patterns` with the list recorded
  in the project's manifest, not the current skill's list, so an older install reports "behind",
  not "edited".
- **X3** (NON-BLOCKING, A6) - accepted. The manifest records a hash of the last rendered Codex
  snippet; validate prints an info line when the project patterns changed since then.
- **X4** (NON-BLOCKING, N2) - deferred with N2. "`ApiSignatureGuard` usages" is not a path glob;
  when N2 returns, the candidate is a written rule instead of a pattern.

Part 1 open questions after this round:

1. Closed 2026-10-15: no optional out-of-tree git-safe (A3).
2. Answered by F18 and decided 2026-10-15: 1 MiB per invocation; above it the whole result is
   refused (A3).
3. Answered by F16: exit 1. The host behaviour stays TO VERIFY on Claude Code.
4. Answered by F6: the move is shown in the Phase 0 plan and needs approval.

---

## Debate round 1 (2026-10-15)

After the round 1 fixes were written into their sections, the maintainer asked for a debate on
the whole document. Codex (review lane, gpt-6-astra, effort xhigh) challenged it; the orchestrator
(Claude) answered; three rounds in one Codex session. The read-only sandbox held throughout, no
MCP tool was called, and git state and the uncommitted diff were identical before and after each
round. Codex raised four points and found nothing else worth arguing.

| Point       | Codex's claim                                                                 | Outcome                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 (A6, N6) | `.envrc` and `.env-prod` match no base pattern                                | Agreed at once: `**/.env*` replaces `**/.env` and `**/.env.*`                                                                                      |
| D2 (N7)     | Excluding every remote-tracking ref can skip commits new to the destination   | Claude proposed destination-remote refs only; Codex showed push URLs and stale refs break that; Claude conceded: use a fresh advertisement of `$2` |
| D3 (N7, N8) | An appended pre-push block can be unreachable or get no stdin                 | Agreed: adapter first, stdin replayed. Codex then objected to an age-based sweep; the maintainer chose delete-after-open, no sweep                 |
| D4 (A5)     | Disabling only file-reading connectors is too weak; zero calls is not absence | Codex conceded enforcement belongs to the launcher; Claude conceded the 2026-10-15 "unavailable" result is model-reported evidence                 |

---

## Review round 2 (2026-10-15)

Reviewer: the Codex review lane (gpt-6-astra, effort xhigh) on commit 5bbbb19, with the read-only
sandbox enforced and every MCP server disabled; git state was identical before and after. It
found 22 of 26 decisions correctly specified, and raised 3 BLOCKING and 1 NON-BLOCKING findings.
This was the second review/fix loop with BLOCKING findings open, so the orchestrator stopped and
asked; the maintainer accepted all four and had the orchestrator fix them.

- **R2-1** (BLOCKING, A2/X1) - accepted. The shell removes quotes, so `git commit "-p"` passes a
  real `-p`. Option status now comes from argument position, not quoting; R84 covers both cases.
- **R2-2** (BLOCKING, section 0, A4/A6, B5/B6) - accepted. The omission and manifest-only parts of
  B5/B6 that A4 and A6 depend on move to rc.1; the rest stays in rc.2.
- **R2-3** (BLOCKING, A3/N5) - accepted. `review-diff` gains `-- <paths>` (literal pathspecs, same
  secret checks) so a review refused by the 1 MiB limit can be narrowed; new test R100.
- **R2-4** (NON-BLOCKING, N7/D3) - accepted. R99 now separates delete-after-open from the
  documented fallback.

Also corrected (orchestrator, while preparing this round): D4 as written told the launcher to
disable every server by name. Naming a plugin-provided server makes Codex fail to load its
configuration, so plugin servers are removed with `--disable plugins` and only config-defined
servers are named; `codex mcp list --json` under the lane flags is the launch check (A5).

---

## Implementation decisions for rc.1 (maintainer, 2026-10-15)

The rc.1 architecture plan (plan lane) stopped on questions the frozen design leaves open, and the
plan critique raised two more. The maintainer decided each one; they bind the rc.1 plan.

- **Q1 - draft diffs after A2.** Setup shows the approved draft diffs with `apply.mjs` itself: it
  renders each target-versus-draft diff in-process, with no git call, and refuses any secret path.
  No hook exemption for `git diff --no-index`, which could read any two files, secrets included.
- **Q2 - omissions across replaced entries.** An approved omission applies only to the exact entry
  (anchor and glob) it was recorded for. A new or replacing base entry, such as `**/.env*` for
  `**/.env.*`, is a new decision shown in the plan. Nothing broadens an old omission or restores
  coverage without approval.
- **Q3 - a template that already holds values.** The values are preserved and never printed; the
  report states that the template holds values and must be reduced to key names by hand. Nothing is
  erased automatically.
- **Q4 - secret-scan and the policy.** The scanner keeps inspecting every file, protected paths
  included, as its documented script-only exception allows; it prints no values. The effective
  policy is used to label findings in protected paths, not to exclude them from the scan.
- **Q5 - release procedure.** A script produces each release:
  1. Release identity: the git tree id of `project-setup/` at the tag
     (`git rev-parse <tag>:project-setup`).
  2. Archive: `git archive --format=zip <tag> project-setup/`. Entries sit under
     `project-setup/`, and because the input is a commit, git stamps them with the commit time, so
     the archive is reproducible. (Corrected 2026-10-15, plan question DQ1: the first wording
     passed a tree, `<tag>:project-setup`, for which git uses the current time.)
  3. The release notes record tag, commit, tree id and archive SHA256; the zip is attached to the
     GitHub release.
  4. v2.0.0 keeps its recorded provenance (see Baseline) and is not rebuilt.
- **Q6 - an older skill on an updated project.** The manifest `schema` becomes 3. v2 validates
  `schema === 2` (`scripts/schemas.mjs:55`), so a v2 skill run on a v3 project fails loudly instead
  of rebuilding the manifest and dropping v3 records. `migration-v2.md` and the release notes state
  this. No stronger guard: v2 is not in production yet, and its one known install
  (contact-rewards-backend, PR #2009) is updated together with the skill.
- **Q7 - what the doctor runs.** The doctor runs `codex mcp list --json` with the lane flags, reads
  the newest sandbox log and checks for Codex Desktop processes. It never starts a model session.
