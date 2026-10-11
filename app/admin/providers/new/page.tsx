import type { Metadata } from "next";
import Link from "next/link";

import { ProviderForm, ProviderMessages } from "@/components/admin/provider-form";
import { Card, Notice, PageHeader } from "@/components/admin/ui";
import { createProviderAction } from "@/lib/admin/provider-actions";
import { requireAdmin } from "@/lib/auth/guard";
import { isEncryptionAvailable } from "@/lib/crypto/secret-box";

export const metadata: Metadata = { title: "New provider" };

export default async function NewProviderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const notice = typeof params.notice === "string" ? params.notice : undefined;

  // The gate runs before anything else, and the encryption check is evaluated on the SERVER so
  // the form can be disabled rather than accepting a credential it could not protect.
  await requireAdmin("/admin/providers/new");
  const encryptionReady = isEncryptionAvailable();

  return (
    <>
      <Link href="/admin/providers" className="text-xs text-muted underline hover:text-accent">
        Back to providers
      </Link>

      <PageHeader
        label="New"
        title="Add a provider"
        description="Configure a delivery supplier. Start with mode sandbox: it validates the configuration without contacting anybody, and enables no real goods to be issued."
      />

      <ProviderMessages error={error} notice={notice} />

      {!encryptionReady && (
        <Notice tone="bad">
          <strong className="text-ink">Credential storage is not configured.</strong> The
          encryption key is absent or unusable, so an API key cannot be stored safely and this
          form will refuse one. Set{" "}
          <code className="font-mono text-xs text-accent">NUVORA_ENCRYPTION_KEY</code> in Vercel -
          generate it with{" "}
          <code className="font-mono text-[10px] text-accent">
            node -e &quot;console.log(require(&#39;crypto&#39;).randomBytes(32).toString(&#39;base64&#39;))&quot;
          </code>
          . It is server-only and must never be exposed to the browser or committed. You can still
          create a sandbox provider without a key.
        </Notice>
      )}

      <ProviderForm
        action={createProviderAction}
        hasStoredCredential={false}
        hasStoredWebhookSecret={false}
        submitLabel="Create provider"
        isUpdate={false}
      />

      <Card title="Recommended first step">
        <p className="text-sm text-muted">
          Create the provider with mode <span className="font-mono text-ink">sandbox</span>, an
          implementation of <span className="font-mono text-ink">esim-sandbox</span>, and no URL or
          key. That gives you a provider you can attach a product to and complete an end-to-end
          order against, without contacting a supplier or issuing a real good. Switch it to live
          once the mapping below is filled in from the supplier&rsquo;s documentation.
        </p>
      </Card>
    </>
  );
}
