import { ProviderError } from "./errors";
import type {
  ProviderCapability,
  ProviderFulfilRequest,
  ProviderFulfilResult,
  ProviderFulfilmentState,
  ProviderHealth,
  ProviderQuote,
  ProviderQuoteRequest,
  SupplierAdapter,
} from "./types";

/**
 * Live eSIM adapter over the supplier's REST API.
 *
 * HONEST SCOPE NOTE. The supplier has not been chosen yet, so this adapter is written
 * against a DOCUMENTED, CONFIGURABLE request/response contract rather than a specific
 * vendor's field names:
 *
 *   POST {baseUrl}/quotes        { reference, quantity }        -> { cost_minor, currency, available }
 *   POST {baseUrl}/fulfilments   { reference, quantity, key }   -> { id, status, payload }
 *   GET  {baseUrl}/fulfilments/{key}                            -> { id, status, payload }
 *
 * Before switching PROVIDER_MODE to live against a real supplier, confirm these paths,
 * field names and the authentication scheme against that supplier's documentation and
 * adjust mapX() below. Do not assume this file already matches a vendor: the mapping
 * layer is the one part that is expected to change, and it is isolated here so nothing
 * else has to.
 *
 * Everything around the mapping IS production-grade and does not need revisiting: hard
 * timeout, bounded retries with backoff, no retry on auth failures, and error responses
 * translated into typed ProviderErrors.
 */

