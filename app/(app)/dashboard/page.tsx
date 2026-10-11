import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader, Pill, StatCard, TableWrap, Td, Th } from "@/components/app/ui";
import { requireUser } from "@/lib/app/session";
import { listMyOrders } from "@/lib/app/queries";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatDate,
  formatMoney,
  labelOf,
  toneOf,
} from "@/lib/admin/format";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * The customer dashboard.
 *
 * The first thing a signed-in customer sees, and the reason the app reads as an app rather
 * than a website: a row of stat cards, then a table of recent activity, all inside the
 * persistent shell.
 *
 * EVERY FIGURE IS DERIVED FROM THE CUSTOMER'S OWN ORDERS, read through the user-scoped
 * client so RLS decides the rows. There is no separate "stats" table and no cached counter
 * that could drift from the orders it claims to summarise.
 */
export default async function DashboardPage() {
  const { supabase, user } = await requireUser("/dashboard");
  const orders = await listMyOrders(supabase, 100);

  const delivered = orders.filter((order) => order.status === "fulfilled").length;
  const inProgress = orders.filter((order) =>
    ["paid", "fulfilling", "partially_fulfilled"].includes(order.status),
  ).length;
  const needsAttention = orders.filter((order) =>
    ["failed", "pending_payment"].includes(order.status),
  ).length;

  // Spend is summed in minor units and formatted once, so no rounding creeps in per row.
  const totalSpentMinor = orders
    .filter((order) => order.paid_at !== null)
    .reduce((sum, order) => sum + Number(order.total_minor), 0);
  const currency = orders[0]?.currency ?? "NGN";

  const recent = orders.slice(0, 5);

  return (
    <>
      <PageHeader
        label="Overview"
        title="Your dashboard"
        description="Everything you have ordered, and where each order has got to."
        actions={
          <Link href="/store" className="nuvora-btn nuvora-btn-primary">
            Go to the store
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders placed" value={orders.length} tone="info" />
        <StatCard label="Delivered" value={delivered} tone="ok" />
        <StatCard label="In progress" value={inProgress} tone="warn" />
        <StatCard
          label="Needs attention"
          value={needsAttention}
          tone={needsAttention > 0 ? "bad" : "neutral"}
          hint={needsAttention > 0 ? "Check these below" : undefined}
        />
      </div>

      <Card
        title="Recent orders"
        description="Your five most recent orders. Open one to see its items and delivery codes."
        actions={
          orders.length > 0 ? (
            <Link href="/orders" className="text-xs text-muted underline hover:text-accent">
              See all orders
            </Link>
          ) : undefined
        }
      >
        {recent.length === 0 ? (
          <EmptyState
            title="You have not placed an order yet"
            hint="When you place your first order it will appear here, with its delivery codes once the supplier issues them."
            action={
              <Link href="/store" className="nuvora-btn nuvora-btn-primary">
                Browse the store
              </Link>
            }
          />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Placed</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((order) => (
                <tr key={order.id}>
                  <Td mono>
                    <Link
                      href={`/orders/view/${order.id}`}
                      className="text-ink underline underline-offset-2 hover:text-accent"
                    >
                      {order.order_number}
                    </Link>
                  </Td>
                  <Td>
                    <Pill
                      label={labelOf(ORDER_STATUS_LABELS, order.status)}
                      tone={toneOf(ORDER_STATUS_TONES, order.status)}
                    />
                  </Td>
                  <Td mono>{formatDate(order.created_at)}</Td>
                  <Td align="right" mono>
                    {formatMoney(order.total_minor, order.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Total paid">
          <p className="font-mono text-2xl font-semibold text-ink">
            {formatMoney(totalSpentMinor, currency)}
          </p>
          <p className="text-xs text-dim">
            Across {orders.filter((order) => order.paid_at !== null).length} paid order
            {orders.filter((order) => order.paid_at !== null).length === 1 ? "" : "s"}. This
            is a record of what you have paid, not a balance - NUVORA holds no funds for you.
          </p>
        </Card>

        <Card title="Your account">
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Email</dt>
              <dd className="truncate font-mono text-xs text-ink">{user.email ?? user.id}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Wallet balance</dt>
              <dd className="text-ink">None - pay per order</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Identity documents</dt>
              <dd className="text-ink">None held</dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
