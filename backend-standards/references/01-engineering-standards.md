# 01 — Engineering Standards

> Portable backend engineering standards. Nothing here is specific to one service.
> Anything naming a concrete class, package or URL scheme belongs in
> `.ai/standards/03-project-architecture.md`, not here.
>
> **MUST / SHOULD / MAY carry their RFC 2119 meanings.** See `.ai/standards/00-ai-agent-instructions.md`.
> **Read `00` before applying anything here to an existing codebase.**

---

## 1. Architecture and module boundaries

- A module **SHOULD** represent one domain concept.
- Controllers **SHOULD** handle HTTP only: parse, delegate, return. No business logic.
- Services **SHOULD** hold business logic and **SHOULD NOT** shape HTTP responses.
- Repositories **SHOULD** encapsulate database queries. A service **MAY** inject a repository
  directly for simple CRUD.
- Cross-module calls **SHOULD** go through an injected service, never by reaching into another
  module's repository or entity internals.
- A project **SHOULD** pick one repository pattern and use it consistently. Where a project
  already has several, follow the one used by the module you are editing, and record the
  canonical choice in `.ai/standards/03-project-architecture.md`.

### Code quality

- A method **SHOULD** do one thing, and **SHOULD** be named for what it does
  (`calculateInstallment`, not `process` or `handle`).
- Method length and nesting depth are **heuristics, not thresholds**. Long or deeply nested
  code is a signal to look, not a rule to satisfy. **SHOULD NOT** extract a method solely to
  satisfy a line count.
- Early returns **SHOULD** be preferred over nested conditionals.
- Logic appearing in three or more places **SHOULD** be extracted. Twice is not yet a
  pattern; extracting too early couples unrelated callers.

### Dependency injection

- Anything holding state, configuration, or a dependency on another service **SHOULD** be an
  injectable provider constructed by the DI container.
- Business logic **SHOULD NOT** live in a static class.
- Pure stateless functions with no dependencies — money normalization, masking, date
  formatting — **MAY** be exported as module-level functions. This is an explicit exception:
  they are not "business logic" in the sense above.
- Cross-cutting infrastructure (an instrumented HTTP client, an entity audit base) **MAY** be
  expressed as a base class. Domain behaviour **SHOULD** use composition instead.

---

## 2. Naming

### Files and classes

| Item                                  | Convention                                 | Example                  |
| ------------------------------------- | ------------------------------------------ | ------------------------ |
| Files                                 | `kebab-case`                               | `user-wallet.service.ts` |
| Classes                               | `PascalCase`                               | `UserWalletService`      |
| Controllers / Services / Repositories | `*Controller` / `*Service` / `*Repository` | `PaymentService`         |
| DTOs                                  | `Create*Dto`, `Update*Dto`, `*QueryDto`    | `CreatePaymentDto`       |
| Entities                              | Singular `PascalCase`                      | `Payment`                |
| Enums                                 | `PascalCase` + `Enum`                      | `PaymentStatusEnum`      |

### Database

| Item               | Convention              | Example                          |
| ------------------ | ----------------------- | -------------------------------- |
| Tables             | `snake_case`            | `user_wallet`                    |
| Columns            | `snake_case`            | `national_id`, `created_at`      |
| Foreign keys       | `<referenced_table>_id` | `user_id`                        |
| Indexes            | `IDX_<table>_<columns>` | `IDX_user_wallet_phone`          |
| Unique constraints | `UQ_<table>_<columns>`  | `UQ_transaction_order_operation` |
| PG enum types      | `snake_case`            | `payment_status`                 |

- **No house convention is imposed on singular vs plural.** A new table **SHOULD** match the
  naming already used by the module or schema area it belongs to. **MUST NOT** rename an
  existing table to satisfy a convention.
- A table name **SHOULD** be declared explicitly rather than inferred from the class name —
  an implicit name silently changes when the class is renamed.
- _Practical note:_ `user`, `order`, `group` and `session` are reserved or semi-reserved in
  PostgreSQL — `SELECT user` returns the current role, not your table. Where a singular name
  collides, use the plural or a prefixed form (`users`, `payment_order`).

---

## 3. API design

### Paths and verbs

- Resources **SHOULD** be plural and `kebab-case`: `/user-wallets`.
- Ownership **SHOULD** be expressed by nesting: `/users/:userId/wallets`.
- Actions **SHOULD** be sub-resources: `/payments/:id/refund`.

