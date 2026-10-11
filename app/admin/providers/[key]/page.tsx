import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProviderForm, ProviderMessages } from "@/components/admin/provider-form";
import { Badge, Card, Notice, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import {
  PROVIDER_REQUIREMENTS,
  getProvider,
  readiness,
  summariseConfiguration,
} from "@/lib/admin/providers";
import { deleteProviderAction, setProviderEnabledAction, updateProviderAction } from "@/lib/admin/provider-actions";
import { requireAdminColumns } from "@/lib/auth/guard";
import { isEncryptionAvailable, maskHint } from "@/lib/crypto/secret-box";

export const metadata: Metadata = { title: "Provider" };

const KEY_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Provider detail.
 *
 * The encrypted secrets are read here through the privileged client purely to answer "is one
 * stored", which decides whether the form can be submitted with the credential field left blank.
 * The value itself is never read on this page and never rendered - the hint column is what the
 * masked indicator uses, and the ciphertext stays in the database.
 */
export default async function AdminProviderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const query = await searchParams;

  if (!KEY_SHAPE.test(key)) notFound();

  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  const { supabase, privileged } = await requireAdminColumns(`/admin/providers/${key}`);

  const provider = await getProvider(supabase, key);
  if (!provider) notFound();

  // Only ever selected to test for presence, never returned or logged.
  const { data: secretState } = await privileged
    .from("suppliers")
    .select("credential_hint, webhook_secret_ciphertext")
    .eq("key", key)
    .maybeSingle();

  const hasStoredCredential = Boolean(secretState?.credential_hint);
  const hasStoredWebhookSecret = Boolean(secretState?.webhook_secret_ciphertext);
  const encryptionReady = isEncryptionAvailable();

  const assessments = summariseConfiguration(provider);
  const status = readiness(assessments);

  return (
    <>
      <Link href="/admin/providers" className="text-xs text-muted underline hover:text-accent">
        Back to providers
      </Link>

      <PageHeader
        label={provider.key}
        title={provider.name}
        description={`${provider.implementation} - ${provider.mode}. Last updated ${formatDateTime(provider.updated_at)}.`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Badge label={status.label} tone={status.tone} />
            <Badge
              label={provider.is_active ? "enabled" : "disabled"}
              tone={provider.is_active ? "ok" : "neutral"}
            />
          </span>
        }
      />

      <ProviderMessages error={error} notice={notice} />

      {!encryptionReady && (
        <Notice tone="bad">
          <strong className="text-ink">Credential encryption is unavailable.</strong>{" "}
          <code className="font-mono text-xs text-accent">NUVORA_ENCRYPTION_KEY</code> is absent or
          unusable, so a new API key cannot be stored. An existing stored key cannot be decrypted
          for an outbound call either, which means this provider cannot deliver until it is set.
        </Notice>
      )}

      <Card title="Enable or disable">
        <div className="flex flex-wrap items-center gap-3">
          <form action={setProviderEnabledAction}>
            <input type="hidden" name="key" value={provider.key} />
            <input type="hidden" name="enable" value={provider.is_active ? "false" : "true"} />
            <button
              type="submit"
              className={
                provider.is_active
                  ? "nuvora-btn nuvora-btn-secondary border-bad/50"
                  : "nuvora-btn nuvora-btn-primary"
              }
            >
              {provider.is_active ? "Disable provider" : "Enable provider"}
            </button>
          </form>

          <span className="text-xs text-dim">
            {provider.is_active
              ? "Orders are sent here for fulfilment. Disabling stops that immediately and is always reversible."
              : "Enabling a live provider requires a base URL and an API key. The database refuses an unusable one rather than letting the first order fail."}
          </span>
        </div>
      </Card>

      <Card
        title="Configuration completeness"
        description={`${assessments.filter((a) => a.status === "configured").length} configured, ${assessments.filter((a) => a.status === "missing").length} outstanding, ${assessments.filter((a) => a.status === "not-required" || a.status === "not-applicable").length} not applicable to this provider.`}
      >
        <TableWrap>
          <thead>
            <tr>
              <Th>Requirement</Th>
              <Th>Status</Th>
              <Th>Where it is configured</Th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((assessment) => (
              <tr key={assessment.key}>
                <Td>
                  <span className="block text-xs text-ink">{assessment.label}</span>
                  <span className="block text-[10px] text-dim">{assessment.explanation}</span>
                </Td>
                <Td>
                  {assessment.status === "configured" ? (
                    <Badge label="configured" tone="ok" />
                  ) : assessment.status === "missing" ? (
                    <Badge label="outstanding" tone="bad" />
                  ) : (
                    <Badge
                      label={assessment.status === "not-required" ? "not required" : "not applicable"}
                      tone="neutral"
                    />
                  )}
                </Td>
                <Td>
                  <span className="font-mono text-[10px] text-muted">
                    {assessment.coveredByForm
                      ? "This form"
                      : assessment.configuredIn}
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>

        <p className="text-xs text-dim">
          &ldquo;Not applicable&rdquo; is a real answer, not a gap. The sandbox simulator contacts
          nobody, so it has no endpoints, no URL and no mapping - and calling those incomplete would
          train an operator to ignore this panel.
        </p>
      </Card>

      <Card title="Stored credentials" description="Presence only. No value is ever displayed.">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-dim">API key</dt>
            <dd className="font-mono text-xs text-ink">
              {hasStoredCredential ? maskHint(provider.credential_hint) : "not set"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-dim">Key last set</dt>
            <dd className="font-mono text-xs text-ink">
              {provider.credential_updated_at
                ? formatDateTime(provider.credential_updated_at)
                : "never"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-dim">Webhook secret</dt>
            <dd className="font-mono text-xs text-ink">
              {hasStoredWebhookSecret ? "stored" : "not set"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-dim">
          Both secrets are encrypted with AES-256-GCM before storage and removed from every client
          role&rsquo;s column grants. This page cannot read them back even for display, which is why
          only a stored indicator is shown. The encryption key lives in{" "}
          <code className="font-mono text-[10px] text-accent">NUVORA_ENCRYPTION_KEY</code>; if it is
          rotated, these credentials become undecryptable and must be re-entered here.
        </p>
      </Card>

      <ProviderForm
        action={updateProviderAction}
        provider={provider}
        hasStoredCredential={hasStoredCredential}
        hasStoredWebhookSecret={hasStoredWebhookSecret}
        submitLabel="Save provider"
        isUpdate
      />

      <Card title="Delete this provider">
        <form action={deleteProviderAction}>
          <input type="hidden" name="key" value={provider.key} />
          <button
            type="submit"
            className="nuvora-btn nuvora-btn-secondary border-bad/50"
          >
            Delete provider
          </button>
        </form>
        <p className="text-xs text-dim">
          Refused while any product still references this provider, because a product whose supplier
          no longer exists is an order that gets paid for and then cannot be delivered. Disabling is
          the reversible alternative and is almost always what you actually want.
        </p>
      </Card>
    </>
  );
}
