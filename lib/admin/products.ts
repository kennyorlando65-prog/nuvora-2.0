import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { computePrice, type PricingProduct, type PricingRule } from "@/lib/pricing";

/**
 * Catalogue reads and price-snapshot maintenance for the admin surface.
 *
 * WHY PRICE SNAPSHOTS ARE WRITTEN HERE AND NOT LEFT TO CHECKOUT.
 * `product_prices` is what checkout reads to price a line: the current row is the one with
 * `valid_to IS NULL`. A product with no current price row cannot be priced, so publishing
 * one would produce a catalogue entry that fails at the till. Recomputing the snapshot on
 * every catalogue save keeps the two in step, and it is the reason `publish` can refuse to
 * activate a product whose price does not compute.
 *
 * HIDDEN COLUMNS. `products.supplier_cost_minor`, `supplier_currency`, `supplier_reference`,
 * `created_by` and `updated_by` are NOT in the `authenticated` column allow-list, so an
 * admin session cannot read them over PostgREST. Cost and margin are read through the
 * privileged client, exactly as documented in lib/auth/guard.ts, and fail soft when it is
 * unavailable.
 */

export const PRODUCT_PUBLIC_COLUMNS =
  "id, sku, slug, name, product_line, description, attributes, coverage_regions, fulfilment_mode, status, currency, base_price_minor, created_at, updated_at";

/** Cost-side and audit columns, readable only by the service role. */
export const PRODUCT_HIDDEN_COLUMNS =
  "id, supplier_key, supplier_reference, supplier_cost_minor, supplier_currency";

export type ProductCost = {
  supplierKey: string;
  supplierCostMinor: number | null;
  supplierCurrency: string | null;
  supplierReference: string | null;
};

export type ProductCostRead = {
  available: boolean;
  unavailableReason?: string;
  byId: Record<string, ProductCost>;
};

/**
 * Reads the cost side of the catalogue.
 *
 * FAILS SOFT for the same reason as the order detail: a missing service key should degrade
 * one figure on a screen, not take the whole admin area down. A null cost renders as
 * "unavailable" and is never treated as zero, because a zero cost would make every margin
 * look like the full retail price.
 */
export async function readProductCosts(
  privileged: SupabaseClient | null,
  productIds: string[],
): Promise<ProductCostRead> {
  if (!privileged) {
    return { available: false, unavailableReason: "The privileged reader is not configured.", byId: {} };
  }

  if (productIds.length === 0) {
    return { available: true, byId: {} };
  }

  try {
    const { data, error } = await privileged
      .from("products")
      .select(PRODUCT_HIDDEN_COLUMNS)
      .in("id", productIds);

    if (error) {
      return { available: false, unavailableReason: `Privileged read failed: ${error.message}`, byId: {} };
    }

    const byId: Record<string, ProductCost> = {};
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      byId[row.id as string] = {
        supplierKey: (row.supplier_key as string) ?? "",
        supplierCostMinor:
          row.supplier_cost_minor === null || row.supplier_cost_minor === undefined
            ? null
            : Number(row.supplier_cost_minor),
        supplierCurrency: (row.supplier_currency as string | null) ?? null,
        supplierReference: (row.supplier_reference as string | null) ?? null,
      };
    }

    return { available: true, byId };
  } catch (error) {
    return {
      available: false,
      unavailableReason:
        error instanceof Error ? `Privileged read failed: ${error.message}` : "Privileged read failed.",
      byId: {},
    };
  }
}

export type ProductPriceSnapshot = {
  customerPriceMinor: number | null;
  marginMinor: number | null;
  supplierCostMinor: number | null;
  ruleName: string | null;
  engineVersion: string | null;
  computedAt: string | null;
  decidedBy: string | null;
};

export type ProductPriceRead = {
  available: boolean;
  unavailableReason?: string;
  byId: Record<string, ProductPriceSnapshot>;
};

