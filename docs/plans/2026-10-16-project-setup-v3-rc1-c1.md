<!--
FROZEN 2026-10-16 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Component plan C1 (lands second, after C11a) under the frozen architecture plan
docs/plans/2026-10-15-project-setup-v3-rc1.md, which takes precedence. Drafted by the plan lane
(Codex, 4 revisions; the fourth simplified the alias model under the maintainer's replacement PQ2,
an extra round the maintainer authorized); plan-critique (Claude) round 4 found no BLOCKING gap.
-->

# C1: Shared policy grammar, matcher and version contract

Target file: `docs/plans/2026-10-16-project-setup-v3-rc1-c1.md`.

Repository: `D:/ContactRepos/claude-backend-skills`.
Branch: `feat/project-setup-v3-rc1`.
Code baseline: `65ea0eb`.
Revision: round 4, simplification under the replacement PQ2.

Precedence:

1. `docs/plans/2026-10-15-project-setup-v3-rc1.md`, including its freeze addendum.
2. `docs/design/project-setup-v3.md`, including Q1-Q7, DQ1, PQ1 and replacement PQ2.
3. The frozen C11a plan, its decision files and its landed harness.

Replacement PQ2 was read from the working tree. It supersedes the earlier PQ2/PQ2a alias model.
PQ2a no longer applies.

This lane made no file changes and ran no tests, fixtures or network operations.

## 1. Scope and out-of-scope

### 1.1 Scope

Architecture section 2, C1, assigns:

- One shared policy grammar and matcher in `assets/tools/security-policy.mjs`.
- Source-script consumption of that module.
- Validated, non-writing schema-1 adaptation.
- Strict schema-2 validation with explicit anchors.
- Host-independent lowercase matching with PQ2's Windows aliases.
- Structural path validation that preserves valid names exactly.
- Effective-entry deduplication without loss of source metadata.
- Separation from generic write-allowlist matching.
- Conservative, modeled overlap handling for user permission exceptions.

Architecture section 4 assigns these sub-assertions:

| Requirement | C1 coverage |
| --- | --- |
| R45 | Grammar and policy validation |
| R44 | Matcher anchor behavior |
| R74 | Shared matcher, case policy, Windows aliases and corpus |
| R75 | Structural path validation |
| R78 | Schema-1 read adapter |
| R97 | Environment-name variant matching |

Architecture section 5, C1, supplies the edge cases mapped in section 5.

C11a is the preceding dependency. Landing order remains:

```text
C11a -> C1 -> C2 -> C3 -> C4 -> C5 -> C6 -> C7 -> C8 -> C9 -> C10 -> C11b
```

### 1.2 Out-of-scope and dependency owners

| Work | Owner |
| --- | --- |
| Manifest schema 3 and ownership schemas | C2 |
| Omission approvals, metadata transactions and draft diffs | C2 |
| Policy migration writes and installed-baseline classification | C3 |
| Changing the shipped policy list | C3 |
| Rendering controls and updating consumers | C3 |
| Coupled installation of compatible runtime assets | C3 |
| Git argument builders, exact-case lookup and NUL-list parsing | C4 |
| Review-diff and artifact handling | C5 |
| Hook behavior and ownership | C6 |
| Allow retirement | C7 |
| Agent instructions and customization migration | C8 |
| Script-only template access | C9 |
| Validation reporting and doctor integration | C10 |
| Complete numbered cases and release acceptance | C11b |

C1 supplies the asset that C3 will install as `.ai/tools/security-policy.mjs`. C1 does not
install it into projects or modify the existing installed Git consumer.

PQ2 requires filesystem-reading consumers to check the realpath-relative spelling:

- C5 owns that check for review artifacts.
- C3 records the follow-up for `blocks.mjs --file`.
- C1 does not resolve Windows 8.3 names or claim lexical coverage for them.
- Existing `assertNotSecretInput` realpath checks remain intact.

The compatibility rule that invalid paths are secret has a separate validation consequence.
At `validate.mjs:127`, an invalid manifest key such as `./docs/x.md` is skipped by the
secret-content scan. That is not evidence that its content was scanned.

C10 must treat invalid manifest keys as validation failures rather than silently skipping them.
This is a named C10 dependency, not C1 implementation work.

Unicode case-fold expansion, Unicode normalization and removal of dots-and-spaces components
are excluded by replacement PQ2. Their accepted residual risks appear in section 5.1.

C1 does not claim rendered-control parity, Git enforcement parity or measured host enforcement.
Later consumers and C11b own those checks.

The architecture freeze addendum concerns C11b release tests and adds no C1 work.

## 2. Files touched and public contracts

Paths below are relative to `project-setup/`. Existing line numbers refer to `65ea0eb`.

### 2.1 Existing files

| File and baseline range | Change |
| --- | --- |
| `scripts/lib.mjs:3-8` | Import shared policy functions. |
| `scripts/lib.mjs:110-116` | Delegate secret projection and matching; fail closed on invalid paths. |
| `scripts/globs.mjs:1-22` | Normalize permission syntax into validated policy entries. |
| `scripts/globs.mjs:46-80` | Replace private path intersection with shared modeled intersection. |
| `scripts/schemas.mjs:1-2` | Import the shared reader exactly as section 2.4 specifies. |
| `scripts/schemas.mjs:71`, after EOF | Add error-code classification and `checkSecurityPolicy`. |
| `tests/rc1-cases.mjs:9` | Import `C1_IMPLEMENTATIONS`. |
| `tests/rc1-cases.mjs:33-48` | Add independent C1 descriptors and implementation wiring. |
| `tests/run-tests.mjs:442` | Make the existing R17 callback asynchronous. |
| `tests/run-tests.mjs:476-477` | Run C1 assertions inside R17 without printing their records. |

The existing `segmentsIntersect` implementation at `scripts/globs.mjs:24-44` remains unchanged.
The shared intersection engine uses code-point arrays instead.

The R17 addition follows the existing S07/C11a pattern. Construct:

```javascript
{
  repository: path.resolve(SKILL, '..'),
  skillRoot: SKILL,
  tmp: path.join(TMP, 'c1'),
  env: { ...ENV }
}
```

Create that temporary directory, call `runComponentAssertions('C1', context)`, and fail R17
unless `report.ok === true`. Preserve every existing R17 assertion.

The tests lane owns this R17 addition. The implementer wires the C1 import and both registry
entries in `rc1-cases.mjs`.

These existing interfaces remain unchanged:

- `loadSecretSpec`.
- `globToRegExp`, `matchesAny`, and the write allowlist/denylist.
- `segmentsIntersect`.
- `checkClaudeSettings` and `checkManifest`.
- The component runner, acceptance runner and C11a tests.
- Baseline and complete rc.1 case inventories.

C1 does not make `checkManifest` accept schema 3. That belongs to C2.

### 2.2 New files

| File | Owner and purpose |
| --- | --- |
| `assets/tools/security-policy.mjs` | Implementation: standalone shared policy module. |
| `tests/c1.test.mjs` | Tests lane: immutable component assertions. |
| `tests/fixtures/security-policy-corpus.json` | Tests lane: immutable matcher oracle. |

The implementer must not edit tests-lane files or the tests-lane R17 addition.

No package dependencies, version files, release notes, snapshots or reference files change.

### 2.3 Shared module exports

The module exports exactly seven names:

```typescript
export const POLICY_SCHEMA_VERSION = 2;

export function readSecurityPolicy(value: unknown): PolicySnapshot;

export function parseSecurityPolicy(text: unknown): PolicySnapshot;

export function policyEntryKey(entry: unknown): string;

export function validateRepoPath(value: unknown): string;

export function matchesPolicyPath(
  path: unknown,
  policy: unknown
): boolean;

export function policyEntriesMayOverlap(
  left: unknown,
  right: unknown
): boolean;
```

The overlap export shares alias construction and matching semantics with the path matcher.

Types:

```typescript
type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

type Anchor = 'any' | 'root';

type Pattern = {
  glob: string;
  anchor: Anchor;
  [key: string]: Json;
};

type Policy = {
  schema: 2;
  patterns: Pattern[];
  projectPatterns: Pattern[];
  [key: string]: Json;
};

type Source = {
  collection: 'patterns' | 'projectPatterns';
  index: number;
};

type EffectivePattern = {
  anchor: Anchor;
  glob: string;
  sources: Source[];
};

type PolicySnapshot = {
  sourceSchema: 1 | 2;
  policy: Policy;
  effectivePatterns: EffectivePattern[];
};
```

