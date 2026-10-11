import type { Metadata } from "next";
import Link from "next/link";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { supportEmail } from "@/lib/site";

/**
 * The page the payment gateway sends a customer back to.
 *
 * WHY THE URL CARRIES A TOKEN RATHER THAN AN ORDER NUMBER.
 *   Order numbers come from a sequence (NUV-YYYYMMDD-NNNNNN). That is the right shape for
 *   support and the wrong shape for a public URL: consecutive values are guessable, so a
 *   link built from one would let anybody walk the day's orders and read other people's
 *   delivery payloads - for an eSIM, a working activation code. The URL therefore carries a
 *   128-bit per-order secret the database minted (orders.public_token).
 *
 * WHY THIS READS THROUGH A DATABASE FUNCTION RATHER THAN THE TABLE.
 *   The buyer is usually a GUEST: checkout writes orders with user_id NULL, and every
 *   SELECT policy on orders is `user_id = current_user_id()`. So a guest order matches no
 *   policy and is unreadable by anon - correct for the API and useless here. Widening the
 *   policy would open the table to everyone; reading with the service role and returning
 *   whatever we like would hand this page the cost and margin columns. Instead the read
 *   goes through public.get_order_for_customer(token), which is SECURITY DEFINER and
 *   returns a CLOSED projection: cost, margin, supplier reference, internal note, engine
 *   version and the raw gateway payload are not in it and cannot be requested through it.
 *   That is what makes "supplier cost never reaches a customer" true on this path by
 *   construction rather than by remembering to exclude a field.
 *
 * NOINDEX because the page is private to whoever holds the link.
 */

export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type OrderLine = {
  product_name: string;
  product_line: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  fulfilment_status: string;
  delivered_at: string | null;
  delivery_payload: unknown;
};

type CustomerOrder = {
  order_number: string;
  email_masked: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  items: OrderLine[];
  payment: {
    provider: string;
    status: string;
    amount_minor: number;
    currency: string;
    verified_at: string | null;
  } | null;
};

const TOKEN_RE = /^[0-9a-f]{32}$/i;