/**
 * Reads the current computed price per product.
 *
 * `customer_price_minor` is publicly readable; `margin_minor` and `supplier_cost_minor` are
 * not, so this uses the privileged client throughout rather than splitting a single row
 * across two clients and risking a half-populated record.
 */
export async function readCurrentPrices(
  privileged: SupabaseClient | null,
  productIds: string[],
): Promise<ProductPriceRead> {
  if (!privileged) {
    return { available: false, unavailableReason: "The privileged reader is not configured.", byId: {} };
  }

  if (productIds.length === 0) return { available: true, byId: {} };

  try {
    const { data, error } = await privileged
      .from("product_prices")
      .select(
        "product_id, customer_price_minor, margin_minor, supplier_cost_minor, engine_version, computed_at, valid_to, pricing_rules(name)",
      )
      .in("product_id", productIds)
      .is("valid_to", null);

    if (error) {
      return { available: false, unavailableReason: `Price read failed: ${error.message}`, byId: {} };
    }

    const byId: Record<string, ProductPriceSnapshot> = {};
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      // The embedded relation comes back as either an object or a one-element array
      // depending on how PostgREST infers the cardinality; both shapes are handled rather
      // than assumed, because guessing wrong silently drops the rule name.
      const relation = row.pricing_rules as { name?: string } | Array<{ name?: string }> | null;
      const ruleName = Array.isArray(relation) ? (relation[0]?.name ?? null) : (relation?.name ?? null);

      byId[row.product_id as string] = {
        customerPriceMinor: Number(row.customer_price_minor),
        marginMinor: Number(row.margin_minor),
        supplierCostMinor: Number(row.supplier_cost_minor),
        ruleName,
        engineVersion: (row.engine_version as string | null) ?? null,
        computedAt: (row.computed_at as string | null) ?? null,
        decidedBy: null,
      };
    }

    return { available: true, byId };
  } catch (error) {
    return {
      available: false,
      unavailableReason: error instanceof Error ? `Price read failed: ${error.message}` : "Price read failed.",
      byId: {},
    };
  }
}

// ---------------------------------------------------------------------------
// Price snapshot recomputation
// ---------------------------------------------------------------------------

export type SnapshotResult =
  | { ok: true; customerPriceMinor: number; marginMinor: number; decidedBy: string; ruleName: string | null }
  | { ok: false; reason: string };

/**
 * Recomputes and stores the current price for one product, using the real pricing engine.
 *
 * This is the same engine checkout uses, invoked with the product and the active rules read
 * from the database - not a reimplementation. That matters: if the admin screen priced
 * products its own way, the shop and the back office would eventually disagree, and the
 * disagreement would be discovered by a customer.
 *
 * Closing the previous row (setting valid_to) before inserting the new one is what preserves
 * price history: an order placed yesterday still points at yesterday's row. The unique index
 * `product_prices_one_current` would otherwise reject the insert, which is the schema
 * enforcing the same rule independently.
 */
