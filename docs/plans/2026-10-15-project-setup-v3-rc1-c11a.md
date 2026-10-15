<!--
FROZEN 2026-10-15 on branch feat/project-setup-v3-rc1. Never edit this file; changes go through the
maintainer. Component plan C11a (lands first) under the frozen architecture plan
docs/plans/2026-10-15-project-setup-v3-rc1.md, which takes precedence. Drafted by the plan lane
(Codex, 2 revisions); plan-critique (Claude) round 2 found no BLOCKING gap.
-->

# C11a: Shipped v2 baselines and test infrastructure

Target: `docs/plans/2026-10-15-project-setup-v3-rc1-c11a.md`.

Revision: 2.
Repository: `D:/ContactRepos/claude-backend-skills`.
Branch: `feat/project-setup-v3-rc1`.
Inspected HEAD: `c9554037dec7e7b14958090ba80457da1deb29e6`.

Authority, in precedence order:

1. `docs/plans/2026-10-15-project-setup-v3-rc1.md`, called the architecture plan below.
2. `docs/design/project-setup-v3.md`, frozen part A and decisions Q1-Q7 and DQ1.
3. Repository authoring and development rules.

Paths below are relative to `project-setup/`, unless identified as repository-relative.
Existing line ranges refer to commit `c955403`.

## 1. Scope and out-of-scope

Implement architecture-plan section 2, C11a, lines 655-707:

- Ship seven immutable v2 source snapshots.
- Verify their exhaustive mapping and raw byte parity against the trusted local v2 tag.
- Construct genuine v2-installed fixtures through the tagged scripts.
- Record fixture provenance and add live fixture kind `v2`.
- Supply the assertion registry, component runner and strict rc.1 acceptance gate.

Implement section 4's component-record, case-inventory, totals and retained-evidence contracts.
Keep all 60 existing cases. Component assertions must not masquerade as complete numbered cases.

C11a has no preceding component dependency and lands before C1.

| Later work | Owner |
| --- | --- |
| Policy grammar and legacy adaptation | C1 |
| Transactions, approvals and manifest schema 3 | C2 |
| Runtime policy migration using the shipped snapshot | C3 |
| Git commands, review artifacts and hooks | C4-C6 |
| Managed allow retirement and reconciliation | C7 |
| Agent/wrapper migration using shipped snapshots | C8 |
| Template handling and doctor/validation changes | C9-C10 |
| Complete numbered cases and installed-payload acceptance | C11b |
| Release script, version bump, notes and archive acceptance | C11b |

C11a supplies starting installations for R77, R78, R85 and R86. Their controlled edits, migration
decisions and rollback assertions remain with their section-4 owners.

Runtime migration without distribution history belongs to C8/R77 and C11b/S07. C11a supplies its
offline data and does not implement that migration.

The freeze addendum assigns release tests to C11b: use an isolated temporary repository and
synthetic tag; separate archive builds by more than two seconds or use the specified tree-input
control. The real release tag and publication remain outside `accept-rc1`.

C11a does not change production scripts, source templates, installer inclusion rules, VERSION,
release notes, the historical v2 archive, dependencies, CI or the frozen architecture plan.

## 2. Files touched and interfaces

### 2.1 Existing files

| File and original lines | Planned change |
| --- | --- |
| `tests/run-tests.mjs:3-6` | Document exact-ID selection and failure semantics. |
| `tests/run-tests.mjs:7-15` | Import registry/selector; validate CLI arguments. |
| `tests/run-tests.mjs:69-70` | Reject duplicate case registration. |
| `tests/run-tests.mjs:1182-1194` | Run C11a assertions inside existing S07. |
| `tests/run-tests.mjs:1214-1233` | Select cases, await callbacks, reject empty runs and emit totals. |
| `tests/live/make-fixture.mjs:4-13` | Document `v2` output and provenance. |
| `tests/live/make-fixture.mjs:18-36` | Import helper; validate kind and v2 preconditions. |
| `tests/live/make-fixture.mjs:279-295` | Install genuine v2 before committing the fixture base. |
| `tests/live/make-fixture.mjs:330-348` | Preserve skill copies/isolation; attach provenance. |
| `tests/live/make-fixture.mjs:370-379` | Preserve success JSON shape for `v2`. |

Do not alter other baseline case bodies. Preserve fresh/v1 behavior, oracle branches, environment
scripts and metadata.

### 2.2 New files

Runtime snapshots:

```text
data/secret-paths-v2.0.0.json
data/v2.0.0/assets/agents/reviewer.md
data/v2.0.0/assets/agents/docs-sync.md
data/v2.0.0/assets/wrappers/claude-reviewer.md
data/v2.0.0/assets/wrappers/claude-docs-sync.md
data/v2.0.0/assets/wrappers/codex-reviewer.toml
data/v2.0.0/assets/wrappers/codex-docs_sync.toml
```

Infrastructure and tests:

```text
tests/helpers/v2-baseline.mjs
tests/rc1-cases.mjs
tests/run-component-tests.mjs
tests/accept-rc1.mjs
tests/c11a.test.mjs
```

The separate `c11a.test.mjs` keeps tests-lane assertions immutable while implementation changes
the registry and runners. This is a test-file boundary within C11a, permitted by the
architecture plan's section-2 introduction.

The existing installer includes `data` at `install/install.mjs:29`. No installer edit is needed.

### 2.3 Shared API conventions

All new modules are import-safe. Imports perform no filesystem writes, subprocess execution,
test execution or CLI dispatch. Avoid eager reads across circular imports.

Every exported `main` is asynchronous and returns:

```typescript
type MainResult = {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
};
```

`main` does not write process streams or call `process.exit`. Direct CLI dispatch writes its
returned strings and sets `process.exitCode`.

All emitted record lines end in LF. Dynamic paths are absolute native paths. Tests compare
paths using the supplied test context rather than hardcoded temporary-directory names.

Common shapes:

```typescript
type Issue = { code: string; id?: string };
type Summary = { passed: number; failed: number; skipped: number };
type ProcessError = { code: string | null; message: string };

type ProcessResult<T> = {
  status: number | null;
  signal: string | null;
  error: ProcessError | null;
  timedOut: boolean;
  truncated: boolean;
  stdout: T;
  stderr: T;
};

type TestContext = {
  repository: string;
  skillRoot: string;
  tmp: string;
  env: Record<string, string>;
};
```

Every field shown is required except fields explicitly marked optional. Successful subprocesses
have `status: 0`, `signal: null`, `error: null`, and both boolean flags false.

### 2.4 Baseline helper exports

`tests/helpers/v2-baseline.mjs` exports:

```text
V2_IDENTITY
V2_SNAPSHOTS
V2_INSTALL_TARGETS
validateSnapshotMapping(mappings)
isVersionedSnapshotPath(relativePath)
verifyV2Tag({ repository, execute? })
verifyV2Snapshots({ repository, skillRoot, execute? })
materializeV2Source({ repository, destination, execute? })
createV2InstalledFixture({
  repository, root, workDir, projectName, managedAllows?, execute?
})
```

Constants are deeply frozen:

