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
 * THE DELIVERY ADDRESS IS NOT A CHOICE HERE, and that is a change from how this form worked.
 * It used to be a free-text field that said "It does not have to be the address you signed in
 * with", and the server accepted whatever was typed. That meant the email confirmation the
 * project requires proved nothing about the one address that actually matters - the address
 * paid goods are mailed to. A customer could order to any mailbox in the world.
 *
 * The address is now the confirmed address on the signed-in account, shown as a fact rather
 * than offered as an input. Presenting it as a read-only statement rather than a disabled box
 * is deliberate: a greyed-out field reads as something that is temporarily unavailable, while
 * a line of text under a heading reads as a fact about the order.
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
  accountEmail,
  emailConfirmed,
}: {
  productId: string;
  productName: string;
  unitPriceMinor: number;
  currency: string;
  /** The confirmed address on the session account. The order is delivered here. */
  accountEmail: string;
  /** False when the account has not confirmed its address yet. Blocks the order. */
  emailConfirmed: boolean;
}) {
  const [quantity, setQuantity] = useState(1);
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
          // Sent so the server can compare it against the account address and refuse a
          // mismatch. It is not the source of truth - the server derives that from the
          // session - so tampering with this value only produces a refusal.
          email: accountEmail,
          idempotencyKey,
        }),
      });

      const payload = (await response.json()) as {
        authorizationUrl?: string;
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        // The server's wording is used when it sends one, because those messages are written
        // for the customer - they name the situation, never an internal detail. The fallbacks
        // below exist only for a response that arrived without a message.
        const code = payload.error?.code;
        const fallback =
          code === "unauthenticated"
            ? "Your session has ended. Sign in again and retry the order."
            : code === "email_unconfirmed"
              ? "Confirm your email address first, then place the order."
              : code === "delivery_email_mismatch"
                ? "The delivery address must be the confirmed address on your account."
                : "Checkout could not be completed. Please try again.";

        setError(payload.error?.message ?? fallback);
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
      <div className="flex flex-col gap-1">
        <span className="nuvora-label">Delivery address</span>
        <span className="break-all text-sm text-ink">{accountEmail}</span>
        <p className="text-[11px] leading-relaxed text-dim">
          Your codes and receipt are sent here. It is the confirmed address on your account,
          which is why you cannot change it on this form.
        </p>
      </div>

      {!emailConfirmed && (
        <div className="nuvora-warn-band px-3 py-2.5">
          <p className="text-xs leading-relaxed text-ink">
            This address is not confirmed yet, so an order cannot be placed. Your codes are
            delivered by email, so we cannot take payment until it is confirmed.
          </p>
          <a
            href="/auth/confirm-email"
            className="mt-1.5 inline-block text-xs text-accent underline"
          >
            Send the confirmation link again
          </a>
        </div>
      )}

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

      <button
        type="submit"
        disabled={busy || !emailConfirmed}
        className="nuvora-btn nuvora-btn-primary w-full"
      >
        {busy ? "Opening payment" : `Pay for ${productName}`}
      </button>

      <p className="text-[11px] leading-relaxed text-dim">
        You will be taken to the payment gateway to pay. The final amount is calculated on our
        server before the charge.
      </p>
    </form>
  );
}
