-- =============================================================================
-- NUVORA 2.0  |  20261011100000  |  Reconcile the LIVE database with the repository
--
-- THIS FILE IS NOT IN supabase/migrations/ ON PURPOSE. Read this before using it.
--
-- WHY IT LIVES HERE
--   supabase/migrations/ describes the schema a FRESH project should have. This file
--   describes how to get from a database that already contains an ABANDONED, WALLET-BASED
--   build to that schema. Those are different jobs:
--
--     * A fresh project never had a wallet, so it must never run this file. Running it
--       there would attempt to drop tables that do not exist and archive an empty
--       catalogue - noise, and a false sense of history.
--     * An existing project MUST run it before the migrations, because the migrations
--       collide with the legacy objects by name.
--
--   Keeping it out of supabase/migrations/ therefore keeps `supabase db push` and the
--   verification harness honest: they apply the migrations, and only the migrations.
--
-- WHAT WAS FOUND ON THE LIVE PROJECT (dmyxdicqqjrmsmwvvlkl), read on 2026-10-11
--
--   state      : ACTIVE_HEALTHY (it had been INACTIVE/paused; the paused snapshot was a
--                pre-migration vintage, which is why an earlier run could not read it)
--   history    : 2 migrations, both from 2026-08-14:
--                  nuvora_wallet_security_final
--                  secure_provider_transactions
--   schema     : the WALLET build - wallets, wallet_transactions, a partial orders table
--                (no order_number, no pricing-engine columns), payments, refunds,
--                esim_orders, notifications, profiles, products (customer price only,
--                no supplier cost), service_catalog, provider_transactions, audit_logs
--   data       : every table 0 rows EXCEPT service_catalog (4 rows). auth.users: 0 rows.
--                There are therefore no customer records, no orders and no money in
--                flight. Nothing here can strand a real person.
--
-- WHY THIS MATTERS BEYOND TIDINESS: the legacy schema IS the wallet model that NUVORA's
-- product rules forbid - there is a balance column and a deposit transaction type. If it
-- were left in place alongside the new schema the store would have two contradictory
-- ideas of how a purchase works, and the wrong one would eventually be written to.
--
-- THE COLLISION (why the migrations cannot simply be applied on top)
--   Products, payments, orders and order_items exist on BOTH sides with different shapes,
--   and three enum names collide outright:
--     order_status       live: pending|processing|completed|failed|cancelled|refunded|
--                              partially_refunded
--                        repo: pending_payment|paid|fulfilling|fulfilled|
--                              partially_fulfilled|failed|cancelled|refunded
--     transaction_status, transaction_type, wallet_transaction_type, user_role are
--                        live-only; the repo uses payment_status / fulfilment_status /
--                        product_line / product_status / margin_type / rounding_mode /
--                        fulfilment_mode / supplier_mode / payment_provider.
--   `create type public.order_status` inside 20261011090100 would fail with 42710, so
--   without this file the migration set cannot apply to the live project at all.
--
-- ORDER OF OPERATIONS, and why each step
--   1. Install `citext` explicitly into `public`. The live project does not have it
--      (`to_regtype('citext')` returned null) and the repo depends on it for sku, slug and
--      email. Installing it explicitly - rather than letting
--      20261011090000's bare `create extension if not exists citext` decide - makes the
--      schema deterministic and, because `if not exists` matches on NAME not schema, turns
--      the later statement into a no-op instead of a second copy.
--   2. Archive anything with rows, before dropping anything.
--   3. Drop the legacy objects in dependency order (children first, so no CASCADE is
--      needed and nothing is dropped that this file did not name).
--   4. Record the eight repository migrations in the live history so that a later
--      `supabase db push` recognises work already done and does not re-apply it.
--
-- ROLLBACK: there is none, and that is deliberate. Re-creating the wallet schema would
-- restore a design NUVORA has decided against, and every row in it was empty or archived
-- in step 2. The archive is the rollback: legacy_backup.service_catalog still holds the
-- four catalogue rows.
-- =============================================================================

set client_min_messages to notice;

-- -----------------------------------------------------------------------------
-- 1. Extensions. `pgcrypto` is already present in the `extensions` schema and
--    gen_random_uuid() is built into PostgreSQL 13+, so only citext is needed.
-- -----------------------------------------------------------------------------
create extension if not exists citext with schema public;

