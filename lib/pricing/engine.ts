import {
  applyRounding,
  asMinor,
  assertCurrency,
  clamp,
  percentageOf,
  type Minor,
} from "./money";
import { resolveRule } from "./rules";
import type { PriceBreakdown, PricingProduct, PricingRule, NumericValue } from "./types";

export const ENGINE_VERSION = "1.0.1";

export class PricingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

function toFxRate(value: NumericValue): number {
  const rate = typeof value === "number" ? value : Number(value.toString());
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new PricingError("invalid_fx_rate", `fx_rate must be a positive number, received ${String(value)}`);
  }
  return rate;
}

/**
 * Compose the fx rate into an integer fraction so the conversion is exact integer math.
 * numeric(18,8) in the database means at most eight decimal places, so scaling by 10^8
 * is lossless for any rate the schema can hold.
 */
function fxFraction(rate: number): { numerator: bigint; denominator: bigint } {
  const scaled = Math.round(rate * 1e8);
  if (scaled <= 0) {
    throw new PricingError("invalid_fx_rate", `fx_rate is too small to represent: ${rate}`);
  }
  return { numerator: BigInt(scaled), denominator: 100_000_000n };
}

/**
 * Compute the customer price for one product.
 *
 * THE PIPELINE, in order. Each step may only move the price within a policy the operator
 * explicitly set; nothing is inferred.
 *
 *   1. resolve at most one rule (most specific wins) and convert supplier cost into the
 *      sale currency using that rule's fx rate
 *   2. apply the margin - OR, when no rule resolved, charge base_price_minor as-is
 *   3. apply the presentation rounding mode
 *   4. clamp into the rule's own min/max policy band
 *   5. GUARD: the result must not be below cost. If a misconfiguration conspires to price
 *      below cost, the engine throws rather than quoting a loss
 *   6. recompute the margin as (price - cost) so the stored figure is arithmetically
 *      exact - the database enforces this with a CHECK constraint, and a mismatch there
 *      would be a hard failure at insert time
 *
 * ON base_price_minor: it is the no-rule fallback, NOT a floor over a rule's result. An
 * earlier version treated it as a floor, which meant any margin that produced less than
 * the base price was silently overridden - every percentage rule was inert. If you want
 * a genuine floor beneath a rule, set min_price_minor ON THE RULE.
 *
 * This function is pure. It takes no client input and performs no I/O, which is what
 * makes it safe to call on a price a customer claims to have seen: the answer depends
 * only on the database rows passed in.
 */
export function computePrice(args: {
  product: PricingProduct;
  rules: readonly PricingRule[];
  at?: Date;
}): PriceBreakdown {
  const { product } = args;

  const currency = assertCurrency(product.currency);
  const costCurrency = assertCurrency(product.supplier_currency);
  const costRaw = asMinor(product.supplier_cost_minor, "supplier_cost_minor");
  const basePrice = asMinor(product.base_price_minor, "base_price_minor");

  if (costRaw < 0n) {
    throw new PricingError("negative_cost", `product ${product.sku} has a negative supplier cost`);
  }
  if (basePrice < 0n) {
    throw new PricingError("negative_price", `product ${product.sku} has a negative base price`);
  }
  if (product.status !== "active") {
    throw new PricingError(
      "product_not_active",
      `product ${product.sku} is ${product.status}; refusing to price something that is not on sale`,
    );
  }

  const rule = resolveRule({
    productId: product.id,
    productLine: product.product_line,
    rules: args.rules,
    ...(args.at ? { at: args.at } : {}),
  });

  const rounding = rule?.rounding ?? "none";
  const rate = rule ? toFxRate(rule.fx_rate) : 1;

  // -- 1. convert cost into the sale currency ---------------------------------
  let cost: Minor = costRaw;
  if (costCurrency !== currency) {
    const { numerator, denominator } = fxFraction(rate);
    const scaled = costRaw * numerator;
    const negative = scaled < 0n;
    const magnitude = negative ? -scaled : scaled;
    const quotient = magnitude / denominator;
    const remainder = magnitude % denominator;
    cost = remainder * 2n >= denominator ? quotient + 1n : quotient;
    if (negative) cost = -cost;
  }

  // -- 2. margin, or the no-rule fallback price --------------------------------
  let price = cost;
  let marginBasisPoints = 0;
  let decidedBy: PriceBreakdown["decidedBy"] = "margin";

  if (rule) {
    switch (rule.margin_type) {
      case "percentage": {
        if (rule.margin_percentage === null) {
          throw new PricingError("invalid_rule", `rule ${rule.id} is percentage-based but has no percentage`);
        }
        const pct = Number(rule.margin_percentage.toString());
        marginBasisPoints = Math.round(pct * 100);
        price = cost + percentageOf(cost, pct);
        break;
      }
      case "fixed": {
        price = cost + asMinor(rule.margin_fixed_minor, "margin_fixed_minor");
        break;
      }
      case "percentage_plus_fixed": {
        if (rule.margin_percentage === null) {
          throw new PricingError("invalid_rule", `rule ${rule.id} is percentage-based but has no percentage`);
        }
        const pct = Number(rule.margin_percentage.toString());
        marginBasisPoints = Math.round(pct * 100);
        price = cost + percentageOf(cost, pct) + asMinor(rule.margin_fixed_minor, "margin_fixed_minor");
        break;
      }
    }
  } else {
    // No rule resolved: the product's own base price IS the price. This is a
    // legitimate configuration, not an error, and it is the ONLY thing base_price_minor
    // does - it is not a floor over a rule's result.
    price = basePrice;
    decidedBy = "base_price_no_rule";
  }

  // -- 3. presentation rounding -----------------------------------------------
  const rounded = applyRounding(price, rounding);
  if (rounded !== price) {
    decidedBy = "rounding";
    price = rounded;
  }

  // -- 4. the rule's own policy band ------------------------------------------
  const minPrice =
    rule?.min_price_minor === null || rule?.min_price_minor === undefined
      ? null
      : asMinor(rule.min_price_minor, "min_price_minor");
  const maxPrice =
    rule?.max_price_minor === null || rule?.max_price_minor === undefined
      ? null
      : asMinor(rule.max_price_minor, "max_price_minor");

  const bounded = clamp(price, minPrice, maxPrice);
  if (bounded !== price) {
    decidedBy = minPrice !== null && bounded === minPrice ? "rule_min_floor" : "rule_max_ceiling";
    price = bounded;
  }

  // -- 5. never sell below cost ------------------------------------------------
  if (price < cost) {
    throw new PricingError(
      "below_cost",
      `refusing to price ${product.sku} below cost: price ${price} < cost ${cost} ` +
        `(currency ${currency}, rule ${rule?.id ?? "none"}, decided by ${decidedBy})`,
    );
  }

  // -- 6. derive the margin so the stored figures are arithmetically exact ------
  return {
    customerPriceMinor: price,
    supplierCostMinor: cost,
    marginMinor: price - cost,
    marginBasisPoints,
    ruleId: rule?.id ?? null,
    ruleName: rule?.name ?? null,
    roundingApplied: rounding,
    fxRate: rate,
    decidedBy,
    engineVersion: ENGINE_VERSION,
  };
}