| Action         | Method           |
| -------------- | ---------------- |
| List / Get one | `GET`            |
| Create         | `POST` → **201** |
| Full update    | `PUT`            |
| Partial update | `PATCH`          |
| Delete         | `DELETE`         |

- A read **SHOULD** use `GET` with query parameters. Using `POST` for a read is a deviation
  and **SHOULD** be recorded in `.ai/standards/known-deviations.md` with its reason (request signing over a
  body is a legitimate one).
- RPC verbs in paths (`/create`, `/list`) **SHOULD NOT** be used.

### Versioning

- An API **MUST** have a versioning strategy, declared in `.ai/standards/03-project-architecture.md`.
- The strategy **MAY** be a URL prefix (`/api/v1/...`) or a client-version header. Both are
  acceptable; mixing them within one service is not.
- **MUST NOT** introduce a second versioning mechanism into a service that already has one.

### Pagination

- Every list endpoint **MUST** be paginated. **MUST NOT** return an unbounded result set.
- The request contract **SHOULD** be `page`, `limit`, `sortBy`, `sortOrder`.
- `limit` **MUST** carry an explicit maximum and a minimum of 1. A default without a maximum
  is not pagination; it is a denial-of-service parameter.
- The response **SHOULD** be:

```json
{ "items": [], "meta": { "page": 1, "limit": 20, "totalItems": 150, "totalPages": 8 } }
```

- A project **SHOULD** define exactly one pagination request contract and one response shape.

### Sorting — allowlist required

A SQL identifier **cannot** be parameterized. `ORDER BY $1` does not work. Therefore any
`sortBy` parameter is, by construction, string interpolation into SQL.

- A sort or filter parameter naming a **column** **MUST** be validated against a server-side
  allowlist — an enum or an explicit map.
- The allowlist **MUST** be enforced at the point of query construction. DTO validation is
  defence in depth, **not** the control. A repository that accepts a string and interpolates
  it is one careless caller away from an injection, and nothing in lint or tests will catch
  it.

```ts
// MUST: the query layer owns the allowlist
const SORTABLE = { createdAt: 'p.created_at', amount: 'p.amount' } as const;

function applySort(qb, sortBy: string, order: 'ASC' | 'DESC') {
  const column = SORTABLE[sortBy];
  if (!column) throw new BadRequestException('Invalid sort field');
  qb.orderBy(column, order);
}
```

---

## 4. Response and error contract

### Success

A **new** service **SHOULD** define one success envelope and apply it to every endpoint.
The recommended shape:

