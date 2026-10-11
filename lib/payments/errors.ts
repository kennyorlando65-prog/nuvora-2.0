/**
 * Payment configuration and transport failures.
 *
 * Codes are stable and safe to branch on. Messages are for operators: they may name a
 * variable, and must never contain a secret value. A customer is told something neutral.
 */

export type PaymentErrorCode =
  | "gateway_not_configured"   // the selected gateway has no secret key set
  | "unknown_gateway"          // PAYMENT_PROVIDER holds an unrecognised value
  | "payments_disabled"        // PAYMENT_PROVIDER=disabled - deliberate, not a bug
  | "unauthorized"            // the gateway rejected our secret key
  | "rate_limited"
  | "timeout"
  | "transport_error"
  | "gateway_error"            // gateway returned a well-formed error
  | "malformed_response";      // gateway response did not match the contract

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  readonly status?: number;

  constructor(code: PaymentErrorCode, message: string, status?: number) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}
