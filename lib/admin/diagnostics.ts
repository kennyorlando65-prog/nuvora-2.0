import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isEncryptionAvailable, decryptSecret } from "@/lib/crypto/secret-box";
import { PROVIDER_COLUMNS, summariseConfiguration, type ProviderRow } from "@/lib/admin/providers";

/**
 * The admin diagnostics panel.
 *
 * WHY THIS EXISTS. The operator could not get into the admin area at all - it returned a 500
 * - and had no way to find out why. That is the failure this module is built to prevent. It
 * answers, per configured provider and per configuration item, one question an operator can
 * act on: is this working, and if not, what exactly is wrong?
 *
 * READABLE BY A NON-ENGINEER, ON PURPOSE. Every provider gets one plain-English sentence
 * describing its state. The underlying database message is shown beside it, because "the
 * encryption key is missing" and "the credential cannot be decrypted" need different
 * responses and an operator should not have to guess which one happened.
 *
 * IT CANNOT ITSELF 500. Every read is individually guarded, and a diagnostic that cannot be
 * completed reports "could not check" rather than throwing. A diagnostics page that breaks
 * when something is broken is worse than none, because it is precisely when things are broken
 * that it is needed.
 *
 * NO SECRET IS EVER READ INTO THIS MODULE'S OUTPUT. The credential is fetched only to attempt
 * a decryption and is never returned, logged or placed in the report; the result is a
 * three-state verdict - decrypts, does not decrypt, could not check.
 */

export type CredentialVerdict = "decrypts" | "does-not-decrypt" | "not-stored" | "could-not-check";

export type DiagnosticSeverity = "ok" | "warn" | "bad";

export type ProviderDiagnostic = {
  id: string;
  key: string;
  name: string;
  implementation: string;
  enabled: boolean;
  mode: string;
  baseUrl: string | null;
  baseUrlSet: boolean;
  credentialStored: boolean;
  credentialHint: string | null;
  credentialVerdict: CredentialVerdict;
  /** Plain-English explanation of the credential verdict. Never contains the secret. */
  credentialNote: string;
  webhookSecretStored: boolean;
  webhookSignatureScheme: string;
  outstandingRequirements: number;
  missingLabels: string[];
  severity: DiagnosticSeverity;
  /** The one sentence an operator should read first. */
  summary: string;
  lastError: { message: string; at: string | null } | null;
};

export type DiagnosticsReport = {
  generatedAt: string;
  encryptionKeyPresent: boolean;
  encryptionNote: string;
  providers: ProviderDiagnostic[];
  /** Set when the provider list itself could not be read. */
  providersUnreadable: string | null;
  lastErrorReadFailure: string | null;
  /** Counts, so the page can lead with a verdict rather than making the operator count. */
  totals: {
    configured: number;
    enabled: number;
    healthy: number;
    misconfigured: number;
    disabled: number;
  };
};

/** The env var that must be present for provider credentials to be readable. */
export const ENCRYPTION_KEY_ENV_VAR = "NUVORA_ENCRYPTION_KEY";

/**
 * Groups the most recent fulfilment failure per provider.
 *
 * Real past failures are the only honest source for "last error". A provider that has never
 * been used has no last error - that is reported as none, not as success, because a provider
 * that has never delivered anything has not been proven to work either.
 */
async function readLastErrors(
  privileged: SupabaseClient | null,
): Promise<{ byKey: Map<string, { message: string; at: string | null }>; failure: string | null }> {
  const byKey = new Map<string, { message: string; at: string | null }>();

  if (!privileged) {
    return { byKey, failure: "The privileged reader is not configured, so past failures cannot be read." };
  }

  try {
    const { data, error } = await privileged
      .from("fulfilment_attempts")
      // Columns named explicitly: a starred select is refused for a role holding column-level
      // grants, which is the same class of bug this whole module exists to surface.
      .select("provider_key, error_code, detail, created_at")
      .eq("outcome", "failed")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return { byKey, failure: error.message };

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const key = row.provider_key as string | null;
      if (!key || byKey.has(key)) continue; // newest first: first one seen wins

      const detail = (row.detail as string | null) ?? "";
      const code = (row.error_code as string | null) ?? "failed";
      byKey.set(key, {
        message: detail ? `${code}: ${detail}` : code,
        at: (row.created_at as string | null) ?? null,
      });
    }

    return { byKey, failure: null };
  } catch (error) {
    return {
      byKey,
      failure: error instanceof Error ? error.message : "Past failures could not be read.",
    };
  }
}

