import "server-only";

import { createHash } from "node:crypto";

import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  ENGINE_VERSION,
  PricingError,
  validateOrder,
  type PricingProduct,
  type PricingRule,
  type ValidatedOrder,
} from "@/lib/pricing";
import { PaymentError } from "@/lib/payments/errors";
import { getGateway } from "@/lib/payments";
import type { PaymentGateway } from "@/lib/payments/types";

/**
 * Checkout: from a basket of product ids to a payable order.
 *
 * THE CENTRAL RULE, restated because it is the whole point of this file: the request
 * carries product ids and quantities, NEVER prices. Every figure below is computed from
 * the database by the pricing engine. A client that posts a manipulated price gets the
 * server's price and a recorded audit trail, not a discount.
 *
 * The writes go through the service-role client, because orders and order_items have no
 * client write policy at all - RLS cannot validate a price, so a client that could write
 * an order could write its own total.
 */

export type CheckoutInput = {
  lines: { productId: string; quantity: number; clientUnitPriceMinor?: unknown }[];
  /**
   * The delivery address the browser offered.
   *
   * This is REQUEST data, not a fact. It is never the source of truth: `createOrder`
   * compares it against `authenticatedEmail` below and refuses the order if they disagree.
   */
  email: string;
  /** Client-generated. Makes a double-submitted checkout safe to retry. */
  idempotencyKey: string;
  billingCountry?: string;
  clientIp?: string;
  /**
   * THE OWNER, from the verified session - never from the request body.
   *
   * REQUIRED, not optional, and that is the point. `orders.user_id` existed in the schema
   * from the first migration but nothing ever populated it: every order was written with
   * user_id NULL and "owned" only by whatever email address the browser happened to post.
   * The RLS policies that grant a customer their own orders read `user_id = current_user_id()`,
   * so in practice no customer could read any order through the API - only through the
   * service-role path. Making this parameter non-optional means a future call site that
   * forgets the session cannot compile, rather than silently writing an ownerless order.
   */
  userId: string;
  /**
   * The address on the verified account.
   *
   * Kept as its own field, separate from the order's `email`, so the comparison below is
   * against a server-derived value. Comparing the delivery address to itself - which is what
   * validating `input.email` in the route would amount to - would prove nothing.
   */
  authenticatedEmail: string;
};

export type CheckoutResult = {
  orderNumber: string;
  currency: string;
  totalMinor: bigint;
  /** Where to send the customer. Empty when the order was already initialised. */
  authorizationUrl: string;
  providerReference: string;
  /** True when this call resolved to an order that already existed. */
  reused: boolean;
  /** How many lines carried a client price that disagreed with the server's. */
  priceMismatches: number;
  engineVersion: string;
};

/** Deliberately permissive: the gateway is the real validator. This only rejects junk. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function assertEmail(email: unknown): string {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    throw new PricingError("invalid_email", "a valid email address is required for delivery");
  }
  return email.trim().toLowerCase();
}

/** A uuid check, so a caller cannot pass a role name or an empty string as the owner. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUserId(userId: unknown): string {
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    throw new PricingError(
      "unauthenticated",
      "an order must belong to a signed-in account",
    );
  }
  return userId;
}

/**
 * The delivery address: the account's own confirmed address, and nothing else.
 *
 * WHY THE ADDRESS IS PINNED TO THE ACCOUNT RATHER THAN FREE TEXT.
 *
 * An order is fulfilled by mailing codes and a receipt to an address. If that address is
 * whatever the browser posted, then the email confirmation the project requires everywhere
 * else proves nothing about the one address that actually matters: an account holder could
 * order to any address in the world, and NUVORA would be delivering paid goods to a mailbox
 * nobody has verified. Pinning the delivery address to the confirmed account address means
 * "we can reach you" is true for the address we deliver to, by construction rather than by
 * assertion.
 *
 * This deliberately does NOT yet support ordering a code for somebody else. That is a real
 * product need - gifting, and the planned Business module - but it is a decision about
 * acceptable risk rather than a line of code, so it is left undone and flagged rather than
 * quietly allowed. See the note in the handover.
 */
function resolveDeliveryEmail(input: CheckoutInput): string {
  const account = assertEmail(input.authenticatedEmail);
  const requested = assertEmail(input.email);

  if (requested !== account) {
    throw new PricingError(
      "delivery_email_mismatch",
      "the delivery address must be the confirmed address on your account",
    );
  }

  return account;
}

function assertIdempotencyKey(value: unknown): string {
  // The column requires 8..200 characters; enforcing it here gives a clear error rather
  // than a constraint violation surfacing as a 500.
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 200) {
    throw new PricingError(
      "invalid_idempotency_key",
      "idempotencyKey must be between 8 and 200 characters",
    );
  }
  return value.trim();
}

