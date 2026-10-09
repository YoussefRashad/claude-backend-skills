# Final report

Use this structure. Keep it factual; every claim maps to something observed in this run.

```
## project-setup v2 — <mode> — <repo> @ <short sha>

### Files
| File | Status (created / merged / unchanged / skipped) | Ownership | Lines |

### Decisions taken with the user
- conflicts resolved, allow-listed commands and why, items deliberately skipped

### Validation (validate.mjs)
pass N · warn N · fail N  — list every warn/fail

### Capability report
<table from references/security.md §5; "not verified" where it was not observed>

### Security findings (names and file:line only)
- tracked secret files, possible real values in env templates, scanner findings, ineffective rules, legacy hooks

### Manual steps for the user
- Codex profile snippet: paste after removing legacy sandbox settings (only if they want Codex deny-read)
- verification steps for the tool not run in this session
- retiring v1 copies, deleting .claudeignore, rotating any secret found in history

### TODO.md
- counts per section; the top 3 items

### Rollback
node <SKILL_DIR>/scripts/apply.mjs rollback --run-id <id>   (available until cleanup)
```

Never write "secure", "protected", or "no secrets" without the scope: which tool, which layer, which version,
which paths.
