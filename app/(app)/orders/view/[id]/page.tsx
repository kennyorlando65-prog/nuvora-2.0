import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, PageHeader, Pill, TableWrap, Td, Th } from "@/components/app/ui";
import { requireUser } from "@/lib/app/session";
import { getMyOrder, listOrderItems } from "@/lib/app/queries";
import {
  FULFILMENT_LABELS,
  FULFILMENT_TONES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PRODUCT_LINE_LABELS,
  formatDateTime,
  formatMoney,
  labelOf,
  toneOf,
} from "@/lib/admin/format";

export const metadata: Metadata = {
  title: "Order",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of the customer's own orders, inside the app shell.
 *
 * WHY THIS EXISTS ALONGSIDE /orders/[token]. The token page is the guest receipt the
 * payment gateway returns a buyer to, and it works without a session. This page is the
 * signed-in view, reached from the dashboard and the order list, and it reads through the
 * user-scoped client so RLS decides whether the order is this customer's. A customer who
 * edits the id in the URL to somebody else's order gets a 404, because the policy returns
 * no row - not a permission error that would confirm the order exists.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { supabase } = await requireUser(`/orders/view/${id}`);
  const order = await getMyOrder(supabase, id);

  if (!order) notFound();

  const items = await listOrderItems(supabase, id);

  return (
    <>
      <Link href="/orders" className="text-xs text-muted underline hover:text-accent">
        Back to my orders
      </Link>

      <PageHeader
        label="Order"
        title={order.order_number}
        description={`Placed ${formatDateTime(order.created_at)}`}
        actions={
          <Pill
            label={labelOf(ORDER_STATUS_LABELS, order.status)}
            tone={toneOf(ORDER_STATUS_TONES, order.status)}
          />
        }
      />

      <Card title="Items">
        {items.length === 0 ? (
          <p className="text-sm text-muted">This order has no items recorded against it.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Delivery</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit</Th>
                <Th align="right">Line total</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <Td>
                    <span className="block text-ink">{item.product_name}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-widest text-dim">
                      {labelOf(PRODUCT_LINE_LABELS, item.product_line)}
                    </span>
                  </Td>
                  <Td>
                    <Pill
                      label={labelOf(FULFILMENT_LABELS, item.fulfilment_status)}
                      tone={toneOf(FULFILMENT_TONES, item.fulfilment_status)}
                    />
                    {item.delivered_at && (
                      <span className="mt-1 block font-mono text-[10px] text-dim">
                        {formatDateTime(item.delivered_at)}
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {item.quantity}
                  </Td>
                  <Td align="right" mono>
                    {formatMoney(item.unit_price_minor, order.currency)}
                  </Td>
                  <Td align="right" mono>
                    {formatMoney(item.line_total_minor, order.currency)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card title="Total">
        <dl className="divide-y divide-line-soft text-sm">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-mono text-ink">
              {formatMoney(order.subtotal_minor, order.currency)}
            </dd>
          </div>
          {order.discount_minor > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-muted">Discount</dt>
              <dd className="font-mono text-ink">
                -{formatMoney(order.discount_minor, order.currency)}
              </dd>
            </div>
          )}
          {order.tax_minor > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <dt className="text-muted">Tax</dt>
              <dd className="font-mono text-ink">{formatMoney(order.tax_minor, order.currency)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between py-2.5">
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="font-mono font-semibold text-ink">
              {formatMoney(order.total_minor, order.currency)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Timeline">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            ["Placed", order.created_at],
            ["Paid", order.paid_at],
            ["Delivered", order.fulfilled_at],
            ["Cancelled", order.cancelled_at],
            ["Refunded", order.refunded_at],
          ].map(([label, value]) => (
            <div key={label as string} className="flex items-center justify-between gap-3">
              <dt className="text-muted">{label}</dt>
              <dd className="font-mono text-xs text-ink">
                {value ? formatDateTime(value as string) : "-"}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <p className="text-xs leading-relaxed text-dim">
        Delivery codes appear on this page once the supplier has issued them. If an item is
        still pending after payment, it is being retried automatically - contact support if it
        has not moved within a few hours.
      </p>
    </>
  );
}