General contracts:

- Functions are synchronous.
- They have no filesystem, subprocess, network or environment inputs.
- Node built-ins are permitted; `node:util` may provide reliable Proxy detection.
- The module imports no distribution-only module and works when copied alone.
- Import performs no writes, spawning, output, tests or process exit.
- Functions emit no stdout/stderr and never exit.
- Inputs are never mutated.
- Returned data is detached and mutable.
- Output objects have `Object.prototype`; arrays have `Array.prototype`.
- Shared input references are copied by value.
- Input-identity caching must not hide later input changes.
- There are no production injection options or environment overrides.

`readSecurityPolicy` validates the entire input before returning a snapshot.

`parseSecurityPolicy` requires a string, removes at most one initial U+FEFF BOM, parses JSON,
then calls the reader. Parse errors contain no source text or native parser details.

`policyEntryKey` validates one explicit-anchor entry and returns:

```javascript
JSON.stringify([entry.anchor, entry.glob.toLowerCase()])
```

Its error location is `entry`. Entry identity does not apply Windows aliases or Unicode
normalization.

`validateRepoPath` returns the original string unchanged.

`matchesPolicyPath` accepts a raw schema-1 or schema-2 policy, not a snapshot wrapper.
It validates the complete policy first, the candidate second, and matches third.

Consumers may pass `snapshot.policy`. An invalid later entry fails even when an earlier entry
would match.

`policyEntriesMayOverlap` accepts two explicit-anchor entries:

- Validate `left`, then `right`, using the same checks as `policyEntryKey`.
- Entry errors use location `entry` for either argument.
- Compute intersection over the shared lowercase and Windows-alias forms.
- Return a boolean.
- Do not perform permission-expression normalization.
- Do not add the permission directory-prefix comparison described in section 3.7.
- Preserve terminal `/**` descendant semantics.

Root `a/**` and root `a` do not intersect through this export. The permission wrapper separately
checks the directory prefix.

### 2.4 Source-script exports

Changed exports in `scripts/lib.mjs`:

```typescript
secretGlobs(spec = loadSecretSpec()): string[]
isSecretPath(relPosix, spec = loadSecretSpec()): boolean
```

`secretGlobs` returns normalized glob strings from
`readSecurityPolicy(spec).effectivePatterns`, in effective order.

This projection is not an anchored matching API. New policy consumers use the complete policy
and shared matcher.

`isSecretPath` delegates to `matchesPolicyPath`:

- Return its boolean for valid inputs.
- Return `true` for an `Error` with an own code equal to one of the four `POLICY_PATH_*` codes.
- Rethrow policy errors and all other exceptions unchanged.

Thus, with a valid policy:

```text
./.env -> true
./AGENTS.md -> true
empty relative string -> true
```

Existing callers use their controlled secret-path refusal or skip behavior. C1 does not
normalize invalid input into acceptance.

The validation skip consequence and required C10 follow-up are recorded in section 1.2.

Malformed policy fails before invalid-candidate classification. The existing default loader
and its filesystem/JSON errors remain unchanged.

New export in `scripts/schemas.mjs`:

```typescript
checkSecurityPolicy(value: unknown): string[]
```

Its import is exactly:

```javascript
import { readSecurityPolicy } from '../assets/tools/security-policy.mjs';
```

`schemas.mjs` imports no other relative module. It hard-codes a private allowlist containing
exactly the 20 error codes in section 3.5.

Behavior:

- Reader success: return `[]`.
- Caught `Error` with an own code in that allowlist: return `[error.message]`.
- Otherwise rethrow the exact caught value.

An inherited code, unknown code, non-string code or plain thrown object does not qualify.
Classification does not use the message prefix or a broad `POLICY_` prefix.

### 2.5 Test exports and registration

`tests/c1.test.mjs` exports exactly:

```typescript
C1_IMPLEMENTATIONS: Array<{
  id: string;
  run(context: TestContext):
    Promise<{ failures: string[]; skipped: null }>;
}>
```

The unchanged C11a context is:

```typescript
{
  repository: string;
  skillRoot: string;
  tmp: string;
  env: Record<string, string>;
}
```

The test module:

- Performs no tests, writes, output or production-module imports at import time.
- Imports production modules lazily during assertion execution.
- Loads `rc1-cases.mjs` and `run-component-tests.mjs` lazily to avoid the import cycle.
- Keeps scratch files beneath `context.tmp`.
- Returns `skipped: null` on every path.
- Reports missing modules, exports or corpus data as failures.
- Never launches the baseline suite from a C1 assertion.

The implementer wires:

```javascript
C1: Object.freeze([...C1_IMPLEMENTATIONS])
```

`COMPONENT_IMPLEMENTATIONS.C1` is a frozen array containing the same descriptor objects as the
test export. Those objects need not themselves be frozen.

`COMPONENT_ASSERTIONS.C1` and its descriptors are deep-frozen independent literals in the exact
section-4.1 order.

`registerRc1Cases` remains unchanged and registers no complete numbered cases.

## 3. Behavior specification

### 3.1 Policy shape, JSON data and schema versions

A policy root must be a non-array, non-Proxy object whose prototype is exactly the current
realm's `Object.prototype` or `null`.

Invalid roots produce `POLICY_ROOT`, including Date, Map, class-instance and Proxy roots.

After the root check, validate the entire JSON domain:

- Allowed primitives: null, booleans, strings and finite numbers.
- Objects have prototype `Object.prototype` or `null`.
- Object properties are own, string-keyed, enumerable data properties.
- Arrays have prototype `Array.prototype` or `null`.
- Arrays are dense, with own enumerable data properties at every index.
- Arrays have only index properties and the standard own `length` property.
- Writable/configurable flags do not matter; frozen JSON data is accepted.
- Symbol keys are rejected, including non-enumerable ones.
- Non-enumerable object properties are rejected.
- Accessors are rejected without invocation.
- Extra own array properties are rejected.
- Functions, symbols, BigInts, nonfinite numbers and nested non-plain objects are rejected.
- Proxies, including revoked Proxies, are rejected without invoking traps.
- Cycles are rejected.
- Shared references without cycles are accepted and copied by value.
- No `toJSON` method is invoked.

Nested/domain failures produce `POLICY_VALUE`.

Detect Proxies before inspecting their prototypes or descriptors. Do not detect them by
invoking traps.

An own `__proto__` JSON key is data. Preserve it without changing a prototype.

Both schemas require an own `patterns` array.

Schema 1:

- `projectPatterns` may be absent; absence becomes `[]`.
- A present `projectPatterns` must be an array.
- Every entry requires an own nonempty string glob.
- Infer `any` for a `**/` prefix; infer `root` otherwise.
- An own anchor property counts as present regardless of its value.
- A present anchor must be valid and agree with the inferred anchor.
- Validate the inferred entry under the schema-2 grammar.
- Return sourceSchema 1 and a cloned policy with schema 2.
- Preserve other entry and file fields.

Schema 2:

- Requires both arrays.
- Requires an own explicit anchor on every entry.
- Accepts only exact strings `any` and `root`.
- Does not default missing anchors.

The architecture's explicit schema-2 contract governs earlier default-anchor wording.

Empty arrays are valid. An explicitly empty effective policy matches no valid path.
Invalid input never falls back to an empty or shipped policy.

Unknown JSON metadata is preserved. C1 adds no consumer-specific schema for `kind`, `note`,
`contentRisk` or scan settings.

Policy schema 2 and manifest schema 3 remain separate. Policy schema 3 is invalid.

### 3.2 Glob grammar and anchors

A glob is a nonempty repository-relative POSIX pattern.

| Token | Meaning on each matching form |
| --- | --- |
| Literal | Matches the same code point after lowercasing. |
| `?` | Matches exactly one non-separator code point. |
| `*` | Matches zero or more non-separator code points. |
| Whole-component `**` | Matches complete components. |
| `/` | Separates components. |

Matching covers the entire form.

A nonterminal `**` matches zero or more components. Terminal `/**` requires at least one
descendant component:

```text
a/**/b matches a/b and a/x/b
a/** matches a/x and a/x/y
a/** does not match a
```

A root glob consisting solely of `**` matches every structurally valid path.

Dot-prefixed names receive no special exclusion. Line terminators are ordinary characters.

PQ1:

- `**/x`, `x/**` and `a/**/b` are valid.
- Adjacent globstar components are valid.
- Joined forms such as `a**b`, `key**.pem`, `**x` and `x**` are invalid.
- Every run of three or more stars is invalid.

