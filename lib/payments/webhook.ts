/**
 * Webhook processing.
 *
 * This module is deliberately a PURE function of its inputs plus a store interface, so the
 * whole money-critical path - signature check, idempotency, re-verification, amount match,
 * double-charge prevention - can be exercised in tests without a database or a network.
 *
 * THE ORDER OF OPERATIONS IS THE SECURITY PROPERTY:
 *
 *   1. verify the signature over the RAW body      (reject before parsing)
 *   2. insert into webhook_events                  (dedupe; UNIQUE (provider, event_id))
 *   3. re-verify with the gateway API              (the authoritative amount)
 *   4. compare gateway amount/currency to the order
 *   5. mark paid exactly once, guarded by the store
 *
 * Nothing is marked paid on the strength of the request body. Step 3 exists because a
 * body can be forged or replayed; only the gateway can say what money actually moved.
 */

import type { PaymentGateway, WebhookProvider } from "./types";

/** The order fields the decision depends on. */
export type WebhookOrder = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalMinor: bigint;
};

export type RecordEventResult = {
  /** Our row id for the event. */
  id: string;
  /** False when this exact (provider, event_id) had already been recorded. */
  isNew: boolean;
};

export type PaymentUpsert = {
  provider: WebhookProvider;
  providerReference: string;
  providerTransactionId: string | null;
  status: "succeeded" | "failed" | "pending" | "abandoned" | "reversed";
  amountMinor: bigint;
  currency: string;
  channel: string | null;
  feeMinor: bigint | null;
  /** Set only for a succeeded payment; the DB requires it for that status. */
  verifiedAt: Date | null;
  raw: Record<string, unknown>;
};

/**
 * Everything this module needs from storage. Implemented against Supabase in the route,
 * and against an in-memory double in tests.
 */
export interface WebhookStore {
  /** Insert the event; `isNew: false` means the unique constraint fired. */
  recordWebhookEvent(args: {
    provider: WebhookProvider;
    eventId: string;
    eventType: string;
    signatureValid: boolean;
    payload: unknown;
  }): Promise<RecordEventResult>;

  markEventProcessed(args: { id: string; error?: string }): Promise<void>;

  findOrderByNumber(orderNumber: string): Promise<WebhookOrder | null>;

  /** True when a `succeeded` payment already exists for this order. */
  hasSucceededPayment(orderId: string): Promise<boolean>;

  upsertPayment(orderId: string, payment: PaymentUpsert): Promise<void>;

  markOrderPaid(args: { orderId: string; paidAt: Date }): Promise<void>;
}

export type WebhookOutcome =
  | "paid"            // money confirmed; the order is now paid
  | "already_paid"    // a succeeded payment already existed; nothing changed
  | "not_succeeded"   // gateway says the transaction did not succeed
  | "duplicate"       // this event id had already been recorded
  | "rejected"        // signature invalid, or the claim did not match the order
  | "ignored";        // authenticated but nothing actionable

export type WebhookResult = {
  outcome: WebhookOutcome;
  /**
   * The order this event concerned, when it could be resolved.
   *
   * Added so the caller can act on a verified payment rather than only record it. Before this,
   * the route knew a payment had succeeded but not which order to fulfil, which is why a paid
   * order used to stop dead at 'paid'.
   */
  orderId?: string;
  /** Operator-facing detail. Never returned verbatim to the gateway body.
   *  Deliberately contains no card data, no key and no raw payload. */
  detail: string;
  /** HTTP status the route should return. */
  httpStatus: number;
};

export type ProcessWebhookArgs = {
  provider: WebhookProvider;
  gateway: PaymentGateway;
  rawBody: string;
  headers: Headers;
  store: WebhookStore;
  /** Injectable clock so tests are not time-dependent. */
  now?: () => Date;
};

