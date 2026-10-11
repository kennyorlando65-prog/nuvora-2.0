import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dashboard aggregates.
 *
 * Counts are obtained with `head: true` + `count: "exact"`, which asks PostgREST for the
 * row count without transferring rows. An admin overview is a summary; pulling every order
 * body to count them would get slower every month and would transfer customer data the page
 * never displays.
 *
 * READS USE THE USER-SCOPED CLIENT, NOT THE SERVICE ROLE. That is deliberate: every query
 * here is also subject to the admin RLS policies, so if the privilege were ever lost the
 * dashboard would come back empty rather than quietly serving data. Bypassing RLS here
 * would make this the one surface a guard bug could not be caught by the database.
 *
 * Every column touched below is in the `authenticated` column grant list, which is why no
 * privileged access is needed: the aggregates deliberately do not involve cost, margin or
 * staff-only fields. The pages that need those take the privileged reader from
 * `requireAdminColumns` instead - see the note in lib/auth/guard.ts.
 */

export type Overview = {
  orders: {
    total: number;
    awaitingPayment: number;
    paid: number;
    fulfilling: number;
    fulfilled: number;
    needsAttention: number;
  };
  lines: {
    pendingFulfilment: number;
    failedFulfilment: number;
  };
  payments: {
    succeeded: number;
    failed: number;
  };
  catalogue: {
    total: number;
    active: number;
    draft: number;
  };
  providers: {
    total: number;
    enabled: number;
    sandbox: number;
  };
  users: {
    blocked: number;
  };
};

/** The shape PostgREST returns for a head+count request. */
type CountResponse = {
  count: number | null;
  error: { message: string } | null;
};

/**
 * Awaits a count query and turns a failure into a loud error.
 *
 * A count that fails silently is worse than a page that refuses to render: a dashboard
 * showing zero awaiting-fulfilment lines while the query is erroring is how an operator
 * concludes there is no work to do. The table name is carried into the message so the
 * failing query is identifiable without a debugger.
 */
async function runCount(table: string, query: PromiseLike<CountResponse>): Promise<number> {
  const { count, error } = await query;

  if (error) {
    throw new Error(`Overview count failed for "${table}": ${error.message}`);
  }

  return count ?? 0;
}

/**
 * The select options for a count-only request, declared once.
 *
 * `as const` rather than a type annotation: it keeps the literal types (`"exact"`, `true`)
 * that the Supabase overloads discriminate on, while still being checked. Annotating it
 * would widen `count` to `string` and silently select a different overload.
 */
const HEAD_COUNT = { count: "exact", head: true } as const;

export async function getOverview(supabase: SupabaseClient): Promise<Overview> {
  const [
    ordersTotal,
    awaitingPayment,
    paid,
    fulfilling,
    fulfilled,
    failedOrders,
    partiallyFulfilled,
    pendingLines,
    failedLines,
    succeededPayments,
    failedPayments,
    productsTotal,
    productsActive,
    productsDraft,
    providersTotal,
    providersEnabled,
    providersSandbox,
    blockedUsers,
  ] = await Promise.all([
    runCount("orders", supabase.from("orders").select("*", HEAD_COUNT)),

    runCount(
      "orders.pending_payment",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "pending_payment"),
    ),
    runCount(
      "orders.paid",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "paid"),
    ),
    runCount(
      "orders.fulfilling",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "fulfilling"),
    ),
    runCount(
      "orders.fulfilled",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "fulfilled"),
    ),
    runCount(
      "orders.failed",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "failed"),
    ),
    runCount(
      "orders.partially_fulfilled",
      supabase.from("orders").select("*", HEAD_COUNT).eq("status", "partially_fulfilled"),
    ),

    // The two queues an operator actually works: goods paid for but not delivered, and
    // deliveries that failed and therefore need either a retry or a refund decision.
    runCount(
      "order_items.undelivered",
      supabase
        .from("order_items")
        .select("*", HEAD_COUNT)
        .in("fulfilment_status", ["pending", "submitted"]),
    ),
    runCount(
      "order_items.failed",
      supabase.from("order_items").select("*", HEAD_COUNT).eq("fulfilment_status", "failed"),
    ),

    runCount(
      "payments.succeeded",
      supabase.from("payments").select("*", HEAD_COUNT).eq("status", "succeeded"),
    ),
    runCount(
      "payments.failed",
      supabase.from("payments").select("*", HEAD_COUNT).eq("status", "failed"),
    ),

    runCount("products", supabase.from("products").select("*", HEAD_COUNT)),
    runCount(
      "products.active",
      supabase.from("products").select("*", HEAD_COUNT).eq("status", "active"),
    ),
    runCount(
      "products.draft",
      supabase.from("products").select("*", HEAD_COUNT).eq("status", "draft"),
    ),

    runCount("suppliers", supabase.from("suppliers").select("*", HEAD_COUNT)),
    runCount(
      "suppliers.enabled",
      supabase.from("suppliers").select("*", HEAD_COUNT).eq("is_active", true),
    ),
    runCount(
      "suppliers.sandbox",
      supabase.from("suppliers").select("*", HEAD_COUNT).eq("mode", "sandbox"),
    ),

    runCount(
      "user_moderation.blocked",
      supabase.from("user_moderation").select("*", HEAD_COUNT).not("status", "eq", "active"),
    ),
  ]);

  return {
    orders: {
      total: ordersTotal,
      awaitingPayment,
      paid,
      fulfilling,
      fulfilled,
      // Orders that will not progress without a human decision.
      needsAttention: failedOrders + partiallyFulfilled,
    },
    lines: {
      pendingFulfilment: pendingLines,
      failedFulfilment: failedLines,
    },
    payments: { succeeded: succeededPayments, failed: failedPayments },
    catalogue: { total: productsTotal, active: productsActive, draft: productsDraft },
    providers: {
      total: providersTotal,
      enabled: providersEnabled,
      sandbox: providersSandbox,
    },
    users: { blocked: blockedUsers },
  };
}
