-- =============================================================================
-- NUVORA 2.0  |  20261011091100  |  Supplier webhook receiver
--
-- Before this migration the store had no way to receive anything FROM a supplier.
-- Fulfilment was outbound only: we called the supplier and waited. That is enough for an
-- eSIM that activates in two seconds and not enough for anything asynchronous - a gift
-- card that is issued a minute later, a top-up the carrier confirms later, a delivery the
-- supplier can only report by calling us back.
--
-- This table is the supplier-side counterpart to webhook_events, which is the
-- GATEWAY-side ledger. They are deliberately separate tables rather than one with a type
-- column: the two have different authenticity schemes, different replay semantics and
-- different failure handling, and merging them would mean every query filtering by kind
-- and every constraint reasoning about both.
--
-- STRICTLY APPEND-ONLY FROM THE APPLICATION. Nothing here writes a delivery; a callback
-- creates a row and the row drives the same fulfilOrderLines() path an outbound call
-- takes. A supplier callback must not be able to set order_items.delivery_payload
-- directly, or the guarantee that a payload came from a verified call would be a
-- convention rather than a property.
-- =============================================================================

create table public.supplier_webhook_events (
  id                bigserial primary key,

  -- Which provider row this arrived for, resolved from the URL path. FK rather than a
  -- free-text key because an event attributed to a provider that does not exist cannot
  -- be investigated.
  provider_key      citext not null references public.suppliers(key) on delete cascade,
  provider_mode     public.supplier_mode not null,

  -- The supplier's own id for this callback. Enforces at-most-once processing below.
  event_id          text not null,
  event_type        text,

  -- Whether the signature checked out. Recorded even when false, because a run of
  -- invalid signatures is an incident worth being able to see, not noise to discard.
  signature_valid   boolean not null,
  signature_scheme  public.webhook_signature_scheme not null,

  payload           jsonb not null,
  -- Parts of the payload identifying which delivery this concerns, extracted at receipt
  -- so the processing query does not have to parse JSON per row.
  supplier_reference text,

  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  processing_error  text,

  -- Mirrors the lifecycle rule established for gateway webhook_events: an event may be
  -- freshly received (neither column), processed, or failed - never both processed and
  -- errored. A row claiming both would make "did this callback do its job" unanswerable.
  constraint supplier_webhook_events_processed_consistent
    check (not (processed_at is not null and processing_error is not null))
);

comment on table public.supplier_webhook_events is
  'Append-only ledger of inbound supplier callbacks. Row presence drives fulfilment; a callback never writes a delivery directly.';
comment on column public.supplier_webhook_events.signature_valid is
  'False rows are retained deliberately: a pattern of bad signatures is an incident signal.';
comment on column public.supplier_webhook_events.supplier_reference is
  'Identifier extracted from the payload so processing does not re-parse JSON per row.';

-- At most one row per supplier event. This is what makes a supplier's retry idempotent:
-- the insert is refused, the receiver answers 200, and the supplier stops retrying
-- rather than us processing the same activation twice.
create unique index supplier_webhook_events_provider_event_idx
  on public.supplier_webhook_events (provider_key, event_id);

-- The sweep that reprocesses failed callbacks reads this, not the whole table.
create index supplier_webhook_events_pending_idx
  on public.supplier_webhook_events (received_at)
  where processed_at is null;

create index supplier_webhook_events_reference_idx
  on public.supplier_webhook_events (supplier_reference)
  where supplier_reference is not null;

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- No client role may read this table at all, and admins are not excepted. A supplier
-- callback carries the supplier's own identifiers and can carry delivery payloads; it is
-- raw integration material, and the surface that needs it is the fulfilment ledger,
-- which admins already read. Granting an admin session SELECT here would put supplier
-- identifiers into a browser for no operational gain.
-- -----------------------------------------------------------------------------
alter table public.supplier_webhook_events enable row level security;

revoke all on table public.supplier_webhook_events from anon, authenticated;
grant all on table public.supplier_webhook_events to service_role;

revoke all on sequence public.supplier_webhook_events_id_seq from anon, authenticated;
grant usage on sequence public.supplier_webhook_events_id_seq to service_role;

-- -----------------------------------------------------------------------------
-- Every active provider must have a reachable callback path
--
-- If webhook_signature_scheme says a signature is expected but no path is configured,
-- the supplier has nowhere to send it and the delivery depends on the customer's app
-- polling. Not fatal, so this is NOT a check constraint - a provider that intentionally
-- relies on getStatus() polling is legitimate. It is surfaced in the admin completeness
-- panel instead, which is where an operator decides whether the gap matters.
-- -----------------------------------------------------------------------------

-- A provider that will RECEIVE callbacks must have a secret to verify them with, unless
-- it declares 'none'. This one IS a constraint, because an unsigned callback that can
-- mark an order fulfilled is an open door: anybody who guesses the URL could deliver or
-- cancel goods.
alter table public.suppliers
  add constraint suppliers_callback_requires_secret check (
    webhook_path is null
    or webhook_signature_scheme = 'none'
    or webhook_secret_ciphertext is not null
  );

comment on constraint suppliers_callback_requires_secret on public.suppliers is
  'A provider accepting signed callbacks must store the verification secret; otherwise the receiver would have nothing to verify against.';

-- -----------------------------------------------------------------------------
-- Fulfilment retry ceiling
--
-- Read by the fulfilment service to decide when an operator must intervene by hand.
-- Seeded here rather than hardcoded so it can be tuned without a deploy, but it already
-- exists in 20261011090900 and is re-asserted only to survive a fresh install ordering
-- where that seed is absent.
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, value_type, label, description, is_public)
values (
  'operations.fulfilment_retry_backoff_seconds',
  to_jsonb(60),
  'number',
  'Fulfilment retry backoff (seconds)',
  'Minimum gap between automatic attempts at one line, so a broken supplier is not hammered.',
  false
)
on conflict (key) do nothing;