- `V2_IDENTITY`: `{ tag, commit, tree, skillVersion }`, with section-3 values.
- `V2_SNAPSHOTS`: ordered `{ snapshot, source }` entries from section 3.4.
- `V2_INSTALL_TARGETS`: ordered `{ target, ownership }` entries from section 3.6.
- `ownership` is exactly `full`, `blocks`, `keys` or `merged`.

`validateSnapshotMapping(mappings)` returns `undefined` on success. It throws
`V2_SNAPSHOT_MAPPING_INVALID` for an empty/non-array mapping, malformed entries, duplicate
sources, duplicate destinations, absolute paths, backslashes, empty segments, `.` or `..`
segments, or destinations outside `data/`. It does not mutate its argument.

`isVersionedSnapshotPath` implements section 3.4's exact predicate.

Successful results:

```typescript
verifyV2Tag(...) => {
  tag: string;
  commit: string;
  tree: string;
  skillVersion: "2.0.0";
}

verifyV2Snapshots(...) => {
  identity: typeof V2_IDENTITY;
  files: Array<{
    snapshot: string;
    source: string;
    bytes: number;
    sha256: string;
  }>;
}

materializeV2Source(...) => {
  identity: typeof V2_IDENTITY;
  skillRoot: string;
}

createV2InstalledFixture(...) => {
  root: string;
  provenance: V2Provenance;
  installed: Array<{ target: string; ownership: string }>;
}
```

`installed` lists exactly the 23 section-3.6 targets, in table order, after checking their actual
manifest ownership. It excludes the manifest itself and transient run files.

The optional executor has this exact signature:

```typescript
execute(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    shell: false;
    windowsHide: true;
    encoding: null;
    timeout: 60000;
    maxBuffer: 16777216;
  }
): ProcessResult<Buffer> | Promise<ProcessResult<Buffer>>
```

Use `process.execPath` for Node children and `git` for Git. Executor exceptions are converted to
a failed process result; they must not escape as unclassified fixture success.

Helper failures throw `Error` objects with:

```text
code: one of the V2_* codes specified below
phase: string or null
message: the code, optionally followed by a path or phase; never file contents
```

For script failures, `phase` is one of:

```text
lock-acquire init blocks merge prepare commit validate lock-release
```

Neither helper options nor CLIs accept an alternate tag or identity pins.

### 2.5 Registry and selector exports

`tests/rc1-cases.mjs` exports:

```text
BASELINE_CASE_IDS
RC1_CASE_IDS
REQUIRED_CASE_IDS
COMPONENT_ASSERTIONS
COMPONENT_IMPLEMENTATIONS
selectSuiteCases(cases, { only?, onlyId? })
runComponentAssertions(component, context, { registry? })
registerRc1Cases(register, context)
```

Shapes:

```typescript
type ExpectedAssertion = { id: string; name: string };

type AssertionOutcome = {
  failures: string[];
  skipped: string | null;
};

type AssertionImplementation = {
  id: string;
  run(context: TestContext):
    AssertionOutcome | Promise<AssertionOutcome>;
};

type Registry = {
  expected: Record<string, ExpectedAssertion[]>;
  implementations: Record<string, AssertionImplementation[]>;
};

type ComponentResult = {
  id: string;
  name: string;
  status: "PASS" | "FAIL";
  failures: string[];
};

type ComponentReport = {
  component: string;
  ok: boolean;
  errors: Issue[];
  summary: Summary;
  results: ComponentResult[];
};
```

`COMPONENT_ASSERTIONS` contains expected descriptors. `COMPONENT_IMPLEMENTATIONS` contains
executable descriptors imported from the test modules. Expected inventories are not derived
from implementations.

Default registry:

```text
{
  expected: COMPONENT_ASSERTIONS,
  implementations: COMPONENT_IMPLEMENTATIONS
}
```

C1-C10 extend both maps with their own descriptors. A component must have a nonempty expected
inventory and exactly one implementation for every expected ID.

`runComponentAssertions` returns `Promise<ComponentReport>`. Section 3.1 defines validation and
execution behavior.

`selectSuiteCases` is pure. Each input case is `{ id, name, fn }`, with nonempty single-line ID
and name and callable `fn`. It returns selected original case objects in registration order.

Options default to `{ only: null, onlyId: null }`:

- Both null: select all.
- `only`: preserve substring matching against `${id} ${name}`.
- `onlyId`: compare `id === onlyId`; names do not affect selection.
- Both non-null or either supplied as an empty/non-string value: throw `SUITE_USAGE`.
- Duplicate IDs: throw `SUITE_DUPLICATE_ID`.
- Malformed case: throw `SUITE_CASE_INVALID`.
- Empty selection: throw `SUITE_EMPTY_SELECTION`.

`registerRc1Cases(register, context)` uses:

```text
register(id: string, name: string, fn: () => void | Promise<void>): void
```

At C11a landing it registers no complete rc.1 cases. C11b adds complete composition later.

### 2.6 Component runner interface

`tests/run-component-tests.mjs` exports:

```typescript
main(
  argv: string[],
  dependencies?: {
    registry?: Registry;
    context?: TestContext;
    writeEvidence?: (
      report: ComponentReport,
      context: TestContext
    ) => string | Promise<string>;
  }
): Promise<MainResult>
```

The default context uses an isolated temporary directory and fixture environment. Supplying
`context` prevents default context creation.

The evidence writer returns an absolute path to the written JSON report. The default writes
`<context.tmp>/component-results.json` using exclusive creation. A throw, rejected promise,
empty path or non-absolute return is `evidence-write`.

Tests supplying context, registry and writer can run `main` without filesystem mutation.

CLI:

```text
node project-setup/tests/run-component-tests.mjs --component <component>
```

Exactly one `--component` is required. Unknown options, duplicate options and missing values
produce:

```text
COMPONENT  FAIL  usage
```

Exit 1; stderr empty; do not invoke the registry or evidence writer.

### 2.7 Gate interface

`tests/accept-rc1.mjs` exports:

```typescript
validateSuiteEvidence(input: {
  only: string | null;
  status: number | null;
  signal: string | null;
  error: ProcessError | null;
  timedOut: boolean;
  truncated: boolean;
  stdout: string;
  stderr: string;
  report:
    | { text: string }
    | { error: ProcessError }
    | null;
}): {
  ok: boolean;
  errors: Issue[];
  summary: Summary | null;
  resultsFile: string | null;
};
```

This function is pure. It never spawns or reads files. `report.text` contains the complete
retained `results.json` text, not an already parsed object.

`main` has this exact interface:

```typescript
main(
  argv: string[],
  dependencies?: {
    execute?: GateExecutor;
    readReport?: (
      absolutePath: string
    ) => ReportInput | Promise<ReportInput>;
    writeEvidence?: (
      input: {
        stdout: string;
        stderr: string;
        resultsFile: string | null;
      }
    ) => string | Promise<string>;
  }
): Promise<MainResult>
```

`ReportInput` is the report union above.

```typescript
type GateExecutor = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    shell: false;
    windowsHide: true;
    encoding: "utf8";
    timeout: 1800000;
    maxBuffer: 33554432;
  }
) => ProcessResult<string> | Promise<ProcessResult<string>>;
```

The gate invokes exactly one suite child:

```text
executable: process.execPath
cwd: distribution repository root
args, full:    [<absolute run-tests.mjs>, "--keep"]
args, focused: [<absolute run-tests.mjs>, "--keep", "--only-id", <id>]
```

`env` is a string-valued copy of the gate environment; the suite creates its existing isolated
fixture environment.

If stdout contains one structurally valid summary envelope with an absolute results path,
`main` calls `readReport` once with that path. Otherwise it supplies `report: null`.

The default reader returns `{ text }`, or `{ error: { code, message } }` on read failure.

`writeEvidence` is called once for every attempted child execution, including failures. The
default creates a fresh gate-evidence directory and writes the exact captured strings to
`suite.stdout.txt` and `suite.stderr.txt`. It returns that directory's absolute path.

A writer throw, rejection or invalid return rejects acceptance with `evidence-write`.
Tests inject all three dependencies to avoid subprocesses and filesystem writes.

CLI:

```text
node project-setup/tests/accept-rc1.mjs
node project-setup/tests/accept-rc1.mjs --only <id>
```

Only one exact required ID is accepted. Invalid arguments return exit 1 and:

```text
ACCEPT-RC1  FAIL  usage
```

No dependencies are invoked for usage errors.

No CLI exposes injected executors, reports, registries, alternate runners or relaxed totals.

## 3. Behavior specification

### 3.1 Component assertions and records

The exact C11a expected inventory is:

| ID | Name |
| --- | --- |
| `V2/C11a/tag-identity` | `trusted v2 tag identity` |
| `V2/C11a/snapshot-inventory` | `exhaustive v2 snapshot mapping` |
| `V2/C11a/snapshot-bytes` | `raw tagged snapshot byte parity` |
| `V2/C11a/installed-fixture` | `tagged v2 installation and provenance` |
| `V2/C11a/fixture-failures` | `v2 fixture failures are fatal` |
| `V2/C11a/live-v2` | `live v2 fixture and existing kinds` |
| `V2/C11a/component-records` | `strict component result contract` |
| `V2/C11a/strict-gate` | `strict rc1 acceptance contract` |

Registry validation stops at the first structural error, in this order:

1. Missing selected expected inventory: `component-unknown`.
2. Malformed descriptors, IDs, names or non-callable implementation: `inventory-invalid`.
3. Empty expected inventory: `empty-inventory`.
4. Duplicate expected ID: `duplicate-expected`.
5. Duplicate implementation ID: `duplicate-group`.
6. Unexpected implementation ID: `unexpected-group`.
7. Missing implementation ID: `missing-group`.

Within a category, use expected order where available, otherwise first implementation occurrence.
ID-specific errors include `id`.

Structural failure returns:

```text
ok: false
errors: [the first issue]
results: []
summary: { passed: 0, failed: 0, skipped: 0 }
```

Do not execute any group after structural validation fails.

Otherwise execute each implementation once in expected order:

- Empty `failures` and `skipped: null`: PASS.
- Nonempty failures: FAIL.
- Non-null `skipped`: append `skip-forbidden: <reason>` and FAIL.
- Both failures and skip: retain failures, append the skip diagnostic, and FAIL.
- Exception: FAIL with `threw: <message>`.
- Malformed outcome: FAIL with `invalid-outcome`.

Component summaries count PASS/FAIL results and always have `skipped: 0`.
`ok` requires a nonempty inventory, no structural errors and no failed results.

The writer receives the complete report before output is finalized. On writer failure, return
exit 1 with only:

```text
COMPONENT  FAIL  evidence-write
```

Otherwise render:

```text
PASS  <sub-assertion-id>  <name>
FAIL  <sub-assertion-id>  <name>
```

Each failure diagnostic is prefixed with eight spaces and `- `. Structural errors render:

```text
COMPONENT  FAIL  <code>
COMPONENT  FAIL  <code>  <id>
```

Then render totals and evidence:

```text
<P> PASS / <F> FAIL / 0 SKIP
RESULTS  <absolute-report-path>
```

Exit 0 only when `report.ok` is true. Stderr is empty.

Never emit a complete numbered case record for partial coverage. Synthetic gate transcripts are
test inputs and must not be forwarded to component stdout.

### 3.2 Baseline runner and case records

The diagnostic runner accepts:

```text
node project-setup/tests/run-tests.mjs [--keep]
node project-setup/tests/run-tests.mjs [--keep] --only <substring>
node project-setup/tests/run-tests.mjs [--keep] --only-id <id>
```

The two selectors are mutually exclusive. Invalid arguments and empty selections exit 1.
Keep substring behavior for diagnostics; the gate always uses `--only-id`.

Preserve record forms:

```text
PASS  <id>  <name>
FAIL  <id>  <name>
SKIP  <id>  <name>  (<reason>)
```

Separators are exactly two ASCII spaces. IDs and names are nonempty and single-line.
Failures take precedence over skips; a failing result must have `skipped: null`.

After records and indented diagnostics, print:

```text
<P> PASS / <F> FAIL / <S> SKIP
```

The final nonempty stdout line is the existing one-line JSON envelope, with these exact keys:

```typescript
{
  env: {
    platform: string;
    release: string;
    node: string;
    git: string;
  };
  summary: Summary;
  resultsFile: string;
}
```

All environment values are nonempty strings. `resultsFile` is absolute.

The retained file contains:

```typescript
{
  env: {
    platform: string;
    release: string;
    node: string;
    git: string;
  };
  summary: Summary;
  results: Array<{
    id: string;
    name: string;
    failures: string[];
    skipped: string | null;
  }>;
}
```

The suite exits 1 for a failed case, malformed registration, empty selection or evidence-write
failure. `--keep` preserves evidence even after successful runs.

### 3.3 Strict gate

The 60 baseline IDs are:

```text
R01 R02 R03a R03b R04a R04b R05 R06 R06b R07 R08 R09 R10 R11 R12
R13a R13b R13c R13d R14a R14b R15 R16 R17 R18 R19 R20 R21 R22
R23a R23b R24 R25 R26 R27a R27b R27c R27d R28 R29 R30 R31 R32
R33 R34 R35 R36 R37 R38 R39 R40
S01 S02 S03 S04 S05 S06 S07 S08 S09
```

The additional 38 numbered IDs are:

```text
R41 R42 R43 R44 R45 R46 R47 R48 R49 R50 R51 R52 R53 R54
R65 R66 R67 R68 R72 R73 R74 R75 R76 R77 R78 R79 R80 R81 R82
R84 R85 R86 R90 R91 R92 R93 R97 R100
```

The additional named IDs are:

```text
A5-templates
N8-doctor
```

The frozen arrays preserve this order. `REQUIRED_CASE_IDS` contains exactly 100 unique IDs.

For every required passing case, require an anchored stdout record:

```text
^PASS  <escaped-id>  
```

A summary, stderr line, substring, ANSI-prefixed line or sub-assertion is not that record.

Full acceptance requires exactly 100 unique records and one of:

```text
99 PASS / 0 FAIL / 1 SKIP
100 PASS / 0 FAIL / 0 SKIP
```

The only allowed skip is R13d, with `env.platform === "win32"` and this exact reason:

