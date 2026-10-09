# Claude Code specifics

Facts below were checked against the Claude Code docs while writing v2. Behaviour is version-dependent: record
the version from `detect.mjs` in the report, and verify at runtime rather than trusting this file.

## Instruction loading

- Claude reads `CLAUDE.md`. Since v2.1.277 it reads `AGENTS.md` directly **only** when no `CLAUDE.md`,
  `.claude/CLAUDE.md`, or `CLAUDE.local.md` exists in the working directory or above. A `CLAUDE.md` containing
  `@AGENTS.md` never causes a double load, whatever the "Project instructions" setting. Keep the import: it also
  covers sessions that cannot read `AGENTS.md` directly (older versions, plugin disabled, first session after an
  upgrade).
- Symlinking `CLAUDE.md` → `AGENTS.md` is not used: on Windows it needs admin/Developer Mode, and Git checks a
  committed symlink out as a plain text file unless `core.symlinks` is on.
- `@path` imports are expanded at launch (relative to the importing file, up to four hops). They organise but do
  not reduce context cost. Imports resolving outside the project trigger a one-time approval dialog.
- Block-level HTML comments are stripped before `CLAUDE.md` content enters context, so managed-block markers
  cost nothing there. They remain visible when a file is opened directly.
- Nested `CLAUDE.md` files load on demand when Claude works with a file in that directory. Nested `AGENTS.md`
  files are ignored while a root `CLAUDE.md` exists (default mode), hence the pair rule.
- The "Project instructions" mode (`instructionFiles`) is honoured only in user or managed settings; the skill
  reports it (detect) and never sets it.

## Permissions semantics that shape the merge

- Evaluation order is deny → ask → allow; a deny from any settings layer wins over an allow anywhere.
- A `Read(...)` deny applies to Claude's file tools (best effort for Grep/Glob), `@file` mentions, file commands it
  recognises in Bash (`cat`, `head`, `tail`, `sed`, `tee`) and redirections. It does **not** apply to commands that
  read without naming the file (`grep -r . `) or to arbitrary subprocesses (a Node/Python script opening files).
  Only the OS sandbox enforces that.
- A `Read(...)` deny also blocks Edit/Write on the same path (v2.1.208+/v2.1.228+). The vault is denied, so only
  scripts write there; agents never need to.
- Patterns use gitignore syntax: a bare `Read(.env)` and `Read(**/.env)` are equivalent. On Windows, paths are
  normalised to POSIX form before matching.
