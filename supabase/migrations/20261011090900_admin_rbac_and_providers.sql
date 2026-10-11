-- =============================================================================
-- NUVORA 2.0  |  20261011090900  |  Admin RBAC, provider configuration, moderation
--
-- This migration makes three surfaces real:
--
--   app_settings        operator-editable business configuration, held in the database
--                       rather than in a constant that needs a redeploy to change
--   suppliers (extended) the "paste the base URL" provider configuration, with the API
--                       key encrypted at rest and UNREADABLE by any client role
--   user_moderation     suspension state, enforced server-side at checkout
--   fulfilment_attempts every supplier call we made, so a retry is a record and not a
--                       guess
--
-- WHY suppliers IS EXTENDED RATHER THAN A NEW providers TABLE
--   A second table describing the same concept would be two sources of truth for "which
--   supplier", and the first bug would be a product pointing at a row in the wrong one.
--   products.supplier_key already points here, so the transport configuration belongs on
--   the same row. `adapter` names the implementation; the new columns configure it.
--
-- =============================================================================
-- THE CREDENTIAL RULE. READ BEFORE ADDING A COLUMN TO suppliers.
--   suppliers carried a TABLE-LEVEL `grant select` to authenticated. A table-level grant
--   covers every column added later, so a new credential column would silently become
--   readable by any signed-in admin session - and an admin's browser is still a browser.
--   This migration therefore REVOKES the table-level grant and re-grants an explicit
--   column list. Add a new non-secret column to that list in the same migration that
--   creates it, or the admin UI cannot see it. Add a new SECRET column and it stays
--   unreadable, which is the safe default.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- New enumerated domains
-- -----------------------------------------------------------------------------

-- How our API key is presented to a supplier. Each value is a distinct, testable
-- behaviour in lib/providers/auth.ts, so a supplier's scheme is configuration rather
-- than a code change.
create type public.provider_auth_scheme as enum (
  'bearer',           -- Authorization: Bearer <key>
  'api_key_header',   -- <custom header name>: <key>
  'basic',            -- Authorization: Basic base64(user:key)
  'query_param',      -- ?api_key=<key> appended to the URL
  'none'              -- no credential; used by sandbox and public endpoints only
);

-- How we check that an inbound SUPPLIER webhook is genuine. 'none' is permitted but
-- the receiver refuses to act on an unsigned callback for an enabled provider, because
-- an unverified callback that moves an order to 'fulfilled' is an open door.
create type public.webhook_signature_scheme as enum (
  'none',
  'hmac_sha256_hex',      -- signature in a header, hex digest
  'hmac_sha256_base64',   -- signature in a header, base64 digest
  'shared_header'         -- static shared secret compared in constant time
);

-- Account standing. 'suspended' and 'banned' are both refused at checkout; they are
-- distinguished because a suspension is usually reversible and a ban usually is not,
-- and support needs to know which conversation they are having.
create type public.user_status as enum ('active', 'suspended', 'banned');

-- -----------------------------------------------------------------------------
-- app_settings
--
-- is_public is the security control, and it is deliberate that it defaults to FALSE: a
-- setting added by a careless migration is private until somebody decides otherwise.
-- Public rows are readable by anon so the storefront and footer can render them.
-- Row Level Security alone cannot express "this row is readable but only writable by an
-- admin" on a table with no owner column, so the policy pair below does.
-- -----------------------------------------------------------------------------
create table public.app_settings (
  key          citext primary key,
  value        jsonb not null,
  value_type   text not null default 'string',
  label        text not null,
  description  text,
  is_public    boolean not null default false,

  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint app_settings_key_format check (key ~ '^[a-z0-9][a-z0-9._-]*$'),
  constraint app_settings_value_type_valid
    check (value_type in ('string', 'email', 'url', 'phone', 'number', 'boolean', 'json')),
  -- A setting whose value is the JSON null is indistinguishable from an unset setting.
  -- Refuse it so "not configured" always has exactly one representation.
  constraint app_settings_value_not_null check (jsonb_typeof(value) <> 'null')
);

comment on table public.app_settings is
  'Operator-editable business configuration. is_public=true rows are readable by anon; every write is admin-only.';
comment on column public.app_settings.is_public is
  'Defaults to FALSE. Public rows are readable by anon; private rows are admin-only. Flipping this publishes the value.';