```json
{
  "message": "Payment created successfully",
  "statusCode": 201,
  "data": {},
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

- `statusCode` in the body **SHOULD** equal the HTTP status line.
- The envelope earns its place through `message`: a translated, user-displayable string that
  the client can surface without mapping status codes itself.

**Within one service the choice is all-or-nothing.**

- A service that uses the envelope **MUST** use it on every endpoint.
- A service that does not **MUST NOT** introduce it on individual endpoints. A service where
  some endpoints are wrapped and some are not is worse than either consistent choice — it
  pushes per-endpoint branching into every client, and the list of exceptions is forgotten
  within months.
- **MUST NOT** retrofit an envelope onto a service whose clients already parse a different
  shape. An existing service keeps its current shapes; see §13.

### Errors

- Services **SHOULD** throw framework exceptions (`BadRequestException`, `UnauthorizedException`,
  `ForbiddenException`, `NotFoundException`, `ConflictException`). **SHOULD NOT** hand-construct
  an error response.
- Every thrown exception **SHOULD** carry a message meaningful enough to act on. A generic
  "something went wrong" is not acceptable in a thrown error.
- Validation failures **MUST** return **400**. (Not 422 — pick one, and this is the one.)
- An error response **MUST** use an HTTP status code that reflects the outcome.
  **MUST NOT** return `200 OK` with an error payload in new code.

> **Existing-code exception.** Some services return HTTP 200 with an error body for historical
> reasons. Where that is the case it **MUST** be recorded in `.ai/standards/known-deviations.md`, and you
> **MUST NOT** change it without a client version gate. §13 overrides this section for live
> endpoints.

- Error responses **MUST NOT** leak upstream detail: no provider URLs, no echoed request
  bodies, no raw driver errors, no stack traces.
- Unexpected errors **MUST** be logged with full context and returned as a generic 500.

### Catch blocks

- **MUST NOT** use an empty catch block.
- Every catch **MUST** do one of: rethrow, log with full context, or handle with a defined
  recovery path. Swallowing an error on a money path is a defect, not a style choice.

---

## 5. Validation

- Every endpoint **MUST** have a DTO with validation decorators.
- `@Body()`, `@Query()` and `@Param()` **MUST NOT** be typed `any` or as an inline object
  literal — both bypass validation entirely. This **SHOULD** be enforced by a lint rule.
- Validation **SHOULD** run globally (`whitelist: true`, `transform: true`), not per-route.
- `forbidNonWhitelisted` **SHOULD** be **off**. Unknown fields are stripped silently rather
  than rejected.

  > **Decision — Youssef Farag, 2026-09-20.** Client compatibility is worth more than early
  > detection: a newer app version sending an extra field keeps working against an older
  > backend, and a field removed from a DTO does not start returning 400 to clients still
  > sending it.
  >
  > **The cost, stated so it is not rediscovered later:** a field the client sends and the
  > backend never reads fails silently. Contract drift between mobile and backend stays
  > invisible until someone asks why a value is not being saved. Where an endpoint's contract
  > matters enough to fail loudly, turn it on **for that route** rather than globally.

- Any array accepted from a client **MUST** carry a maximum size.
- Body size limits **MUST** be set explicitly. **MUST NOT** rely on a framework default.
- File uploads **MUST** bound file size, field count and part count — not size alone.

---

## 6. Money

Money defects are silent, and they are the expensive kind. This section is one place on
purpose; splitting storage rules from DTO rules is how the two drift apart.

- Money **MUST** be stored as `decimal` / `numeric` with explicit precision and scale.
  **MUST NOT** use `float`, `double precision` or `real`.
- Postgres returns `numeric` to the driver as a **string**, to preserve precision. Therefore
  an entity property mapped to `numeric` **MUST** be either:
  - typed `string`, or
  - declared with an explicit column `transformer`.

  **MUST NOT** type it `number` with no transformer. That declaration is a lie: the property
  holds a string whenever the row came from the database and a number when constructed in
  memory, and every call site is then correct only by accident.

- All money arithmetic **MUST** go through a single shared utility. **MUST NOT** hand-roll
  amount math at a call site.
- **Accumulation is the risk, not the single operation.** JavaScript numbers are binary
  floats. Rounding to the currency's scale after one multiplication is fine; adding fifty
  amounts and rounding once at the end is not — the drift compounds before you round it away.

  > **Decision — Youssef Farag, 2026-09-20.** No decimal library. The rules below achieve
  > correctness with zero dependencies.

- The shared utility **MUST** normalize to the currency's scale after **every** operation,
  not only at the end. This bounds the error to one rounding step instead of letting it
  accumulate across them.
- Summing a list of amounts **MUST** either normalize at each accumulation step, or be
  performed in **integer minor units** and converted back once at the end. Integer arithmetic
  is exact and needs no dependency.
- A decimal library **MAY** be introduced later if a flow needs more than the currency's
  scale, or accumulates over thousands of rows. That is a dependency decision and **MUST** be
  raised with the owner rather than added.
- Amounts in different minor units **MUST NOT** be mixed. Where one provider expects minor
  units and another expects major units, the unit **SHOULD** be part of the function or
  variable name, and conversion **MUST** happen at exactly one boundary.
- **MUST NOT** compare amounts with `===` without normalizing first.
- A client-supplied amount **MUST NOT** be trusted. It **MUST** be recomputed or verified
  against the system of record before it is used to move money.

---

## 7. Database

### Schema management

- `synchronize` and `migrationsRun` **MUST** be `false` in every environment.
- Schema changes **MUST** be applied through a reviewed, out-of-band process.
- **An entity change and its DDL are two separate deliverables.** Shipping the entity alone
  produces runtime column-not-found errors; shipping the DDL alone leaves the code unaware.
  Your change summary **MUST** state the required DDL explicitly.
- A rolling deployment runs old and new code against the same schema simultaneously.
  Therefore entity changes **MUST** be additive and backward compatible:
  - New columns **MUST** be nullable, or have a default that does not rewrite the table.
  - A column **MUST NOT** be dropped or renamed in the change that stops using it. Deprecate,
    ship, remove later.
  - Indexes on populated tables **MUST** be created `CONCURRENTLY`.
  - A value **MUST NOT** be removed from a PG enum type in use.

### Queries

- User-supplied **values** **MUST** be passed as bound parameters. Interpolating a value into
  a SQL string is prohibited **without exception** — including inside `LIKE` / `ILIKE`
  patterns, and including values that "look numeric".
- Raw SQL **MAY** be used where the ORM cannot express the query — window functions,
  recursive CTEs, bulk upserts, reporting aggregates — provided every value is bound.
  The rule is _no interpolation_, not _no raw SQL_.
- Identifiers cannot be parameterized. A dynamic identifier **MUST** come from a server-side
  allowlist (§3).
- Queries over wide tables, or returning many rows, **SHOULD** select only required columns.
  A query **SHOULD NOT** select large `jsonb` or text columns the caller does not use.
  Full-entity hydration by primary key is acceptable.
- A query **MUST NOT** be issued once per element of an unbounded collection. Batch with
  `IN`, or use a bulk operation. Where per-row work is genuinely unavoidable (per-row
  transactional work, streaming an external cursor), the loop **MUST** be bounded and
  **SHOULD** process in chunks of a stated size.
- N+1 access **SHOULD** be avoided — use an explicit join, `relations`, or a batched second
  query keyed by `IN`.

```ts
// MUST NOT — N+1
const users = await this.userRepo.find();
for (const user of users) {
  user.wallet = await this.walletRepo.findOne({ where: { userId: user.id } });
}

