import { createHash, createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { PaymentError } from "./errors";
import { createFlutterwaveGateway, flutterwaveMajorToMinor } from "./flutterwave";
import { createPaystackGateway } from "./paystack";
import { getGateway, getGatewayForWebhook, describePaymentConfig } from "./index";
import { processWebhook, type PaymentUpsert, type WebhookStore } from "./webhook";
import type { PaymentGateway, WebhookProvider } from "./types";

// --- paystack ----------------------------------------------------------------

const PAYSTACK_KEY = "sk_test_not_a_real_key";

function paystackBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      id: 302961,
      reference: "NUV-20261011-001000",
      status: "success",
      amount: 500000,
      currency: "NGN",
      channel: "card",
      fees: 7500,
      ...overrides,
    },
  });
}

function paystackSignature(body: string): string {
  return createHmac("sha512", PAYSTACK_KEY).update(body, "utf8").digest("hex");
}

describe("Paystack gateway", () => {
  const gateway = () =>
    createPaystackGateway({ secretKey: PAYSTACK_KEY, fetchImpl: vi.fn() as unknown as typeof fetch });

  it("accepts a correctly signed body", () => {
    const body = paystackBody();
    expect(
      gateway().verifyWebhookSignature({
        rawBody: body,
        headers: new Headers({ "x-paystack-signature": paystackSignature(body) }),
      }),
    ).toBe(true);
  });

  it("REJECTS a tampered body", () => {
    const body = paystackBody();
    const signature = paystackSignature(body);
    const tampered = body.replace('"amount":500000', '"amount":1');
    expect(
      gateway().verifyWebhookSignature({
        rawBody: tampered,
        headers: new Headers({ "x-paystack-signature": signature }),
      }),
    ).toBe(false);
  });

  it("REJECTS a missing signature rather than passing it through", () => {
    expect(
      gateway().verifyWebhookSignature({ rawBody: paystackBody(), headers: new Headers() }),
    ).toBe(false);
  });

  it("composes a stable dedupe id from the event and transaction id", () => {
    const body = paystackBody();
    const envelope = gateway().readEnvelope({ rawBody: body, payload: JSON.parse(body) });
    expect(envelope.eventId).toBe("charge.success:302961");
    expect(envelope.providerReference).toBe("NUV-20261011-001000");
  });

  it("falls back to a body digest when there is no transaction id", () => {
    const body = JSON.stringify({ event: "transfer.success", data: { reference: "X" } });
    const envelope = gateway().readEnvelope({ rawBody: body, payload: JSON.parse(body) });
    expect(envelope.eventId).toBe(
      `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`,
    );
  });

  it("maps its status vocabulary and refuses an unknown status", async () => {
    const ok = vi.fn(async () =>
      new Response(JSON.stringify({ status: true, data: { status: "success", amount: 500000, currency: "NGN" } }), {
        status: 200,
      }),
    );
    const adapter = createPaystackGateway({
      secretKey: PAYSTACK_KEY,
      fetchImpl: ok as unknown as typeof fetch,
    });
    const verified = await adapter.verifyTransaction("NUV-1");
    expect(verified.status).toBe("succeeded");
    expect(verified.amountMinor).toBe(500000n);

    const weird = vi.fn(async () =>
      new Response(JSON.stringify({ status: true, data: { status: "banana", amount: 1, currency: "NGN" } }), {
        status: 200,
      }),
    );
    const adapter2 = createPaystackGateway({
      secretKey: PAYSTACK_KEY,
      fetchImpl: weird as unknown as typeof fetch,
    });
    await expect(adapter2.verifyTransaction("NUV-1")).rejects.toThrow(
      /unrecognised Paystack transaction status/,
    );
  });

  it("treats an already-initialised reference as reused, not as a failure", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: false, message: "Duplicate transaction reference" }), {
        status: 400,
      }),
    );
    const adapter = createPaystackGateway({
      secretKey: PAYSTACK_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await adapter.initializePayment({
      orderNumber: "NUV-1",
      email: "a@b.co",
      amountMinor: 500000n,
      currency: "NGN",
      callbackUrl: "https://example.com/done",
    });
    expect(result).toMatchObject({ ok: true, reused: true });
  });

  it("REFUSES to initialise a non-positive or unsafe amount", async () => {
    const adapter = createPaystackGateway({
      secretKey: PAYSTACK_KEY,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    await expect(
      adapter.initializePayment({
        orderNumber: "NUV-1",
        email: "a@b.co",
        amountMinor: 0n,
        currency: "NGN",
        callbackUrl: "https://example.com/done",
      }),
    ).rejects.toThrow(/non-positive or unsafe amount/);
  });

  it("never puts the secret key in a thrown message", () => {
    try {
      createPaystackGateway({ secretKey: "" });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain(PAYSTACK_KEY);
      expect((error as Error).message).toContain("PAYSTACK_SECRET_KEY");
    }
  });
});

