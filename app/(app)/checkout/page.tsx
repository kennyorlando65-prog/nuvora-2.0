import type { Metadata } from "next";
import Link from "next/link";

import { Card, PageHeader } from "@/components/app/ui";
import { requireUser } from "@/lib/app/session";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Checkout.
 *
 * WHY THIS IS NOT A BASKET PAGE. NUVORA has no basket and no wallet: an order is one
 * product and a quantity, paid for on its own. So there is nothing to accumulate here and
 * nothing to hold between visits. The buy control lives on the product page, where the
 * price and the quantity are both visible, and this page explains that flow rather than
 * pretending to be a cart.
 *
 * It exists as a real route because the payment gateway returns buyers to a checkout-ish
 * address in some flows, and a 404 at that moment is the worst possible time to show one.
 */
export default async function CheckoutPage() {
  await requireUser("/checkout");

  return (
    <>
      <PageHeader
        label="Checkout"
        title="One order, one payment"
        description="NUVORA has no basket and no balance. You choose a product, pay for that order, and it is delivered."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            step: "01",
            title: "Choose a product",
            body: "Open the store and pick what you need. The price shown is the price you pay.",
          },
          {
            step: "02",
            title: "Pay the gateway",
            body: "You are taken to the payment gateway. NUVORA never sees or stores your card details.",
          },
          {
            step: "03",
            title: "Get it delivered",
            body: "Once the gateway confirms payment, the supplier issues your code and it appears on your order.",
          },
        ].map((item) => (
          <article key={item.step} className="nuvora-card flex flex-col gap-2 p-5">
            <span className="font-mono text-xs tracking-widest text-accent">{item.step}</span>
            <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
            <p className="text-sm leading-relaxed text-muted">{item.body}</p>
          </article>
        ))}
      </div>

      <Card title="Start an order">
        <p className="text-sm leading-relaxed text-muted">
          Pick a product from the store to begin. If you have already paid and are looking for
          your delivery codes, they are on the order itself.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/store" className="nuvora-btn nuvora-btn-primary">
            Go to the store
          </Link>
          <Link href="/orders" className="nuvora-btn nuvora-btn-secondary">
            View my orders
          </Link>
        </div>
      </Card>

      <p className="text-xs leading-relaxed text-dim">
        If a payment was taken but no order appears, do not pay again. Contact support with the
        email address you used and the approximate time, and the order can be found from that.
      </p>
    </>
  );
}