Unsupported syntax:

- Either bracket or brace character.
- Any backslash.
- Leading `!`, `~/` or `:(`.
- Any extglob opener anywhere: `?(`, `*(`, `+(`, `@(` or `!(`.

Other punctuation is literal, including quotes, `.`, `+`, `$`, `^`, `|` and parentheses without
an extglob opener. There is no escape syntax.

Reject structural glob forms containing:

- NUL.
- Leading `/`.
- Leading ASCII drive designator, including `C:x`.
- Empty components, including repeated or trailing `/`.
- Components equal to `.` or `..`.

Do not trim submitted globs, collapse separators or remove prefixes during validation.

Anchors:

- `any` requires `**/`.
- `root` prohibits `**/`.
- Root entries match from the repository root.
- Root bare names do not gain generic any-depth semantics.

Validation precedes alias construction. Matching aliases never legalize invalid policy syntax.

### 3.3 Lowercase matching, Windows aliases and complexity

Matching uses JavaScript `toLowerCase()` on copies of the complete glob and candidate path.
This rule applies identically on every host.

Lowercase before counting wildcard code points. Use JavaScript string iteration semantics;
a lone surrogate is one iteration element.

There is one comparison mode: exact code-point comparison of the lowercase forms.

For each component, retain its lowercase spelling and add:

1. Prefix before the first `:`, only when that prefix is nonempty.
2. Component with all trailing ASCII dots and spaces removed.
3. That nonempty colon-prefix with trailing ASCII dots and spaces removed.

Deduplicate equal component alternatives. Each component has at most four alternatives.

Apply the same component forms to glob and path. Glob wildcards remain tokens.
A path is protected if any resulting path form matches any resulting glob form.

Examples:

```text
.env::$DATA has .env as an alias
.env. has .env as an alias
".env " has .env as an alias
".env. :$DATA" has .env as a combined alias
```

Choices are independent between components. Do not enumerate the Cartesian product of complete
paths; compare bounded component alternatives inside the matcher.

An empty prefix before `:` supplies no prefix alias.

Trailing-character removal may produce an empty component alternative. It retains that
component's position. It never removes the component, joins its neighbors or changes the
number of components.

Do not implement:

- `toUpperCase().toLowerCase()` spelling forms.
- NFC or NFD forms.
- Per-code-point simple-fold comparison.
- Removal of dots-and-spaces components.
- Alias-specific component-skipping transitions.

Ordinary wildcard transitions remain part of the matcher. Alias handling adds no traversal
resolution or filesystem queries.

The caller's path, returned validation string and source policy remain unchanged.

Entry identity remains the lowercase tuple in section 2.3. Windows aliases do not merge
entry identities or broaden recorded omission identity.

Because duplicate keys have identical lowercase globs and anchors, one effective entry supplies
their matching behavior. Preserve all source metadata without recompiling duplicate matching
entries.

Algorithm requirements:

- Use non-backtracking dynamic programming or automata.
- One original glob/path comparison is `O(|glob| * |path|)`.
- Alias alternatives add a bounded constant factor.
- Policy matching is bounded by the sum of effective-glob lengths times path length.
- Alias construction is linear.
- Entry intersection uses a product-automaton bound of `O(|left glob| * |right glob|)`.
- Do not use potentially exponential backtracking regular expressions.

Accepted Unicode and component-alias residuals appear in section 5.1.
Realpath and 8.3 resolution remain consumer dependencies.

### 3.4 Deduplication, preservation and equality

Process entries in this order:

1. `patterns`, in array order.
2. `projectPatterns`, in array order.

The first occurrence of a key determines effective-entry position. Later duplicates append
source locations.

Preserve every original entry, spelling and metadata field in the returned policy.
Do not merge conflicting metadata or discard duplicate sources.

For:

```json
{
  "schema": 2,
  "note": "keep",
  "patterns": [
    {"glob": "**/*.PEM", "anchor": "any", "kind": "key", "note": "managed"},
    {"glob": "env/**", "anchor": "root", "kind": "dir"}
  ],
  "projectPatterns": [
    {"glob": "**/*.pem", "anchor": "any", "note": "user"},
    {"glob": "**/*.PEM", "anchor": "any", "extra": {"ticket": 7}}
  ]
}
```

Expect sourceSchema 2, an equal detached policy, and:

```json
[
  {
    "anchor": "any",
    "glob": "**/*.pem",
    "sources": [
      {"collection": "patterns", "index": 0},
      {"collection": "projectPatterns", "index": 0},
      {"collection": "projectPatterns", "index": 1}
    ]
  },
  {
    "anchor": "root",
    "glob": "env/**",
    "sources": [
      {"collection": "patterns", "index": 1}
    ]
  }
]
```

Object key order is not contractual. Compare snapshots using `assert.deepStrictEqual` against
ordinary-object expected values. Array order, strings, values and indexes are exact.

Null-prototype inputs become ordinary output objects. Prototype and shared-reference identity
are not JSON metadata.

Schema-1 adaptation changes only:

- Schema to 2.
- Missing anchors to inferred values.
- Missing projectPatterns to `[]`.

It does not restore entries, replace globs, classify ownership, move entries between arrays,
add current shipped patterns or write files.

Schema-1 `env/**` becomes root-anchored and does not match `src/env/key`.

### 3.5 Errors and validation order

New errors are ordinary `Error` instances with:

```typescript
{
  name: 'Error';
  code: string;
  message: string;
}
```

`code` is an own string property. Messages start with `${code}: `.
Stack traces and additional fields are not contractual.

These 20 codes and suffixes are exact. `<L>` is `entry`, `patterns[i]` or
`projectPatterns[i]`, with decimal zero-based indexes.

| Code | Exact message after the code and colon |
| --- | --- |
| `POLICY_TEXT` | `policy text must be a string` |
| `POLICY_JSON` | `policy text must be valid JSON` |
| `POLICY_ROOT` | `policy must be a JSON object` |
| `POLICY_VALUE` | `policy must contain only JSON data` |
| `POLICY_SCHEMA` | `policy.schema must be 1 or 2` |
| `POLICY_PATTERNS` | `policy.patterns must be an array` |
| `POLICY_PROJECT_PATTERNS` | `policy.projectPatterns must be an array` |
| `POLICY_ENTRY` | `<L> must be an object` |
| `POLICY_GLOB` | `<L>.glob must be a nonempty string` |
| `POLICY_ANCHOR` | `<L>.anchor must be "any" or "root"` |
| `POLICY_GLOB_SYNTAX` | `<L>.glob uses unsupported syntax` |
| `POLICY_GLOBSTAR` | `<L>.glob must use * or a separate **/ component; ** must be a whole component` |
| `POLICY_GLOB_PATH` | `<L>.glob must be a canonical repository-relative glob` |
| `POLICY_ANCHOR_ANY` | `<L>.glob must start with **/ for anchor "any"` |
| `POLICY_ANCHOR_ROOT` | `<L>.glob must not start with **/ for anchor "root"` |
| `POLICY_LEGACY_ANCHOR` | `<L>.anchor conflicts with the inferred legacy anchor` |
| `POLICY_PATH_TYPE` | `path must be a nonempty string` |
| `POLICY_PATH_NUL` | `path must not contain NUL` |
| `POLICY_PATH_ABSOLUTE` | `path must be repository-relative` |
| `POLICY_PATH_CANONICAL` | `path must use canonical POSIX components` |

Stop at the first error.

Policy order:

1. Root type, prototype and Proxy check.
2. Entire JSON-domain check.
3. Own schema equals numeric 1 or 2.
4. Own patterns array.
5. Schema-specific projectPatterns rule.
6. Every patterns entry, then every projectPatterns entry.
7. Construct output.

Entry order:

1. Entry object.
2. Own nonempty string glob.
3. Anchor validity when required or present.
4. Unsupported syntax.
5. PQ1 restrictions.
6. Structural glob form.
7. Schema-1 existing-anchor conflict.
8. Anchor-prefix consistency.

The whole-policy JSON-domain pass runs before entry checks. A nested Date entry therefore
produces `POLICY_VALUE`; a JSON null/array entry produces `POLICY_ENTRY`.

Standalone entry validation rejects non-plain, array or Proxy entries with `POLICY_ENTRY`,
then checks JSON data and the remaining schema-2 entry rules.

`policyEntriesMayOverlap` validates both entries before calculating a result, left first.

Parsing checks text type, JSON parsing, then policy validation.
Path matching checks policy before candidate.

