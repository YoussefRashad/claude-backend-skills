/**
 * Money arithmetic — exact, with zero dependencies.
 *
 * Standard: .ai/standards/01-engineering-standards.md §6.
 * Decision (Youssef Farag, 2026-09-20): no decimal library. Correctness is achieved
 * by doing arithmetic in INTEGER MINOR UNITS and converting back once, at the edge.
 *
 * ── Read this before changing anything here ────────────────────────────────────
 *
 * JavaScript numbers are binary floats. `0.1 + 0.2 !== 0.3`. The danger is not one
 * multiplication — it is ACCUMULATION: adding fifty amounts and rounding once at the
 * end lets the drift compound before you round it away.
 *
 * `parseAmount` is EXACT when given a STRING, because it never multiplies — it moves
 * the decimal point textually. Postgres returns `numeric` to the driver as a string,
 * so if the entity property is typed `string` (as §6 requires), every amount that
 * came from the database goes through the exact path.
 *
 * When given a `number`, exactness cannot be guaranteed: the value has already lost
 * precision before this function sees it. Prefer the string.
 */

/** Decimal places for the currency. EGP = 2. */
export const MONEY_SCALE = 2;

const FACTOR = 10 ** MONEY_SCALE;

/**
 * Round half AWAY FROM ZERO — what accounting means by "half-up", applied
 * symmetrically: 0.5 -> 1 and -0.5 -> -1.
 *
 * `Math.round` alone rounds half toward +Infinity (`Math.round(-0.5)` is -0), so
 * using it directly makes a refund or reversal round in the opposite direction from
 * the charge it reverses. The `|| 0` collapses -0, which is falsy, back to 0 so a
 * zero amount never serializes as "-0".
 */
function roundHalfAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value)) || 0;
}

/**
 * Parse an amount into exact integer minor units (piastres for EGP).
 *
 * Exact for strings — no floating-point multiplication is performed.
 *
 * @throws {RangeError} if the value is not a finite decimal number
 */
export function parseAmount(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Not a finite amount: ${value}`);
    }
    // Already a float; the best available conversion. Prefer passing a string.
    return roundHalfAwayFromZero(value * FACTOR);
  }

  const trimmed = value.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- linear; no nested quantifier, no catastrophic backtracking
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new RangeError(`Not a decimal amount: "${value}"`);
  }

  const negative = trimmed.startsWith('-');
  const [whole, fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');

  // Pad or round the fractional part to the currency scale, textually.
  let minor: number;
  if (fraction.length <= MONEY_SCALE) {
    minor = Number(whole + fraction.padEnd(MONEY_SCALE, '0'));
  } else {
    const kept = Number(whole + fraction.slice(0, MONEY_SCALE));
    // eslint-disable-next-line security/detect-object-injection -- constant index into a digit string
    const nextDigit = Number(fraction[MONEY_SCALE]);
    minor = nextDigit >= 5 ? kept + 1 : kept; // half-up, as accounting expects
  }

  return negative ? -minor : minor;
}

/** Convert integer minor units back to major units. Call once, at the edge. */
export function fromMinorUnits(minor: number): number {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`Minor units must be an integer: ${minor}`);
  }
  return minor / FACTOR;
}

/** Normalize any amount to the currency scale. Call after EVERY operation. */
export function money(value: string | number): number {
  return fromMinorUnits(parseAmount(value));
}

/** Sum a list of amounts exactly. Accumulates in integer minor units. */
export function sumAmounts(values: Array<string | number>): number {
  return fromMinorUnits(values.reduce<number>((acc, v) => acc + parseAmount(v), 0));
}

export function addAmounts(a: string | number, b: string | number): number {
  return fromMinorUnits(parseAmount(a) + parseAmount(b));
}

export function subtractAmounts(a: string | number, b: string | number): number {
  return fromMinorUnits(parseAmount(a) - parseAmount(b));
}

/**
 * Multiply an amount by a plain factor (a rate, a quantity, a tenor count).
 * Rounds to the currency scale immediately — §6 requires normalizing after every
 * operation rather than at the end of a chain.
 */
export function multiplyAmount(amount: string | number, factor: number): number {
  if (!Number.isFinite(factor)) {
    throw new RangeError(`Not a finite factor: ${factor}`);
  }
  return fromMinorUnits(roundHalfAwayFromZero(parseAmount(amount) * factor));
}

/** Compare amounts. Never compare with `===` — §6. */
export function amountsEqual(a: string | number, b: string | number): boolean {
  return parseAmount(a) === parseAmount(b);
}

export function compareAmounts(a: string | number, b: string | number): -1 | 0 | 1 {
  const [x, y] = [parseAmount(a), parseAmount(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Minor units for a provider that bills in them (e.g. Paymob works in piastres).
 *
 * §6: amounts in different minor units MUST NOT be mixed, and the unit SHOULD be
 * part of the name. Call this exactly at the provider boundary — never earlier.
 */
export function toProviderMinorUnits(amount: string | number): number {
  return parseAmount(amount);
}
