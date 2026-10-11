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

  provider_key      citext not null references public.suppliers(key) on delete cascade,
  provider_mode     public.supplier_mode not null,

  event_id          text not null,
  event_type        text,

  signature_valid   boolean not null,
  signature_scheme  public.webhook_signature_scheme not null,

  payload           jsonb not null,
  supplier_reference text,

  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  processing_error  text,

  constraint supplier_webhook_events_processed_consistent
    check (not (processed_at is not null and processing_error is not null))
);

comment on table public.supplier_webhook_events is
  'Append-only ledger of inbound supplier callbacks. Row presence drives fulfilment; a callback never writes a delivery directly.';
comment on column public.supplier_webhook_events.signature_valid is
  'False rows are retained deliberately: a pattern of bad signatures is an incident signal.';
comment on column public.supplier_webhook_events.supplier_reference is
  'Identifier extracted from the payload so processing does not re-parse JSON per row.';

create unique index supplier_webhook_events_provider_event_idx
  on public.supplier_webhook_events (provider_key, event_id);

create index supplier_webhook_events_pending_idx
  on public.supplier_webhook_events (received_at)
  where processed_at is null;

create index supplier_webhook_events_reference_idx
  on public.supplier_webhook_events (supplier_reference)
  where supplier_reference is not null;

alter table public.supplier_webhook_events enable row level security;

revoke all on table public.supplier_webhook_events from anon, authenticated;
grant all on table public.supplier_webhook_events to service_role;

revoke all on sequence public.supplier_webhook_events_id_seq from anon, authenticated;
grant usage on sequence public.supplier_webhook_events_id_seq to service_role;

alter table public.suppliers
  add constraint suppliers_callback_requires_secret check (
    webhook_path is null
    or webhook_signature_scheme = 'none'
    or webhook_secret_ciphertext is not null
  );

comment on constraint suppliers_callback_requires_secret on public.suppliers is
  'A provider accepting signed callbacks must store the verification secret; otherwise the receiver would have nothing to verify against.';

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
