import { ProviderError } from "./errors";
import type {
  ProviderCapability,
  ProviderFulfilRequest,
  ProviderFulfilResult,
  ProviderHealth,
  ProviderQuote,
  ProviderQuoteRequest,
  SupplierAdapter,
} from "./types";

/**
 * Sandbox eSIM adapter.
 *
 * WHAT THIS IS: a local, deterministic stand-in for a real eSIM supplier, so the whole
 * order pipeline can be built and tested end to end before a supplier contract exists.
 *
 * WHAT THIS IS NOT: it does not contain a catalogue, and it invents no products. Every
 * response is derived from the request by hashing it, so the same request always yields
 * the same result - which is what makes it usable in tests and in a repeated demo. There
 * is no random data and no seeded fixture anywhere in this file.
 *
 * THE LABELLING RULE: every result carries isSandbox: true AND a visible marker inside
 * the deliverable itself. If a sandbox code ever reached a real customer they would see
 * a code that says it is one, rather than a plausible-looking activation code that fails
 * silently at the airport. A sentinel in the payload is the difference between an
 * embarrassing demo and a support incident.
 */

export const SANDBOX_PAYLOAD_MARKER = "NUVORA-SANDBOX-NOT-A-REAL-ESIM";

/**
 * FNV-1a, 32-bit. Chosen because it is tiny, dependency-free and stable across runtimes:
 * the sandbox must produce the same output tomorrow as today, on any machine, or tests
 * that assert on it become flaky.
 */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function assertNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProviderError("invalid_request", `${field} is required`);
  }
  return value.trim();
}

function assertQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    throw new ProviderError(
      "invalid_request",
      `quantity must be a whole number between 1 and 100, received ${JSON.stringify(quantity)}`,
    );
  }
  return quantity;
}

export type SandboxOutcome = "completed" | "pending" | "failed";

export type SandboxEsimConfig = {
  /**
   * Forces the outcome of every fulfil call, so failure and pending paths are testable.
   * Defaults to "completed". This is a deliberate test control, not seeded data.
   */
  outcome?: SandboxOutcome;
  /**
   * Simulated base cost in minor units for a single unit. Used only when the caller has
   * no stored cost to compare against; it is NOT a catalogue price and is never written
   * to the products table by this adapter.
   */
  simulatedUnitCostMinor?: bigint;
};

const ESIM_LINES = ["esim"] as const;
const CAPABILITIES: readonly ProviderCapability[] = [
  "quote",
  "fulfil",
  "status",
  "health",
] as const;