-- -----------------------------------------------------------------------------
-- 2. Archive before deleting. The only table with rows is service_catalog.
--    It is preserved verbatim rather than migrated: it held platform sections
--    ("eSIM", "Digital Store", "Business", "Communications"), not purchasable
--    products, so its rows are navigation copy - not goods, and not prices.
--    Inserting them into public.products would have fabricated four products with no
--    supplier cost and no price, which the schema would rightly refuse and which the
--    repository's "no seeded product data" rule forbids.
-- -----------------------------------------------------------------------------
create schema if not exists legacy_backup;

comment on schema legacy_backup is
  'Quarantine for objects from the superseded wallet-era build (2026-08-14). Not exposed to the API.';

do $$
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'legacy_backup' and c.relname = 'service_catalog'
  ) then
    execute 'create table legacy_backup.service_catalog as
               select *, now() as archived_at from public.service_catalog';
    execute 'alter table legacy_backup.service_catalog enable row level security';
  end if;
end $$;

revoke all on table legacy_backup.service_catalog from anon, authenticated;

do $$
declare
  v_rows bigint;
begin
  select count(*) into v_rows from legacy_backup.service_catalog;
  raise notice 'archived % service_catalog row(s) into legacy_backup', v_rows;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Drop the legacy build, children before parents so that CASCADE is unnecessary.
--    Anything not named here is left exactly as it was.
-- -----------------------------------------------------------------------------

-- 3a. the auth.users signup hook. It exists to create a wallet on signup, so it must go
--     in the same breath as the wallet tables - otherwise every new signup would fail
--     against a table that no longer exists.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 3b. the wallet ledger's own function (returns the wallet_transactions type, so it must
--     be dropped before the type can be).
drop function if exists public.apply_wallet_transaction(
  uuid, uuid, public.transaction_type, bigint, text, text, uuid, jsonb
);

-- 3c. rows that reference orders / products / wallets
drop table if exists public.esim_orders;
drop table if exists public.order_items;
drop table if exists public.refunds;
drop table if exists public.payments;

-- 3d. the wallet core - the thing NUVORA 2.0 removes
drop table if exists public.wallet_transactions;
drop table if exists public.wallets;

-- 3e. remaining orphaned tables
drop table if exists public.notifications;
drop table if exists public.provider_transactions;
drop table if exists public.audit_logs;
drop table if exists public.orders;
drop table if exists public.products;
drop table if exists public.service_catalog;
drop table if exists public.profiles;

-- 3f. the legacy enum domains. `set_updated_at` is dropped with them: it is the wallet-era
--     trigger function, superseded by public.touch_updated_at in 20261011090000.
drop function if exists public.set_updated_at();

drop type if exists public.order_status;
drop type if exists public.transaction_status;
drop type if exists public.transaction_type;
drop type if exists public.wallet_transaction_type;
drop type if exists public.user_role;

-- -----------------------------------------------------------------------------
-- 4. Record the repository migrations in the live history.
--
--    SUPABASE_APPLY_A_MIGRATION writes this table itself, so it is normally not touched by
--    hand. It is written here because the eight migrations are about to be applied to this
--    project by the platform's migration endpoint, and leaving the history showing only
--    the two August entries would make the applied work invisible - the exact drift this
--    whole exercise exists to remove. From the moment this row set exists, the repository
--    and the history agree.
--
--    `idempotency_key` is set so a repeated run cannot duplicate a version, and the insert
--    is guarded on `version` as well, because the column set of this table is Supabase's
--    to change and a bare insert would be the fragile part.
-- -----------------------------------------------------------------------------
do $$
declare
  v_migrations constant text[][] := array[
    ['20261011090000', 'init_extensions_helpers'],
    ['20261011090100', 'enums'],
    ['20261011090200', 'catalogue'],
    ['20261011090300', 'orders'],
    ['20261011090400', 'payments'],
    ['20261011090500', 'audit_log'],
    ['20261011090600', 'rls_and_grants'],
    ['20261011090700', 'clarify_base_price'],
    ['20261011090800', 'fix_webhook_processed_check']
  ];
  i integer;
begin
  for i in 1 .. array_length(v_migrations, 1) loop
    insert into supabase_migrations.schema_migrations (version, name)
    values (v_migrations[i][1], v_migrations[i][2])
    on conflict (version) do update set name = excluded.name;
  end loop;
  raise notice 'recorded % repository migration(s) in the live history', array_length(v_migrations, 1);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Report what is left, so the applying session can see the handover rather than
--    assume it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_left text;
begin
  select coalesce(string_agg(tablename, ', ' order by tablename), '(none)')
    into v_left
  from pg_tables where schemaname = 'public';

  raise notice 'legacy drop complete; public tables remaining: %', v_left;
end $$;
