import { asMinor, assertCurrency, assertSameCurrency, type Minor } from "./money";
import { computePrice, PricingError } from "./engine";
import type { PricingProduct, PricingRule } from "./types";

/**
 * Order validation.
 *
 * THE CENTRAL SECURITY RULE OF THIS STORE: a price that arrived from a browser is never
 * used. This module does not accept a price at all - it accepts a product id and a
 * quantity, looks the product up in the database, and derives every figure itself.
 *
 * When a client does volunteer a price, it is treated as a signal rather than an input:
 * the server price still wins, and the mismatch is surfaced as `clientPriceMismatch` so
 * the checkout route can record it in the audit log. A customer who edits the DOM to
 * change a price gets the real price, and leaves a trail.
 */

export type SubmittedLine = {
  productId: string;
  quantity: number;
  /**
   * Untrusted. Present only so a tampering attempt can be detected and logged. It is
   * never read into a calculation.
   */
  clientUnitPriceMinor?: unknown;
};

export type ValidatedLine = {
  productId: string;
  productName: string;
  productLine: PricingProduct["product_line"];
  quantity: number;
  unitPriceMinor: Minor;
  unitCostMinor: Minor;
  lineTotalMinor: Minor;
  ruleId: string | null;
  engineVersion: string;
  clientPriceMismatch: boolean;
};

export type ValidatedOrder = {
  currency: string;
  lines: ValidatedLine[];
  subtotalMinor: Minor;
  /** Any line where the client volunteered a price that disagrees with the server. */
  priceMismatches: number;
  engineVersion: string;
};

const MAX_QUANTITY = 100;

function normaliseClientPrice(value: unknown): Minor | null {
  if (value === undefined || value === null || value === "") return null;
  try {
    return asMinor(value as number | string, "clientUnitPriceMinor");
  } catch {
    return null;
  }
}

/**
 * Turn submitted lines into a priced, currency-consistent order.
 *
 * Rejects: unknown product ids, non-active products, non-integer or out-of-range
 * quantities, duplicate lines for one product, an empty basket, and a basket that mixes
 * currencies. Every rejection throws PricingError with a stable `code` so the route can
 * map it to a clear message without leaking internals.
 */
export function validateOrder(args: {
  lines: readonly SubmittedLine[];
  productsById: ReadonlyMap<string, PricingProduct>;
  rules: readonly PricingRule[];
  at?: Date;
}): ValidatedOrder {
  if (args.lines.length === 0) {
    throw new PricingError("empty_order", "an order must contain at least one line");
  }

  const seen = new Set<string>();
  for (const line of args.lines) {
    if (seen.has(line.productId)) {
      throw new PricingError(
        "duplicate_line",
        `product ${line.productId} appears more than once; send a single line with quantity`,
      );
    }
    seen.add(line.productId);
  }

  const validated: ValidatedLine[] = [];
  let currency: string | null = null;
  let subtotal: Minor = 0n;
  let mismatches = 0;

  for (const line of args.lines) {
    const product = args.productsById.get(line.productId);
    if (!product) {
      throw new PricingError(
        "unknown_product",
        `no product exists with id ${JSON.stringify(line.productId)}`,
      );
    }

    const quantity = line.quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
      throw new PricingError(
        "invalid_quantity",
        `quantity for ${product.sku} must be a whole number between 1 and ${MAX_QUANTITY}, received ${JSON.stringify(quantity)}`,
      );
    }

    // The engine recomputes from database rows. The submitted price is not an input.
    const breakdown = computePrice({
      product,
      rules: args.rules,
      ...(args.at ? { at: args.at } : {}),
    });

    const lineCurrency = assertCurrency(product.currency);
    if (currency === null) {
      currency = lineCurrency;
    } else {
      assertSameCurrency(currency, lineCurrency);
    }

    const clientPrice = normaliseClientPrice(line.clientUnitPriceMinor);
    const clientPriceMismatch = clientPrice !== null && clientPrice !== breakdown.customerPriceMinor;
    if (clientPriceMismatch) mismatches += 1;

    const lineTotal = breakdown.customerPriceMinor * BigInt(quantity);
    subtotal += lineTotal;

    validated.push({
      productId: product.id,
      productName: product.name,
      productLine: product.product_line,
      quantity,
      unitPriceMinor: breakdown.customerPriceMinor,
      unitCostMinor: breakdown.supplierCostMinor,
      lineTotalMinor: lineTotal,
      ruleId: breakdown.ruleId,
      engineVersion: breakdown.engineVersion,
      clientPriceMismatch,
    });
  }

  return {
    currency: assertCurrency(currency ?? ""),
    lines: validated,
    subtotalMinor: subtotal,
    priceMismatches: mismatches,
    engineVersion: validated[0]?.engineVersion ?? "unknown",
  };
}
