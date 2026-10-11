import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { getSessionUser } from "@/lib/auth/guard";

/**
 * The signed-in app's session guard.
 *
 * This is the CUSTOMER gate, and it is deliberately a different thing from the admin gate
 * in lib/auth/guard.ts. It answers one question - "is anybody signed in?" - and nothing
 * else. It does not look at roles, because a customer has no role and requiring one would
 * lock every customer out.
 *
 * The admin gate is NOT weakened by this file existing. /admin keeps its own layout check
 * and its own middleware check, both of which read the role. A signed-in customer who
 * types /admin still gets a 403 from those, not access from here.
 *
 * WHY THE APP IS BEHIND A SIGN-IN AT ALL. The founder asked for a public front door: a
 * visitor should land on an explanation and a sign-up, not straight into the product. The
 * store is also empty until real products are added, and an empty shop behind a sign-in is
 * an honest empty state while an empty shop on the open internet reads as a broken site.
 */
export type AppSession = {
  supabase: Awaited<ReturnType<typeof getSessionUser>>["supabase"];
  user: User;
};

/**
 * Require any signed-in user, or send them to sign in and back again.
 *
 * `nextPath` is carried through so a customer who follows a deep link while signed out
 * lands where they were going rather than on the dashboard.
 */
export async function requireUser(nextPath = "/dashboard"): Promise<AppSession> {
  const { supabase, user } = await getSessionUser();

  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  return { supabase, user };
}

/**
 * The display name for the "signed in as" indicator.
 *
 * Prefers the name the customer gave at sign-up, falls back to the email, and finally to
 * the id. Never returns an empty string, because an empty identity line reads as a bug.
 */
export function displayName(user: User): string {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (fullName) return fullName;
  return user.email ?? user.id;
}

/** First letter for the avatar chip. Falls back to "N" so the chip is never blank. */
export function initialOf(user: User): string {
  const source = displayName(user).trim();
  return (source[0] ?? "N").toUpperCase();
}
