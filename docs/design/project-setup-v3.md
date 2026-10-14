# project-setup v3.0.0 - design

Status: DRAFT. Part 1 (rc.1: security) is specified; early part-2/3 items and section N (delegate lanes)
are specified; the rest of parts 2 and 3 follows after review.

Baseline: project-setup 2.0.0, archive SHA256
`97185CE84C28F0D9D32E4766B2579E47811980D0B38736C24C4F42A7F1127CE8`. Every file reference below is
to that tree. Suite at baseline: 59 PASS / 0 FAIL / 1 SKIP (R13d).

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
Added from the delegate setup (2026-10-14): N1-N8, specified in section N. Slots: N2, N5, N6, N8
go to rc.1; N7 goes to rc.2; N1, N3, N4 go to rc.3.

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
   agent's).
3. `git-safe.mjs` gains three read-only subcommands so the reviewer never needs the working tree of
   the reviewed branch:

   | Subcommand                             | Prints                       | Secret check                                                                                               |
   | -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | `cat <commit> -- <path>`               | file content at that commit  | path matched against the secret patterns (same glob engine as `scripts/globs.mjs`); match = refuse, exit 2 |
   | `ls <commit> [-- <paths>]`             | tracked paths at that commit | secret paths omitted from the listing                                                                      |
   | `grep <commit> <pattern> [-- <paths>]` | `git grep` on that tree      | secret pathspec excludes appended, as for `diff`                                                           |

   Rules that stay: every revision must resolve to a commit (R01); `rev:path` syntax stays blocked as
   an _argument_. `cat` builds the `<commit>:<path>` object name itself after both checks pass, so the
   bypass that R01 blocks is not reopened. Path checks reject absolute paths, `..`, NUL, and paths
   that differ after normalisation (case-folded on Windows, matching the existing `icase` excludes).

4. The canonical `reviewer.md` section 1 changes:
   - Determine base and head refs first. If head is the current `HEAD` of the working tree, say so in
     the report header ("instructions loaded from the branch under review: trusted only if you
     authored it") and continue. This keeps the common "review my own branch" case working.
   - Read changed code with `git-safe cat|grep|ls <head> ...`, not with the file tools, whenever head
     is not the checked-out commit.
   - Never run `git checkout`, `git switch`, `gh pr checkout` or `git worktree add`.

5. `docs-sync` is unchanged in principle (it edits the checked-out tree, so it only ever runs on the
   user's own branch). Its definition gains the same "never check out" rule.

**What this does not solve, stated in the README:** a developer who checks out an untrusted branch
and starts an agent session there has already given that branch control of the session. The skill
cannot detect or prevent that. Team policy text (README): "Review other people's branches with the
reviewer from your base branch, or on GitHub. Never open an agent session on someone else's
branch."

**Not doing (from v2 backlog item 15):** installing `git-safe.mjs` out of tree and allow-listing it
in user settings. Reason: with the trusted-checkout model it adds a cross-platform install path and a
second copy to keep in sync, and without that model it protects one input of six. Open question for
the reviewer of this design: is there a residual case where an out-of-tree copy still helps? If yes,
it goes into part 2 as an optional installer flag, never a default.

**Migration.** `.ai/tools/git-safe.mjs` and `.ai/agents/reviewer.md` are `full` ownership; an update
replaces them with no user approval. Projects that customised `reviewer.md` section 6 (for example
contact-rewards-backend) keep section 6: the update merges sections 1-5 from the template and keeps
section 6 byte for byte. TO VERIFY that the 2.0.0 apply engine supports this; if not, section 6
moves to a separate `.ai/agents/reviewer.project.md` that the canonical file includes by reference.

**Tests.**

- R41 `cat` prints a normal file at a commit; refuses a secret path (direct, case variant on Windows,
  `./` prefix, `a/../.env`); refuses a non-commit revision; refuses `rev:path` as an argument.
- R42 `ls` omits secret paths; `grep` never returns a line from a secret path, including when the
  pattern matches only inside one.
- R43 `cat` on a commit where a secret file was added and later removed still refuses that path.
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
A6 ship together).

**Design.**

- `security-paths.json` pattern entries gain `anchor`: `"any"` (default; glob must start with `**/`)
  or `"root"` (glob is relative to the repository root, no leading `/` in the file).
- Rendering:

  | Consumer                                   | `anchor: any`                          | `anchor: root`                                       |
  | ------------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
  | Claude `Read(...)`                         | `Read(**/x)` (as today)                | `Read(/x)`                                           |
  | git pathspec                               | `:(exclude,glob,icase)**/x` (as today) | `:(exclude,glob,icase)x`                             |
  | Codex snippet `:workspace_roots`           | `"**/x"`                               | `"x"` (TO VERIFY: workspace-root relative semantics) |
  | `globs.mjs` match (A3 `cat`, detect, scan) | match at any depth                     | match from root only                                 |

- Schema validation: an `any` glob that does not start with `**/`, or a `root` glob that starts with
  `/`, `**/`, `./` or contains `..`, is a validation failure.
- `validate.mjs` adds a warning for user-owned `Read(...)`/`Edit(...)` deny rules in project
  settings that start with neither `**/`, `/`, `//` nor `~/`: "relative to the session's working
  directory, so it may not protect what it names". User rules are reported, never rewritten.

**Migration.** contact-rewards-backend already has `Read(/env/**)` and `Read(/cert/**)` as user
entries; after A6 they become managed entries rendered from `projectPatterns`, and the duplicate
user entries are reported as "already covered" (not removed).

**Tests.** R44 rendering table above for both anchors; R45 schema rejects the invalid forms; R46
validate warns on an unanchored user deny and stays silent on the four anchored forms.

---

### A6. Project secret paths drive every rendered control

Replaces v2 backlog item 3.

**Problem (VERIFIED, run `ps-20261010-a780`).** Claude deny rules and the Codex snippet are rendered
from the skill's `data/secret-paths.json`. Project additions in `.ai/security-paths.json` (in
contact-rewards-backend: `**/*.cert`, `env/**`, `cert/**`, `**/.htpasswd`) reach git-safe only; they
had to be added to Claude settings and to the Codex snippet by hand, and `validate.mjs` warns
forever ("differs from this skill version").