Messages never include rejected path/glob contents, metadata values or raw JSON.

### 3.6 Structural path validation: R75

Order:

1. Nonempty string; otherwise `POLICY_PATH_TYPE`.
2. No NUL; otherwise `POLICY_PATH_NUL`.
3. No absolute form; otherwise `POLICY_PATH_ABSOLUTE`.
4. Canonical POSIX components; otherwise `POLICY_PATH_CANONICAL`.

Absolute forms:

- Leading `/`.
- Leading backslash.
- Leading ASCII letter followed by `:`, including drive-relative `C:relative`.

Noncanonical forms:

- Remaining backslash.
- Empty slash-delimited component.
- Component equal to `.` or `..`.

Preserve spaces, tabs, line terminators, quotes, wildcard-looking characters and non-ASCII
characters exactly.

Streams, trailing dots/spaces and components such as `...` or ` . ` can be structurally valid.
Validation returns them unchanged. Matching only supplies the aliases in section 3.3.

Do not trim, lowercase, normalize Unicode, query the filesystem or inspect Git.

C4 owns exact-case Git lookup. A matching alias never replaces the requested Git name.

### 3.7 Generic matching and permission overlap

`globToRegExp` and `matchesAny` remain byte-for-byte unchanged. They retain generic
write-allowlist/content-risk behavior and host-dependent case handling.

Secret matching must not call them after C1.

`globsMayOverlap(ruleGlob, exceptionGlob)` preserves existing permission normalization:

- Trim the expression and remove one leading `!`.
- Record a leading `/` as an anchor.
- Remove one `./` prefix as existing permission normalization permits.
- Remove the leading anchor slash.
- Convert trailing `/` into `/**`.
- Treat an unanchored bare name as `**/<name>`.
- Represent a normalized `**/` glob with anchor `any`; otherwise use `root`.

Validate normalized entries through `policyEntryKey`. Do not collapse invalid star runs.

For valid modeled operands:

1. Call `policyEntriesMayOverlap` on their complete entries.
2. If false and the rule ends in terminal `/**` with a nonempty prefix, compare its
   directory-prefix entry against the exception entry.
3. Return true if either comparison intersects; otherwise false.

The directory-prefix comparison preserves existing permission behavior. Do not extend the
exception into `<exception>/**`.

Shared intersection:

- Lowercases both operands.
- Uses code-point segment and path product automata.
- Considers the same bounded Windows-alias alternatives as path matching.
- Does not add Unicode folding, normalization or component omission.

Non-ASCII text, colons and trailing dots/spaces are not blanket-overlap conditions.
A modeled unrelated exception returns false.

Return conservative true only for genuinely unmodeled input:

- Non-string or empty after trimming.
- Unmodeled permission anchors such as `~/` or `//`.
- Unsupported syntax or invalid normalized policy grammar.

`segmentsIntersect` remains the legacy UTF-16 helper. The shared engine must not use it as its
code-point intersection oracle.

## 4. Tests and exact registration

### 4.1 Component inventory

Register exactly these twelve descriptors in order:

| ID | Name |
| --- | --- |
| `R45/C1/grammar` | `policy grammar and PQ1 rejection` |
| `R45/C1/schema` | `strict policy schemas and errors` |
| `R44/C1/anchors` | `root and any-depth matching` |
| `R74/C1/case` | `platform-independent case matching` |
| `R74/C1/corpus` | `shared policy matching corpus` |
| `R74/C1/deduplication` | `effective entries preserve source metadata` |
| `R75/C1/path-validation` | `structural checks preserve exact path names` |
| `R78/C1/legacy-adapter` | `validated non-writing schema-1 adapter` |
| `R97/C1/environment-names` | `environment-name variant matching` |
| `V2/C1/source-helpers` | `source helpers use shared policy semantics` |
| `V2/C1/exception-overlap` | `user exception overlap stays conservative` |
| `V2/C1/module-contract` | `standalone module and component contracts` |

Successful outcomes are exactly:

```json
{"failures":[],"skipped":null}
```

Rejection tests assert code and complete message. Failure diagnostics identify case IDs.

C1 never emits complete numbered-case records for partial coverage.

### 4.2 Shared corpus and consumer obligations

Fixture shape:

```typescript
{
  schema: 1;
  matches: Array<{
    id: string;
    entry: { anchor: Anchor; glob: string };
    path: string;
    expected: boolean;
  }>;
  rejectedEntries: Array<{
    id: string;
    entry: { anchor: Anchor; glob: string };
    code: string;
    message: string;
  }>;
}
```

This schema versions the corpus, not the policy.

Exact matching inventory, preserving retained row IDs:

```text
A01-A10
W01-W30
C01-C08, C11
B01-B09, B12
E01-E19
```

There are 78 matching rows. Rejected-entry inventory is G01-G27.

Use group order above and numeric order within groups. Each table row is one object.
Quoted JSON strings denote decoded values.

For every row, test both placements:

```javascript
{ schema: 2, patterns: [entry], projectPatterns: [] }
{ schema: 2, patterns: [], projectPatterns: [entry] }
```

The tests lane embeds independent expected literals. Missing, extra, duplicate or changed rows
fail. The fixture cannot define its own oracle.

This is the exact shared-matcher oracle. Later consumers must be at least as protective:

- Positive rows remain protected.
- Negative rows do not authorize exposure.
- Broader consumer protection is permitted.
- Git consumers may post-filter through the shared matcher.
- Static rendering is distinct from measured host enforcement.
- Unsupported policies fail closed.

C3, C4 and C11b own consumer-specific acceptance.

### 4.3 Anchors, wildcards and complexity

| ID | Anchor | Glob | Path | Expected |
| --- | --- | --- | --- | --- |
| A01 | root | `env/**` | `env/key` | true |
| A02 | root | `env/**` | `src/env/key` | false |
| A03 | any | `**/env/**` | `env/key` | true |
| A04 | any | `**/env/**` | `src/env/key` | true |
| A05 | root | `key.pem` | `key.pem` | true |
| A06 | root | `key.pem` | `src/key.pem` | false |
| A07 | any | `**/key.pem` | `key.pem` | true |
| A08 | any | `**/key.pem` | `src/key.pem` | true |
| A09 | root | `env/**` | `env` | false |
| A10 | root | `**` | `src/file` | true |
| W01 | root | `a/*/b` | `a/x/b` | true |
| W02 | root | `a/*/b` | `a/x/y/b` | false |
| W03 | root | `a/*/b` | `a/b` | false |
| W04 | root | `a/**/b` | `a/b` | true |
| W05 | root | `a/**/b` | `a/x/y/b` | true |
| W06 | root | `a/**/b` | `x/a/b` | false |
| W07 | root | `a/**` | `a/b/c` | true |
| W08 | root | `a/**` | `a` | false |
| W09 | root | `a/**/**/b` | `a/b` | true |
| W10 | root | `a/**/**/b` | `a/x/y/b` | true |
| W11 | any | `**/*.pem` | `.pem` | true |
| W12 | any | `**/*.pem` | `x/key.pem` | true |
| W13 | any | `**/*.pem` | `x/key.pem.txt` | false |
| W14 | root | `key?.pem` | `key1.pem` | true |
| W15 | root | `key?.pem` | `key.pem` | false |
| W16 | root | `key?.pem` | `key12.pem` | false |
| W17 | root | `a*b` | `ab` | true |
| W18 | root | `a*b` | `a/x/b` | false |
| W19 | root | `dir/*` | `dir/.hidden` | true |
| W20 | root | `dir/*` | `"dir/a\nb"` | true |
| W21 | root | `dir/?` | `"dir/\ud83d\ude00"` | true |
| W22 | root | `a+b.(txt)` | `a+b.(txt)` | true |
| W23 | root | `a+b.(txt)` | `abXtxt` | false |
| W24 | root | `"a|b"` | `"a|b"` | true |
| W25 | root | `a.$^` | `a.$^` | true |
| W26 | any | `**/**/x` | `x` | true |
| W27 | root | `dir/?` | `"dir/\r"` | true |
| W28 | root | `dir/*` | `"dir/a\rb"` | true |
| W29 | root | `dir/?` | `"dir/\u2028"` | true |
| W30 | root | `dir/*` | `"dir/a\u2028b"` | true |

A01-A10 belong to `R44/C1/anchors`. W01-W30 and corpus integrity belong to `R74/C1/corpus`.

Complexity regression, outside the JSON corpus:

```text
glob: *a*a*a*a*a*a*a*a*b
anchor: root
negative path: "a".repeat(8192)
positive path: "a".repeat(8192) + "b"
expected: [false, true]
```

The test writes a probe beneath `context.tmp` and launches it with `process.execPath`.

The probe obtains the module URL using:

```javascript
pathToFileURL(
  path.join(skillRoot, 'assets', 'tools', 'security-policy.mjs')
).href
```

Pass `context.skillRoot` as a child argument. Import that URL dynamically in the child.
Do not use shell interpolation or an import relative to the temporary directory.

Child options:

```text
timeout: 60000
shell: false
windowsHide: true
encoding: "utf8"
env: a copy of context.env
cwd: context.tmp
```

Require:

```text
status: 0
signal: null
error: absent
stdout: "[false,true]\n"
stderr: ""
```

Timeout, signal or spawn failure fails the assertion. The algorithmic bound remains required;
one timing test does not establish it.

### 4.4 Grammar rejection corpus

Exact rejected inventory: G01-G27, in order.

Use `policyEntryKey`; error location is `entry`. Full messages combine each code with its
section-3.5 suffix.

| ID | Anchor | Glob | Expected code |
| --- | --- | --- | --- |
| G01 | root | `a**b` | `POLICY_GLOBSTAR` |
| G02 | root | `key**.pem` | `POLICY_GLOBSTAR` |
| G03 | root | `**x` | `POLICY_GLOBSTAR` |
| G04 | root | `x**` | `POLICY_GLOBSTAR` |
| G05 | root | `***` | `POLICY_GLOBSTAR` |
| G06 | any | `**/a***b` | `POLICY_GLOBSTAR` |
| G07 | any | `**/****/x` | `POLICY_GLOBSTAR` |
| G08 | any | `**/[ab].pem` | `POLICY_GLOB_SYNTAX` |
| G09 | any | `**/x].pem` | `POLICY_GLOB_SYNTAX` |
| G10 | any | `**/{a,b}.pem` | `POLICY_GLOB_SYNTAX` |
| G11 | root | `"key\\*.pem"` | `POLICY_GLOB_SYNTAX` |
| G12 | root | `!key.pem` | `POLICY_GLOB_SYNTAX` |
| G13 | root | `~/key.pem` | `POLICY_GLOB_SYNTAX` |
| G14 | root | `:(glob)key.pem` | `POLICY_GLOB_SYNTAX` |
| G15 | root | `@(key).pem` | `POLICY_GLOB_SYNTAX` |
| G16 | root | `?(key).pem` | `POLICY_GLOB_SYNTAX` |
| G17 | root | `/key.pem` | `POLICY_GLOB_PATH` |
| G18 | root | `C:/key.pem` | `POLICY_GLOB_PATH` |
| G19 | root | `C:key.pem` | `POLICY_GLOB_PATH` |
| G20 | root | `./key.pem` | `POLICY_GLOB_PATH` |
| G21 | root | `a/../key.pem` | `POLICY_GLOB_PATH` |
| G22 | root | `a//key.pem` | `POLICY_GLOB_PATH` |
| G23 | root | `a/` | `POLICY_GLOB_PATH` |
| G24 | any | `key.pem` | `POLICY_ANCHOR_ANY` |
| G25 | root | `**/key.pem` | `POLICY_ANCHOR_ROOT` |
| G26 | root | `key*(1).pem` | `POLICY_GLOB_SYNTAX` |
| G27 | root | `a/+(b)` | `POLICY_GLOB_SYNTAX` |

Supplementary cases:

- `*(key)`, `+(key)`, `!(key)` produce `POLICY_GLOB_SYNTAX`.
- `"a\u0000b"` produces `POLICY_GLOB_PATH`.
- `a/./b`, `.`, `..`, `//server/share` produce `POLICY_GLOB_PATH`.
- Repeat G01-G27 inside both policy arrays with indexed error locations.
- Valid PQ1 examples A07, W04 and W07 pass reader and key validation.
- Repeat standalone invalid-entry cases as either overlap operand; location remains `entry`.
- With invalid left and right operands, assert the left error wins.

These belong to `R45/C1/grammar`.

### 4.5 Strict schema and error tests

Valid base:

```json
{"schema":2,"patterns":[],"projectPatterns":[]}
```

| Case | Input or mutation | Expected |
| --- | --- | --- |
| S01 | Null, array, primitive or undefined root | `POLICY_ROOT` |
| S02 | Date, Map or class-instance root | `POLICY_ROOT` |
| S03 | Proxy or revoked-Proxy root | `POLICY_ROOT`; no trap |
| S04 | Missing schema; `0`, `3`, `"2"` or null | `POLICY_SCHEMA` |
| S05 | Missing patterns; null, object or string | `POLICY_PATTERNS` |
| S06 | Missing projectPatterns; null, object or string | `POLICY_PROJECT_PATTERNS` |
| S07 | Null, array or string entry | `POLICY_ENTRY` |
| S08 | Missing, empty, numeric or null glob | `POLICY_GLOB` |
| S09 | Missing, empty, invalid-case, null or numeric anchor | `POLICY_ANCHOR` |
| S10 | Empty valid base | Empty effectivePatterns; sourceSchema 2 |
| S11 | Unknown JSON metadata | Preserved |
| S12 | Valid entry followed by invalid entry | Later entry error |
| S13 | Matching entry followed by invalid duplicate | Error, never true |
| S14 | Invalid schema and arrays | `POLICY_SCHEMA` |
| S15 | Invalid patterns and projectPatterns | `POLICY_PATTERNS` |
| S16 | Empty glob and invalid anchor | `POLICY_GLOB` |
| S17 | Invalid anchor and globstar | `POLICY_ANCHOR` |
| S18 | Unsupported syntax and invalid globstar | `POLICY_GLOB_SYNTAX` |
| S19 | Invalid globstar and path | `POLICY_GLOBSTAR` |
| S20 | Invalid policy and candidate | Policy error first |

S09 includes exact invalid strings `"ANY"` and `"Root"`.

JSON-domain tests:

| Case | Input | Expected |
| --- | --- | --- |
| JD01 | Object.prototype and null-prototype objects | Accepted |
| JD02 | Frozen valid data | Accepted |
| JD03 | Shared metadata reference without cycle | Accepted; copied by value |
| JD04 | Direct or indirect cycle | `POLICY_VALUE` |
| JD05 | Function, symbol, BigInt, NaN or Infinity metadata | `POLICY_VALUE` |
| JD06 | Date, Map or class-instance metadata | `POLICY_VALUE` |
| JD07 | Nested Proxy or revoked Proxy | `POLICY_VALUE`; no trap |
| JD08 | Enumerable/non-enumerable symbol key | `POLICY_VALUE` |
| JD09 | Non-enumerable object property | `POLICY_VALUE` |
| JD10 | Getter/setter property | `POLICY_VALUE`; no invocation |
| JD11 | Sparse array | `POLICY_VALUE` |
| JD12 | Extra array string/symbol/non-enumerable property | `POLICY_VALUE` |
| JD13 | Accessor or non-enumerable array index | `POLICY_VALUE` |
| JD14 | Dense array with Array.prototype or null prototype | Accepted |
| JD15 | Array with other prototype | `POLICY_VALUE` |
| JD16 | Own `__proto__` JSON key | Preserved; no prototype change |
| JD17 | Function-valued `toJSON` | `POLICY_VALUE`; never invoked |
| JD18 | Inherited schema through custom root prototype | `POLICY_ROOT` |

Parsing:

| Case | Input | Expected |
| --- | --- | --- |
| J01 | Non-string, including Buffer | `POLICY_TEXT` |
| J02 | Empty string, `"{"`, trailing-comma JSON | `POLICY_JSON` |
| J03 | Serialized valid base | Same snapshot as reader |
| J04 | One initial BOM plus valid JSON | Same snapshot |
| J05 | Two initial BOMs plus valid JSON | `POLICY_JSON` |
| J06 | JSON `"null"` | `POLICY_ROOT` |
| J07 | JSON schema 3 | `POLICY_SCHEMA` |

Malformed text includes sentinel content; it must not appear in diagnostics.

For reader validation failures, `checkSecurityPolicy` returns exactly one full message.
Valid input returns `[]`.

Classification tests use an isolated module fixture:

1. Copy `scripts/schemas.mjs` under `context.tmp`, preserving relative layout.
2. Write a stub at `assets/tools/security-policy.mjs`.
3. Import the copied schema module and stub using file URLs.
4. Change the sentinel through the stub's exported setter before each call.

