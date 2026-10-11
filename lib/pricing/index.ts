/**
 * Server-side pricing engine.
 *
 * Import this ONLY from server code. The browser never decides what an order costs:
 * see lib/pricing/order.ts for the rule that makes that structural rather than a
 * code-review habit.
 */

export {
  applyRounding,
  asMinor,
  assertCurrency,
  assertSameCurrency,
  clamp,
  formatMinor,
  MoneyError,
  mulDivRoundHalfUp,
  percentageOf,
  ROUNDING_MODES,
  type CurrencyCode,
  type Minor,
  type RoundingMode,
} from "./money";

export { computePrice, ENGINE_VERSION, PricingError } from "./engine";
export { resolveRule } from "./rules";
export {
  validateOrder,
  type SubmittedLine,
  type ValidatedLine,
  type ValidatedOrder,
} from "./order";
export type {
  MarginType,
  NumericValue,
  PriceBreakdown,
  PricingProduct,
  PricingRule,
  ProductLine,
  ProductStatus,
  RuleScope,
} from "./types";
