import type { Metadata } from "next";
import Link from "next/link";

import { OrderFilters } from "@/components/admin/order-filters";
import {
  Badge,
  EmptyState,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/ui";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  formatDateTime,
  formatMoney,
  labelOf,
  toneOf,
} from "@/lib/admin/format";
import { listOrders, parseOrderFilters } from "@/lib/admin/orders";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Orders" };

/**
 * Orders list.
 *
 * Every filter is applied in the DATABASE, not in the browser. That is the difference
 * between a screen that shows the first 25 orders and lets you filter them, and one that
 * shows 25 matching orders out of all of them. The distinction matters most when it is
 * least visible: an operator searching for an order that is not in the newest 25 would
 * otherwise conclude it does not exist.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const filters = parseOrderFilters(params);

  // The guard returns the client used for the query below, so the two cannot be separated.
  const { supabase } = await requireAdmin("/admin/orders");
  const result = await listOrders(supabase, filters);

  const buildPageHref = (page: number) => {
    const search = new URLSearchParams();
    if (filters.status) search.set("status", filters.status);
    if (filters.fulfilment) search.set("fulfilment", filters.fulfilment);
    if (filters.provider) search.set("provider", filters.provider);
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.q) search.set("q", filters.q);
    if (page > 1) search.set("page", String(page));
    const query = search.toString();
    return `/admin/orders${query ? `?${query}` : ""}`;
  };

  return (
    <>
      <PageHeader
        label="Commerce"
        title="Orders"
        description="Every order is paid in full at checkout through the gateway. There is no wallet and no stored balance anywhere in this system."
      />

      <OrderFilters filters={filters} />

      {result.rows.length === 0 ? (
        // The two empty states are different facts. An operator who cannot tell "no orders
        // exist yet" from "no orders match this filter" will assume the page is broken.
        result.filtered ? (
          <EmptyState
            title="No orders match these filters"
            hint="The filters are applied in the database against every order, not just this page. Widen the date range or clear the search to see more."
          />
        ) : (
          <EmptyState
            title="No orders yet"
            hint="This is the expected state of a new store. Orders appear here as soon as the first checkout completes. No placeholder orders are ever created."
          />
        )
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Gateway</Th>
                <Th>Lines</Th>
                <Th align="right">Total</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((order) => {
                const linesHint =
                  order.failedLines > 0
                    ? `${order.failedLines} failed`
                    : order.pendingLines > 0
                      ? `${order.pendingLines} awaiting delivery`
                      : order.lineCount === 0
                        ? "no lines"
                        : "delivered";

                const linesTone =
                  order.failedLines > 0 ? "bad" : order.pendingLines > 0 ? "warn" : "ok";

                return (
                  <tr key={order.id}>
                    <Td mono>
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-accent underline underline-offset-2"
                      >
                        {order.order_number}
                      </Link>
                    </Td>
                    <Td>
                      <span className="block text-ink">{order.email}</span>
                      <span className="block text-xs text-dim">
                        {order.user_id ? "Registered account" : "Guest checkout"}
                        {order.billing_country ? ` - ${order.billing_country}` : ""}
                      </span>
                    </Td>
                    <Td>
                      <Badge
                        label={labelOf(ORDER_STATUS_LABELS, order.status)}
                        tone={toneOf(ORDER_STATUS_TONES, order.status)}
                      />
                    </Td>
                    <Td>
                      {order.paymentProvider ? (
                        <span className="flex flex-col gap-1">
                          <span className="text-xs capitalize text-ink">
                            {order.paymentProvider}
                          </span>
                          <Badge
                            label={labelOf(PAYMENT_STATUS_LABELS, order.paymentStatus)}
                            tone={toneOf(PAYMENT_STATUS_TONES, order.paymentStatus)}
                          />
                        </span>
                      ) : (
                        <span className="text-xs text-dim">No payment recorded</span>
                      )}
                    </Td>
                    <Td>
                      <span className="flex flex-col gap-1">
                        <span className="text-xs text-muted">
                          {order.lineCount} {order.lineCount === 1 ? "line" : "lines"}
                        </span>
                        <Badge label={linesHint} tone={linesTone} />
                      </span>
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(order.total_minor, order.currency)}
                    </Td>
                    <Td mono>{formatDateTime(order.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-dim">
              Page {result.page}
              {result.hasMore ? " - more results available" : " - end of results"}
            </p>

            <div className="flex items-center gap-2">
              {result.page > 1 && (
                <Link
                  href={buildPageHref(result.page - 1)}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Previous
                </Link>
              )}
              {result.hasMore && (
                <Link
                  href={buildPageHref(result.page + 1)}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Next
                </Link>
              )}
            </div>
          </div>

          <p className="text-xs text-dim">
            Pagination shows one page at a time and detects the next page by fetching one row
            beyond it. That keeps the query cheap, which is why this screen does not print an
            exact total number of matching orders.
          </p>
        </>
      )}
    </>
  );
}