// MUST — single query
const users = await this.userRepo.find({ relations: ['wallet'] });

// MUST — or two queries, batched
const users = await this.userRepo.find();
const wallets = await this.walletRepo.find({ where: { userId: In(users.map((u) => u.id)) } });
```

```ts
// MUST NOT — N writes in a loop
for (const item of items) await this.repo.save({ ...item, userId });

// MUST — one bulk write
await this.repo.save(items.map((item) => ({ ...item, userId })));
```

### Indexing

- A foreign key used in a join **SHOULD** be indexed. ORMs do not create these automatically.
- A column used in a frequent, selective predicate **SHOULD** be indexed.
- An index **SHOULD** be justified by a query plan (`EXPLAIN ANALYZE`) or a measured workload —
  **not** by the presence of the column in a `WHERE` clause. Indexing every filtered column
  costs write amplification and storage for indexes that are never chosen.
- Low-cardinality columns (booleans, small enums) **SHOULD NOT** get a standalone index.
- A composite index **SHOULD** be preferred over several single-column indexes on the same
  access path.
- Every query a new endpoint introduces **MUST** complete within the configured statement
  timeout.

### Transactions

- A multi-write local operation **MUST** be wrapped in a single transaction.
- A transaction **MUST NOT** remain open across an outbound HTTP call. Connections are
  finite and idle-in-transaction timeouts will kill it mid-flight.
- A project **SHOULD** designate one transaction mechanism as canonical.
- Where a local write and an external system must agree, use a **compensating action** — not
  a distributed transaction. The external system is authoritative; the local row is a record.

### Isolation and concurrency

- Transactions **SHOULD** use the database default isolation (`READ COMMITTED`).
- A transaction that reads a row and writes a value derived from it **MUST** either take a
  row lock (`SELECT ... FOR UPDATE`) or run at `REPEATABLE READ` or higher, and **MUST** say
  which in a comment. Default isolation does not prevent lost updates.
- Uniqueness **MUST** be enforced by a database constraint, never by a prior `SELECT`.

### Read/write splitting

- Where reads default to a replica, **a read that must observe a preceding write MUST be
  issued on the primary**, or performed inside the same transaction as the write.
- **MUST NOT** assume a replica read reflects a write that has just returned. Callback
  handlers, confirm-then-read flows and post-write verification are where this bites.

### Column types

- `jsonb` **SHOULD** be used over `json` — `json` cannot be indexed and is stored as text.
- Timestamps **SHOULD** be stored as `timestamptz`. Mixed timestamp types within a schema are
  a defect.
- An enum column **SHOULD** declare `type: 'enum'`; omitting it silently produces a varchar.

### Soft delete

- Soft delete **MAY** be used where history must be preserved. It **SHOULD** be applied
  consistently within a table's access paths.
- Raw SQL **does not** inherit the ORM's implicit "not deleted" filter. A raw query against a
  soft-deleted table **MUST** add the predicate explicitly.

---

## 8. Redis

| Use case                | Pattern                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| Cache                   | `SET key value EX ttl` — a TTL **MUST** always be set                             |
| Distributed lock        | `SET key <owner-token> NX EX ttl` + **Lua compare-and-delete** to release         |
| Counter (rate / OTP)    | `INCR` + expire on first increment only, in one Lua script                        |
| Invalidation            | Invalidate on write. **MUST NOT** rely on TTL alone for correctness-critical data |
| Multi-command atomicity | Lua script                                                                        |

### Keys

```
<app>:<module>:<entity>:<identifier>
```

- Keys **SHOULD** carry an application prefix.
- Where one Redis instance is shared across environments, keys **MUST** be namespaced per
  environment (a key prefix or a separate logical database). Two environments silently
  sharing a keyspace is a data-corruption path, not a tidiness issue.
- **MUST NOT** use `KEYS` in production. Use `SCAN`.
- A pattern-delete driven by a client-supplied prefix **MUST** be restricted to an allowlist.

### Locks — ownership and failure mode

- A lock **MUST** be released only by its owner. Release **MUST** be a Lua compare-and-delete.
  A bare `DEL` deletes whatever lock is currently held — which, after your TTL expired, is
  someone else's.
- A lock protecting a money path **MUST fail closed**: if the lock store is unavailable, the
  operation **MUST** be rejected. Skipping the lock because Redis is down removes the only
  mutual exclusion at precisely the moment the system is degraded.

```ts
// MUST — release verifies ownership
const RELEASE = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`;

const token = randomUUID();
const acquired = await redis.set(key, token, 'EX', ttl, 'NX');
if (!acquired) throw new ConflictException('Operation already in progress');
try {
  // ... critical section
} finally {
  await redis.eval(RELEASE, 1, key, token);
}
```

