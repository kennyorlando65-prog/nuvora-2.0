/**
 * Provider failures.
 *
 * A single error type with a stable `code` and an explicit `retryable` flag, because the
 * caller's correct response differs sharply between the two cases: a retryable failure
 * should be retried on a schedule, while a non-retryable one means a human must look at
 * the order. Collapsing both into a generic Error loses that distinction at exactly the
 * moment it matters.
 *
 * Codes are stable strings, safe to branch on and to put in a log line. Messages are for
 * operators, never for customers: they may name a supplier or a variable, and a customer
 * should be told "we could not complete your order", not which API key is missing.
 */

export type ProviderErrorCode =
  | "provider_not_configured"   // credentials or base URL absent
  | "sandbox_in_production"     // sandbox refusing to run in a live environment
  | "capability_not_supported"  // adapter cannot do what was asked
  | "invalid_request"           // the request itself is malformed
  | "currency_mismatch"         // supplier quoted in a currency we did not expect
  | "not_found"                 // supplier has no record of the reference
  | "unauthorized"              // credentials rejected
  | "rate_limited"              // supplier is throttling us
  | "timeout"                   // no response inside the deadline
  | "transport_error"           // network or DNS failure
  | "supplier_error"            // supplier returned a well-formed error response
  | "malformed_response";       // supplier response did not match the contract

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  /** HTTP status when the failure came from a response, otherwise undefined. */
  readonly status?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE.has(code);
    if (options.status !== undefined) this.status = options.status;
  }
}

/**
 * Which failures are worth retrying by default. A timeout or a 5xx may succeed on the
 * next attempt; bad credentials never will, and retrying them just burns the supplier's
 * rate limit and looks like an attack.
 */
const DEFAULT_RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set<ProviderErrorCode>([
  "timeout",
  "transport_error",
  "rate_limited",
  "supplier_error",
]);

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
