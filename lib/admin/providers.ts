import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supplier (provider) configuration.
 *
 * THE HONEST ANSWER TO "CAN I JUST PASTE A URL?".
 * The operator's expectation is that pasting a supplier URL and an API key makes it work. It
 * covers two of the ten things a supplier integration needs. This module exists partly to make
 * that visible: `PROVIDER_REQUIREMENTS` is the full list, each entry records whether the admin
 * form covers it or a mapping file is still needed, and `summariseConfiguration` reports which
 * are actually configured for a given supplier. The providers page renders that, so the gap is
 * on screen rather than discovered during a customer's order.
 *
 * WHAT A URL + KEY GENUINELY COVERS
 *   base_url          where to send the request
 *   credential        how to authenticate
 *
 * WHAT STILL NEEDS A MAPPING (request_mapping jsonb, or a thin adapter)
 *   auth_header_name  some suppliers want `X-API-Key`, some `Authorization`
 *   endpoints.*       the actual paths for quote, fulfil, status and health
 *   request fields    what the supplier calls quantity, reference, currency
 *   response fields   the supplier's names for cost, status, payload, error code
 *   status vocabulary a supplier's "DELIVERED" versus our 'completed'
 *   error codes       which of their errors are worth retrying and which are fatal
 *   webhooks          whether they push at all, and how they sign it
 *
 * None of that is knowable from a URL. It is data, not code - which is the point of the
 * declarative mapping - but somebody has to write it down once per supplier.
 */

export const PROVIDER_COLUMNS =
  "id, key, name, adapter, implementation, base_url, auth_scheme, auth_header_name, credential_hint, credential_updated_at, mode, is_active, supported_lines, capabilities, request_mapping, webhook_path, webhook_signature_scheme, notes, created_at, updated_at";

