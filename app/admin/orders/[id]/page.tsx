import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Badge,
  Card,
  InlineLink,
  Notice,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from "@/components/admin/ui";
import {
  FULFILMENT_LABELS,
  FULFILMENT_TONES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONES,
  PRODUCT_LINE_LABELS,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  labelOf,
  marginPercent,
  toneOf,
} from "@/lib/admin/format";
import {
  ITEM_PUBLIC_COLUMNS,
  ORDER_LIST_COLUMNS,
  PAYMENT_PUBLIC_COLUMNS,
  getOrderHiddenDetail,
} from "@/lib/admin/orders";
import { requireAdminColumns } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Order detail" };

/** The UUID shape, checked before the value is used as a query argument. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Order detail.
 *
 * TWO CLIENTS, ON PURPOSE AND VISIBLY SO.
 * This page needs columns an admin session is not allowed to read: unit_cost_minor (which
 * is the whole margin calculation), supplier_reference, internal_note, engine_version and
 * the gateway's raw payload. Column grants are per role, not per row, so RLS cannot help -
 * the admin policy grants rows, and PostgREST still refuses the columns. Hence
 * `requireAdminColumns`, which runs the gate FIRST and then hands over the privileged
 * reader. Every figure below is labelled with which path produced it.
 *
 * The margin shown here is the REALISED margin at the time of sale, taken from the line's
 * own cost snapshot - not today's catalogue price. A price change after the sale must never
 * rewrite what a historic order earned.
 */
