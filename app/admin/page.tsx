import type { Metadata } from "next";
import Link from "next/link";

import { Card, InlineLink, Notice, PageHeader, StatCard } from "@/components/admin/ui";
import { getOverview } from "@/lib/admin/overview";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Overview" };

/**
 * Admin overview.
 *
 * `requireAdmin` runs here as well as in the layout and in middleware. That is three checks
 * on the same request, which is intentional rather than redundant: this call is what
 * returns the client used for every query below, so the guard and the data access are
 * impossible to separate. A page cannot query admin data without having passed the gate in
 * the line above it.
 *
 * Note what the page does NOT claim: it reports state, it does not evaluate readiness. A
 * zero in "awaiting fulfilment" means zero rows, not that fulfilment works.
 */
export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin("/admin");
  const overview = await getOverview(supabase);

  const catalogueEmpty = overview.catalogue.total === 0;
  const noProviders = overview.providers.enabled === 0;

  return (
    <>
      <PageHeader
        label="Operations"
        title="Overview"
        description="Live counts from the production database. Every figure below is a row count, not an estimate."
      />

      {/* Configuration gaps first, because an operator needs to know the store cannot sell
          before they need to know how many orders it has not taken. */}
      {catalogueEmpty && (
        <Notice tone="warn">
          <strong className="text-ink">The catalogue is empty.</strong> No products exist, so
          checkout will refuse every order. This is the expected state of a fresh project -
          no placeholder products are ever seeded - and{" "}
          <InlineLink href="/admin/products">the catalogue</InlineLink> is where the first
          real one is added.
        </Notice>
      )}

      {noProviders && (
        <Notice tone="warn">
          <strong className="text-ink">No supplier is enabled.</strong> Payments can still be
          taken, but nothing can be delivered, because fulfilment has nowhere to send the
          order. Configure one in{" "}
          <InlineLink href="/admin/providers">providers</InlineLink> before going live.
        </Notice>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="nuvora-label">Orders</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total" value={overview.orders.total} />
          <StatCard label="Awaiting payment" value={overview.orders.awaitingPayment} tone="warn" />
          <StatCard label="Paid" value={overview.orders.paid} />
          <StatCard label="Fulfilling" value={overview.orders.fulfilling} tone="warn" />
          <StatCard label="Fulfilled" value={overview.orders.fulfilled} tone="ok" />
          <StatCard
            label="Needs attention"
            value={overview.orders.needsAttention}
            tone={overview.orders.needsAttention > 0 ? "bad" : "neutral"}
            hint="Failed or partially fulfilled"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="nuvora-label">Fulfilment</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Undelivered lines"
            value={overview.lines.pendingFulfilment}
            tone={overview.lines.pendingFulfilment > 0 ? "warn" : "neutral"}
            hint="Paid for, not yet delivered"
          />
          <StatCard
            label="Failed lines"
            value={overview.lines.failedFulfilment}
            tone={overview.lines.failedFulfilment > 0 ? "bad" : "neutral"}
          />
          <StatCard label="Payments succeeded" value={overview.payments.succeeded} tone="ok" />
          <StatCard label="Payments failed" value={overview.payments.failed} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Catalogue"
          description="Products available to sell, and how many are still drafts."
          actions={<InlineLink href="/admin/products">Manage</InlineLink>}
        >
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total" value={overview.catalogue.total} />
            <StatCard
              label="Active"
              value={overview.catalogue.active}
              tone={overview.catalogue.active > 0 ? "ok" : "neutral"}
            />
            <StatCard label="Draft" value={overview.catalogue.draft} />
          </div>
        </Card>

        <Card
          title="Suppliers"
          description="Configured delivery partners. A sandbox supplier simulates delivery and issues no real goods."
          actions={<InlineLink href="/admin/providers">Configure</InlineLink>}
        >
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Total" value={overview.providers.total} />
            <StatCard
              label="Enabled"
              value={overview.providers.enabled}
              tone={overview.providers.enabled > 0 ? "ok" : "bad"}
            />
            <StatCard label="Sandbox" value={overview.providers.sandbox} hint="Simulated" />
          </div>
        </Card>
      </div>

      <Card
        title="Accounts"
        description="Suspensions and bans. Blocked accounts are refused server-side at checkout, not merely hidden in the interface."
        actions={<InlineLink href="/admin/users">Review</InlineLink>}
      >
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="Blocked accounts"
            value={overview.users.blocked}
            tone={overview.users.blocked > 0 ? "warn" : "neutral"}
          />
          <StatCard label="Catalogue drafts" value={overview.catalogue.draft} />
          <StatCard
            label="Failed lines"
            value={overview.lines.failedFulfilment}
            tone={overview.lines.failedFulfilment > 0 ? "bad" : "neutral"}
          />
        </div>
      </Card>

      <Card title="Where to start">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted">
          <li>
            <InlineLink href="/admin/providers">Configure a supplier</InlineLink> and set it to
            sandbox. Nothing can be delivered until one is enabled.
          </li>
          <li>
            <InlineLink href="/admin/products">Add a product</InlineLink> with its customer
            price and its supplier cost entered separately. The margin is derived, never typed
            in.
          </li>
          <li>
            <InlineLink href="/admin/settings">Set the business details</InlineLink> that appear
            on receipts and in the footer.
          </li>
          <li>
            Grant administrator access by setting{" "}
            <code className="font-mono text-xs text-accent">app_metadata.nuvora_role</code> to{" "}
            <code className="font-mono text-xs text-accent">admin</code> on the account, through
            the Supabase dashboard or a service-role call. It cannot be set from the client.
          </li>
        </ol>
      </Card>

      <p className="text-xs text-dim">
        Looking for payments, fulfilment attempts or the raw event ledger? Those are reachable
        from the order detail view, and the immutable action trail is under{" "}
        <Link href="/admin/audit" className="text-muted underline hover:text-ink">
          audit log
        </Link>
        .
      </p>
    </>
  );
}