Exact stub interface:

```javascript
export let sentinel;

export function setSentinel(value) {
  sentinel = value;
}

export function readSecurityPolicy() {
  throw sentinel;
}
```

Do not assign to an imported ESM binding.

Classification cases:

| Sentinel | Result |
| --- | --- |
| Error with each of the 20 known own codes | `[sentinel.message]` |
| Error with own `POLICY_UNKNOWN` | Rethrow same object |
| Error with inherited `POLICY_SCHEMA` | Rethrow same object |
| Error with own numeric code | Rethrow same object |
| Error without code | Rethrow same object |
| Plain object with `POLICY_SCHEMA` | Rethrow same object |
| String `"sentinel"` | Rethrow same value |

Use message `"sentinel"` for Error cases. Classification must not depend on the message prefix.

These tests belong to `R45/C1/schema`.

### 4.6 Case policy and Windows aliases

| ID | Anchor | Glob | Path | Expected |
| --- | --- | --- | --- | --- |
| C01 | any | `**/*.PEM` | `src/Key.pem` | true |
| C02 | root | `ENV/**` | `env/Key` | true |
| C03 | root | `ENV/**` | `src/env/Key` | false |
| C04 | root | `"\u00c9.pem"` | `"\u00e9.PEM"` | true |
| C05 | root | `"\u00e9.pem"` | `"e\u0301.pem"` | false |
| C06 | root | `"\u212a.pem"` | `k.pem` | true |
| C07 | any | `**/secrets/**` | `"\u017fecrets/x"` | false |
| C08 | root | `"i\u0307.pem"` | `"\u0130.PEM"` | true |
| C11 | root | `?.pem` | `"\u0130.pem"` | false |

C05, C07 and C11 are each labelled **accepted residual (PQ2)** in test diagnostics:

- C05: no Unicode normalization.
- C07: no Unicode case-fold alias beyond `toLowerCase()`.
- C11: wildcard counts apply after lowercase expansion.

C04, C06 and C08 remain ordinary lowercase behavior, not additional alias forms.

Exact entry keys:

```text
{anchor:"any",glob:"**/*.PEM"} -> '["any","**/*.pem"]'
{anchor:"root",glob:"ENV/**"} -> '["root","env/**"]'
```

Original spelling remains unchanged.

| ID | Anchor | Glob | Path | Expected |
| --- | --- | --- | --- | --- |
| B01 | any | `**/.env` | `.env::$DATA` | true |
| B02 | any | `**/.env` | `.env.` | true |
| B03 | any | `**/.env` | `".env "` | true |
| B04 | root | `secrets/**` | `secrets::$INDEX_ALLOCATION/t` | true |
| B05 | any | `**/.env` | `".env. :$DATA"` | true |
| B06 | root | `notes.txt.` | `notes.txt` | true |
| B07 | root | `notes.txt` | `notes.txt.` | true |
| B08 | root | `secrets/t` | `"secrets::$INDEX_ALLOCATION/t. "` | true |
| B09 | root | `foo` | `:foo` | false |
| B12 | root | `secrets/t` | `secrets/.../t` | false |

B05 pins the combined prefix-and-trailing-character alias. B08 pins independent alias choices
in different components.

B12 is labelled **accepted residual (PQ2)**. Trimming its middle component does not remove
that component or join `secrets` to `t`.

C and B rows belong to `R74/C1/case`. Residual labels are diagnostic text; they do not change
the corpus object shape.

### 4.7 Metadata and deduplication

`R74/C1/deduplication` tests:

1. The complete section-3.4 example.
2. Duplicates within and across both arrays.
3. Matching project entry with empty managed patterns.
4. Invalid duplicates fail before deduplication.
5. Differing metadata remains on each source.
6. File metadata, nested arrays and objects survive.
7. Own `__proto__` survives without prototype change.
8. Deep-frozen input succeeds unchanged.
9. Returned metadata cannot mutate input or later results.
10. Input changes between calls affect the next result.
11. `a/**/b` and `a/**/**/b` retain distinct keys.
12. Lowercase variants share keys; Windows-alias variants need not.
13. Object key order is ignored; array order is exact.
14. Deduplicating lowercase variants preserves their matching result.

The original-spelling Unicode-union regression from round 3 is removed. Under replacement PQ2,
a duplicate's lowercase glob and anchor fully determine its matching behavior.

### 4.8 Structural path tests

Valid inputs return the exact original string:

```json
[
  "src/Key.PEM",
  "space dir/a b.txt",
  "a\tb",
  "a\nb",
  "a\rb",
  "a\u2028b",
  "quote\"file",
  "single'file",
  "literal[1]*?.txt",
  "..work/file",
  ".hidden/file",
  "-leading",
  "  ",
  "caf\u00e9/File",
  ".env::$DATA",
  ".env.",
  ".env ",
  "secrets::$INDEX_ALLOCATION/t",
  "secrets/.../t",
  "secrets/ . /t"
]
```

Reject:

| Inputs | Code |
| --- | --- |
| Undefined, null, true, number, object, array, empty string | `POLICY_PATH_TYPE` |
| `"a\u0000b"` | `POLICY_PATH_NUL` |
| `/x`, `//server/share`, `C:/x`, `C:x`, `"\\x"`, `"\\\\server\\share"` | `POLICY_PATH_ABSOLUTE` |
| `"a\\b"`, `./x`, `.`, `..`, `a/../b`, `a/./b`, `a//b`, `a/` | `POLICY_PATH_CANONICAL` |

Precedence:

- NUL plus absolute prefix produces `POLICY_PATH_NUL`.
- `C:\x` produces `POLICY_PATH_ABSOLUTE`.
- Traversal is rejected without resolution.

Every invalid candidate also fails through `matchesPolicyPath` with a valid empty policy.
An empty policy does not bypass validation.

For all retained C and B candidates, validate independently and assert exact preservation,
regardless of the matching result.

These belong to `R75/C1/path-validation`.

### 4.9 Schema-1 adapter and shipped data

Input:

```json
{
  "schema": 1,
  "patterns": [
    {"glob": "**/*.PEM", "kind": "key", "note": "keep"},
    {"glob": "env/**", "kind": "dir"}
  ],
  "contentRisk": {"globs": ["**/*.config.ts"]},
  "codexGlobScanMaxDepth": 6,
  "custom": {"keep": [1, 2]}
}
```

Expect sourceSchema 1, returned schema 2, anchors `any` then `root`, projectPatterns `[]`,
and preservation of every other value and original spelling.

Effective globs: `**/*.pem`, then `env/**`.

```text
env/key -> true
src/env/key -> false
src/Key.PEM -> true
```

Additional cases:

| Case | Input | Expected |
| --- | --- | --- |
| L01 | Valid schema-1 projectPatterns | Preserve and infer anchors |
| L02 | Null projectPatterns | `POLICY_PROJECT_PATTERNS` |
| L03 | `env/**` with root anchor | Accept |
| L04 | `env/**` with any anchor | `POLICY_LEGACY_ANCHOR` |
| L05 | Prefixed glob with root anchor | `POLICY_LEGACY_ANCHOR` |
| L06 | Anchor `"ANY"` | `POLICY_ANCHOR` |
| L07 | Unsupported grammar/PQ1 violation | Same grammar error as schema 2 |
| L08 | Bare `key.pem` | Root-only matching |
| L09 | Missing formerly shipped entry | No restoration |
| L10 | Added entry in patterns | Stays in patterns |
| L11 | Old environment globs | No replacement |
| L12 | Read returned policy again | sourceSchema 2; same effective entries |
| L13 | Own anchor null | `POLICY_ANCHOR` |

For immutable `data/secret-paths-v2.0.0.json`, require sourceSchema 1 and exactly 19 effective
entries, all `any`, in this order:

```text
**/.env
**/.env.*
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/*.crt
**/*.cer
**/*.jks
**/*.keystore
**/id_rsa*
**/id_ed25519*
**/secrets/**
**/credentials/**
**/.aws/**
**/.ssh/**
**/.gnupg/**
**/.npmrc
**/.ai/.run/*/vault/**
```

Each has source `{collection: "patterns", index: i}`.

For mutable `data/secret-paths.json`, require only the C1 input contract:

- It passes `readSecurityPolicy`.
- sourceSchema is 1 at this landing.
- Every source entry is valid and preserved under adaptation.
- Metadata is preserved.
- Do not pin its entry count, glob list or fixed sequence to the v2 snapshot.

