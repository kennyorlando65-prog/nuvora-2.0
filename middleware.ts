import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv, isSupabaseConfigured } from "@/lib/env.public";
import { isAdminUser } from "@/lib/auth/roles";

/**
 * Edge middleware: session refresh and the admin gate's outer layer.
 *
 *   1. Refresh the auth token on every matched request. Supabase access tokens expire
 *      (jwt_exp is 3600s in this project) and only middleware can write the refreshed
 *      cookie back to the browser, so without this an operator would be silently signed
 *      out part-way through a long admin session.
 *
 *   2. Redirect an UNAUTHENTICATED request to /admin/* to the sign-in page.
 *
 *   3. Answer a signed-in NON-admin with a real HTTP 403.
 *
 * WHY 403 AND NOT A REDIRECT TO A "forbidden" PAGE.
 *   The obvious design - redirect non-admins to /admin/forbidden - does not work here,
 *   because that path lives under /admin and is therefore protected by the very guard
 *   doing the redirecting. The result is an infinite loop. Returning the refusal directly
 *   gives a genuine 403 status code, needs no extra route to maintain, and cannot loop.
 *
 * WHAT THIS STILL IS NOT: the authorisation decision. Middleware runs before rendering and
 * is an optimisation; the authoritative checks are `requireAdmin` in the admin layout and
 * `gateAdminApi` in every admin API handler. Both are in place, so a request that somehow
 * misses the matcher still cannot read admin data. Defence in depth, not one check in one
 * place.
 */

/**
 * The signed-in app's route prefixes.
 *
 * Listed explicitly rather than derived, because middleware runs on the edge with no access
 * to the route manifest. A prefix missing from here is still protected by the app layout's
 * own `requireUser` check - this list is the outer layer, not the only one.
 */
const APP_PATHS = ["/dashboard", "/store", "/checkout", "/orders"];

/** Minimal styled refusal, kept inline so middleware stays dependency-free. */
function forbiddenResponse(): NextResponse {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>403 - Not permitted | NUVORA</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#0e1116; color:#f0e9dc;
    font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .card { max-width:32rem; margin:2rem; padding:2rem;
    background:#161b22; border:1px solid #24393a; border-radius:14px; }
  .label { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.6875rem;
    letter-spacing:.14em; text-transform:uppercase; color:#7a8c8a; }
  h1 { margin:.5rem 0 .75rem; font-size:1.5rem; letter-spacing:-.02em; }
  p { margin:0 0 .75rem; color:#9fb0ae; }
  a { color:#2fb3a8; }
</style>
</head>
<body>
  <main class="card">
    <span class="label">403 - Forbidden</span>
    <h1>This account is not a NUVORA administrator</h1>
    <p>You are signed in, but this area is restricted to operator accounts. Signing in again
       will not change that - the privilege has to be granted to your account by an existing
       administrator.</p>
    <p>If you believe this is a mistake, contact support and quote your account email.</p>
    <p><a href="/dashboard">Return to your dashboard</a></p>
  </main>
</body>
</html>`;

  return new NextResponse(body, {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export async function middleware(request: NextRequest) {
  // Without configuration there is no session to refresh and no JWT to validate. Failing
  // open here is safe because both admin gates fail CLOSED: the layout redirects to
  // sign-in, which explains that Supabase is unconfigured rather than pretending to
  // authenticate anybody.
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
        // Two passes, both required: the request cookies so THIS render sees the refreshed
        // token, and the response cookies so the browser stores it for the next request.
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

  // getUser() is what performs the refresh and validates the token. getSession() would
  // only read the cookie without verifying or renewing it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");
  const isAppPath = APP_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isAdminPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // The role comes from the user object's app_metadata, which Supabase derives from the
  // VERIFIED token - not from anything the caller supplied in this request.
  if (isAdminPath && user && !isAdminUser(user)) {
    return forbiddenResponse();
  }

  // The signed-in app. Any authenticated user may enter - this is the CUSTOMER gate, and
  // it deliberately does not look at roles, because a customer has no role and requiring
  // one would lock every customer out. The admin check above is unaffected by this branch.
  if (isAppPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // An already-signed-in visitor has no use for the sign-in form. They are sent to the
  // customer dashboard rather than the admin area, because most people signing in are
  // customers - and because sending everyone to /admin would advertise that it exists.
  if (pathname === "/auth/sign-in" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Narrow on purpose. Running this on every asset request would refresh tokens
  // pointlessly and add latency to static files that need no session. The matcher is also
  // what keeps /auth/callback out of the "already signed in" redirect, because the OAuth
  // callback must stay reachable while a session is being established.
  matcher: [
    "/admin",
    "/admin/:path*",
    "/dashboard",
    "/store",
    "/store/:path*",
    "/checkout",
    "/orders",
    "/orders/:path*",
    "/auth/sign-in",
  ],
};