```text
cannot create file symlink (Windows without Developer Mode)
```

Require the reason in stdout and retained evidence. No other case may skip. Pending host
measurements must not be registered as additional skipped cases.

Focused acceptance requires exactly one PASS for the requested ID and:

```text
1 PASS / 0 FAIL / 0 SKIP
```

Even focused R13d must PASS. Focused acceptance does not replace full acceptance.

For deterministic tests, `validateSuiteEvidence` returns zero or one issue. It stops at the first
violation in the following order:

1. Invalid `only`: `usage`.
2. `error !== null`, `timedOut`, `truncated` or `signal !== null`: `suite-execution`.
3. `status !== 0`, including null: `suite-exit`.
4. Malformed result-keyword line: `malformed-record`.
5. Missing, malformed, repeated or incomplete total/envelope: `summary-invalid`.
6. Same ID with different statuses: `contradictory-record`.
7. Repeated ID with the same status: `duplicate-record`.
8. Unexpected record ID: `unexpected-record`.
9. Missing required ID: `missing-record`.
10. FAIL record: `failed-record`.
11. Forbidden SKIP: `forbidden-skip`.
12. Full-run R13d SKIP with wrong platform/reason: `invalid-skip`.
13. Totals disagree or do not meet the required full/focused totals: `totals-mismatch`.
14. `report === null` or report has `error`: `evidence-missing`.
15. Invalid report JSON/shape or disagreement with stdout: `evidence-mismatch`.

For ID errors, use required-inventory order; unexpected IDs use lexical order.

A malformed result-keyword line begins with `PASS`, `FAIL` or `SKIP` followed by whitespace or
end-of-line, but does not satisfy its complete record form. Non-record diagnostics do not count
as results. CRLF line framing is accepted; raw captured streams remain unchanged.

Require exactly one total line and one JSON envelope, with the envelope last. Summary counts
must be nonnegative integers. Compare every report ID, name, status, failure/skip state, order,
environment field and summary against stdout. A report result cannot both fail and skip.

`summary` and `resultsFile` in the returned validation object contain structurally valid parsed
envelope values when available; otherwise they are null. `ok` is true exactly when `errors`
is empty.

The gate forwards captured stdout without alteration, adding a separating LF only if needed
before its own records. Its returned stderr is the captured stderr.

Successful full verdict:

```text
ACCEPT-RC1  PASS  full
RESULTS  <suite-results-path>
EVIDENCE  <gate-evidence-directory>
```

Successful focused verdict substitutes the ID for `full`.

Failure verdict:

```text
ACCEPT-RC1  FAIL  <code>
ACCEPT-RC1  FAIL  <code>  <id>
```

Use the applicable single form. Append RESULTS if a parsed results path exists, and EVIDENCE
if retention succeeded. Never print an acceptance PASS after evidence retention fails.

### 3.4 Tagged identity and snapshots

Pin:

```text
tag:          project-setup-v2.0.0
commit:       13566046529bf51fb8fb6d0c83f79c03e1b90eaa
project tree: 4d032fb8fd7023aef233e94f59c0827f24a7a91a
skillVersion: 2.0.0
```

Verify local tag existence, peel it to a commit, and resolve that commit's `project-setup`
subtree. Require both pins before reading content or executing tagged scripts.

Use `show-ref --verify --quiet refs/tags/project-setup-v2.0.0` to distinguish absence:
status 1 means `V2_TAG_MISSING`; other execution failures are not absence.

Use the resolved pinned commit/tree for subsequent reads. Never fetch, substitute HEAD,
trust VERSION alone, or skip missing baseline coverage.

Mapping:

| Snapshot | Tagged source |
| --- | --- |
| `data/secret-paths-v2.0.0.json` | `data/secret-paths.json` |
| `data/v2.0.0/assets/agents/reviewer.md` | `assets/agents/reviewer.md` |
| `data/v2.0.0/assets/agents/docs-sync.md` | `assets/agents/docs-sync.md` |
| `data/v2.0.0/assets/wrappers/claude-reviewer.md` | `assets/wrappers/claude-reviewer.md` |
| `data/v2.0.0/assets/wrappers/claude-docs-sync.md` | `assets/wrappers/claude-docs-sync.md` |
| `data/v2.0.0/assets/wrappers/codex-reviewer.toml` | `assets/wrappers/codex-reviewer.toml` |
| `data/v2.0.0/assets/wrappers/codex-docs_sync.toml` | `assets/wrappers/codex-docs_sync.toml` |

For enumeration, paths are POSIX paths relative to the skill root. A versioned snapshot
candidate is a path beginning with `data/` whose remainder either:

- Starts with `v2.0.0/`, compared case-insensitively; or
- Matches this case-insensitive expression:

```javascript
/(^|[\/._-])v?\d+\.\d+\.\d+([\/._-]|$)/i
```

Every candidate file must be mapped. Every mapped destination must exist. Thus an unmapped
future version also requires an explicit mapping rather than escaping enumeration.

Positive and negative predicate controls:

```text
data/v2.0.0/assets/agents/reviewer.md   true
data/extra-v2.0.0.json                 true
data/archive/2.0.0/source.json         true
data/extra-v3.0.0.json                 true
data/secret-paths.json                false
assets/agents/reviewer.md             false
```

Validate the mapping before Git/content reads. Enumerate without following links. Mapped leaves
must be regular files, with real contained ancestors.

Read Git blobs into Buffers and write snapshot Buffers unchanged. Compare Buffer equality for
every mapping, including the policy snapshot outside `data/v2.0.0/`.

LF/CRLF conversion, BOM insertion, final-newline changes, whitespace edits and rendered
placeholder substitution all fail parity. Do not use normalized manifest hashes for this check.

### 3.5 Git isolation and source materialization

All helper Git reads set `GIT_NO_REPLACE_OBJECTS=1`, after removing inherited `GIT_*` variables.
Tagged script children receive the same setting, so their internal Git calls inherit it.

Use isolated HOME/USERPROFILE, global/system Git configuration, empty hook/template directories,
disabled signing, disabled prompts and `core.autocrlf=false`.

For direct helper Git calls, pass:

```text
-c safe.directory=<canonical absolute repository root>
```

as two argument-array entries before the subcommand. Never use `safe.directory=*`.

The generated isolated global configuration also lists the exact synthetic project root for
Git calls made inside tagged scripts. Do not edit real global configuration. Repository access
that still fails is `V2_GIT_FAILED`; do not retry with broader trust or different access.

List the entire tagged subtree using NUL-delimited `ls-tree -r -z`. Before writing any source
file, require every leaf to have:

```text
type: blob
mode: 100644 or 100755
```

Reject mode 120000 symlinks even though their Git object type is blob. Reject gitlinks,
submodules, tree entries in the recursive leaf result and other nonregular modes/types with
`V2_SOURCE_ENTRY_INVALID`.

Reject absolute, traversal or unsafe materialization paths with `V2_SOURCE_PATH_INVALID`.

Read source contents by listed blob OID with replacement objects disabled. Materialize into an
unused destination using raw bytes. Do not checkout or alter the distribution repository.

### 3.6 Genuine v2-installed fixture

Preconditions:

