import { BadRequestException } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';

/**
 * Sort-column allowlist, enforced at the query layer.
 *
 * Standard: .ai/standards/01-engineering-standards.md §3.
 *
 * WHY THIS EXISTS, AND WHY IT IS HERE AND NOT ONLY IN THE DTO
 * ──────────────────────────────────────────────────────────────────────────────
 * `ORDER BY $1` does not work — a SQL identifier cannot be parameterized. So any
 * `sortBy` parameter is, by construction, string interpolation into SQL.
 *
 * A DTO enum keeps today's callers honest, but it is one careless new caller (or one
 * decorator changed to `@IsString()`) away from an injection, and neither lint nor
 * tests would notice. The query layer is the boundary that must not trust its input.
 */

export type SortMap = Readonly<Record<string, string>>;

/**
 * Resolve a client-supplied sort key to a real column expression.
 *
 * @throws {BadRequestException} if the key is not in the allowlist
 */
export function resolveSortColumn(
  sortBy: string | undefined,
  map: SortMap,
  fallback: string,
): string {
  const key = sortBy ?? fallback;

  // `Object.hasOwn`, NOT `map[key]` truthiness. A plain object literal inherits from
  // Object.prototype, so `map['toString']` (or 'constructor', 'valueOf', '__proto__')
  // returns an inherited function — truthy — and walks straight past a `if (!column)`
  // guard into the ORDER BY clause. An own-key check is what makes this an allowlist
  // rather than a suggestion.
  if (!Object.hasOwn(map, key)) {
    throw new BadRequestException(
      `Invalid sort field "${key}". Allowed: ${Object.keys(map).join(', ')}`,
    );
  }

  // eslint-disable-next-line security/detect-object-injection -- own-key verified above
  const column = map[key];

  // A map value is developer-supplied, never client-supplied — but an entry that is
  // empty or not a string would still reach the query builder. Fail rather than emit.
  if (typeof column !== 'string' || column.length === 0) {
    throw new BadRequestException(`Invalid sort field "${key}".`);
  }

  return column;
}

/** Apply an allowlisted sort to a query builder. */
export function applySort<T extends object>(
  qb: SelectQueryBuilder<T>,
  map: SortMap,
  fallback: string,
  sortBy?: string,
  sortOrder: 'ASC' | 'DESC' = 'DESC',
): SelectQueryBuilder<T> {
  return qb.orderBy(resolveSortColumn(sortBy, map, fallback), sortOrder);
}

/* Usage:
 *
 *   const PAYMENT_SORT: SortMap = {
 *     createdAt: 'payment.created_at',
 *     amount:    'payment.amount',
 *   };
 *
 *   applySort(qb, PAYMENT_SORT, 'createdAt', query.sortBy, query.sortOrder);
 */
