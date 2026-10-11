import type { Metadata } from "next";
import Link from "next/link";

import { Badge, EmptyState, Notice, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { listAccounts, USERS_PER_PAGE } from "@/lib/admin/users";
import { requireAdminColumns } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Users" };

/**
 * Customer accounts.
 *
 * READ-ONLY AT THE LIST LEVEL. Moderation happens on the account detail page, because blocking
 * somebody is a decision that should require seeing their order history first - a suspension
 * button on a list row is one misclick away from locking out a paying customer.
 *
 * The accounts come from Supabase Auth (which needs the service role) merged with local
 * moderation state and order counts. When the privileged reader is unavailable the page says so
 * rather than showing an empty list: "no customers" and "cannot read customers" are different
 * facts, and presenting the second as the first would be a lie an operator would act on.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const parsed = Number.parseInt(rawPage ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 200) : 1;

  const { supabase, privileged } = await requireAdminColumns("/admin/users");
  const result = await listAccounts(privileged, supabase, page);

  return (
    <>
      <PageHeader
        label="Customers"
        title="Users"
        description="Accounts registered through Supabase Auth. A blocked account is refused server-side at checkout, not merely hidden in this interface."
      />

      {!result.available && (
        <Notice tone="warn">
          <strong className="text-ink">Accounts cannot be listed.</strong> {result.unavailableReason}{" "}
          Supabase Auth is not reachable through PostgREST, so the account list requires the Auth
          admin API and the service role. Until the key is set, this page cannot show whether any
          customers exist - it is not reporting that there are none.
        </Notice>
      )}

      {result.available && result.rows.length === 0 && (
        <EmptyState
          title={page > 1 ? "No accounts on this page" : "No accounts yet"}
          hint={
            page > 1
              ? "This page is past the end of the account list. Return to the first page."
              : "Accounts appear here the first time somebody signs in through Google or email. Guest checkouts do not create an account, so they will not appear."
          }
        />
      )}

      {result.rows.length > 0 && (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Status</Th>
                <Th>Role</Th>
                <Th align="right">Orders</Th>
                <Th>Joined</Th>
                <Th>Last sign-in</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((account) => (
                <tr key={account.id}>
                  <Td>
                    <Link
                      href={`/admin/users/${account.id}`}
                      className="block text-ink underline underline-offset-2 hover:text-accent"
                    >
                      {account.email ?? "(no email)"}
                    </Link>
                    <span className="block font-mono text-[10px] text-dim">{account.id}</span>
                  </Td>
                  <Td>
                    <span className="flex flex-col gap-1">
                      <Badge
                        label={account.status}
                        tone={
                          account.status === "active"
                            ? "ok"
                            : account.status === "suspended"
                              ? "warn"
                              : "bad"
                        }
                      />
                      {!account.emailConfirmed && (
                        <Badge label="email unverified" tone="neutral" />
                      )}
                    </span>
                  </Td>
                  <Td>
                    {account.roles.length > 0 ? (
                      <span className="font-mono text-xs text-accent">
                        {account.roles.join(", ")}
                      </span>
                    ) : (
                      <span className="text-xs text-dim">customer</span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {account.orderCount ?? "-"}
                  </Td>
                  <Td mono>{formatDateTime(account.createdAt)}</Td>
                  <Td mono>{formatDateTime(account.lastSignInAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-dim">
              Page {page}, up to {USERS_PER_PAGE} accounts per page.
              {result.hasMore ? " More accounts exist." : " This is the last page."}
            </p>
            <div className="flex items-center gap-2">
              {page > 1 && (
                <Link
                  href={`/admin/users?page=${page - 1}`}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Previous
                </Link>
              )}
              {result.hasMore && (
                <Link
                  href={`/admin/users?page=${page + 1}`}
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      <Notice tone="neutral">
        Administrator privilege is not granted from this page. It is stored in{" "}
        <code className="font-mono text-xs text-accent">app_metadata.nuvora_role</code>, which only
        the server can write - granting it is done through the Supabase dashboard or a
        service-role call, deliberately, so that a stolen admin session cannot promote itself or
        anyone else.
      </Notice>
    </>
  );
}
