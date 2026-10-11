import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
 * Paystack.
 *
 * AUTHENTICITY: Paystack signs the raw request body with HMAC-SHA512 using the SECRET
 * KEY and sends the hex digest in the `x-paystack-signature` header. The digest is over
 * the exact bytes received, so the body MUST be read as text before any JSON parsing
 * that could reorder or drop whitespace.
 *
 * AMOUNTS: Paystack works in minor units (kobo), matching our storage exactly, so this
 * gateway needs no conversion - which is why there is no conversion helper here to
 * silently go wrong.
 *
 * DEDUPE ID: Paystack does not always send a unique top-level event id, so the key is
 * composed from the event name and the transaction id, which is unique per transaction.
 * When even that is absent the key is the SHA-256 of the raw body, which is stable for
 * an identical retry and different for a different payload.
 */

export type PaystackConfig = {
  secretKey: string;
  /** Overridable for tests; never point this at a non-Paystack host in production. */
  apiBaseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_API_BASE = "https://api.paystack.co";
const DEFAULT_TIMEOUT_MS = 15_000;

/** Paystack's status vocabulary mapped onto ours. Unrecognised values are refused. */
function mapTransactionStatus(raw: unknown): GatewayTransactionStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "success":
    case "successful":
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "abandoned":
      return "abandoned";
    case "reversed":
      return "reversed";
    case "pending":
    case "ongoing":
    case "processing":
    case "queued":
      return "pending";
    default:
      // Collapsing an unknown status into "succeeded" is how a store ships goods it was
      // never paid for. Refuse instead.
      throw new PaymentError(
        "malformed_response",
        `unrecognised Paystack transaction status: ${JSON.stringify(raw)}`,
      );
  }
}

export function toMinorFromPaystack(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new PaymentError(
        "malformed_response",
        `Paystack ${field} must be a whole number of kobo, received ${value}`,
      );
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new PaymentError(
    "malformed_response",
    `Paystack ${field} is not a whole number of kobo: ${JSON.stringify(value)}`,
  );
}

/**
 * Constant-time comparison. Length is compared first because timingSafeEqual throws on a
 * length mismatch, and the length of a hex digest is not secret.
 */
function safeEqualHex(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createPaystackGateway(config: PaystackConfig): PaymentGateway {
  const apiBase = (config.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = config.fetchImpl ?? fetch;

  if (!config.secretKey || config.secretKey.trim() === "") {
    throw new PaymentError(
      "gateway_not_configured",
      "PAYSTACK_SECRET_KEY is empty. Set it in Vercel -> Settings -> Environment Variables.",
    );
  }

  function signatureOf(rawBody: string): string {
    return createHmac("sha512", config.secretKey).update(rawBody, "utf8").digest("hex");
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
        throw new PaymentError("unauthorized", "Paystack rejected our secret key", response.status);
      }
      if (response.status === 429) {
        throw new PaymentError("rate_limited", "Paystack is rate limiting us", response.status);
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch {
        throw new PaymentError(
          "malformed_response",
          `Paystack returned a body that is not JSON for ${path}`,
        );
      }

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new PaymentError("malformed_response", `Paystack ${path} did not return an object`);
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new PaymentError("timeout", `Paystack did not respond within ${timeoutMs}ms`);
      }
      throw new PaymentError(
        "transport_error",
        `could not reach Paystack: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function readData(response: Record<string, unknown>, path: string): Record<string, unknown> {
    const data = response.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new PaymentError("malformed_response", `Paystack ${path} returned no data object`);
    }
    return data as Record<string, unknown>;
  }

  return {
    key: "paystack",
    isLive: true,

    verifyWebhookSignature({ rawBody, headers }): boolean {
      const received = headers.get("x-paystack-signature");
      // A missing header is a rejection, not an unauthenticated pass-through.
      if (!received) return false;
      return safeEqualHex(signatureOf(rawBody), received.trim().toLowerCase());
    },

    readEnvelope({ rawBody, payload }): WebhookEnvelope {
      const body = (typeof payload === "object" && payload !== null
        ? payload
        : {}) as Record<string, unknown>;
      const data = (typeof body.data === "object" && body.data !== null
        ? body.data
        : {}) as Record<string, unknown>;

      const eventType = String(body.event ?? "unknown");
      const transactionId = data.id;
      const eventId =
        transactionId !== undefined && transactionId !== null && String(transactionId).trim() !== ""
          ? `${eventType}:${String(transactionId)}`
          : `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;

      const reference = data.reference;
      return {
        eventId,
        eventType,
        providerReference:
          typeof reference === "string" && reference.trim() !== "" ? reference.trim() : null,
        raw: payload,
      };
    },

    async initializePayment(request: InitPaymentRequest): Promise<InitPaymentResult> {
      const amount = Number(request.amountMinor);
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new PaymentError(
          "gateway_error",
          `refusing to initialise a payment for a non-positive or unsafe amount: ${request.amountMinor}`,
        );
      }

      // The reference is OUR order number. Reusing it makes a retried checkout resolve to
      // the same Paystack transaction instead of creating a second one - which is exactly
      // the behaviour we want when a customer double-submits.
      const response = await api("POST", "/transaction/initialize", {
        email: request.email,
        amount,
        currency: request.currency,
        reference: request.orderNumber,
        callback_url: request.callbackUrl,
        ...(request.metadata ? { metadata: request.metadata } : {}),
      });

      if (response.status === false) {
        const message = String(response.message ?? "Paystack refused to initialise the payment");
        if (/duplicate/i.test(message)) {
          // Already initialised for this order. The caller reads the stored authorization
          // URL rather than treating this as a failure.
          return {
            ok: true,
            authorizationUrl: "",
            providerReference: request.orderNumber,
            reused: true,
          };
        }
        return { ok: false, code: "gateway_error", message };
      }

      const data = readData(response, "/transaction/initialize");
      const authorizationUrl = String(data.authorization_url ?? "");
      if (!authorizationUrl) {
        throw new PaymentError(
          "malformed_response",
          "Paystack returned no authorization_url to send the customer to",
        );
      }

      return {
        ok: true,
        authorizationUrl,
        providerReference: String(data.reference ?? request.orderNumber),
        reused: false,
      };
    },

    async verifyTransaction(providerReference: string): Promise<VerifiedTransaction> {
      const response = await api(
        "GET",
        `/transaction/verify/${encodeURIComponent(providerReference)}`,
      );

      if (response.status === false) {
        throw new PaymentError(
          "gateway_error",
          `Paystack could not verify ${providerReference}: ${String(response.message ?? "unknown")}`,
        );
      }

      const data = readData(response, "/transaction/verify");
      const fees = data.fees;

      return {
        status: mapTransactionStatus(data.status),
        providerReference: String(data.reference ?? providerReference),
        providerTransactionId:
          data.id === undefined || data.id === null ? null : String(data.id),
        amountMinor: toMinorFromPaystack(data.amount, "amount"),
        currency: String(data.currency ?? ""),
        channel: data.channel ? String(data.channel) : null,
        feeMinor: fees === undefined || fees === null ? null : toMinorFromPaystack(fees, "fees"),
        raw: data,
      };
    },
  };
}
