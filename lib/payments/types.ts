/**
 * Payment gateway contract.
 *
 * Paystack and Flutterwave are different products with different payloads, so they sit
 * behind one interface exactly as suppliers do. Nothing outside this directory branches
 * on which gateway is active.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE:
 *
 *   A webhook is a CLAIM, not a fact.
 *
 * Anybody who learns the URL can POST to it, so an inbound request proves nothing on its
 * own. Two independent things must hold before an order is marked paid:
 *
 *   1. the request is authentic (a valid signature over the raw body), and
 *   2. the money is confirmed by asking the gateway's own API what happened, using our
 *      secret key. The amount and currency used are the ones the GATEWAY reports, never
 *      the ones the webhook body claims, and they must match the order exactly.
 *
 * Skipping (2) is the classic way a store gets robbed: replay a captured "success" body
 * with a large order number and watch goods ship against no money. Signature checking
 * alone is not enough, because a signature is only as secret as the endpoint's history.
 */

export type GatewayKey = "paystack" | "flutterwave" | "disabled";

/** The two gateways that can actually send us webhooks. */
export type WebhookProvider = "paystack" | "flutterwave";

export const WEBHOOK_PROVIDERS: readonly WebhookProvider[] = ["paystack", "flutterwave"] as const;

export type InitPaymentRequest = {
  /** Our own human-readable order number. Used as the gateway reference. */
  orderNumber: string;
  email: string;
  /** Amount to collect, in minor units. Always server-computed. */
  amountMinor: bigint;
  currency: string;
  /** Where the gateway sends the customer back to. */
  callbackUrl: string;
  /** Non-secret context passed through to the gateway for reconciliation. */
  metadata?: Readonly<Record<string, string>>;
};

export type InitPaymentResult =
  | {
      ok: true;
      /** Where to send the customer to pay. */
      authorizationUrl: string;
      /** The gateway's reference, which is what we later verify. */
      providerReference: string;
      /** True when the gateway reported this reference already existed. */
      reused: boolean;
    }
  | { ok: false; code: string; message: string };

/**
 * Normalised transaction state. Each gateway's vocabulary is mapped onto these five and
 * anything unrecognised is refused rather than guessed at - an unknown status must never
 * collapse into "succeeded".
 */
export type GatewayTransactionStatus =
  | "succeeded"
  | "failed"
  | "abandoned"
  | "pending"
  | "reversed";

export type VerifiedTransaction = {
  status: GatewayTransactionStatus;
  providerReference: string;
  providerTransactionId: string | null;
  /** Minor units, as reported by the gateway. Authoritative over the webhook body. */
  amountMinor: bigint;
  currency: string;
  channel: string | null;
  feeMinor: bigint | null;
  /** Raw gateway response. Server-side only; never returned to a browser. */
  raw: Record<string, unknown>;
};

/**
 * What a webhook route needs to know before it does anything. Extracted from the body
 * without yet trusting the body - authenticity is checked separately and first.
 */
export type WebhookEnvelope = {
  /** Dedupe key. Together with the provider it is UNIQUE in webhook_events. */
  eventId: string;
  eventType: string;
  /** The reference to re-verify with the gateway. Null when absent or unusable. */
  providerReference: string | null;
  /** Parsed body, for the audit record. Never the source of the amount. */
  raw: unknown;
};

export interface PaymentGateway {
  readonly key: GatewayKey;
  /** True when this gateway can move real money. */
  readonly isLive: boolean;

  /**
   * Constant-time verification of the request signature against the RAW body.
   * Must be called before the body is parsed or trusted.
   */
  verifyWebhookSignature(args: { rawBody: string; headers: Headers }): boolean;

  /** Pull the dedupe id and reference out of a body that has passed verification. */
  readEnvelope(args: { rawBody: string; payload: unknown }): WebhookEnvelope;

  /** Ask the gateway to start a payment. */
  initializePayment(request: InitPaymentRequest): Promise<InitPaymentResult>;

  /** Ask the gateway what actually happened. The authoritative answer. */
  verifyTransaction(providerReference: string): Promise<VerifiedTransaction>;
}
