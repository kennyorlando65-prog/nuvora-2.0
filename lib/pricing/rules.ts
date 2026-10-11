import type { PricingRule, ProductLine } from "./types";

/**
 * Rule resolution.
 *
 * A rule applies when it is active, inside its effective window, and points at this
 * product or its line. Specificity is the first sort key, so a rule naming the product
 * always beats a rule naming the line, which beats the global rule. Ties break on the
 * lower `priority` number, then on the most recently started rule.
 *
 * The database enforces at most one live rule per specificity slot with partial unique
 * indexes, so in a correctly-migrated project there is no tie to break at all. The
 * ordering here is belt and braces: resolution must stay deterministic even if a rule
 * is created directly with SQL.
 */

const SPECIFICITY: Record<PricingRule["scope"], number> = {
  product: 3,
  product_line: 2,
  global: 1,
};

function targetsProduct(rule: PricingRule, productId: string, productLine: ProductLine): boolean {
  switch (rule.scope) {
    case "product":
      return rule.product_id === productId;
    case "product_line":
      return rule.product_line === productLine;
    case "global":
      return true;
  }
}

function isEffectiveAt(rule: PricingRule, at: Date): boolean {
  if (!rule.is_active) return false;
  const starts = new Date(rule.effective_from).getTime();
  if (Number.isNaN(starts) || starts > at.getTime()) return false;
  if (rule.effective_to !== null) {
    const ends = new Date(rule.effective_to).getTime();
    if (Number.isNaN(ends) || ends <= at.getTime()) return false;
  }
  return true;
}

/**
 * Pick the single rule that governs this product, or null when no rule applies (in
 * which case the product's own base price is charged).
 */
export function resolveRule(args: {
  productId: string;
  productLine: ProductLine;
  rules: readonly PricingRule[];
  at?: Date;
}): PricingRule | null {
  const at = args.at ?? new Date();

  const candidates = args.rules
    .filter((rule) => isEffectiveAt(rule, at))
    .filter((rule) => targetsProduct(rule, args.productId, args.productLine));

  if (candidates.length === 0) return null;

  const ranked = [...candidates].sort((a, b) => {
    const bySpecificity = SPECIFICITY[b.scope] - SPECIFICITY[a.scope];
    if (bySpecificity !== 0) return bySpecificity;

    if (a.priority !== b.priority) return a.priority - b.priority;

    return new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime();
  });

  return ranked[0] ?? null;
}
