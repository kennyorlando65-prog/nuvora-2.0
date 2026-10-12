import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Card, EmptyState, Notice, PageHeader, StatCard, TableWrap, Td, Th } from "@/components/admin/ui";
import { requireAdminColumns } from "@/lib/auth/guard";
import { formatDateTime, type Tone } from "@/lib/admin/format";
import {
  ENCRYPTION_KEY_ENV_VAR,
  getDiagnostics,
  type CredentialVerdict,
  type ProviderDiagnostic,
} from "@/lib/admin/diagnostics";

export const metadata: Metadata = { title: "Diagnostics" };

/**
 * Diagnostics.
 *
 * THE PAGE THE OPERATOR NEEDS WHEN SOMETHING IS WRONG. It was built after the admin area
 * returned a 500 with no explanation, and it is designed for exactly that moment: one verdict
 * at the top, then one card per provider saying in plain English whether it can deliver an
 * order and, if not, precisely what is missing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not test connectivity. No outbound call is made
 * from this page. Claiming "reachable" without having reached anything would be a lie, so the
 * page reports only what can be established from stored configuration - and says so.
 */

const VERDICT_TONE: Record<CredentialVerdict, Tone> = {
  decrypts: "ok",
  "does-not-decrypt": "bad",
  "not-stored": "neutral",
  "could-not-check": "warn",
};

const VERDICT_LABEL: Record<CredentialVerdict, string> = {
  decrypts: "decrypts",
  "does-not-decrypt": "will not decrypt",
  "not-stored": "not stored",
  "could-not-check": "could not check",
};

const SEVERITY_TONE: Record<ProviderDiagnostic["severity"], Tone> = {
  ok: "ok",
  warn: "warn",
  bad: "bad",
};

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft py-1.5 last:border-b-0">
      <span className="text-xs text-muted">{label}</span>
      {ok ? <Badge label="yes" tone="ok" /> : <Badge label="no" tone="bad" />}
    </div>
  );
}