export async function recomputePriceSnapshot(
  privileged: SupabaseClient,
  productId: string,
): Promise<SnapshotResult> {
  const { data: product, error: productError } = await privileged
    .from("products")
    .select(
      "id, sku, name, product_line, status, currency, base_price_minor, supplier_cost_minor, supplier_currency",
    )
    .eq("id", productId)
    .maybeSingle();

  if (productError) return { ok: false, reason: `Product read failed: ${productError.message}` };
  if (!product) return { ok: false, reason: "Product not found." };

  const { data: rules, error: rulesError } = await privileged
    .from("pricing_rules")
    .select("*")
    .eq("is_active", true);

  if (rulesError) return { ok: false, reason: `Pricing rules read failed: ${rulesError.message}` };

  let breakdown;
  try {
    breakdown = computePrice({
      product: product as unknown as PricingProduct,
      rules: (rules ?? []) as unknown as PricingRule[],
    });
  } catch (error) {
    // A pricing failure is reported verbatim: the engine's messages name the constraint
    // that was breached (a floor, a ceiling), which is exactly what an operator needs.
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The pricing engine refused this product.",
    };
  }

  const currency = product.currency as string;

  const { error: closeError } = await privileged
    .from("product_prices")
    .update({ valid_to: new Date().toISOString() })
    .eq("product_id", productId)
    .is("valid_to", null);

  if (closeError) return { ok: false, reason: `Could not close the previous price: ${closeError.message}` };

  const { error: insertError } = await privileged.from("product_prices").insert({
    product_id: productId,
    currency,
    supplier_cost_minor: Number(breakdown.supplierCostMinor),
    margin_minor: Number(breakdown.marginMinor),
    customer_price_minor: Number(breakdown.customerPriceMinor),
    rule_id: breakdown.ruleId,
    fx_rate_used: breakdown.fxRate,
    engine_version: breakdown.engineVersion,
  });

  if (insertError) return { ok: false, reason: `Could not store the new price: ${insertError.message}` };

  return {
    ok: true,
    customerPriceMinor: Number(breakdown.customerPriceMinor),
    marginMinor: Number(breakdown.marginMinor),
    decidedBy: breakdown.decidedBy,
    ruleName: breakdown.ruleName,
  };
}

// ---------------------------------------------------------------------------
// Input validation (server-side, shared by create and update)
// ---------------------------------------------------------------------------

export type ProductInput = {
  sku: string;
  slug: string;
  name: string;
  productLine: string;
  description: string | null;
  fulfilmentMode: string;
  status: string;
  currency: string;
  basePriceMinor: number;
  supplierKey: string;
  supplierReference: string | null;
  supplierCostMinor: number;
  supplierCurrency: string;
  coverageRegions: string[];
  attributes: Record<string, unknown>;
};

export type ParseResult =
  | { ok: true; value: ProductInput }
  | { ok: false; error: string };

/**
 * Parses money typed by a human into minor units WITHOUT EVER USING A FLOAT.
 *
 * `Math.round(parseFloat("10.10") * 100)` is the classic way to be off by a kobo: 10.10 has
 * no exact binary representation, and the product lands just below the integer. Splitting on
 * the decimal point and padding the fraction as a string is exact for every value a person
 * can type, and the two-decimal limit is enforced rather than rounded away silently.
 */
export function parseMoneyToMinor(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, "").replace(/^[\u20a6$\u20ac\u00a3]\s*/, "");
  if (cleaned === "") return null;

  if (!/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) return null;

  const [whole, fraction = ""] = cleaned.split(".");
  const paddedFraction = (fraction + "00").slice(0, 2);
  const minor = Number(whole) * 100 + Number(paddedFraction);

  return Number.isSafeInteger(minor) ? minor : null;
}

const SKU = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const CURRENCY = /^[A-Z]{3}$/;
const REGION = /^[A-Z]{2}$/;

const PRODUCT_LINES = ["esim", "topup", "gift_card", "game_credit", "subscription"] as const;
const FULFILMENT_MODES = ["instant_code", "instant_esim", "manual"] as const;
const STATUSES = ["draft", "active", "archived"] as const;

