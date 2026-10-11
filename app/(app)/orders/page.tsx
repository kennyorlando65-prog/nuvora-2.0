import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader, Pill, TableWrap, Td, Th } from "@/components/app/ui";
import { requireUser } from "@/lib/app/session";
import { listMyOrders } from "@/lib/app/queries";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatDateTime,
  formatMoney,
  labelOf,
  toneOf,
} from "@/lib/admin/format";

export const metadata: Metadata = { title: "My orders" };

/**
 * The customer's order history.
 *
 * Read through the user-scoped client, so RLS returns only this customer's rows. There is
 * no `user_id` filter in the query on purpose: the policy `orders_select_own` already
 * applies it, and writing it again here would suggest the policy is optional.
 */
export default async function MyOrdersPage() {
  const { supabase } = await requireUser("/orders");
  const orders = await listMyOrders(supabase, 100);

  return (
    <>
      <PageHeader
        label="History"
        title="My orders"
        description="Every order on this account, newest first. Open one to see its items and any delivery codes."
        actions={
          <Link href="/store" className="nuvora-btn nuvora-btn-secondary">
            Go to the store
          </Link>
        }
      />

      {orders.length === 0 ? (
        <EmptyState
          title="You have not placed an order yet"
          hint="Orders appear here as soon as you place one. Delivery codes appear on the order once the supplier has issued them."
          action={
            <Link href="/store" className="nuvora-btn nuvora-btn-primary">
              Browse the store
            </Link>
          }
        />
      ) : (
        <Card>
          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Placed</Th>
                <Th>Paid</Th>
                <Th align="right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
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
                  <Td mono>{formatDateTime(order.created_at)}</Td>
                  <Td mono>{order.paid_at ? formatDateTime(order.paid_at) : "-"}</Td>
                  <Td align="right" mono>
                    {formatMoney(order.total_minor, order.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
