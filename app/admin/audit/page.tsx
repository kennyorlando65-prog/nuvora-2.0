import type { Metadata } from "next";

import { EmptyState, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

/**
 * The admin action trail.
 *
 * This is the read side of `log_admin_action`, which stamps the actor from the VERIFIED JWT
 * rather than accepting an actor id from the caller. That distinction is the whole reason the
 * trail is worth reading: every row below identifies a real session, not an assertion.
 *
 * The table is append-only by grant - not even the service role holds UPDATE or DELETE on it -
 * and the existing audit trigger redacts gateway payloads before they reach it. So a row here
 * cannot be edited after the fact, and cannot contain a customer's raw payment payload.
 *
 * `before` and `after` are shown collapsed. They are JSON, they can be long, and the common
 * question ("who changed this and when") is answered without expanding anything.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 1;

  const { supabase } = await requireAdmin("/admin/audit");

  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("audit_log")
    // `occurred_at`, NOT `created_at`. audit_log has no created_at column at all - the
    // timestamp is named occurred_at - and asking PostgREST for a column that does not exist
    // is a 500 on this page. The column is named in the migration and the name is deliberate,
    // so the fix is here rather than in the schema.
    .select("id, actor_user_id, actor_role, action, entity_table, entity_id, before, after, correlation_id, occurred_at")
    .order("occurred_at", { ascending: false })
    .range(from, from + PAGE_SIZE);

  if (error) throw new Error(`Audit log query failed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <>
      <PageHeader
        label="Governance"
        title="Audit log"
        description="Every administrative write, with the actor taken from the verified session token rather than from the request. Append-only: no role, including the service role, can update or delete a row."
      />

      {pageRows.length === 0 ? (
        <EmptyState
          title="No administrative actions recorded"
          hint="This is the expected state before anyone has changed anything through the admin area. Rows appear as soon as the first product, setting, provider or account is modified."
        />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row) => (
                <tr key={row.id as number}>
                  <Td mono>{formatDateTime(row.occurred_at as string)}</Td>
                  <Td>
                    <span className="block font-mono text-[10px] text-ink">
                      {(row.actor_user_id as string) ?? "service role"}
                    </span>
                    <span className="block font-mono text-[10px] text-dim">
                      {(row.actor_role as string) ?? "-"}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-accent">{row.action as string}</span>
                  </Td>
                  <Td>
                    <span className="block text-xs text-ink">{row.entity_table as string}</span>
                    {row.entity_id && (
                      <span className="block font-mono text-[10px] text-dim">
                        {String(row.entity_id).slice(0, 40)}
                      </span>
                    )}
                  </Td>
                  <Td>
                    {row.before === null && row.after === null ? (
                      <span className="text-xs text-dim">no payload</span>
                    ) : (
                      <details className="max-w-md">
                        <summary className="cursor-pointer text-xs text-muted">
                          {row.before !== null && row.after !== null
                            ? "before and after"
                            : row.after !== null
                              ? "after"
                              : "before"}
                        </summary>
                        {row.before !== null && (
                          <pre className="mt-1 overflow-x-auto text-[10px] leading-relaxed text-dim">
                            before {JSON.stringify(row.before)}
                          </pre>
                        )}
                        {row.after !== null && (
                          <pre className="mt-1 overflow-x-auto text-[10px] leading-relaxed text-dim">
                            after {JSON.stringify(row.after)}
                          </pre>
                        )}
                      </details>
                    )}
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
                  className="nuvora-btn nuvora-btn-secondary px-3 py-1.5"
                >
                  Newer
                </a>
              )}
              {hasMore && (
                <a
                  href={`/admin/audit?page=${page + 1}`}
                  className="nuvora-btn nuvora-btn-secondary px-3 py-1.5"
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
