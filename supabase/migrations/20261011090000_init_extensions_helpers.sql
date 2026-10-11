-- =============================================================================
-- NUVORA 2.0  |  20261011090000  |  Base extensions and shared helpers
--
-- Migrations apply in filename order. Everything else depends on this file.
--
-- MONEY CONVENTION (applies to every table in this project)
--   All monetary values are stored as INTEGER MINOR UNITS in a bigint column named
--   *_minor: kobo, cents, pence. No floating point is ever used for money, because
--   0.1 + 0.2 != 0.3 in binary floating point and a store cannot round its way out
--   of that. Divide by 100 only when rendering for display.
--
--   Every amount also carries its own currency code, and no code path may add two
--   amounts before confirming their currencies match.
-- =============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email and slug columns

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'BEFORE UPDATE trigger that stamps updated_at. Attached to every mutable table.';

-- -----------------------------------------------------------------------------
-- Authorisation helpers
--
-- Admin privilege lives in the app_metadata claim and deliberately NOT in
-- user_metadata: a signed-in user can write their own user_metadata, so treating it
-- as a privilege source would let any customer promote themselves to admin.
-- app_metadata can only be written with the service-role key.
-- -----------------------------------------------------------------------------
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'nuvora_role') = 'admin', false);
$$;

create or replace function public.is_service_role()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'role') = 'service_role', false);
$$;

comment on function public.is_admin() is
  'True when the JWT carries app_metadata.nuvora_role = admin. Used by RLS policies.';

grant execute on function public.current_user_id() to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_service_role() to anon, authenticated, service_role;
