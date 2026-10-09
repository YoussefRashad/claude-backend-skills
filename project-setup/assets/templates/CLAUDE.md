@AGENTS.md

<!-- project-setup:begin id=claude -->
## Claude Code

- Shared rules live in AGENTS.md (imported above). Put only Claude-specific notes here.
- Subagents: `reviewer`, `docs-sync` in `.claude/agents/`; both load their canonical definition from `.ai/agents/`.
- Secret paths are enforced by `permissions.deny` in `.claude/settings.json`; treat a denial as final.
<!-- project-setup:end id=claude -->
