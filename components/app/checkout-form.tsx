"use client";

import { useState } from "react";

import { formatMoney } from "@/lib/admin/format";

/**
 * The buy control.
 *
 * WHAT THIS COMPONENT DOES NOT DO: it does not send a price. The request carries a product
 * id and a quantity, and the server prices the order from the database. The `unitPriceMinor`
 * prop is used only to render the running total on screen, so the customer sees the same
 * number the server will charge - it is never posted.
 *
 * The idempotency key is generated once per mount and reused across retries, so a
 * double-click or a flaky connection cannot create two orders for one intent. That is what
 * the key is for, and it is why it is not regenerated on submit.
 */
export function CheckoutForm({
  productId,
  productName,
  unitPriceMinor,
  currency,
}: {
  productId: string;
  productName: string;
  unitPriceMinor: number;
  currency: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => {
    // crypto.randomUUID is available in every browser this app supports; the fallback
    // exists so an older engine degrades to a still-unique-enough key rather than throwing.
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  });

  const total = unitPriceMinor * quantity;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: [{ productId, quantity }],
          email,
          idempotencyKey,
        }),
      });

      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        setError(payload.error?.message ?? "Checkout could not be completed. Please try again.");
        setBusy(false);
        return;
      }

      if (!payload.authorizationUrl) {
        setError(
          "The order was created but the payment page could not be opened. Check your orders page before paying again.",
        );
        setBusy(false);
        return;
      }

      // Full navigation, not a client route: the gateway is a different origin and the
      // customer must leave this app entirely to pay.
      window.location.href = payload.authorizationUrl;
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkout-email" className="nuvora-label">
          Delivery email
        </label>
        <input
          id="checkout-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="nuvora-input"
        />
        <p className="text-[11px] text-dim">
          Your codes and receipt are sent here. It does not have to be the address you signed
          in with.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="checkout-quantity" className="nuvora-label">
          Quantity
        </label>
        <input
          id="checkout-quantity"
          type="number"
          min={1}
          max={100}
          required
          value={quantity}
          onChange={(event) => {
            const next = Number(event.target.value);
            setQuantity(Number.isFinite(next) ? Math.min(100, Math.max(1, Math.trunc(next))) : 1);
          }}
          className="nuvora-input"
        />
      </div>

      <div className="flex items-center justify-between border-t border-line-soft pt-3">
        <span className="nuvora-label">Total</span>
        <span className="font-mono text-lg font-semibold text-ink">
          {formatMoney(total, currency)}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-bad/40 px-3 py-2 text-xs text-ink">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="nuvora-btn nuvora-btn-primary w-full">
        {busy ? "Opening payment" : `Pay for ${productName}`}
      </button>

      <p className="text-[11px] leading-relaxed text-dim">
        You will be taken to the payment gateway to pay. The final amount is calculated on our
        server before the charge.
      </p>
    </form>
  );
}
