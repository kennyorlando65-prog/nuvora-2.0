import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Order reads for the admin surface.
 *
 * THE COLUMN CEILING IS REAL, NOT THEORETICAL.
 * The grants in 20261011090600 give `authenticated` - including an admin session - an
 * explicit column allow-list. Verified against the live project, an admin session CANNOT
 * select these through PostgREST:
 *
 *   orders          internal_note, engine_version, created_ip_hash
 *   order_items     unit_cost_minor, supplier_reference, fulfilment_error
 *   payments        raw_payload, failure_reason, authorization_url, provider_transaction_id
 *
 * RLS grants an admin ROWS; it has no say in COLUMNS. So this module is deliberately split:
 * `listOrders` uses only columns the admin session can read itself, and
 * `getOrderHiddenDetail` takes the service-role client for the columns it cannot. Every
 * field is labelled with which path fetched it, so a reader can tell whether a figure came
 * from the user-scoped client or the privileged one.
 *
 * WHY THE LIST NEEDS NO PRIVILEGE: every column it selects is in the allow-list, which is
 * not a coincidence - it means the most frequently rendered admin page runs entirely under
 * RLS. The privileged client is used for the detail view only, where cost and margin
 * genuinely require it.
 */

export const ORDER_LIST_COLUMNS =
  "id, order_number, email, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, billing_country, user_id, paid_at, fulfilled_at, cancelled_at, refunded_at, created_at, updated_at";

/** Columns only the service role may read. Kept in one place so the split is auditable. */
export const ORDER_HIDDEN_COLUMNS = "id, internal_note, engine_version, created_ip_hash";
export const ITEM_HIDDEN_COLUMNS =
  "id, unit_cost_minor, supplier_reference, fulfilment_error";
export const PAYMENT_HIDDEN_COLUMNS =
  "id, raw_payload, failure_reason, authorization_url, provider_transaction_id";

export const PAYMENT_PUBLIC_COLUMNS =
  "id, order_id, provider, provider_reference, status, amount_minor, currency, fee_minor, channel, verified_at, created_at, updated_at";

export const ITEM_PUBLIC_COLUMNS =
  "id, order_id, product_id, price_id, product_name, product_line, product_attributes, unit_price_minor, quantity, line_total_minor, fulfilment_status, delivery_payload, delivered_at, created_at, updated_at";

export const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type OrderFilters = {
  status: string;
  fulfilment: string;
  provider: string;
  from: string;
  to: string;
  q: string;
  page: number;
};

const STATUS_VALUES = [
  "pending_payment",
  "paid",
  "fulfilling",
  "fulfilled",
  "partially_fulfilled",
  "failed",
  "cancelled",
  "refunded",
] as const;

const FULFILMENT_VALUES = ["pending", "submitted", "completed", "failed", "refunded"] as const;

const PROVIDER_VALUES = ["paystack", "flutterwave"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneOf(value: string | string[] | undefined, allowed: readonly string[]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && allowed.includes(raw) ? raw : "";
}

export function parseOrderFilters(
  params: Record<string, string | string[] | undefined>,
): OrderFilters {
  const str = (key: string): string => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return (value ?? "").trim();
  };

  const pageRaw = Number.parseInt(str("page"), 10);

  return {
    // Every filter is validated against a closed set. An unrecognised value is dropped
    // rather than passed through: a status of `'; drop table` is harmless to PostgREST,
    // but it would produce a confidently empty result that reads as "no such orders".
    status: oneOf(params.status, STATUS_VALUES),
    fulfilment: oneOf(params.fulfilment, FULFILMENT_VALUES),
    provider: oneOf(params.provider, PROVIDER_VALUES),
    from: ISO_DATE.test(str("from")) ? str("from") : "",
    to: ISO_DATE.test(str("to")) ? str("to") : "",
    q: str("q").slice(0, 120),
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 400) : 1,
  };
}

/**
 * Makes a search term safe inside a PostgREST `or=` filter.
 *
 * `.or()` takes a comma-separated mini-language, so an unescaped comma, parenthesis, dot or
 * percent sign in the user's input changes the FILTER rather than the search value - a
 * search for "a,b" would silently become two conditions. Rather than teach the caller
 * PostgREST's quoting rules, the term is reduced to a conservative charset and an empty
 * result disables the search. That is a real limitation, and it is stated here rather than
 * discovered later: an order number is `NUV-20261011-001234` and an email address is
 * `name@domain.tld`, both of which survive unchanged.
 */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[^A-Za-z0-9@._+-]/g, "").slice(0, 60);
}

export function hasActiveFilters(f: OrderFilters): boolean {
  return Boolean(f.status || f.fulfilment || f.provider || f.from || f.to || f.q);
}