export type LiveEsimConfig = {
  baseUrl: string;
  apiKey: string;
  /** Optional extra header name/value some suppliers require for auth. */
  authHeaderName?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const ESIM_LINES = ["esim"] as const;
const CAPABILITIES: readonly ProviderCapability[] = ["quote", "fulfil", "status", "health"];
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function minorFrom(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ProviderError("malformed_response", `${field} must be a whole minor-unit amount`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  throw new ProviderError(
    "malformed_response",
    `${field} is not a whole minor-unit amount: ${JSON.stringify(value)}`,
  );
}

function mapStatus(raw: unknown): ProviderFulfilmentState {
  const value = String(raw ?? "").toLowerCase();
  if (["completed", "complete", "success", "succeeded", "delivered"].includes(value)) {
    return "completed";
  }
  if (["pending", "processing", "queued", "in_progress"].includes(value)) return "pending";
  if (["failed", "error", "rejected", "cancelled"].includes(value)) return "failed";
  // An unrecognised status is NOT treated as success. Guessing here would risk marking
  // an undelivered order as fulfilled.
  throw new ProviderError(
    "malformed_response",
    `unrecognised supplier fulfilment status: ${JSON.stringify(raw)}`,
  );
}

export function createLiveEsimAdapter(config: LiveEsimConfig): SupplierAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const doFetch = config.fetchImpl ?? fetch;

  if (!/^https:\/\//.test(baseUrl)) {
    // A plain-http supplier endpoint would leak our API key over the wire.
    throw new ProviderError(
      "provider_not_configured",
      `ESIM_PROVIDER_BASE_URL must use https, received ${JSON.stringify(config.baseUrl)}`,
    );
  }

  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${config.apiKey}`,
          accept: "application/json",
        };
        if (body !== undefined) headers["content-type"] = "application/json";
        if (config.authHeaderName) headers[config.authHeaderName] = config.apiKey;

        const response = await doFetch(`${baseUrl}${path}`, {
          method,
          headers,
          signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

        if (response.status === 401 || response.status === 403) {
          throw new ProviderError("unauthorized", "supplier rejected our credentials", {
            status: response.status,
            retryable: false,
          });
        }
        if (response.status === 404) {
          throw new ProviderError("not_found", "supplier has no record of this reference", {
            status: response.status,
            retryable: false,
          });
        }
        if (response.status === 429) {
          throw new ProviderError("rate_limited", "supplier is rate limiting us", {
            status: response.status,
            retryable: true,
          });
        }
        if (response.status >= 500) {
          throw new ProviderError("supplier_error", `supplier returned ${response.status}`, {
            status: response.status,
            retryable: true,
          });
        }
        if (!response.ok) {
          throw new ProviderError(
            "supplier_error",
            `supplier returned ${response.status} for ${path}`,
            { status: response.status, retryable: false },
          );
        }

        try {
          return await response.json();
        } catch {
          throw new ProviderError(
            "malformed_response",
            `supplier returned a body that is not JSON for ${path}`,
            { retryable: false },
          );
        }
      } catch (error) {
        if (error instanceof ProviderError) {
          lastError = error;
          if (!error.retryable) throw error;
        } else if (error instanceof Error && error.name === "AbortError") {
          lastError = new ProviderError(
            "timeout",
            `supplier did not respond within ${timeoutMs}ms for ${path}`,
          );
        } else {
          lastError = new ProviderError(
            "transport_error",
            `could not reach the supplier for ${path}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        if (attempt < maxAttempts) {
          // Exponential backoff: 200ms, 400ms. Bounded so a bad supplier cannot hold a
          // serverless invocation open past its own timeout.
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ProviderError("transport_error", `call to ${path} failed`);
  }

  function readRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ProviderError(
        "malformed_response",
        `${path} returned ${Array.isArray(value) ? "an array" : typeof value}, expected an object`,
      );
    }
    return value as Record<string, unknown>;
  }

  function mapFulfilment(raw: unknown, supplierReference: string): ProviderFulfilResult {
    const record = readRecord(raw, "fulfilments");
    const state = mapStatus(record.status ?? record.state);

    const payload =
      typeof record.payload === "object" && record.payload !== null
        ? (record.payload as Record<string, unknown>)
        : null;

    if (state === "completed" && payload === null) {
      throw new ProviderError(
        "malformed_response",
        "supplier reported completion without a delivery payload",
      );
    }

    const failure =
      state === "failed"
        ? {
            code: String(record.error_code ?? "supplier_error"),
            message: String(record.error_message ?? "supplier reported a failure"),
            retryable: Boolean(record.retryable ?? false),
          }
        : undefined;

    return {
      state,
      deliveryPayload: payload,
      supplierReference: String(record.reference ?? supplierReference),
      ...(failure ? { error: failure } : {}),
      mode: "live",
      isSandbox: false,
    };
  }

  return {
    key: "esim-live",
    displayName: "eSIM supplier (live)",
    productLines: ESIM_LINES,
    capabilities: CAPABILITIES,
    mode: "live",
    isSandbox: false,

    async quote(request: ProviderQuoteRequest): Promise<ProviderQuote> {
      const raw = await call("POST", "/quotes", {
        reference: request.supplierReference,
        quantity: request.quantity,
        currency: request.currency,
      });
      const record = readRecord(raw, "/quotes");

      const currency = String(record.currency ?? "");
      if (currency && currency !== request.currency) {
        // Mixing currencies silently would corrupt our margin, so this is a hard stop.
        throw new ProviderError(
          "currency_mismatch",
          `supplier quoted ${currency} but we expected ${request.currency}`,
        );
      }

      return {
        supplierReference: String(record.reference ?? request.supplierReference),
        unitCostMinor: minorFrom(record.cost_minor, "cost_minor"),
        currency: currency || request.currency,
        available: record.available !== false,
        ...(record.note ? { note: String(record.note) } : {}),
        mode: "live",
        isSandbox: false,
      };
    },

    async fulfil(request: ProviderFulfilRequest): Promise<ProviderFulfilResult> {
      // The idempotency key travels WITH the request. This is what lets a supplier
      // recognise a retry rather than delivering twice.
      const raw = await call("POST", "/fulfilments", {
        reference: request.supplierReference,
        quantity: request.quantity,
        key: request.idempotencyKey,
        ...(request.metadata ? { metadata: request.metadata } : {}),
      });
      return mapFulfilment(raw, request.supplierReference);
    },

    async getStatus(idempotencyKey: string): Promise<ProviderFulfilResult | null> {
      try {
        const raw = await call("GET", `/fulfilments/${encodeURIComponent(idempotencyKey)}`);
        return mapFulfilment(raw, "");
      } catch (error) {
        // "Unknown to the supplier" is an expected answer here, not a failure: it is what
        // tells the caller it is safe to submit the fulfilment for the first time.
        if (error instanceof ProviderError && error.code === "not_found") return null;
        throw error;
      }
    },

    async health(): Promise<ProviderHealth> {
      try {
        await call("GET", "/quotes/ping");
        return {
          ok: true,
          mode: "live",
          isSandbox: false,
          detail: "Supplier reachable and credentials accepted.",
        };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "transport_error";
        return {
          ok: false,
          mode: "live",
          isSandbox: false,
          // No credential value is ever included, only the failure classification.
          detail: `Supplier probe failed with ${code}.`,
        };
      }
    },
  };
}
