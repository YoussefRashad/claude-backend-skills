<!--
FROZEN 2026-10-17 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Component plan C2 (lands third, after C11a and C1) under the frozen architecture plan
docs/plans/2026-10-15-project-setup-v3-rc1.md, which takes precedence. Drafted by the plan lane
(Codex, 2 revisions, applying maintainer decisions D1-D4); plan-critique (Claude) round 2 found no
BLOCKING gap. The addendum at the end records the maintainer's decisions on round 2's items.
-->

# C2: ownership, metadata transactions and draft review

Proposed freeze file: `docs/plans/2026-10-17-project-setup-v3-rc1-c2.md`.

Repository: `D:/ContactRepos/claude-backend-skills`.
Branch: `feat/project-setup-v3-rc1`.
Verified HEAD: `8b3f1c4`.
Revision: round 2, incorporating maintainer decisions D1-D4 dated 2026-10-17.

Landing order:

```text
C11a -> C1 -> C2 -> C3 -> C4 -> C5 -> C6 -> C7 -> C8 -> C9 -> C10 -> C11b
```

This lane changed no files, ran no tests or fixtures, and used no network services.
`AGENTS.md`, `.ai/agents/` and `.ai/security-paths.json` remain absent. No secret files were
opened.

## 1. Scope and dependencies

The authority is the frozen architecture plan
`docs/plans/2026-10-15-project-setup-v3-rc1.md`: section 2 C2, section 4 C2 assertion rows,
section 5 C2, section 6, and its freeze addendum.

The design authority is A6, the rc.1 portions of B5/B6, and Q1, Q2, Q6, PQ1 and PQ2.
Maintainer decisions D1-D4 are consistent with that scope.

C2 provides:

- File-specific ownership metadata schemas for policy, permissions and hook identities.
- Manifest schema 3 and non-writing acceptance of valid schema-2 migration input.
- Separate content and explicit metadata operations in one prepared plan and journal.
- Exact omission records stored separately from installed managed entries.
- Approval for removals, reordering, ownership changes and omissions despite unchanged bytes.
- Binding of approved inputs, including unchanged consumers.
- Read-only draft review with an explicit filesystem root and no Git invocation.
- Minimal detect/validate manifest compatibility reporting.
- C2 component assertions and baseline regression integration.

C2 does not provide:

- C3 policy migration, baseline classification, rendering, deny ownership or reader-version gate.
- C6 hook installation, actual-settings identity collision checks, merge, order or options tests.
- C7 allow classification, retirement decisions or reconciliation producer.
- C8 general instruction migration or Q6 migration documentation.
- C10 full installed-state, baseline, snippet or hook validation.
- Deferred B5 missing-entry checks.
- Deferred B6 integrity, block keep/adopt/replace or generic unchanged-file adoption.
- New matching or identity semantics.
- Release/version changes assigned to C11b.

C1 remains unchanged. C2 uses its `policyEntryKey`, `readSecurityPolicy`,
`parseSecurityPolicy`, `matchesPolicyPath` and `validateRepoPath`. It does not duplicate them.

## 2. Files touched and interfaces

Paths are relative to `project-setup/`. Existing line numbers refer to `8b3f1c4`.

| Existing file and region | Change |
| --- | --- |
| `scripts/apply.mjs:1-76` | Document and dispatch diff before root discovery. |
| `scripts/apply.mjs:118-150` | Safe inventory; split lock checking from heartbeat. |
| `scripts/apply.mjs:157-161` | Validate loaded manifests. |
| `scripts/apply.mjs:232-360` | Prepare operations, requests, bindings and approvals. |
| `scripts/apply.mjs:363-470` | Recheck inputs; commit prepared manifest last. |
| `scripts/apply.mjs:473-533` | Retain recovery for metadata-only journals. |
| `scripts/apply.mjs:536-572` | Retain lifecycle reporting; extend usage. |
| `scripts/lib.mjs:68-73` | Add explicit filesystem-root establishment. |
| `scripts/lib.mjs:223-256` | Use that context without Git fallback. |
| `scripts/lib.mjs:336-355` | Retain safe reads/writes in that context. |
| `scripts/lib.mjs` | Add the extracted pure environment-template classifier. |
| `scripts/schemas.mjs:1-3,52-74` | Share manifest and ownership validation. |
| `scripts/detect.mjs:84-87,268-286,323` | Report manifest compatibility without fallthrough. |
| `scripts/validate.mjs:12,28-38,93-101` | Report legacy update state; gate invalid metadata use. |
| `scripts/env-keys.mjs:10-46` | Call the extracted classifier. |
| `references/state-and-apply.md:3-19,26-57,123-126` | Ownership, metadata and safe review text. |
| `tests/rc1-cases.mjs:9-10,34-69` | Implementer registers C2 in both maps. |
| `tests/run-tests.mjs:400-418` | Tests lane embeds C2 execution in R15. |
| `tests/run-tests.mjs:1153-1175` | Tests lane adds S01/S02 schema-3 assertions. |

New files:

| File | Owner |
| --- | --- |
| `scripts/ownership.mjs` | Implementer. |
| `tests/c2.test.mjs` | Tests lane; implementer must not edit. |

The tests lane also owns the R15/S01/S02 edits above. The implementer must not edit them.
Test fixtures and preloads are generated under `context.tmp`; no checked-in fixture is needed.

Verified call sites:

```text
apply.mjs:42       const root = repoRoot();
lib.mjs:68        let REPO_ROOT = null;
lib.mjs:69-71     repoRoot(), with git rev-parse at line 70
lib.mjs:228       secureDir()
lib.mjs:231       if (!REPO_ROOT) repoRoot(root);
```

The frozen reference to `lib.mjs:216` identifies the fallback now at line 231.

### 2.1 API conventions

New pure functions are synchronous. They perform no filesystem access, spawning, writes,
output, exit or environment lookup. They do not mutate inputs. Returned JSON data is detached
and mutable.

Supported inputs are JSON data. C2 adds no separate Proxy/accessor framework. C1 retains its
own input protections.

New modules are import-safe: importing them runs no tests, subprocesses, writes, output,
CLI dispatch, exit or exit-code changes.

`ownership.mjs` exports exactly:

```typescript
readManagedMetadata(target: string, value: unknown): ManagedMetadata;

readOmissions(target: string, value: unknown): Omissions;

hookIdentity(value: unknown): string;

isPolicyOmitted(entry: unknown, omittedEntries: unknown): boolean;

readManifest(value: unknown): {
  sourceSchema: 2 | 3;
  needsUpdate: boolean;
  manifest: object;
};
```

`lib.mjs` retains its existing exports and adds:

```typescript
setFilesystemRoot(value: unknown): string;

classifyEnvTemplate(text: string): Array<{
  name: string;
  line: number;
  valueState:
    | "empty"
    | "placeholder"
    | "possible-real-secret"
    | "non-placeholder";
}>;
```

`setFilesystemRoot` is filesystem-dependent; section 6 defines it.

`classifyEnvTemplate` moves the current parser from `env-keys.mjs` without changing its
regular expressions, duplicate handling, line numbering, ordering or classifications.

Non-string input throws:

```text
code: ENV_TEMPLATE_TEXT
message: ENV_TEMPLATE_TEXT: text must be a string
```

`env-keys.mjs` uses the helper. Its existing CLI behavior and output remain unchanged.

`schemas.mjs` retains its existing exports and return conventions:

```typescript
checkClaudeSettings(value): Array<{ level: string; msg: string }>;
checkManifest(value): string[];
checkSecurityPolicy(value): string[];
```

`checkManifest` calls `readManifest`, returning `[]` on success and its `issues` array on a
recognized manifest error. Unrelated exceptions propagate.

### 2.2 Later-component dependencies

| Consumer | C2 interface |
| --- | --- |
| C3 | Policy/settings schemas, omission identity, request files and transaction bindings. |
| C6 | `hookIdentity`, settings metadata schema and transaction interface. |
| C7 | Managed allow strings, allow omissions and metadata-only approval. |
| C8 | `apply diff`, review text and approval behavior. |
| C10 | `readManifest`, shared validators and compatibility reporting. |

C3/C6/C7 stage requests through section 4. They do not receive another manifest writer.
C8 consumes the CLI rather than requiring another JavaScript export.

C2 commits content operations in prepared-plan order. C3 owns reader-first ordering for coupled
policy/tool migrations and may change prepare's ordering without changing this commit contract.

## 3. Ownership and manifest schemas

### 3.1 Managed policy metadata

Only `.ai/security-paths.json` accepts:

```typescript
{
  schema: 1 | 2;
  patterns: Array<{
    anchor: "any" | "root";
    glob: string;
    [key: string]: Json;
  }>;
}
```

Both fields are required in a policy managed-metadata request. Other container fields are
rejected.

Entries retain all JSON fields, original spelling and order. They are complete records, not
glob strings or deduplicated effective entries.

Validate the equivalent policy with `projectPatterns: []` through C1. Schema-1 entries in
metadata carry explicit, correctly inferred anchors; C1 checks their consistency.

Schema-1 support allows approved ownership metadata for unchanged legacy policy bytes.
It does not perform C3's policy content migration.

Managed metadata covers policy `schema` and `patterns`. It does not own `projectPatterns`,
`contentRisk`, scan settings or other file fields.

Duplicate policy identities remain representable and retain their full source records.
C1 deduplicates effective matching, not stored metadata.

### 3.2 Managed settings metadata

Only `.claude/settings.json` accepts:

```typescript
{
  "permissions.allow"?: string[];
  "permissions.deny"?: string[];
  hooks?: Array<{
    event: string;
    matcher: string;
    command: string;
  }>;
  heldBack?: string[];
}
```

The object may be empty. Present fields must have the declared types. Unknown fields, including
`permissions.ask`, are rejected.

Permission identity is the exact string within its named array. No case folding or rewriting
occurs. Order and duplicate strings are preserved.

