import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Dashboard aggregates.
 *
 * WHY EVERY SELECT BELOW NAMES A COLUMN INSTEAD OF USING "*".
 *
 * This is the fix for the admin 500, and the reason is worth writing down because the
 * failure mode is invisible in review.
 *
 * `authenticated` holds COLUMN-LEVEL select grants, not a whole-table grant: the migration
 * revokes table-wide SELECT and re-grants an explicit allow-list per table. That allow-list
 * deliberately omits the cost, margin and staff-only columns. Postgres refuses a whole-row
 * read for a role that does not hold a grant on EVERY column, so `select *` fails with
 *
 *     ERROR: permission denied for table orders
 *
 * which is a confusing message - the role plainly does have permission to *some* of the
 * table - and it fails even for `head: true` count requests, because PostgREST still builds
 * the `select=*` projection before executing.
 *
 * `count(*)` and `count(<granted column>)` both work, because neither reads an ungranted
 * column. So every query here projects one column that is definitely in the allow-list.
 *
 * The projection differs per table on purpose: `user_moderation` is keyed by `user_id` and
 * has no `id` column at all, so a blanket `select("id")` would have replaced one 500 with
 * another. That is checked, not assumed.
 *
 * ONE FAILING COUNT MUST NOT TAKE DOWN THE PAGE.
 * An operator opening the console to triage a problem cannot be locked out by the very
 * problem they came to look at. Each count is therefore isolated: a failure is recorded
 * against its own metric, the figure renders as an inline error, and every other figure on
 * the page still appears. `degraded` and `failures` drive that display.
 *
 * READS USE THE USER-SCOPED CLIENT, NOT THE SERVICE ROLE. That is deliberate: every query
 * here is also subject to the admin RLS policies, so if the privilege were ever lost the
 * dashboard would come back empty rather than quietly serving data. Bypassing RLS here
 * would make this the one surface a guard bug could not be caught by the database.
 */

/** One aggregate that could not be read, named so it can be pointed at on screen. */
export type MetricFailure = {
  /** Human label for the failing figure, e.g. "orders paid". */
  metric: string;
  /** The underlying database message. Shown to an operator, never to a customer. */
  message: string;
};

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
  /** Empty when every aggregate read succeeded. */
  failures: MetricFailure[];
  /** True when at least one aggregate is missing, so the page can say so plainly. */
  degraded: boolean;
};

/** The shape PostgREST returns for a head+count request. */
type CountResponse = {
  count: number | null;
  error: { message: string } | null;
};

/**
 * The select options for a count-only request, declared once.
 *
 * `as const` rather than a type annotation: it keeps the literal types (`"exact"`, `true`)
 * that the Supabase overloads discriminate on, while still being checked. Annotating it
 * would widen `count` to `string` and silently select a different overload.
 */
const HEAD_COUNT = { count: "exact", head: true } as const;

/**
 * Awaits a count query and records a failure instead of throwing.
 *
 * The metric name is carried into the message so the failing figure is identifiable on the
 * page without a debugger, and the caller still gets a number so the surrounding layout does
 * not have to handle a missing value.
 */
async function runCount(
  metric: string,
  query: PromiseLike<CountResponse>,
  failures: MetricFailure[],
): Promise<number> {
  try {
    const { count, error } = await query;

    if (error) {
      failures.push({ metric, message: error.message });
      return 0;
    }

    return count ?? 0;
  } catch (error) {
    // A thrown error (a transport failure, a malformed response) is treated exactly like a
    // returned one: this figure is unavailable, the rest of the page is not.
    failures.push({
      metric,
      message: error instanceof Error ? error.message : "The count could not be completed.",
    });
    return 0;
  }
}

export async function getOverview(supabase: SupabaseClient): Promise<Overview> {
  const failures: MetricFailure[] = [];

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
    // `id` is in the authenticated allow-list on orders. See the note at the top of the file.
    runCount("orders", supabase.from("orders").select("id", HEAD_COUNT), failures),

    runCount(
      "orders awaiting payment",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "pending_payment"),
      failures,
    ),
    runCount(
      "orders paid",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "paid"),
      failures,
    ),
    runCount(
      "orders fulfilling",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "fulfilling"),
      failures,
    ),
    runCount(
      "orders fulfilled",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "fulfilled"),
      failures,
    ),
    runCount(
      "orders failed",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "failed"),
      failures,
    ),
    runCount(
      "orders partially fulfilled",
      supabase.from("orders").select("id", HEAD_COUNT).eq("status", "partially_fulfilled"),
      failures,
    ),

    // The two queues an operator actually works: goods paid for but not delivered, and
    // deliveries that failed and therefore need either a retry or a refund decision.
    runCount(
      "order lines undelivered",
      supabase
        .from("order_items")
        .select("id", HEAD_COUNT)
        .in("fulfilment_status", ["pending", "submitted"]),
      failures,
    ),
    runCount(
      "order lines failed",
      supabase.from("order_items").select("id", HEAD_COUNT).eq("fulfilment_status", "failed"),
      failures,
    ),

    runCount(
      "payments succeeded",
      supabase.from("payments").select("id", HEAD_COUNT).eq("status", "succeeded"),
      failures,
    ),
    runCount(
      "payments failed",
      supabase.from("payments").select("id", HEAD_COUNT).eq("status", "failed"),
      failures,
    ),

    runCount("products", supabase.from("products").select("id", HEAD_COUNT), failures),
    runCount(
      "products active",
      supabase.from("products").select("id", HEAD_COUNT).eq("status", "active"),
      failures,
    ),
    runCount(
      "products draft",
      supabase.from("products").select("id", HEAD_COUNT).eq("status", "draft"),
      failures,
    ),

    runCount("suppliers", supabase.from("suppliers").select("id", HEAD_COUNT), failures),
    runCount(
      "suppliers enabled",
      supabase.from("suppliers").select("id", HEAD_COUNT).eq("is_active", true),
      failures,
    ),
    runCount(
      "suppliers sandbox",
      supabase.from("suppliers").select("id", HEAD_COUNT).eq("mode", "sandbox"),
      failures,
    ),

    // NOT "id": user_moderation is keyed by user_id and has no id column. Requesting a
    // column that does not exist is the same class of failure this file exists to fix.
    runCount(
      "blocked accounts",
      supabase
        .from("user_moderation")
        .select("user_id", HEAD_COUNT)
        .not("status", "eq", "active"),
      failures,
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
    failures,
    degraded: failures.length > 0,
  };
}