For both files, preserve `$comment`, `contentRisk`, `codexGlobScanMaxDepth`, other metadata and
file bytes.

These tests belong to `R78/C1/legacy-adapter`.
Ownership and baseline classification remain C3 work.

### 4.10 Environment-name corpus

All entries use `{anchor: "any", glob: "**/.env*"}`.

| ID | Path | Expected |
| --- | --- | --- |
| E01 | `.env` | true |
| E02 | `.env.local` | true |
| E03 | `.envrc` | true |
| E04 | `.env-prod` | true |
| E05 | `.env.example` | true |
| E06 | `.env.sample` | true |
| E07 | `.env.template` | true |
| E08 | `src/.envrc` | true |
| E09 | `src/deep/.env-prod` | true |
| E10 | `SRC/.ENVRC` | true |
| E11 | `src/.EnV.ExAmPlE` | true |
| E12 | `env` | false |
| E13 | `dotenv` | false |
| E14 | `x.env` | false |
| E15 | `.en` | false |
| E16 | `.envdir/file.txt` | false |
| E17 | `.env::$DATA` | true |
| E18 | `.env.` | true |
| E19 | `".env "` | true |

E16 confirms full-path matching rather than implicit recursive directory matching.
Later controls may protect more broadly.

No template exception is introduced. E05-E07 remain protected.

C1 does not change the shipped list; these tests explicitly provide the replacement pattern.

These belong to `R97/C1/environment-names`.

### 4.11 Source-helper and overlap regressions

`V2/C1/source-helpers` asserts:

- Valid results equal the shared matcher for retained A, C, B and E rows.
- Schema-1 `env/**` stays root-only.
- Project entries participate in both helpers.
- Section 3.4 produces `["**/*.pem", "env/**"]` from `secretGlobs`.
- Malformed policies propagate exact errors.
- Every invalid section-4.8 candidate returns true from `isSecretPath`.
- `./.env`, `./AGENTS.md` and empty relative strings return true.
- Invalid policy still wins over invalid candidate.
- Unmatched `AGENTS.md` returns false under the shipped policy.
- Generic bare-name matching remains any-depth.

Pin generic behavior:

```javascript
globToRegExp('Docs/**').flags
  === (process.platform === 'win32' ? 'i' : '');

globToRegExp('Docs/**').test('docs/a')
  === (process.platform === 'win32');

globToRegExp('a**b').test('a/x/b') === true;
```

Write scope:

- `docs/a.md` and `.ai/tools/x.mjs` remain writable.
- `src/a.ts` throws `write outside documentation scope: src/a.ts`.
- `.git/config` throws `write denied by policy: .git/config`.

`V2/C1/exception-overlap` asserts:

| Rule | Exception | Expected |
| --- | --- | --- |
| `**/.env.*` | `!*.example` | true |
| `**/.env.*` | `!**/*.example` | true |
| `**/.env.*` | `!.env.?xample` | true |
| `**/.env.*` | `!*` | true |
| `**/.env.*` | `![.]env.example` | true |
| `**/.env.*` | `!docs/README.md` | false |
| `**/.env.*` | `!/README.md` | false |
| `**/secrets/**` | `!README.md` | true |
| `**/.env` | `!README.md` | false |
| `/env/**` | `!env` | true |
| `**/*.pem` | `!~/public/*` | true |
| `**/*.pem` | `!//public/*` | true |
| `**/*.pem` | `!a**b` | true |
| `**/*.pem` | `!a***b` | true |
| `a**b` | `!docs/README.md` | true |
| `**/*.pem` | Empty string | true |
| `**/*.pem` | Null | true |
| `"**/\ud83d\ude00.pem"` | `!?.pem` | true |
| `**/key.pem` | `!key.pem.` | true |
| `**/.env` | `!.env::$DATA` | true |
| `**/.env` | `"!docs/r\u00e9sum\u00e9.md"` | false |
| `**/*.pem` | `!a.txt.` | false |

Keep the legacy helper assertion:

```javascript
segmentsIntersect('\ud83d\ude00.pem', '?.pem') === false
```

Its result is not used by the shared code-point engine.

Direct `policyEntriesMayOverlap` tests:

| Left entry | Right entry | Expected |
| --- | --- | --- |
| root `env/**` | root `docs/*.md` | false |
| any `**/.env` | root `"docs/r\u00e9sum\u00e9.md"` | false |
| any `"**/\ud83d\ude00.pem"` | any `**/?.pem` | true |
| any `**/.env` | any `**/.env::$DATA` | true |
| any `**/*.pem` | any `**/a.txt.` | false |
| root `a/**` | root `a` | false |

Check symmetry for valid direct-entry pairs. Check input non-mutation.

For every immutable v2 shipped glob, assert no overlap with
`!docs/r\u00e9sum\u00e9.md`. This proves that exception cannot hold back any of the 19 denies.

Retain existing R09/R17 integration checks and R17's witness-based soundness test.

### 4.12 Module, import and harness contracts

`V2/C1/module-contract` checks import safety for:

```text
assets/tools/security-policy.mjs
tests/c1.test.mjs
```

Use C11a's `checkImportSafe` criteria:

- No spawn.
- No filesystem writes.
- No stdout/stderr.
- No `process.exit`.
- No change to `process.exitCode`.
- Successful import.

Assert exact export sets:

```text
security-policy.mjs:
  POLICY_SCHEMA_VERSION
  matchesPolicyPath
  parseSecurityPolicy
  policyEntriesMayOverlap
  policyEntryKey
  readSecurityPolicy
  validateRepoPath

c1.test.mjs:
  C1_IMPLEMENTATIONS
```

Additional checks:

- `POLICY_SCHEMA_VERSION === 2`.
- Standalone asset copy passes A01, W04, C01, B01, B05 and G01.
- It also reproduces residual results C05, C07, C11 and B12.
- The standalone copy passes the Unicode-disjoint overlap example.
- Direct calls emit no output.
- Errors have the required name, own code and message.
- C1 inventory equals section 4.1 independently.
- Expected inventory and descriptors are deep-frozen.
- Implementation array is frozen and contains the same test-export objects.
- C11a inventory remains unchanged.
- `registerRc1Cases` registers no complete rc.1 cases.

Runner seam:

```javascript
main(['--component', 'C1'], {
  context,
  registry: {
    expected: { C1: expectedDescriptors },
    implementations: { C1: controlledImplementations }
  },
  writeEvidence: () =>
    path.join(context.tmp, 'component-results.json')
})
```

Assert:

- Twelve successful outcomes yield section 6.1 exactly.
- Missing first implementation yields `missing-group`, no execution and exit 1.
- `failures: ['sentinel'], skipped: null` yields FAIL and
  `        - sentinel`.
- `failures: [], skipped: 'sentinel'` yields FAIL and
  `        - skip-forbidden: sentinel`.
- Throwing evidence writer yields only
  `COMPONENT  FAIL  evidence-write\n`, exit 1 and empty stderr.

No C11a runner or evidence contract changes.

## 5. Edge cases and failure modes

| Frozen section-5 C1 item | Coverage |
| --- | --- |
| Root/any-depth anchors | A01-A10 |
| Mixed case | C01-C04, C06, C08, E10-E11 |
| Wildcard boundaries | W01-W30 |
| Unsupported grammar | G01-G27 and supplements |
| Schema-1 root mapping | Section 4.9 and source-helper tests |
| Unknown schema fails closed | S04, J07, S20 |
| Malformed input never falls back | S05-S09, S12-S20 |
| Duplicate metadata retained | Section 4.7 |
| Structural checks preserve Git names | Section 4.8 |
| Conservative exception overlap | Section 4.11 and R09/R17 |

Additional coverage:

| Failure mode | Tests |
| --- | --- |
| Streams and trailing dots/spaces | B01-B08, E17-E19 |
| Combined Windows alias missed | B05 |
| Empty colon prefix invents an alias | B09 |
| Invalid helper path permits a read | Section 4.11 |
| Harmless Unicode exception holds back all denies | Section 4.11 v2-list check |
| Accessors or Proxy traps execute | JD01-JD18 |
| Hidden extglob syntax | G26-G27 |
| Exponential matching | Section 4.3 and algorithm requirements |
| Line terminators evade wildcards | W20, W27-W30 |
| UTF-16 helper drives code-point overlap | Section 4.11 |
| Missing groups or forbidden skips | Section 4.12 |

