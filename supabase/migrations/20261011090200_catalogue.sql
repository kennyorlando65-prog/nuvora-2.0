-- =============================================================================
-- NUVORA 2.0  |  20261011090200  |  Catalogue, supplier cost and margin rules
--
-- Three ideas are separated here on purpose:
--
--   products       what we sell, and what it costs US to buy (never shown to a buyer)
--   pricing_rules  HOW a cost becomes a customer price
--   product_prices the RESULT of applying a rule, snapshotted so that an order can
--                  point at the exact price it was charged
--
-- Keeping them apart is what makes a price change auditable: the rule is edited, a
-- new price row is produced, and historic orders still reference the old row.
--
-- HIDDEN COST: supplier_cost_minor, supplier_currency, supplier_reference and the
-- margin amount are commercially sensitive. Table-level RLS cannot hide a COLUMN, so
-- access to those columns is controlled separately with column-level grants in
-- 20261011090600_rls_and_grants.sql. Do not add a new sensitive column without
-- adding it to that file's revoke list.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- suppliers: configuration for each adapter in lib/providers, not product data.
-- No rows are seeded by any migration; supplier credentials live in environment
-- variables, never in the database.
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id                uuid primary key default gen_random_uuid(),
  key               citext not null unique,          -- matches provider adapter key
  name              text not null,
  adapter           text not null,                   -- e.g. 'esim-sandbox'
  mode              public.supplier_mode not null default 'sandbox',
  is_active         boolean not null default false,
  supported_lines   public.product_line[] not null default '{}',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint suppliers_key_format check (key ~ '^[a-z0-9][a-z0-9-]*$')
);

comment on table public.suppliers is
  'Supplier adapter configuration. Credentials stay in env vars, never in this table.';

create trigger suppliers_touch_updated_at
  before update on public.suppliers
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  sku                 citext not null unique,
  slug                citext not null unique,
  name                text not null,
  product_line        public.product_line not null,
  description         text,

  -- Plan specifics that differ per line: data volume and validity for eSIM, the
  -- platform for a game credit, the brand for a gift card. Kept as jsonb because
  -- the shape genuinely differs by line and a rigid column set would be mostly NULL.
  attributes          jsonb not null default '{}'::jsonb,
  coverage_regions    text[] not null default '{}',   -- ISO-3166 alpha-2, or 'GLOBAL'

  fulfilment_mode     public.fulfilment_mode not null default 'instant_code',
  status              public.product_status not null default 'draft',

  -- Customer-facing target price in minor units. A margin rule may adjust it.
  currency            text not null default 'NGN',
  base_price_minor    bigint not null,

  -- HIDDEN. Our cost from the supplier, and which supplier SKU it maps to.
  supplier_key        citext not null,
  supplier_reference  text,
  supplier_cost_minor bigint not null,
  supplier_currency   text not null default 'NGN',

  created_by          uuid,
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint products_base_price_non_negative  check (base_price_minor >= 0),
  constraint products_cost_non_negative        check (supplier_cost_minor >= 0),
  -- Selling below cost is a pricing bug, not a business decision to be discovered
  -- in a bank statement later.
  constraint products_never_sell_below_cost    check (supplier_cost_minor <= base_price_minor),
  constraint products_currency_format          check (currency ~ '^[A-Z]{3}$'),
  constraint products_supplier_currency_format check (supplier_currency ~ '^[A-Z]{3}$'),
  constraint products_sku_format               check (sku ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  constraint products_slug_format              check (slug ~ '^[a-z0-9][a-z0-9-]*$')
);

comment on table public.products is
  'Digital goods for sale. supplier_cost_minor is commercially sensitive and is hidden by column-level grants.';
comment on column public.products.supplier_cost_minor is
  'HIDDEN FROM BUYERS. Our purchase cost. Expose only to service_role and admins.';
comment on column public.products.base_price_minor is
  'Customer price floor in minor units, before any margin rule is applied.';

create index products_line_status_idx on public.products (product_line, status);
create index products_coverage_idx     on public.products using gin (coverage_regions);
create index products_attributes_idx   on public.products using gin (attributes jsonb_path_ops);

