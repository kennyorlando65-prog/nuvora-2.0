import "server-only";

import { PaymentError } from "./errors";
import { createFlutterwaveGateway } from "./flutterwave";
import { createPaystackGateway } from "./paystack";
import type { GatewayKey, PaymentGateway, WebhookProvider } from "./types";

export type PaymentEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the configured gateway.
 *
 * `PAYMENT_PROVIDER` is the single switch: it picks which gateway checkout uses AND which
 * webhook route is armed. A gateway with no secret key throws rather than constructing a
 * half-working object, so a missing key surfaces as a clear error at the first order
 * instead of as a mysteriously failing payment.
 */
export function getGateway(env: PaymentEnv = process.env): PaymentGateway {
  const raw = (env.PAYMENT_PROVIDER ?? "disabled").trim().toLowerCase();

  if (raw === "disabled") {
    throw new PaymentError(
      "payments_disabled",
      "PAYMENT_PROVIDER=disabled. Set PAYMENT_PROVIDER=paystack or flutterwave, and add that " +
        "gateway's keys, before taking orders.",
    );
  }

  if (raw === "paystack") {
    const secretKey = env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new PaymentError(
        "gateway_not_configured",
        "PAYMENT_PROVIDER=paystack requires PAYSTACK_SECRET_KEY. Set it in Vercel -> " +
          "Settings -> Environment Variables. Never commit it.",
      );
    }
    return createPaystackGateway({ secretKey });
  }

  if (raw === "flutterwave") {
    const secretKey = env.FLUTTERWAVE_SECRET_KEY?.trim();
    const webhookSecretHash = env.FLUTTERWAVE_WEBHOOK_SECRET_HASH?.trim();
    const missing = [
      ...(secretKey ? [] : ["FLUTTERWAVE_SECRET_KEY"]),
      ...(webhookSecretHash ? [] : ["FLUTTERWAVE_WEBHOOK_SECRET_HASH"]),
    ];
    if (missing.length > 0) {
      throw new PaymentError(
        "gateway_not_configured",
        `PAYMENT_PROVIDER=flutterwave requires ${missing.join(" and ")} to be set in Vercel -> ` +
          "Settings -> Environment Variables. Never commit these values.",
      );
    }
    return createFlutterwaveGateway({
      secretKey: secretKey as string,
      webhookSecretHash: webhookSecretHash as string,
    });
  }

  throw new PaymentError(
    "unknown_gateway",
    `Unrecognised PAYMENT_PROVIDER value ${JSON.stringify(raw)}. ` +
      "Expected paystack, flutterwave or disabled.",
  );
}

/**
 * Build the gateway that corresponds to a specific webhook route, INDEPENDENTLY of which
 * gateway checkout is currently using.
 *
 * This matters: after switching gateways, a Paystack webhook may still be in flight for an
 * order placed minutes earlier. That webhook must still verify against Paystack, using
 * Paystack's key - otherwise the last orders taken on the old gateway could never be
 * marked paid.
 */
export function getGatewayForWebhook(
  provider: WebhookProvider,
  env: PaymentEnv = process.env,
): PaymentGateway {
  if (provider === "paystack") {
    const secretKey = env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new PaymentError(
        "gateway_not_configured",
        "A Paystack webhook arrived but PAYSTACK_SECRET_KEY is not set, so its signature " +
          "cannot be verified. The event was not acted upon.",
      );
    }
    return createPaystackGateway({ secretKey });
  }

  const secretKey = env.FLUTTERWAVE_SECRET_KEY?.trim();
  const webhookSecretHash = env.FLUTTERWAVE_WEBHOOK_SECRET_HASH?.trim();
  const missing = [
    ...(secretKey ? [] : ["FLUTTERWAVE_SECRET_KEY"]),
    ...(webhookSecretHash ? [] : ["FLUTTERWAVE_WEBHOOK_SECRET_HASH"]),
  ];
  if (missing.length > 0) {
    throw new PaymentError(
      "gateway_not_configured",
      `A Flutterwave webhook arrived but ${missing.join(" and ")} is not set, so its ` +
        "authenticity cannot be checked. The event was not acted upon.",
    );
  }
  return createFlutterwaveGateway({
    secretKey: secretKey as string,
    webhookSecretHash: webhookSecretHash as string,
  });
}

/** True when a string is one of the two webhook-capable providers. */
export function isWebhookProvider(value: string): value is WebhookProvider {
  return value === "paystack" || value === "flutterwave";
}

/** A safe, human-readable summary of payment configuration. Never includes a key. */
export function describePaymentConfig(env: PaymentEnv = process.env): {
  gateway: GatewayKey;
  paystackKeyPresent: boolean;
  flutterwaveKeyPresent: boolean;
  flutterwaveHashPresent: boolean;
} {
  const raw = (env.PAYMENT_PROVIDER ?? "disabled").trim().toLowerCase();
  const gateway: GatewayKey =
    raw === "paystack" || raw === "flutterwave" ? raw : "disabled";

  return {
    gateway,
    paystackKeyPresent: Boolean(env.PAYSTACK_SECRET_KEY?.trim()),
    flutterwaveKeyPresent: Boolean(env.FLUTTERWAVE_SECRET_KEY?.trim()),
    flutterwaveHashPresent: Boolean(env.FLUTTERWAVE_WEBHOOK_SECRET_HASH?.trim()),
  };
}
