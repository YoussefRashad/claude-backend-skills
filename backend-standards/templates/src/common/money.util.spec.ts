import {
  addAmounts,
  amountsEqual,
  compareAmounts,
  money,
  multiplyAmount,
  parseAmount,
  subtractAmounts,
  sumAmounts,
} from './money.util';

/**
 * These tests are the reason the money rules are believable.
 *
 * .ai/standards/01-engineering-standards.md §6 claims the zero-dependency approach is exact.
 * That claim is only worth anything if something checks it — so this spec ships
 * with the utility rather than being left for later.
 */
describe('money.util', () => {
  describe('parseAmount', () => {
    it('should convert major units to exact minor units when given a string', () => {
      expect(parseAmount('0.1')).toBe(10);
      expect(parseAmount('100')).toBe(10000);
      expect(parseAmount('1234.56')).toBe(123456);
    });

    it('should round half-up when the input has more precision than the scale', () => {
      expect(parseAmount('1.005')).toBe(101);
      expect(parseAmount('1.004')).toBe(100);
      expect(parseAmount('1.999')).toBe(200);
      expect(parseAmount('0.005')).toBe(1);
    });

    it('should handle negative amounts', () => {
      expect(parseAmount('-5.25')).toBe(-525);
    });

    it('should tolerate leading zeros', () => {
      expect(parseAmount('007.5')).toBe(750);
    });

    it('should reject a value that is not a plain decimal', () => {
      for (const bad of ['abc', '.5', '1.2.3', '', '1e5', 'NaN']) {
        expect(() => parseAmount(bad)).toThrow(RangeError);
      }
    });

    it('should round a numeric input away from zero, matching the string path', () => {
      expect(parseAmount(-0.005)).toBe(parseAmount('-0.005'));
      expect(parseAmount(0.005)).toBe(parseAmount('0.005'));
    });

    it('should reject a non-finite number', () => {
      expect(() => parseAmount(Number.NaN)).toThrow(RangeError);
      expect(() => parseAmount(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });
  });

  describe('sumAmounts', () => {
    it('should be exact where naive float addition is not', () => {
      // The whole point of §6, in one assertion.
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(sumAmounts(['0.1', '0.2'])).toBe(0.3);
    });

    it('should not accumulate drift across many additions', () => {
      expect(sumAmounts(Array(100).fill('0.01'))).toBe(1);
      expect(sumAmounts(Array(1000).fill('0.07'))).toBe(70);
    });

    it('should return zero for an empty list', () => {
      expect(sumAmounts([])).toBe(0);
    });
  });

  describe('arithmetic', () => {
    it('should add and subtract exactly', () => {
      expect(addAmounts('1999.99', '0.01')).toBe(2000);
      expect(subtractAmounts('100', '0.01')).toBe(99.99);
    });

    it('should apply a rate and normalize immediately', () => {
      expect(multiplyAmount('1000', 0.175)).toBe(175);
      expect(multiplyAmount('33.33', 3)).toBe(99.99);
    });

    it('should reject a non-finite factor', () => {
      expect(() => multiplyAmount('100', Number.NaN)).toThrow(RangeError);
    });

    // A refund must round the same distance as the charge it reverses. Math.round
    // alone rounds half toward +Infinity, which breaks that symmetry on negatives.
    it('should round negatives away from zero, symmetrically with positives', () => {
      expect(multiplyAmount('0.01', 0.5)).toBe(0.01);
      expect(multiplyAmount('-0.01', 0.5)).toBe(-0.01);
      expect(multiplyAmount('-33.33', 3)).toBe(-99.99);
      expect(multiplyAmount('-1000', 0.175)).toBe(-175);
    });

    it('should return a clean zero rather than -0', () => {
      expect(Object.is(multiplyAmount('-100', 0), 0)).toBe(true);
    });
  });

  describe('comparison', () => {
    it('should compare a string amount against a number amount', () => {
      expect(amountsEqual('10.00', 10)).toBe(true);
      expect(amountsEqual('10.001', 10)).toBe(true); // both normalize to 1000
      expect(amountsEqual('10.01', 10)).toBe(false);
    });

    it('should order amounts', () => {
      expect(compareAmounts('9.99', '10.00')).toBe(-1);
      expect(compareAmounts('10.00', '10.00')).toBe(0);
      expect(compareAmounts('10.01', '10.00')).toBe(1);
    });
  });

  describe('money', () => {
    it('should normalize to the currency scale', () => {
      expect(money('12.349')).toBe(12.35);
      expect(money('12.344')).toBe(12.34);
    });
  });
});