- `root` is an existing synthetic Git repository with an initial commit.
- All section-3.6 managed targets are absent, except `.gitignore`, which may already exist.
- No `.ai/manifest.json` exists.
- `workDir` is unused, outside `root`, and not an alias resolving into `root`.
- `projectName` is a nonempty single-line string.
- `managedAllows`, if supplied, is an array of unique strings.

Invalid options produce `V2_OPTIONS_INVALID`. Existing managed content produces
`V2_FIXTURE_NOT_FRESH`. An occupied work directory produces `V2_DESTINATION_EXISTS`.
Equal/contained work directories produce `V2_WORKDIR_INSIDE_PROJECT`, before writes.

Defaults:

```json
[
  "Bash(npm test)",
  "Bash(node .ai/tools/git-safe.mjs *)"
]
```

Both defaults must appear as genuinely managed allows in the tagged manifest. Explicit `[]`
creates a fixture without managed allows.

Materialize tagged source at `<workDir>/source/project-setup`. Use run ID
`v2-baseline-0001`. Stage drafts using tagged assets and these deterministic substitutions:

| Placeholder | Value |
| --- | --- |
| `PROJECT_NAME` | Supplied `projectName` |
| `ONE_LINE_PURPOSE` | `Synthetic v2 fixture.` |
| `STACK_WITH_VERSIONS` | `Node.js` |
| `PACKAGE_MANAGER` | `npm` |
| `RUNTIME_VERSION` | `unknown` |
| `DB_CHANGE_POLICY` | `unknown` |
| `VERIFIED_COMMANDS` | `- No project commands verified.` |
| `NESTED_INSTRUCTION_INDEX` | `- none` |

For each context/docs file below, stage `# <filename without extension>\n`.
For the decisions README use `# Decisions\n`; for TODO use `# TODO\n`.

Invoke tagged scripts in this exact phase order:

```text
lock-acquire:
  lock.mjs acquire --run-id v2-baseline-0001

init:
  apply.mjs init --run-id v2-baseline-0001

blocks:
  blocks.mjs upsert --file .gitignore --id gitignore
    --content <tagged assets/templates/gitignore-block.txt>
    --run-id v2-baseline-0001

merge:
  merge-claude-settings.mjs --run-id v2-baseline-0001
    --allow-file <run-directory>/fixture-allows.json

prepare:
  apply.mjs prepare --run-id v2-baseline-0001
    --mode fresh --agents claude,codex

commit:
  apply.mjs commit --run-id v2-baseline-0001 --approved-plan <prepare hash>

validate:
  validate.mjs

lock-release:
  lock.mjs release --run-id v2-baseline-0001
```

The allow-file always exists, including for an empty array. It is created inside the run
directory, outside drafts, and contains only the requested synthetic allow strings.

Require status 0 and valid successful JSON at every phase. Prepare must return a lowercase
64-character `planSha256`; commit must report `committed: true`; validate must report `ok: true`;
release must report `released: true`.

Do not invoke later phases after failure. Do not automatically release, roll back or clean up a
failed fixture; preserve its diagnostic state. A lock-release failure is a failed fixture even
if commit and validation succeeded.

The helper never authors or repairs `.ai/manifest.json`. Only tagged commit writes it.

The installed target contract below is derived from tagged `apply.mjs:433-461`,
`merge-claude-settings.mjs:119-121`, the tagged templates and tagged `blocks.mjs`.

| Installed target | Ownership | Expected detail |
| --- | --- | --- |
| `AGENTS.md` | blocks | Six IDs listed below |
| `CLAUDE.md` | blocks | `claude` |
| `.gitignore` | blocks | `gitignore` |
| `.ai/security-paths.json` | full | Tagged policy |
| `.ai/tools/git-safe.mjs` | full | Tagged Git tool |
| `.ai/agents/reviewer.md` | full | Tagged source with project name rendered |
| `.ai/agents/docs-sync.md` | full | Tagged source with project name rendered |
| `.claude/agents/reviewer.md` | full | Tagged Claude wrapper |
| `.claude/agents/docs-sync.md` | full | Tagged Claude wrapper |
| `.codex/agents/reviewer.toml` | full | Tagged Codex wrapper |
| `.codex/agents/docs_sync.toml` | full | Tagged Codex wrapper |
| `.claude/settings.json` | keys | Exact managed-key shape below |
| `.ai/context/project-tree.md` | merged | Synthetic living document |
| `.ai/context/critical-modules.md` | merged | Synthetic living document |
| `.ai/context/code-patterns.md` | merged | Synthetic living document |
| `.ai/context/error-contract.md` | merged | Synthetic living document |
| `.ai/context/configuration.md` | merged | Synthetic living document |
| `.ai/context/glossary.md` | merged | Synthetic living document |
| `.ai/decisions/README.md` | merged | Synthetic decisions index |
| `docs/api-conventions.md` | merged | Synthetic living document |
| `docs/database.md` | merged | Synthetic living document |
| `docs/observability.md` | merged | Synthetic living document |
| `TODO.md` | merged | Synthetic TODO |

AGENTS block IDs, in source order:

```text
overview critical-rules commands navigation local-instructions agents
```

Manifest entry shapes are exact:

```text
full:   { ownership: "full", sha256: <normalized content hash> }
blocks: { ownership: "blocks", blocks: { <id>: <normalized inner-content hash> } }
merged: { ownership: "merged" }
keys:   {
          ownership: "keys",
          managed: {
            "permissions.deny": <tagged deny array>,
            "permissions.allow": <requested managedAllows>,
            heldBack: []
          }
        }
```

No other keys are added to those entries.

Tagged normalization removes one leading BOM, changes CRLF and lone CR to LF, and appends LF
only if absent. Hash the resulting UTF-8 bytes with SHA256. A block's inner content excludes its
marker lines.

The deny array consists of `Read(<glob>)` for these 19 globs, in order:

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

Append these 23 command-deny strings, in order:

```text
Bash(rm -rf *)
Bash(git reset --hard*)
Bash(git clean *)
Bash(git push --force*)
Bash(git push -f*)
Bash(git checkout -- *)
Bash(git restore *)
Bash(curl * | bash*)
Bash(curl * | sh*)
Bash(wget * | bash*)
Bash(npm publish*)
Bash(terraform apply*)
Bash(terraform destroy*)
Bash(kubectl delete *)
Bash(helm uninstall *)
PowerShell(Remove-Item * -Recurse*)
PowerShell(git reset --hard*)
PowerShell(git clean *)
PowerShell(git push --force*)
PowerShell(git push -f*)
PowerShell(npm publish*)
PowerShell(Invoke-Expression *)
PowerShell(iex *)
```

Settings bytes must parse to the tagged merger's `$schema` and permissions object. Its allow and
deny arrays must equal the managed arrays above. No hook is installed by this fixture.

The manifest has schema 2, skill `project-setup`, skillVersion `2.0.0`, mode `fresh`,
agents `["claude","codex"]`, sourceCommit equal to the initial project HEAD, and exactly the
23 `files` entries above. The manifest is not an entry in its own `files` map.

The helper also leaves tagged run state and `.ai/.run/.gitignore`; those are transient and not
managed targets. The successful lock-release phase removes the setup lock.