create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- pricing_rules: how supplier cost becomes a customer price.
--
-- Resolution order at checkout is most-specific-first: a rule naming the product
-- beats a rule naming the product line, which beats the global rule. Among rules of
-- the same specificity the lowest `priority` number wins.
-- -----------------------------------------------------------------------------
create table public.pricing_rules (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,

  -- Scope. Exactly one of these shapes is valid, enforced by pricing_rules_scope_shape.
  scope               text not null default 'global',
  product_line        public.product_line,
  product_id          uuid references public.products(id) on delete cascade,

  margin_type         public.margin_type not null,
  margin_percentage   numeric(7,4),                    -- 12.5000 means 12.5 %
  margin_fixed_minor  bigint not null default 0,

  -- Applied after the margin so the customer never sees an awkward figure.
  rounding            public.rounding_mode not null default 'none',

  -- Guard rails. A breached floor or ceiling fails the quote rather than silently
  -- selling at a price nobody approved.
  min_price_minor     bigint,
  max_price_minor     bigint,

  -- Applied when supplier cost and customer price are in different currencies.
  fx_rate             numeric(18,8) not null default 1,
  fx_note             text,

  priority            integer not null default 100,
  is_active           boolean not null default true,
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,

  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint pricing_rules_scope_valid check (scope in ('global', 'product_line', 'product')),
  constraint pricing_rules_scope_shape check (
    (scope = 'global'       and product_line is null and product_id is null) or
    (scope = 'product_line' and product_line is not null and product_id is null) or
    (scope = 'product'      and product_id is not null)
  ),
  constraint pricing_rules_margin_shape check (
    (margin_type = 'percentage'            and margin_percentage is not null) or
    (margin_type = 'fixed'                 and margin_percentage is null) or
    (margin_type = 'percentage_plus_fixed' and margin_percentage is not null)
  ),
  constraint pricing_rules_percentage_sane check (
    margin_percentage is null or (margin_percentage >= 0 and margin_percentage <= 1000)
  ),
  constraint pricing_rules_fixed_non_negative check (margin_fixed_minor >= 0),
  constraint pricing_rules_fx_positive        check (fx_rate > 0),
  constraint pricing_rules_floor_non_negative check (min_price_minor is null or min_price_minor >= 0),
  constraint pricing_rules_ceiling_above_floor check (
    max_price_minor is null or min_price_minor is null or max_price_minor >= min_price_minor
  ),
  constraint pricing_rules_window_valid check (
    effective_to is null or effective_to > effective_from
  )
);

comment on table public.pricing_rules is
  'Margin rules. Never exposed to buyers: knowing our margin is knowing our cost.';

-- At most one live rule per specificity slot, so checkout can never be ambiguous.
create unique index pricing_rules_one_global_live
  on public.pricing_rules ((scope))
  where scope = 'global' and is_active;

create unique index pricing_rules_one_line_live
  on public.pricing_rules (product_line)
  where scope = 'product_line' and is_active;

create unique index pricing_rules_one_product_live
  on public.pricing_rules (product_id)
  where scope = 'product' and is_active;

create index pricing_rules_active_idx on public.pricing_rules (is_active, priority);

create trigger pricing_rules_touch_updated_at
  before update on public.pricing_rules
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- product_prices: an immutable snapshot of a computed price.
--
-- The pricing engine writes one row per computation, closes the previous row by
-- setting valid_to, and checkout copies the figures onto the order. An order can
-- therefore always answer "which rule produced this price, and when".
-- Rows are never updated in place except to close them: price history is evidence.
-- -----------------------------------------------------------------------------
create table public.product_prices (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products(id) on delete cascade,
  currency              text not null,

  -- Snapshot of the inputs, frozen at computation time so a later cost change
  -- cannot retroactively alter what a past order was charged.
  supplier_cost_minor   bigint not null,   -- HIDDEN
  margin_minor          bigint not null,   -- HIDDEN
  customer_price_minor  bigint not null,   -- public

  rule_id               uuid references public.pricing_rules(id) on delete set null,
  fx_rate_used          numeric(18,8) not null default 1,
  engine_version        text not null,

  computed_at           timestamptz not null default now(),
  valid_from            timestamptz not null default now(),
  valid_to              timestamptz,

  constraint product_prices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint product_prices_cost_non_negative     check (supplier_cost_minor >= 0),
  constraint product_prices_price_non_negative    check (customer_price_minor >= 0),
  -- The margin is derived, so it must equal what the arithmetic actually produces.
  constraint product_prices_margin_consistent
    check (margin_minor = customer_price_minor - supplier_cost_minor),
  constraint product_prices_window_valid check (valid_to is null or valid_to > valid_from)
);

comment on table public.product_prices is
  'Computed customer prices with a frozen cost/margin snapshot. Current price is the row with valid_to IS NULL.';
comment on column public.product_prices.margin_minor is
  'HIDDEN FROM BUYERS. Customer price minus our cost. Reveals supplier cost by subtraction.';

-- Exactly one current price per product and currency.
create unique index product_prices_one_current
  on public.product_prices (product_id, currency)
  where valid_to is null;

create index product_prices_product_idx on public.product_prices (product_id, computed_at desc);
