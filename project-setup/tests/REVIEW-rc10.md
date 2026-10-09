# rc.10 scoped Windows review → rc.11

Evidence: rc10-review-evidence.zip (Windows 11 10.0.26100, Node 24.14.1, Git 2.53.0.windows.2). Windows suite on rc.10:
53 PASS, 0 FAIL, 1 SKIP (R13d). Live checks requested for rc.10 (migrate-v1 approvals, detect synced/override,
canary dedup): PASS.

Reproduction on Linux (Node 22.22.2, git 2.43.0): `review-rc10-adversarial.mjs` unchanged on rc.10 → exit 1 with the
same six violating cases; both control groups pass. Agreed with all four findings.

| Finding | Fix | Test |
|---|---|---|
| P1 secret-input junction alias | canonical-destination + spelling check, refuse unresolvable, read canonical path | R35 (aliases in/out of repo, direct control, unresolvable, ordinary-input control) |
| P2 unrelated namespaced override | exact runtime identity; plugin skills never disabled by overrides | R36 |
| P2 linked skill folders undetected | follow direct links, dedup by target, no recursion through links | R37 (cycle, dangling link, two links one target) |
| P2 malformed user permissions dropped | present-but-malformed value is user content | R38 (4 shapes + control) |

Evidence: rc.11 suite on unmodified rc.10 fails R35–R38. rc.11: 57 PASS, 1 SKIP (R23b, no PowerShell here) on Linux.
GPT's `review-rc10-adversarial.mjs` unchanged on rc.11: exit 0, all 8 groups pass; `review-adoption.mjs`: exit 0.

Not verified: rc.11 on Windows (R35/R37 use real junctions there); live sessions (none of the changed code paths need
a new live run beyond re-running detect in fixture-v1).
