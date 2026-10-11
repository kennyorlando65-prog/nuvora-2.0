import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, Card, Notice, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  formatDateTime,
  formatMoney,
  labelOf,
  toneOf,
} from "@/lib/admin/format";
import { USER_ERRORS, getAccountDetail } from "@/lib/admin/users";
import { setModerationAction } from "@/lib/admin/user-actions";
import { requireAdminColumns } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Account" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD =
  "rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";

/**
 * Account detail and moderation.
 *
 * THE TWO HALVES OF A BLOCK, MADE VISIBLE.
 * Blocking an account writes two things: a moderation row (why, by whom, until when) and a ban
 * flag in Supabase Auth (which is what actually revokes the session and prevents a new sign-in).
 * The card below says both, because an operator should know that clearing a block also has to
 * clear the flag - a state where the row says "active" but the ban flag is still set would look
 * fixed and still refuse the customer.
 *
 * The order history is read through the admin session's client, so RLS authorises it. That is
 * the same admin policy the verification harness proves against a non-admin, which is why this
 * page cannot become a leak even if the guard were wrong - the database would return nothing.
 */
export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (!UUID.test(id)) notFound();

  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  const { supabase, privileged, user: actor } = await requireAdminColumns(`/admin/users/${id}`);
  const { account, orders, unavailableReason } = await getAccountDetail(privileged, supabase, id);

  const isSelf = id === actor.id;
  const errorText = error ? (USER_ERRORS[error] ?? "The change was refused.") : "";

  return (
    <>
      <Link href="/admin/users" className="text-xs text-muted underline hover:text-accent">
        Back to users
      </Link>

      <PageHeader
        label="Account"
        title={account?.email ?? id}
        description={
          account
            ? `Registered ${formatDateTime(account.createdAt)}. ${account.emailConfirmed ? "Email verified." : "Email not verified."}`
            : "The Auth admin API could not be reached, so account metadata is unavailable."
        }
        actions={
          account && (
            <Badge
              label={account.status}
              tone={account.status === "active" ? "ok" : account.status === "suspended" ? "warn" : "bad"}
            />
          )
        }
      />

      {errorText && (
        <Notice tone="bad">
          {errorText}
          {error === "auth-update-failed" && (
            <>
              {" "}
              The moderation record was written, so the decision is on file, but the ban was not
              applied in Supabase Auth. The account can still sign in until this is retried.
            </>
          )}
        </Notice>
      )}
      {notice === "saved" && <Notice tone="ok">Account status updated.</Notice>}

      {unavailableReason && (
        <Notice tone="warn">
          <strong className="text-ink">Account details are unavailable.</strong> {unavailableReason}{" "}
          The order history below is still shown, because it is read through the admin session
          under Row Level Security rather than through the Auth admin API.
        </Notice>
      )}

      {account && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Account state">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="User id" value={account.id} mono />
              <Row label="Email" value={account.email ?? "-"} />
              <Row label="Email verified" value={account.emailConfirmed ? "yes" : "no"} />
              <Row label="Joined" value={formatDateTime(account.createdAt)} />
              <Row label="Last sign-in" value={formatDateTime(account.lastSignInAt)} />
              <Row
                label="Role"
                value={account.roles.length > 0 ? account.roles.join(", ") : "customer"}
              />
              <Row label="Ban flag in Auth" value={account.banUntil ? `until ${formatDateTime(account.banUntil)}` : "not set"} />
            </dl>
            <p className="text-xs text-dim">
              The ban flag is what revokes the session and blocks a new sign-in. The moderation
              record below is the explanation. Both are written together, and both must be cleared
              together - clearing only one leaves a customer who looks unblocked and is not.
            </p>
          </Card>

          <Card title="Moderation record">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Status" value={account.status} />
              <Row label="Suspended at" value={formatDateTime(account.suspendedAt)} />
              <Row
                label="Suspended until"
                value={account.suspendedUntil ? formatDateTime(account.suspendedUntil) : "no expiry"}
              />
            </dl>
            <div className="mt-1 border-t border-line pt-2">
              <dt className="nuvora-label">Reason on file</dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {account.reason ?? "No reason recorded."}
              </dd>
            </div>
            <p className="text-xs text-dim">
              A block cannot be recorded without a reason, enforced by a database constraint. A
              support agent looking at a locked account has to be able to tell the customer why.
            </p>
          </Card>
        </div>
      )}

      <Card
        title={account?.status === "active" ? "Block this account" : "Change or lift this block"}
        description="Suspension is reversible and can carry an expiry. A ban does not expire and has to be lifted by hand. Both are enforced at checkout."
      >
        {isSelf ? (
          <Notice tone="warn">
            This is your own account. Blocking yourself would lock out the person able to unblock
            it, and the only recovery would be a service-role call by hand. Ask another
            administrator instead.
          </Notice>
        ) : (
          <form action={setModerationAction} className="flex flex-col gap-4">
            <input type="hidden" name="user_id" value={id} />

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="nuvora-label">New status</span>
                <select
                  name="status"
                  defaultValue={account?.status === "banned" ? "banned" : "active"}
                  className={FIELD}
                >
                  <option value="active">Active - allow to buy</option>
                  <option value="suspended">Suspended - temporary, can expire</option>
                  <option value="banned">Banned - until lifted by hand</option>
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="nuvora-label">Suspend until</span>
                <input type="datetime-local" name="suspended_until" className={FIELD} />
                <span className="text-xs text-dim">
                  Only applies to a suspension. Leave empty to block until lifted by hand.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="nuvora-label">Orders on record</span>
                <span className="font-mono text-sm text-ink">{account?.orderCount ?? orders.length}</span>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="nuvora-label">Reason (required when blocking)</span>
              <textarea
                name="reason"
                rows={3}
                maxLength={500}
                placeholder="Explain the decision. This is what a support agent will read when the customer asks why."
                className={FIELD}
              />
              <span className="text-xs text-dim">
                Recorded in the audit log and shown to support. Do not include anything that must
                not be visible to other administrators.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
              >
                Apply account status
              </button>
              <span className="text-xs text-dim">
                This writes the moderation row first, then the ban flag in Supabase Auth.
              </span>
            </div>
          </form>
        )}
      </Card>

      <Card
        title="Order history"
        description="Read through this admin session under Row Level Security. A non-administrator session cannot read another user's orders at all, which the migration harness asserts directly against the database."
      >
        {orders.length === 0 ? (
          <p className="text-sm text-muted">
            No orders against this account. Guest checkouts do not appear here, because they carry
            no account reference.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th align="right">Total</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <Td mono>
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {order.order_number}
                    </Link>
                  </Td>
                  <Td>
                    <Badge
                      label={labelOf(ORDER_STATUS_LABELS, order.status)}
                      tone={toneOf(ORDER_STATUS_TONES, order.status)}
                    />
                  </Td>
                  <Td align="right" mono>
                    {formatMoney(order.total_minor, order.currency)}
                  </Td>
                  <Td mono>{formatDateTime(order.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-dim">{label}</dt>
      <dd className={`text-right ${mono ? "font-mono text-xs" : "text-sm"} text-ink`}>{value}</dd>
    </div>
  );
}