/** Money is an integer of minor units everywhere in this codebase; this is where it prints. */
function money(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "-";
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

function when(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Human description of an order's state. Kept here rather than imported from the admin
 * module so the public page cannot accidentally pull in an admin-only constant.
 */
const ORDER_STATE: Record<string, { label: string; tone: string; note: string }> = {
  pending_payment: {
    label: "Awaiting payment",
    tone: "text-accent",
    note: "We have not received payment for this order yet. If you have just paid, refresh this page in a moment.",
  },
  paid: {
    label: "Paid",
    tone: "text-ok",
    note: "Payment received. We are preparing your items.",
  },
  fulfilling: {
    label: "In progress",
    tone: "text-info",
    note: "Delivery is in progress with the supplier.",
  },
  fulfilled: {
    label: "Delivered",
    tone: "text-ok",
    note: "Everything on this order has been delivered. Your codes are below.",
  },
  partially_fulfilled: {
    label: "Partly delivered",
    tone: "text-accent",
    note: "Some items have been delivered and the rest are still in progress. We are watching it.",
  },
  failed: {
    label: "Needs attention",
    tone: "text-bad",
    note: "We could not complete delivery automatically. Support has been alerted and will retry.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "text-muted",
    note: "This order was cancelled and will not be delivered.",
  },
  refunded: {
    label: "Refunded",
    tone: "text-muted",
    note: "This order has been refunded.",
  },
};

const LINE_STATE: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  fulfilled: "Delivered",
  failed: "Failed",
  skipped: "Not delivered",
};

/**
 * Supplier payloads differ per supplier, so this renders whatever came back as labelled
 * rows rather than pretending to know a fixed shape. Long values get a monospace block a
 * customer can copy - which is the whole point of an eSIM activation code.
 */
function DeliveryDetail({ payload }: { payload: unknown }) {
  if (payload === null || payload === undefined) return null;

  if (typeof payload === "string") {
    return (
      <pre className="mt-2 overflow-x-auto rounded-md border border-line-soft bg-bg px-3 py-2 font-mono text-xs text-ink">
        {payload}
      </pre>
    );
  }

  if (typeof payload !== "object") {
    return <p className="mt-2 font-mono text-xs text-ink">{String(payload)}</p>;
  }

  const entries = Object.entries(payload as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <dl className="mt-2 grid gap-1.5 rounded-md border border-line-soft bg-bg px-3 py-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-baseline justify-between gap-2">
          <dt className="font-mono text-[10px] uppercase tracking-widest text-dim">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="max-w-full break-all font-mono text-xs text-ink">
            {value === null || value === undefined
              ? "-"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function loadOrder(token: string): Promise<CustomerOrder | null> {
  // Shape-check before touching the database: the function would reject it anyway, but this
  // keeps a malformed URL from becoming a query.
  if (!TOKEN_RE.test(token)) return null;

  const client = getServiceRoleClient();
  const { data, error } = await client.rpc("get_order_for_customer", { p_token: token });

  if (error) {
    console.error(`[order] lookup failed: ${error.message}`);
    return null;
  }

  return (data as CustomerOrder | null) ?? null;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-16">
      <p className="nuvora-label">Order lookup</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">We cannot find that order</h1>
      <div className="mt-6 nuvora-card p-5">
        <p className="text-sm leading-relaxed text-muted">
          This link does not match an order on our side. The most common reasons are a link
          that was cut in half by an email client, or a page kept from an older attempt.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          If you have paid and cannot see your order, email{" "}
          <a className="text-accent underline underline-offset-2" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>{" "}
          with the email address you used and the approximate time. We can find the order from
          that.
        </p>
      </div>
      <Link
        href="/"
        className="mt-6 inline-block text-sm text-accent underline underline-offset-2"
      >
        Return to the store
      </Link>
    </div>
  );
}

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await loadOrder(token);

  if (!order) return <NotFound />;

  const state =
    ORDER_STATE[order.status] ?? {
      label: order.status,
      tone: "text-muted",
      note: "",
    };

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="nuvora-label">Order</p>
      <h1 className="mt-3 font-mono text-2xl font-semibold break-all sm:text-3xl">
        {order.order_number}
      </h1>

      <div className="mt-6 nuvora-card flex items-start gap-3 p-5">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            order.status === "fulfilled"
              ? "bg-ok"
              : order.status === "failed"
                ? "bg-bad"
                : "bg-accent"
          }`}
        />
        <div>
          <p className={`text-sm font-semibold ${state.tone}`}>{state.label}</p>
          {state.note && (
            <p className="mt-1 text-xs leading-relaxed text-muted">{state.note}</p>
          )}
          <p className="mt-2 text-xs text-dim">
            Placed {when(order.created_at)}
            {order.paid_at ? ` · Paid ${when(order.paid_at)}` : ""}
            {order.fulfilled_at ? ` · Delivered ${when(order.fulfilled_at)}` : ""}
          </p>
          <p className="mt-1 text-xs text-dim">
            A receipt for this order was sent to {order.email_masked}.
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Items</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {order.items.map((line, index) => {
            const delivered = line.fulfilment_status === "fulfilled";
            return (
              <li key={`${line.product_name}-${index}`} className="nuvora-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{line.product_name}</p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-dim">
                      {line.product_line}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-ink">
                      {money(line.line_total_minor, order.currency)}
                    </p>
                    {line.quantity > 1 && (
                      <p className="font-mono text-[10px] text-dim">
                        {line.quantity} x {money(line.unit_price_minor, order.currency)}
                      </p>
                    )}
                  </div>
                </div>

                <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-dim">
                  {LINE_STATE[line.fulfilment_status] ?? line.fulfilment_status}
                  {line.delivered_at ? ` · ${when(line.delivered_at)}` : ""}
                </p>

                {delivered ? (
                  <DeliveryDetail payload={line.delivery_payload} />
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    {line.fulfilment_status === "failed"
                      ? "This item could not be delivered automatically. Support is retrying it and will contact you."
                      : "We will show the code here as soon as the supplier issues it."}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Total</h2>
        <dl className="mt-3 nuvora-card divide-y divide-line-soft text-sm">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-muted">Subtotal</dt>
            <dd className="font-mono text-ink">{money(order.subtotal_minor, order.currency)}</dd>
          </div>
          {order.discount_minor > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">Discount</dt>
              <dd className="font-mono text-ink">
                -{money(order.discount_minor, order.currency)}
              </dd>
            </div>
          )}
          {order.tax_minor > 0 && (
            <div className="flex items-center justify-between px-4 py-3">
              <dt className="text-muted">Tax</dt>
              <dd className="font-mono text-ink">{money(order.tax_minor, order.currency)}</dd>
            </div>
          )}
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="font-semibold text-ink">Paid</dt>
            <dd className="font-mono font-semibold text-ink">
              {money(order.total_minor, order.currency)}
            </dd>
          </div>
        </dl>

        {order.payment && (
          <p className="mt-2 text-xs text-dim">
            Payment via {order.payment.provider}
            {order.payment.verified_at
              ? `, confirmed by the gateway ${when(order.payment.verified_at)}`
              : ", not yet confirmed by the gateway"}
            .
          </p>
        )}
      </section>

      <div className="mt-8 rounded-lg border border-line-soft p-4">
        <p className="text-xs leading-relaxed text-muted">
          Keep this link private - anyone who has it can see this order. If you have a problem
          with an order, email{" "}
          <a className="text-accent underline underline-offset-2" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>{" "}
          quoting the order number above.
        </p>
      </div>

      <Link
        href="/"
        className="mt-6 inline-block text-sm text-accent underline underline-offset-2"
      >
        Return to the store
      </Link>
    </div>
  );
}