/** Rebuilds the filter set as a query string, so pagination links keep the filters. */
export function filtersToQuery(f: OrderFilters, overrides: Partial<OrderFilters> = {}): string {
  const merged = { ...f, ...overrides };
  const search = new URLSearchParams();

  if (merged.status) search.set("status", merged.status);
  if (merged.fulfilment) search.set("fulfilment", merged.fulfilment);
  if (merged.provider) search.set("provider", merged.provider);
  if (merged.from) search.set("from", merged.from);
  if (merged.to) search.set("to", merged.to);
  if (merged.q) search.set("q", merged.q);
  if (merged.page > 1) search.set("page", String(merged.page));

  const query = search.toString();
  return query ? `?${query}` : "";
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type OrderListRow = {
  id: string;
  order_number: string;
  email: string;
  status: string;
  currency: string;
  total_minor: number;
  created_at: string;
  paid_at: string | null;
  billing_country: string | null;
  user_id: string | null;
  paymentProvider: string | null;
  paymentStatus: string | null;
  lineCount: number;
  pendingLines: number;
  failedLines: number;
};

export type OrderListResult = {
  rows: OrderListRow[];
  page: number;
  pageSize: number;
  /** True when a full page came back, so there may be more. Not an exact total. */
  hasMore: boolean;
  /** Set when any filter narrowed the result, so the UI can say WHY it is empty. */
  filtered: boolean;
};

/**
 * Lists orders.
 *
 * A NOTE ON THE MISSING TOTAL COUNT. An exact filtered total costs a second full scan of
 * the matching set on every page view, and an operator cannot act differently on "37
 * results" versus "38". Instead the query asks for one row MORE than the page size: if that
 * extra row arrives there is a next page, and `hasMore` is exact for the purpose it serves.
 * The honest cost is that the interface cannot say "showing 1-25 of 37".
 */
export async function listOrders(
  supabase: SupabaseClient,
  filters: OrderFilters,
): Promise<OrderListResult> {
  const filtered = hasActiveFilters(filters);
  const term = sanitizeSearch(filters.q);

  // When a filter targets a RELATED table (provider lives on payments, fulfilment status
  // lives on order_items) the matching order ids are resolved first. Embedding a nested
  // resource would be shorter, but it multiplies rows per order and paginates wrongly -
  // the page size would apply to joined rows rather than orders.
  let restrictToOrderIds: string[] | null = null;

  if (filters.provider) {
    const { data, error } = await supabase
      .from("payments")
      .select("order_id")
      .eq("provider", filters.provider)
      .limit(5000);

    if (error) throw new Error(`Orders: provider filter failed: ${error.message}`);
    restrictToOrderIds = [...new Set((data ?? []).map((r) => r.order_id as string))];

    // No order used that provider. Returning early is correct and avoids an `in ()` with an
    // empty list, which PostgREST rejects rather than treating as "match nothing".
    if (restrictToOrderIds.length === 0) {
      return { rows: [], page: filters.page, pageSize: PAGE_SIZE, hasMore: false, filtered };
    }
  }

  if (filters.fulfilment) {
    const { data, error } = await supabase
      .from("order_items")
      .select("order_id")
      .eq("fulfilment_status", filters.fulfilment)
      .limit(5000);

    if (error) throw new Error(`Orders: fulfilment filter failed: ${error.message}`);

    const ids = [...new Set((data ?? []).map((r) => r.order_id as string))];
    restrictToOrderIds =
      restrictToOrderIds === null ? ids : restrictToOrderIds.filter((id) => ids.includes(id));

    if (restrictToOrderIds.length === 0) {
      return { rows: [], page: filters.page, pageSize: PAGE_SIZE, hasMore: false, filtered };
    }
  }

  // Select one extra row to detect a following page without a second count query.
  const from = (filters.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  let query = supabase
    .from("orders")
    .select(ORDER_LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (filters.status) query = query.eq("status", filters.status);
  if (restrictToOrderIds) query = query.in("id", restrictToOrderIds);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  // Inclusive upper bound: adding a day makes "to = 11 Oct" include all of 11 Oct rather
  // than stopping at midnight, which is the off-by-one every date filter is accused of.
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  if (term) {
    query = query.or(`order_number.ilike.%${term}%,email.ilike.%${term}%`);
  }

  const { data: orders, error } = await query;

  if (error) throw new Error(`Orders: list query failed: ${error.message}`);

  const rows = orders ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  if (pageRows.length === 0) {
    return { rows: [], page: filters.page, pageSize: PAGE_SIZE, hasMore: false, filtered };
  }

  const orderIds = pageRows.map((o) => o.id as string);

  // Two follow-up queries for the whole page rather than one per row: the alternative is
  // a query per order, and a 25-row page would issue 50.
  const [{ data: payments }, { data: items }] = await Promise.all([
    supabase
      .from("payments")
      .select("order_id, provider, status, created_at")
      .in("order_id", orderIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_items")
      .select("order_id, fulfilment_status")
      .in("order_id", orderIds),
  ]);

  const paymentByOrder = new Map<string, { provider: string; status: string }>();
  for (const payment of payments ?? []) {
    // Ordered newest first, and the first entry wins: the most recent attempt is the one an
    // operator means when they ask "how did this order pay".
    if (!paymentByOrder.has(payment.order_id as string)) {
      paymentByOrder.set(payment.order_id as string, {
        provider: payment.provider as string,
        status: payment.status as string,
      });
    }
  }

  const linesByOrder = new Map<string, { total: number; pending: number; failed: number }>();
  for (const item of items ?? []) {
    const key = item.order_id as string;
    const entry = linesByOrder.get(key) ?? { total: 0, pending: 0, failed: 0 };
    entry.total += 1;
    if (item.fulfilment_status === "pending" || item.fulfilment_status === "submitted") {
      entry.pending += 1;
    }
    if (item.fulfilment_status === "failed") entry.failed += 1;
    linesByOrder.set(key, entry);
  }

  return {
    rows: pageRows.map((order) => {
      const payment = paymentByOrder.get(order.id as string) ?? null;
      const lines = linesByOrder.get(order.id as string) ?? { total: 0, pending: 0, failed: 0 };

      return {
        id: order.id as string,
        order_number: order.order_number as string,
        email: order.email as string,
        status: order.status as string,
        currency: order.currency as string,
        total_minor: Number(order.total_minor),
        created_at: order.created_at as string,
        paid_at: (order.paid_at as string | null) ?? null,
        billing_country: (order.billing_country as string | null) ?? null,
        user_id: (order.user_id as string | null) ?? null,
        paymentProvider: payment?.provider ?? null,
        paymentStatus: payment?.status ?? null,
        lineCount: lines.total,
        pendingLines: lines.pending,
        failedLines: lines.failed,
      };
    }),
    page: filters.page,
    pageSize: PAGE_SIZE,
    hasMore,
    filtered,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type HiddenDetail = {
  /** False when the privileged client is unavailable, so the UI can say so. */
  available: boolean;
  unavailableReason?: string;
  order: { internal_note: string | null; engine_version: string | null };
  items: Record<string, { unit_cost_minor: number | null; supplier_reference: string | null; fulfilment_error: string | null }>;
  payments: Record<string, { failure_reason: string | null; provider_transaction_id: string | null; raw_payload: unknown }>;
};

/**
 * Reads the columns an admin session cannot select, using the service-role client.
 *
 * FAILS SOFT, ON PURPOSE. If SUPABASE_SERVICE_ROLE_KEY is absent or rotated, this returns
 * `available: false` with a reason instead of throwing. The order detail then renders with
 * a clearly-labelled gap. The alternative - letting the whole page 500 - would mean a
 * mistyped environment variable takes the admin area down entirely, including the parts
 * that can still be served under RLS.
 */
export async function getOrderHiddenDetail(
  privileged: SupabaseClient | null,
  orderId: string,
  itemIds: string[],
  paymentIds: string[],
): Promise<HiddenDetail> {
  const empty: HiddenDetail = {
    available: false,
    order: { internal_note: null, engine_version: null },
    items: {},
    payments: {},
  };

  if (!privileged) {
    return { ...empty, unavailableReason: "The privileged reader is not configured." };
  }

  try {
    const [orderResult, itemsResult, paymentsResult] = await Promise.all([
      privileged.from("orders").select(ORDER_HIDDEN_COLUMNS).eq("id", orderId).maybeSingle(),
      itemIds.length
        ? privileged.from("order_items").select(ITEM_HIDDEN_COLUMNS).in("id", itemIds)
        : Promise.resolve({ data: [], error: null }),
      paymentIds.length
        ? privileged.from("payments").select(PAYMENT_HIDDEN_COLUMNS).in("id", paymentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const firstError = orderResult.error ?? itemsResult.error ?? paymentsResult.error;
    if (firstError) {
      return { ...empty, unavailableReason: `Privileged read failed: ${firstError.message}` };
    }

    const items: HiddenDetail["items"] = {};
    for (const row of (itemsResult.data ?? []) as Array<Record<string, unknown>>) {
      items[row.id as string] = {
        unit_cost_minor: row.unit_cost_minor === null ? null : Number(row.unit_cost_minor),
        supplier_reference: (row.supplier_reference as string | null) ?? null,
        fulfilment_error: (row.fulfilment_error as string | null) ?? null,
      };
    }

    const payments: HiddenDetail["payments"] = {};
    for (const row of (paymentsResult.data ?? []) as Array<Record<string, unknown>>) {
      payments[row.id as string] = {
        failure_reason: (row.failure_reason as string | null) ?? null,
        provider_transaction_id: (row.provider_transaction_id as string | null) ?? null,
        raw_payload: row.raw_payload ?? null,
      };
    }

    const orderRow = (orderResult.data ?? {}) as Record<string, unknown>;

    return {
      available: true,
      order: {
        internal_note: (orderRow.internal_note as string | null) ?? null,
        engine_version: (orderRow.engine_version as string | null) ?? null,
      },
      items,
      payments,
    };
  } catch (error) {
    return {
      ...empty,
      unavailableReason:
        error instanceof Error ? `Privileged read failed: ${error.message}` : "Privileged read failed.",
    };
  }
}
