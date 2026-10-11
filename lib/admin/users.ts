import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer accounts and moderation.
 *
 * TWO SOURCES, DELIBERATELY JOINED IN CODE.
 * The account list lives in Supabase Auth (`auth.users`), which is owned by GoTrue and is not
 * exposed through PostgREST - it is reachable only through the Auth admin API, which needs the
 * service role. The moderation state lives in `public.user_moderation`, which RLS protects.
 * Neither alone answers "who is suspended and why", so both are read and merged here.
 *
 * WHY A LOCAL MODERATION TABLE RATHER THAN ONLY `banned_until`.
 * Supabase Auth's ban flag records THAT an account is blocked. A store that blocks a paying
 * customer needs to record WHY, by whom, and until when under review - otherwise support can
 * see a locked account and have nothing to tell the person. The ban flag is still set, because
 * it is what actually revokes the session; the local row is the explanation.
 */

export type AccountRow = {
  id: string;
  email: string | null;
  status: string;
  reason: string | null;
  suspendedAt: string | null;
  suspendedUntil: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  banUntil: string | null;
  roles: string[];
  orderCount: number | null;
};

export type AccountsResult = {
  available: boolean;
  unavailableReason?: string;
  rows: AccountRow[];
  page: number;
  perPage: number;
  hasMore: boolean;
};

export const USERS_PER_PAGE = 25;

/**
 * Lists accounts by merging the Auth user list with local moderation state.
 *
 * FAILS SOFT: without the service role the Auth admin API cannot be reached, so the page
 * reports that plainly rather than showing an empty list. An empty customer list and an
 * unreachable customer list are completely different facts, and conflating them would make an
 * operator believe there are no customers.
 */
export async function listAccounts(
  privileged: SupabaseClient | null,
  supabase: SupabaseClient,
  page: number,
): Promise<AccountsResult> {
  if (!privileged) {
    return {
      available: false,
      unavailableReason:
        "Reading accounts requires the Auth admin API. Set SUPABASE_SERVICE_ROLE_KEY in Vercel.",
      rows: [],
      page,
      perPage: USERS_PER_PAGE,
      hasMore: false,
    };
  }

  const { data, error } = await privileged.auth.admin.listUsers({
    page,
    perPage: USERS_PER_PAGE,
  });

  if (error) {
    return {
      available: false,
      unavailableReason: `Auth admin API failed: ${error.message}`,
      rows: [],
      page,
      perPage: USERS_PER_PAGE,
      hasMore: false,
    };
  }

  const users = data?.users ?? [];

  // Moderation rows for this page of users, one query rather than one per user.
  const ids = users.map((user) => user.id);
  const { data: moderation } = ids.length
    ? await supabase
        .from("user_moderation")
        .select("user_id, status, reason, suspended_at, suspended_until")
        .in("user_id", ids)
    : { data: [] as Array<Record<string, unknown>> };

  const moderationByUser = new Map<string, Record<string, unknown>>();
  for (const row of (moderation ?? []) as Array<Record<string, unknown>>) {
    moderationByUser.set(row.user_id as string, row);
  }

  // Order counts for the same page, again in one query per user but issued concurrently.
  // `head: true` avoids transferring rows.
  const counts = new Map<string, number>();
  await Promise.all(
    ids.map(async (id) => {
      const { count } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("user_id", id);
      counts.set(id, count ?? 0);
    }),
  );

  const rows: AccountRow[] = users.map((user) => {
    const mod = moderationByUser.get(user.id);

    // The role is read from app_metadata, which only the server can write. Nothing here reads
    // user_metadata, which the account holder can edit themselves.
    const metadata = (user.app_metadata ?? {}) as Record<string, unknown>;
    const roles: string[] = [];
    if (typeof metadata.nuvora_role === "string") roles.push(metadata.nuvora_role);
    if (metadata.nuvora_roles && Array.isArray(metadata.nuvora_roles)) {
      for (const role of metadata.nuvora_roles) {
        if (typeof role === "string") roles.push(role);
      }
    }

    return {
      id: user.id,
      email: user.email ?? null,
      // A user with no moderation row is active by definition. Reporting "unknown" here would
      // be technically cautious and operationally useless.
      status: (mod?.status as string) ?? "active",
      reason: (mod?.reason as string | null) ?? null,
      suspendedAt: (mod?.suspended_at as string | null) ?? null,
      suspendedUntil: (mod?.suspended_until as string | null) ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
      banUntil: user.banned_until ?? null,
      roles,
      orderCount: counts.get(user.id) ?? null,
    };
  });

  return {
    available: true,
    rows,
    page,
    perPage: USERS_PER_PAGE,
    // listUsers returns a full page when more exist; a short page means the end.
    hasMore: rows.length === USERS_PER_PAGE,
  };
}

/**
 * One account, with its order history.
 *
 * The order history is read with the admin session's client, so RLS authorises it - the same
 * admin policy the verification harness proves against a non-admin.
 */
