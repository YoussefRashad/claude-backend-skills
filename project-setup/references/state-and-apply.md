# State, ownership, apply, and concurrency

## Ownership model

| Ownership | Applies to | The skill may | On drift |
|---|---|---|---|
| `full` | Files the skill created entirely: `.ai/agents/*`, wrappers | Regenerate when unchanged | Ask before replacing user edits |
| `blocks` | Markdown and `#`-comment files with managed blocks: `AGENTS.md`, `CLAUDE.md`, `.gitignore` | Rewrite inside its blocks only | Per-block: unchanged / edited-by-user / removed-by-user |
| `keys` | `.claude/settings.json` | Append missing managed entries to `permissions.deny/allow` | Never removes or reorders; reports conflicts |
| `merged` | Living docs, `.env.example`, pre-existing files without markers | Targeted, reviewed edits | Not tracked |

A matching hash means "the skill's region is as the skill left it". It is **not** permission to rewrite the whole
file: user content outside managed regions is never regenerated.

Markers (`blocks.mjs`): no nesting, unique ids, every begin has an end, markers inside fenced code are ignored.
Broken markers stop the run for that file.

JSON has no comments, so `.claude/settings.json` uses key-level ownership; the managed entry list is stored in the
manifest. TOML wrappers are `full` files; the skill never merges into user TOML.

## Hashing

Hashes are SHA-256 of normalised text (BOM stripped, CRLF→LF, trailing newline), so `core.autocrlf` on Windows does
not register as a user edit. Apply preconditions use raw bytes. Written files keep the existing line-ending style.

## Run lifecycle

```
lock acquire → apply init → drafts (agent + blocks.mjs + merge/env scripts)
→ apply prepare: plan with, per file, the target's raw pre-hash and the draft's SHA-256;
                 rejects outside-block / user-edited changes unless --approve-user-content names that file;
                 prints planSha256
→ user reviews the diffs and approves planSha256
→ apply commit --approved-plan <planSha256>:
     1. plan hash, every draft hash, every target hash, manifest hash re-verified → exit 4, nothing written, on any change
     2. per file: backup to vault → journal entry {preRawSha, expectedWriteSha, state "backed-up"}
        → atomic write (temp + rename, retries on Windows locks) → state "applied" + writtenRawSha
     3. manifest written last → journal committed
→ validate → runtime verification → report → lock release → (user confirms) → cleanup
```

All run directories (`.ai`, `.ai/.run/<id>`, `drafts`, `vault`, `vault/backup` and every directory below it,
`.ai/.setup.lock`, `.ai/.canary/<id>`) are resolved segment by segment **from the repository root, at the moment
each read or write happens** (never from a previously resolved subdirectory, which could itself have been replaced):
every existing segment must be a real directory (symlinks and Windows junctions are rejected), the final real path
must be inside the repository, a linked leaf file is refused, and writes go through an exclusive temp file + rename
(never through an existing link). `commit` also checks the whole run chain before its first write (exit 2).

`ownership.json` and `managed-keys.json` (run dir) are validated at prepare and embedded in the plan with their
hashes, so the approval covers manifest ownership too; commit uses only the embedded copy and aborts (exit 4) if
either file appeared, disappeared, or changed after prepare. Run ids are `[A-Za-z0-9][A-Za-z0-9._-]{3,63}` with no `..`.

The vault accepts only env templates (`.env.example`, `.env.sample`, `.env.template`) produced by `env-keys.mjs`.
Agent drafts can never target a secret-pattern path.

Failure handling:

- Exit 5 (mid-apply failure): the journal lists what was applied. `apply.mjs rollback` undoes only this run's own
  writes, in reverse order:
  - on-disk hash = what the run wrote → restore the backup (or delete a file the run created);
  - on-disk hash = the pre-run hash → nothing to undo (the write never landed);
  - anything else → someone changed it afterwards: **skip**, keep the backup, report it.
  Any skip makes the rollback incomplete: exit 6, `status.rollbackComplete: false`, and `cleanup` refuses until the
  user resolves those files and passes `--confirm-manual-resolution`.