### Counter with TTL on first increment

```ts
const INCR_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;
const attempts = await redis.eval(INCR_WITH_TTL, 1, lockKey, ttlSeconds);
```

Setting the TTL only at an exact count, or comparing the count with `==` instead of `>=`,
leaves a key with no expiry and a lock that disengages on overshoot.

### Cache with stampede protection

```ts
async getWithCache<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
  const cached = await this.redis.get(key);
  if (cached) return JSON.parse(cached);

  const lockKey = `${key}:lock`;
  const token = randomUUID();
  const acquired = await this.redis.set(lockKey, token, 'EX', 10, 'NX');

  if (!acquired) {
    // Another caller is loading. Wait, re-read, and MUST return —
    // falling through would load twice and release a lock we do not own.
    await new Promise(r => setTimeout(r, 200));
    const retried = await this.redis.get(key);
    if (retried) return JSON.parse(retried);
    return loader(); // degrade to a direct load; do NOT touch the lock
  }

  try {
    const data = await loader();
    await this.redis.set(key, JSON.stringify(data), 'EX', ttl);
    return data;
  } finally {
    await this.redis.eval(RELEASE, 1, lockKey, token);
  }
}
```

---

## 9. Idempotency

Use idempotency wherever a duplicate request is possible: payments, callbacks, retries,
webhooks, queue jobs.

- A critical operation **MUST** be protected by a **database unique constraint** on its
  business key.
- **MUST NOT** rely on check-then-act alone. Two concurrent requests both pass the check.
- The unique-violation path **MUST** be handled as a success (return the existing result),
  not as an error.
- The recovery read after a unique violation **MUST** be issued on the primary — under
  replication the replica may not yet show the row that caused the violation.
- The recovery read can return nothing. That case **MUST** be handled explicitly rather than
  returned as if it were a result.

```ts
async processPayment(orderId: string, data: PaymentData): Promise<Payment> {
  const existing = await this.paymentRepo.findOne({ where: { orderId } });
  if (existing) return existing;

  try {
    return await this.paymentRepo.save({ orderId, ...data });
  } catch (error) {
    if (error.code !== '23505') throw error; // not a unique violation
    const concurrent = await this.findOnPrimary(orderId);
    if (!concurrent) {
      throw new ConflictException(`Duplicate detected for ${orderId} but row not readable`);
    }
    return concurrent;
  }
}
```

- The order record **MUST** be created **before** the external provider is called, so a crash
  mid-flight leaves a recoverable row.
