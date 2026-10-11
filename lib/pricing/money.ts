/**
 * Integer money arithmetic.
 *
 * Every amount in NUVORA is a whole number of MINOR UNITS (kobo, cents, pence) held in
 * a bigint. Floating point is never used for money: 0.1 + 0.2 !== 0.3 in binary
 * floating point, and a store that rounds its way out of that eventually charges
 * someone the wrong amount.
 *
 * A currency code travels with every amount, and amounts in different currencies are
 * never combined. Converting between currencies happens at exactly one place - the
 * pricing engine, via an explicit fx rate that is recorded on the result.
 */

export type Minor = bigint;
export type CurrencyCode = string;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const INTEGER_RE = /^-?\d+$/;

/**
 * Coerce a value coming back from the database or an API into a Minor.
 *
 * Supabase returns an int8 column as a JavaScript number. That is safe up to
 * Number.MAX_SAFE_INTEGER and we refuse anything beyond it rather than silently
 * losing precision: if a catalogue ever holds amounts that large, configure PostgREST
 * to serialise bigint as a string and pass that string straight through.
 */
export function asMinor(value: number | string | bigint, label = "amount"): Minor {
  if (typeof value === "bigint") return value;

  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new MoneyError(`${label} must be a whole number of minor units, received ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(
        `${label} exceeds Number.MAX_SAFE_INTEGER (${value}). Return bigint as a string from the database instead.`,
      );
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (!INTEGER_RE.test(trimmed)) {
    throw new MoneyError(`${label} is not a whole number of minor units: ${JSON.stringify(value)}`);
  }
  return BigInt(trimmed);
}

export function assertCurrency(code: string): CurrencyCode {
  if (!CURRENCY_RE.test(code)) {
    throw new MoneyError(`invalid ISO-4217 currency code: ${JSON.stringify(code)}`);
  }
  return code;
}

export function assertSameCurrency(a: CurrencyCode, b: CurrencyCode): void {
  if (a !== b) {
    throw new MoneyError(
      `refusing to combine amounts in different currencies: ${a} vs ${b}`,
    );
  }
}

/**
 * value * numerator / denominator, rounded half away from zero.
 *
 * Written by hand rather than with floating point so that a half-kobo rounds the same
 * way on every machine, and so large amounts cannot lose precision.
 */
export function mulDivRoundHalfUp(
  value: Minor,
  numerator: bigint,
  denominator: bigint,
): Minor {
  if (denominator === 0n) {
    throw new MoneyError("division by zero in money arithmetic");
  }
  const product = value * numerator;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;

  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return negative ? -rounded : rounded;
}

/**
 * Apply a percentage to an amount. The percentage may carry up to four decimal places,
 * matching the numeric(7,4) column used for margin percentages: 12.5 means 12.5 %.
 */
export function percentageOf(value: Minor, percentage: number): Minor {
  if (!Number.isFinite(percentage)) {
    throw new MoneyError(`percentage must be finite, received ${percentage}`);
  }
  // Scale to 1/10000ths so 12.5000 survives the trip without float drift.
  const scaled = Math.round(percentage * 10_000);
  return mulDivRoundHalfUp(value, BigInt(scaled), 1_000_000n);
}

// -----------------------------------------------------------------------------
// Presentation rounding
//
// Applied AFTER the margin, so the customer never sees an awkward figure. Note that
// rounding can only move a price by less than one major unit, but it can still move it
// BELOW our cost - which is why the engine re-checks the cost floor after rounding
// rather than assuming rounding is harmless.
// -----------------------------------------------------------------------------
export type RoundingMode =
  | "none"
  | "nearest_10"
  | "nearest_50"
  | "nearest_100"
  | "charm_99";

export const ROUNDING_MODES: readonly RoundingMode[] = [
  "none",
  "nearest_10",
  "nearest_50",
  "nearest_100",
  "charm_99",
] as const;

function roundToNearest(value: Minor, step: bigint): Minor {
  return mulDivRoundHalfUp(value, 1n, step) * step;
}

/**
 * `charm_99` produces a price ending in .99 by rounding DOWN to the nearest whole major
 * unit and subtracting one minor unit. It deliberately never rounds up: a charm price
 * should not be a way to charge more than the margin calculation produced.
 *
 * It is IDEMPOTENT: a value that already ends in 99 is returned unchanged. Without that
 * check, re-applying the mode would shave another whole major unit off every time it ran
 * (4,999.99 -> 4,998.99 -> 4,997.99), turning a display preference into a slow discount.
 */
export function applyRounding(value: Minor, mode: RoundingMode): Minor {
  if (value <= 0n) return value;

  switch (mode) {
    case "none":
      return value;
    case "nearest_10":
      return roundToNearest(value, 10n);
    case "nearest_50":
      return roundToNearest(value, 50n);
    case "nearest_100":
      return roundToNearest(value, 100n);
    case "charm_99": {
      if (value % 100n === 99n) return value;
      const wholeMajor = (value / 100n) * 100n;
      const candidate = wholeMajor - 1n;
      return candidate > 0n ? candidate : value;
    }
  }
}

export function clamp(value: Minor, min: Minor | null, max: Minor | null): Minor {
  let result = value;
  if (min !== null && result < min) result = min;
  if (max !== null && result > max) result = max;
  return result;
}

/** Render a Minor for display. Formatting only - never feed this back into arithmetic. */
export function formatMinor(value: Minor, currency: CurrencyCode): string {
  assertCurrency(currency);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const major = (magnitude / 100n).toString();
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${currency} ${grouped}.${fraction}`;
}
