-- =============================================================================
-- NUVORA 2.0  |  20261011090400  |  Payments and webhook idempotency
--
-- Two rules shape this file:
--
-- 1. A gateway callback is a CLAIM, not a fact. Nothing is marked paid on the say-so
--    of an inbound request. A payment reaches 'succeeded' only after the server has
--    re-verified it against the gateway API using the secret key.
--
-- 2. Gateways retry. The same event WILL arrive more than once, and the same webhook
--    may arrive twice concurrently. Idempotency is therefore enforced in the schema,
--    not in application code: a unique constraint is the only thing that holds under
--    a race.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- payments: one row per payment attempt against an order.
-- -----------------------------------------------------------------------------
create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete restrict,

  provider                public.payment_provider not null,
  -- The gateway's own reference for this charge. Unique per provider.
  provider_reference      text not null,
  provider_transaction_id text,

  status                  public.payment_status not null default 'initialised',
  amount_minor            bigint not null,
  currency                text not null,
  -- Gateway fee, when the gateway reports it. Reported, not assumed.
  fee_minor               bigint,
  channel                 text,           -- card, bank_transfer, ussd, ...
  authorization_url       text,

  -- HIDDEN. Full gateway payload, which may contain payer hints and card metadata.
  raw_payload             jsonb not null default '{}'::jsonb,

  -- When the server independently confirmed this payment with the gateway API.
  verified_at             timestamptz,
  failure_reason          text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint payments_amount_positive check (amount_minor > 0),
  constraint payments_fee_non_negative check (fee_minor is null or fee_minor >= 0),
  constraint payments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint payments_reference_present check (length(provider_reference) between 1 and 200),
  -- 'succeeded' is a promise that the money is confirmed. It may not be recorded
  -- without the verification timestamp that proves it was checked.
  constraint payments_succeeded_requires_verification
    check (status <> 'succeeded' or verified_at is not null)
);

comment on table public.payments is
  'One payment attempt per row. status = succeeded implies verified_at is set: callbacks are re-verified against the gateway before anything is marked paid.';
comment on column public.payments.raw_payload is
  'HIDDEN. Raw gateway payload. Server-side only; excluded from audit logs and API responses.';

create unique index payments_provider_reference_idx
  on public.payments (provider, provider_reference);

-- INVIOLABLE: at most one successful payment per order, ever. This is the last line
-- of defence against a double charge and against a replayed webhook marking an order
-- paid twice, in a way no amount of application logic can bypass.
create unique index payments_one_success_per_order
  on public.payments (order_id)
  where status = 'succeeded';

create index payments_order_idx  on public.payments (order_id, created_at desc);
create index payments_status_idx on public.payments (status, created_at desc);

create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- webhook_events: the inbound event ledger.
--
-- The unique index on (provider, event_id) is the idempotency mechanism. A retried
-- delivery violates the constraint and is caught before any side effect runs, so the
-- handler can be written naively without risking a double fulfilment.
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  provider          public.payment_provider not null,

  -- The gateway's event identifier: Paystack's event id, Flutterwave's
  -- verif-hash plus payload digest. Together with provider this is the dedupe key.
  event_id          text not null,
  event_type        text not null,

  -- Recorded even when false, because a burst of bad signatures is a signal worth
  -- having. Rows with signature_valid = false are never acted upon.
  signature_valid   boolean not null,
  payload           jsonb not null,

  attempts          integer not null default 0,
  processed_at      timestamptz,
  processing_error  text,
  received_at       timestamptz not null default now(),

  constraint webhook_events_event_id_present check (length(event_id) between 1 and 200),
  constraint webhook_events_attempts_non_negative check (attempts >= 0),
  -- An event may not be recorded as processed without a timestamp, nor carry an error
  -- once it has succeeded.
  constraint webhook_events_processed_consistent
    check ((processed_at is null) <> (processing_error is not null) or (processed_at is null and processing_error is null))
);

comment on table public.webhook_events is
  'Inbound gateway events. UNIQUE (provider, event_id) is what makes webhook handling idempotent.';

create unique index webhook_events_provider_event_idx
  on public.webhook_events (provider, event_id);

create index webhook_events_pending_idx
  on public.webhook_events (received_at)
  where processed_at is null;