function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseProductForm(form: FormData): ParseResult {
  const sku = field(form, "sku");
  const slug = field(form, "slug");
  const name = field(form, "name");
  const productLine = field(form, "product_line");
  const description = field(form, "description");
  const fulfilmentMode = field(form, "fulfilment_mode");
  const status = field(form, "status");
  const currency = field(form, "currency").toUpperCase();
  const supplierKey = field(form, "supplier_key").toLowerCase();
  const supplierReference = field(form, "supplier_reference");
  const supplierCurrency = (field(form, "supplier_currency") || currency).toUpperCase();
  const coverageRaw = field(form, "coverage_regions");
  const attributesRaw = field(form, "attributes");

  if (!name) return { ok: false, error: "name-missing" };
  if (!SKU.test(sku)) return { ok: false, error: "sku-invalid" };
  if (!SLUG.test(slug)) return { ok: false, error: "slug-invalid" };
  if (!PRODUCT_LINES.includes(productLine as (typeof PRODUCT_LINES)[number])) {
    return { ok: false, error: "line-invalid" };
  }
  if (!FULFILMENT_MODES.includes(fulfilmentMode as (typeof FULFILMENT_MODES)[number])) {
    return { ok: false, error: "fulfilment-invalid" };
  }
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    return { ok: false, error: "status-invalid" };
  }
  if (!CURRENCY.test(currency)) return { ok: false, error: "currency-invalid" };
  if (!CURRENCY.test(supplierCurrency)) return { ok: false, error: "supplier-currency-invalid" };
  if (!supplierKey) return { ok: false, error: "supplier-missing" };

  const basePriceMinor = parseMoneyToMinor(field(form, "base_price"));
  if (basePriceMinor === null) return { ok: false, error: "price-invalid" };

  const supplierCostMinor = parseMoneyToMinor(field(form, "supplier_cost"));
  if (supplierCostMinor === null) return { ok: false, error: "cost-invalid" };

  // Mirrors products_never_sell_below_cost. The database refuses this too, but a form that
  // submits a doomed write and reports a constraint name is a worse experience than one
  // that says plainly what is wrong.
  if (supplierCostMinor > basePriceMinor) return { ok: false, error: "below-cost" };

  const coverageRegions = coverageRaw
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== "");

  for (const region of coverageRegions) {
    // GLOBAL is the one non-ISO token the schema comments allow.
    if (region !== "GLOBAL" && !REGION.test(region)) {
      return { ok: false, error: "coverage-invalid" };
    }
  }

  let attributes: Record<string, unknown> = {};
  if (attributesRaw) {
    try {
      const parsed: unknown = JSON.parse(attributesRaw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "attributes-not-object" };
      }
      attributes = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: "attributes-invalid-json" };
    }
  }

  return {
    ok: true,
    value: {
      sku,
      slug,
      name,
      productLine,
      description: description || null,
      fulfilmentMode,
      status,
      currency,
      basePriceMinor,
      supplierKey,
      supplierReference: supplierReference || null,
      supplierCostMinor,
      supplierCurrency,
      coverageRegions,
      attributes,
    },
  };
}

/** Error codes mapped to operator-readable wording. */
export const PRODUCT_ERRORS: Record<string, string> = {
  "name-missing": "A product name is required.",
  "sku-invalid": "SKU must start with a letter or digit and contain only letters, digits, dot, underscore or hyphen.",
  "slug-invalid": "Slug must be lower case and may contain only letters, digits and hyphens.",
  "line-invalid": "Choose a valid product line.",
  "fulfilment-invalid": "Choose a valid fulfilment mode.",
  "status-invalid": "Choose a valid status.",
  "currency-invalid": "Currency must be a three-letter code such as NGN or USD.",
  "supplier-currency-invalid": "Supplier currency must be a three-letter code.",
  "supplier-missing": "Choose the supplier that delivers this product. It must already exist.",
  "price-invalid": "Customer price must be a positive amount with at most two decimal places.",
  "cost-invalid": "Supplier cost must be a positive amount with at most two decimal places.",
  "below-cost": "The customer price is below the supplier cost. That would sell at a loss, and the database refuses it.",
  "coverage-invalid": "Coverage regions must be two-letter ISO codes, or GLOBAL.",
  "attributes-not-object": "Attributes must be a JSON object such as {\"data_gb\": 5}.",
  "attributes-invalid-json": "Attributes is not valid JSON.",
  "duplicate-sku": "That SKU is already in use by another product.",
  "duplicate-slug": "That slug is already in use by another product.",
  "saved-but-unpriced":
    "The product was saved, but its price could not be computed, so it was left unpublished.",
  "not-found": "That product no longer exists.",
  "forbidden": "This account is not permitted to change the catalogue.",
};
