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
 * back to where they were going. A signed-in NON-admin is sent to /admin/forbidden, which
 * explains the refusal - sending them to the sign-in page would be a redirect loop, since
 * they are already signed in and signing in again changes nothing.
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
    redirect("/admin/forbidden");
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