It does not install `.codex/config.toml`, personal settings, a project customization file or
environment templates. The fixture host's application files are not manifest entries.

Provenance:

```typescript
type V2Provenance = {
  tag: "project-setup-v2.0.0";
  commit: "13566046529bf51fb8fb6d0c83f79c03e1b90eaa";
  tree: "4d032fb8fd7023aef233e94f59c0827f24a7a91a";
  skillVersion: "2.0.0";
  runId: "v2-baseline-0001";
  projectName: string;
  managedAllows: string[];
  planSha256: string;
  manifestRawSha256: string;
  commands: Array<{
    phase: string;
    script: string;
    args: string[];
    status: 0;
  }>;
};
```

`script` is the tagged relative name, such as `scripts/apply.mjs`. The eight command records
follow phase order. Their args exclude the script path. The manifest digest covers exact bytes
before any consumer edits. The caller writes provenance outside the fixture repository.

### 3.7 Live fixture contract

Extend:

```text
node project-setup/tests/live/make-fixture.mjs
  --out <directory>
  [--kind fresh|v1|both|v2]
  [--meta <directory>]
```

Default `both` remains exactly fresh and v1.

For `v2`:

- Require unused output and metadata destinations.
- Verify the local tag before creating the output project.
- Create `fixture-v2`, run the helper, then commit and tag its base as `fx-base`.
- Use project name `fixture-wallet-api`.
- Preserve Git isolation and generated environment scripts.
- Copy the current skill under test to both existing repo-level skill locations.
- Record provenance at `fixtures.v2.provenance` in external metadata.
- Keep root `skillVersion` as the current skill-under-test version.
- Omit `reviewRanges`; do not create fresh-oracle branches.

Success exits 0 and preserves the existing JSON fields:

```text
ok, skillVersion, fixtures, meta, note, next
```

`fixtures` contains exactly the absolute `fixture-v2` path.

A helper failure exits 1, emits no success JSON, and writes this stderr line:

```text
v2-baseline: <error-code>
```

There is no automatic fetch, skip or current-source fallback.

## 4. Tests and registration

The tests lane owns `tests/c11a.test.mjs`. It exports:

```text
C11A_IMPLEMENTATIONS: AssertionImplementation[]
```

The array contains the eight IDs from section 3.1. Each `run(context)` executes the assigned
cases and returns `{ failures, skipped: null }`. Importing the test module runs no tests.

Implementation wiring imports this array into `COMPONENT_IMPLEMENTATIONS.C11a`.
The implementer must not modify the tests-lane assertion bodies or expected data.

Existing S07 invokes `runComponentAssertions("C11a", context)` and fails unless `ok` is true.
It does not print nested component records or register additional top-level cases.

No infrastructure test recursively launches the complete baseline suite. Gate orchestration
tests use injected dependencies. Positive v2 fixture tests use the real local tag; negative
tests use temporary copies and specified executor responses.

### 4.1 Snapshot and identity tests

| Input | Exact expectation |
| --- | --- |
| Trusted local tag | All four identity fields equal the pins. |
| Tag existence command returns status 1 | `V2_TAG_MISSING`; no content read or script run. |
| Different peeled commit | `V2_TAG_COMMIT_MISMATCH`. |
| Expected commit, different subtree | `V2_TAG_TREE_MISMATCH`. |
| Malformed object response or ordinary Git failure | `V2_GIT_FAILED`. |
| Seven valid mapping entries | `validateSnapshotMapping` returns undefined. |
| Duplicate source or destination | `V2_SNAPSHOT_MAPPING_INVALID`. |
| Empty, malformed, absolute or traversing mapping | `V2_SNAPSHOT_MAPPING_INVALID`. |
| Six predicate controls in section 3.4 | Exact listed booleans. |
| Seven untouched snapshot files | Seven successful raw Buffer comparisons. |
| Remove each mapped file, parameterized | `V2_SNAPSHOT_MISSING`. |
| Add an unmapped candidate inside or outside `data/v2.0.0/` | `V2_SNAPSHOT_UNMAPPED`. |
| Add unversioned `data/control.json` | Not classified as a versioned snapshot. |
| Mapped leaf is a directory or link | `V2_SNAPSHOT_NOT_FILE`; content not read. |
| Alter one byte in each snapshot | `V2_SNAPSHOT_BYTES_DIFFER`. |
| LF changed to CRLF | `V2_SNAPSHOT_BYTES_DIFFER`. |
| BOM added or final newline changed | `V2_SNAPSHOT_BYTES_DIFFER`. |
| Agent placeholder rendered in snapshot | `V2_SNAPSHOT_BYTES_DIFFER`. |

For every direct Git call, a recording executor asserts:

```text
env.GIT_NO_REPLACE_OBJECTS === "1"
args starts with ["-c", "safe.directory=" + canonicalRepositoryRoot]
shell === false
```

Also inspect the environment supplied to tagged Node children: replacement objects are disabled
and inherited Git overrides are absent.

Use a control executor that supplies altered content when replacement disabling is absent.
Without the disabling field, the control must differ from the expected tagged bytes; the helper
must supply the field on every read and obtain the original bytes.

An ownership-related Git refusal remains `V2_GIT_FAILED`; assert that there is no retry with
wildcard safe.directory, inherited global config or broader permissions.

### 4.2 Materialization and fixture tests

| Input | Exact expectation |
| --- | --- |
| Tagged leaf `100644 blob` or `100755 blob` | Materialized bytes equal blob bytes. |
| Tagged leaf `120000 blob` | `V2_SOURCE_ENTRY_INVALID`; no source files written. |
| Tagged leaf `160000 commit` | `V2_SOURCE_ENTRY_INVALID`; no source files written. |
| Other non-blob/type/mode | `V2_SOURCE_ENTRY_INVALID`; no source files written. |
| Absolute/traversing source path | `V2_SOURCE_PATH_INVALID`. |
| Occupied materialization/work destination | `V2_DESTINATION_EXISTS`; sentinel unchanged. |
| `workDir === root` or beneath root | `V2_WORKDIR_INSIDE_PROJECT`; no writes. |
| Work-directory alias resolves inside root | `V2_WORKDIR_INSIDE_PROJECT`; no writes. |
| Existing manifest or managed target | `V2_FIXTURE_NOT_FRESH`; bytes unchanged. |
| Invalid project name or allow array | `V2_OPTIONS_INVALID`. |
| Fresh synthetic project, default allows | Exact 23-entry ownership contract; both allows managed. |
| Explicit empty allow array | Both settings and managed allow arrays are empty. |
| Installed canonical agents | Project name rendered; source snapshots unchanged. |
| Observe manifest around commit | Absent before tagged commit; created by tagged commit. |
| Inspect full result | Exact `root`, `installed` and provenance shapes. |
| Hostile inherited Git config/hooks/signing | Isolated installation succeeds. |
| Work paths containing spaces and `\u00e9` | Same successful result and ownership. |
| Required script exits nonzero, phases through validate | `V2_SCRIPT_FAILED`; no later phase. |
| Prepare exits 0 but lacks valid hash | `V2_PREPARE_INVALID`; commit not invoked. |
| Commit exits 0 but does not report committed true | `V2_COMMIT_INVALID`. |
| Validate exits 0 but reports ok false | `V2_VALIDATE_FAILED`. |
| Release exits nonzero or reports released false | `V2_LOCK_RELEASE_FAILED`; no fixture result. |
| Any helper child has timedOut true | `V2_PROCESS_TIMEOUT`. |
| Any helper child has truncated true | `V2_PROCESS_TRUNCATED`. |
| Helper spawn error or signal, outside timeout | `V2_PROCESS_FAILED`. |

