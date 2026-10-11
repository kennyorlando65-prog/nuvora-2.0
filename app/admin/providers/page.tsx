import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Card, EmptyState, Notice, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import {
  PROVIDER_REQUIREMENTS,
  listProviders,
  readiness,
  summariseConfiguration,
} from "@/lib/admin/providers";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Providers" };

/**
 * Providers.
 *
 * THE PANEL THAT ANSWERS THE REAL QUESTION.
 * The expectation is that pasting a supplier URL makes it work. It covers two requirements out
 * of twelve. Rather than let that be discovered during a customer's order, this page states the
 * whole list up front and shows, per provider, which entries are satisfied and which still need
 * a mapping. The enable checkbox is honest too: a live provider with no URL or key cannot be
 * enabled at all, because the database refuses it.
 */
export default async function AdminProvidersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = typeof params.notice === "string" ? params.notice : undefined;

  const { supabase } = await requireAdmin("/admin/providers");
  const providers = await listProviders(supabase);

  const enabled = providers.filter((p) => p.is_active);
  const transportOnly = PROVIDER_REQUIREMENTS.filter((r) => r.coveredByForm);
  const mappingOnly = PROVIDER_REQUIREMENTS.filter((r) => !r.coveredByForm);

  return (
    <>
      <PageHeader
        label="Delivery"
        title="Providers"
        description="Suppliers that deliver orders. A sandbox provider simulates delivery and issues no real goods."
        actions={
          <Link
            href="/admin/providers/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Add provider
          </Link>
        }
      />

      {notice === "deleted" && <Notice tone="ok">Provider deleted.</Notice>}

      <Notice tone="warn">
        <strong className="text-ink">Read this before configuring a provider.</strong> Pasting a
        base URL and an API key covers {transportOnly.length} of the{" "}
        {PROVIDER_REQUIREMENTS.length} things a supplier integration needs. The other{" "}
        {mappingOnly.length} are field names, endpoint paths, status vocabulary, error
        classification and webhook handling - none of which is inferable from a URL, and all of
        which must be recorded once per supplier. Every provider below carries a readiness badge
        showing exactly what is still outstanding.
      </Notice>

      {enabled.length === 0 && providers.length > 0 && (
        <Notice tone="bad">
          No provider is currently enabled, so nothing can be fulfilled. Payments can still be
          taken, which means an order placed now would be paid for and then stop.
        </Notice>
      )}

      {providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          hint="Nothing can be delivered until at least one provider is configured and enabled. Start with a sandbox provider, which simulates delivery without contacting anybody."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {providers.map((provider) => {
            const assessments = summariseConfiguration(provider);
            const status = readiness(assessments);
            const missing = assessments.filter((a) => a.status === "missing");

            return (
              <Card
                key={provider.id}
                title={provider.name}
                description={`${provider.key} - ${provider.implementation} - ${provider.mode}`}
                actions={
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge label={status.label} tone={status.tone} />
                    <Badge
                      label={provider.is_active ? "enabled" : "disabled"}
                      tone={provider.is_active ? "ok" : "neutral"}
                    />
                    <Link
                      href={`/admin/providers/${provider.key}`}
                      className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                    >
                      Configure
                    </Link>
                  </span>
                }
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Base URL" value={provider.base_url ?? "not set"} mono />
                  <Fact
                    label="API key"
                    value={provider.credential_hint ? `stored, ends ${provider.credential_hint}` : "not set"}
                    mono
                  />
                  <Fact
                    label="Auth"
                    value={provider.auth_scheme}
                    mono
                  />
                  <Fact
                    label="Capabilities"
                    value={provider.capabilities.join(", ")}
                    mono
                  />
                </div>

                {missing.length > 0 && (
                  <div className="rounded-md border border-accent/40 bg-panel-2 p-3">
                    <p className="text-xs text-ink">
                      Still required before this provider can deliver an order:
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {missing.map((requirement) => (
                        <li key={requirement.key} className="text-xs text-muted">
                          <span className="text-ink">{requirement.label}</span> -{" "}
                          {requirement.explanation}{" "}
                          <span className="font-mono text-[10px] text-dim">
                            set in {requirement.configuredIn}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-dim">
                  Updated {formatDateTime(provider.updated_at)}. Credentials are encrypted before
                  storage and are removed from every client role&rsquo;s column grants, so they can
                  never be read back into a browser - only the last four characters are kept, for
                  the indicator above.
                </p>
              </Card>
            );
          })}
        </div>
      )}

      <Card
        title="What a URL paste covers, and what it does not"
        description={`${transportOnly.length} requirements are satisfied by the form. ${mappingOnly.length} need a mapping entry.`}
      >
        <TableWrap>
          <thead>
            <tr>
              <Th>Requirement</Th>
              <Th>Covered by the form</Th>
              <Th>Otherwise set in</Th>
            </tr>
          </thead>
          <tbody>
            {PROVIDER_REQUIREMENTS.map((requirement) => (
              <tr key={requirement.key}>
                <Td>
                  <span className="block text-xs text-ink">{requirement.label}</span>
                  <span className="block text-[10px] text-dim">{requirement.explanation}</span>
                </Td>
                <Td>
                  {requirement.coveredByForm ? (
                    <Badge label="yes" tone="ok" />
                  ) : (
                    <Badge label="no" tone="bad" />
                  )}
                </Td>
                <Td>
                  <span className="font-mono text-[10px] text-muted">{requirement.configuredIn}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Which suppliers push, and which must be polled">
          <p className="text-sm text-muted">
            This cannot be answered generically. Some eSIM suppliers push an activation callback and
            some only expose a status endpoint; gift card and top-up providers are usually
            synchronous, returning the code in the fulfil response itself and needing no webhook at
            all. Establish it from each supplier&rsquo;s documentation and record it in
            `webhook_path` or leave it unset - leaving it unset is only correct when the status
            endpoint is configured, because otherwise a delivery that hangs has no way to resolve.
          </p>
        </Card>

        <Card title="What is not built yet">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted">
            <li>
              The service-role verification harness proves the credential columns are unreadable by
              any client role. It does not prove the credential can be used, because no outbound
              supplier call has ever been made.
            </li>
            <li>
              The generic HTTP adapter that consumes `request_mapping` is the next stage. Until it
              lands, a provider can be configured and validated here but cannot deliver an order -
              the mapping above is stored and ready for it.
            </li>
            <li>
              Webhook signature verification is implemented for the four declared schemes, but has
              not been exercised against a real supplier signature.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="nuvora-label">{label}</span>
      <span className={`${mono ? "font-mono text-xs" : "text-sm"} text-ink`}>{value}</span>
    </div>
  );
}