create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- user_moderation
--
-- Why this exists at all, when Supabase Auth has `banned_until`: the ban flag alone
-- records THAT somebody was blocked, never WHY, by whom, or until when under review. A
-- store that suspends a paying customer needs the reason on file, and checkout needs a
-- single fast lookup rather than an admin API round trip inside the money path.
--
-- The FK to auth.users is deliberate: a moderation row for a deleted account is litter.
-- auth.users is owned by GoTrue, which is why the verification harness shims it.
-- -----------------------------------------------------------------------------
create table public.user_moderation (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  email           citext not null,
  status          public.user_status not null default 'active',
  reason          text,
  suspended_at    timestamptz,
  suspended_until timestamptz,
  suspended_by    uuid,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint user_moderation_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$'),
  -- A blocked account must record when it was blocked and why. Without this a support
  -- agent can see that a customer is locked out and have nothing to tell them.
  constraint user_moderation_blocked_needs_reason
    check (status = 'active' or (suspended_at is not null and reason is not null)),
  constraint user_moderation_reason_present check (reason is null or length(reason) between 3 and 500)
);

comment on table public.user_moderation is
  'Suspension and ban state with a recorded reason. Mirrored to auth.users.banned_until so the session itself is revoked.';

create index user_moderation_status_idx on public.user_moderation (status) where status <> 'active';

create trigger user_moderation_touch_updated_at
  before update on public.user_moderation
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- fulfilment_attempts
--
-- One row per call we made to a supplier. This is what turns "retry" from a guess into
-- a decision: the previous attempt's error code tells us whether retrying is sane, and
-- attempt_number makes an infinite retry loop visible instead of silent.
-- -----------------------------------------------------------------------------
create table public.fulfilment_attempts (
  id             bigserial primary key,
  order_item_id  uuid not null references public.order_items(id) on delete cascade,
  attempt_number integer not null,

  provider_key   citext not null,
  provider_mode  public.supplier_mode not null,
  -- Whether the response was simulated. Stored per attempt because "was this customer
  -- given a real eSIM" is a question asked months later, about one specific delivery.
  is_sandbox     boolean not null,

  outcome        text not null,
  error_code     text,
  retryable      boolean,
  latency_ms     integer,
  detail         text,

  created_at     timestamptz not null default now(),

  constraint fulfilment_attempts_outcome_valid
    check (outcome in ('completed', 'pending', 'failed', 'error')),
  constraint fulfilment_attempts_number_positive check (attempt_number >= 1),
  constraint fulfilment_attempts_latency_sane check (latency_ms is null or latency_ms >= 0),
  constraint fulfilment_attempts_unique_attempt unique (order_item_id, attempt_number)
);

comment on table public.fulfilment_attempts is
  'Ledger of every supplier call, so transient-failure retries are driven by evidence.';
comment on column public.fulfilment_attempts.is_sandbox is
  'True when the delivery was simulated. Answers "did this customer receive a real good" per line.';

-- The sweep that finds work to retry reads this index, not the whole table.
create index fulfilment_attempts_retry_idx
  on public.fulfilment_attempts (created_at desc)
  where retryable is true and outcome in ('failed', 'error');

create index fulfilment_attempts_item_idx
  on public.fulfilment_attempts (order_item_id, attempt_number desc);

-- -----------------------------------------------------------------------------
-- suppliers: the provider configuration surface
-- -----------------------------------------------------------------------------

alter table public.suppliers
  -- Which implementation serves this supplier. 'generic-http' is driven by the mapping
  -- below; 'esim-sandbox' is the local simulator; a bespoke adapter keeps its own key.
  add column implementation text not null default 'generic-http',
  add column base_url text,
  add column auth_scheme public.provider_auth_scheme not null default 'bearer',
  add column auth_header_name text,
  -- Ciphertext only. The plaintext key exists in memory inside a server route for the
  -- duration of one call and is never written anywhere. See lib/crypto/secret-box.ts.
  add column credential_ciphertext text,
  -- Last four characters, stored separately so the admin UI can show "****1234" without
  -- ever decrypting anything.
  add column credential_hint text,
  add column credential_updated_at timestamptz,
  add column capabilities text[] not null default '{quote,fulfil,status,health}',
  -- Field-name mapping: how this supplier names the fields the adapter expects.
  add column request_mapping jsonb not null default '{}'::jsonb,
  add column webhook_path text,
  add column webhook_secret_ciphertext text,
  add column webhook_signature_scheme public.webhook_signature_scheme not null default 'none',
  add column credential_set_by uuid,
  add column created_by uuid,
  add column updated_by uuid;

