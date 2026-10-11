/**
 * Pricing engine tests.
 *
 * These are the assertions that stop a pricing bug from becoming a revenue bug. They run
 * without a database because the engine is a pure function of its inputs - which is the
 * whole point of splitting it out of the route handlers.
 *
 * Run:  npm test
 */

import { describe, expect, it } from "vitest";

import {
  applyRounding,
  asMinor,
  formatMinor,
  mulDivRoundHalfUp,
  percentageOf,
} from "./money";
import { computePrice, PricingError } from "./engine";
import { resolveRule } from "./rules";
import { validateOrder } from "./order";
import type { PricingProduct, PricingRule } from "./types";

// --- fixtures ----------------------------------------------------------------

function product(overrides: Partial<PricingProduct> = {}): PricingProduct {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sku: "ESIM-NG-5GB",
    name: "Nigeria 5 GB / 30 days",
    product_line: "esim",
    status: "active",
    currency: "NGN",
    base_price_minor: 500_000, // NGN 5,000.00
    supplier_cost_minor: 400_000, // NGN 4,000.00
    supplier_currency: "NGN",
    ...overrides,
  };
}

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Global 10 percent",
    scope: "global",
    product_line: null,
    product_id: null,
    margin_type: "percentage",
    margin_percentage: 10,
    margin_fixed_minor: 0,
    rounding: "none",
    min_price_minor: null,
    max_price_minor: null,
    fx_rate: 1,
    priority: 100,
    is_active: true,
    effective_from: "2026-01-01T00:00:00Z",
    effective_to: null,
    ...overrides,
  };
}

// --- money primitives --------------------------------------------------------

describe("money", () => {
  it("coerces numbers, strings and bigints to Minor", () => {
    expect(asMinor(500_000)).toBe(500_000n);
    expect(asMinor("500000")).toBe(500_000n);
    expect(asMinor(500_000n)).toBe(500_000n);
  });

  it("refuses a fractional number of minor units", () => {
    expect(() => asMinor(1.5, "amount")).toThrow(/whole number/);
  });

  it("refuses an amount beyond Number.MAX_SAFE_INTEGER rather than losing precision", () => {
    expect(() => asMinor(Number.MAX_SAFE_INTEGER + 10)).toThrow(/MAX_SAFE_INTEGER/);
  });

  it("refuses a non-numeric string", () => {
    expect(() => asMinor("5,000.00")).toThrow(/whole number/);
  });

  it("divides with half-up rounding", () => {
    expect(mulDivRoundHalfUp(10n, 1n, 4n)).toBe(3n); // 2.5 -> 3
    expect(mulDivRoundHalfUp(9n, 1n, 4n)).toBe(2n); // 2.25 -> 2
    expect(mulDivRoundHalfUp(-10n, 1n, 4n)).toBe(-3n); // -2.5 -> -3, away from zero
  });

  it("takes a percentage without floating point drift", () => {
    expect(percentageOf(400_000n, 10)).toBe(40_000n);
    expect(percentageOf(400_000n, 12.5)).toBe(50_000n);
    expect(percentageOf(400_001n, 12.5)).toBe(50_000n);
    expect(percentageOf(0n, 12.5)).toBe(0n);
  });

  it("rounds in every supported mode", () => {
    expect(applyRounding(50_123n, "none")).toBe(50_123n);
    expect(applyRounding(50_123n, "nearest_10")).toBe(50_120n);
    expect(applyRounding(50_125n, "nearest_10")).toBe(50_130n);
    expect(applyRounding(50_125n, "nearest_50")).toBe(50_150n);
    expect(applyRounding(50_149n, "nearest_100")).toBe(50_100n);
  });

  it("charm_99 rounds DOWN to a .99 ending and never inflates a price", () => {
    expect(applyRounding(500_000n, "charm_99")).toBe(499_999n); // NGN 5,000.00 -> NGN 4,999.99
    expect(applyRounding(100n, "charm_99")).toBe(99n);
  });

  it("charm_99 is idempotent: a price already ending in .99 is left alone", () => {
    // Regression: without the modulo guard, each pass shaved another whole major unit
    // off the price, so a display preference silently became a recurring discount.
    const once = applyRounding(500_000n, "charm_99");
    expect(once).toBe(499_999n);
    expect(applyRounding(once, "charm_99")).toBe(499_999n);
    expect(applyRounding(499_999n, "charm_99")).toBe(499_999n);
    expect(applyRounding(99n, "charm_99")).toBe(99n);
  });

  it("leaves tiny amounts alone rather than producing a nonsense price", () => {
    expect(applyRounding(50n, "charm_99")).toBe(50n);
    expect(applyRounding(0n, "charm_99")).toBe(0n);
  });

  it("formats for display without being usable as an input", () => {
    expect(formatMinor(500_000n, "NGN")).toBe("NGN 5,000.00");
    expect(formatMinor(499_999n, "NGN")).toBe("NGN 4,999.99");
    expect(formatMinor(7n, "USD")).toBe("USD 0.07");
  });
});

