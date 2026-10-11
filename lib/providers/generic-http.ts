import { ProviderError } from "./errors";
import {
  type EndpointMapping,
  type ProviderMapping,
  buildRequestBody,
  mapStatus,
  readPath,
  readPathRequired,
  resolveEndpoint,
  DEFAULT_MAPPING,
} from "./mapping";
import type {
  ProviderCapability,
  ProviderFulfilRequest,
  ProviderFulfilResult,
  ProviderHealth,
  ProviderQuote,
  ProviderQuoteRequest,
  ProviderMode,
  SupplierAdapter,
} from "./types";
import type { ProductLine } from "@/lib/pricing/types";

/**
 * A supplier adapter driven entirely by configuration.
 *
 * This is the realisation of the provider-configuration model: the transport is fixed and
 * audited once, and everything a particular supplier does differently - endpoint paths, field
 * names, status vocabulary, auth scheme - arrives as data from the `suppliers` row.
 *
 * WHAT CONFIGURATION CANNOT COVER, stated plainly because the admin UI repeats it: this
 * adapter speaks JSON over HTTPS with a bearer/api-key/basic credential. A supplier using
 * SOAP, a signed request body, a non-JSON response, or a callback-only model needs a bespoke
 * adapter file. Configuration is not a substitute for an integration.
 *
 * THE TRANSPORT IS NOT CONFIGURABLE, ON PURPOSE. Timeout, retry count, retry-eligibility and
 * the https requirement are the same for every supplier. Exposing them per supplier would
 * invite a setting that makes a supplier look reachable when it is not, and the retry rules
 * are load-bearing: retrying a 401 never works and hammers a supplier that has already said no.
 */

export type GenericAuthScheme = "bearer" | "api_key_header" | "basic" | "query_param" | "none";

