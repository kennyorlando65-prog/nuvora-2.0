/**
 * Supplier adapter registry.
 *
 * THE SINGLE PLACE where sandbox and live are distinguished. Routes call
 * resolveAdapter() and never inspect the environment themselves, so the question "is this
 * call real?" has exactly one answer to audit.
 *
 * SWITCHING A SUPPLIER LIVE
 * -------------------------
 *   1. Set PROVIDER_MODE=live
 *   2. Set ESIM_PROVIDER_BASE_URL and ESIM_PROVIDER_API_KEY
 *
 * That is the whole switch. Until both are set, PROVIDER_MODE stays sandbox and nothing
 * leaves the process.
 *
 * THE FAIL-CLOSED GUARD. Sandbox mode on a Vercel PRODUCTION deployment throws instead of
 * quietly returning simulated deliveries. The alternative - a live store selling eSIMs it
 * never delivers, with sandbox codes marked "not a real eSIM" reaching customers - is far
 * worse than a loud configuration error. To run sandbox on a production deployment on
 * purpose (a staging slot, a demo), set PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION=true, and
 * understand that every fulfilment will be simulated.
 *
 * This guard keys off VERCEL_ENV. It therefore does NOT catch a non-Vercel production
 * host; the health endpoint is the backstop there.
 */

import "server-only";

import { ProviderError } from "./errors";
import { createLiveEsimAdapter } from "./esim-live";
import { createSandboxEsimAdapter, type SandboxOutcome } from "./esim-sandbox";
import type { ProviderMode, SupplierAdapter } from "./types";

/** Every adapter key this build knows about. */
export type AdapterKey = "esim-sandbox" | "esim-live";

export const ADAPTER_KEYS: readonly AdapterKey[] = ["esim-sandbox", "esim-live"] as const;

export type AdapterConfig = {
  mode: ProviderMode;
  /** True on a production deployment, where sandbox must not run silently. */
  isProduction: boolean;
  /** Explicit opt-out, for a deliberate demo on a production deployment. */
  allowSandboxInProduction: boolean;
  esim: {
    baseUrl?: string | undefined;
    apiKey?: string | undefined;
    authHeaderName?: string | undefined;
  };
  sandbox: {
    outcome?: SandboxOutcome | undefined;
    simulatedUnitCostMinor?: bigint | undefined;
  };
};

function parseSandboxOutcome(value: string | undefined): SandboxOutcome | undefined {
  if (value === "completed" || value === "pending" || value === "failed") return value;
  return undefined;
}

/**
 * Read adapter configuration from the environment.
 *
 * Kept separate from resolveAdapter so the resolver itself is a pure function and can be
 * tested without manipulating process.env.
 */

/**
 * The environment keys this module reads.
 *
 * Declared as an open string map rather than NodeJS.ProcessEnv: @types/node marks
 * NODE_ENV as a required member of ProcessEnv, which makes it impossible to pass a plain
 * object literal in a test, and this module deliberately does not care about NODE_ENV.
 */
export type AdapterEnv = Readonly<Record<string, string | undefined>>;

export function readAdapterConfig(env: AdapterEnv = process.env): AdapterConfig {
  const rawMode = (env.PROVIDER_MODE ?? "sandbox").trim().toLowerCase();
  const mode: ProviderMode = rawMode === "live" ? "live" : "sandbox";

  // VERCEL_ENV is "production" only on a production deployment. It is unset locally, so
  // `npm run build && npm start` does not trip the sandbox guard.
  const isProduction = (env.VERCEL_ENV ?? "").trim() === "production";

  const simulatedRaw = env.PROVIDER_SANDBOX_UNIT_COST_MINOR;
  let simulatedUnitCostMinor: bigint | undefined;
  if (simulatedRaw && /^\d+$/.test(simulatedRaw.trim())) {
    simulatedUnitCostMinor = BigInt(simulatedRaw.trim());
  }

  return {
    mode,
    isProduction,
    allowSandboxInProduction:
      (env.PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION ?? "").trim().toLowerCase() === "true",
    esim: {
      baseUrl: env.ESIM_PROVIDER_BASE_URL?.trim() || undefined,
      apiKey: env.ESIM_PROVIDER_API_KEY?.trim() || undefined,
      authHeaderName: env.ESIM_PROVIDER_AUTH_HEADER?.trim() || undefined,
    },
    sandbox: {
      outcome: parseSandboxOutcome(env.PROVIDER_SANDBOX_OUTCOME?.trim().toLowerCase()),
      simulatedUnitCostMinor,
    },
  };
}