`heldBack` is existing v2 auxiliary metadata. It records neither ownership nor approved
omissions. A heldBack-only change is an explicit metadata change, but is not a managed-list
change and does not require path approval.

Hook identities contain exactly the three declared fields. `event` and `command` are nonempty
strings. `matcher` may be empty. No trimming or case normalization occurs.

```javascript
hookIdentity(value) ===
  JSON.stringify([value.event, value.matcher, value.command])
```

Duplicate managed hook identities are rejected. Different event or matcher values distinguish
identities even when commands match. Options such as `timeout` are not identity fields.

C2 validates this representation. C6 owns nested-settings matching, actual hook collisions,
merging, order and option preservation.

### 3.3 Preservation rules

Validation does not sort arrays or discard unrelated JSON fields.

Metadata-only operations preserve policy/settings bytes exactly. They preserve unrelated
manifest fields, unrelated file records and existing block hashes.

Requests do not implicitly derive one metadata collection from another:

- Changing managed entries does not delete omissions.
- Adding an omission does not remove a managed entry.
- Missing request targets preserve their prior record.
- Missing settings or omission fields preserve their prior field.
- A policy managed request must supply both required fields; it is not a partial policy patch.

An explicit ownership transition replaces the ownership-specific fields with those appropriate
to the new kind. Unrelated record extension fields survive. Any removal of omission data is an
explicit reviewed change, never a side effect of changing a managed list.

Existing content protections remain. C2 does not add a settings merger. Its append-only
settings check still requires approval for removal, reordering, changed hook options or changed
unrelated settings.

Use this exact settings object in M4/M5:

```json
{
  "permissions": {
    "allow": ["Bash(user-one)", "Bash(user-two)"],
    "deny": ["Read(user-one)", "Read(user-two)"],
    "defaultMode": "default"
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{"type": "command", "command": "user-one", "timeout": 17}]
      }
    ]
  },
  "custom": {"keep": [2, 1]}
}
```

Serialize it with two-space indentation and LF before preparing the reconciliation.
M4/M5 assert raw-byte equality before/after commit, including hook options, user order and
unrelated fields.

### 3.4 Omissions

Omissions are stored in the file record's optional `omissions` field, separately from `managed`.

Policy omissions:

```typescript
{
  patterns?: Array<{
    anchor: "any" | "root";
    glob: string;
    [key: string]: Json;
  }>;
}
```

Settings omissions:

```typescript
{
  "permissions.allow"?: string[];
  "permissions.deny"?: Array<{
    anchor: "any" | "root";
    glob: string;
    [key: string]: Json;
  }>;
}
```

Deny omissions identify source policy entries. C3 supplies and consumes that association;
C2 does not reverse-parse Claude rule strings. Allow omissions identify exact permission
strings and are consumed by C7.

Unknown fields, wrong types and duplicate omission identities are rejected. Empty objects and
arrays are valid. Hook omission workflows remain outside rc.1.

`readOmissions` validates and returns a detached copy, preserving entry spelling and fields.

`isPolicyOmitted` validates the candidate through C1, validates the entire omission array,
rejects duplicate identities, then compares C1 keys:

```javascript
JSON.stringify([entry.anchor, entry.glob.toLowerCase()])
```

Identity does not apply filesystem aliases, Unicode normalization or coverage inference.

Required results:

```text
omitted any "**/.ENV.*", candidate any "**/.env.*" -> true
omitted any "**/.env.*", candidate any "**/.env*"  -> false
omitted root "env/**", candidate root "ENV/**"     -> true
omitted root "env/**", candidate any "**/env/**"   -> false
```

Replacement coverage is a new decision supplied by C3.

### 3.5 Manifest schema 3

Newly written manifests have:

```typescript
{
  schema: 3;
  skill: "project-setup";
  skillVersion: string;
  mode: string;
  agents: string[];
  sourceCommit: string | null;
  files: {
    [repoRelativePath: string]:
      | {
          ownership: "full";
          sha256: string;
          [key: string]: Json;
        }
      | {
          ownership: "blocks";
          blocks: { [blockId: string]: string };
          [key: string]: Json;
        }
      | {
          ownership: "keys";
          managed: ManagedMetadata;
          omissions?: Omissions;
          [key: string]: Json;
        }
      | {
          ownership: "merged";
          [key: string]: Json;
        };
  };
  codexSnippetSha256?: string;
  [key: string]: Json;
}
```

Rules:

- Shown non-optional fields are required.
- Hashes are exactly 64 lowercase hexadecimal characters.
- Strings receive no new mode, version or agent allowlist.
- `sourceCommit` is a string or null; validation performs no Git lookup.
- File keys pass C1 structural path validation.
- `.ai/manifest.json` cannot be its own file record.
- `keys` supports only the two declared policy/settings files.
- `omissions` supports only `keys` records and the corresponding file schema.
- `codexSnippetSha256` remains absent until supplied; do not synthesize null.
- Preserve JSON extension fields; known fields retain their declared validation.
- Do not add or recalculate `integrity`.
- Secret-template records retain `merged` ownership and the existing explanatory note.
- Serialize with `JSON.stringify(value, null, 2) + "\n"`.

File-map keys use ascending JavaScript string order. This intentionally replaces v2's
`localeCompare` ordering; for example, `TODO.md` precedes `docs/a.md`. It changes serialization
order during a real write, not ownership or array order. Genuine no-op manifests are not
reserialized.

`readManifest` returns the original schema, `needsUpdate: schema === 2`, and a detached copy.
It performs no migration.

### 3.6 Schema-2 input

Valid schema-2 input retains v2 structural requirements:

- Object root; schema 2; skill `project-setup`.
- String `skillVersion`; string-array `agents`; object `files`.
- Valid ownership discriminator and corresponding hash/block/managed types.

Apply shared file-specific checks to legacy keys metadata, including `heldBack`.

Legacy `mode` and `sourceCommit` may be absent. When present, they must have schema-3 types.
Prepare supplies current plan values when writing schema 3.

Conversion preserves unrelated records and old block hashes. A legacy full-owned policy
remains full-owned unless an explicit request changes it. Current bytes do not establish
ownership.

Unknown schemas fail explicitly. Non-object roots fail root validation before schema
validation. Invalid legacy data does not receive a successful "needs update" classification.

### 3.7 Detect and validate reporting

Detect remains an inventory command: exit 0 and top-level `ok: true` after successful inventory,
including when it reports an invalid manifest. No `lib.ok` contract changes.

For a present manifest, `ai.manifest` always contains:

```typescript
{
  schema: number | null;
  skillVersion: string | null;
  mode: string | null;
  status: "needs update" | "current" | "invalid";
  needsUpdate: boolean;
  errors: string[];
}
```

Summary fields use their declared primitive type when present; otherwise null.
They do not copy arbitrary manifest values.

| Manifest state | Top-level detect mode | Status | needsUpdate |
| --- | --- | --- | --- |
| Valid schema 2 | `update` | `needs update` | true |
| Valid schema 3 | `update` | `current` | false |
| Present but invalid | `invalid` | `invalid` | false |
| Absent | Existing discovery behavior | `ai.manifest: null` | Not present |

Valid-schema evidence is exactly:

```text
.ai/manifest.json schema 2
.ai/manifest.json schema 3
```

Invalid-manifest evidence is:

```text
.ai/manifest.json is invalid
```

Invalid manifests add this warning:

```text
invalid .ai/manifest.json; repair or restore it before setup
```

They never fall through to fresh/adopt/migrate-v1 classification.

A JSON parse error yields:

```json
["manifest is not valid JSON"]
```

A null, array, string, number or boolean root yields:

```json
["root must be an object"]
```

Other invalid data reports the shared reader's actual `issues`. Valid data has `errors: []`.

For valid schema 2, validate includes:

```json
[
  {"level":"pass","check":"json-schema","detail":".ai/manifest.json"},
  {
    "level":"info",
    "check":"manifest-version",
    "detail":".ai/manifest.json: schema 2 needs update to schema 3"
  }
]
```

Other checks still run. An otherwise valid fixture exits 0. Info records do not increment
pass/warn/fail totals.

Schema 3 gets the schema pass and no manifest-version record. Invalid manifests get actual
json-schema failures, no update info, and exit 1. Manifest JSON parse errors retain the
json-syntax failure category, without printing source text.

Do not traverse manifest-derived paths when manifest validation failed. Neither command writes
the manifest. C10 extends these checks later.

## 4. Prepared transaction contract

### 4.1 Request files and combination rules

Run-local inputs are:

```text
ownership.json
managed-keys.json
omissions.json
manifest-metadata.json
transaction-inputs.json
```

Shapes:

```typescript
// ownership.json
{ [target: string]: "full" | "blocks" | "keys" | "merged" }

// managed-keys.json
{ [target: string]: ManagedMetadata }

// omissions.json
{ [target: string]: Omissions }

// manifest-metadata.json
{ codexSnippetSha256?: string }

// transaction-inputs.json
string[]
```

Missing files mean no request. Present null is invalid. Empty objects/lists are valid.

Known targets are the union of draft/vault targets and prior manifest file keys. An input-list
entry does not make an unknown metadata target known.

Additional transaction inputs must be unique, structurally valid project-relative paths within
the existing documentation/configuration write scope. Reject secret and run-internal paths.
Compute hashes in the engine; do not accept caller-supplied hashes. Missing additional inputs
bind null, so later appearance is drift.

Resulting ownership is explicit ownership, otherwise prior ownership, otherwise v2 inference
for a content write. For an unchanged unrecorded target, there is no inferred ownership.

In the table, `M` means a valid supplied managed request, `O` a valid omission request, and `-`
means no request for that target.