export type GenericHttpConfig = {
  /** Stable key matching suppliers.key. */
  key: string;
  displayName: string;
  baseUrl: string;
  /** Plaintext credential, decrypted server-side for the duration of a call. Never logged. */
  apiKey?: string | undefined;
  authScheme: GenericAuthScheme;
  /** Header name for `api_key_header`. */
  authHeaderName?: string | undefined;
  mode: ProviderMode;
  productLines: readonly ProductLine[];
  capabilities: readonly ProviderCapability[];
  mapping: ProviderMapping;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/** Only whole minor-unit amounts are accepted. A float here is a rounding bug waiting to happen. */
function minorFrom(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ProviderError("malformed_response", `${field} must be a whole minor-unit amount`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new ProviderError(
    "malformed_response",
    `${field} is not a whole minor-unit amount: ${JSON.stringify(value)}`,
  );
}

export function createGenericHttpAdapter(config: GenericHttpConfig): SupplierAdapter {
  // Trailing slashes are stripped once, so a mapping path is always appended to a clean root.
  const root = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const doFetch = config.fetchImpl ?? fetch;
  const endpoints: Partial<EndpointMapping> = { ...DEFAULT_MAPPING.endpoints, ...config.mapping.endpoints };

  // A supplier endpoint reached over plain http would put our credential on the wire in
  // clear text. Refused at construction rather than at the first order.
  if (!/^https:\/\//.test(root)) {
    throw new ProviderError(
      "provider_not_configured",
      `base URL must use https, received ${JSON.stringify(config.baseUrl)}`,
    );
  }

  if (config.authScheme !== "none" && !config.apiKey) {
    throw new ProviderError(
      "provider_not_configured",
      `auth scheme ${config.authScheme} requires a stored API key for provider "${config.key}".`,
    );
  }

  if (config.authScheme === "api_key_header" && !config.authHeaderName) {
    throw new ProviderError(
      "provider_not_configured",
      `auth scheme api_key_header requires a header name for provider "${config.key}".`,
    );
  }

  /**
   * Present the credential the way this supplier expects.
   *
   * Returns headers plus an optional query suffix. Kept as one function so there is exactly
   * one place to audit how a credential leaves this process.
   */
  function credential(): { headers: Record<string, string>; query: string } {
    const headers: Record<string, string> = {};

    switch (config.authScheme) {
      case "bearer":
        headers.authorization = `Bearer ${config.apiKey}`;
        return { headers, query: "" };
      case "api_key_header":
        // Non-null asserted by the constructor guard above.
        headers[config.authHeaderName as string] = config.apiKey as string;
        return { headers, query: "" };
      case "basic": {
        // The key is treated as `user:password` when it contains a colon, which is how
        // suppliers that issue a combined pair present it. Otherwise the key is the password
        // and the username is left empty, which is also a real convention.
        const raw = config.apiKey as string;
        const encoded = Buffer.from(raw.includes(":") ? raw : `:${raw}`, "utf8").toString("base64");
        headers.authorization = `Basic ${encoded}`;
        return { headers, query: "" };
      }
      case "query_param":
        return { headers, query: `api_key=${encodeURIComponent(config.apiKey as string)}` };
      case "none":
        return { headers, query: "" };
    }
  }

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    let lastError: ProviderError | null = null;

    const { headers: authHeaders, query } = credential();
    const url = `${root}${path}${query ? (path.includes("?") ? "&" : "?") + query : ""}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const headers: Record<string, string> = { accept: "application/json", ...authHeaders };
        if (body !== undefined) headers["content-type"] = "application/json";

        const response = await doFetch(url, {
          method,
          headers,
          signal: controller.signal,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

        if (response.status === 401 || response.status === 403) {
          // Not retryable: the supplier has already answered the question.
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
          // A 5xx is the supplier asking to be retried, which is the one case where a
          // repeat of a state-changing call is safe - the idempotency key protects us.
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
            `supplier returned a body that is not JSON for ${path}. A non-JSON supplier needs a bespoke adapter.`,
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
          await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ProviderError("transport_error", `call to ${path} failed`);
  }

  function asRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ProviderError(
        "malformed_response",
        `${path} returned ${Array.isArray(value) ? "an array" : typeof value} — expected an object`,
      );
    }
    return value as Record<string, unknown>;
  }

  /**
   * Translate a supplier response into our result shape using the configured paths.
   *
   * The completed-without-payload case is a hard error, not a warning: the database itself
   * refuses `fulfilment_status = 'completed'` with a null payload, so a supplier claim that
   * contradicts that would fail on write anyway - better it fails here with a message naming
   * the mapping field responsible.
   */
  function mapFulfilment(raw: unknown, fallbackReference: string): ProviderFulfilResult {
    const record = asRecord(raw, "fulfilment response");
    const { response } = config.mapping;

    const statusRaw = readPathRequired(record, response.status, "fulfilment status");
    const state = mapStatus(statusRaw, config.mapping.statusVocabulary);

    let deliveryPayload: Record<string, unknown> | null = null;
    if (response.deliveryPayload) {
      const candidate = readPath(record, response.deliveryPayload);
      if (candidate !== null && candidate !== undefined) {
        if (typeof candidate !== "object" || Array.isArray(candidate)) {
          // A supplier returning a bare string here is common. Wrapping it preserves the
          // value without pretending it was structured, and the original key is recorded so
          // support can see what arrived.
          deliveryPayload = { value: candidate };
        } else {
          deliveryPayload = candidate as Record<string, unknown>;
        }
      }
    }

    if (state === "completed" && deliveryPayload === null) {
      throw new ProviderError(
        "malformed_response",
        `supplier reported ${JSON.stringify(statusRaw)} but no value was found at mapping path ` +
          `"${response.deliveryPayload ?? "(unset)"}". Fix deliveryPayload for this provider.`,
      );
    }

    const referenceRaw = response.supplierReference
      ? readPath(record, response.supplierReference)
      : undefined;

    let failure: ProviderFulfilResult["error"];
    if (state === "failed") {
      const codeRaw = response.errorCode ? readPath(record, response.errorCode) : undefined;
      const messageRaw = response.errorMessage ? readPath(record, response.errorMessage) : undefined;
      const retryableRaw = response.retryable ? readPath(record, response.retryable) : undefined;

      failure = {
        code: codeRaw === undefined ? "supplier_error" : String(codeRaw),
        message:
          messageRaw === undefined ? `supplier reported ${String(statusRaw)}` : String(messageRaw),
        // Defaults to false. Assuming a failure is retryable would let a permanently
        // rejected delivery be retried until it hit the attempt ceiling, obscuring the
        // real cause behind a pile of attempts.
        retryable: retryableRaw === true,
      };
    }

    return {
      state,
      deliveryPayload,
      supplierReference: referenceRaw === undefined ? fallbackReference : String(referenceRaw),
      ...(failure ? { error: failure } : {}),
      mode: config.mode,
      isSandbox: config.mode === "sandbox",
    };
  }

  return {
    key: config.key,
    displayName: config.displayName,
    productLines: config.productLines,
    capabilities: config.capabilities,
    mode: config.mode,
    isSandbox: config.mode === "sandbox",

    async quote(request: ProviderQuoteRequest): Promise<ProviderQuote> {
      const quotePath = resolveEndpoint(endpoints.quote, "/quotes");

      const raw = await call(
        "POST",
        quotePath,
        buildRequestBody(config.mapping.request, {
          reference: request.supplierReference,
          quantity: request.quantity,
          key: `${request.supplierReference}:quote`,
          currency: request.currency,
        }),
      );

      const record = asRecord(raw, quotePath);

      // Cost path is not configurable: `cost_minor` is our vocabulary, and a supplier that
      // names it differently is mapping-mapped through `response.costMinor` where set.
      const costRaw = readPath(record, config.mapping.response.costMinor ?? "cost_minor");
      const currencyRaw = readPath(record, config.mapping.response.currency ?? "currency");
      const currency = currencyRaw === undefined ? "" : String(currencyRaw);

      if (currency && currency !== request.currency) {
        // Mixing currencies silently would corrupt our margin. Hard stop.
        throw new ProviderError(
          "currency_mismatch",
          `supplier quoted ${currency} but we expected ${request.currency}`,
        );
      }

      const referenceRaw = config.mapping.response.supplierReference
        ? readPath(record, config.mapping.response.supplierReference)
        : undefined;

      const availableRaw = config.mapping.response.available
        ? readPath(record, config.mapping.response.available)
        : undefined;

      return {
        supplierReference:
          referenceRaw === undefined ? request.supplierReference : String(referenceRaw),
        unitCostMinor: minorFrom(
          readPathRequired(record, config.mapping.response.costMinor ?? "cost_minor", "supplier cost"),
          "supplier cost",
        ),
        currency: currency || request.currency,
        // Absent means available. A supplier that omits the field is offering the product.
        available: availableRaw === undefined ? true : availableRaw !== false,
        mode: config.mode,
        isSandbox: config.mode === "sandbox",
      };
    },

    async fulfil(request: ProviderFulfilRequest): Promise<ProviderFulfilResult> {
      const fulfilPath = resolveEndpoint(endpoints.fulfil, "/fulfilments");

      // The idempotency key travels with the request. This is what lets the supplier
      // recognise a retry as the SAME request rather than delivering a second time.
      const raw = await call(
        "POST",
        fulfilPath,
        buildRequestBody(config.mapping.request, {
          reference: request.supplierReference,
          quantity: request.quantity,
          key: request.idempotencyKey,
          ...(request.metadata ? { metadata: request.metadata } : {}),
        }),
      );

      return mapFulfilment(raw, request.supplierReference);
    },

    async getStatus(idempotencyKey: string): Promise<ProviderFulfilResult | null> {
      const statusPath = resolveEndpoint(endpoints.status, "/fulfilments/{key}", {
        key: idempotencyKey,
      });

      try {
        const raw = await call("GET", statusPath);
        return mapFulfilment(raw, "");
      } catch (error) {
        // "The supplier has no record of this" is a legitimate answer, and it is exactly what
        // makes a retry after a timeout safe: it tells the caller the work never landed.
        if (error instanceof ProviderError && error.code === "not_found") return null;
        throw error;
      }
    },

    async health(): Promise<ProviderHealth> {
      try {
        if (!endpoints.health) {
          // No probe endpoint configured. Reporting ok:false with a reason is honest;
          // reporting ok:true on an untested connection would not be.
          return {
            ok: false,
            mode: config.mode,
            isSandbox: config.mode === "sandbox",
            detail:
              "No health endpoint is configured for this provider, so connectivity cannot be probed without placing a real order.",
          };
        }

        await call("GET", resolveEndpoint(endpoints.health, "/ping"));
        return {
          ok: true,
          mode: config.mode,
          isSandbox: config.mode === "sandbox",
          detail: "Supplier reachable and credentials accepted.",
        };
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "transport_error";
        return {
          ok: false,
          mode: config.mode,
          isSandbox: config.mode === "sandbox",
          // The failure classification only. A credential value is never included.
          detail: `Supplier probe failed with ${code}.`,
        };
      }
    },
  };
}
