-- =============================================================================
-- NUVORA 2.0  |  20261011090600  |  Row Level Security, column secrecy and grants
--
-- This file is the security boundary. Read it before adding any table or column.
--
-- THREE DISTINCT MECHANISMS, because they solve three different problems:
--
--   RLS policies      decide WHICH ROWS a role may touch
--   Column grants     decide WHICH COLUMNS a role may read  (RLS cannot do this)
--   Role grants       decide whether a role may INSERT/UPDATE at all
--
-- THE COMMERCIAL SECRET. The margin and our supplier cost are the business. A buyer
-- who can read supplier_cost_minor and margin_minor knows exactly what we pay, and can
-- derive our markup on every product. Table-level RLS cannot hide a column, so those
-- columns are removed from anon/authenticated with an explicit column-level REVOKE and
-- a narrow column GRANT. If you add a sensitive column, add it to the revoke list in
-- the same migration that adds it - the default grant would otherwise expose it.
--
-- WRITES ARE SERVER-ONLY. anon and authenticated receive no INSERT/UPDATE/DELETE on
-- orders, order_items, payments or webhook_events. Prices and totals are computed by
-- the server from the database and re-validated before payment; a client that could
-- write an order could write its own discount. The service-role key bypasses RLS and
-- is used exclusively inside server routes.
-- =============================================================================

-- =============================================================================
-- products
-- =============================================================================
alter table public.products enable row level security;

-- Shoppers see only what is actually on sale.
create policy products_public_read
  on public.products
  for select
  to anon, authenticated
  using (status = 'active');

create policy products_admin_all
  on public.products
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Column secrecy: buyers may read the product, never our cost.
revoke all on table public.products from anon, authenticated;
grant select (
  id, sku, slug, name, product_line, description, attributes, coverage_regions,
  fulfilment_mode, status, currency, base_price_minor, created_at, updated_at
) on table public.products to anon, authenticated;
grant all on table public.products to service_role;

-- =============================================================================
-- pricing_rules: margin logic. No client role may read this table at all.
-- =============================================================================
alter table public.pricing_rules enable row level security;

create policy pricing_rules_admin_all
  on public.pricing_rules
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.pricing_rules from anon, authenticated;
grant select on table public.pricing_rules to authenticated;   -- policy limits rows to admins
grant all on table public.pricing_rules to service_role;

-- =============================================================================
-- suppliers: adapter configuration and credentials notes. Server-side only.
-- =============================================================================
alter table public.suppliers enable row level security;

create policy suppliers_admin_all
  on public.suppliers
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.suppliers from anon, authenticated;
grant select on table public.suppliers to authenticated;   -- policy limits rows to admins
grant all on table public.suppliers to service_role;

-- =============================================================================
-- product_prices: the current customer price is public, the margin is not.
-- Historic rows are closed with valid_to and become invisible to buyers so that a
-- price change cannot be presented as a price error.
-- =============================================================================
alter table public.product_prices enable row level security;

create policy product_prices_public_read
  on public.product_prices
  for select
  to anon, authenticated
  using (
    valid_to is null
    and exists (
      select 1
      from public.products p
      where p.id = product_prices.product_id
        and p.status = 'active'
    )
  );

create policy product_prices_admin_all
  on public.product_prices
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.product_prices from anon, authenticated;
grant select (
  id, product_id, currency, customer_price_minor, computed_at, valid_from, valid_to
) on table public.product_prices to anon, authenticated;
grant all on table public.product_prices to service_role;

-- =============================================================================
-- orders: a customer may read their own orders, and can never write one.
-- Guests have no account, so an order created without sign-in is reachable only
-- through a server route holding the service-role key - never by direct table read.
-- =============================================================================
alter table public.orders enable row level security;

create policy orders_select_own
  on public.orders
  for select
  to authenticated
  using (user_id = public.current_user_id());

create policy orders_admin_all
  on public.orders
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No INSERT/UPDATE/DELETE policy is created for anon or authenticated: with RLS
-- enabled and no permissive policy, those operations are denied by default.
grant all on table public.orders to service_role;
revoke all on table public.orders from anon, authenticated;
grant select (
  id, order_number, user_id, email, billing_country, status, currency,
  subtotal_minor, discount_minor, tax_minor, total_minor,
  paid_at, fulfilled_at, cancelled_at, refunded_at, created_at, updated_at
) on table public.orders to authenticated;

-- =============================================================================
-- order_items: readable only through an order the customer owns. internal_note and
-- supplier_reference stay server-side; delivery_payload is the customer's property.
-- =============================================================================
alter table public.order_items enable row level security;

create policy order_items_select_own
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.user_id = public.current_user_id()
    )
  );

create policy order_items_admin_all
  on public.order_items
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant all on table public.order_items to service_role;
revoke all on table public.order_items from anon, authenticated;
grant select (
  id, order_id, product_id, price_id, product_name, product_line, product_attributes,
  unit_price_minor, quantity, line_total_minor, fulfilment_status, delivery_payload,
  delivered_at, created_at, updated_at
) on table public.order_items to authenticated;

-- =============================================================================
-- payments: no client role may write, and raw_payload is never readable by a client.
-- =============================================================================
alter table public.payments enable row level security;

create policy payments_select_own
  on public.payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = payments.order_id
        and o.user_id = public.current_user_id()
    )
  );

create policy payments_admin_all
  on public.payments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant all on table public.payments to service_role;
revoke all on table public.payments from anon, authenticated;
grant select (
  id, order_id, provider, provider_reference, status, amount_minor, currency,
  fee_minor, channel, verified_at, created_at, updated_at
) on table public.payments to authenticated;

-- =============================================================================
-- webhook_events: internal plumbing. No client role may read or write it.
-- =============================================================================
alter table public.webhook_events enable row level security;

create policy webhook_events_admin_all
  on public.webhook_events
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.webhook_events from anon, authenticated;
grant select on table public.webhook_events to authenticated;   -- admins only, via policy
grant all on table public.webhook_events to service_role;

-- =============================================================================
-- audit_log: append-only. Admins read, nobody writes through the API.
-- Insert happens exclusively through the SECURITY DEFINER trigger function.
-- =============================================================================
alter table public.audit_log enable row level security;

create policy audit_log_admin_read
  on public.audit_log
  for select
  to authenticated
  using (public.is_admin());

revoke all on table public.audit_log from anon, authenticated;
grant select on table public.audit_log to authenticated;   -- rows restricted to admins
-- No INSERT/UPDATE/DELETE grant or policy for any client role: the trail is immutable
-- from the API's point of view. Even a service-role caller cannot rewrite history
-- through PostgREST because no update grant exists for it either.
revoke update, delete on table public.audit_log from service_role;
grant select, insert on table public.audit_log to service_role;

-- =============================================================================
-- Sequences: deny direct manipulation of the order number counter.
-- =============================================================================
revoke all on sequence public.order_number_seq from anon, authenticated;
grant usage on sequence public.order_number_seq to service_role;