export async function processWebhook(args: ProcessWebhookArgs): Promise<WebhookResult> {
  const { provider, gateway, rawBody, headers, store } = args;
  const now = args.now ?? (() => new Date());

  // -- 1. authenticity, before anything is parsed ------------------------------
  if (!gateway.verifyWebhookSignature({ rawBody, headers })) {
    // Recorded even when false: a burst of bad signatures is worth being able to see.
    // The event id is taken best-effort and is never used for decisions, so an attacker
    // cannot use this path to occupy an event id that a real delivery will need.
    let envelope: { eventId: string; eventType: string; raw: unknown } | null = null;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      const safe = gateway.readEnvelope({ rawBody, payload: parsed });
      envelope = { eventId: `invalid-signature:${safe.eventId}`, eventType: safe.eventType, raw: parsed };
    } catch {
      envelope = null;
    }

    if (envelope) {
      await store
        .recordWebhookEvent({
          provider,
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          signatureValid: false,
          payload: envelope.raw,
        })
        .catch(() => undefined); // never let bookkeeping mask the rejection
    }

    return {
      outcome: "rejected",
      detail: "Signature verification failed. The event was recorded and NOT acted upon.",
      httpStatus: 401,
    };
  }

  // -- 2. dedupe ----------------------------------------------------------------
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return { outcome: "ignored", detail: "Verified but the body is not JSON.", httpStatus: 400 };
  }

  const envelope = gateway.readEnvelope({ rawBody, payload: parsedBody });

  const record = await store.recordWebhookEvent({
    provider,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    signatureValid: true,
    payload: parsedBody,
  });

  if (!record.isNew) {
    // The unique index did its job. Responding 200 stops the gateway retrying an event we
    // have already handled, and guarantees no side effect runs twice.
    return {
      outcome: "duplicate",
      detail: `Event ${envelope.eventId} was already recorded. No side effect applied.`,
      httpStatus: 200,
    };
  }

  if (!envelope.providerReference) {
    await store.markEventProcessed({ id: record.id });
    return {
      outcome: "ignored",
      detail: `${envelope.eventType} carries no transaction reference; nothing to reconcile.`,
      httpStatus: 200,
    };
  }

  // -- 3. the authoritative answer ---------------------------------------------
  let verified;
  try {
    verified = await gateway.verifyTransaction(envelope.providerReference);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // Recorded as failed processing so a later sweep can retry it. Returning 500 asks the
    // gateway to retry, which is correct here: we could not confirm, so we do not know.
    await store.markEventProcessed({ id: record.id, error: detail });
    return {
      outcome: "ignored",
      detail: `Could not verify ${envelope.providerReference} with the gateway; left pending for retry.`,
      httpStatus: 500,
    };
  }

  const order = await store.findOrderByNumber(verified.providerReference);
  if (!order) {
    await store.markEventProcessed({
      id: record.id,
      error: `no order found for reference ${verified.providerReference}`,
    });
    return {
      outcome: "ignored",
      detail: "Verified, but no order matches this reference.",
      httpStatus: 200,
    };
  }

  if (verified.status !== "succeeded") {
    await store.upsertPayment(order.id, {
      provider,
      providerReference: verified.providerReference,
      providerTransactionId: verified.providerTransactionId,
      status: verified.status,
      amountMinor: verified.amountMinor,
      currency: verified.currency,
      channel: verified.channel,
      feeMinor: verified.feeMinor,
      verifiedAt: null,
      raw: verified.raw,
    });
    await store.markEventProcessed({ id: record.id });
    return {
      outcome: "not_succeeded",
      detail: `Gateway reports ${verified.status}; order ${order.orderNumber} left unpaid.`,
      httpStatus: 200,
    };
  }

  // -- 4. the claim must match the ORDER, using the gateway's figures -------------
  if (verified.currency !== order.currency) {
    await store.markEventProcessed({
      id: record.id,
      error: `currency mismatch: gateway ${verified.currency}, order ${order.currency}`,
    });
    return {
      outcome: "rejected",
      detail:
        `Currency mismatch on ${order.orderNumber}: gateway says ${verified.currency}, ` +
        `order is ${order.currency}. NOT marked paid.`,
      httpStatus: 200,
    };
  }

  if (verified.amountMinor !== order.totalMinor) {
    // Underpayment and overpayment are both refusals. Accepting an underpayment ships goods
    // for less than they cost; accepting an overpayment means we cannot reconcile our books.
    await store.markEventProcessed({
      id: record.id,
      error: `amount mismatch: gateway ${verified.amountMinor}, order ${order.totalMinor}`,
    });
    return {
      outcome: "rejected",
      detail:
        `Amount mismatch on ${order.orderNumber}: gateway says ${verified.amountMinor}, ` +
        `order is ${order.totalMinor} (${order.currency}). NOT marked paid.`,
      httpStatus: 200,
    };
  }

  // -- 5. mark paid, exactly once -----------------------------------------------
  if (await store.hasSucceededPayment(order.id)) {
    await store.markEventProcessed({ id: record.id });
    return {
      outcome: "already_paid",
      // Carried through deliberately: a gateway retrying an event is a free recovery path for a
      // fulfilment that failed on the first delivery of the same event. Fulfilment is idempotent
      // per line and skips completed lines, so re-running it is safe.
      orderId: order.id,
      detail: `${order.orderNumber} already has a succeeded payment. No second payment recorded.`,
      httpStatus: 200,
    };
  }

  const paidAt = now();
  await store.upsertPayment(order.id, {
    provider,
    providerReference: verified.providerReference,
    providerTransactionId: verified.providerTransactionId,
    status: "succeeded",
    amountMinor: verified.amountMinor,
    currency: verified.currency,
    channel: verified.channel,
    feeMinor: verified.feeMinor,
    // The database refuses status='succeeded' without this, which is what makes the
    // "we really did check" promise enforceable rather than aspirational.
    verifiedAt: paidAt,
    raw: verified.raw,
  });
  await store.markOrderPaid({ orderId: order.id, paidAt });
  await store.markEventProcessed({ id: record.id });

  return {
    outcome: "paid",
    orderId: order.id,
    detail: `Order ${order.orderNumber} verified and marked paid.`,
    httpStatus: 200,
  };
}
