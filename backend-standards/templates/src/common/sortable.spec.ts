import { BadRequestException } from '@nestjs/common';

import type { SortMap } from './sortable';
import { applySort, resolveSortColumn } from './sortable';

/**
 * §3 says the allowlist is the control, not the DTO. These tests are what make that
 * claim checkable — in particular the prototype-chain case, which is the one way a
 * naive `if (!map[key])` guard silently lets an unexpected identifier through.
 */
describe('sortable', () => {
  const SORT: SortMap = {
    createdAt: 'payment.created_at',
    amount: 'payment.amount',
  };

  describe('resolveSortColumn', () => {
    it('should resolve an allowlisted key to its column expression', () => {
      expect(resolveSortColumn('amount', SORT, 'createdAt')).toBe('payment.amount');
    });

    it('should fall back when no sort key is supplied', () => {
      expect(resolveSortColumn(undefined, SORT, 'createdAt')).toBe('payment.created_at');
    });

    it('should reject a key that is not in the allowlist', () => {
      expect(() => resolveSortColumn('password', SORT, 'createdAt')).toThrow(BadRequestException);
    });

    it('should reject inherited Object.prototype keys rather than treating them as allowed', () => {
      // Each of these returns a truthy inherited value from a plain object literal,
      // so a `if (!map[key])` guard would pass them straight through to ORDER BY.
      for (const inherited of [
        'toString',
        'constructor',
        'valueOf',
        'hasOwnProperty',
        '__proto__',
        'isPrototypeOf',
      ]) {
        expect(() => resolveSortColumn(inherited, SORT, 'createdAt')).toThrow(BadRequestException);
      }
    });

    it('should reject an empty or non-string allowlist entry', () => {
      const broken = { createdAt: '' } as unknown as SortMap;
      expect(() => resolveSortColumn('createdAt', broken, 'createdAt')).toThrow(
        BadRequestException,
      );
    });

    it('should name the allowed fields in the error, so the caller can correct itself', () => {
      expect(() => resolveSortColumn('nope', SORT, 'createdAt')).toThrow(/createdAt, amount/);
    });
  });

  describe('applySort', () => {
    it('should pass the resolved column and order to the query builder', () => {
      const qb = { orderBy: jest.fn().mockReturnThis() };
      applySort(qb as any, SORT, 'createdAt', 'amount', 'ASC');
      expect(qb.orderBy).toHaveBeenCalledWith('payment.amount', 'ASC');
    });

    it('should never reach the query builder when the key is rejected', () => {
      const qb = { orderBy: jest.fn().mockReturnThis() };
      expect(() => applySort(qb as any, SORT, 'createdAt', 'toString')).toThrow(
        BadRequestException,
      );
      expect(qb.orderBy).not.toHaveBeenCalled();
    });
  });
});
