/**
 * Supplier adapter contract.
 *
 * Every supplier integration implements this interface, so the application never
 * depends on a particular vendor's API shape. Adding or swapping a supplier means adding
 * a file under this directory and a registry entry - nothing in checkout, pricing or the
 * database changes.
 *
 * TWO RULES THAT SHAPE THIS INTERFACE
 *
 * 1. Fulfilment MUST be idempotent. Suppliers get called over a network, which can fail
 *    after the supplier has already acted: the response is lost, the caller times out,
 *    and the operation is retried. A supplier that delivers a second eSIM on retry
 *    costs real money. Every fulfilment call therefore carries an idempotency key (the
 *    order line id), and an adapter must treat a repeat of the same key as the SAME
 *    request rather than a new one.
 *
 * 2. A result must be honest about which mode produced it. Every result carries `mode`
 *    and `isSandbox`, and sandbox output is visibly marked in the payload itself. A
 *    sandbox delivery quietly presented as a real one would let a store take money for
 *    goods it never delivered.
 */

import type { ProductLine } from "@/lib/pricing/types";

/** Sandbox reproduces the supplier's behaviour locally; live sends real traffic. */
export type ProviderMode = "sandbox" | "live";

/**
 * What an adapter can do. Declared explicitly so the application can refuse an operation
 * rather than discovering the gap as a runtime crash mid-order.
 */
export type ProviderCapability =
  | "quote"        // resolve the current supplier cost for a mapped SKU
  | "fulfil"       // deliver the goods
  | "status"       // re-read a previous fulfilment by idempotency key
  | "health";      // connectivity / credential probe

export type ProviderQuoteRequest = {
  /** The supplier's own SKU, from products.supplier_reference. */
  supplierReference: string;
  productLine: ProductLine;
  quantity: number;
  /** The currency we expect the cost in, so a mismatch can be rejected. */
  currency: string;
};

export type ProviderQuote = {
  supplierReference: string;
  /** What the supplier charges US, in minor units. Never returned to a buyer. */
  unitCostMinor: bigint;
  currency: string;
  available: boolean;
  /** Supplier's own note, surfaced for support rather than parsed for logic. */
  note?: string;
  mode: ProviderMode;
  isSandbox: boolean;
};

export type ProviderFulfilRequest = {
  supplierReference: string;
  quantity: number;
  /**
   * The order line id. Doubles as the idempotency key: a retry of the same key must not
   * deliver again. Required - an adapter cannot safely be asked to fulfil without one.
   */
  idempotencyKey: string;
  /** Non-secret context the supplier may want, e.g. the order number for their logs. */
  metadata?: Readonly<Record<string, string>>;
};

export type ProviderFulfilmentState = "completed" | "pending" | "failed";

export type ProviderFulfilmentError = {
  code: string;
  message: string;
  /** Whether retrying the same request could plausibly succeed. */
  retryable: boolean;
};

export type ProviderFulfilResult = {
  state: ProviderFulfilmentState;
  /**
   * The customer-facing deliverable: the activation code, the QR payload. Null while
   * pending or after a failure. NEVER contains supplier credentials or our API key.
   */
  deliveryPayload: Readonly<Record<string, unknown>> | null;
  /** Supplier-side handle for this delivery, for support and reconciliation. */
  supplierReference: string;
  error?: ProviderFulfilmentError;
  mode: ProviderMode;
  isSandbox: boolean;
};

export type ProviderHealth = {
  ok: boolean;
  mode: ProviderMode;
  isSandbox: boolean;
  /** Human-readable detail. Must not include credentials. */
  detail: string;
};

/**
 * The contract every supplier integration satisfies.
 *
 * Read-only properties rather than methods because they are fixed at construction: an
 * adapter does not decide its own mode at call time, which keeps the sandbox/live
 * boundary auditable from one place (resolveAdapter in ./index.ts).
 */
export interface SupplierAdapter {
  /** Stable key matching suppliers.key in the database and the registry in ./index.ts. */
  readonly key: string;
  readonly displayName: string;
  /** Which product lines this supplier can serve. */
  readonly productLines: readonly ProductLine[];
  readonly capabilities: readonly ProviderCapability[];
  readonly mode: ProviderMode;
  readonly isSandbox: boolean;

  /**
   * Current supplier cost for a mapped SKU. Used to refresh our stored cost and to
   * confirm a product is still purchasable before we ask a customer to pay for it.
   */
  quote(request: ProviderQuoteRequest): Promise<ProviderQuote>;

  /** Deliver the goods. MUST be idempotent on request.idempotencyKey. */
  fulfil(request: ProviderFulfilRequest): Promise<ProviderFulfilResult>;

  /**
   * Re-read a previous fulfilment by idempotency key. Returns null when the supplier has
   * no record of it, which is what makes a safe retry possible after a timeout.
   */
  getStatus(idempotencyKey: string): Promise<ProviderFulfilResult | null>;

  /** Credential and connectivity probe. Never throws; reports failure as ok: false. */
  health(): Promise<ProviderHealth>;
}
