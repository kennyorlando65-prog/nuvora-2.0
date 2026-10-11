import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptSecret } from "@/lib/crypto/secret-box";
import { ProviderError } from "./errors";
import { type GenericAuthScheme, createGenericHttpAdapter } from "./generic-http";
import { type ProviderMapping, parseProviderMapping } from "./mapping";
import { createSandboxEsimAdapter } from "./esim-sandbox";
import { createLiveEsimAdapter } from "./esim-live";
import type { ProviderCapability, ProviderMode, SupplierAdapter } from "./types";
import type { ProductLine } from "@/lib/pricing/types";

/**
 * Resolve an adapter FROM THE DATABASE ROW.
 *
 * This is the bridge between the provider-configuration model and the transport adapters:
 * `suppliers` holds what a supplier is (endpoint, auth scheme, mapping, mode), and this module
 * turns that row into a working adapter.
 *
 * WHY THE ROW AND NOT THE ENVIRONMENT. The environment-based resolver in ./index.ts reads
 * ESIM_PROVIDER_BASE_URL and ESIM_PROVIDER_API_KEY, which means one supplier, set at deploy
 * time. The business model needs several suppliers at once - eSIM, top-ups, gift cards - and
 * an operator who can add one without a redeploy. So the row is the source of truth, and the
 * environment resolver remains for the single-provider path it was written for.
 *
 * THE CREDENTIAL HANDLING IS THE POINT OF THIS FILE.
 * `credential_ciphertext` is unreadable by every client role - see the column grant list in
 * migration 20261011090900. Only a service-role call can fetch it, it is decrypted in memory
 * for the duration of one operation, and it is never logged, never returned and never placed
 * in an error message. An error thrown from here names the FAILURE, never the key.
 */

/** What we read from the `suppliers` row. Mirrors the column grant list, plus the secrets. */
export type SupplierRow = {
  key: string;
  name: string;
  adapter: string;
  implementation: string;
  mode: ProviderMode;
  is_active: boolean;
  supported_lines: string[];
  capabilities: string[];
  base_url: string | null;
  auth_scheme: GenericAuthScheme;
  auth_header_name: string | null;
  request_mapping: unknown;
  credential_ciphertext: string | null;
};

/**
 * Columns needed to build an adapter, including the two secret ones.
 *
 * Declared once so the admin completeness panel and the resolver cannot drift: if a new column
 * becomes required to construct an adapter, it is added here and both callers see it.
 */
export const SUPPLIER_ADAPTER_COLUMNS =
  "key, name, adapter, implementation, mode, is_active, supported_lines, capabilities, " +
  "base_url, auth_scheme, auth_header_name, request_mapping";

/** The secret columns, fetched separately so a caller that only needs metadata never holds them. */
export const SUPPLIER_SECRET_COLUMNS = "key, credential_ciphertext";

const KNOWN_CAPABILITIES: readonly ProviderCapability[] = ["quote", "fulfil", "status", "health"];

function toCapabilities(raw: string[] | null): ProviderCapability[] {
  const values = (raw ?? []).filter((value): value is ProviderCapability =>
    (KNOWN_CAPABILITIES as readonly string[]).includes(value),
  );
  return values.length > 0 ? values : ["quote", "fulfil", "status", "health"];
}

/** Which implementation string maps to which adapter factory. */
export type Implementation = "generic-http" | "esim-sandbox" | "esim-live";

function toImplementation(row: SupplierRow): Implementation {
  // `implementation` is the newer, explicit field. `adapter` predates it and is honoured as a
  // fallback so rows created before the column existed keep working.
  const value = (row.implementation || row.adapter || "").trim();

  if (value === "generic-http" || value === "esim-sandbox" || value === "esim-live") {
    return value;
  }

  throw new ProviderError(
    "provider_not_configured",
    `Provider "${row.key}" names an unknown implementation ${JSON.stringify(value)}. ` +
      "Expected one of: generic-http, esim-sandbox, esim-live.",
  );
}

/**
 * Build an adapter for a supplier row.
 *
 * `credential` is passed in rather than read here so the caller controls when a secret is
 * fetched and decrypted, and so this function is testable without a database.
 */