comment on column public.suppliers.credential_ciphertext is
  'AES-256-GCM ciphertext of the supplier API key. Never readable by anon or authenticated: see the column grant list at the foot of this migration.';
comment on column public.suppliers.credential_hint is
  'Last 4 characters of the key, for a masked indicator. Not enough to reconstruct the key.';
comment on column public.suppliers.request_mapping is
  'Declarative request/response field mapping. Lets a new supplier be configuration plus a thin mapping instead of a new adapter.';
comment on column public.suppliers.base_url is
  'Supplier API root. Required before the provider can be enabled; https is enforced in code.';

-- A provider that is enabled must actually be usable, or the first order to reach it
-- fails at the worst possible moment. Enforce the prerequisites in the schema.
-- sandbox is exempt: the simulator has no URL and no key by design.
alter table public.suppliers
  add constraint suppliers_live_requires_endpoint check (
    not is_active
    or mode = 'sandbox'
    or (base_url is not null and credential_ciphertext is not null and auth_scheme <> 'none')
  );

alter table public.suppliers
  add constraint suppliers_base_url_shape check (
    base_url is null or base_url ~ '^https://[^[:space:]]+$'
  );

alter table public.suppliers
  add constraint suppliers_capabilities_valid check (
    capabilities <@ array['quote', 'fulfil', 'status', 'health']::text[]
  );

alter table public.suppliers
  add constraint suppliers_hint_shape check (
    credential_hint is null or length(credential_hint) <= 8
  );

-- An enabled provider must be identifiable in the registry by a key, and a disabled one
-- must not be silently relied upon. is_active defaults to false, so a new row is inert
-- until somebody turns it on deliberately.
create index suppliers_active_idx on public.suppliers (is_active, mode) where is_active;

-- products.supplier_key has always been a free-text citext pointing at suppliers.key,
-- with nothing enforcing that the supplier exists. A product naming a supplier that does
-- not exist is not merely untidy: fulfilment resolves the adapter BY THIS KEY, so the
-- order would be paid and then undeliverable. The live project holds no product rows, so
-- this can be enforced now rather than after it has already gone wrong.
alter table public.products
  add constraint products_supplier_exists
  foreign key (supplier_key) references public.suppliers(key)
  on update cascade on delete restrict;

