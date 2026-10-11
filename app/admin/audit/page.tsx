import type { Metadata } from "next";

import { EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

/**
 * The admin action trail.
 *
 * READ-ONLY, AND THAT IS ENFORCED BY THE DATABASE. `service_role` has no UPDATE or DELETE grant
 * on audit_log, so not even a server-side mistake can edit history - the harness asserts both.
 * This page therefore offers no controls at all, because there are none to offer.
 *
 * WHAT MAKES THE ACTOR TRUSTWORTHY. The actor is not a column the application fills in. Every
 * administrative write calls `public.log_admin_action()`, a SECURITY DEFINER function that reads
 * the actor from the VERIFIED JWT and refuses any caller that is not an admin. If the
 * application passed an actor id, the trail would record whatever it was told, which is worth
 * nothing as evidence. The harness asserts the stamping, and asserts that a non-admin is
 * refused.
 *
 * An entry with no actor is expected for a scheduled job or a server-side process, which acts
 * without a user session. That is a real gap in attribution and is labelled rather than hidden.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const pageRaw = Number.parseInt(
    typeof query.page === "string" ? query.page : "1",
    10,
  );
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 400) : 1;

  const { supabase } = await requireAdmin("/admin/audit");

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_user_id, actor_role, action, entity_table, entity_id, created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`Audit log read failed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <>
      <PageHeader
        label="Governance"
        title="Audit log"
        description="Every administrative change, with the actor taken from the verified session token rather than from anything the caller supplied."
      />

      <div className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-3">
        <p className="text-xs text-muted">
          <strong className="text-ink">This trail cannot be edited or deleted</strong>, by anyone -
          including the service role. It is written by a database function that stamps the actor
          from the JWT and refuses non-admins. Detail columns (before/after state) are recorded but
          not rendered here; the log is for accountability, not for browsing customer data.
        </p>
      </div>

      {pageRows.length === 0 ? (
        <EmptyState
          title="No administrative actions recorded yet"
          hint="The log fills as soon as a setting is changed, a product is saved, a provider is configured or an account is moderated. A completely fresh project legitimately has an empty trail."
        />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Actor</Th>
                <Th>Role</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id as number}>
                  <Td mono>{formatDateTime(row.created_at as string)}</Td>
                  <Td>
                    <span className="font-mono text-xs text-ink">{row.action as string}</span>
                  </Td>
                  <Td>
                    <span className="block font-mono text-xs text-muted">
                      {row.entity_table as string}
                    </span>
                    {row.entity_id && (
                      <span className="block font-mono text-[10px] text-dim">
                        {row.entity_id as string}
                      </span>
                    )}
                  </Td>
                  <Td mono>
                    {row.actor_user_id ? (
                      (row.actor_user_id as string)
                    ) : (
                      // Not hidden: an action attributed to nobody is exactly the entry a reviewer
                      // needs to notice, so it is called out rather than left blank.
                      <span className="text-accent">unattributed (server job)</span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono text-[10px] text-dim">
                      {(row.actor_role as string) ?? "-"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-dim">
              Page {page}
              {hasMore ? " - more entries available" : " - end of the trail"}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <a
                  href={`/admin/audit?page=${page - 1}`}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Newer
                </a>
              )}
              {hasMore && (
                <a
                  href={`/admin/audit?page=${page + 1}`}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Older
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