export function buildAdapterFromRow(
  row: SupplierRow,
  credential: string | null,
): SupplierAdapter {
  if (!row.is_active) {
    throw new ProviderError(
      "provider_not_configured",
      `Provider "${row.key}" is disabled. Enable it in the admin providers page before fulfilling against it.`,
    );
  }

  const implementation = toImplementation(row);
  const productLines = (row.supported_lines ?? []) as ProductLine[];

  if (implementation === "esim-sandbox") {
    return createSandboxEsimAdapter({});
  }

  if (implementation === "esim-live") {
    // The older, single-supplier live adapter. Kept because it is the narrower, more audited
    // path and a supplier matching the reference contract may prefer it.
    if (!row.base_url) {
      throw new ProviderError(
        "provider_not_configured",
        `Provider "${row.key}" is pinned to the esim-live implementation but has no base URL.`,
      );
    }
    if (!credential) {
      throw new ProviderError(
        "provider_not_configured",
        `Provider "${row.key}" has no stored API key. Add one on the provider page.`,
      );
    }
    return createLiveEsimAdapter({
      baseUrl: row.base_url,
      apiKey: credential,
      ...(row.auth_header_name ? { authHeaderName: row.auth_header_name } : {}),
    });
  }

  // generic-http: the configuration-driven adapter.
  if (!row.base_url) {
    throw new ProviderError(
      "provider_not_configured",
      `Provider "${row.key}" has no base URL. Set one on the provider page; it must be https.`,
    );
  }

  const mapping: ProviderMapping = parseProviderMapping(row.request_mapping);

  if (row.auth_scheme !== "none" && !credential) {
    throw new ProviderError(
      "provider_not_configured",
      `Provider "${row.key}" uses the ${row.auth_scheme} auth scheme but has no stored API key. ` +
        "Add one on the provider page.",
    );
  }

  return createGenericHttpAdapter({
    key: row.key,
    displayName: row.name,
    baseUrl: row.base_url,
    ...(credential ? { apiKey: credential } : {}),
    authScheme: row.auth_scheme,
    ...(row.auth_header_name ? { authHeaderName: row.auth_header_name } : {}),
    mode: row.mode,
    productLines,
    capabilities: toCapabilities(row.capabilities),
    mapping,
  });
}

/**
 * Fetch a supplier row and resolve a ready-to-use adapter.
 *
 * `privileged` MUST be the service-role client: `credential_ciphertext` is not readable by any
 * other role, so passing a user-scoped client produces a silent null credential and a
 * confusing "no stored API key" error. The parameter is named for the requirement.
 *
 * Returns null when no supplier exists for the key, so a caller can distinguish "misconfigured"
 * from "not found" rather than treating both as the same failure.
 */
export async function resolveAdapterForKey(
  privileged: SupabaseClient,
  supplierKey: string,
): Promise<SupplierAdapter | null> {
  const { data, error } = await privileged
    .from("suppliers")
    .select(`${SUPPLIER_ADAPTER_COLUMNS}, credential_ciphertext`)
    .eq("key", supplierKey)
    .maybeSingle();

  if (error) {
    // The message names the query, not the credential. A PostgREST error never contains a
    // column VALUE, so this is safe to surface to an operator.
    throw new ProviderError(
      "provider_not_configured",
      `Could not read provider "${supplierKey}": ${error.message}`,
    );
  }

  if (!data) return null;

  const row = data as unknown as SupplierRow & { credential_ciphertext: string | null };
  const credential = decryptCredential(row);

  return buildAdapterFromRow(row, credential);
}

/**
 * Decrypt a stored credential, translating key problems into actionable messages.
 *
 * The three failure modes are separated because they need different operator responses:
 * no key stored at all, a missing encryption key, and an encryption key that no longer
 * decrypts this value (typically after a rotation). Collapsing them into one "decryption
 * failed" would send an operator looking in the wrong place.
 */
export function decryptCredential(row: {
  key: string;
  credential_ciphertext: string | null;
}): string | null {
  if (!row.credential_ciphertext) return null;

  try {
    return decryptSecret(row.credential_ciphertext);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    throw new ProviderError(
      "provider_not_configured",
      `The stored API key for provider "${row.key}" could not be decrypted (${name}). ` +
        "This normally means NUVORA_ENCRYPTION_KEY was changed after the key was saved; " +
        "re-enter the API key on the provider page.",
    );
  }
}

/**
 * Whether an adapter can be built for this row, WITHOUT constructing one or touching secrets.
 *
 * Used by the admin completeness panel, which must be able to say "this provider is ready"
 * without decrypting anything. Deliberately a pure function of the metadata columns.
 */
export function assessAdapterReadiness(row: {
  key: string;
  implementation: string;
  adapter: string;
  mode: ProviderMode;
  base_url: string | null;
  auth_scheme: GenericAuthScheme;
  auth_header_name: string | null;
  credential_hint: string | null;
  request_mapping: unknown;
}): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];

  let implementation: string;
  try {
    implementation = toImplementation({ ...row } as unknown as SupplierRow);
  } catch {
    return { ready: false, blockers: ["Unknown implementation."] };
  }

  if (implementation === "esim-sandbox") {
    // The simulator contacts nobody, so it needs no endpoint and no credential. Reporting
    // those as gaps would train an operator to ignore this panel.
    return { ready: true, blockers: [] };
  }

  if (!row.base_url) blockers.push("No base URL configured.");
  if (row.auth_scheme !== "none" && !row.credential_hint) blockers.push("No API key stored.");

  if (row.auth_scheme === "api_key_header" && !row.auth_header_name) {
    blockers.push("Auth scheme is api_key_header but no header name is set.");
  }

  if (implementation === "generic-http") {
    try {
      parseProviderMapping(row.request_mapping);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "The response mapping is invalid.");
    }
  }

  return { ready: blockers.length === 0, blockers };
}