export default async function AdminDiagnosticsPage() {
  const { supabase, privileged } = await requireAdminColumns("/admin/diagnostics");
  const report = await getDiagnostics(supabase, privileged);

  const healthy = report.totals.healthy;
  const blocked = report.totals.misconfigured;

  return (
    <>
      <PageHeader
        label="Operations"
        title="Diagnostics"
        description="What is configured, what is missing, and what would stop a paid order from being delivered. Read from stored configuration only - no outbound supplier call is made from this page."
      />

      {/* The verdict first. An operator should not have to read four cards to learn whether
          anything is wrong. */}
      {report.providersUnreadable ? (
        <Notice tone="bad">
          <strong className="text-ink">The provider list could not be read.</strong> This is the
          same class of failure that makes the rest of the admin area unusable:{" "}
          <span className="font-mono text-xs">{report.providersUnreadable}</span>
        </Notice>
      ) : blocked > 0 ? (
        <Notice tone="bad">
          <strong className="text-ink">
            {blocked} enabled provider{blocked === 1 ? "" : "s"} cannot deliver an order.
          </strong>{" "}
          Each one is marked below with the reason. Payments can still be taken while this is
          true, so a customer could pay and then receive nothing.
        </Notice>
      ) : report.totals.enabled === 0 ? (
        <Notice tone="warn">
          <strong className="text-ink">No provider is enabled.</strong> Nothing can be delivered
          until one is. Configure a sandbox provider first, which simulates delivery without
          contacting anybody.
        </Notice>
      ) : (
        <Notice tone="ok">
          <strong className="text-ink">No blocking configuration problem found.</strong>{" "}
          {healthy} enabled provider{healthy === 1 ? "" : "s"} appear
          {healthy === 1 ? "s" : ""} fully configured. Note that this is a statement about
          configuration, not proof of delivery - no outbound call has been made.
        </Notice>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="nuvora-label">Configuration</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Providers configured" value={report.totals.configured} />
          <StatCard
            label="Enabled"
            value={report.totals.enabled}
            tone={report.totals.enabled > 0 ? "ok" : "bad"}
          />
          <StatCard
            label="Fully configured"
            value={report.totals.healthy}
            tone={report.totals.healthy > 0 ? "ok" : "neutral"}
          />
          <StatCard
            label="Cannot deliver"
            value={report.totals.misconfigured}
            tone={report.totals.misconfigured > 0 ? "bad" : "neutral"}
          />
        </div>
      </section>

      {/* The encryption key is called out separately because its absence breaks EVERY provider
          at once, and the symptom (credentials that will not decrypt) does not point at the
          cause. */}
      <Card
        title="Credential encryption"
        description={`Provider API keys are encrypted at rest with a server-side key held in ${ENCRYPTION_KEY_ENV_VAR}.`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="nuvora-label">Environment variable</span>
            <Badge
              label={report.encryptionKeyPresent ? "set" : "not set"}
              tone={report.encryptionKeyPresent ? "ok" : "bad"}
            />
          </div>
          <p className="text-sm text-muted">{report.encryptionNote}</p>
          <p className="text-xs text-dim">
            The value of this variable is never displayed here or anywhere else in the admin
            area. Only its presence is checked. Set it in Vercel under Settings, then
            Environment variables.
          </p>
        </div>
      </Card>

      {report.lastErrorReadFailure && (
        <Notice tone="warn">
          Past fulfilment failures could not be read, so the &ldquo;last error&rdquo; entries
          below may be incomplete:{" "}
          <span className="font-mono text-xs">{report.lastErrorReadFailure}</span>
        </Notice>
      )}

      {report.providers.length === 0 && !report.providersUnreadable ? (
        <EmptyState
          title="No providers configured"
          hint="Nothing can be delivered until at least one provider exists and is enabled. Add a sandbox provider on the providers page to begin."
        />
      ) : (
        <section className="flex flex-col gap-4">
          <h3 className="nuvora-label">Provider health</h3>

          {report.providers.map((provider) => (
            <Card
              key={provider.id}
              title={provider.name}
              description={`${provider.key} - ${provider.implementation} - ${provider.mode}`}
              actions={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge
                    label={provider.severity === "ok" ? "healthy" : provider.severity === "warn" ? "attention" : "blocked"}
                    tone={SEVERITY_TONE[provider.severity]}
                  />
                  <Badge
                    label={provider.enabled ? "enabled" : "disabled"}
                    tone={provider.enabled ? "ok" : "neutral"}
                  />
                  <Link
                    href={`/admin/providers/${provider.key}`}
                    className="nuvora-btn nuvora-btn-secondary px-3 py-1.5"
                  >
                    Configure
                  </Link>
                </span>
              }
            >
              {/* The sentence to read first. */}
              <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-sm text-ink">
                {provider.summary}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col">
                  <span className="nuvora-label pb-1">Configuration checks</span>
                  <Check ok={provider.enabled} label="Enabled for use" />
                  <Check ok={provider.baseUrlSet} label="Base URL set" />
                  <Check ok={provider.credentialStored} label="API key stored" />
                  <Check ok={provider.credentialVerdict === "decrypts"} label="API key decrypts" />
                  <Check
                    ok={provider.webhookSignatureScheme !== "none"}
                    label="Signed webhook configured"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="nuvora-label">Base URL</span>
                    <span className="break-all font-mono text-xs text-ink">
                      {provider.baseUrl ?? "not set"}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <span className="nuvora-label">API key</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge
                        label={VERDICT_LABEL[provider.credentialVerdict]}
                        tone={VERDICT_TONE[provider.credentialVerdict]}
                      />
                      {provider.credentialHint && (
                        <span className="font-mono text-xs text-dim">
                          ends {provider.credentialHint}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <span className="nuvora-label">Last failure</span>
                    {provider.lastError ? (
                      <>
                        <span className="break-words text-xs text-bad">
                          {provider.lastError.message}
                        </span>
                        <span className="font-mono text-[10px] text-dim">
                          {provider.lastError.at
                            ? formatDateTime(provider.lastError.at)
                            : "time not recorded"}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-dim">
                        No recorded failure. This does not mean delivery has been proven - it
                        means this provider has not recorded a failed attempt.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted">{provider.credentialNote}</p>

              {provider.missingLabels.length > 0 && (
                <div className="rounded-md border border-accent/40 bg-panel-2 p-3">
                  <p className="text-xs text-ink">
                    Still required before this provider can deliver an order:
                  </p>
                  <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
                    {provider.missingLabels.map((label) => (
                      <li key={label} className="text-xs text-muted">
                        {label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
        </section>
      )}

      <Card
        title="What is not checked here, and why"
        description="Stated plainly so this page is not read as more than it is."
      >
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
          <li>
            No supplier is contacted. Nothing on this page proves that a base URL is reachable,
            that an API key is accepted, or that a supplier can deliver anything.
          </li>
          <li>
            The environment variables that configure the built-in adapters, such as
            PROVIDER_MODE, are read at startup rather than stored in the database, so they are
            not listed per provider here.
          </li>
          <li>
            A provider with no recorded failure has not been proven to work. It may simply never
            have been used.
          </li>
        </ul>
      </Card>

      <p className="text-xs text-dim">
        Generated {formatDateTime(report.generatedAt)}. Reload the page to re-run every check.
      </p>
    </>
  );
}