// --- rule resolution --------------------------------------------------------

describe("rule resolution", () => {
  const at = new Date("2026-06-01T00:00:00Z");
  const p = product();

  it("prefers the most specific rule: product beats line beats global", () => {
    const global = rule({ id: "r-global", scope: "global" });
    const line = rule({ id: "r-line", scope: "product_line", product_line: "esim" });
    const exact = rule({ id: "r-product", scope: "product", product_id: p.id });

    const chosen = resolveRule({ productId: p.id, productLine: p.product_line, rules: [global, line, exact], at });
    expect(chosen?.id).toBe("r-product");

    const lineOnly = resolveRule({ productId: p.id, productLine: p.product_line, rules: [global, line], at });
    expect(lineOnly?.id).toBe("r-line");
  });

  it("breaks a same-scope tie on the lower priority number", () => {
    const later = rule({ id: "r-late", priority: 200 });
    const earlier = rule({ id: "r-early", priority: 50 });
    expect(resolveRule({ productId: p.id, productLine: p.product_line, rules: [later, earlier], at })?.id).toBe("r-early");
  });

  it("ignores an inactive rule", () => {
    expect(resolveRule({ productId: p.id, productLine: p.product_line, rules: [rule({ is_active: false })], at })).toBeNull();
  });

  it("ignores a rule that has not started yet", () => {
    const future = rule({ effective_from: "2027-01-01T00:00:00Z" });
    expect(resolveRule({ productId: p.id, productLine: p.product_line, rules: [future], at })).toBeNull();
  });

  it("ignores a rule that has expired", () => {
    const expired = rule({ effective_from: "2025-01-01T00:00:00Z", effective_to: "2026-01-01T00:00:00Z" });
    expect(resolveRule({ productId: p.id, productLine: p.product_line, rules: [expired], at })).toBeNull();
  });

  it("does not apply a product rule to a different product", () => {
    const other = rule({ scope: "product", product_id: "33333333-3333-4333-8333-333333333333" });
    expect(resolveRule({ productId: p.id, productLine: p.product_line, rules: [other], at })).toBeNull();
  });
});

// --- price computation ------------------------------------------------------