export function createSandboxEsimAdapter(config: SandboxEsimConfig = {}): SupplierAdapter {
  const outcome: SandboxOutcome = config.outcome ?? "completed";
  const simulatedUnitCostMinor = config.simulatedUnitCostMinor ?? 0n;

  /**
   * The sandbox keeps its own ledger of fulfilments in memory so getStatus and repeat
   * fulfil calls behave like the real thing. It is deliberately NOT a database table: a
   * sandbox record must never be mistakable for a real fulfilment in production data.
   */
  const ledger = new Map<string, ProviderFulfilResult>();

  function buildCompleted(request: ProviderFulfilRequest): ProviderFulfilResult {
    const digest = stableHash(
      `${request.supplierReference}:${request.idempotencyKey}:${request.quantity}`,
    );

    return {
      state: "completed",
      deliveryPayload: {
        // The marker is intentionally the first key, so a human reading a raw payload
        // sees it before anything that looks like a real activation code.
        notice: SANDBOX_PAYLOAD_MARKER,
        kind: "esim_activation",
        activationCode: `SANDBOX-${digest.toUpperCase()}`,
        // A sandbox QR is a local SVG data URI the customer can scan to confirm the
        // flow works. It encodes the same sandbox marker, not a real provisioning
        // reference, so scanning it can never be confused with installing a profile.
        qrDataUri: `data:image/svg+xml;base64,${Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21"><rect width="21" height="21" fill="#fff"/><text x="1" y="12" font-size="3" fill="#111">${SANDBOX_PAYLOAD_MARKER}</text></svg>`,
        ).toString("base64")}`,
        iccidLike: `8900000${digest}`,
        quantity: request.quantity,
        simulated: true,
      },
      supplierReference: request.supplierReference,
      mode: "sandbox",
      isSandbox: true,
    };
  }

  function buildFailed(request: ProviderFulfilRequest): ProviderFulfilResult {
    return {
      state: "failed",
      deliveryPayload: null,
      supplierReference: request.supplierReference,
      error: {
        code: "sandbox_simulated_failure",
        message:
          "Sandbox is configured to fail. Set PROVIDER_SANDBOX_OUTCOME=completed to " +
          "exercise the success path, or clear it to use the default.",
        retryable: true,
      },
      mode: "sandbox",
      isSandbox: true,
    };
  }

  function buildPending(request: ProviderFulfilRequest): ProviderFulfilResult {
    return {
      state: "pending",
      deliveryPayload: null,
      supplierReference: request.supplierReference,
      mode: "sandbox",
      isSandbox: true,
    };
  }

  return {
    key: "esim-sandbox",
    displayName: "eSIM supplier (sandbox)",
    productLines: ESIM_LINES,
    capabilities: CAPABILITIES,
    mode: "sandbox",
    isSandbox: true,

    async quote(request: ProviderQuoteRequest): Promise<ProviderQuote> {
      const supplierReference = assertNonEmpty(request.supplierReference, "supplierReference");
      const quantity = assertQuantity(request.quantity);

      const digest = stableHash(`${supplierReference}:${quantity}:${config.simulatedUnitCostMinor ?? 0}`);

      return {
        supplierReference,
        unitCostMinor: simulatedUnitCostMinor,
        currency: request.currency,
        // Available unless the operator has explicitly forced a failure outcome, so the
        // "supplier has withdrawn this product" branch is reachable in tests.
        available: outcome !== "failed",
        note: `Sandbox quote. Reference digest ${digest}. This is not a real price.`,
        mode: "sandbox",
        isSandbox: true,
      };
    },

    async fulfil(request: ProviderFulfilRequest): Promise<ProviderFulfilResult> {
      const idempotencyKey = assertNonEmpty(request.idempotencyKey, "idempotencyKey");
      const supplierReference = assertNonEmpty(request.supplierReference, "supplierReference");
      assertQuantity(request.quantity);

      // Idempotency first: a repeat of a known key returns the ORIGINAL result without
      // re-running anything. This mirrors what a real supplier must do, and it is what
      // makes retrying a timed-out fulfilment safe.
      const existing = ledger.get(idempotencyKey);
      if (existing) return existing;

      const result =
        outcome === "failed"
          ? buildFailed(request)
          : outcome === "pending"
            ? buildPending(request)
            : buildCompleted(request);

      // Only terminal outcomes are remembered. A pending fulfilment is intentionally not
      // cached, so the next call re-evaluates it - exactly like polling a real supplier.
      if (result.state !== "pending") {
        ledger.set(idempotencyKey, result);
      }

      return result;
    },

    async getStatus(idempotencyKey: string): Promise<ProviderFulfilResult | null> {
      assertNonEmpty(idempotencyKey, "idempotencyKey");
      return ledger.get(idempotencyKey) ?? null;
    },

    async health(): Promise<ProviderHealth> {
      return {
        ok: true,
        mode: "sandbox",
        isSandbox: true,
        detail: "Sandbox adapter is active. No supplier traffic is leaving this process.",
      };
    },
  };
}

export function resetSandboxLedgerForTests(): void {
  // Nothing to reset: each adapter instance owns its ledger. Exported to make the
  // absence explicit rather than leaving a reader wondering where state lives.
}