| Prior record | Ownership request | Managed | Omissions | Result |
| --- | --- | --- | --- | --- |
| keys | - or keys | - | - | Prior record unchanged. |
| keys | - or keys | M | - | Merge/replace managed fields as defined below. |
| keys | - or keys | - | O | Preserve managed; merge omission fields. |
| keys | - or keys | M | O | Apply both independently. |
| full policy | keys | Complete policy M | - or O | Keys record; approved ownership transition. |
| full policy | - or full | M | Any | `APPLY_METADATA_OWNERSHIP`. |
| Any resulting non-keys | Any | - | O | `APPLY_METADATA_OWNERSHIP`. |
| No prior, known settings | keys | - | - or O | `managed: {}`; apply O if present. |
| No prior, known policy | keys | - | Any | `APPLY_METADATA_REQUIRED`. |
| No prior, known policy | keys | Complete policy M | - or O | Keys record with M and optional O. |
| No prior, known settings | keys | M | - or O | Keys record with M and optional O. |
| No prior, unchanged target | - | M or - | O or - | Requests require explicit keys ownership. |
| Unknown target | Any | Any | Any | `APPLY_METADATA_UNKNOWN`. |

For the unchanged/no-prior row:

- No requests at all leave the target unrecorded.
- Managed/omission requests without explicit keys ownership produce
  `APPLY_METADATA_OWNERSHIP`.

All table errors name the affected project target in prepare's error entry.

A keys request with no managed request preserves existing valid keys metadata. If no such
metadata exists, settings may use `{}`; policy fails `APPLY_METADATA_REQUIRED`.

Combination semantics:

- A supplied settings managed object patches its present fields.
- Missing settings fields preserve prior fields.
- A supplied policy managed object must contain both schema and patterns and replaces that
  managed container. Missing either field fails shared validation; do not merge it into validity.
- An omission object patches its present fields; absent fields survive.
- An empty settings or omission object has no fields to apply.
- A present empty array is an explicit replacement, not absence.
- heldBack changes are stored and reported but require no settings approval.
- Requests resulting in a non-keys record cannot carry managed or omission requests.
- Generic unchanged-file ownership adoption remains unsupported.
- An explicit transition out of keys ownership is supported only with a content write; its
  complete record change, including removal of keys-specific fields, requires approval.

There are no `approved` booleans or caller-supplied approval lists in these files.

### 4.2 What is a metadata operation

D4 applies: automatic manifest records resulting from content writes remain in `manifestAfter`
and are not listed in `metadataOps`.

| Change | Content op | metadataOps |
| --- | --- | --- |
| Ordinary file create/modify and automatic baseline recording | Yes | None for that record. |
| Initial ownership/managed metadata for a written unrecorded target | Yes | None for that record. |
| Explicit change to existing ownership/managed metadata | Optional | One file op. |
| heldBack-only change | Optional | One file op; approval false. |
| Explicit omission change | Optional | One file op. |
| Several explicit changes to one record | Optional | One combined file op. |
| Schema 2 -> 3 | Optional | One manifest op. |
| Changed supplied snippet hash | Optional | One manifest op. |
| Schema conversion and snippet change together | Optional | One combined manifest op. |
| Header refresh caused only by content/file-metadata work | Optional | No manifest op. |
| Fresh manifest creation caused only by content writes | Yes | No manifest op. |
| Identical requests | Optional | None for those requests. |
| Unchanged unrecorded target, no explicit request | Unchanged | No record and no metadata op. |

The final row intentionally changes v2 behavior: an unchanged unrecorded draft no longer gains
an automatic record merely because another target changes. This avoids silent adoption.
Explicit supported keys metadata for such a known target creates a file metadata operation.

An omission request is explicit metadata, including on a newly written target. It is never
hidden in automatic content bookkeeping.

A manifest op is emitted only for an existing schema-2 conversion or a changed supplied snippet
hash. Changes to mode, agents, sourceCommit or skillVersion alone do not emit one.

### 4.3 Plan shape and ordering

Retain existing headers and add `planSchema: 2`:

```typescript
{
  planSchema: 2;
  runId: string;
  mode: string;
  agents: string[];
  skillVersion: string;
  host: string;
  preparedAt: string;
  head: string | null;
  manifestPreRawSha: string | null;

  metadata: {
    ownershipSha256: string | null;
    ownership: object | null;
    managedKeysSha256: string | null;
    managedKeys: object | null;
    omissionsSha256: string | null;
    omissions: object | null;
    manifestMetadataSha256: string | null;
    manifestMetadata: object | null;
    transactionInputsSha256: string | null;
    transactionInputs: string[] | null;
  };

  ops: ContentOperation[];
  metadataOps: MetadataOperation[];
  inputs: Array<{ target: string; preRawSha: string | null }>;
  sourceInventory: Array<{ target: string; origin: "draft" | "vault" }>;
  manifestAfter: object | null;
}
```

There is no `policySpecSha256`. C3 owns tool/version compatibility.

Every content operation, including unchanged, has:

```typescript
{
  target: string;
  origin: "draft" | "vault";
  source: string;
  sourceSha256: string;
  action: "create" | "modify" | "unchanged";
  preRawSha: string | null;
  eol: "\n" | "\r\n";
  linesBefore: number | null;
  linesAfter: number | null;
  uncommittedUserChanges: boolean;
  userContentChange: boolean;
  userContentReasons: string[];
}
```

Sources are run-relative `drafts/<target>` or `vault/files/<target>`.
Unchanged operations no longer use the old truncated representation.

Metadata operations have:

```typescript
{
  kind: "file" | "manifest";
  target: string;
  before: object | null;
  after: object;
  requiresApproval: boolean;
  reasons: string[];
}
```

File before/after values are complete records. Manifest before/after values are headers
excluding `files`; target is `.ai/manifest.json`.

File metadata operations are sorted by target, followed by the optional manifest op.
Inputs and source inventory are sorted by target. Sorting uses JavaScript string order.

C2 prepare initially orders content operations by target. Commit applies the order stored in
the approved plan, without sorting it again. C3 owns reader-first migration ordering.

Inputs include every content target, every file metadata target, additional declared inputs,
and the installed project policy, including its absence. Deduplicate by target.

All five request files bind presence and raw bytes separately. Every source binds its raw bytes.
Source inventory binds additions/removals.

`manifestAfter` is the exact object to serialize. It is null only for a genuine no-op.
Commit does not reconstruct baselines from current target bytes.

Pre-C2 plans lacking `planSchema: 2` fail with `APPLY_PLAN_SCHEMA`. Re-prepare is permitted
when no journal exists. Existing v2 journals remain recoverable.

### 4.4 Manifest construction and exact operation examples

Start from prior manifest data. Preserve unchanged recorded files and their old block hashes.
Compute automatic records for actual content writes from approved source bytes.

Apply explicit metadata requests using section 4.1. Preserve unrelated record extensions.
Do not infer managed entries from current policy/settings bytes.

If any content or explicit metadata work exists, update the normal manifest headers from the
plan. Otherwise leave the manifest unchanged, including mode, version and sourceCommit.

A schema-2 conversion itself is metadata work. A fresh empty run creates no manifest.

For M1, M3, M5 and M6, start from a genuine schema-2 fixture. For M7, start from schema 3.

Define:

- `Hbefore`: prior manifest without files.
- `Hafter`: resulting manifest without files.
- `Pbefore`: prior policy file record.
- `Pafter`: requested keys policy record with preserved extensions.
- `Sbefore`: prior settings file record.
- `Safter`: explicitly requested settings record.

Exact `metadataOps`:

```typescript
// M1: schema-only conversion
[
  {
    kind: "manifest",
    target: ".ai/manifest.json",
    before: Hbefore,
    after: Hafter,
    requiresApproval: false,
    reasons: []
  }
]

// M3: unchanged policy full -> keys, plus schema conversion
[
  {
    kind: "file",
    target: ".ai/security-paths.json",
    before: Pbefore,
    after: Pafter,
    requiresApproval: true,
    reasons: ["policy ownership or managed metadata changes"]
  },
  {
    kind: "manifest",
    target: ".ai/manifest.json",
    before: Hbefore,
    after: Hafter,
    requiresApproval: false,
    reasons: []
  }
]

// M5 and M6: deny metadata removal plus omission, and schema conversion
[
  {
    kind: "file",
    target: ".claude/settings.json",
    before: Sbefore,
    after: Safter,
    requiresApproval: true,
    reasons: [
      "settings ownership or managed metadata changes",
      "approved omission records change"
    ]
  },
  {
    kind: "manifest",
    target: ".ai/manifest.json",
    before: Hbefore,
    after: Hafter,
    requiresApproval: false,
    reasons: []
  }
]
```

M6 additionally writes a document. Its automatic document record does not add a metadata op.

M7 uses the same settings request on a schema-3 fixture with an unchanged settings draft.
Its metadataOps is only the first M5 file op.

Thus:

```text
M1 metadataChanged = 1
M3 metadataChanged = 2
M5 metadataChanged = 2
M6 metadataChanged = 2
M7 metadataChanged = 1
```

Fresh S01 has no omissions, snippet request or legacy conversion. Its initial settings metadata
is automatic recording for a written unrecorded target:

```text
S01 metadataChanged = 0
```

### 4.5 Approval rules

D1 applies. Append-only managed-list updates require plan-hash approval but no additional
`--approve-user-content`.

An existing managed list is append-only when the old array is an exact prefix of the new array.
Compare complete policy records, permission strings and hook identity records as JSON values,
ignoring object key order. Preserve array order and duplicates.

Replacement of an existing element is removal plus addition, not append-only. Changing the
recorded policy schema is an ownership-schema change.

Require path approval for:

- Ownership changes on a previously recorded target.
- Managed entry removal, replacement or reordering.
- Policy managed-schema changes.
- Omission changes.
- Existing content changes that already required approval in v2.

Initial metadata for a target with no previous manifest record requires no extra metadata
approval, even when the target file already exists. Existing content rules still apply.
R29(d) is the regression guard: appending managed settings entries to pre-existing unrecorded
settings must pass strict prepare without path approval.

heldBack-only changes require no path approval.

Reason strings are:

```text
policy ownership or managed metadata changes
settings ownership or managed metadata changes
approved omission records change
```