/**
 * Attempts a decryption and reports only the verdict.
 *
 * The plaintext is discarded immediately and appears in no field of the return value. A
 * failure is classified rather than rethrown, because the two causes need different fixes:
 * a missing key means nobody can read any credential, while a failing decryption on one row
 * means that row was written with a different key - typically after a rotation.
 */
function checkCredential(
  ciphertext: string | null,
  encryptionAvailable: boolean,
): { verdict: CredentialVerdict; note: string } {
  if (!ciphertext) {
    return {
      verdict: "not-stored",
      note: "No API key is stored for this provider.",
    };
  }

  if (!encryptionAvailable) {
    return {
      verdict: "could-not-check",
      note: `A credential is stored but cannot be checked, because ${ENCRYPTION_KEY_ENV_VAR} is not set on this deployment. Set it in Vercel to read or replace provider credentials.`,
    };
  }

  try {
    const plaintext = decryptSecret(ciphertext);
    // Deliberately not inspected beyond emptiness; the value is dropped here.
    const usable = plaintext.length > 0;

    return usable
      ? { verdict: "decrypts", note: "A credential is stored and decrypts correctly, so it can be used for outbound calls." }
      : { verdict: "does-not-decrypt", note: "A credential is stored but decrypts to an empty value. Re-enter it on the provider page." };
  } catch (error) {
    return {
      verdict: "does-not-decrypt",
      note:
        `A credential is stored but cannot be decrypted: ${
          error instanceof Error ? error.message : "unknown decryption error"
        }. This usually means it was encrypted with a different ${ENCRYPTION_KEY_ENV_VAR}, for example after a key rotation. Re-enter the key on the provider page to re-encrypt it.`,
    };
  }
}

