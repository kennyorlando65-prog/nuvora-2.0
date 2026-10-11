import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/ssr-server";

/**
 * OAuth / email-link callback.
 *
 * Supabase returns here after a provider round trip, an email confirmation or a recovery
 * link, carrying a short-lived `code` that must be exchanged for a session. The exchange
 * happens server-side so the resulting tokens land in httpOnly cookies rather than in a
 * URL fragment a script can read.
 *
 * `/auth/callback` is intentionally NOT in the middleware matcher: it must remain
 * reachable while a session is being established, and the "already signed in, go to /admin"
 * redirect in middleware would otherwise intercept it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/admin";

  // Same open-redirect guard as the sign-in action: only same-site absolute paths.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/admin";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/sign-in?error=oauth-failed&next=${encodeURIComponent(next)}`,
    );
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/sign-in?error=oauth-failed&next=${encodeURIComponent(next)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