Include only approval-requiring reasons, in that order. Append-only and heldBack-only metadata
operations have `requiresApproval: false` and `reasons: []`.

One path approval covers content and metadata reasons for that target. An unchanged content
operation never suppresses metadata work.

Metadata-only missing approval has code `APPLY_APPROVAL_REQUIRED` and this CLI error:

```text
metadata changes require --approve-user-content <target>
```

For content-only approval errors, retain the existing message:

```text
<content reasons>. Show the diff; re-run prepare with --approve-user-content <target> only after the user approves it
```

For a target needing both approvals, emit one error entry. Its reasons are existing content
reasons followed by metadata reason strings, joined with `; `, followed by the same existing
`Show the diff` suffix.

Unrelated approvals retain the exact existing text:

```text
--approve-user-content names files that do not need it; refusing broad approvals
```

Code is `APPLY_APPROVAL_UNRELATED`. Reject `*`, directory prefixes and unrelated paths.
No glob expansion occurs.

Retain comma-separated CLI syntax and backslash-to-slash conversion for approval arguments.
Other relative inputs remain subject to C1's canonical-path rules.

### 4.6 Commit, no-op and journal

Commit order is fixed:

1. Read-only lock ownership check. Missing, malformed or wrong-owner lock exits 2.
2. Lifecycle check; used/unresolved runs exit 7.
3. Require plan and approved hash; compare raw plan bytes with that hash.
4. Validate plan schema/shape and embedded metadata; retain run-ID mismatch refusal.
5. Validate run-chain and path safety; unsafe paths exit 2.
6. Recheck all bindings; drift exits 4.
7. Return genuine no-op if no content writes and no metadata operations exist.
8. Refresh the lock heartbeat.
9. Initialize the journal, apply content in plan order, write manifest last, finish journal.

Split the current `requireLock` behavior into checking and heartbeat internally. No public
export or CLI flag is required.

This intentionally moves no-op detection after full precondition validation. It preserves the
v2 lockless-commit exit code while avoiding heartbeat writes on rejected/no-op commits.

Required cases:

```text
no-op commit without lock -> exit 2; no journal; lock bytes unchanged
no-op plan with drift    -> exit 4; no journal; lock bytes unchanged
valid M8 no-op           -> exit 0; no journal; lock bytes unchanged
```

The genuine no-op response remains:

```json
{
  "ok": true,
  "committed": false,
  "reason": "nothing to change (zero diff)"
}
```

A metadata-only commit writes/backups only `.ai/manifest.json`; no dummy policy/settings write.

Journal additions:

```typescript
metadataOps: MetadataOperation[];
```

Existing `entries` continue to represent actual writes only. One manifest precondition and one
journal cover all work. Do not create a separate metadata commit.

Retain exit meanings:

```text
0 success or genuine no-op
1 usage or invalid prepared-plan format
2 lock or filesystem path safety
3 prepare rejected
4 approved input drift; no project writes or journal
5 partial commit; recovery required
6 rollback incomplete; backups retained
7 written-run reuse or unresolved-run refusal
```

Rollback retains reverse write order, raw-hash checks and backup integrity. Metadata-only
rollback restores previous manifest bytes. Later manifest edits cause exit 6.

## 5. Errors and printed transaction output

### 5.1 Pure-function errors

New thrown errors are `Error` objects with an own string code. Their messages start with
`<code>: `. They contain no file body or native JSON parser excerpt.

| Code | Message |
| --- | --- |
| `OWNERSHIP_TARGET` | `OWNERSHIP_TARGET: unsupported target <target>` |
| `OWNERSHIP_SHAPE` | `OWNERSHIP_SHAPE: <location>` |
| `OWNERSHIP_FIELD` | `OWNERSHIP_FIELD: <location>` |
| `HOOK_IDENTITY` | `HOOK_IDENTITY: event, matcher and command are required` |
| `HOOK_DUPLICATE` | `HOOK_DUPLICATE: hooks[<index>]` |
| `OMISSIONS_SHAPE` | `OMISSIONS_SHAPE: <location>` |
| `OMISSIONS_DUPLICATE` | `OMISSIONS_DUPLICATE: <location>[<index>]` |
| `MANIFEST_SCHEMA` | `MANIFEST_SCHEMA: schema must be 2 or 3` |
| `MANIFEST_INVALID` | `MANIFEST_INVALID: invalid manifest` |
| `ENV_TEMPLATE_TEXT` | `ENV_TEMPLATE_TEXT: text must be a string` |

Validation order is target, container, unknown fields in sorted order, declared fields in schema
order, then array elements in index order.

For C2-owned type checks, an invalid array or invalid primitive element reports the array's
location, without an index. Duplicate checks report the duplicate's index. Hook element errors
use the fixed HOOK_IDENTITY message.

C1 errors propagate with C1's original code, message and location, such as `patterns[0]`;
do not rewrite them to `managed.patterns[0]`.

Additional exact outcomes:

```text
isPolicyOmitted(validEntry, null)
  -> OMISSIONS_SHAPE: omissions.patterns

hookIdentity(null), hookIdentity([]), or a non-object hook element
  -> HOOK_IDENTITY: event, matcher and command are required

readManifest(null), readManifest([]), or another non-object root
  -> code MANIFEST_INVALID
  -> message MANIFEST_INVALID: invalid manifest
  -> issues ["root must be an object"]
```

The candidate entry is validated before `isPolicyOmitted` checks its second argument.

Manifest errors carry `issues: string[]`:

- MANIFEST_SCHEMA: `["schema must be 2 or 3"]`.
- MANIFEST_INVALID: structural issues in existing common-field order, then sorted file order,
  then optional snippet hash.
- Retain existing v2 structural issue strings.
- File metadata issue:
  `files["<target>"].managed: <shared-validator-message>`.
- Omission issue:
  `files["<target>"].omissions: <shared-validator-message>`.
- Bad file key:
  `files["<target>"]: <C1-path-error-message>`.
- Self-record:
  `files[".ai/manifest.json"] must not record the manifest itself`.
- Invalid mode/source/snippet:
  `mode must be a string`,
  `sourceCommit must be a string or null`,
  `codexSnippetSha256 must be a sha256 hex`.

### 5.2 CLI envelopes, codes and precedence

All responses use two-space JSON indentation, one final LF and empty stderr, except unchanged
legacy commands whose existing contracts already specify otherwise.

Notation used in tests:

```typescript
// F: direct new failure
{ ok: false, code, error }

// P: prepare rejection
{
  ok: false,
  code: "APPLY_PLAN_REJECTED",
  error: "plan rejected",
  errors: [{ target, code, error }]
}
```

CLI error text is exactly the text in the tables; do not automatically prepend the code.
When propagating a pure-function error, preserve its already-prefixed message unchanged.

Every `<target>`, `<id>`, `<path>` and `<name>` placeholder is substituted. No angle-bracket
placeholder is printed literally, except `<SKILL_DIR>` in review instructions.

| Code | Exact CLI error |
| --- | --- |
| `APPLY_DIFF_USAGE` | `usage: apply.mjs diff --project <root> --run-id <id>` |
| `APPLY_ROOT` | `explicit project root is not a safe existing directory` |
| `APPLY_PATH` | `unsafe path: <path>` |
| `APPLY_RUN_MISSING` | `run <id> does not exist; run init first` |
| `APPLY_SECRET_TARGET` | See operation-specific text below. |
| `APPLY_VAULT_TARGET` | `vault files may only target .env.example/.env.sample/.env.template` |
| `APPLY_DIFF_TEXT` | `cannot render non-text draft: <target>` |
| `APPLY_INPUT_JSON` | `invalid JSON: <name>` |
| `APPLY_INPUT_SHAPE` | `invalid run metadata shape: <name>` |
| `APPLY_METADATA_TARGET` | `metadata-only adoption is not supported for <target>` |
| `APPLY_METADATA_UNKNOWN` | `metadata target is not in this plan or manifest: <target>` |
| `APPLY_METADATA_OWNERSHIP` | `managed or omission metadata requires keys ownership: <target>` |
| `APPLY_METADATA_REQUIRED` | `policy keys ownership requires complete managed metadata: <target>` |
| `APPLY_OWNERSHIP_VALUE` | `<target>: invalid ownership "<value>"` |
| `APPLY_DUPLICATE_TARGET` | `target appears in both drafts and vault` |
| `APPLY_MANIFEST_DRAFT` | `the manifest is written by commit, not drafted` |
| `APPLY_WRITE_SCOPE` | `write outside documentation scope: <target>` |
| `APPLY_WRITE_DENIED` | `write denied by policy: <target>` |
| `APPLY_TARGET_TYPE` | `target is not a regular file` |
| `APPLY_APPROVAL_REQUIRED` | Section 4.5. |
| `APPLY_APPROVAL_UNRELATED` | Section 4.5, including `; refusing broad approvals`. |
| `APPLY_PLAN_SCHEMA` | `unsupported prepared plan; run prepare again` |
| `APPLY_PLAN_INVALID` | `invalid prepared plan; run prepare again` |
| `APPLY_PLAN_REJECTED` | `plan rejected` |
| `APPLY_DRIFT` | See exact sentence below. |
| `APPLY_DIFF_IO` | `cannot read draft review input: <path>` |
| `APPLY_INPUT_IO` | `cannot read transaction input: <path>` |

Secret-target error text:

```text
diff:    refusing textual diff of secret target: <target>
prepare: agent drafts may not target secret-pattern paths
```

Drift error:

```text
changes since prepare; nothing was written. Re-run prepare and get approval again.
```

Prepare codes above cover existing per-target failures. Existing content reason text is
unchanged; its missing-approval entry now carries APPLY_APPROVAL_REQUIRED.

Existing lock, lifecycle, approved-plan-hash mismatch, rollback and partial-apply messages and
exit codes remain unchanged; their envelopes need no new `code` field.

Prepare error granularity:

- One error entry per affected target.
- A shape error that prevents resolving targets uses the run-input filename as target.
- A target with content and metadata approval requirements gets one combined approval entry.
- Within a target, structural/path/request errors take precedence over approval errors.
- Do not add an unrelated-approval error for a target already rejected for another reason.
- Sort target entries by JavaScript string order.
- Each unrelated approval gets its own target entry.

Immediate filesystem-safety failures use F with exit 2, including during prepare. They are not
downgraded into aggregate exit-3 errors.

Legacy prepare argument errors remain unchanged: invalid run ID exits 1 with the existing
invalid-run-ID message and no added code. For diff, invalid run ID is APPLY_DIFF_USAGE, exit 1.

### 5.3 Prepare output and drift arrays

Retain existing prepare fields, including `changed`, `unchanged`, `ops` and
`ownershipOverrides`. Add:

```typescript
metadataChanged: number;
metadataOps: MetadataOperation[];
```

`changed` counts create/modify content operations.
`unchanged` counts unchanged content operations.
`metadataChanged` equals `metadataOps.length`.

Replace review with the following single string, substituting the run ID:

```text
Review with: node <SKILL_DIR>/scripts/apply.mjs diff --project . --run-id <id>. Vault files are shown only as key names and value classifications. The user approves this planSha256; pass it to commit --approved-plan.
```

Drift responses are F plus `drift: Array<{ target, what }>`.

Exact drift categories, in output order:

1. At most one source-inventory row.
2. Target/input rows sorted by target.
3. Source-body rows sorted by target.
4. Request-file rows in section-4.1 filename order.
5. Manifest row.

Rules and exact values:

| Condition | target | what |
| --- | --- | --- |
| Source added/removed/origin changed | `.ai/.run/<id>` | `draft inventory changed since prepare` |
| Content or metadata target changed | Project target | `target changed since prepare` |
| Additional input changed | Project target | `transaction input changed since prepare` |
| Existing source changed/unreadable | Project target | `draft changed after prepare (unreviewed content)` |
| Request file changed/added/deleted | Bare run-input filename | `manifest metadata changed after prepare (unreviewed ownership)` |
| Manifest changed | `.ai/manifest.json` | `manifest changed since prepare` |

If a source is absent from current inventory, emit the inventory row and suppress its source
body row. Thus deleting one draft yields exactly one inventory row when nothing else changed.

Do not emit native `approved draft unreadable: ...` text. An existing but unreadable source maps
to the fixed source-body description. Unsafe links still exit 2 before drift reporting.

A path in multiple input roles receives one row: content/metadata-target precedence, otherwise
additional-input description. The manifest uses only its dedicated row.

Tests compare exact arrays for single mutations and the category-ordered union for combined
mutations.

## 6. Read-only draft review

### 6.1 Dispatch and root context

Accepted syntax:

```text
node <SKILL_DIR>/scripts/apply.mjs diff --project <root> --run-id <id>
```

Require both options once, with string values and a valid run ID. Reject unknown options,
duplicates, missing values and additional positional arguments with APPLY_DIFF_USAGE, exit 1.

Dispatch before `repoRoot()`, lock reads/heartbeat, directory creation or journal initialization.

`setFilesystemRoot`:

1. Requires a nonempty string.
2. Resolves it against cwd.
3. Requires an existing directory.
4. Rejects a symlink/junction at the supplied root.
5. Resolves native realpath and establishes the canonical absolute helper root.
6. Returns that absolute native path.

It performs no Git operation and does not require `.git`. It establishes a containment root,
not a claim that Git recognizes a repository.

Failure throws:

```text
code: APPLY_ROOT
message: APPLY_ROOT: explicit project root is not a safe existing directory
```

The CLI maps it to the section-5.2 root error, exit 2.

`secureDir` uses this context without falling back to `repoRoot`. Existing per-segment link,
junction, leaf-file and realpath containment checks remain.

`.` and absolute roots are supported. Ancestor aliases are resolved by native realpath;
links below the established root remain rejected.

### 6.2 Inventory and secret refusal

D2 applies equally to diff and prepare: the refusal set is the union of the shipped spec and
the installed project policy, if present. Parse each through C1. Malformed installed policy
fails closed.

The drafted policy is not part of the refusal set. C2 does not validate a draft as a policy
merely because its target is `.ai/security-paths.json`; it remains an ordinary draft unless
another declared metadata validation requires policy-entry validation. C3 owns migration
content validation.

No omission removes protection from the refusal set.

Before target/draft body reads:

- Validate run chain and enumerate names without following links.
- Reject duplicate draft/vault targets and drafted manifest.
- Validate target and request paths.
- Enforce write scope, source/target safety and vault eligibility.
- Apply the common secret refusal set.
- Validate request shapes and combinations.

Control policy and metadata files may be parsed in-process; parser errors never echo bodies.

Draft secret targets fail. They do not receive redacted textual diffs.

Vault files are limited by the existing ENV_TEMPLATE_RE and classified in-process through
`classifyEnvTemplate`. Never inspect vault backups for diff.

Non-vault NUL-bearing or invalid UTF-8 content fails APPLY_DIFF_TEXT. Buffer the response until
all checks succeed; do not emit earlier safe diffs before a later refusal.

### 6.3 Prepared versus unprepared review

Without plan.json:

```text
prepared: false
planSha256: null
metadataOps: null
```

Return validated requests as metadataRequests. Do not create a plan or require approval/lock.

With plan.json:

- Require C2 format and matching run ID.
- Compute its raw SHA256.
- Perform path safety and binding checks before presenting review evidence.
- Changed request bytes are drift even if their new bytes would fail JSON/schema validation.
- Return embedded metadataOps and null metadataRequests.

Diff and commit share binding checks, including unchanged consumers, unchanged drafts,
metadata-only targets and absent inputs.

Diff prints the hash of the plan it read. It does not know a separately approved hash.
Commit still compares against the externally supplied approval hash.

### 6.4 Successful output

```typescript
{
  ok: true;
  root: string;
  runId: string;
  prepared: boolean;
  planSha256: string | null;
  files: Array<{
    target: string;
    action: "create" | "modify" | "unchanged";
    diff: string | null;
  }>;
  vault: Array<{
    target: string;
    action: "create" | "modify" | "unchanged";
    classification: "env-template";
    before: Array<{ name: string; line: number; valueState: string }>;
    after: Array<{ name: string; line: number; valueState: string }>;
  }>;
  metadataOps: MetadataOperation[] | null;
  metadataRequests: {
    ownership: object | null;
    managedKeys: object | null;
    omissions: object | null;
    manifestMetadata: object | null;
    transactionInputs: string[] | null;
  } | null;
}
```

Root is canonical absolute with POSIX separators. File/vault arrays are sorted by target.
Classifier entries retain file order. For a created vault target, `before` is exactly `[]`.

Do not emit timestamps, source absolute paths, content hashes, values or vault bodies.
Success exits 0 whether differences exist or not.

### 6.5 Text diff format

Use one deterministic full-file replacement hunk. Normalize through existing normalizeText.
Equal normalized text produces unchanged/null.

Labels:

```text
existing old side: JSON.stringify("a/" + target)
missing old side:  /dev/null
new side:          JSON.stringify("b/" + target)
```

Print all removed lines followed by all added lines. Always print counts, including 1.
A missing old file has zero lines/start 0. An existing empty file normalizes to one empty line
and has start 1/count 1. End the diff in LF; no missing-final-newline marker.

Modification:

```text
--- "a/docs/a.md"
+++ "b/docs/a.md"
@@ -1,1 +1,1 @@
-old
+new
```

Creation:

```text
--- /dev/null
+++ "b/docs/a.md"
@@ -0,0 +1,1 @@
+new
```

Existing empty target changed to `new\n`:

```text
--- "a/docs/a.md"
+++ "b/docs/a.md"
@@ -1,1 +1,1 @@
-
+new
```

These are string values serialized inside JSON.

### 6.6 Exact reference text

Add this paragraph and command to references/state-and-apply.md:

```text
Review drafts with the apply command. It renders target-versus-draft differences in-process
without invoking Git, including during root discovery. The explicit project root is checked
through the filesystem. Review does not acquire or refresh a lock, create directories, write
a plan, or initialize a journal.
```

```text
node <SKILL_DIR>/scripts/apply.mjs diff --project . --run-id <id>
```

Follow with:

```text
Before prepare, this is an unapproved preview. After prepare, the report identifies
planSha256 and refuses changed inputs. Vault files appear only as key names and value
classifications. Review metadata operations even when the affected file bytes are unchanged.
Any changed input requires a new prepare and approval.
```

Replace the zero-diff paragraph with:

```text
A genuine no-op has neither content writes nor metadata operations. Commit still requires
this run's lock and rechecks the prepared inputs. It leaves project files, manifest bytes
and lock bytes unchanged and creates no journal. An ownership, omission, snippet or schema
change can be a metadata operation even when every content operation is unchanged.
sourceCommit changes only when actual content or metadata work is committed.
```

C8 replaces remaining raw draft-diff instructions elsewhere.

## 7. Tests and exact seams

### 7.1 Registration and ownership

The tests lane owns tests/c2.test.mjs and the R15/S01/S02 edits in tests/run-tests.mjs.
The implementer owns registry wiring and production files and must not edit tests-lane work.

tests/c2.test.mjs exports exactly C2_IMPLEMENTATIONS, a frozen array of descriptors:

```typescript
{
  id: string;
  run(context): Promise<{ failures: string[]; skipped: null }>
    | { failures: string[]; skipped: null };
}
```

Import production modules lazily. Missing modules/exports fail assertions, not test-module import.

Register these independent expected descriptors in order:

