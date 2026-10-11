-- =============================================================================
-- NUVORA 2.0  |  20261011090700  |  Clarify base_price_minor semantics
--
-- Documentation-only migration: no schema change, no data change. It exists because an
-- ambiguous column comment caused a real bug in the pricing engine, and clearing up the
-- ambiguity in the schema is cheaper than rediscovering it.
--
-- WHAT WENT WRONG
--   The original comment on products.base_price_minor read "Customer price floor in minor
--   units, before any margin rule is applied", which can be read two ways. The engine
--   implemented the wrong reading: it treated the base price as a FLOOR applied after the
--   margin. With base_price_minor = 500000 and a 10 % margin on a 400000 cost, the
--   computed 440000 was silently raised back to 500000 - so every percentage rule was
--   inert and any catalogue with a base price above its margin result would have charged
--   the base price while appearing to be rule-driven.
--
-- THE RESOLVED SEMANTICS (authoritative)
--
--   A pricing rule that resolves OWNS the price. base_price_minor is only used when no
--   rule resolves at all, as the fallback price. To place a genuine floor beneath a rule,
--   set min_price_minor ON THAT RULE - which is exactly what that column is for.
--
-- The engine was corrected and now reports decidedBy = 'base_price_no_rule' when the
-- fallback is used, so a support query can always tell which path produced a price.
-- =============================================================================

comment on column public.products.base_price_minor is
  'Fallback customer price in minor units, charged ONLY when no pricing rule resolves. This is NOT a floor over a rule result: a resolved rule owns the price. For a floor beneath a rule, set pricing_rules.min_price_minor.';

comment on column public.products.currency is
  'Currency of base_price_minor and of the customer price. Must match the supplier currency or the rule must carry an fx_rate.';

comment on column public.pricing_rules.min_price_minor is
  'Optional floor applied AFTER the margin and rounding. This is where a genuine minimum price belongs - not products.base_price_minor.';

comment on column public.pricing_rules.max_price_minor is
  'Optional ceiling applied AFTER the margin and rounding. A ceiling below supplier cost is rejected by the engine rather than quoting a loss.';