Process-failure precedence is timeout, truncation, spawn/signal failure, then phase-specific
status/JSON failure. Test timeout and truncation on both a Git read and a tagged script.
For combined flags, assert that timeout wins.

For a valid transport but nonzero validation status, expect `V2_SCRIPT_FAILED` with phase
`validate`; `V2_VALIDATE_FAILED` specifically covers a successful process reporting failed
validation. Release failures use `V2_LOCK_RELEASE_FAILED` unless a higher-priority transport
failure applies.

All failures throw; none return `{ skipped: ... }`. Assert that no later command runs and that
no command includes fetch or a network remote.

### 4.3 Live fixture tests

| Input | Expectation |
| --- | --- |
| New `--kind v2` destination | Exit 0; one fixture; exact provenance and both current skill copies. |
| Missing tag | Exit 1; no success stdout; `v2-baseline: V2_TAG_MISSING\n` on stderr. |
| Moved tag | Exit 1; named identity error; no current-source fallback. |
| Occupied output or metadata destination | Exit 1; sentinel unchanged. |
| Metadata destination beneath output | Exit 1; no success result. |
| Unknown kind | Exit 1; no success result. |
| Default invocation | Exactly fresh and v1. |
| Explicit fresh, v1 and both | Existing branches, oracle, metadata and isolation preserved. |

### 4.4 Component-run tests

Build controlled registries using section-2 shapes. Supply a context and a writer returning
`<context.tmp>/component-results.json`. Capture the writer's report argument.

| Input | Exact expectation |
| --- | --- |
| Eight passing groups | Eight exact records; summary 8/0/0; exit 0. |
| Unknown component | `component-unknown`; no groups run. |
| Empty expected array | `empty-inventory`; no groups run. |
| Malformed descriptor/callback | `inventory-invalid`. |
| Duplicate expected ID | `duplicate-expected` with ID. |
| Duplicate implementation | `duplicate-group` with ID. |
| Extra implementation | `unexpected-group` with ID. |
| Omitted implementation | `missing-group` with ID. |
| Group throws `Error("boom")` | FAIL; failures equals `["threw: boom"]`. |
| Group returns skip `"unavailable"` | FAIL; `["skip-forbidden: unavailable"]`. |
| Group returns failure `"bad"` and same skip | FAIL; both strings in that order. |
| Group returns undefined | FAIL; `["invalid-outcome"]`. |
| Writer throws or rejects | Exit 1; only `COMPONENT  FAIL  evidence-write\n`. |
| Writer returns relative/empty path | Same evidence-write failure. |

For structural tests, require a retained report with empty results, zero totals and exactly the
specified issue. Verify that the writer receives the complete same report.

### 4.5 Selection and registration tests

Use `selectSuiteCases` with independently authored cases.

| Input | Exact expectation |
| --- | --- |
| R86 and R91, where R91's name contains `R86 `; `onlyId: "R86"` | R86 only. |
| Same cases; `only: "R86 "` | Both cases, preserving diagnostic behavior. |
| Duplicate IDs | `SUITE_DUPLICATE_ID`. |
| Empty selection | `SUITE_EMPTY_SELECTION`. |
| Both selectors | `SUITE_USAGE`. |
| Missing/empty/non-string selector value | `SUITE_USAGE`. |
| Malformed case | `SUITE_CASE_INVALID`. |

At CLI level, repeat the selector conflict, missing-value and unknown-option cases and require
exit 1 without successful records.

### 4.6 Strict-gate tests

Build transcripts from an independently written literal copy of all 100 IDs. Each successful
record is:

```text
PASS  <id>  case <id>
```

Use this synthetic environment:

```json
{"platform":"win32","release":"fixture","node":"fixture","git":"fixture"}
```

Use an absolute fixture results path. Generate a matching total line, final envelope and report
with empty failures and null skipped fields.

All-pass validation returns:

```text
ok: true
errors: []
summary: { passed: 100, failed: 0, skipped: 0 }
resultsFile: the supplied absolute path
```

The valid Windows R13d-skip transcript returns the same shape with totals 99/0/1.

For each mutation, all earlier validation stages remain valid unless the test explicitly targets
them. Expect exactly one error object, using section 3.3's precedence:

| Input or mutation | Exact error |
| --- | --- |
| Remove each required ID, parameterized over all 100 | `missing-record` with that ID |
| Repeat R86 PASS | `duplicate-record`, R86 |
| Add R87 | `unexpected-record`, R87 |
| R86 has PASS and FAIL | `contradictory-record`, R86 |
| Replace R86 PASS with FAIL | `failed-record`, R86 |
| Skip each additional rc.1 case, parameterized over all 40 | `forbidden-skip`, that ID |
| Skip baseline R22 | `forbidden-skip`, R22 |
| R13d skip has wrong reason/platform | `invalid-skip`, R13d |
| `PASS R86 case R86` | `malformed-record` |
| Replace R86 with `R86/C2/metadata` | `unexpected-record`, `R86/C2/metadata` |
| R86 record exists only on stderr | `missing-record`, R86 |
| R86 line has an ANSI prefix | `missing-record`, R86 |
| Zero records, otherwise valid 0/0/0 summary/report | `missing-record`, R01 |
| Correct records, incorrect numeric totals | `totals-mismatch` |
| Missing/repeated/malformed total or envelope | `summary-invalid` |
| Negative, fractional or string summary count | `summary-invalid` |
| status 1 or null, no execution flags | `suite-exit` |
| error, signal, timeout or truncation | `suite-execution` |
| Null report or report error | `evidence-missing` |
| Malformed report JSON or wrong field shape | `evidence-mismatch` |
| Report ID/name/order/status/reason/env differs | `evidence-mismatch` |
| Valid focused R86 | No errors; totals 1/0/0 |
| Focused R86 with no records and valid empty summary | `missing-record`, R86 |
| Focused R86 includes R860 | `unexpected-record`, R860 |
| Focused R86 includes another required case | `unexpected-record`, extra ID |
| Focused R13d skips | `forbidden-skip`, R13d |

Return `Issue` objects with exactly `code` and, where shown, `id`.

Test the gate `main` with injected executor, reader and writer:

- Record the exact full/focused child argument arrays from section 2.7.
- Assert focused execution uses `--only-id`, never the substring selector.
- Reader receives the exact envelope path once.
- Writer receives unchanged stdout/stderr and the parsed results path.
- Success appends the exact verdict, RESULTS and EVIDENCE records.
- Nonzero exit, timeout, executor rejection and malformed evidence produce exit 1.
- Writer failure produces `evidence-write` and no acceptance PASS.
- Usage failures invoke no dependency.
- Synthetic transcript records never leak from these tests into component stdout.