| ID | Name |
| --- | --- |
| `R79/C2/policy-schema` | `complete policy ownership metadata` |
| `R79/C2/settings-schema` | `permission and hook ownership schemas` |
| `R79/C2/manifest-schema` | `manifest schema 3 and legacy input` |
| `R86/C2/omissions` | `exact persistent omission identities` |
| `R86/C2/metadata-only` | `approved metadata without content writes` |
| `R86/C2/mixed-transaction` | `one content and metadata transaction` |
| `R80/C2/input-binding` | `all approved inputs remain bound` |
| `R02/C2/diff-output` | `deterministic read-only draft review` |
| `R02/C2/no-git` | `draft review invokes no Git` |
| `R02/C2/diff-safety` | `secret and unsafe targets are refused` |
| `R15/C2/metadata-binding` | `metadata presence and bytes are approved` |
| `R29/C2/approval-noop` | `unchanged-file approvals and genuine no-op` |
| `V2/C2/recovery` | `metadata transaction recovery preserves later edits` |
| `V2/C2/module-contract` | `shared exports and component registration` |

Implementation registration:

```javascript
C2: Object.freeze([...C2_IMPLEMENTATIONS])
```

Preserve descriptor identities. Do not change C11a/C1 inventories or complete numbered cases.
registerRc1Cases remains unchanged.

R15 becomes async and embeds one runComponentAssertions call using:

```javascript
{
  repository: path.resolve(SKILL, '..'),
  skillRoot: SKILL,
  tmp: path.join(TMP, 'c2'),
  env: { ...ENV }
}
```

Create that scratch directory in the test when needed. R15 fails unless report.ok is true.
Embedded execution emits no component records.

### 7.2 Fixtures and invocation

Use C11a's context and isolated Git environment.

R86 migration cases start with createV2InstalledFixture and recorded provenance. Use an initial
synthetic commit and an unused work directory outside the repository.

Use small synthetic repositories for isolated schema, rendering and failure tests.

CLI subprocess options:

```typescript
{
  cwd: fixtureRoot,
  env: fixtureEnv,
  encoding: "utf8",
  shell: false,
  windowsHide: true,
  timeout: 60000,
  maxBuffer: 16777216
}
```

Use absolute process.execPath and script paths. Unexpected signals, timeouts, spawn failures
or truncated output fail the assertion.

Fault injection uses external CommonJS preloads:

```text
node --require <absolute-preload.cjs> <absolute-script.mjs> ...
```

Patch Node fs methods and synchronize builtin exports where needed. Match resolved fixture paths
embedded as JSON literals. No production fault flags or environment overrides are added.

### 7.3 No-Git seam

Windows:

1. Copy process.execPath to `<scratch>/git-shim/git.exe`.
2. Remove every environment key whose uppercase name is `PATH`.
3. Set one `PATH` value with the shim directory first.
4. Set NODE_OPTIONS to require an absolute CommonJS preload.
5. The preload detects basename(process.execPath) equal to git.exe, ignoring case.
6. For that executable only, append one JSON line with process.argv.slice(1) to the record file
   and exit 91.

The control is exactly a shell-free invocation:

```javascript
spawnSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: fixtureRoot,
  env: shimEnv,
  shell: false,
  windowsHide: true,
  encoding: 'utf8'
})
```

Require exit 91 and one invocation record. Clear the record before apply diff.
Run diff with the original absolute Node executable.

On POSIX, use an executable recording/failing git shim with the same control/reset assertions.

Require successful expected diff output and zero Git records, including:

- Nested secure traversal through drafts/docs/nested/a.md.
- A root containing spaces.
- Invocation from another cwd.
- A root without `.git`.
- Unchanged root/run/lock state.

Failure to intercept the control is a test failure. Source searches or renderer-only mocks do
not prove this guarantee.

### 7.4 Schema and omission cases

| Case | Input | Expected |
| --- | --- | --- |
| P1 | Policy schema 2 with kind/note fields | Exact detached copy. |
| P2 | Policy schema 1 with correct explicit anchors | Accepted unchanged. |
| P3 | String instead of policy entry | C1 POLICY_ENTRY. |
| P4 | Permission container for policy | OWNERSHIP_FIELD. |
| P5 | Policy container for settings | OWNERSHIP_FIELD. |
| P6 | Managed metadata for TODO.md | OWNERSHIP_TARGET. |
| P7 | Glob `a**b` | C1 POLICY_GLOBSTAR. |
| P8 | Duplicate policy identity with different notes | Both records retained. |
| S1 | Allow/deny arrays plus heldBack | Exact detached copy. |
| S2 | Number in deny array | `OWNERSHIP_SHAPE: managed.permissions.deny`. |
| S3 | permissions.ask metadata | OWNERSHIP_FIELD. |
| S4 | Same command, different event/matcher | Distinct identities accepted. |
| S5 | Duplicate hook identity | `HOOK_DUPLICATE: hooks[1]`. |
| S6 | Missing command | HOOK_IDENTITY. |
| S7 | timeout inside identity | HOOK_IDENTITY. |
| S8 | Empty matcher with valid event/command | Accepted. |
| S9 | Null/non-object hook element | HOOK_IDENTITY. |
| O1 | Section-3.4 identity examples | Exact listed booleans. |
| O2 | Case-equivalent duplicate omission | OMISSIONS_DUPLICATE. |
| O3 | Different valid anchored identities | No cross-identity omission. |
| O4 | Malformed later omission after a match | Error, never early true. |
| O5 | Allow omission Bash(npm test) | Exact string retained. |
| O6 | Omission request without managed request | Managed list unchanged. |
| O7 | Non-array second isPolicyOmitted argument | Exact section-5.1 error. |

Deep-freeze successful inputs and assert non-mutation, detached outputs and preserved ordering.

### 7.5 Manifest and compatibility cases

Use this common synthetic schema-3 object:

```json
{
  "schema": 3,
  "skill": "project-setup",
  "skillVersion": "2.0.0",
  "mode": "update",
  "agents": ["claude", "codex"],
  "sourceCommit": null,
  "files": {}
}
```

Assert:

- Valid schema 3: sourceSchema 3, needsUpdate false, detached equal copy.
- Valid schema 2: sourceSchema 2, needsUpdate true, detached equal copy.
- Missing/string/1/4 schema: MANIFEST_SCHEMA and exact issues.
- Non-object roots: MANIFEST_INVALID and root issue.
- Invalid common fields retain structural issue strings.
- Wrong per-file metadata and snippet hash report exact issues.
- Extensions survive conversion.
- Genuine tagged v2 manifest is accepted without modification.
- Detect statuses, top-level modes, evidence, warnings and exit 0 match section 3.7.
- JSON parse failure and non-object manifests never fall through to fresh/adopt.
- Validate reports exact schema-2 info; invalid legacy data never receives it.
- An edited block retains its old recorded hash through schema-only conversion.
- A full-owned policy remains full without an explicit request.
- File-map JavaScript ordering is intentional and tested with TODO.md and docs/a.md.
- Tagged v2 validate rejects schema 3; do not claim every old writer is guarded.

### 7.6 Metadata and approval cases

M1-M6 use genuine v2 fixtures. M7/M8 use schema-3 state. Use new run IDs after journaled runs.

For M4/M5/M6, retain the v2 managed deny metadata while replacing settings bytes with the
section-3.3 fixture. Select one recorded deny for removal and stage its corresponding policy
identity as the omission. The engine test supplies this decision; C3 classification is not tested.

| Case | Operation | Expected |
| --- | --- | --- |
| M1 | Schema-only upgrade | Only manifest write; one manifest metadata op. |
| M2 | Unchanged policy full -> keys, no approval | Exit 3; required policy approval. |
| M3 | M2 with exact policy approval | Policy bytes unchanged; two metadata ops. |
| M4 | Deny metadata removal plus omission, no approval | One settings approval error. |
| M5 | M4 approved | Settings bytes unchanged; two metadata ops. |
| M6 | Changed doc plus M5 | One journal; two metadata ops; manifest last. |
| M7 | Unchanged draft plus changed settings metadata | One file metadata op committed. |
| M8 | Identical content and requests | Exact no-op; lock/manifest bytes unchanged. |
| M9 | Generic unchanged block/full rebaseline | APPLY_METADATA_TARGET. |
| M10 | Unrelated approval | APPLY_APPROVAL_UNRELATED. |
| M11 | Approval `*` | Rejected; no blanket authorization. |
| M12 | Approval for identical metadata | Rejected as unrelated. |
| M13 | Unknown metadata target | APPLY_METADATA_UNKNOWN. |
| M14 | Missing request field | Prior field survives. |
| M15 | Explicit omission-array clearing | Approval required; cleared value persists. |
| M16 | managed request but resulting full ownership | APPLY_METADATA_OWNERSHIP. |
| M17 | Policy keys without managed metadata | APPLY_METADATA_REQUIRED. |
| M18 | Settings keys without prior/requested metadata | Valid managed `{}`. |
| M19 | heldBack-only change | File metadata op; no path approval. |
| M20 | Incomplete policy managed request | Shared shape error; no implicit merge. |
| M21 | Append-only managed-list update | No path approval; reviewed file metadata op. |
| M22 | Unrecorded existing settings, append-only content | Strict prepare succeeds; R29(d). |
| M23 | Unchanged unrecorded draft plus another write | Remains unrecorded. |
| M24 | No-op commit without lock | Exit 2; no heartbeat/journal. |
| M25 | No-op plan with drift | Exit 4; no heartbeat/journal. |
| M26 | Content and metadata need approval on same target | One combined error entry. |

M1/M3/M5/M6/M7 assert exact arrays from section 4.4, not just counts.

For M6, actual journal entries are document then manifest. M3/M5 entries contain only manifest.
For M5, compare raw settings bytes with the preservation fixture.

Test the section-4.1 combination table directly through prepare, including requests with both
managed and omissions fields. Error targets are the affected project path.

### 7.7 Binding matrix

Prepare once, mutate one item, and test diff and commit in separate fixture copies.

