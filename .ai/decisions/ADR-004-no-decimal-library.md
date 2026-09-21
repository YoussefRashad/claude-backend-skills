# ADR-004: Money arithmetic with zero dependencies

## Status

Accepted. Owner-signed: **Youssef Farag, 2026-09-20**.

## Context

JavaScript numbers are binary floats, so `0.1 + 0.2 !== 0.3`. The standard needs money
arithmetic that is exact. The usual answer is a decimal library (decimal.js, big.js).

The real risk is **accumulation**, not a single operation: rounding to the currency scale
after one multiplication is fine, but adding fifty amounts and rounding once at the end
lets drift compound before it is rounded away.

## Decision

No decimal library. Correctness comes from doing arithmetic in **integer minor units** and
converting back once, at the edge.

The rules that make it work: normalize to the currency scale after **every** operation,
never only at the end; sum either by normalizing at each step or in integer minor units;
never mix units from different providers; never compare with `===` without normalizing.

A decimal library **MAY** be introduced later if a flow needs more than the currency's
scale or accumulates over thousands of rows — but that is a dependency decision and
**MUST** be raised with the owner rather than added.

## Alternatives Considered

| Option                                      | Pros                                                                                             | Cons                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Integer minor units, no dependency (chosen) | Exact; zero supply-chain surface; `parseAmount` is exact for strings because it never multiplies | Hand-rolled; correctness depends on the spec being kept                                                                    |
| decimal.js / big.js                         | Arbitrary precision; familiar API                                                                | A dependency in every service for arithmetic the rules already make exact; `01` §16 treats adding one as a reviewed change |
| Floats with rounding at the end             | Simplest to write                                                                                | The accumulation case is exactly what breaks, and it breaks silently                                                       |

## Consequences

- `money.util.ts` and `money.util.spec.ts` ship together. The spec is what makes the
  exactness claim checkable rather than asserted — verified 2026-09-20, 38 assertions.
- `parseAmount` is exact **only for strings**, which is why `01` §6 requires an entity
  property mapped to `numeric` to be typed `string` or carry a transformer. Postgres
  returns `numeric` to the driver as a string precisely to preserve precision.
- Rounding is half away from zero through a single helper, so a refund rounds the same
  distance as the charge it reverses. `Math.round` alone rounds half toward +∞ and breaks
  that symmetry on negatives.

## Evidence

- `backend-standards/references/01-engineering-standards.md` §6 — the signed decision
  block, and the surrounding MUSTs on normalization and accumulation.
- `backend-standards/templates/src/common/money.util.ts` — the header comment restates the
  decision and the reasoning.
- `backend-standards/templates/src/common/money.util.spec.ts`.
