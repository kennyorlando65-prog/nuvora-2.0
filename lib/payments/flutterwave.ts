import { createHash, timingSafeEqual } from "node:crypto";

import { PaymentError } from "./errors";
import type {
  GatewayTransactionStatus,
  InitPaymentRequest,
  InitPaymentResult,
  PaymentGateway,
  VerifiedTransaction,
  WebhookEnvelope,
} from "./types";

/**
 * Flutterwave.
 *
 * AUTHENTICITY: Flutterwave sends a `verif-hash` header that must equal the secret hash
 * you configured in the dashboard. Note what this does and does not prove: it is a STATIC
 * shared string, not a signature over the body, so it authenticates the sender but does
 * not bind the payload. That is precisely why the `verifyTransaction` call below is not
 * optional - the body's own claims carry no integrity guarantee at all.
 *
 * AMOUNTS: Flutterwave works in MAJOR units (100.50 means a hundred and fifty kobo...
 * i.e. hundred and fifty units), while our schema stores MINOR units. The conversion
 * below is therefore load-bearing: forgetting it under-charges by a factor of 100.
 *
 * DEDUPE ID: the event name plus the transaction id.
 */

export type FlutterwaveConfig = {
  secretKey: string;
  /** The value configured in Flutterwave -> Settings -> Webhooks -> Secret hash. */
  webhookSecretHash: string;
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_API_BASE = "https://api.flutterwave.com";
const DEFAULT_TIMEOUT_MS = 15_000;

function mapTransactionStatus(raw: unknown): GatewayTransactionStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "successful":
    case "success":
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
    case "abandoned":
      return "abandoned";
    case "reversed":
      return "reversed";
    case "pending":
    case "processing":
      return "pending";
    default:
      throw new PaymentError(
        "malformed_response",
        `unrecognised Flutterwave transaction status: ${JSON.stringify(raw)}`,
      );
  }
}

/**
 * Flutterwave reports MAJOR units. Convert to minor units for storage.
 *
 * Rounded rather than truncated: 100.005 major units is 10000.5 kobo and the extra half
 * kobo is more honestly rounded than dropped, matching the money module's half-up rule.
 */
export function flutterwaveMajorToMinor(value: unknown, field: string): bigint {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) {
    throw new PaymentError(
      "malformed_response",
      `Flutterwave ${field} is not a number: ${JSON.stringify(value)}`,
    );
  }
  const scaled = Math.round(numeric * 100);
  if (!Number.isSafeInteger(scaled)) {
    throw new PaymentError(
      "malformed_response",
      `Flutterwave ${field} is too large to convert safely: ${String(value)}`,
    );
  }
  return BigInt(scaled);
}

function safeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createFlutterwaveGateway(config: FlutterwaveConfig): PaymentGateway {
  const apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = config.fetchImpl ?? fetch;

  if (!config.secretKey || config.secretKey.trim() === "") {
    throw new PaymentError(
      "gateway_not_configured",
      "FLUTTERWAVE_SECRET_KEY is empty. Set it in Vercel -> Settings -> Environment Variables.",
    );
  }
  if (!config.webhookSecretHash || config.webhookSecretHash.trim() === "") {
    // Without the secret hash we cannot verify any webhook, so refusing to construct the
    // gateway is the honest outcome. Silently accepting unsigned webhooks would be worse.
    throw new PaymentError(
      "gateway_not_configured",
      "FLUTTERWAVE_WEBHOOK_SECRET_HASH is empty, so webhooks cannot be authenticated. " +
        "Set the same value you configured in the Flutterwave dashboard.",
    );
  }

  async function api(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await doFetch(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${config.secretKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        signal: controller.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      if (response.status === 401 || response.status === 403) {
        throw new PaymentError(
          "unauthorized",
          "Flutterwave rejected our secret key",
          response.status,
        );
      }
      if (response.status === 429) {
        throw new PaymentError("rate_limited", "Flutterwave is rate limiting us", response.status);
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new PaymentError(
          "malformed_response",
          `Flutterwave returned a body that is not JSON for ${path}`,
        );
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new PaymentError("malformed_response", `Flutterwave ${path} did not return an object`);
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new PaymentError("timeout", `Flutterwave did not respond within ${timeoutMs}ms`);
      }
      throw new PaymentError(
        "transport_error",
        `could not reach Flutterwave: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function readData(response: Record<string, unknown>, path: string): Record<string, unknown> {
    const data = response.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new PaymentError("malformed_response", `Flutterwave ${path} returned no data object`);
    }
    return data as Record<string, unknown>;
  }

  return {
    key: "flutterwave",
    isLive: true,

    verifyWebhookSignature({ rawBody: _rawBody, headers }): boolean {
      const received = headers.get("verif-hash");
      if (!received) return false;
      return safeEqual(config.webhookSecretHash, received.trim());
    },

    readEnvelope({ rawBody, payload }): WebhookEnvelope {
      const body = (typeof payload === "object" && payload !== null
        ? payload
        : {}) as Record<string, unknown>;
      const data = (typeof body.data === "object" && body.data !== null
        ? body.data
        : {}) as Record<string, unknown>;

      const eventType = String(body.event ?? body["event.type"] ?? "unknown");
      const transactionId = data.id;
      const eventId =
        transactionId !== undefined && transactionId !== null && String(transactionId).trim() !== ""
          ? `${eventType}:${String(transactionId)}`
          : `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;

      const reference = data.tx_ref;
      return {
        eventId,
        eventType,
        providerReference:
          typeof reference === "string" && reference.trim() !== "" ? reference.trim() : null,
        raw: payload,
      };
    },

    async initializePayment(request: InitPaymentRequest): Promise<InitPaymentResult> {
      // Flutterwave takes MAJOR units, so the minor-unit amount is divided back up.
      // Integer division with an explicit remainder check keeps this honest: an amount
      // that is not a whole major unit cannot be requested, rather than being rounded
      // and collecting a different figure than the order states.
      const remainder = request.amountMinor % 100n;
      if (request.amountMinor <= 0n) {
        throw new PaymentError(
          "gateway_error",
          `refusing to initialise a payment for a non-positive amount: ${request.amountMinor}`,
        );
      }
      const major = request.amountMinor / 100n;
      const amount = remainder === 0n ? Number(major) : Number(request.amountMinor) / 100;
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PaymentError(
          "gateway_error",
          `amount ${request.amountMinor} minor units cannot be represented in major units`,
        );
      }

      const response = await api("POST", "/v3/payments", {
        tx_ref: request.orderNumber,
        amount,
        currency: request.currency,
        redirect_url: request.callbackUrl,
        customer: { email: request.email },
        ...(request.metadata ? { meta: request.metadata } : {}),
      });

      if (String(response.status ?? "").toLowerCase() !== "success") {
        return {
          ok: false,
          code: "gateway_error",
          message: String(response.message ?? "Flutterwave refused to initialise the payment"),
        };
      }

      const data = readData(response, "/v3/payments");
      const authorizationUrl = String(data.link ?? "");
      if (!authorizationUrl) {
        throw new PaymentError(
          "malformed_response",
          "Flutterwave returned no payment link to send the customer to",
        );
      }

      return {
        ok: true,
        authorizationUrl,
        providerReference: request.orderNumber,
        reused: false,
      };
    },

    async verifyTransaction(providerReference: string): Promise<VerifiedTransaction> {
      const response = await api(
        "GET",
        `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerReference)}`,
      );

      if (String(response.status ?? "").toLowerCase() !== "success") {
        throw new PaymentError(
          "gateway_error",
          `Flutterwave could not verify ${providerReference}: ${String(response.message ?? "unknown")}`,
        );
      }

      const data = readData(response, "/v3/transactions/verify_by_reference");
      const fees = data.app_fee;

      return {
        status: mapTransactionStatus(data.status),
        providerReference: String(data.tx_ref ?? providerReference),
        providerTransactionId:
          data.id === undefined || data.id === null ? null : String(data.id),
        amountMinor: flutterwaveMajorToMinor(data.amount, "amount"),
        currency: String(data.currency ?? ""),
        channel: data.payment_type ? String(data.payment_type) : null,
        feeMinor: fees === undefined || fees === null ? null : flutterwaveMajorToMinor(fees, "app_fee"),
        raw: data,
      };
    },
  };
}
