-- =============================================================================
-- NUVORA 2.0  |  20261011090500  |  Audit log
--
-- Every change to an order, a payment, a product or a price is recorded with the
-- actor, the before and after images, and the time. Two reasons this is not optional
-- for a store:
--
--   dispute resolution - a customer says they were charged twice, or that a price
--   changed after they paid. The audit trail is the answer.
--
--   insider accountability - the margin rules are editable, so who edited them, and
--   to what, must be knowable.
--
-- The log is append-only from the application's point of view: no triggers are
-- attached to audit_log itself, and no RLS policy grants INSERT to any client role.
-- =============================================================================

create table public.audit_log (
  id             bigserial primary key,
  occurred_at    timestamptz not null default now(),

  actor_user_id  uuid,
  actor_role     text,           -- authenticated | service_role | anon | unknown
  action         text not null,  -- e.g. 'orders.update', 'payments.insert'

  entity_table   text not null,
  entity_id      text,

  before         jsonb,
  after          jsonb,

  -- Renamed from request_id for clarity: correlates every row written by one server
  -- request, which is what you need when reconstructing a checkout.
  correlation_id text,
  ip_hash        text,
  user_agent     text,

  constraint audit_log_action_present check (length(action) between 3 and 120),
  constraint audit_log_table_present  check (length(entity_table) between 1 and 63)
);

comment on table public.audit_log is
  'Append-only record of every change to orders, payments, products and prices.';
comment on column public.audit_log.ip_hash is
  'Salted hash only. A raw IP address is personal data and is never written here.';

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx   on public.audit_log (entity_table, entity_id, occurred_at desc);
create index audit_log_actor_idx    on public.audit_log (actor_user_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Generic row-change capture
--
-- SECURITY DEFINER so the trigger can write to audit_log regardless of who performed
-- the change. search_path is pinned to defeat search_path hijacking, which is the
-- classic privilege-escalation route through a SECURITY DEFINER function.
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before     jsonb;
  v_after      jsonb;
  v_entity_id  text;
begin
  if tg_op = 'INSERT' then
    v_after     := to_jsonb(new);
    v_entity_id := v_after ->> 'id';
  elsif tg_op = 'UPDATE' then
    v_before    := to_jsonb(old);
    v_after     := to_jsonb(new);
    v_entity_id := v_after ->> 'id';
  else
    v_before    := to_jsonb(old);
    v_entity_id := v_before ->> 'id';
  end if;

  -- Strip anything that must never be duplicated into a long-lived, widely-readable
  -- table. raw_payload holds gateway responses that may embed payer and card hints.
  if v_before is not null then
    v_before := v_before - 'raw_payload';
  end if;
  if v_after is not null then
    v_after := v_after - 'raw_payload';
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_table, entity_id, before, after
  ) values (
    public.current_user_id(),
    coalesce(auth.jwt() ->> 'role', 'service_or_unknown'),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_entity_id,
    v_before,
    v_after
  );

  return null;
end;
$$;

comment on function public.audit_row_change() is
  'AFTER INSERT/UPDATE/DELETE trigger: writes a redacted before/after pair to audit_log.';

-- Attached to the tables whose change history matters commercially.
create trigger orders_audit
  after insert or update or delete on public.orders
  for each row execute function public.audit_row_change();

create trigger order_items_audit
  after insert or update or delete on public.order_items
  for each row execute function public.audit_row_change();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row_change();

create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.audit_row_change();

create trigger product_prices_audit
  after insert or update or delete on public.product_prices
  for each row execute function public.audit_row_change();

create trigger pricing_rules_audit
  after insert or update or delete on public.pricing_rules
  for each row execute function public.audit_row_change();
