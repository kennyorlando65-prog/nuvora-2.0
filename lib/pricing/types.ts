/**
 * The shapes the pricing engine consumes.
 *
 * These mirror the database columns from supabase/migrations without importing a
 * generated Supabase type, so the engine stays a pure function of its inputs and can
 * be unit-tested without a database. Numeric columns are typed as
 * `number | string | bigint` because that is honestly what a JSON API may hand back;
 * every value is coerced through asMinor() before it is used.
 */

export type ProductLine =
  | "esim"
  | "topup"
  | "gift_card"
  | "game_credit"
  | "subscription";

export type ProductStatus = "draft" | "active" | "archived";

export type MarginType = "percentage" | "fixed" | "percentage_plus_fixed";

export type RuleScope = "global" | "product_line" | "product";

export type NumericValue = number | string | bigint;

/**
 * The product fields the engine needs. Deliberately excludes description and media.
 *
 * `base_price_minor` is the price charged when NO pricing rule resolves - it is not a
 * floor applied on top of a rule. A rule owns the price whenever it applies, and its own
 * `min_price_minor` is the floor for that case. This distinction was originally
 * ambiguous and the engine implemented the wrong reading, which silently overrode every
 * margin rule; see the clarification migration and the pricing tests.
 */
export type PricingProduct = {
  id: string;
  sku: string;
  name: string;
  product_line: ProductLine;
  status: ProductStatus;
  currency: string;
  /** Charged as-is when no rule resolves. Not a floor over a rule's result. */
  base_price_minor: NumericValue;
  supplier_cost_minor: NumericValue;
  supplier_currency: string;
};

export type PricingRule = {
  id: string;
  name: string;
  scope: RuleScope;
  product_line: ProductLine | null;
  product_id: string | null;
  margin_type: MarginType;
  margin_percentage: NumericValue | null;
  margin_fixed_minor: NumericValue;
  rounding: import("./money").RoundingMode;
  min_price_minor: NumericValue | null;
  max_price_minor: NumericValue | null;
  fx_rate: NumericValue;
  priority: number;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
};

export type PriceBreakdown = {
  /** Unit price the customer is charged. */
  customerPriceMinor: bigint;
  /** Our supplier cost after fx conversion, in the sale currency. HIDDEN from buyers. */
  supplierCostMinor: bigint;
  /** customerPriceMinor - supplierCostMinor. HIDDEN. */
  marginMinor: bigint;
  /** Integer basis points actually used, for auditability (1250 = 12.50 %). */
  marginBasisPoints: number;
  ruleId: string | null;
  ruleName: string | null;
  roundingApplied: import("./money").RoundingMode;
  fxRate: number;
  /** Which pipeline step determined the final number, for support and audit. */
  decidedBy: "margin" | "base_price_no_rule" | "rounding" | "rule_min_floor" | "rule_max_ceiling";
  engineVersion: string;
};
