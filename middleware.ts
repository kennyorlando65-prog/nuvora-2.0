import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv, isSupabaseConfigured } from "@/lib/env.public";

/**
 * Edge middleware: session refresh and the first line of the admin gate.
 *
 * TWO JOBS, and it is worth being precise about which one is security.
 *
 *   1. Refresh the auth token on every matched request. Supabase access tokens expire
 *      (jwt_exp is 3600s in this project), and only middleware can write the refreshed
 *      cookie back to the browser. Without this, an operator working through a long admin
 *      session would be silently signed out mid-task.
 *
 *   2. Redirect an UNAUTHENTICATED request to /admin/* to the sign-in page, so nobody
 *      renders an admin shell they cannot use.
 *
 * WHAT THIS IS NOT: the authorisation decision. That belongs to the server-side guard in
 * `lib/auth/guard.ts`, which runs on every admin page and every admin API handler and
 * checks `app_metadata.nuvora_role`. Middleware is an optimisation - it saves a wasted
 * render - and it deliberately does not check the admin ROLE, only that a session exists.
 * Checking the role here would mean also matching /admin/forbidden, and an over-broad
 * matcher that redirects non-admins away from the very page explaining the refusal is a
 * redirect loop. The authoritative check lives where it cannot be skipped.
 */

export async function middleware(request: NextRequest) {
  // Without configuration there is no session to refresh. Failing open here is safe
  // because the guard in every admin route fails CLOSED: it redirects to sign-in, which
  // then explains that Supabase is not configured rather than pretending to authenticate.
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Two passes, and both are required: the request cookies must be updated so the
        // CURRENT render sees the refreshed token, and the response cookies so the
        // browser stores it for the next request.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what performs the refresh. getSession() would only read the
  // cookie without validating or renewing it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // An already-signed-in operator has no use for the sign-in form.
  if (pathname === "/auth/sign-in" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Narrow on purpose. Running this on every asset request would refresh tokens pointlessly
  // and add latency to static files that need no session at all. The matcher is also what
  // keeps /auth/callback out of the "already signed in" redirect above, because the OAuth
  // callback MUST be reachable while a session is being established.
  matcher: ["/admin", "/admin/:path*", "/auth/sign-in"],
};