- Crash or interruption: `lock.mjs status` shows the owner; `apply.mjs status --run-id <id>` shows the run `state`.
  - `partial` or `rollback-incomplete`: recover that run first (`rollback`, repeated after the user resolves any
    skipped files, or `cleanup --confirm-manual-resolution`), then retry with a NEW run id.
  - `aborted-before-write` (journal created, nothing written): nothing to undo; retry with a NEW run id.
  - `fresh` (interrupted before the journal was created, e.g. exit 2 or 4): the only case where `prepare` may be run
    again with the same run id.
  Never re-run `prepare`/`commit` on a run that has a journal; the lifecycle guard refuses it (exit 7).
- The check-then-write window cannot be closed completely on a shared working tree. Lock + immediate re-check +
  short apply narrows it; the real isolation for parallel work is separate git worktrees.

## Run lifecycle (one write per run)

| State (`apply.mjs status`) | prepare / commit in this run | prepare / commit in another run |
|---|---|---|
| `fresh` (no journal; includes exit 2/4 aborts) | allowed | allowed |
| `committed` | refused (exit 7) | allowed |
| `partial` (exit 5) | refused | refused until resolved |
| `rollback-incomplete` (exit 6) | refused | refused until resolved |
| `rollback-in-progress` (rollback interrupted, or a file/journal write failed mid-way) | refused | refused until resolved |
| `rolled-back` | refused | allowed |
| `aborted-before-write` | refused | allowed |

Rollback records `inProgress` in the journal **before its first change**, checkpoints after every restored file, and
clears the flag only when it can record the final result. A crash, a failed rename/write/delete, or a failed journal
write therefore leaves the run `rollback-in-progress` (never `committed`); running rollback again resumes, and the
hash rules guarantee already-restored files are left alone. `cleanup` deletes a run's backups only when the run is
`fresh`, `committed`, `rolled-back`, or `aborted-before-write`; anything else needs `--confirm-manual-resolution`.
Known limitation: if the process is killed inside an atomic write, a `<file>.ps-tmp-*` temp file can remain next to
the target; it is never renamed into place and can be deleted.

Resolution for `partial`: `rollback`. For `rollback-incomplete`: resolve the skipped files with the user and run
`rollback` again (it re-evaluates only unresolved entries), or discard the run with
`cleanup --confirm-manual-resolution`. The journal is never rewritten from scratch; a retry always uses a new run id,
so every earlier run keeps its entries and backups until it is resolved or explicitly cleaned up.

## Backup integrity

Rollback restores a backup only if its bytes hash to the `preRawSha` recorded in the journal. Otherwise the target
and the backup are left exactly as found, the entry is reported as skipped, and the rollback is incomplete.

## Locks

`.ai/.setup.lock/` is created with an atomic `mkdir`. Agents run the script as a short-lived child, so no PID
or TTL can prove the owner is dead. A held lock is shown to the user (run id, host, agent, heartbeat). Breaking it
requires the user's approval and `--confirm-run-id` matching the current owner, then `apply.mjs status` on the old
run to detect a partial apply. If `owner.json` is missing, unreadable, or malformed, ownership is unknown: `release`
and `apply` refuse (fail closed), and only `break --confirm-unknown-owner`, after the user confirms no run is active,
removes the lock.

## Concurrency between tools

- One setup/update run per checkout at a time (the lock). Claude and Codex may each run the skill, not
  simultaneously in the same checkout.
- Parallel work belongs in separate worktrees; merge through git.
- `docs-sync` edits living docs directly (they are `merged`) and must not touch wrappers, settings, or managed
  blocks except where the code change makes a block wrong. Developers and implementation agents may update the
  docs related to their change under the same rules.

## Zero diff

With unchanged inputs and skill version, a re-run produces no file changes and no manifest change.
`sourceCommit` changes only when outputs change. Nothing time-based is written into managed content.