### 4.7 Baseline retention

Run all 60 baseline cases. Expected on the recorded Windows privilege configuration:

```text
59 PASS / 0 FAIL / 1 SKIP
```

Only R13d may skip. With file-symlink privilege:

```text
60 PASS / 0 FAIL / 0 SKIP
```

Keep particular coverage for:

- R22 and R23a/R23b: live fixtures, oracle and hostile-environment isolation.
- Installer regressions R05/R06/R06b/R11/R14/R25/R28 and S07.
- S01-S03: fresh setup, no-op rerun and line endings.
- R13 variants: containment and symlink protections.

Do not remove or weaken baseline assertions to accommodate the harness.

## 5. Edge cases and failure modes

Architecture-plan section 5, C11, maps as follows:

| Frozen edge case | C11a coverage or later owner |
| --- | --- |
| Missing/moved baseline tag | Tag, fixture-failure and live-v2 tests. |
| Every snapshot matches tagged bytes | Inventory and byte tests for all seven files. |
| Runtime migration without tag | C8/R77 and C11b/S07 consume C11a data. |
| Missing tests/skips cannot satisfy acceptance | Component and strict-gate negative tests. |
| R91 junction coverage despite missing symlink privilege | Gate rejects R91 SKIP; C5/C11b own execution. |
| Helpers/data in both installed copies | C11b/S07; existing inclusion retained here. |
| V2 validator rejects schema 3 | C11b integration uses tagged source supplied here. |
| Installer/archive/backup hashes remain distinct | C11a names raw hashes; release checks stay C11b. |
| Archive input is tag/commit | C11b and freeze addendum. |
| No identity/hash in in-tree notes | C11b. |
| External notes preserve source/tree | C11b. |

Additional C11a cases cover replacement refs, safe.directory isolation, nonregular tagged
entries, mapping duplicates, versioned-file enumeration, exact-ID selection, work-directory
containment, release failure, subprocess timeout/truncation and evidence-write failure.

Negative tests mutate temporary copies or controlled executor responses. They never move the
real baseline tag, edit shipped snapshots in place or fetch missing objects.

## 6. Runnable acceptance for C11a alone

Run from the repository root in the authorized writable tests lane:

```powershell
node project-setup/tests/run-component-tests.mjs --component C11a
```

Require exit 0 and these exact lines:

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
```

Require one subsequent RESULTS line and a readable matching report. Its absolute temporary path
is dynamic.

Then:

```powershell
node project-setup/tests/run-tests.mjs --keep
```

Require all 60 baseline records and:

```text
59 PASS / 0 FAIL / 1 SKIP
```

The sole skip has ID R13d, its existing name, and the exact privilege reason from section 3.3.
Where it runs, require its PASS record and:

```text
60 PASS / 0 FAIL / 0 SKIP
```

Require matching final JSON and retained evidence.

Using unused destinations:

```powershell
node project-setup/tests/live/make-fixture.mjs --kind v2 --out C:/Temp/ps-rc1-v2
```

Require exit 0 and these parsed JSON fields:

```json
{
  "ok": true,
  "skillVersion": "2.0.0",
  "fixtures": ["C:\\Temp\\ps-rc1-v2\\fixture-v2"],
  "meta": "C:\\Temp\\ps-rc1-v2.meta\\fixture-meta.json"
}
```

The existing `note` and `next` fields remain present. VERSION remains 2.0.0 at C11a landing.
Require external provenance, the 23-entry manifest contract and both managed default allows.

Finally:

```powershell
npm run check
```

Require exit 0. This is supplemental; it does not format or test the excluded release tree.

A full `accept-rc1` must not pass at C11a landing. With only the 60 baseline cases registered,
it rejects missing rc.1 coverage. Synthetic tests prove the eventual 100-case contract without
claiming those cases are implemented.

## 7. Rollback and dependents

C11a introduces no database or installed-project migration.

If a later component fails, repair or revert that component first. Keep C11a unless its own
baseline or harness is defective.

To withdraw C11a:

1. Revert dependent component commits in reverse landing order.
2. Revert C11a implementation and test commits.
3. Restore the two existing test files.
4. Remove only C11a's newly tracked files through the revert.
5. Rerun the original 60-case baseline suite.

Do not reset shared history, delete unrelated work or alter the historical tag/archive.

C1 and later components depend on the harness. C3 consumes the policy snapshot; C8 consumes
agent/wrapper snapshots; R77/R78/R85/R86 consume genuine installations; C11b consumes the gate
and completes integration.

If downstream projects were already migrated, architecture-plan section 6 governs recovery:
roll back project state using rc.1 tooling before reverting the installed skill. Reverting
distribution source does not roll back an installed project.

## 8. Plan questions

None.

Read-only evidence for this revision:

- HEAD remains `c9554037dec7e7b14958090ba80457da1deb29e6`.
- The quoted tag lookup succeeded and verified both pinned identities.
- Tagged apply, merger, templates, renderer, block hashing and validator sources were inspected.
- No fixture generation, test execution, installation or file mutation was performed.
- No MCP server, connector, app or network service was used.
- No `.env*` file or secret content was read.

## Revision disposition

| Item | Disposition |
| --- | --- |
| B1.1 | FIXED: sections 2.5-2.6 and 3.1 define registry, writer, context and main-result shapes. |
| B1.2 | FIXED: section 2.7 defines the gate executor, call arguments and process result. |
| B1.3 | FIXED: sections 2.3, 2.7 and 3.3 define complete evidence input and error precedence. |
| B1.4 | FIXED: section 2.4 exports `validateSnapshotMapping`; section 4.1 tests duplicates. |
| B1.5 | FIXED: section 2.5 separates expected descriptors from executable implementations. |
| B1.6 | FIXED: section 3.6 specifies all 23 targets and tagged-v2 manifest ownership shapes. |
| N1 | FIXED: section 3.4 defines the exact predicate and positive/negative controls. |
| N2 | FIXED: sections 3.5-3.6 and 4.2 define entry, containment and process failure codes. |
| N3 | FIXED: sections 2.5, 2.7, 3.2 and 4.5 add and test exact-ID selection. |
| N4 | FIXED: sections 3.5 and 4.1 disable replacement objects and scope safe.directory exactly. |
| N5 | FIXED: section 3.6 adds the documented Git-safe allow to defaults and ownership checks. |

Plan questions: none.
## Addendum at freeze: plan-critique round 2, N-a and N-b (NON-BLOCKING)

Added by the orchestrator when freezing; both make an expected value exact and change no scope.

- N-a. The v2-installed fixture's manifest `sourceCommit` is the abbreviated id that tagged
  `apply.mjs` records: the trimmed output of `git rev-parse --short HEAD` in the synthetic project,
  run under the same isolated git config, so the abbreviation length matches. Tests compare
  against that value, never against the full 40-character id.
- N-b. Every `safe.directory` value is the absolute path in forward-slash form, as Git for Windows
  matches it (for example `D:/ContactRepos/claude-backend-skills`), never a backslash path. The
  section 4.1 recording-executor assertion uses that exact string. A wrong form would go unnoticed
  on a checkout owned by the current user and fail only on one owned by another account.