describe("computePrice", () => {
  it("applies a percentage margin: cost 4000 + 10% -> 4400", () => {
    const result = computePrice({ product: product(), rules: [rule({ margin_percentage: 10 })] });
    expect(result.customerPriceMinor).toBe(440_000n);
    expect(result.supplierCostMinor).toBe(400_000n);
    expect(result.marginMinor).toBe(40_000n);
  });

  it("applies a fixed margin", () => {
    const result = computePrice({
      product: product(),
      rules: [rule({ margin_type: "fixed", margin_percentage: null, margin_fixed_minor: 125_000 })],
    });
    expect(result.customerPriceMinor).toBe(525_000n);
  });

  it("applies a percentage plus fixed margin", () => {
    const result = computePrice({
      product: product(),
      rules: [
        rule({ margin_type: "percentage_plus_fixed", margin_percentage: 10, margin_fixed_minor: 5_000 }),
      ],
    });
    expect(result.customerPriceMinor).toBe(445_000n);
  });

  it("charges the base price when no rule applies", () => {
    const result = computePrice({ product: product(), rules: [] });
    expect(result.customerPriceMinor).toBe(500_000n);
    expect(result.ruleId).toBeNull();
  });

  it("applies a percentage rule as an ADDITIVE margin: 4000 + 10% -> 4400", () => {
    // The margin is a markup on cost, not a fraction of the final price.
    const result = computePrice({ product: product(), rules: [rule({ margin_percentage: 10 })] });
    expect(result.customerPriceMinor).toBe(440_000n);
    expect(result.marginBasisPoints).toBe(1000);
  });

  it("ALWAYS satisfies margin = price - cost, which the database enforces", () => {
    const cases: PricingRule[] = [
      rule({ margin_percentage: 7.77 }),
      rule({ margin_type: "fixed", margin_percentage: null, margin_fixed_minor: 33_333 }),
      rule({ margin_percentage: 12.5, rounding: "nearest_100" }),
      rule({ margin_percentage: 12.5, rounding: "charm_99" }),
      rule({ margin_percentage: 30, min_price_minor: 900_000 }),
      rule({ margin_percentage: 300, max_price_minor: 600_000 }),
    ];
    for (const r of cases) {
      const result = computePrice({ product: product(), rules: [r] });
      expect(result.marginMinor).toBe(result.customerPriceMinor - result.supplierCostMinor);
    }
  });

  it("converts a foreign supplier cost with the rule fx rate", () => {
    const p = product({ supplier_currency: "USD", supplier_cost_minor: 250, currency: "NGN" });
    // USD 2.50 at 1600 NGN per USD = NGN 4,000.00 = 400000 minor
    const result = computePrice({ product: p, rules: [rule({ fx_rate: 1600, margin_percentage: 10 })] });
    expect(result.supplierCostMinor).toBe(400_000n);
    expect(result.customerPriceMinor).toBe(440_000n);
  });

  it("charges base_price_minor only when NO rule resolves", () => {
    const result = computePrice({ product: product(), rules: [] });
    expect(result.customerPriceMinor).toBe(500_000n);
    expect(result.decidedBy).toBe("base_price_no_rule");
  });

  it("does NOT let base_price_minor override a rule's result", () => {
    // Regression: an earlier version treated base_price_minor as a floor, so a rule
    // yielding less than the base price (4400 < 5000) was silently replaced by the base
    // price and every percentage rule was inert. The rule owns the price when it applies.
    const p = product({ base_price_minor: 500_000 });
    const result = computePrice({ product: p, rules: [rule({ margin_percentage: 10 })] });
    expect(result.customerPriceMinor).toBe(440_000n);
    expect(result.customerPriceMinor).not.toBe(500_000n);
    expect(result.decidedBy).toBe("margin");
  });

  it("uses a rule's own min_price_minor when a real floor is wanted", () => {
    const p = product({ base_price_minor: 500_000 });
    const result = computePrice({ product: p, rules: [rule({ margin_percentage: 10, min_price_minor: 500_000 })] });
    expect(result.customerPriceMinor).toBe(500_000n);
    expect(result.decidedBy).toBe("rule_min_floor");
  });

  it("clamps up to the rule minimum", () => {
    const result = computePrice({ product: product(), rules: [rule({ margin_percentage: 1, min_price_minor: 700_000 })] });
    expect(result.customerPriceMinor).toBe(700_000n);
    expect(result.decidedBy).toBe("rule_min_floor");
  });

  it("clamps down to the rule maximum", () => {
    const result = computePrice({ product: product(), rules: [rule({ margin_percentage: 500, max_price_minor: 600_000 })] });
    expect(result.customerPriceMinor).toBe(600_000n);
    expect(result.decidedBy).toBe("rule_max_ceiling");
  });

  it("records which step decided the price", () => {
    // 400000 + 12345 = 412345, which nearest_100 moves to 412300 - so rounding is the
    // step that decided the number. A case where rounding is a no-op must NOT be
    // reported as the deciding step, which is asserted separately below.
    const result = computePrice({
      product: product(),
      rules: [rule({ margin_type: "fixed", margin_percentage: null, margin_fixed_minor: 12_345, rounding: "nearest_100" })],
    });
    expect(result.customerPriceMinor).toBe(412_300n);
    expect(result.decidedBy).toBe("rounding");
    expect(result.roundingApplied).toBe("nearest_100");
  });

  it("does NOT credit rounding when rounding changed nothing", () => {
    // 12.5% of 400000 is exactly 450000, already a multiple of 100: the margin decided.
    const result = computePrice({ product: product(), rules: [rule({ margin_percentage: 12.5, rounding: "nearest_100" })] });
    expect(result.customerPriceMinor).toBe(450_000n);
    expect(result.decidedBy).toBe("margin");
  });

  it("REFUSES to price below cost rather than quoting a loss", () => {
    const p = product({ base_price_minor: 400_000, supplier_cost_minor: 400_000 });
    // A maximum ceiling below cost is a misconfiguration. It must fail loudly.
    const bad = rule({ margin_percentage: 10, max_price_minor: 100_000 });
    expect(() => computePrice({ product: p, rules: [bad] })).toThrow(PricingError);
    expect(() => computePrice({ product: p, rules: [bad] })).toThrow(/below cost/);
  });

  it("refuses to price a product that is not active", () => {
    expect(() => computePrice({ product: product({ status: "draft" }), rules: [] })).toThrow(/not on sale/);
    expect(() => computePrice({ product: product({ status: "archived" }), rules: [] })).toThrow(/not on sale/);
  });

  it("refuses an invalid fx rate instead of silently treating it as 1", () => {
    const p = product({ supplier_currency: "USD" });
    expect(() => computePrice({ product: p, rules: [rule({ fx_rate: 0 })] })).toThrow(/fx_rate/);
  });
});