// --- flutterwave -------------------------------------------------------------

const FW_KEY = "FLWSECK_TEST-not-real";
const FW_HASH = "the-configured-secret-hash";

function flutterwaveBody(status = "successful"): string {
  return JSON.stringify({
    event: "charge.completed",
    data: {
      id: 1163068,
      tx_ref: "NUV-20261011-001000",
      status,
      amount: 5000,
      currency: "NGN",
      payment_type: "card",
      app_fee: 35,
    },
  });
}

describe("Flutterwave gateway", () => {
  const gateway = ()
    : PaymentGateway =>
    createFlutterwaveGateway({
      secretKey: FW_KEY,
      webhookSecretHash: FW_HASH,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

  it("accepts the configured verif-hash", () => {
    expect(
      gateway().verifyWebhookSignature({
        rawBody: flutterwaveBody(),
        headers: new Headers({ "verif-hash": FW_HASH }),
      }),
    ).toBe(true);
  });

  it("REJECTS a wrong or absent verif-hash", () => {
    expect(
      gateway().verifyWebhookSignature({
        rawBody: flutterwaveBody(),
        headers: new Headers({ "verif-hash": "wrong" }),
      }),
    ).toBe(false);
    expect(gateway().verifyWebhookSignature({ rawBody: flutterwaveBody(), headers: new Headers() })).toBe(
      false,
    );
  });

  it("REFUSES to construct without a webhook secret hash, since nothing could be verified", () => {
    expect(() =>
      createFlutterwaveGateway({ secretKey: FW_KEY, webhookSecretHash: "" }),
    ).toThrow(/FLUTTERWAVE_WEBHOOK_SECRET_HASH/);
  });

  it("converts MAJOR units to minor, which is a 100x factor", () => {
    // Getting this wrong under-charges by a hundredfold, so it is asserted directly.
    expect(flutterwaveMajorToMinor(5000, "amount")).toBe(500000n);
    expect(flutterwaveMajorToMinor(100.5, "amount")).toBe(10050n);
    expect(flutterwaveMajorToMinor("12.34", "amount")).toBe(1234n);
  });

  it("refuses a non-numeric amount", () => {
    expect(() => flutterwaveMajorToMinor("lots", "amount")).toThrow(PaymentError);
  });

  it("sends the amount to Flutterwave in MAJOR units", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "success", data: { link: "https://pay.example/abc" } }), {
        status: 200,
      }),
    );
    const adapter = createFlutterwaveGateway({
      secretKey: FW_KEY,
      webhookSecretHash: FW_HASH,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await adapter.initializePayment({
      orderNumber: "NUV-1",
      email: "a@b.co",
      amountMinor: 500000n,
      currency: "NGN",
      callbackUrl: "https://example.com/done",
    });

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ amount: 5000, tx_ref: "NUV-1" });
  });

  it("reads the reference from tx_ref", () => {
    const body = flutterwaveBody();
    const envelope = gateway().readEnvelope({ rawBody: body, payload: JSON.parse(body) });
    expect(envelope.providerReference).toBe("NUV-20261011-001000");
    expect(envelope.eventId).toBe("charge.completed:1163068");
  });
});

// --- gateway resolution ------------------------------------------------------

describe("gateway resolution", () => {
  it("refuses to build a gateway while payments are disabled", () => {
    expect(() => getGateway({ PAYMENT_PROVIDER: "disabled" })).toThrow(/PAYMENT_PROVIDER=disabled/);
    expect(() => getGateway({})).toThrow(/PAYMENT_PROVIDER=disabled/);
  });

  it("names the missing key rather than failing obscurely", () => {
    expect(() => getGateway({ PAYMENT_PROVIDER: "paystack" })).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(() => getGateway({ PAYMENT_PROVIDER: "flutterwave" })).toThrow(
      /FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_WEBHOOK_SECRET_HASH/,
    );
  });

  it("rejects an unrecognised PAYMENT_PROVIDER", () => {
    expect(() => getGateway({ PAYMENT_PROVIDER: "stripe" })).toThrow(/Unrecognised PAYMENT_PROVIDER/);
  });

  it("builds the selected gateway when its keys are present", () => {
    expect(getGateway({ PAYMENT_PROVIDER: "paystack", PAYSTACK_SECRET_KEY: "k" }).key).toBe(
      "paystack",
    );
    expect(
      getGateway({
        PAYMENT_PROVIDER: "flutterwave",
        FLUTTERWAVE_SECRET_KEY: "k",
        FLUTTERWAVE_WEBHOOK_SECRET_HASH: "h",
      }).key,
    ).toBe("flutterwave");
  });

  it("settles a webhook for a gateway that is NO LONGER the active one", () => {
    // After switching to Flutterwave, a Paystack webhook for an order placed minutes
    // earlier must still verify against Paystack. Otherwise those orders never settle.
    const adapter = getGatewayForWebhook("paystack", {
      PAYMENT_PROVIDER: "flutterwave",
      FLUTTERWAVE_SECRET_KEY: "f",
      FLUTTERWAVE_WEBHOOK_SECRET_HASH: "h",
      PAYSTACK_SECRET_KEY: "p",
    });
    expect(adapter.key).toBe("paystack");
  });

  it("reports configuration without ever exposing a value", () => {
    const summary = describePaymentConfig({
      PAYMENT_PROVIDER: "paystack",
      PAYSTACK_SECRET_KEY: "super-secret",
    });
    expect(summary.gateway).toBe("paystack");
    expect(summary.paystackKeyPresent).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("super-secret");
  });
});