- A deny entry starting with `!` is a gitignore negation that carves exceptions out of the `path`/`./path` rules
  listed **before** it in the same settings source. Consequences for the merge:
  - managed entries are appended after user entries, so user negations cannot carve them;
  - managed entries never include negations (a managed `!` would weaken the user's earlier rules);
  - a managed rule already sitting before a user negation is reported as a conflict for the user to resolve;
  - appending is not neutral either: a managed rule placed **after** a user negation that it covers (e.g.
    `Read(**/.env.*)` after `Read(!.env.example)`) cancels that exception. Such rules are held back from the draft
    and reported (`needsDecision`); they are added only with `--override-user-exceptions` after the user decides.
    Overlap is computed soundly over literals, `*`, `?` and `**` (a rule is appended only if no path can match both);
    character classes, braces, escapes, `~/` and `//` are not modelled and always defer. This is the merge contract;
    how a live Claude session evaluates the rules is not tested here.
- `.claudeignore` has no effect. Its entries must exist as `Read` denies.
- `Bash(...)`/`PowerShell(...)` rules match command text after splitting compound commands and stripping a few
  wrappers. `/bin/rm`, `sh -c '…'`, `git -C . push` are not matched. The command denies are noise reduction; never
  describe them as a boundary. On Windows the PowerShell tool needs its own rules (rendered alongside Bash).
- Project `permissions.allow` and `additionalDirectories` apply only after the user accepts workspace trust;
  `deny`/`ask` apply immediately.
- On Windows, `.claude/settings.local.json` may live in the starting directory rather than the repo root.

## Sandbox

The OS-level sandbox (filesystem/network limits for Bash/PowerShell commands and their children) is what turns a
read deny into a subprocess-proof control. It is not available on native Windows at the time of writing, and it is
off by default elsewhere; file tools, MCP servers, and hooks are outside it. The capability report states the
sandbox status as observed (enabled / not enabled / unavailable), never assumed.

Measured live (Claude Code 2.1.295, Windows 11 native, no sandbox), with the managed denies in place:

| Layer | Result |
|---|---|
| Read tool on `.env*`, `*.pem` | denied by permission settings |
| `cat <file>` via Bash | denied by permission settings |
| File created after the session started (`late/.env`) | denied (Read and `cat`) |
| A Node script started from Bash reading the same files | **readable** (4 of 4) |

So on native Windows the denies stop Claude's tools and commands that name the file; they are not a barrier against
a script that reads files itself. Real protection there means no real secrets in development working trees, or
running under WSL2 with the sandbox enabled.

## Permission mode during setup

Run setup with `--permission-mode default`. In auto mode an automatic classifier approves commands without showing
them, so the human gates around writes are not exercised (observed live: "Allowed by auto mode classifier").

## Hooks

Not generated by default. If the user asks for one, use the current shape and read the event from stdin JSON:

```json
{ "hooks": { "PostToolUse": [ { "matcher": "Write|Edit",
  "hooks": [ { "type": "command", "command": "node .claude/hooks/lint-changed.mjs" } ] } ] } }
```

The script reads `tool_input.file_path` from stdin, lints only files inside the repo with supported extensions,
and exits non-zero on failure (no `|| true`). Prefer husky/lint-staged: it enforces the same rule for both tools
and for humans.

## Subagent wrappers

`assets/wrappers/claude-*.md`. No `model:` line (inherit the session model; pinning a model is an environment
choice, not a project rule). The reviewer has no Edit/Write tools. If the canonical file is missing, the wrapper
stops instead of improvising.

## Retiring v1

v1 can reach a Claude session three ways. Two active copies are ambiguous, so Phase 0 stops until only one is active.

| Where v1 comes from | How it shows up | How to retire it (observed on Claude Code 2.1.295) |
|---|---|---|
| Skill enabled on claude.ai, synced into Claude Code | `anthropic-skills:project-setup`, source "claude.ai sync", under `<config>/skills/synced/<id>/` | `/plugin` → Installed → select it → Space until it reads `off`. Saved as `"skillOverrides": { "anthropic-skills:project-setup": "off" }` in `.claude/settings.local.json`. Only this skill is affected; `pr-review` and `audit` stay. Or disable it on claude.ai for the whole account |
| Plain user copy | `~/.claude/skills/project-setup` (no `.installed.json`) | The installer refuses to replace it unless `--replace-unversioned` (backed up, restorable) |
| Organization plugin bundling several skills | `<plugin>:project-setup`, plugin type in `/plugin` → Installed | A public issue reported `skillOverrides` not applying to plugin skills (2.1.226); verify on your version. Otherwise ask the plugin owner to ship v2 or drop v1. Do not use a `Skill(...)` deny rule: it can match v2 too |

Facts learned live:
- `CLAUDE_CONFIG_DIR` does NOT isolate account-level skills synced from claude.ai: they appear in the isolated config
  after login, typically from the first restart. Isolation tests must check the skill list again after a restart.
- A session continued with `--continue` keeps the skill list it started with. Confirm active copies in a NEW session.
- The `/plugin` skill toggle writes `.claude/settings.local.json` in the project; it is user-owned and the skill never
  writes it (write denylist).

Install v2 next to v1 only after v1 is retired: start a new session, confirm one `project-setup`, run Phase 0 on a
test repo. Rollback: undo the override (or re-enable) and `install.mjs rollback`.

## Load verification (Claude session)

- `/context` (or `/memory`): `CLAUDE.md` listed and `AGENTS.md` included via the import.
- `/agents`: `reviewer` and `docs-sync` present; ask the reviewer to state its first rule from `.ai/agents/reviewer.md`.
- `/permissions`: managed denies present, no unexpected allow rules.