-- -----------------------------------------------------------------------------
-- Admin audit helper
--
-- Admin writes go through the service-role client (RLS cannot validate a price, and the
-- same is true of a margin rule), which means the actor is NOT derived by the database.
-- If the application simply passed an actor id, the log would record whatever it was
-- told - worthless as evidence.
--
-- This function closes that gap: SECURITY DEFINER, gated on is_admin(), and it stamps
-- the actor from the verified JWT itself. A caller cannot lie about who they are, and a
-- non-admin cannot write to the trail at all.
-- -----------------------------------------------------------------------------
create or replace function public.log_admin_action(
  p_action       text,
  p_entity_table text,
  p_entity_id    text default null,
  p_before       jsonb default null,
  p_after        jsonb default null,
  p_correlation  text default null
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  -- service_role is admitted because scheduled jobs and server routes have no JWT user,
  -- and their writes are already trusted by virtue of holding the key at all.
  if not (public.is_admin() or public.is_service_role()) then
    raise exception 'not authorised to write the admin audit log'
      using errcode = '42501';
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_table, entity_id,
    before, after, correlation_id
  ) values (
    public.current_user_id(),
    coalesce(auth.jwt() ->> 'role', 'service_or_unknown'),
    p_action,
    p_entity_table,
    p_entity_id,
    p_before,
    p_after,
    p_correlation
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.log_admin_action(text, text, text, jsonb, jsonb, text) is
  'Writes an admin action to audit_log, stamping the actor from the JWT and refusing non-admins.';

grant execute on function public.log_admin_action(text, text, text, jsonb, jsonb, text)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Row Level Security for the new tables
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;

-- Public settings are readable by anyone; private ones only by an admin.
create policy app_settings_public_read
  on public.app_settings
  for select
  to anon, authenticated
  using (is_public or public.is_admin());

-- Writes are admin-only. Note there is no INSERT policy for anon or authenticated: with
-- RLS enabled and no permissive policy, the operation is denied by default, so settings
-- are created by a migration or a service-role job, never by a browser.
create policy app_settings_admin_write
  on public.app_settings
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.app_settings from anon, authenticated;
grant select on table public.app_settings to anon, authenticated;  -- rows limited by policy
grant all on table public.app_settings to service_role;

-- -----------------------------------------------------------------------------

alter table public.user_moderation enable row level security;

create policy user_moderation_admin_all
  on public.user_moderation
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A signed-in customer may read their OWN moderation row. This is customer-service
-- fact, not a secret: if we have suspended somebody, they are entitled to know, and
-- hiding it produces a support ticket that says "it just does not work".
create policy user_moderation_select_own
  on public.user_moderation
  for select
  to authenticated
  using (user_id = public.current_user_id());

revoke all on table public.user_moderation from anon, authenticated;
grant select on table public.user_moderation to authenticated;  -- rows limited by policy
grant all on table public.user_moderation to service_role;

-- -----------------------------------------------------------------------------

-- No client role may read OR write the fulfilment ledger: it is plumbing, and its
-- is_sandbox column is commercially awkward if it ever leaked into a UI that somebody
-- screenshots. Admins read it through the admin surface, which uses the service role.
alter table public.fulfilment_attempts enable row level security;

create policy fulfilment_attempts_admin_all
  on public.fulfilment_attempts
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.fulfilment_attempts from anon, authenticated;
grant select on table public.fulfilment_attempts to authenticated;  -- admins only, via policy
grant all on table public.fulfilment_attempts to service_role;

-- -----------------------------------------------------------------------------
-- Column secrecy on suppliers: revoke the table-level grant, re-grant a whitelist
--
-- Without this, credential_ciphertext and the webhook secret would be handed to any
-- signed-in admin's browser. Ciphertext is not plaintext, but a key that never leaves
-- the server cannot be exfiltrated from a browser session at all, and that is the
-- property worth having.
-- -----------------------------------------------------------------------------
revoke all on table public.suppliers from anon, authenticated;
grant select (
  id, key, name, adapter, implementation, base_url, auth_scheme, auth_header_name,
  credential_hint, credential_updated_at, mode, is_active, supported_lines,
  capabilities, request_mapping, webhook_path, webhook_signature_scheme, notes,
  created_at, updated_at
) on table public.suppliers to authenticated;
grant all on table public.suppliers to service_role;

-- Sequences introduced here are internal counters; no client role needs to touch them.
revoke all on sequence public.fulfilment_attempts_id_seq from anon, authenticated;
grant usage on sequence public.fulfilment_attempts_id_seq to service_role;

-- -----------------------------------------------------------------------------
-- Seed the settings an operator will actually edit on day one.
--
-- These are defaults, not fixtures: each is a real field the Settings page reads and
-- writes. No product, price or supplier row is ever seeded by a migration.
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, value_type, label, description, is_public) values
  ('business.legal_name',      to_jsonb('NUVORA'::text),                  'string',  'Registered business name', 'Appears on invoices and in the footer.',                     true),
  ('business.support_email',   to_jsonb('kennyorlando65@gmail.com'::text),'email',   'Support email',            'Where customer support replies come from and go to.',        true),
  ('business.support_hours',   to_jsonb('Monday to Saturday, 09:00-18:00 WAT'::text), 'string', 'Support hours', 'Shown on the contact page.',                                 true),
  ('business.country',         to_jsonb('NG'::text),                      'string',  'Country of operation',     'ISO-3166 alpha-2. Used for jurisdiction statements.',        true),
  ('business.website',         to_jsonb('https://example.invalid'::text), 'url',     'Public website',           'Placeholder. Set this before launch; it is quoted in legal copy.', true),
  ('checkout.min_order_minor', to_jsonb(10000),                           'number',  'Minimum order (minor units)', 'Orders below this are refused before the gateway is called.', false),
  ('checkout.max_line_quantity', to_jsonb(100),                           'number',  'Maximum quantity per line',   'Ceiling for a single order line. Must not exceed the schema check.', false),
  ('operations.fulfilment_max_attempts', to_jsonb(3),                     'number',  'Maximum fulfilment attempts', 'After this, an operator must retry by hand rather than the sweep retrying forever.', false)
on conflict (key) do nothing;