/**
 * Salted hash of the client IP. A raw IP address is personal data and the schema has no
 * column for one; the column is nullable, so with no salt configured we store nothing
 * rather than storing something unsalted that could be brute-forced.
 */
function hashIp(ip: string | undefined, salt: string | undefined): string | null {
  if (!ip || !salt) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

async function loadProducts(productIds: string[]): Promise<Map<string, PricingProduct>> {
  const client = getServiceRoleClient();

  // The HIDDEN columns (supplier_cost_minor, supplier_currency, supplier_key) are read
  // with the service-role key on purpose: the pricing engine needs our cost to apply a
  // margin, and no client role can see them.
  const { data, error } = await client
    .from("products")
    .select(
      "id, sku, name, product_line, status, currency, base_price_minor, supplier_cost_minor, supplier_currency",
    )
    .in("id", productIds);

  if (error) throw new Error(`could not load products: ${error.message}`);

  const map = new Map<string, PricingProduct>();
  for (const row of data ?? []) {
    map.set(String(row.id), {
      id: String(row.id),
      sku: String(row.sku),
      name: String(row.name),
      product_line: row.product_line as PricingProduct["product_line"],
      status: row.status as PricingProduct["status"],
      currency: String(row.currency),
      base_price_minor: row.base_price_minor as number | string,
      supplier_cost_minor: row.supplier_cost_minor as number | string,
      supplier_currency: String(row.supplier_currency),
    });
  }
  return map;
}

async function loadRules(): Promise<PricingRule[]> {
  const client = getServiceRoleClient();

  // Only active rules are fetched; the engine independently re-checks the effective
  // window, so a rule expiring mid-request cannot slip through.
  const { data, error } = await client
    .from("pricing_rules")
    .select(
      "id, name, scope, product_line, product_id, margin_type, margin_percentage, margin_fixed_minor, rounding, min_price_minor, max_price_minor, fx_rate, priority, is_active, effective_from, effective_to",
    )
    .eq("is_active", true);

  if (error) throw new Error(`could not load pricing rules: ${error.message}`);
  return (data ?? []) as unknown as PricingRule[];
}

/**
 * Create the order, or return the existing one for a repeated idempotency key.
 *
 * The whole priced basket is recomputed on every call. That is intentional: it means a
 * retry after a price change still resolves consistently (the stored order wins, because
 * we return the existing row before pricing) and it means no cached figure can be replayed.
 */
export async function createOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const email = resolveDeliveryEmail(input);
  const userId = assertUserId(input.userId);
  const idempotencyKey = assertIdempotencyKey(input.idempotencyKey);
  const client = getServiceRoleClient();

  // -- existing order? ---------------------------------------------------------
  const existing = await client
    .from("orders")
    .select(
      "id, order_number, public_token, currency, total_minor, engine_version, status, user_id, email",
    )
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.error && existing.error.code !== "PGRST116") {
    throw new Error(`could not check for an existing order: ${existing.error.message}`);
  }

  if (existing.data) {
    /**
     * CLAIM AN OWNERLESS ORDER, under three conditions at once.
     *
     * Every order written before the owner column was populated has `user_id` NULL, and
     * `orders_select_own` reads `user_id = current_user_id()` - so those orders are
     * invisible to the very customers who placed them. Without this, the founder's own
     * test orders would stay unreachable and the fix would look broken.
     *
     * All three conditions are required, and each one closes a way this could be abused:
     *
     *   user_id is null          - an order that already has an owner is NEVER reassigned.
     *                              Two accounts cannot fight over one order, and a stale
     *                              retry from a different account cannot steal one.
     *   the stored email matches - the claim is only possible on an order that was already
     *                              addressed to THIS account's confirmed address, so the
     *                              person claiming it is the person it was delivered to.
     *   a valid session          - enforced by the caller, which refuses unauthenticated
     *                              requests before this function is reached.
     *
     * The email comparison is against `email` - derived from the verified session above -
     * and not against anything from the request body.
     */
    const storedUserId = existing.data.user_id as string | null;
    const storedEmail = String(existing.data.email ?? "").toLowerCase();

    if (storedUserId === null && storedEmail === email) {
      await client
        .from("orders")
        .update({ user_id: userId })
        .eq("id", String(existing.data.id))
        .is("user_id", null);
    }

    const payment = await client
      .from("payments")
      .select("provider_reference, authorization_url")
      .eq("order_id", String(existing.data.id))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return {
      orderNumber: String(existing.data.order_number),
      currency: String(existing.data.currency),
      totalMinor: BigInt(existing.data.total_minor as number | string),
      authorizationUrl: String(payment.data?.authorization_url ?? ""),
      providerReference: String(payment.data?.provider_reference ?? existing.data.order_number),
      reused: true,
      priceMismatches: 0,
      engineVersion: String(existing.data.engine_version),
    };
  }

  // -- price it from scratch ---------------------------------------------------
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new PricingError("empty_order", "an order must contain at least one line");
  }

  const productIds = input.lines.map((line) => String(line.productId ?? ""));
  const [productsById, rules] = await Promise.all([loadProducts(productIds), loadRules()]);

  const priced: ValidatedOrder = validateOrder({
    lines: input.lines.map((line) => ({
      productId: String(line.productId ?? ""),
      quantity: line.quantity,
      ...(line.clientUnitPriceMinor !== undefined
        ? { clientUnitPriceMinor: line.clientUnitPriceMinor }
        : {}),
    })),
    productsById,
    rules,
  });

  // -- the gateway must be usable before we accept the order --------------------
  const gateway: PaymentGateway = getGateway();

  // -- write the order ---------------------------------------------------------
  const orderInsert = await client
    .from("orders")
    .insert({
      // The owner, from the verified session. This is the column every customer-facing RLS
      // policy depends on, and the one that was previously left NULL on every order.
      user_id: userId,
      email,
      billing_country: input.billingCountry ?? null,
      currency: priced.currency,
      subtotal_minor: Number(priced.subtotalMinor),
      discount_minor: 0,
      tax_minor: 0,
      total_minor: Number(priced.subtotalMinor),
      idempotency_key: idempotencyKey,
      engine_version: priced.engineVersion || ENGINE_VERSION,
      created_ip_hash: hashIp(input.clientIp, process.env.IP_HASH_SALT),
    })
    .select("id, order_number, public_token")
    .single();

  if (orderInsert.error) {
    // A concurrent identical request won the race. Return theirs rather than failing.
    if (orderInsert.error.code === "23505") return createOrder(input);
    throw new Error(`could not create the order: ${orderInsert.error.message}`);
  }

  const orderId = String(orderInsert.data.id);
  const orderNumber = String(orderInsert.data.order_number);
  // The key the confirmation URL carries. Deliberately NOT the order number: that comes
  // from a sequence, so consecutive values are guessable and a URL built from one would let
  // anybody walk the day's orders. This is a 128-bit per-order secret the database minted.
  const publicToken = String(orderInsert.data.public_token);

  const itemsInsert = await client.from("order_items").insert(
    priced.lines.map((line) => ({
      order_id: orderId,
      product_id: line.productId,
      product_name: line.productName,
      product_line: line.productLine,
      product_attributes: {},
      unit_price_minor: Number(line.unitPriceMinor),
      // The cost snapshot comes from the pricing engine, which read it with the
      // service-role key. It is what the `never_below_cost` CHECK constraint compares to.
      unit_cost_minor: Number(line.unitCostMinor),
      quantity: line.quantity,
      line_total_minor: Number(line.lineTotalMinor),
      fulfilment_status: "pending" as const,
    })),
  );

  if (itemsInsert.error) {
    // Leaving a priced order with no lines would be worse than failing loudly: the order
    // would exist, be payable, and describe nothing.
    await client.from("orders").delete().eq("id", orderId);
    throw new Error(`could not write the order lines: ${itemsInsert.error.message}`);
  }

  // -- record any tampering attempt --------------------------------------------
  if (priced.priceMismatches > 0) {
    await client.from("audit_log").insert({
      action: "checkout.price_mismatch",
      entity_table: "orders",
      entity_id: orderId,
      after: {
        orderNumber,
        priceMismatches: priced.priceMismatches,
        note: "client-supplied unit price disagreed with the server price; server price was charged",
      },
    });
  }

  // -- ask the gateway to collect the money ------------------------------------
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

  const initialised = await gateway.initializePayment({
    orderNumber,
    email,
    amountMinor: priced.subtotalMinor,
    currency: priced.currency,
    callbackUrl: `${siteUrl}/orders/${encodeURIComponent(publicToken)}`,
    metadata: { order_number: orderNumber, engine_version: priced.engineVersion },
  });

  if (!initialised.ok) {
    throw new PaymentError(
      "gateway_error",
      `the payment gateway refused to initialise ${orderNumber}: ${initialised.message}`,
    );
  }

  const paymentInsert = await client.from("payments").insert({
    order_id: orderId,
    provider: gateway.key,
    provider_reference: initialised.providerReference,
    status: "initialised" as const,
    amount_minor: Number(priced.subtotalMinor),
    currency: priced.currency,
    authorization_url: initialised.authorizationUrl || null,
    raw_payload: { reused: initialised.reused },
  });

  if (paymentInsert.error) {
    throw new Error(`could not record the payment attempt: ${paymentInsert.error.message}`);
  }

  return {
    orderNumber,
    currency: priced.currency,
    totalMinor: priced.subtotalMinor,
    authorizationUrl: initialised.authorizationUrl,
    providerReference: initialised.providerReference,
    reused: initialised.reused,
    priceMismatches: priced.priceMismatches,
    engineVersion: priced.engineVersion,
  };
}