// --- order validation -------------------------------------------------------

describe("validateOrder", () => {
  const p = product();
  const productsById = new Map([[p.id, p]]);
  const rules = [rule({ margin_percentage: 10 })];

  it("computes the order from the database, not from the request", () => {
    const result = validateOrder({
      lines: [{ productId: p.id, quantity: 2 }],
      productsById,
      rules,
    });
    expect(result.currency).toBe("NGN");
    expect(result.lines[0]?.unitPriceMinor).toBe(440_000n);
    expect(result.lines[0]?.lineTotalMinor).toBe(880_000n);
    expect(result.subtotalMinor).toBe(880_000n);
  });

  it("IGNORES a tampered client price and flags the mismatch", () => {
    const result = validateOrder({
      lines: [{ productId: p.id, quantity: 1, clientUnitPriceMinor: 1 }], // NGN 0.01
      productsById,
      rules,
    });
    // The real price is charged even though the client asked for one kobo.
    expect(result.lines[0]?.unitPriceMinor).toBe(440_000n);
    expect(result.lines[0]?.clientPriceMismatch).toBe(true);
    expect(result.priceMismatches).toBe(1);
  });

  it("treats a matching client price as no signal at all", () => {
    const result = validateOrder({
      lines: [{ productId: p.id, quantity: 1, clientUnitPriceMinor: 440_000 }],
      productsById,
      rules,
    });
    expect(result.priceMismatches).toBe(0);
    expect(result.lines[0]?.clientPriceMismatch).toBe(false);
  });

  it("survives a client price that is not even a number", () => {
    const result = validateOrder({
      lines: [{ productId: p.id, quantity: 1, clientUnitPriceMinor: "DROP TABLE orders" }],
      productsById,
      rules,
    });
    expect(result.lines[0]?.unitPriceMinor).toBe(440_000n);
  });

  it("rejects an empty basket", () => {
    expect(() => validateOrder({ lines: [], productsById, rules })).toThrow(/at least one line/);
  });

  it("rejects an unknown product id", () => {
    expect(() =>
      validateOrder({ lines: [{ productId: "99999999-9999-4999-8999-999999999999", quantity: 1 }], productsById, rules }),
    ).toThrow(/no product exists/);
  });

  it("rejects a zero, negative, fractional or excessive quantity", () => {
    for (const q of [0, -1, 1.5, 101]) {
      expect(() => validateOrder({ lines: [{ productId: p.id, quantity: q }], productsById, rules })).toThrow(
        /whole number between 1 and 100/,
      );
    }
  });

  it("rejects the same product sent twice as separate lines", () => {
    expect(() =>
      validateOrder({
        lines: [
          { productId: p.id, quantity: 1 },
          { productId: p.id, quantity: 1 },
        ],
        productsById,
        rules,
      }),
    ).toThrow(/more than once/);
  });

  it("rejects a basket that mixes currencies rather than adding them up", () => {
    const usd = product({
      id: "44444444-4444-4444-8444-444444444444",
      sku: "GC-US-25",
      product_line: "gift_card",
      currency: "USD",
      base_price_minor: 2_500,
      supplier_cost_minor: 2_000,
      supplier_currency: "USD",
    });
    const mixed = new Map([
      [p.id, p],
      [usd.id, usd],
    ]);
    expect(() =>
      validateOrder({
        lines: [
          { productId: p.id, quantity: 1 },
          { productId: usd.id, quantity: 1 },
        ],
        productsById: mixed,
        rules,
      }),
    ).toThrow(/different currencies/);
  });
});