export async function getAccountDetail(
  privileged: SupabaseClient | null,
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  account: AccountRow | null;
  orders: Array<{
    id: string;
    order_number: string;
    status: string;
    currency: string;
    total_minor: number;
    created_at: string;
  }>;
  unavailableReason?: string;
}> {
  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, status, currency, total_minor, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: moderation } = await supabase
    .from("user_moderation")
    .select("status, reason, suspended_at, suspended_until")
    .eq("user_id", userId)
    .maybeSingle();

  if (!privileged) {
    return {
      account: null,
      orders: orders ?? [],
      unavailableReason:
        "The account itself is read through the Auth admin API. Set SUPABASE_SERVICE_ROLE_KEY in Vercel.",
    };
  }

  const { data, error } = await privileged.auth.admin.getUserById(userId);

  if (error || !data?.user) {
    return {
      account: null,
      orders: orders ?? [],
      unavailableReason: error ? `Auth admin API failed: ${error.message}` : "Account not found.",
    };
  }

  const user = data.user;
  const metadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  const roles: string[] = [];
  if (typeof metadata.nuvora_role === "string") roles.push(metadata.nuvora_role);
  if (Array.isArray(metadata.nuvora_roles)) {
    for (const role of metadata.nuvora_roles) {
      if (typeof role === "string") roles.push(role);
    }
  }

  return {
    account: {
      id: user.id,
      email: user.email ?? null,
      status: (moderation?.status as string) ?? "active",
      reason: (moderation?.reason as string | null) ?? null,
      suspendedAt: (moderation?.suspended_at as string | null) ?? null,
      suspendedUntil: (moderation?.suspended_until as string | null) ?? null,
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
      banUntil: user.banned_until ?? null,
      roles,
      orderCount: (orders ?? []).length,
    },
    orders: orders ?? [],
  };
}

// ---------------------------------------------------------------------------
// Suspension
// ---------------------------------------------------------------------------

const MODERATION_STATUSES = ["active", "suspended", "banned"] as const;

export const USER_ERRORS: Record<string, string> = {
  "status-invalid": "Choose a valid account status.",
  "reason-required": "A reason is required when blocking an account. Support needs it, and so does the audit trail.",
  "reason-too-long": "The reason must be 500 characters or fewer.",
  "self-block": "You cannot block your own account. Ask another administrator.",
  "user-not-found": "That account no longer exists.",
  "auth-update-failed": "The account could not be updated in Supabase Auth, so the change was not saved.",
};

export type ModerationInput =
  | { ok: true; status: string; reason: string | null; until: string | null }
  | { ok: false; error: string };

export function parseModerationForm(formData: FormData): ModerationInput {
  const status = String(formData.get("status") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const untilRaw = String(formData.get("suspended_until") ?? "").trim();

  if (!MODERATION_STATUSES.includes(status as (typeof MODERATION_STATUSES)[number])) {
    return { ok: false, error: "status-invalid" };
  }

  if (status === "active") {
    // Clearing a block needs no reason; the historical rows keep the previous explanation.
    return { ok: true, status, reason: null, until: null };
  }

  if (reason.length < 3) return { ok: false, error: "reason-required" };
  if (reason.length > 500) return { ok: false, error: "reason-too-long" };

  let until: string | null = null;
  if (untilRaw) {
    const parsed = new Date(untilRaw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "status-invalid" };
    // Rejected rather than silently ignored: a reviewer who typed a date must not be told the
    // block is indefinite without being told why their date was dropped.
    if (parsed.getTime() <= Date.now()) return { ok: false, error: "status-invalid" };
    until = parsed.toISOString();
  }

  return { ok: true, status, reason, until };
}

/**
 * A ban duration in GoTrue's format.
 *
 * Supabase's admin API takes a duration string, not a timestamp. A distant date is used for an
 * indefinite block because "0" clears the ban outright, which would do the opposite of what
 * was asked.
 */
export const INDEFINITE_BAN_DURATION = "876000h"; // 100 years

/**
 * Reads the suspension state for a user or email, for the checkout path.
 *
 * Returns the block reason when the account must be refused, or null when it may proceed. Used
 * by checkout so that a suspension is enforced where the money is taken, not merely hidden in
 * an interface - a suspended customer with a bookmarked checkout URL must be refused, and they
 * are only refused here.
 *
 * An UNSETTLED REVIEW is treated as blocked: if `suspended_until` has passed, the account is
 * allowed again, but while a review is open the account is refused. That direction is chosen
 * deliberately - letting a blocked account buy while an investigation is open is a worse error
 * than briefly refusing somebody who has been cleared, and the operator can lift it in one click.
 */
export async function checkAccountBlocked(
  supabase: SupabaseClient,
  userId: string | null,
  email: string | null,
): Promise<{ blocked: boolean; reason: string | null; status: string | null }> {
  const query = supabase.from("user_moderation").select("status, reason, suspended_until, user_id, email");

  const { data } = userId
    ? await query.eq("user_id", userId).maybeSingle()
    : email
      ? await query.eq("email", email).maybeSingle()
      : { data: null };

  if (!data) return { blocked: false, reason: null, status: null };

  const status = data.status as string;
  if (status === "active") return { blocked: false, reason: null, status };

  // A suspension with an expiry that has passed no longer blocks. A ban never expires on a
  // date; it has to be lifted explicitly.
  if (status === "suspended" && data.suspended_until) {
    const until = new Date(data.suspended_until as string);
    if (!Number.isNaN(until.getTime()) && until.getTime() <= Date.now()) {
      return { blocked: false, reason: null, status };
    }
  }

  return {
    blocked: true,
    reason: (data.reason as string | null) ?? null,
    status,
  };
}