- Order state **SHOULD** be mutated only through the entity's own transition methods, so the
  status history stays intact.

---

## 10. Outbound HTTP

- All outbound HTTP **SHOULD** go through a single instrumented client that enforces
  logging and timeouts. Where a separate client is genuinely needed, it **MUST** still
  set a timeout and **MUST** still be logged — an uninstrumented client bypasses both.
- Every client **MUST** set an explicit timeout. A client without one waits forever, holding
  a request slot and a connection.
- A client's timeout **MUST** be shorter than the caller's own request budget, and **SHOULD**
  be justified when it exceeds the database statement timeout — an upstream that can hold a
  request longer than any query is the wrong shape.
- **MUST NOT** disable TLS certificate verification. Disabling it on a channel carrying money
  or identity data is not a workaround; it is the vulnerability.
- Outbound calls **SHOULD** be logged with correlation ID, target, duration and outcome, with
  payloads redacted per `.ai/standards/02-security-and-compliance.md`.
- An error handler **MUST NOT** assume a response exists. On a network failure the response
  object is undefined, and unguarded access there replaces the real error with a `TypeError`.

### Retries

- A retry **MUST NOT** be added to an operation that is not idempotent.
  - Safe: reads, status inquiries, genuinely idempotent writes.
  - Not safe: anything that creates, submits, deducts, transfers, burns a voucher, or
    consumes a vendor session or quota.
- A non-idempotent call **MAY** be retried only if it carries an idempotency key the provider
  honours.
- Every retry **MUST** have an explicit attempt cap, backoff, and jitter.
- A retry interceptor installed globally on a client retries **every** call that client makes.
  Before adding one, you **MUST** confirm that every operation reachable through that client
  is safe to replay.

---

## 11. Background jobs and queues

- A queue job **MUST** be idempotent. At-least-once delivery is the default; a job will run
  twice.
- A job's input **MUST NOT** carry a field that changes a security decision — a discriminator
  read from a job payload is attacker-controlled if anything can write to the queue.
- A scheduled job that must run once per tick across multiple instances **MUST** take a
  distributed lock with a TTL longer than the job's worst-case runtime.
- A job with outbound or destructive effects **MUST** be environment-gated.
- Every queue **SHOULD** have a registered consumer. A registered queue with no consumer
  accumulates jobs silently.
- Job failures **SHOULD** be observable — a failed job that only logs is invisible.

---

## 12. Health checks and graceful shutdown

- A service **SHOULD** expose a **liveness** endpoint (is the process up) and a **readiness**
  endpoint (can it serve traffic).
- Readiness **SHOULD** check every dependency the service cannot function without — at minimum
  the database and, where used, the cache/lock store. A health check that reports healthy
  while the lock store is down is worse than none.
- A health endpoint **MUST NOT** expose internal state (uptime, versions, hostnames,
  configuration) to an unauthenticated caller.
- Shutdown hooks **MUST** be enabled, and shutdown **SHOULD**:
  1. stop accepting new requests,
  2. let in-flight requests finish, within a bound,
  3. **pause and drain queue consumers** — removing listeners is not a drain; in-flight jobs
     are abandoned,
  4. close cache connections gracefully (quit, not disconnect),
  5. close database connections,
  6. exit.
- A cron job interrupted by shutdown **SHOULD** leave recoverable state — a lock TTL, or a
  resumable cursor.

---

## 13. Backward compatibility

> **This section overrides every other rule in this standard for endpoints that are already
> live.** Where another section says a live endpoint is wrong, this section decides whether
> it may be changed.

A backend serving released client applications cannot assume its clients update. Old
versions stay in the field indefinitely.

### MUST NOT, on an existing endpoint, without a client version gate

- Remove or rename a response field
- Change a field's JSON type — including number ↔ string for money
- Change the HTTP status code for an existing outcome
- Change an error response shape
- Tighten validation on an existing field
- Change a pagination default or maximum
- Add a required request field
- Change authentication or token semantics
- Shorten a token's lifetime

### MAY always

- Add a new **optional** response field
- Add a new endpoint
- Add a new **optional** request field with a safe default
- Add a new enum value the client can ignore — provided clients tolerate unknown values

### MUST

- Gate behaviour changes on the project's established client-version mechanism.
  **MUST NOT** invent a second mechanism.