// --- webhook processing ------------------------------------------------------

function order(overrides: Partial<{ totalMinor: bigint; currency: string }> = {}) {
  return {
    id: "order-uuid-1",
    orderNumber: "NUV-20261011-001000",
    status: "pending_payment",
    currency: "NGN",
    totalMinor: 500_000n,
    ...overrides,
  };
}

/** In-memory double of WebhookStore. No database, no network. */
function memoryStore(target = order()) {
  const events = new Map<string, { id: string; signatureValid: boolean; processed?: string }>();
  const payments: PaymentUpsert[] = [];
  const orderState = { ...target };
  let succeeded = false;
  let seq = 0;

  const store: WebhookStore & {
    events: typeof events;
    payments: PaymentUpsert[];
    orderState: typeof orderState;
  } = {
    events,
    payments,
    orderState,

    async recordWebhookEvent(args) {
      const key = `${args.provider}:${args.eventId}`;
      const existing = events.get(key);
      if (existing) return { id: existing.id, isNew: false };
      const id = `event-${++seq}`;
      events.set(key, { id, signatureValid: args.signatureValid });
      return { id, isNew: true };
    },

    async markEventProcessed({ id, error }) {
      for (const record of events.values()) {
        if (record.id === id) record.processed = error ?? "ok";
      }
    },

    async findOrderByNumber(orderNumber) {
      return orderState.orderNumber === orderNumber ? { ...orderState } : null;
    },

    async hasSucceededPayment() {
      return succeeded;
    },

    async upsertPayment(_orderId, payment) {
      payments.push(payment);
      if (payment.status === "succeeded") succeeded = true;
    },

    async markOrderPaid({ orderId }) {
      expect(orderId).toBe(orderState.id);
      orderState.status = "paid";
    },
  };

  return store;
}

function gatewayReturning(verified: Partial<{
  status: "succeeded" | "failed" | "pending" | "abandoned" | "reversed";
  amountMinor: bigint;
  currency: string;
}>, ok = true): PaymentGateway {
  return {
    key: "paystack",
    isLive: true,
    verifyWebhookSignature: () => ok,
    readEnvelope: ({ payload }: { rawBody: string; payload: unknown }) => ({
      eventId: String((payload as { data?: { id?: unknown } })?.data?.id ?? "no-id"),
      eventType: "charge.success",
      providerReference:
        ((payload as { data?: { reference?: unknown } })?.data?.reference as string) ?? null,
      raw: payload,
    }),
    initializePayment: async () => ({
      ok: true,
      authorizationUrl: "https://pay.example/x",
      providerReference: "NUV-1",
      reused: false,
    }),
    verifyTransaction: async (reference: string) => ({
      status: verified.status ?? "succeeded",
      providerReference: reference,
      providerTransactionId: "302961",
      amountMinor: verified.amountMinor ?? 500_000n,
      currency: verified.currency ?? "NGN",
      channel: "card",
      feeMinor: 7_500n,
      raw: { source: "double" },
    }) as never,
  } as unknown as PaymentGateway;
}

const signedBody = JSON.stringify({
  event: "charge.success",
  data: { id: 302961, reference: "NUV-20261011-001000" },
});

async function run(args: {
  provider?: WebhookProvider;
  gateway: PaymentGateway;
  store: ReturnType<typeof memoryStore>;
  rawBody?: string;
}) {
  return processWebhook({
    provider: args.provider ?? "paystack",
    gateway: args.gateway,
    rawBody: args.rawBody ?? signedBody,
    headers: new Headers(),
    store: args.store,
  });
}

