-- =============================================================================
-- NUVORA 2.0  |  20261011090100  |  Enumerated domains
--
-- Enums are used for every value that the application branches on, so an invalid
-- state cannot be written by a buggy route or a hand-run query. Adding a value later
-- is a one-line migration; a typo is impossible.
-- =============================================================================

-- The five Digital Store product lines. Social media accounts are deliberately absent:
-- reselling them breaches platform terms and carries unmanageable fraud exposure.
create type public.product_line as enum (
  'esim',
  'topup',
  'gift_card',
  'game_credit',
  'subscription'
);

-- draft  : visible to admins only, never purchasable
-- active : purchasable and publicly listed
-- archived: withdrawn from sale but retained because order history references it
create type public.product_status as enum ('draft', 'active', 'archived');

-- How the supplier is asked to deliver the goods once payment has settled.
create type public.fulfilment_mode as enum ('instant_code', 'instant_esim', 'manual');

-- How a margin rule turns supplier cost into a customer price.
create type public.margin_type as enum ('percentage', 'fixed', 'percentage_plus_fixed');

-- Presentation rounding applied AFTER the margin, so displayed prices stay tidy.
create type public.rounding_mode as enum (
  'none', 'nearest_10', 'nearest_50', 'nearest_100', 'charm_99'
);

-- Order lifecycle. An order is only ever paid once; see the partial unique index
-- on public.payments that enforces at most one successful payment per order.
create type public.order_status as enum (
  'pending_payment',
  'paid',
  'fulfilling',
  'fulfilled',
  'partially_fulfilled',
  'failed',
  'cancelled',
  'refunded'
);

-- Per-line delivery state, tracked separately from the order so a bulk order can
-- partially succeed without the parent order lying about it.
create type public.fulfilment_status as enum (
  'pending', 'submitted', 'completed', 'failed', 'refunded'
);

create type public.payment_status as enum (
  'initialised', 'pending', 'succeeded', 'failed', 'abandoned', 'reversed'
);

create type public.payment_provider as enum ('paystack', 'flutterwave');

-- Supplier adapters run in sandbox until explicitly switched. See PROVIDER_MODE.
create type public.supplier_mode as enum ('sandbox', 'live');
