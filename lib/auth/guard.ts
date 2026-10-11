import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/ssr-server";
import { isAdminUser } from "@/lib/auth/roles";

/**
 * Server-side admin gate.
 *
 * This is the check that matters. `middleware.ts` also guards `/admin/*`, but middleware is
 * an optimisation - it stops an unauthorised request before any rendering work happens.
 * THIS is the authorisation decision, and it runs on the server for every admin page and
 * every admin API handler, so a request that somehow bypasses the matcher still cannot read
 * admin data. A client-side `if (!isAdmin)` anywhere in this codebase would be decoration.
 */

export type SessionContext = {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  user: User | null;
};

/** The current session's user, or null. Never throws on a missing session. */
export async function getSessionUser(): Promise<SessionContext> {
  const supabase = await getSupabaseServerClient();

  // getUser() validates the access token against the auth server. getSession() only reads
  // the cookie, which a caller can forge - so it is not used for authorisation anywhere.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

/**
 * Require an admin, or send the caller somewhere honest.
 *
 * Two distinct outcomes on purpose. An unauthenticated visitor is sent to sign in and comes
 * back to where they were going. A signed-in NON-admin is sent to the storefront home, NOT
 * to a "/admin/forbidden" page - each reason is a real bug that was avoided:
 *
 *   - A /admin/forbidden route does not exist in this codebase.
 *   - If it did, it would live under /admin and be guarded by the same check doing the
 *     redirecting, which is an infinite loop.
 *   - The admin layout already renders a full, styled refusal for a signed-in non-admin,
 *     so this branch is the belt to that braces. Sending them home is always safe.
 */
export async function requireAdmin(nextPath = "/admin"): Promise<{
  supabase: SessionContext["supabase"];
  user: User;
}> {
  const { supabase, user } = await getSessionUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  if (!isAdminUser(user)) {
    redirect("/");
  }

  return { supabase, user };
}

/**
 * Admin gate for API route handlers, where redirecting is wrong.
 *
 * Returns a discriminated result instead of throwing so the caller decides the response
 * shape; a route that redirected to an HTML page would hand a fetch() caller a login form
 * with a 200 status, which is how a broken guard passes an integration test.
 */
export type AdminGateResult =
  | { ok: true; supabase: SessionContext["supabase"]; user: User }
  | { ok: false; status: 401 | 403; reason: string };

export async function gateAdminApi(): Promise<AdminGateResult> {
  const { supabase, user } = await getSessionUser();

  if (!user) {
    return { ok: false, status: 401, reason: "Authentication required." };
  }

  if (!isAdminUser(user)) {
    return { ok: false, status: 403, reason: "Administrator privilege required." };
  }

  return { ok: true, supabase, user };
}

/**
 * The service-role client, for an admin reading columns no client role may select.
 *
 * WHY THIS EXISTS AT ALL, because "use the service role in the admin area" is exactly the
 * kind of sentence that hides a hole.
 *
 * Column grants in Postgres are per ROLE, not per row. The migration grants
 * `authenticated` an explicit allow-list on orders, order_items and payments, and that list
 * deliberately OMITS the commercially sensitive and staff-only columns: `internal_note`,
 * `engine_version`, `created_ip_hash`, `unit_price_minor`, `unit_cost_minor`,
 * `supplier_reference`, `raw_payload`, and the whole cost side of products. The admin RLS
 * policy grants an admin ROWS, but it cannot grant them COLUMNS - RLS has no say in column
 * privileges. So an admin session, correctly authenticated, simply cannot select
 * `internal_note` through PostgREST. That is the intended design: it means a stolen admin
 * session still cannot read the cost or margin columns over the public API, and it is why
 * the admin surface needs the service role for exactly those fields.
 *
 * THE PRECONDITION IS THE WHOLE SAFETY ARGUMENT. This function calls `requireAdmin` FIRST
 * and only then builds the privileged client, so the service role can never be reached
 * without a verified admin session. It returns the two clients together on purpose: the
 * caller is handed the user-scoped client for ordinary reads and the privileged one for the
 * hidden columns, side by side, which makes "which client am I using, and why" a visible
 * decision at every call site rather than an invisible default.
 *
 * RULES FOR CALLERS
 *   - Never use the privileged client for a write. Writes go through the user-scoped client
 *     so that RLS, the schema constraints and the audit trigger all still apply.
 *   - Never pass a privileged value into a client component or into any JSON response that
 *     reaches a customer. Cost and margin are server-rendered, or not shown at all.
 *   - Never use it to bypass a guard. If a page has not called requireAdmin, it does not
 *     have this function available to it.
 */
export async function requireAdminColumns(nextPath = "/admin"): Promise<{
  /** User-scoped: subject to RLS, the right client for every write and every normal read. */
  supabase: SessionContext["supabase"];
  /** Service-role: bypasses RLS. Read-only, hidden columns only. */
  privileged: import("@supabase/supabase-js").SupabaseClient;
  user: User;
}> {
  const { supabase, user } = await requireAdmin(nextPath);
  const { getServiceRoleClient } = await import("@/lib/supabase/server");

  return { supabase, privileged: getServiceRoleClient(), user };
}