describe("processWebhook", () => {
  it("marks the order paid when the gateway CONFIRMS the exact amount", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({}), store });

    expect(result.outcome).toBe("paid");
    expect(store.orderState.status).toBe("paid");
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0]?.status).toBe("succeeded");
  });

  it("records verifiedAt on a succeeded payment, which the database requires", async () => {
    // payments_succeeded_requires_verification would reject a succeeded row without it.
    const store = memoryStore();
    await run({ gateway: gatewayReturning({}), store });
    expect(store.payments[0]?.verifiedAt).toBeInstanceOf(Date);
  });

  it("REJECTS a valid signature whose amount does not match the order", async () => {
    // This is the attack: a genuine webhook, replayed for a different or cheaper order.
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({ amountMinor: 1n }), store });

    expect(result.outcome).toBe("rejected");
    expect(store.orderState.status).toBe("pending_payment");
    expect(store.payments).toHaveLength(0);
  });

  it("REJECTS an underpayment even when the signature is valid", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({ amountMinor: 499_999n }), store });
    expect(result.outcome).toBe("rejected");
    expect(store.orderState.status).toBe("pending_payment");
  });

  it("REJECTS a currency mismatch", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({ currency: "USD" }), store });
    expect(result.outcome).toBe("rejected");
    expect(result.detail).toMatch(/Currency mismatch/);
    expect(store.orderState.status).toBe("pending_payment");
  });

  it("REJECTS an invalid signature BEFORE parsing or acting", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({}, false), store });

    expect(result.outcome).toBe("rejected");
    expect(result.httpStatus).toBe(401);
    expect(store.orderState.status).toBe("pending_payment");
    expect(store.payments).toHaveLength(0);
    // It IS recorded, so a burst of bad signatures is visible - but under a prefixed id so
    // it cannot occupy the id a genuine delivery will need.
    const recorded = [...store.events.keys()];
    expect(recorded[0]).toContain("invalid-signature:");
  });

  it("IGNORES a duplicate event without a second side effect", async () => {
    const store = memoryStore();
    const first = await run({ gateway: gatewayReturning({}), store });
    const second = await run({ gateway: gatewayReturning({}), store });

    expect(first.outcome).toBe("paid");
    expect(second.outcome).toBe("duplicate");
    expect(second.httpStatus).toBe(200);
    // Exactly one payment row: the retry did not create a second.
    expect(store.payments).toHaveLength(1);
  });

  it("does NOT record a second payment when one already succeeded", async () => {
    const store = memoryStore();
    await run({ gateway: gatewayReturning({}), store });

    // A DIFFERENT event id for the same order, with the order already paid.
    const result = await processWebhook({
      provider: "paystack",
      gateway: gatewayReturning({}),
      rawBody: JSON.stringify({ event: "charge.success", data: { id: 999, reference: store.orderState.orderNumber } }),
      headers: new Headers(),
      store,
    });

    expect(result.outcome).toBe("already_paid");
    expect(store.payments).toHaveLength(1);
  });

  it("records a non-succeeded transaction but leaves the order unpaid", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({ status: "failed" }), store });

    expect(result.outcome).toBe("not_succeeded");
    expect(store.orderState.status).toBe("pending_payment");
    expect(store.payments[0]?.status).toBe("failed");
    expect(store.payments[0]?.verifiedAt).toBeNull();
  });

  it("returns 500 when the gateway cannot be reached, so the gateway retries", async () => {
    const store = memoryStore();
    const failing = {
      ...gatewayReturning({}),
      verifyTransaction: async () => {
        throw new PaymentError("timeout", "no response");
      },
    } as unknown as PaymentGateway;

    const result = await run({ gateway: failing, store });
    expect(result.httpStatus).toBe(500);
    expect(store.orderState.status).toBe("pending_payment");
  });

  it("ignores a verified event whose reference matches no order", async () => {
    const store = memoryStore();
    const result = await processWebhook({
      provider: "paystack",
      gateway: gatewayReturning({}),
      rawBody: JSON.stringify({ event: "charge.success", data: { id: 5, reference: "NUV-DOES-NOT-EXIST" } }),
      headers: new Headers(),
      store,
    });
    expect(result.outcome).toBe("ignored");
    expect(result.detail).toMatch(/no order matches/);
  });

  it("never leaks a key or raw payload in its operator detail", async () => {
    const store = memoryStore();
    const result = await run({ gateway: gatewayReturning({ amountMinor: 1n }), store });
    expect(result.detail).not.toContain("raw");
    expect(result.detail).not.toContain("sk_");
  });
});