export type ProviderRow = {
  id: string;
  key: string;
  name: string;
  adapter: string;
  implementation: string;
  base_url: string | null;
  auth_scheme: string;
  auth_header_name: string | null;
  credential_hint: string | null;
  credential_updated_at: string | null;
  mode: string;
  is_active: boolean;
  supported_lines: string[];
  capabilities: string[];
  request_mapping: Record<string, unknown>;
  webhook_path: string | null;
  webhook_signature_scheme: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export async function listProviders(supabase: SupabaseClient): Promise<ProviderRow[]> {
  // Read with the admin session's client. The credential columns are absent from the
  // authenticated grant list, so this query physically cannot return them - the type below
  // has no field for them either, which is the application mirroring the database's rule.
  const { data, error } = await supabase
    .from("suppliers")
    .select(PROVIDER_COLUMNS)
    .order("name", { ascending: true });

  if (error) throw new Error(`Provider list failed: ${error.message}`);

  return (data ?? []) as ProviderRow[];
}

export async function getProvider(
  supabase: SupabaseClient,
  key: string,
): Promise<ProviderRow | null> {
  const { data, error } = await supabase
    .from("suppliers")
    .select(PROVIDER_COLUMNS)
    .eq("key", key)
    .maybeSingle();

  if (error) throw new Error(`Provider read failed: ${error.message}`);
  return (data ?? null) as ProviderRow | null;
}

// ---------------------------------------------------------------------------
// The configuration-completeness model
// ---------------------------------------------------------------------------

export type RequirementKey =
  | "base_url"
  | "credential"
  | "auth_scheme"
  | "auth_header_name"
  | "endpoint.quote"
  | "endpoint.fulfil"
  | "endpoint.status"
  | "request_mapping"
  | "response_mapping"
  | "status_map"
  | "error_map"
  | "webhook";

export type Requirement = {
  key: RequirementKey;
  label: string;
  /** True when pasting a URL and key on the admin form satisfies it. */
  coveredByForm: boolean;
  /** Where it is configured instead, when the form cannot. */
  configuredIn: string;
  explanation: string;
};

/**
 * Everything a supplier integration needs, and who provides it.
 *
 * Ordered so the first two entries are the ones the operator expects to be the whole job - and
 * the remaining ten are the reason it is not.
 */
export const PROVIDER_REQUIREMENTS: Requirement[] = [
  {
    key: "base_url",
    label: "Base URL",
    coveredByForm: true,
    configuredIn: "Providers page",
    explanation: "Where requests are sent. Must be https; the schema refuses anything else.",
  },
  {
    key: "credential",
    label: "API key",
    coveredByForm: true,
    configuredIn: "Providers page",
    explanation:
      "Encrypted before storage and never displayed again. Only the last four characters are kept for the masked indicator.",
  },
  {
    key: "auth_scheme",
    label: "Authentication scheme",
    coveredByForm: true,
    configuredIn: "Providers page",
    explanation:
      "How the key is presented: bearer token, a custom header, HTTP Basic, or a query parameter.",
  },
  {
    key: "auth_header_name",
    label: "Custom header name",
    coveredByForm: true,
    configuredIn: "Providers page",
    explanation:
      "Only for the custom-header scheme. One supplier expects X-API-Key, another Authorization - the name is not inferable.",
  },
  {
    key: "endpoint.quote",
    label: "Quote endpoint",
    coveredByForm: false,
    configuredIn: "request_mapping.endpoints.quote",
    explanation: "The path that asks the supplier what a product costs and whether it is available.",
  },
  {
    key: "endpoint.fulfil",
    label: "Fulfil endpoint",
    coveredByForm: false,
    configuredIn: "request_mapping.endpoints.fulfil",
    explanation: "The path that actually places the order with the supplier. This is the one that delivers the goods.",
  },
  {
    key: "endpoint.status",
    label: "Status endpoint",
    coveredByForm: false,
    configuredIn: "request_mapping.endpoints.status",
    explanation:
      "Used when a supplier cannot push a webhook, so delivery has to be polled for. Without it, a delivery that hangs has no way to be resolved.",
  },
  {
    key: "request_mapping",
    label: "Request field names",
    coveredByForm: false,
    configuredIn: "request_mapping.request",
    explanation:
      "What the supplier calls each field we send. Some take quantity, some slots; some want the reference nested under an order object.",
  },
  {
    key: "response_mapping",
    label: "Response field names",
    coveredByForm: false,
    configuredIn: "request_mapping.response",
    explanation:
      "Where the supplier puts cost, status, delivery payload and error code - for example data.pricing.unit_price instead of cost_minor.",
  },
  {
    key: "status_map",
    label: "Status vocabulary",
    coveredByForm: false,
    configuredIn: "request_mapping.status_map",
    explanation:
      "Translates the supplier's words into ours. DELIVERED, COMPLETE and SUCCESS all mean our 'completed' - or they do not, and only the supplier's documentation says which.",
  },
  {
    key: "error_map",
    label: "Error classification",
    coveredByForm: false,
    configuredIn: "request_mapping.error_map",
    explanation:
      "Which errors are worth retrying. Retrying a permanent failure loops forever and delays the refund; refusing to retry a transient one strands a paid order.",
  },
  {
    key: "webhook",
    label: "Webhook handling",
    coveredByForm: false,
    configuredIn: "request_mapping.webhook, plus the provider's own signing scheme",
    explanation:
      "Whether the supplier pushes delivery events at all, the path, and how the signature is computed. Many suppliers do not push, so this is often correctly left unset - but that is a fact to establish, not to assume.",
  },
];

export type RequirementStatus = "configured" | "not-required" | "missing" | "not-applicable";

export type RequirementAssessment = Requirement & { status: RequirementStatus };

/**
 * Reports which requirements are satisfied for one supplier.
 *
 * Deliberately specific about what "configured" means for each entry, and deliberately willing
 * to say "not required" where that is true - the eSIM sandbox has no URL and no endpoints by
 * design, and calling that incomplete would train the operator to ignore the panel.
 */
export function summariseConfiguration(provider: ProviderRow): RequirementAssessment[] {
  const mapping = provider.request_mapping ?? {};
  const endpoints = (mapping.endpoints ?? {}) as Record<string, unknown>;
  const has = (value: unknown): boolean =>
    typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;

  const isSandboxAdapter = provider.implementation === "esim-sandbox";

  return PROVIDER_REQUIREMENTS.map((requirement) => {
    if (isSandboxAdapter) {
      // The sandbox simulator contacts nothing, so every transport requirement is genuinely
      // inapplicable rather than outstanding.
      return {
        ...requirement,
        status: (requirement.key === "credential" ? "not-required" : "not-applicable") as RequirementStatus,
      };
    }

    switch (requirement.key) {
      case "base_url":
        return { ...requirement, status: has(provider.base_url) ? "configured" : "missing" };
      case "credential":
        return {
          ...requirement,
          status: provider.credential_hint ? "configured" : "missing",
        };
      case "auth_scheme":
        return {
          ...requirement,
          status: provider.auth_scheme !== "none" ? "configured" : "missing",
        };
      case "auth_header_name":
        return {
          ...requirement,
          status:
            provider.auth_scheme === "api_key_header"
              ? has(provider.auth_header_name)
                ? "configured"
                : "missing"
              : "not-required",
        };
      case "endpoint.quote":
        return { ...requirement, status: has(endpoints.quote) ? "configured" : "missing" };
      case "endpoint.fulfil":
        return { ...requirement, status: has(endpoints.fulfil) ? "configured" : "missing" };
      case "endpoint.status":
        return { ...requirement, status: has(endpoints.status) ? "configured" : "missing" };
      case "request_mapping":
        return { ...requirement, status: has(mapping.request) ? "configured" : "missing" };
      case "response_mapping":
        return { ...requirement, status: has(mapping.response) ? "configured" : "missing" };
      case "status_map":
        return { ...requirement, status: has(mapping.status_map) ? "configured" : "missing" };
      case "error_map":
        return { ...requirement, status: has(mapping.error_map) ? "configured" : "missing" };
      case "webhook":
        return {
          ...requirement,
          status: has(provider.webhook_path) ? "configured" : "missing",
        };
      default:
        return { ...requirement, status: "missing" };
    }
  });
}

/** A one-line readiness verdict, used for the badge on each provider card. */
export function readiness(assessments: RequirementAssessment[]): {
  label: string;
  tone: "ok" | "warn" | "bad";
  missing: number;
} {
  const missing = assessments.filter((a) => a.status === "missing").length;

  if (missing === 0) return { label: "Fully configured", tone: "ok", missing: 0 };
  // Transport works but the mapping does not: orders would be paid for and then fail to
  // deliver, which is worse than a provider that plainly cannot be enabled.
  if (missing <= 2) return { label: `${missing} item${missing === 1 ? "" : "s"} outstanding`, tone: "warn", missing };
  return { label: `${missing} items outstanding`, tone: "bad", missing };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KEY = /^[a-z0-9][a-z0-9-]*$/;
const HTTPS_URL = /^https:\/\/[^\s]+$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;
const WEBHOOK_PATH = /^[a-z0-9][a-z0-9/_-]*$/;

export const AUTH_SCHEMES = ["bearer", "api_key_header", "basic", "query_param", "none"] as const;
export const WEBHOOK_SCHEMES = [
  "none",
  "hmac_sha256_hex",
  "hmac_sha256_base64",
  "shared_header",
] as const;
export const MODES = ["sandbox", "live"] as const;
export const IMPLEMENTATIONS = ["generic-http", "esim-sandbox", "esim-live"] as const;

export type ProviderInput = {
  key: string;
  name: string;
  implementation: string;
  baseUrl: string | null;
  authScheme: string;
  authHeaderName: string | null;
  mode: string;
  isActive: boolean;
  supportedLines: string[];
  capabilities: string[];
  requestMapping: Record<string, unknown>;
  webhookPath: string | null;
  webhookSignatureScheme: string;
  notes: string | null;
  /** Present only when the operator typed a new key. Null means "leave the stored one alone". */
  credential: string | null;
  /** Present only when the operator typed a new webhook secret. */
  webhookSecret: string | null;
};

export type ProviderParseResult = { ok: true; value: ProviderInput } | { ok: false; error: string };

export const PROVIDER_ERRORS: Record<string, string> = {
  "key-invalid": "The provider key must be lower case, starting with a letter or digit, using only letters, digits and hyphens.",
  "key-taken": "A provider with that key already exists.",
  "name-required": "A display name is required.",
  "url-invalid": "The base URL must start with https:// and contain no spaces.",
  "url-required": "A live provider needs a base URL before it can be enabled. A sandbox provider does not.",
  "scheme-invalid": "Choose a valid authentication scheme.",
  "header-invalid": "The custom header name may contain only letters, digits and hyphens.",
  "mode-invalid": "Choose either sandbox or live.",
  "implementation-invalid": "Choose a valid implementation.",
  "credential-required": "A live provider with an authentication scheme needs an API key.",
  "credential-missing": "This provider has no API key stored. Enter one before enabling it.",
  "mapping-invalid": "The mapping must be valid JSON.",
  "mapping-not-object": "The mapping must be a JSON object.",
  "webhook-path-invalid": "The webhook path must be lower case and contain only letters, digits, hyphen, underscore or slash.",
  "webhook-scheme-invalid": "Choose a valid webhook signature scheme.",
  "webhook-secret-required": "A signed webhook needs a shared secret so the signature can be verified.",
  "not-found": "That provider no longer exists.",
  "in-use": "A product still references this provider, so it cannot be deleted. Disable it instead.",
};

function str(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseProviderForm(
  formData: FormData,
  options: { isUpdate: boolean; hasStoredCredential: boolean; hasStoredWebhookSecret: boolean },
): ProviderParseResult {
  const key = str(formData, "key").toLowerCase();
  const name = str(formData, "name");
  const implementation = str(formData, "implementation");
  const baseUrlRaw = str(formData, "base_url");
  const authScheme = str(formData, "auth_scheme");
  const authHeaderName = str(formData, "auth_header_name");
  const mode = str(formData, "mode");
  const isActive = str(formData, "is_active") === "on" || str(formData, "is_active") === "true";
  const notes = str(formData, "notes");
  const webhookPath = str(formData, "webhook_path").toLowerCase();
  const webhookSignatureScheme = str(formData, "webhook_signature_scheme");
  const credentialRaw = str(formData, "credential");
  const webhookSecretRaw = str(formData, "webhook_secret");
  const mappingRaw = str(formData, "request_mapping");
  const coverage = str(formData, "supported_lines");

  if (!KEY.test(key)) return { ok: false, error: "key-invalid" };
  if (!name) return { ok: false, error: "name-required" };
  if (!IMPLEMENTATIONS.includes(implementation as (typeof IMPLEMENTATIONS)[number])) {
    return { ok: false, error: "implementation-invalid" };
  }
  if (!AUTH_SCHEMES.includes(authScheme as (typeof AUTH_SCHEMES)[number])) {
    return { ok: false, error: "scheme-invalid" };
  }
  if (!MODES.includes(mode as (typeof MODES)[number])) return { ok: false, error: "mode-invalid" };
  if (!WEBHOOK_SCHEMES.includes(webhookSignatureScheme as (typeof WEBHOOK_SCHEMES)[number])) {
    return { ok: false, error: "webhook-scheme-invalid" };
  }

  if (baseUrlRaw && !HTTPS_URL.test(baseUrlRaw)) return { ok: false, error: "url-invalid" };

  if (authScheme === "api_key_header" && authHeaderName && !HEADER_NAME.test(authHeaderName)) {
    return { ok: false, error: "header-invalid" };
  }

  if (webhookPath && !WEBHOOK_PATH.test(webhookPath)) {
    return { ok: false, error: "webhook-path-invalid" };
  }

  let requestMapping: Record<string, unknown> = {};
  if (mappingRaw) {
    try {
      const parsed: unknown = JSON.parse(mappingRaw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "mapping-not-object" };
      }
      requestMapping = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: "mapping-invalid" };
    }
  }

  // THE ENABLING CHECK, mirroring suppliers_live_requires_endpoint. Doing it here as well as in
  // the database means the operator gets a sentence rather than a constraint name.
  if (isActive && mode === "live" && implementation !== "esim-sandbox") {
    if (!baseUrlRaw) return { ok: false, error: "url-required" };
    if (authScheme !== "none" && !credentialRaw && !options.hasStoredCredential) {
      return { ok: false, error: "credential-missing" };
    }
  }

  if (isActive && webhookSignatureScheme !== "none" && !webhookSecretRaw && !options.hasStoredWebhookSecret) {
    return { ok: false, error: "webhook-secret-required" };
  }

  return {
    ok: true,
    value: {
      key,
      name,
      implementation,
      baseUrl: baseUrlRaw || null,
      authScheme,
      authHeaderName: authHeaderName || null,
      mode,
      isActive,
      supportedLines: coverage ? coverage.split(",").map((s) => s.trim()).filter(Boolean) : ["esim"],
      capabilities: ["quote", "fulfil", "status", "health"],
      requestMapping,
      webhookPath: webhookPath || null,
      webhookSignatureScheme,
      notes: notes || null,
      // Null, not empty string: an empty string would be written as a credential and would
      // overwrite the stored key with nothing.
      credential: credentialRaw || null,
      webhookSecret: webhookSecretRaw || null,
    },
  };
}

/**
 * A safe audit snapshot of a provider.
 *
 * Explicitly excludes both secrets AND the hint. The hint is only four characters, but it is a
 * fragment of a live credential, and the audit log is visible to every admin - there is no
 * operational need for it to be copied there.
 */
export function providerAuditShape(provider: Record<string, unknown>) {
  return {
    key: provider.key,
    name: provider.name,
    implementation: provider.implementation,
    base_url: provider.base_url,
    auth_scheme: provider.auth_scheme,
    mode: provider.mode,
    is_active: provider.is_active,
    capabilities: provider.capabilities,
    webhook_path: provider.webhook_path,
    webhook_signature_scheme: provider.webhook_signature_scheme,
  };
}