- Put new behaviour behind a new field or a new route — never a changed one.
- Keep entity changes compatible with the currently deployed code (§7).
- When a change is unavoidably breaking: version it, ship both, and remove the old path only
  after client telemetry shows it is unused.

---

## 14. Observability

- A correlation ID **MUST** be generated or accepted per request and propagated through logs
  and all downstream calls.
- A correlation ID accepted from a client header **MUST** be format-validated before use.
  It is untrusted input, and it is being written into a database column.
- Logs **SHOULD** carry structured context — correlation ID, user ID, operation, duration —
  not interpolated prose.
- **SHOULD NOT** use `console.*`. Use the configured logger, enforced by a lint rule.
  Where a log could carry credentials or personal data, `02` §2.5 makes this a **MUST NOT**.
- Errors **SHOULD** be logged with enough context to diagnose without reproducing: correlation
  ID, identifiers, operation, error message, stack. A logged error message alone is not
  actionable.
- Log volume **MUST** be bounded — see retention in `.ai/standards/02-security-and-compliance.md`.
- Redaction rules are in `02`. They are not optional, and they apply to responses as well as
  requests.

---

## 15. Configuration

- Configuration **SHOULD** be accessed through a typed, validated accessor.
- Raw environment reads **SHOULD NOT** appear outside the configuration layer. A variable read
  directly from the environment escapes validation and fails at request time instead of boot.
- Every configuration variable **MUST** be validated at startup. Missing required
  configuration **MUST** fail the boot, loudly.
- Secrets **MUST NOT** be hard-coded or committed. See `02`.
- A configuration value that is required but unused **SHOULD** be removed — it is a boot
  failure waiting for a fresh environment.

---

## 16. Dependencies

- A lockfile **MUST** be committed. Without one, builds are not reproducible, a clean install
  is impossible, and dependency scan results mean nothing.
- CI **MUST** install from the lockfile.
- Adding or upgrading a dependency **SHOULD** be a deliberate, reviewed change — never a side
  effect of a feature.
- A dependency vulnerability scan **MUST** run in CI.

---

## 17. Testing

- Unit tests **MUST** mock all external dependencies — database, cache, providers. A test
  **MUST NOT** call a real external service.
- Unit tests **SHOULD** target the service layer.
- Test names **SHOULD** follow `should <expected> when <condition>`.
- Every new module **SHOULD** ship with unit tests.
- **Once CI runs the test suite (§18), the following become MUST** — they are the four places
  where an untested defect is expensive rather than annoying:
  1. **State transitions on a money path** — every edge of the state machine.
  2. **Idempotency** — a duplicate request returns the same result and does not double-apply.
  3. **Authorization** — wrong user, missing token, expired token, another user's resource.
  4. **Webhook signature verification** — a valid signature passes, an invalid one is
     rejected _and changes no state_.
- Coverage **MUST NOT** decrease. A ratchet, not an absolute floor: an absolute percentage
  gets satisfied with trivial tests and measures lines rather than risk, while a ratchet stops
  the decline without pretending to a number nobody chose.
- Validation rejections and error paths **SHOULD** be tested.
- A commented-out test file **SHOULD** be deleted or fixed. It reports as passing.
- **MUST NOT** describe a change as "tested" because a suite passed. State which behaviour
  you verified.

---

## 18. CI/CD

Local hooks are a convenience. They are skippable, and they do not run on someone else's
machine.

- The following **MUST** run in CI on every pull request:
  1. lint
  2. type check
  3. unit tests
  4. dependency vulnerability scan
  5. secret scan
- A merge **MUST** be blocked on those gates.
- Local pre-commit / pre-push hooks **SHOULD** mirror a subset for fast feedback. They
  **MUST NOT** be the only place a gate runs.
- Deployment **SHOULD** be automated and reversible. The rollback procedure **SHOULD** be
  documented in `.ai/standards/03-project-architecture.md`.

---

## 19. Time and internationalization

- Timestamps **SHOULD** be stored as `timestamptz` and handled in UTC internally.
- Application code **SHOULD NOT** hard-code a time zone. Read the configured zone.
- A scheduled job's time zone **SHOULD** come from configuration, not a literal.
- User-facing messages **SHOULD** be translated in the service layer, not in an exception
  filter or a controller.
- A new message key **MUST** be added to **every** supported locale in the same change.
  A missing key leaks the raw key to a user.
- **SHOULD NOT** build a user-facing sentence by concatenating translated fragments.