Filesystem aliases requiring realpath and invalid-manifest-key validation remain explicitly
assigned dependencies. C1 does not claim those later checks passed.

No C1 test is privilege-dependent or permitted to skip.

### 5.1 Accepted residual risks

Each following limitation is accepted by PQ2, not implementation work:

- Unicode case-fold aliases such as U+017F: lowercase alone does not equate them with ASCII names.
- NFC/NFD aliases: normalization is omitted because C1 targets the team's Windows/ASCII secret names.
- U+0130 expansion: lowercase produces two code points, so a one-code-point `?` can miss it.
- C18-style `?/k` versus `"i\u0307/K"` remains false: `?` counts code points, not graphemes.
- Dots-and-spaces components: trimming does not remove a component or join neighboring components.

C05, C07, C11 and B12 provide one labelled regression row per corresponding residual category.
The C18-style case is documented here without another redundant corpus row.

Windows 8.3 names require the realpath checks assigned to C5 and the C3 follow-up; lexical
matching does not resolve them.

## 6. Runnable acceptance for C1 alone

From the repository root after tests and implementation land:

```powershell
node project-setup/tests/run-component-tests.mjs --component C1
node project-setup/tests/run-component-tests.mjs --component C11a
node project-setup/tests/run-tests.mjs --keep
```

These commands were not run by this lane.

### 6.1 C1 output

Exit 0, empty stderr, exactly:

```text
PASS  R45/C1/grammar  policy grammar and PQ1 rejection
PASS  R45/C1/schema  strict policy schemas and errors
PASS  R44/C1/anchors  root and any-depth matching
PASS  R74/C1/case  platform-independent case matching
PASS  R74/C1/corpus  shared policy matching corpus
PASS  R74/C1/deduplication  effective entries preserve source metadata
PASS  R75/C1/path-validation  structural checks preserve exact path names
PASS  R78/C1/legacy-adapter  validated non-writing schema-1 adapter
PASS  R97/C1/environment-names  environment-name variant matching
PASS  V2/C1/source-helpers  source helpers use shared policy semantics
PASS  V2/C1/exception-overlap  user exception overlap stays conservative
PASS  V2/C1/module-contract  standalone module and component contracts
12 PASS / 0 FAIL / 0 SKIP
RESULTS  <absolute-report-path>
```

Every line ends in LF. The dynamic path is the absolute native path to the runner-created
`component-results.json`.

Report:

```text
component: "C1"
ok: true
errors: []
summary: { passed: 12, failed: 0, skipped: 0 }
```

The twelve results match section 4.1, with PASS status and empty failures.

Missing first implementation:

```text
COMPONENT  FAIL  missing-group  R45/C1/grammar
0 PASS / 0 FAIL / 0 SKIP
RESULTS  <absolute-report-path>
```

Exit 1; empty stderr.

One controlled failure or forbidden skip produces the affected FAIL record, its exact
section-4.12 diagnostic, and:

```text
11 PASS / 1 FAIL / 0 SKIP
```

Other records remain PASS. Exit 1; empty stderr.

Evidence-write failure produces only:

```text
COMPONENT  FAIL  evidence-write
```

Exit 1; empty stderr; no totals or RESULTS line.

### 6.2 C11a retention

Exit 0, empty stderr:

```text
PASS  V2/C11a/tag-identity  trusted v2 tag identity
PASS  V2/C11a/snapshot-inventory  exhaustive v2 snapshot mapping
PASS  V2/C11a/snapshot-bytes  raw tagged snapshot byte parity
PASS  V2/C11a/installed-fixture  tagged v2 installation and provenance
PASS  V2/C11a/fixture-failures  v2 fixture failures are fatal
PASS  V2/C11a/live-v2  live v2 fixture and existing kinds
PASS  V2/C11a/component-records  strict component result contract
PASS  V2/C11a/strict-gate  strict rc1 acceptance contract
8 PASS / 0 FAIL / 0 SKIP
RESULTS  <absolute-report-path>
```

### 6.3 Baseline retention

Keep all 60 baseline IDs, names and protections.

Recorded Windows result:

```text
59 PASS / 0 FAIL / 1 SKIP
```

Only this SKIP is accepted:

```text
SKIP  R13d  a pre-placed backup leaf symlink is never written through  (cannot create file symlink (Windows without Developer Mode))
```

R17 retains:

```text
PASS  R17  wildcard user exceptions are held back unless provably disjoint
```

Embedded C1 execution prints no sub-assertion records.

Final one-line JSON envelope remains:

```typescript
{
  env: {
    platform: string;
    release: string;
    node: string;
    git: string;
  };
  summary: { passed: 59; failed: 0; skipped: 1 };
  resultsFile: string;
}
```

Platform is `win32`; other environment values describe the host. The results path is absolute
and retained by `--keep`. Records, totals and retained evidence must agree.

If file-symlink privilege becomes available, 60/0/0 with R13d passing is valid.
No other skip is accepted.

Full `accept-rc1.mjs` remains incomplete at C1 landing. Later numbered cases cannot be bypassed
or represented by C1 sub-assertions.

## 7. Rollback and dependents

C1 performs no database migration or installed-project policy migration.

If a later component fails, repair or revert that component first. Retain C1 unless its own
contract or implementation is defective.

To withdraw C1:

1. Revert dependent implementation changes in reverse landing order.
2. Revert C1 implementation and tests, including registry and R17 integration.
3. Keep C11a, its immutable snapshots and its harness.
4. Verify baseline 59/0/1 on the recorded host and C11a 8/0/0.

Use reviewed commit reverts. Do not delete files manually or overwrite unrelated changes.

Dependents:

- C2: entry identities and validation.
- C3: adaptation, effective entries, rendering and asset installation.
- C4: path validation and shared matching.
- C5: review matching and realpath-relative artifact checks.
- C9: matching through preceding integrations.
- C10: policy validation and invalid-manifest-key failure reporting.
- C11b: corpus, component assertions and integrated acceptance.

C3 records the PQ2 `blocks.mjs --file` follow-up.

If later components migrated an installed project, use their journaled rollback to restore
policy, controls, helpers and manifest together before restoring older readers.
Never remove a module while installed consumers still import it.

## 8. Plan questions

None. PQ1 and replacement PQ2 are applied as recorded.

## Simplification disposition

| Action | Sections and row IDs |
| --- | --- |
| Removed Unicode case-fold, NFC/NFD and simple-fold modes | Section 3.3; C09-C10 and C12-C18 removed. |
| Removed component-removal aliases and their transitions | Sections 3.3/3.7; B10-B11 and B13-B16 removed. |
| Removed original-spelling union during deduplication | Sections 3.3/3.4/4.7; Unicode union regression removed. |
| Kept lowercase behavior and code-point wildcards | Sections 3.2/3.3; C01-C04, C06, C08 and W01-W30. |
| Kept Windows aliases, alone and combined | Sections 3.3/4.6; B01-B09 and E17-E19. |
| Re-derived accepted residuals as false | Section 4.6; C05, C07, C11 and B12. |
| Re-derived overlap using lowercase and Windows forms | Sections 3.7/4.11; unrelated Unicode stays disjoint. |
| Removed overlap cases requiring deleted alias forms | Section 4.11; long-s, simple-fold and component-removal cases. |
| Kept all non-alias contracts and acceptance totals | Sections 1-4 and 6-7; schema, R75, R78, R97 and C11a unchanged. |
| Documented accepted residuals and C18-style behavior | Section 5.1; no additional matching mechanisms. |

## Addendum at freeze: plan-critique round 4, C1-P4-1 and C1-P4-2 (NON-BLOCKING)

Added by the orchestrator when freezing; both make a statement exact and change no row or scope.

- C1-P4-1. Overlap is defined form against form: `policyEntriesMayOverlap` and the
  permission-overlap helper return true if and only if some alias form of the left glob and some
  alias form of the right glob (each form being the lowercase spelling or one of its per-component
  Windows aliases from section 3.3) have a nonempty language intersection, or if either operand
  uses syntax the model does not cover. An overlap that exists only through a path-side alias (rule
  `x`, exception `*q`, joined by the path `x.:q`) is reported disjoint; the managed deny is then
  appended, which keeps the secret protected and only cancels that user exception.
- C1-P4-2. The "Unicode-disjoint overlap example" in section 4.12 is the direct pair: left
  `{"anchor":"any","glob":"**/.env"}`, right `{"anchor":"root","glob":"docs/r\u00e9sum\u00e9.md"}`,
  expected `false`.