/**
 * Resolve a ready-to-use adapter.
 *
 * Throws ProviderError rather than returning a degraded adapter, so a misconfiguration
 * surfaces at the call site instead of as a silently-simulated fulfilment.
 */
export function resolveAdapter(key: AdapterKey, config: AdapterConfig): SupplierAdapter {
  if (config.mode === "live") {
    if (key !== "esim-live") {
      throw new ProviderError(
        "provider_not_configured",
        `PROVIDER_MODE=live but the requested adapter is ${key}. Set the adapter key to "esim-live".`,
      );
    }

    const { baseUrl, apiKey, authHeaderName } = config.esim;
    const missing = [
      ...(baseUrl ? [] : ["ESIM_PROVIDER_BASE_URL"]),
      ...(apiKey ? [] : ["ESIM_PROVIDER_API_KEY"]),
    ];
    if (missing.length > 0) {
      throw new ProviderError(
        "provider_not_configured",
        `PROVIDER_MODE=live requires ${missing.join(" and ")} to be set in Vercel -> ` +
          "Settings -> Environment Variables. Never commit these values.",
      );
    }

    return createLiveEsimAdapter({
      baseUrl: baseUrl as string,
      apiKey: apiKey as string,
      ...(authHeaderName ? { authHeaderName } : {}),
    });
  }

  // Sandbox path.
  if (config.isProduction && !config.allowSandboxInProduction) {
    throw new ProviderError(
      "sandbox_in_production",
      "Refusing to run the sandbox supplier on a production deployment: every order would " +
        "be fulfilled with simulated goods. Set PROVIDER_MODE=live with supplier " +
        "credentials, or set PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION=true if this is " +
        "deliberately a demo.",
    );
  }

  return createSandboxEsimAdapter({
    ...(config.sandbox.outcome ? { outcome: config.sandbox.outcome } : {}),
    ...(config.sandbox.simulatedUnitCostMinor !== undefined
      ? { simulatedUnitCostMinor: config.sandbox.simulatedUnitCostMinor }
      : {}),
  });
}

/** Resolve from the process environment. The convenience entry point for routes. */
export function resolveAdapterFromEnv(key: AdapterKey, env?: AdapterEnv): SupplierAdapter {
  return resolveAdapter(key, readAdapterConfig(env));
}

/**
 * Describe the configured adapters without constructing them or touching credentials.
 * Used by the health endpoint so an operator can see the mode from a browser.
 */
export function describeAdapterConfig(config: AdapterConfig): {
  mode: ProviderMode;
  isProduction: boolean;
  sandboxPermitted: boolean;
  credentialsPresent: boolean;
  note: string;
} {
  const credentialsPresent = Boolean(config.esim.baseUrl && config.esim.apiKey);
  const sandboxPermitted = !config.isProduction || config.allowSandboxInProduction;

  let note: string;
  if (config.mode === "live") {
    note = credentialsPresent
      ? "Live supplier traffic is enabled."
      : "PROVIDER_MODE=live but supplier credentials are missing; fulfilment will fail.";
  } else if (!sandboxPermitted) {
    note =
      "Sandbox mode on a production deployment. Fulfilment is refused until PROVIDER_MODE=live " +
      "or PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION=true.";
  } else {
    note = "Sandbox mode. No supplier traffic leaves this process.";
  }

  return { mode: config.mode, isProduction: config.isProduction, sandboxPermitted, credentialsPresent, note };
}
