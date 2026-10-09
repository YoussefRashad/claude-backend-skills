# Codex specifics

Checked against the Codex docs while writing v2; several features are marked beta upstream. Record the Codex
version from `detect.mjs` and verify at runtime.

## Instructions

- Codex reads `AGENTS.md` files along the path from the project root to the directory where it was started,
  closer files later (more specific). `AGENTS.override.md` exists upstream; the skill never creates one.
- Project docs are loaded up to a byte budget (32 KiB by default, configurable by the user). Content past it is not
  seen. `validate.mjs` fails above 32 KiB and warns above 150 lines.
- No import syntax. `@path` is plain text; reference files in backticks and tell the agent when to read them.

## Skills

Agent Skills format (`SKILL.md` + `name`/`description`). Codex scans `.agents/skills` from the working
directory up to the repository root, plus user and admin locations. The installer's default user target is
`~/.agents/skills`; confirm discovery in a new Codex session and pass `--codex-dir` if your build uses another
location. Never let two copies with the same name be discoverable. An existing copy without install metadata
(v1 or hand-installed) is left alone unless the user passes `--replace-unversioned`.

## Custom agents (`.codex/agents/*.toml`)

- Required: `name`, `description`, `developer_instructions`. Other config keys are allowed and act as a config
  layer for that agent.
- Codex spawns custom agents only when explicitly asked ("spawn the reviewer agent to review <range>").
- A custom agent whose `name` matches a built-in (`default`, `worker`, `explorer`) replaces it; do not reuse those.
- Wrapper names: `reviewer`, `docs_sync` (underscore; files `reviewer.toml`, `docs_sync.toml`). Claude's name stays
  `docs-sync`; the canonical definition is the same file.
- **Never put `sandbox_mode` in a wrapper.** Any loaded `sandbox_mode` makes Codex use legacy sandbox settings
  instead of permission profiles, which silently drops deny-read rules for that agent.

### Read-only reviewer (optional, after verification)

Subagents inherit the parent session's permissions. To make the reviewer OS-enforced read-only, the user adds the
`project-setup-readonly` profile from the snippet to their user config, verifies it with a canary run, and only
then adds `default_permissions = "project-setup-readonly"` to `.codex/agents/reviewer.toml` (new draft → prepare →
commit). Until then the reviewer is read-only by instruction only; the report says so.

## Permission profiles (secret protection)

`node scripts/render-permissions.mjs codex-snippet` prints a profile extending `:workspace` with deny rules for
every secret pattern, plus an optional read-only variant. The skill never writes it; the user pastes it into the
user config after review.

Rules the report must reflect:

- Profiles do not compose with legacy settings. If `sandbox_mode` or `[sandbox_workspace_write]` appears in any
  loaded config, or `--sandbox` is passed, the profile is inactive. `detect.mjs` flags a user config that has both.
- Deny-read globs are expanded into a snapshot before the sandbox starts (Linux, WSL, native Windows), bounded by
  `glob_scan_max_depth`. Files created after the session starts may not be covered: the canary protocol includes a
  late-file case.
- Native Windows: enforcement depends on the sandbox backend in use. The legacy `unelevated` fallback cannot
  enforce every split read/write carve-out and refuses unsupported policies; WSL uses the Linux sandbox. Report
  the backend Codex shows, and the canary result.
- Profiles cover local sandboxed commands. MCP servers, connectors, web search, and browser tools have their own
  controls and are outside this protection.
- There are public reports of deny globs not being enforced in specific versions/configurations. Treat the
  profile as unverified until `canary.mjs probe`, run through Codex's own shell tool, reports `DENIED`.
- **Measured live, Codex 0.160.1, Windows 11 native:** with the non-admin ("unelevated") sandbox and no profile, a
  shell read and a Node subprocess both read every canary file. With this profile active, Codex **refused to start**:
  "windows unelevated restricted-token sandbox cannot enforce deny-read restrictions directly; refusing to run
  unsandboxed". That is fail-closed, but it means: do not add the profile to the user config of anyone on the
  unelevated sandbox, or Codex will not open. The admin-installed Windows sandbox and WSL2 are untested here.

## Project config

The skill does not create or edit `.codex/config.toml`. If one exists, list its relevance in the Phase 0 summary
(e.g. it sets `sandbox_mode`, which would disable profiles) and leave changes to the user.

## Live operation notes (Codex 0.160.1, Windows)

- Subagents are enabled by default in current releases (`agents.enabled` defaults to true). The project custom agent
  `reviewer` ran from `.codex/agents/reviewer.toml` when asked: "Spawn the reviewer custom agent to review the range
  <a>..<b>." Judge success by the thread name in `/agent` (`/root/reviewer`): in one run Codex created an ad-hoc
  agent (`/root/review_range`) and still reported "the reviewer custom agent completed".
- User-level skills are visible to Codex even with a custom `CODEX_HOME`, including nested
  `~/.agents/skills/synced/<id>/` folders. Disable copies with `[[skills.config]]` entries (`path = '<…>/SKILL.md'`,
  `enabled = false`) in a profile and start Codex with `-p <profile>`. During acceptance tests disable every unrelated
  user skill; otherwise a session can load them (observed: a user-level code-review skill was read).
- A long `CODEX_HOME` path breaks the background server ("path must be shorter than SUN_LEN"); sessions still work.
  Use `--no-daemon`. Do not copy `CODEX_HOME` to a short path: it duplicates credentials, and a copied folder outside
  the user profile inherits non-private permissions, which Codex rejects.

## Load verification (Codex session)

- Start Codex at the repo root; ask it to quote the first bullet of the `critical-rules` block. It must match.
- Ask it to spawn `reviewer` on a tiny range and state where its definition came from (`.ai/agents/reviewer.md`).
- Run the canary protocol from `references/security.md` through Codex's shell tool.
- Confirm only one `project-setup` skill is discoverable.
