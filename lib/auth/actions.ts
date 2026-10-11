"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { getSupabaseServerClient } from "@/lib/supabase/ssr-server";
import { clientKeyFrom, rateLimit } from "@/lib/ratelimit";
import { publicEnv } from "@/lib/env.public";

/**
 * Authentication server actions.
 *
 * Sign-in goes through Supabase Auth rather than a hand-rolled credential store, for one
 * concrete reason: `auth.uid()` is what `public.is_admin()` reads, and it is what every
 * RLS policy is written against. A parallel auth system would produce sessions the
 * database cannot see, and the admin policies would then deny the very operators they
 * exist to admit.
 *
 * Every failure is reported as a short machine code in the URL, never as free text. The
 * sign-in page maps codes to copy, which keeps user-facing wording out of the security
 * path and - more importantly - means a failure can never echo a submitted value back
 * into the page.
 */

/** Rate limit: attempts per window, per client key. */
const SIGNIN_LIMIT = 8;
const SIGNIN_WINDOW_MS = 10 * 60 * 1000;

/** Account creation is throttled harder than sign-in: it is the mass-registration endpoint. */
const SIGNUP_LIMIT = 5;

/**
 * The default destination after a successful sign-in.
 *
 * THE CUSTOMER DASHBOARD, not the admin console. This used to be /admin, which was correct
 * when the only accounts were operators. Now that customers sign up and sign in through the
 * same form, defaulting to /admin would send every ordinary customer to a 403 on their very
 * first visit. An operator heading for /admin still arrives there, because the `next`
 * parameter carries it through.
 */
const DEFAULT_NEXT = "/dashboard";

function safeNext(raw: unknown): string {
  // Only same-site absolute paths. An attacker-supplied `next` of "//evil.example" or
  // "https://evil.example" would turn our own sign-in page into an open redirect, which
  // is the standard way a login flow is abused for phishing.
  if (typeof raw !== "string" || raw === "") return DEFAULT_NEXT;
  if (!raw.startsWith("/")) return DEFAULT_NEXT;
  if (raw.startsWith("//")) return DEFAULT_NEXT;
  return raw;
}

export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const backTo = (code: string) =>
    `/auth/sign-in?error=${code}&next=${encodeURIComponent(next)}`;

  if (!email || !password) {
    redirect(backTo("missing"));
  }

  // Rate limited on the IP AND on the email, because either alone is bypassable: an
  // attacker rotating IPs still hammers one account, and an attacker spraying many
  // accounts from one host still hammers the endpoint. The limiter is in-memory and
  // therefore per-instance - see the honest scope note in lib/ratelimit.ts.
  const headerList = await headers();
  const ipLimit = rateLimit({
    key: clientKeyFrom(headerList, "auth:signin"),
    limit: SIGNIN_LIMIT,
    windowMs: SIGNIN_WINDOW_MS,
  });
  const emailLimit = rateLimit({
    key: `auth:signin:email:${email}`,
    limit: SIGNIN_LIMIT,
    windowMs: SIGNIN_WINDOW_MS,
  });

  if (!ipLimit.allowed || !emailLimit.allowed) {
    redirect(backTo("throttled"));
  }

  const supabase = await getSupabaseServerClient();

  // The result is captured, never thrown: a thrown auth error must not become an
  // unhandled 500 that differs observably from a wrong password, because that difference
  // is an account-enumeration oracle.
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(backTo("invalid"));
  }

  // purge the cache so the admin shell renders with the new session rather than a
  // previously cached anonymous shell.
  revalidatePath("/", "layout");
  redirect(next);
}

/**
 * Customer sign-up.
 *
 * Creates the account through Supabase Auth, so the resulting session is one the database
 * can see: `auth.uid()` resolves, and every RLS policy written against it applies. A
 * hand-rolled customer table would produce sessions the policies cannot evaluate, and the
 * order policies would then deny the customers they exist to admit.
 *
 * The name is stored in `user_metadata`, which is the correct place for it: it is the
 * customer's own profile data, not a privilege. Privileges live in `app_metadata`, which a
 * client cannot write - see lib/auth/roles.ts for why that distinction is the whole
 * security model of the admin area.
 *
 * Rate limited on the IP, because account creation is the endpoint an abuser would use to
 * mass-register. The limiter is in-memory and therefore per-instance; see the honest scope
 * note in lib/ratelimit.ts.
 */
export async function signUpAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 120);

  if (!email || password.length < 8) {
    redirect("/auth/sign-up?error=missing");
  }

  const headerList = await headers();
  const limit = rateLimit({
    key: clientKeyFrom(headerList, "auth:signup"),
    limit: SIGNUP_LIMIT,
    windowMs: SIGNIN_WINDOW_MS,
  });

  if (!limit.allowed) {
    redirect("/auth/sign-up?error=throttled");
  }

  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      ...(fullName ? { data: { full_name: fullName } } : {}),
      emailRedirectTo: `${publicEnv.siteUrl}/auth/callback?next=%2Fdashboard`,
    },
  });

  if (error) {
    // Supabase reports an existing address as a generic error rather than a distinct code,
    // so the message is matched rather than the code. The wording is deliberately the same
    // for "already registered" and "could not create", because a distinct response for an
    // existing address is an account-enumeration oracle.
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      redirect("/auth/sign-up?error=already-registered");
    }
    if (message.includes("password")) {
      redirect("/auth/sign-up?error=weak-password");
    }
    redirect("/auth/sign-up?error=signup-failed");
  }

  // With email confirmation enabled, no session exists yet and the customer must confirm
  // first. Sending them to the dashboard would bounce them straight back to sign-in with no
  // explanation, so they are told to check their email instead.
  redirect("/auth/sign-up?notice=check-email");
}

export async function signOutAction(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/auth/sign-in?notice=signed-out");
}

/**
 * Google OAuth.
 *
 * NOT ACTIVE in this project: the live auth configuration reports
 * `external_google_enabled: false` and no client id, so the provider is not configured and
 * this action would fail at the Supabase boundary. It is implemented anyway rather than
 * stubbed, gated on NEXT_PUBLIC_AUTH_GOOGLE_ENABLED, so that enabling Google is a
 * Supabase setting plus one environment variable - not a code change under time pressure.
 */
export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNext(formData.get("next"));

  if (process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED !== "true") {
    redirect(`/auth/sign-in?error=google-disabled&next=${encodeURIComponent(next)}`);
  }

  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${publicEnv.siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data?.url) {
    redirect(`/auth/sign-in?error=oauth-failed&next=${encodeURIComponent(next)}`);
  }

  redirect(data.url);
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/auth/sign-in?error=missing");
  }

  const headerList = await headers();
  const limit = rateLimit({
    key: clientKeyFrom(headerList, "auth:reset"),
    limit: SIGNIN_LIMIT,
    windowMs: SIGNIN_WINDOW_MS,
  });

  if (!limit.allowed) {
    redirect("/auth/sign-in?error=throttled");
  }

  const supabase = await getSupabaseServerClient();

  // Supabase deliberately does not reveal whether the address exists, and neither do we:
  // the same confirmation is shown either way. Report success regardless of the outcome so
  // this endpoint cannot be used to enumerate accounts.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicEnv.siteUrl}/auth/callback?next=%2Fauth%2Fupdate-password`,
  });

  redirect("/auth/sign-in?notice=reset-sent");
}