| Mutation | Exact drift array |
| --- | --- |
| Changed or unchanged draft body | One source-body row for its project target. |
| Changed or unchanged target body | One target row. |
| Metadata-only settings target | One target row. |
| Declared unchanged consumer | One additional-input row. |
| Declared absent input appears | One additional-input row. |
| Installed policy changes | One input/target row using role precedence. |
| Manifest bytes change | One manifest row. |
| Each request file changed/added/deleted | One request-file row. |
| Safe draft added | One inventory row for `.ai/.run/<id>`. |
| Approved draft removed | One inventory row; no extra source row. |
| Existing source unreadable | One fixed source-body row; no native message. |

All exit 4, print APPLY_DRIFT, create no journal and change no project files.
Diff also leaves run inventory and lock bytes unchanged.
Commit rejection leaves lock bytes unchanged.

Test one combined mutation to assert category ordering and deduplication.

An unrelated unbound file change is not drift. Changing plan.json and committing its previous
approved hash retains the existing approved-plan mismatch refusal.

There is no shipped-policy-hash binding test; D3 assigns tool/version compatibility to C3.

### 7.8 Diff cases

Assert:

- Exact modification, creation and empty-target hunks from section 6.5.
- LF/CRLF normalized equality produces unchanged/null.
- Target ordering and JSON-quoted labels.
- Unprepared null hash/metadataOps and validated metadataRequests.
- Prepared exact plan hash and embedded metadataOps.
- Metadata-only review invents no content diff.
- Empty initialized run returns empty arrays, exit 0.
- Missing run fails without creating it.
- Malformed invocation, including invalid run ID, gets exact usage failure.

Classifier fixture:

```text
EMPTY=
PLACE=<value>
TOKEN=fixture-value
PORT=3000
```

Expected:

```json
[
  {"name":"EMPTY","line":1,"valueState":"empty"},
  {"name":"PLACE","line":2,"valueState":"placeholder"},
  {"name":"TOKEN","line":3,"valueState":"possible-real-secret"},
  {"name":"PORT","line":4,"valueState":"non-placeholder"}
]
```

Vault output contains none of `fixture-value`, `<value>` or `3000`.
A created vault target has `before: []`.

D2 cases:

- Installed-only secret match: both diff and prepare refuse.
- Drafted-only secret match: neither adds that match to its refusal set.
- Invalid installed policy grammar: both fail closed.
- Invalid drafted policy grammar alone: ordinary draft handling; no refusal-policy error.
  Use an otherwise acceptable new target to obtain exit 0.

### 7.9 Safety/error matrix

F and P refer to section 5.2. Paths in error strings are relative to the explicit/discovered
project root. "Unread" means body reads, not safe stat/list operations.

| Case | Diff code/exit/envelope | Prepare code/exit/envelope |
| --- | --- | --- |
| Junction at .ai/run/drafts/nested source | APPLY_PATH / 2 / F | APPLY_PATH / 2 / F |
| Linked source or target leaf | APPLY_PATH / 2 / F | APPLY_PATH / 2 / F |
| Run replaced by junction after prepare | APPLY_PATH / 2 / F | APPLY_PATH / 2 / F |
| Missing run | APPLY_RUN_MISSING / 2 / F | Existing missing-run error / 1 |
| Draft outside write scope | APPLY_WRITE_SCOPE / 3 / F | APPLY_WRITE_SCOPE / 3 / P |
| Explicitly write-denied target | APPLY_WRITE_DENIED / 3 / F | APPLY_WRITE_DENIED / 3 / P |
| Duplicate draft/vault target | APPLY_DUPLICATE_TARGET / 3 / F | Same / 3 / P |
| Drafted manifest | APPLY_MANIFEST_DRAFT / 3 / F | Same / 3 / P |
| Shipped/installed secret draft target | APPLY_SECRET_TARGET / 3 / F | Same / 3 / P |
| Unsupported installed policy grammar | C1 code / 3 / F | C1 code / 3 / P |
| Invalid installed policy JSON | POLICY_JSON / 3 / F | POLICY_JSON / 3 / P |
| Invalid drafted policy grammar alone | No policy-refusal error | No policy-refusal error |
| Bad metadata target path | APPLY_PATH / 3 / F | APPLY_PATH / 3 / P |
| Bad declared-input path | APPLY_PATH / 3 / F | APPLY_PATH / 3 / P |
| Wrong vault target | APPLY_VAULT_TARGET / 3 / F | Same / 3 / P |
| Non-regular target | APPLY_TARGET_TYPE / 3 / F | Same / 3 / P |
| Invalid run-metadata JSON in preview | APPLY_INPUT_JSON / 3 / F | Same / 3 / P |
| Invalid run-metadata container | APPLY_INPUT_SHAPE / 3 / F | Same / 3 / P |
| Invalid typed managed/omission value | Shared code / 3 / F | Shared code / 3 / P |
| Invalid run ID | APPLY_DIFF_USAGE / 1 / F | Existing invalid-run-ID error / 1 |
| NUL/invalid UTF-8 ordinary document | APPLY_DIFF_TEXT / 3 / F | Existing content path |
| Unreadable preview input | APPLY_DIFF_IO / 2 / F | APPLY_INPUT_IO / 3 / P |

For propagated C1 policy failures, F additionally contains `target` naming the control policy
file; P's entry uses that target. Preserve C1's error message exactly.

Unread-body requirements:

- Unsafe source/target paths: neither that source nor target is read.
- Duplicate target: neither source nor target is read.
- Drafted manifest: neither its draft nor target is read as content.
- Scope/secret/vault/type refusal: rejected source and target remain unread.
- Bad metadata/declared-input path: the named project input remains unread.
- Invalid metadata JSON/shape: metadata control bytes may be read; project target bodies remain
  unread.
- Invalid installed policy: policy control bytes may be read; ordinary draft/target bodies
  remain unread.
- NUL/UTF-8 failure: body bytes are read in-process but no body or partial review is printed.
- Wrong run ID/missing run: no candidate body is read.

A run-path link replacement takes precedence over drift and exits 2. A missing ordinary source
with a safe run chain follows section 5.3 and exits 4 during prepared review/commit.

Tests use external read-recording preloads to verify these requirements. Require unchanged
outside sentinels, run inventory and lock/project bytes.

Windows junction coverage is mandatory. Optional unavailable file-symlink subcases do not skip
a component group and do not substitute for junction coverage.

### 7.10 Recovery and crash cases

External preload seams:

- Destination rename throws `code: "EIO"`, message `C2 injected rename failure`.
- Manifest destination rename throws the same error.
- First journal rename fails before project writes.
- After a selected content or manifest rename succeeds, exit 137 before its next checkpoint.
- Manifest restore rename fails during rollback.
- A later rollback journal rename fails after the in-progress marker succeeded.

Assert:

- Pre-write failures preserve targets.
- Mid-commit failure exits 5 with recoverable journal/backups.
- Metadata-only failure never writes settings/policy.
- Crash after manifest rename recovers through expectedWriteSha.
- Crash after a content rename: rollback restores content and leaves the manifest equal to
  its pre-run raw bytes.
- Rollback failures exit 6 and retain unresolved state.
- Retrying rollback without the fault succeeds.
- Corrupt manifest backup yields exit 6 and preserves target/backup bytes.
- Later manifest/content edits remain untouched.
- A later committed manifest prevents an earlier rollback from overwriting it.
- Re-prepare/recommit of a journaled run exits 7.
- Exit 4 with no journal permits re-prepare using the same run ID.
- Exit 2 with no journal permits re-prepare using the same run ID after the unsafe path is
  restored. Use a run/draft junction substitution; verify no outside writes.
- Rollback of schema conversion restores the exact schema-2 manifest bytes.

Recovery tests retain existing message prefixes, exit codes and journal states. Native
operating-system wording is not an oracle.

### 7.11 Module and baseline contracts

Assert:

- Exact ownership exports and new library exports.
- Import safety.
- Independent C2 inventory equality.
- Deep-frozen expected descriptors and frozen implementation array.
- Implementation descriptor identity.
- Unchanged C1/C11a inventories.
- No complete numbered rc.1 registration.
- Existing runner missing-group, failure and forbidden-skip behavior.

No existing baseline assertion hardcodes newly written manifests as schema 2.
No baseline protection needs weakening.

Tests-lane edits:

- S01: assert schema 3, detect update/current, metadataChanged 0.
- S02: schema-3 manifest remains byte-identical.
- R15: embed C2 component assertions.
- R29(d): unchanged regression guard; strict append-only merge still succeeds.

Keep all existing case IDs, names and counts.

## 8. Edge-case mapping

| Frozen section-5 C2 item | Coverage |
| --- | --- |
| Wrong metadata types | P3-P7, S2-S3, combination table, manifest cases. |
| Hook identity collisions | S4-S9; actual-settings merging remains C6. |
| Approval despite unchanged bytes | M2-M5, M7, M15. |
| Unrelated approvals | M10-M12. |
| Unchanged operation cannot suppress metadata | M7 and binding matrix. |
| Exact omissions cannot broaden | O1-O7. |
| One manifest precondition/journal | M6 and recovery. |
| Approved unchanged input drift | Section 7.7 and M25. |
| Secret/vault content not textually diffed | Sections 7.8-7.9. |
| Root/helper paths invoke no Git | Section 7.3. |
| Partial writes, backups, crashes, later edits | Section 7.10. |
| Schema-2 needs update; no rebaseline | Section 7.5, M1, M9, M23. |

## 9. Runnable acceptance

After tests and implementation land, run from the repository root:

```powershell
node project-setup/tests/run-component-tests.mjs --component C2
node project-setup/tests/run-component-tests.mjs --component C1
node project-setup/tests/run-component-tests.mjs --component C11a
node project-setup/tests/run-tests.mjs --keep
```

This lane did not run them.

C2 exits 0 with empty stderr and these exact records:

```text
PASS  R79/C2/policy-schema  complete policy ownership metadata
PASS  R79/C2/settings-schema  permission and hook ownership schemas
PASS  R79/C2/manifest-schema  manifest schema 3 and legacy input
PASS  R86/C2/omissions  exact persistent omission identities
PASS  R86/C2/metadata-only  approved metadata without content writes
PASS  R86/C2/mixed-transaction  one content and metadata transaction
PASS  R80/C2/input-binding  all approved inputs remain bound
PASS  R02/C2/diff-output  deterministic read-only draft review
PASS  R02/C2/no-git  draft review invokes no Git
PASS  R02/C2/diff-safety  secret and unsafe targets are refused
PASS  R15/C2/metadata-binding  metadata presence and bytes are approved
PASS  R29/C2/approval-noop  unchanged-file approvals and genuine no-op
PASS  V2/C2/recovery  metadata transaction recovery preserves later edits
PASS  V2/C2/module-contract  shared exports and component registration
14 PASS / 0 FAIL / 0 SKIP
RESULTS  <absolute-report-path>
```

Every line ends in LF. The report path is the runner's absolute native path to
component-results.json.

Report fields:

```json
{
  "component": "C2",
  "ok": true,
  "errors": [],
  "summary": {"passed": 14, "failed": 0, "skipped": 0}
}
```

All fourteen results match the inventory, with PASS and empty failures.

Retain C1 and C11a records and totals:

```text
12 PASS / 0 FAIL / 0 SKIP
8 PASS / 0 FAIL / 0 SKIP
```

Baseline on the recorded Windows host:

```text
59 PASS / 0 FAIL / 1 SKIP
```

Only R13d may skip because Windows file-symlink privilege is unavailable.
Its unchanged record is:

```text
SKIP  R13d  a pre-placed backup leaf symlink is never written through  (cannot create file symlink (Windows without Developer Mode))
```

With that privilege available, 60 PASS / 0 FAIL / 0 SKIP is valid.

Retain the baseline final one-line JSON envelope with env, summary and resultsFile.
Records, totals and evidence must agree.

C2 must not emit complete numbered R79/R80/R86 PASS records. C11b owns their integration.
Full rc.1 acceptance remains incomplete at this landing.

## 10. Rollback

There is no database migration.

If a later component fails, repair or revert that component first. Retain C2 unless C2 itself
is defective.

To withdraw C2 from the distribution:

1. Revert dependent implementation changes in reverse landing order.
2. Revert C2 production, documentation and tests together.
3. Retain C1 and C11a.
4. Recheck their acceptance and the baseline.

Use reviewed commit reverts and preserve unrelated work.

For a project already written with schema 3:

1. Keep rc.1 tooling available.
2. Roll back independent runs newest first.
3. Restore content and manifest through each run's journal.
4. Resolve incomplete rollback before discarding recovery material.
5. Restore older installed tooling only after project compatibility is restored.

Metadata-only rollback restores the prior manifest without changing settings/policy bytes.
Later manifest edits cause exit 6 rather than overwrite.

Do not remove schema-3 fields manually or use v2 apply to repair a schema-3 project.
Q6 is a validator compatibility signal, not a retrofit of every v2 writer.

Direct dependents are C3, C6, C7, C8 and C10, with subsequent C4/C5/C9/C11b integration.
Never remove a required helper while installed consumers still reference it.

## 11. Accepted residual risks

- C1's PQ2 Unicode/normalization limitations remain accepted. C2 adds no alias mechanisms.
- Filesystem checks cannot defeat every hostile concurrent path replacement. Existing locks,
  immediate checks and separate worktrees remain the practical boundary.
- Full-file replacement hunks are larger than minimal diffs, but deterministic and dependency-free.
- Diff buffers setup-document/configuration output without a new truncation policy. Bounded
  Git/review output belongs to C4/C5.
- Manifest validation is structural, not cryptographic integrity; deferred B6 remains deferred.
- Ownership decisions remain C3/C6/C7 responsibilities.
- C2 does not bind shipped-tool/spec bytes through a new hash. C3 owns the tool-version gate.
- The drafted policy does not expand the current refusal set. C3 validates migration content.
- Schema 3 does not prove runtime protection; later compatibility and validation gates remain.
- Old v2 writers are not retroactively guarded. Paired upgrade and rollback order remain required.
- Interim instruction inconsistency: SKILL.md:137 still recommends raw `git diff --no-index`
  until C8 replaces it. C2 prepare output and state-and-apply.md use the new command. This is
  tracked as a C8 dependency, not permission to use the old instruction.

## 12. Plan questions

None.

## Revision disposition

| Gap | Disposition |
| --- | --- |
| P2-1 | FIXED: 4.2 rule table; 4.4 exact M1/M3/M5/M6/M7 arrays; S01 count pinned. |
| P2-2 | FIXED: 4.1 combination table, complete policy requests and heldBack rules. |
| P2-3 | FIXED: 4.6 exact lock/check/no-op order; M24/M25; M8 preserves lock bytes. |
| P2-4 | FIXED: 5.1-5.3 envelopes, prefixes and granularity; 7.9 refusal matrix. |
| P2-5 | FIXED: section 2 apply.mjs regions corrected against 8b3f1c4. |
| P2-6 | FIXED: removed the incorrect landing-position supersession statement. |
| P2-7 | FIXED: 3.7 keeps detect exit 0 and pins invalid mode, parse and root outcomes. |
| P2-8 | FIXED: D2 applied in 6.2 and 7.8; common shipped/installed refusal set. |
| P2-9 | FIXED: D3 applied; no policySpecSha256 or shipped-spec binding row. |
| P2-10 | FIXED: 2.2/4.3 commit plan order; C3 owns reader-first ordering. |
| P2-11 | FIXED: D1 applied in 4.5; M21/M22 and unchanged R29(d) guard. |
| P2-12 | FIXED: 5.3 exact drift categories, targets, ordering and missing-source rule. |
| P2-13 | FIXED: 5.1 location/index rules and three previously unpinned outcomes. |
| P2-14 | FIXED: 6.4 vault create before []; 6.5 exact empty-target hunk. |
| P2-15 | FIXED: 7.3 removes all PATH case variants and pins shell-free control. |
| P2-16 | FIXED: 7.10 crash oracle and same-run re-prepare after exits 2 and 4. |
| P2-17 | FIXED: 3.3/7.6 use preservation fixture for M4/M5 and compare raw bytes. |
| P2-18 | FIXED: 3.5 names JavaScript key ordering as an intentional v2 change. |
| P2-19 | FIXED: 2/7.1 assign tests-lane files and exact R15 context. |
| P2-20 | FIXED: section 11 records SKILL.md:137 inconsistency until C8. |

Plan questions: none.

## Addendum at freeze: plan-critique round 2, C2-P3-1 to C2-P3-9 (NON-BLOCKING)

Added by the orchestrator when freezing. C2-P3-1 to C2-P3-3 are maintainer decisions
(2026-10-17) that make D1 exact; the others pin values the sections above left open. Where an
item and an earlier section differ, the item wins.

- C2-P3-1 (maintainer). An omission change always requires path approval, including on a target
  with no previous manifest record; the section-4.5 rule "Initial metadata for a target with no
  previous manifest record requires no extra metadata approval" does not cover omissions. Such a
  target gets one file metadata op with `before: null`, `after` equal to the target's complete
  record in `manifestAfter`, `requiresApproval: true` and the reason
  `approved omission records change` (plus any other reasons, in the section-4.5 order).
- C2-P3-2 (maintainer). The no-approval rule for initial metadata applies only to a target that
  has a content write (create or modify) in this run. Explicit `keys` ownership, with or without
  a managed request, on an unchanged unrecorded target is an ownership change: one file metadata
  op with `before: null`, `after` equal to the complete record, `requiresApproval: true`, and the
  reason `settings ownership or managed metadata changes` for `.claude/settings.json` or
  `policy ownership or managed metadata changes` for `.ai/security-paths.json`. Without the path
  approval, prepare reports `APPLY_APPROVAL_REQUIRED` with
  `metadata changes require --approve-user-content <target>`. R29(d) is unaffected: it has a
  content write.
- C2-P3-3 (maintainer). A policy managed-schema change counts as an ownership change under D1, so
  the section-4.5 approval requirement for it stands.
- C2-P3-4. Three more section-4.1 outcomes, reported in prepare's errors array like the other
  section-4.1 table errors (exit 3, entry target = the affected project target):
  - an explicit transition out of `keys` ownership on a target with no content write:
    `APPLY_METADATA_TARGET`, `metadata-only adoption is not supported for <target>`;
  - `keys` requested for any target other than `.claude/settings.json` and
    `.ai/security-paths.json` (R15's `ownership.json` `{"TODO.md": "keys"}`):
    `APPLY_OWNERSHIP_VALUE`, `<target>: invalid ownership "keys"`;
  - a generic ownership change on an unchanged target (M9): `APPLY_METADATA_TARGET`, same text.
- C2-P3-5. When the installed project policy is not itself a content or metadata target of the
  run and changes after prepare, its drift row is target `.ai/security-paths.json`, what
  `transaction input changed since prepare`.
- C2-P3-6. A supplied snippet hash on a run with no existing manifest emits no manifest op; the
  hash is recorded in `manifestAfter` only (consistent with D4). A manifest op is emitted only for
  a schema-2 conversion of an existing manifest or a snippet hash that differs from an existing
  manifest's value.
- C2-P3-7. Intentional change from v2, alongside the one in section 3.5: a linked target leaf or
  path component found during prepare now fails immediately with exit 2, where v2 collected it as
  an errors-array entry with exit 3 (apply.mjs:255-256, 307-309). No baseline test depends on the
  old exit.
- C2-P3-8. references/state-and-apply.md also gets this line, next to the section-6.6 text:
  `If detect reports mode "invalid", repair or restore .ai/manifest.json before running prepare.`
  Teaching the agent-facing mode list in references/modes.md and SKILL.md is a C8 dependency.
- C2-P3-9. Validate's manifest JSON parse failure is exactly
  `{"level":"fail","check":"json-syntax","detail":".ai/manifest.json: manifest is not valid JSON"}`,
  with no native parser message. The `.claude/settings.json` parse record keeps its v2 text.