**Design.**

- `.ai/security-paths.json` gets two arrays: `patterns` (managed: copied from the skill, replaced on
  update) and `projectPatterns` (user-owned, never touched by an update). Ownership of the file
  becomes `keys`: `patterns` managed, `projectPatterns` user.
- Every consumer (render-permissions, git-safe, globs.mjs, detect, secret-scan) uses
  `patterns + projectPatterns`, deduplicated by normalised glob.
- `render-permissions.mjs` takes `--project <root>` and renders from the project file when it
  exists; without it, from the skill file (Phase 0, before the project file exists).
- `validate.mjs`: the "differs" warning is replaced by: fail if `patterns` differs from the skill's
  list (managed content changed); pass with an info line listing `projectPatterns`.
- Base list additions: `**/*.cert` and `**/.htpasswd` (generic; found in the first real migration).

**Migration.** An update that finds extra entries in `patterns` moves them to `projectPatterns`. This
changes a user-visible file, so it is listed in the Phase 0 plan and needs `--approve-user-content`
for `.ai/security-paths.json` (one approval; the content is preserved, only moved).

**Tests.** R47 project additions appear in the rendered Claude denies, the Codex snippet and git-safe
excludes; R48 an update moves stray `patterns` entries to `projectPatterns` only with approval; R49
validate fails when managed `patterns` were edited, passes with additions in `projectPatterns`.

---

### A2. Hook that blocks raw history commands (Claude)

Replaces v2 backlog item 14.