export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Validated before use. A malformed id would otherwise reach PostgREST and return a
  // database-level cast error, which is both noisier and less honest than a 404.
  if (!UUID.test(id)) notFound();

  const { supabase, privileged } = await requireAdminColumns(`/admin/orders/${id}`);

  // Readable by the admin session itself (all columns are in the allow-list).
  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_LIST_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Order detail query failed: ${error.message}`);
  if (!order) notFound();

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase
      .from("order_items")
      .select(ITEM_PUBLIC_COLUMNS)
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select(PAYMENT_PUBLIC_COLUMNS)
      .eq("order_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const itemRows = items ?? [];
  const paymentRows = payments ?? [];

  // The columns the admin session cannot read, fetched separately through the gated
  // service-role client. It fails soft: a missing key produces a labelled gap, never a
  // broken page.
  const hidden = await getOrderHiddenDetail(
    privileged,
    id,
    itemRows.map((i) => i.id as string),
    paymentRows.map((p) => p.id as string),
  );

  const currency = order.currency as string;
  const totalMinor = Number(order.total_minor);
  const subtotalMinor = Number(order.subtotal_minor);
  const discountMinor = Number(order.discount_minor);
  const taxMinor = Number(order.tax_minor);

  // Realised margin, summed from the lines' cost snapshots.
  const costedLines = itemRows.filter((item) => hidden.items[item.id as string]);
  const realisedCost = costedLines.reduce(
    (sum, item) => sum + (hidden.items[item.id as string]?.unit_cost_minor ?? 0) * Number(item.quantity),
    0,
  );
  const marginKnown = hidden.available && costedLines.length === itemRows.length && itemRows.length > 0;
  const realisedMargin = totalMinor - realisedCost;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/orders" className="text-xs text-muted underline hover:text-accent">
          Back to orders
        </Link>
      </div>

      <PageHeader
        label={order.order_number as string}
        title={order.email as string}
        description={
          order.user_id
            ? "Registered account. The customer can read this order through their own session, subject to Row Level Security."
            : "Guest checkout. This order has no account attached and is reachable only through this admin surface."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              label={labelOf(ORDER_STATUS_LABELS, order.status as string)}
              tone={toneOf(ORDER_STATUS_TONES, order.status as string)}
            />
            {Number(discountMinor) > 0 && (
              <Badge label={`Discount ${formatMoney(discountMinor, currency)}`} tone="warn" />
            )}
          </div>
        }
      />

      {!hidden.available && (
        <Notice tone="warn">
          <strong className="text-ink">Cost, margin and internal fields are unavailable.</strong>{" "}
          {hidden.unavailableReason} They are read through a privileged server reader, and
          without it the page still renders everything the admin session may read directly.
          Set <code className="font-mono text-xs text-accent">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
          in Vercel to restore them. Note that a cost of zero below means UNKNOWN, not free.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Amounts">
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Subtotal" value={formatMoney(subtotalMinor, currency)} />
            <Row label="Discount" value={formatMoney(discountMinor, currency)} />
            <Row label="Tax" value={formatMoney(taxMinor, currency)} />
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
              <dt className="font-medium text-ink">Total collected</dt>
              <dd className="font-mono text-sm text-ink">{formatMoney(totalMinor, currency)}</dd>
            </div>
          </dl>
          <p className="text-xs text-dim">
            These must satisfy subtotal - discount + tax = total. The database enforces that
            identity, so a figure here cannot be internally inconsistent.
          </p>
        </Card>

        <Card title="Commercials">
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Supplier cost (realised)"
              value={marginKnown ? formatMoney(realisedCost, currency) : "unavailable"}
            />
            <Row
              label="Margin (realised)"
              value={marginKnown ? formatSignedMoney(realisedMargin, currency) : "unavailable"}
            />
            <Row
              label="Margin rate"
              value={
                marginKnown ? formatPercent(marginPercent(realisedMargin, totalMinor)) : "unavailable"
              }
            />
          </dl>
          <p className="text-xs text-dim">
            Taken from each line&rsquo;s own cost snapshot, so a later catalogue price change
            cannot rewrite what this order earned. Never rendered on a customer-facing route.
          </p>
        </Card>

        <Card title="Timeline">
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Created" value={formatDateTime(order.created_at as string)} />
            <Row label="Paid" value={formatDateTime(order.paid_at as string | null)} />
            <Row label="Fulfilled" value={formatDateTime(order.fulfilled_at as string | null)} />
            <Row label="Cancelled" value={formatDateTime(order.cancelled_at as string | null)} />
            <Row label="Refunded" value={formatDateTime(order.refunded_at as string | null)} />
          </dl>
          <dl className="mt-2 flex flex-col gap-2 border-t border-line pt-2 text-sm">
            <Row
              label="Pricing engine"
              value={(hidden.order.engine_version ?? "unavailable").toString()}
            />
            <Row label="Billing country" value={(order.billing_country as string) ?? "-"} />
          </dl>
        </Card>
      </div>

      <Card
        title="Order lines"
        description="Each line carries the price and cost as they stood at the moment of sale."
      >
        {itemRows.length === 0 ? (
          <p className="text-sm text-muted">
            This order has no lines. That should be impossible - checkout writes the lines in
            the same transaction as the order - so treat it as a defect worth reporting rather
            than an ordinary empty state.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Line</Th>
                <Th align="right">Unit price</Th>
                <Th align="right">Unit cost</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Line total</Th>
                <Th>Fulfilment</Th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((item) => {
                const lineId = item.id as string;
                const itemHidden = hidden.items[lineId];
                const quantity = Number(item.quantity);
                const unitPrice = Number(item.unit_price_minor);
                const unitCost = itemHidden?.unit_cost_minor ?? null;

                return (
                  <tr key={lineId}>
                    <Td>
                      <span className="block text-ink">{item.product_name as string}</span>
                      <span className="block font-mono text-xs text-dim">
                        {item.product_id as string}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {labelOf(PRODUCT_LINE_LABELS, item.product_line as string)}
                      </span>
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(unitPrice, currency)}
                    </Td>
                    <Td align="right" mono>
                      {unitCost === null ? (
                        <span className="text-dim">unavailable</span>
                      ) : (
                        formatMoney(unitCost, currency)
                      )}
                    </Td>
                    <Td align="right" mono>
                      {quantity}
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(Number(item.line_total_minor), currency)}
                    </Td>
                    <Td>
                      <Badge
                        label={labelOf(FULFILMENT_LABELS, item.fulfilment_status as string)}
                        tone={toneOf(FULFILMENT_TONES, item.fulfilment_status as string)}
                      />
                      {itemHidden?.fulfilment_error && (
                        <span className="mt-1 block text-xs text-bad">
                          {itemHidden.fulfilment_error}
                        </span>
                      )}
                      {itemHidden?.supplier_reference && (
                        <span className="mt-1 block font-mono text-[10px] text-dim">
                          ref {itemHidden.supplier_reference}
                        </span>
                      )}
                      {item.delivered_at && (
                        <span className="mt-1 block text-xs text-dim">
                          {formatDateTime(item.delivered_at as string)}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Payments"
        description="A gateway callback is a claim, not a fact. A payment reaches succeeded only after the server re-verified it against the gateway API."
      >
        {paymentRows.length === 0 ? (
          <p className="text-sm text-muted">
            No payment attempt is recorded against this order. If the order is awaiting
            payment, this is normal; if it is marked paid, that is a contradiction worth
            investigating.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {paymentRows.map((payment) => {
              const paymentHidden = hidden.payments[payment.id as string];
              return (
                <div
                  key={payment.id as string}
                  className="flex flex-col gap-2 rounded-md border border-line-soft bg-panel-2 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-sm capitalize text-ink">
                        {payment.provider as string}
                      </span>
                      <Badge
                        label={labelOf(PAYMENT_STATUS_LABELS, payment.status as string)}
                        tone={toneOf(PAYMENT_STATUS_TONES, payment.status as string)}
                      />
                    </span>
                    <span className="font-mono text-sm text-ink">
                      {formatMoney(Number(payment.amount_minor), payment.currency as string)}
                    </span>
                  </div>

                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    <Row label="Reference" value={payment.provider_reference as string} mono />
                    <Row
                      label="Transaction id"
                      value={paymentHidden?.provider_transaction_id ?? "unavailable"}
                      mono
                    />
                    <Row label="Channel" value={(payment.channel as string) ?? "-"} />
                    <Row
                      label="Fee"
                      value={
                        payment.fee_minor === null
                          ? "not reported"
                          : formatMoney(Number(payment.fee_minor), payment.currency as string)
                      }
                    />
                    <Row
                      label="Verified"
                      value={formatDateTime(payment.verified_at as string | null)}
                    />
                    <Row label="Created" value={formatDateTime(payment.created_at as string)} />
                  </dl>

                  {paymentHidden?.failure_reason && (
                    <p className="rounded-md border border-bad/40 px-3 py-2 text-xs text-bad">
                      {paymentHidden.failure_reason}
                    </p>
                  )}

                  {paymentHidden?.raw_payload !== null &&
                    paymentHidden?.raw_payload !== undefined && (
                      <details className="rounded-md border border-line-soft bg-panel p-3">
                        <summary className="cursor-pointer text-xs text-muted">
                          Gateway payload (may contain payer metadata - handle with care)
                        </summary>
                        <pre className="mt-2 overflow-x-auto text-[10px] leading-relaxed text-dim">
                          {JSON.stringify(paymentHidden.raw_payload, null, 2)}
                        </pre>
                      </details>
                    )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Internal note" description="Staff only. Never returned to a buyer.">
        {hidden.available ? (
          hidden.order.internal_note ? (
            <p className="whitespace-pre-wrap text-sm text-ink">{hidden.order.internal_note}</p>
          ) : (
            <p className="text-sm text-dim">No internal note recorded against this order.</p>
          )
        ) : (
          <p className="text-sm text-dim">
            Unavailable without the privileged reader, as documented above.
          </p>
        )}
      </Card>

      <p className="text-xs text-dim">
        Fulfilment retry, refunds and manual status changes are not built yet. They are the
        next stage, together with the supplier webhook receiver - see the{" "}
        <InlineLink href="/admin/providers">providers</InlineLink> page for what a supplier
        still requires before any of it can run for real.
      </p>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-dim">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono text-xs" : "text-sm"} text-ink`}>{value}</dd>
    </div>
  );
}