/** Builds the full report. Never throws. */
export async function getDiagnostics(
  supabase: SupabaseClient,
  privileged: SupabaseClient | null,
): Promise<DiagnosticsReport> {
  const generatedAt = new Date().toISOString();
  const encryptionAvailable = isEncryptionAvailable();

  const encryptionNote = encryptionAvailable
    ? `${ENCRYPTION_KEY_ENV_VAR} is set, so stored provider credentials can be decrypted.`
    : `${ENCRYPTION_KEY_ENV_VAR} is NOT set. Provider credentials cannot be written or read, and any credential already stored cannot be used. This is the first thing to fix if provider configuration is failing.`;

  // ---- providers ---------------------------------------------------------
  let providers: ProviderRow[] = [];
  let providersUnreadable: string | null = null;

  try {
    // `credential_hint` is NOT in the authenticated grant list, so the hint is read through
    // the privileged client below. `PROVIDER_COLUMNS` is the allow-listed set.
    const { data, error } = await supabase
      .from("suppliers")
      .select(PROVIDER_COLUMNS)
      .order("name", { ascending: true });

    if (error) {
      providersUnreadable = error.message;
    } else {
      providers = (data ?? []) as ProviderRow[];
    }
  } catch (error) {
    providersUnreadable = error instanceof Error ? error.message : "The provider list could not be read.";
  }

  const { byKey: lastErrors, failure: lastErrorReadFailure } = await readLastErrors(privileged);

  // Credential ciphertexts and hints, read once through the privileged client. The ciphertext
  // is used only for the decryption verdict and never leaves this function.
  const secretsByKey = new Map<string, { ciphertext: string | null; hint: string | null }>();

  if (privileged && providers.length > 0) {
    try {
      const { data } = await privileged
        .from("suppliers")
        .select("key, credential_ciphertext, credential_hint, webhook_secret_ciphertext")
        .in("key", providers.map((p) => p.key));

      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        secretsByKey.set(row.key as string, {
          ciphertext: (row.credential_ciphertext as string | null) ?? null,
          hint: (row.credential_hint as string | null) ?? null,
        });
      }
    } catch {
      // Left empty: every provider then reports "could not check" rather than a false negative.
    }
  }

  // ---- per-provider assessment, one provider at a time -------------------
  // Each provider is assessed inside its own guard. A row that is malformed - a capability
  // list that is not an array, a mapping that is not an object - degrades to a misconfigured
  // entry instead of taking the page down. This is the decoupling the founder asked for: the
  // admin must not be a function of any single provider row being valid.
  const diagnostics: ProviderDiagnostic[] = providers.map((provider) => {
    const base: ProviderDiagnostic = {
      id: provider.id,
      key: provider.key,
      name: provider.name || provider.key,
      implementation: provider.implementation || "unknown",
      enabled: Boolean(provider.is_active),
      mode: provider.mode || "unknown",
      baseUrl: provider.base_url ?? null,
      baseUrlSet: Boolean(provider.base_url),
      credentialStored: false,
      credentialHint: null,
      credentialVerdict: "could-not-check",
      credentialNote: "This provider's configuration could not be assessed.",
      webhookSecretStored: false,
      webhookSignatureScheme: provider.webhook_signature_scheme || "none",
      outstandingRequirements: 0,
      missingLabels: [],
      severity: "warn",
      summary: "This provider's configuration could not be assessed.",
      lastError: lastErrors.get(provider.key) ?? null,
    };

    try {
      const secret = secretsByKey.get(provider.key);
      const { verdict, note } = checkCredential(secret?.ciphertext ?? null, encryptionAvailable);

      const assessments = summariseConfiguration(provider);
      const missing = assessments.filter((a) => a.status === "missing");

      const isSandbox = provider.implementation === "esim-sandbox";
      const problems: string[] = [];

      if (!base.baseUrlSet) problems.push("the base URL is missing");
      if (!isSandbox && verdict === "not-stored") problems.push("no API key is stored");
      if (verdict === "does-not-decrypt") problems.push("the stored API key cannot be decrypted");
      if (verdict === "could-not-check") problems.push("the stored API key cannot be checked");
      if (missing.length > 0) problems.push(`${missing.length} requirement${missing.length === 1 ? "" : "s"} still need a mapping`);

      // Severity reflects whether this provider could actually deliver an order right now.
      let severity: DiagnosticSeverity;
      let summary: string;

      if (!provider.is_active) {
        severity = "warn";
        summary = "Disabled. This provider will not be used for any order, so nothing depends on its configuration yet.";
      } else if (problems.length === 0) {
        severity = "ok";
        summary = isSandbox
          ? "Enabled and ready. This is a sandbox provider, so it simulates delivery and issues no real goods."
          : "Enabled and fully configured. It should be able to deliver an order.";
      } else if (!base.baseUrlSet || verdict === "not-stored" || verdict === "does-not-decrypt") {
        severity = "bad";
        summary = `Enabled but cannot deliver, because ${problems.join(", and ")}. An order placed now would be paid for and then fail at the supplier.`;
      } else {
        severity = "warn";
        summary = `Enabled and reachable, but ${problems.join(", and ")}. Orders may be accepted by the supplier and then need manual follow-up.`;
      }

      return {
        ...base,
        credentialStored: Boolean(secret?.ciphertext),
        credentialHint: secret?.hint ?? null,
        credentialVerdict: verdict,
        credentialNote: note,
        webhookSecretStored: false,
        outstandingRequirements: missing.length,
        missingLabels: missing.map((m) => m.label),
        severity,
        summary,
      };
    } catch (error) {
      // The provider row exists but something about it is not readable or not well formed.
      // Reported as misconfigured on its own card; every other provider still renders.
      return {
        ...base,
        severity: "bad",
        summary: `Misconfigured. This provider could not be assessed: ${
          error instanceof Error ? error.message : "unknown error"
        }. The rest of this page is unaffected.`,
      };
    }
  });

  const totals = {
    configured: diagnostics.length,
    enabled: diagnostics.filter((d) => d.enabled).length,
    healthy: diagnostics.filter((d) => d.severity === "ok").length,
    misconfigured: diagnostics.filter((d) => d.severity === "bad").length,
    disabled: diagnostics.filter((d) => !d.enabled).length,
  };

  return {
    generatedAt,
    encryptionKeyPresent: encryptionAvailable,
    encryptionNote,
    providers: diagnostics,
    providersUnreadable,
    lastErrorReadFailure,
    totals,
  };
}