**Problem (VERIFIED, PR #2010 notes).** The rule "read history only through git-safe" is an
instruction. Deny rules such as `Bash(git diff *)` match command text from the start only;
`git -C . diff`, `git --no-pager log` and `cd x && git show` pass.

**Design.**

- New managed file `.ai/tools/guard-raw-git.mjs`, wired as a Claude `PreToolUse` hook on
  `Bash|PowerShell` in the managed part of `.claude/settings.json`.
- It reads the hook JSON from stdin, takes `tool_input.command`, splits it on shell separators
  (`;`, `&&`, `||`, `|`, newline, `$(...)`, backticks) and, for each segment, finds a `git` executable
  token (`git`, `git.exe`, a path ending in `/git` or `\git.exe`), skips global options
  (`-C <x>`, `-c <x>`, `--no-pager`, `--git-dir=<x>`, `--work-tree=<x>`, `-P`, `--paginate`), and
  blocks when the subcommand is one of `diff show log blame cat-file grep archive format-patch
whatchanged`. Exit 2 with a one-line message pointing to `node .ai/tools/git-safe.mjs`.
- `git status`, `git branch`, `git fetch`, `git rev-parse` and every `git-safe.mjs` call pass.
- Fails open but loudly on unparseable input (N8): the command is allowed, and the hook exits 1
  (Claude Code's non-blocking error code, whose stderr is shown to the user) with
  `guard-raw-git: could not parse command; allowed without checking`. A parser bug therefore never
  blocks all shell use and never goes unnoticed. TO VERIFY on Claude Code 2.1.29x: exit 1 on
  PreToolUse lets the call proceed and surfaces stderr. The hook is a guardrail, and the README says
  so with the known gaps: `sh -c "..."`, aliases, scripts that spawn git, `node -e`.
- `merge-claude-settings.mjs` learns to merge one managed `hooks.PreToolUse` entry, identified by its
  command string, without touching user hook entries (same keys-ownership rules as permissions).

**Codex.** Not in rc.1. Project-level Codex hooks would need `.codex/config.toml`, which the skill
does not write (user-owned). TO VERIFY whether Codex reads hooks from a project file the skill may
own; if yes, part 2 adds it. Until then the Codex gap is documented.

**Security note.** The hook script runs on every Bash/PowerShell call. Under the A3 boundary the
checkout is trusted, so this adds no new attacker-controlled execution. Without the A3 boundary an
attacker's branch can already add any hook to `.claude/settings.json`; the README states this
alongside A3.

**Tests.** R50 table-driven: 40+ command strings (blocked and allowed), including PowerShell forms,
quoted arguments, `git.exe`, separators, `$()`; R51 malformed stdin exits 0 and logs; R52 the merge
adds the hook once, keeps user hooks, and a re-run is a zero diff.

---

### A4. Warn on shared allow rules that execute repository code

Replaces v2 backlog item 16.

**Problem (VERIFIED, PR #2009 Codex P2 and PR #2010).** A project-shared allow such as
`Bash(npm run test)` or `Bash(node .ai/tools/git-safe.mjs *)` runs code from the checked-out branch
without a prompt. contact-rewards-backend had 12 such rules.

**Design.**

- `detect.mjs` and `validate.mjs` classify every rule in `.claude/settings.json` `permissions.allow`
  (shared file only; `settings.local.json` is personal and only gets an info line):

  | Class          | Examples                                                                                                                                                           | Level                         |
  | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
  | runs repo code | `npm run *`, `npm test*`, `npm start*`, `yarn *`, `pnpm *`, `npx <local bin>`, `node <relative path>`, `./*`, `make *`, `bash <file>`, `sh <file>`, `pwsh -File *` | warn                          |
  | broad          | a bare `Bash` or `PowerShell`, `*` matching the whole command                                                                                                      | fail if managed, warn if user |
  | other          | `git status`, `gh pr view *`                                                                                                                                       | none                          |

- The warning text names the rule and the remedy (move it to `.claude/settings.local.json` if the
  developer accepts the risk on their own machine).
- `merge-claude-settings.mjs` already refuses broad managed allows; it now also refuses managed allows
  in the "runs repo code" class. The skill proposes no managed allow rules in v3.

**Tests.** R53 classification table; R54 the merge refuses a managed `Bash(node .ai/tools/*)` allow.

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
  can, the wrappers set it. If not, the README documents the gap and recommends disabling
  file-reading connectors in Codex for repositories under this skill.

**Tests.** Template tests check the rule text is present in both canonical files and both Codex
wrappers render it. Behaviour is covered by the live run only.

---

---

## Early part-2 items (received after part 1 was drafted)

These belong to rc.2 but are specified now because the evidence is fresh. Backlog numbers [26], [27]
and [28] are new.

### B5. Managed permission entries must exist in the shared settings [26]

**Problem (VERIFIED, contact-rewards-backend, 2026-10-13).** `.ai/manifest.json` records
`Bash(node .ai/tools/git-safe.mjs *)` as a managed `permissions.allow` entry. The rule is in neither
`.claude/settings.json` nor `settings.local.json` (the user removed it in `c309d8939` after the Codex
P2 finding). `validate.mjs` passes: it checks JSON validity and schema, not that the managed entries
recorded in the manifest are present.

**Design.**

- `validate.mjs` compares, for every `keys`-owned file, each managed entry recorded in the manifest
  with the actual file:

  | Case                                               | Level                                                    | Message                                                                                  |
  | -------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | managed `deny` entry missing from the shared file  | fail                                                     | names the rule and the file; "a managed security control was removed"                    |
  | managed `allow` entry missing from the shared file | warn                                                     | removing an allow only narrows permissions; "update the manifest on the next update run" |
  | managed hook entry (A2) missing                    | warn                                                     |                                                                                          |
  | entry present only in `settings.local.json`        | the shared-file result stands, plus an info line         | a local copy protects one developer, not the team                                        |
  | entry present but changed (different text)         | treated as missing + an info line about the changed rule |                                                                                          |
  | user-added entries                                 | never reported as drift                                  |                                                                                          |

- Nothing is restored automatically and nothing is widened. The next update run lists every missing
  managed entry in the Phase 0 plan and asks per entry: restore, or drop from the manifest. A dropped
  `deny` needs `--approve-user-content` for `.claude/settings.json`.
- Every validate result carries `"scope": "static"`. The report keeps the separate runtime capability
  table; a static pass never appears in the "verified at runtime" column.

**Tests.** R55 fixture matrix: all present (pass); managed allow removed (warn); managed deny removed
(fail); deny present only locally (fail + info); user-added allow and deny untouched (no finding); a
re-run after an update that dropped the entries is clean.

### B6. The manifest is written only by the skill's scripts [27]

**Problem (VERIFIED, contact-rewards-backend working tree, 2026-10-13).** An agent fixing docs
hand-edited `.ai/manifest.json`: it changed `mode` to `update` and `sourceCommit` to the current HEAD
with no run behind them, recomputed the hashes of a managed block (`AGENTS.md` `coding-rules`) and a
`full` file (`.ai/agents/reviewer.md`) after editing their content, and added `merged` ownership for
nine living docs the skill never wrote. Effect: the drift check is silenced, and the manifest claims
an update run that did not happen.

**Design.**

- `apply.mjs commit` writes `integrity`: SHA-256 over the canonical JSON of the manifest without that
  field. `validate.mjs` fails on a mismatch: "manifest edited outside project-setup; run an update to
  re-record, or restore it from git". This is an accident guard, not a security boundary: anyone can
  recompute it with the script, and the message says so.
- `AGENTS.md` critical-rules template and both canonical agent definitions gain: "`.ai/manifest.json`
  is written only by the project-setup scripts. When you change content inside a managed block or a
  managed file, leave the manifest alone; the drift report is expected until the next update run."
- An update run treats content changed inside managed blocks as user content (existing R29 rules) and
  offers to adopt it into the project's managed content with approval.

**Tests.** R56 a hand edit of any manifest field fails validate; R57 a normal commit and a zero-diff
re-run pass; R58 the template text is present in AGENTS.md and both canonical agents.

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

### N2. Sensitive code paths, separate from secret paths (rc.1)

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
- docs-sync and every docs lane never edit `docs/plans/` (D3).

### N5. One sanctioned review diff (rc.1, part of A3)

- New `git-safe` subcommand `review-diff --base <ref> [--out <file>]`: diff from the merge-base of
  `<ref>` to the working tree, including staged, unstaged and untracked non-ignored files, with the
  secret excludes applied to all three. Untracked files are rendered as new-file diffs by reading
  them in-process after the path check; the index is never modified (no `git add -N`).
- Default output file `.ai/.run/review/<timestamp>.diff` (git-ignored), so a read-only Codex lane
  reads a file instead of running git.
- The A2 hook allows every `git-safe.mjs` call; Codex reviewers are told to use the file or git-safe.
- Tests: R65 untracked file appears; untracked secret path does not; index unchanged; R66 a secret
  file renamed into a normal path is still caught by content-free path rules only (documented
  limit).

### N6. No shell command mentions an env file (rc.1, item A7)

- VERIFIED: the user-level `Bash(*.env*)` deny blocks `node scripts/env-keys.mjs keys .env.example`
  and any command containing `process.env`. The 2.0.0 env-keys flow is therefore broken on this
  machine today.
- `env-keys.mjs` finds the template itself: `env-keys keys --template auto` and
  `env-keys merge --template auto --keys <file>`; `auto` resolves `.env.example`, `.env.sample`,
  `.env.template` in that order. No command line the skill emits contains `.env`.
- Every step that would copy or create an env file (for example creating `.env` from the template)
  becomes a manual instruction in the report.
- `SKILL.md` and references stop showing `grep process.env`; config names come from config code via
  file tools.
- Tests: R67 a scan of every command string in SKILL.md, references and scripts' usage text finds no
  `.env`; R68 `--template auto` resolution.

### N7. Secret scan before push, and a branch-protection report (rc.2, item B7)

- Opt-in in Phase 0. When accepted, the skill adds a managed block to `.husky/pre-push` (or creates
  it) that runs `node .ai/tools/secret-scan-push.mjs`, which runs gitleaks on the commits being
  pushed only.
- DECIDED 2026-10-14: if gitleaks is not installed, the push stops with the install command
  (`winget install Gitleaks.Gitleaks`, `brew install gitleaks`). It never skips silently.
- No lint-staged change and no prettier interaction: pre-push only, the scanner prints file:line:rule
  only (no secret values), and `.husky/pre-push` is ownership `blocks` so user lines stay.
- Branch protection: `detect.mjs` runs read-only `gh api` on the default branch's rules and reports
  whether a required status check exists and whether any bypass actor is set. Report only; the skill
  never changes GitHub settings. (contact-rewards-backend: `require-ci` with an "always" bypass for
  repository admins, by the maintainer's choice; reported, not flagged as a defect.)
- Tests: R69 hook block merge with an existing pre-push; R70 missing gitleaks stops the push with
  exit 1; R71 report on a fixture ruleset JSON.

### N8. Hooks on Windows (rc.1 for A2, rc.2 for N7)

- Every hook the skill installs is a Node script (`node <file>`); none calls python, bash-only
  syntax or PowerShell-only syntax.
- Every hook fails loudly: a blocking failure explains itself; a non-blocking internal error is shown
  (A2: exit 1 with stderr).
- `node .ai/tools/hooks-selftest.mjs` runs each installed hook with known inputs (allowed and
  blocked) and reports pass/fail; validate runs it and fails on any failure.
- Tests: R72 self-test passes on the fixture; R73 a broken hook script makes validate fail.

### Decisions log (maintainer, 2026-10-14)

| Item     | Decision                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N4       | `docs/plans/`, tracked, prettier-ignored, never edited by docs lanes                                                                                                                                                                                                                                          |
| N7       | Missing gitleaks stops the push                                                                                                                                                                                                                                                                               |
| D1 / OTP | OTP values may be logged in every environment; never returned in a response or error body, never sent to a third party. Recorded as an accepted risk: anyone with read access to the log tables can use a logged OTP within its validity window. Mitigation outside the skill: keep log-table access minimal. |
| Reviews  | The review lane is the review of record; CodeRabbit runs when asked by name and on the GitHub PR                                                                                                                                                                                                              |

---

### Part 1 open questions for the reviewer

1. A3: is any residual case strong enough to keep an optional out-of-tree git-safe?
2. A3: should `cat` refuse files above a size limit (for example 1 MiB) to avoid flooding context
   with generated or binary files?
3. A2: resolved by N8 as fail-open-but-loud (exit 1, stderr shown). Challenge the exit-code
   semantics if Claude Code treats exit 1 on PreToolUse differently.
4. A6: one `--approve-user-content` for moving stray entries, or treat the move as content-preserving
   and skip the approval?
