# {{PROJECT_NAME}}

<!-- project-setup:begin id=overview -->
{{ONE_LINE_PURPOSE}}

Stack (from manifests, not guessed): {{STACK_WITH_VERSIONS}}
Package manager: {{PACKAGE_MANAGER}} · Runtime: {{RUNTIME_VERSION}}
<!-- project-setup:end id=overview -->

<!-- project-setup:begin id=critical-rules -->
## Critical rules (apply to every task, every agent)

- Never read, print, copy, or summarize files matching `.ai/security-paths.json`
  (`.env*`, keys, certificates, `secrets/`, `credentials/`, …), by any tool, command, or script.
  Read diffs and history only via `node .ai/tools/git-safe.mjs diff|log|show …`.
  Env variable names come from config/validation code or the project-setup `env-keys` script, never from env files.
- Never log or return personal data or secrets. Redact before logging.
- Money, balance, payment, and points flows: no read-modify-write without a lock or atomic statement;
  no retry without proven idempotency. See `.ai/context/critical-modules.md`.
- Every endpoint validates input and enforces authorization explicitly.
- Database changes follow the project's own policy: {{DB_CHANGE_POLICY}}.
- Do not change unrelated code. Prefer existing patterns and services over new abstractions.
<!-- project-setup:end id=critical-rules -->

<!-- project-setup:begin id=commands -->
## Commands

{{VERIFIED_COMMANDS}}
<!-- project-setup:end id=commands -->

<!-- project-setup:begin id=navigation -->
## Where to look (read on demand, not all at once)

| Need | Read |
|---|---|
| Module map, dangerous modules | `.ai/context/project-tree.md` |
| Conventions to copy | `.ai/context/code-patterns.md` |
| Error shapes / status codes | `.ai/context/error-contract.md` |
| Money / auth / PII modules | `.ai/context/critical-modules.md` |
| Configuration (names only) | `.ai/context/configuration.md` |
| Terms | `.ai/context/glossary.md` |
| API conventions | `docs/api-conventions.md` |
| Database conventions | `docs/database.md` |
| Decisions and their evidence | `.ai/decisions/README.md` |
| Open questions and known gaps | `TODO.md` |
<!-- project-setup:end id=navigation -->

<!-- project-setup:begin id=local-instructions -->
## Directory-specific instructions

Before changing files under these paths, read the listed file first (tools do not all load them automatically):

{{NESTED_INSTRUCTION_INDEX}}
<!-- project-setup:end id=local-instructions -->

<!-- project-setup:begin id=agents -->
## Shared agents

- `reviewer`: evidence-based review. Definition: `.ai/agents/reviewer.md`.
- `docs-sync`: update docs after merged changes. Definition: `.ai/agents/docs-sync.md`.

Both tools run the same definitions through thin wrappers (`.claude/agents/`, `.codex/agents/`).
When a review or doc sync is requested, use these named agents (`reviewer`; `docs-sync` in Claude, `docs_sync` in
Codex). Do not create an ad-hoc agent for the same job.
<!-- project-setup:end id=agents -->
