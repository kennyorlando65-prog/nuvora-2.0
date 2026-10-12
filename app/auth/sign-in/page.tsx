import type { Metadata } from "next";
import Link from "next/link";

import { PasswordField } from "@/components/auth/password-field";
import { signInAction, signInWithGoogleAction } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/env.public";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * Sign-in.
 *
 * ONE FORM FOR EVERYONE, and that is deliberate. Customers and operators authenticate
 * through the same Supabase Auth system, so there is one credential store, one session
 * mechanism and one place a password is checked. What differs is what happens next: the
 * default destination is the customer dashboard, and an operator who was heading for
 * /admin is carried there by the `next` parameter.
 *
 * The page does not say "operator access" any more, because it is no longer only for
 * operators - and it does not mention the admin area at all, because the admin console must
 * be invisible in the customer UI. An operator reaches it by knowing the address.
 *
 * Failure and notice codes are mapped to wording here rather than passed through from the
 * action, so nothing a user typed is ever echoed back into the page.
 */
const ERRORS: Record<string, string> = {
  missing: "Enter both your email address and your password.",
  invalid: "Those credentials were not accepted. Check them and try again.",
  throttled: "Too many attempts. Wait ten minutes before trying again.",
  "google-disabled": "Google sign-in is not enabled for this project yet.",
  "oauth-failed": "The provider did not complete the sign-in. Try again.",
  "not-authorised": "That account does not have access to the area you asked for.",
};

const NOTICES: Record<string, string> = {
  "signed-out": "You have been signed out.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Customers land on the dashboard; an operator following a link to /admin is carried
  // there by `next`. The default is the customer destination because that is who most
  // people signing in are.
  const next = typeof params.next === "string" ? params.next : "/dashboard";
  const errorCode = typeof params.error === "string" ? params.error : "";
  const noticeCode = typeof params.notice === "string" ? params.notice : "";

  const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true";
  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-16">
      <div className="flex flex-col gap-2">
        <Link href="/" className="nuvora-wordmark text-sm" aria-label="NUVORA home">
          NUVORA
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Sign in to your account
        </h1>
        <p className="text-sm text-muted">
          Use the email address and password you signed up with.
        </p>
      </div>

      {!configured && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Sign-in is not available yet because the site is not fully configured. Please try
          again later.
        </p>
      )}

      {errorCode && ERRORS[errorCode] && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {ERRORS[errorCode]}
        </p>
      )}

      {noticeCode && NOTICES[noticeCode] && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-3 text-sm text-muted"
        >
          {NOTICES[noticeCode]}
        </p>
      )}

      <form action={signInAction} className="nuvora-card flex flex-col gap-4 p-5">
        <input type="hidden" name="next" value={next} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="nuvora-label">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={errorCode === "invalid" || errorCode === "missing" || undefined}
            className={`nuvora-input ${
              errorCode === "invalid" || errorCode === "missing" ? "nuvora-input-invalid" : ""
            }`}
            placeholder="you@example.com"
          />
        </div>

        <PasswordField
          name="password"
          label="Password"
          autoComplete="current-password"
          minLength={8}
          invalid={errorCode === "invalid" || errorCode === "missing"}
        />

        <button
          type="submit"
          className="nuvora-btn nuvora-btn-primary mt-1 w-full"
          disabled={!configured}
        >
          Sign in
        </button>
      </form>

      {googleEnabled && (
        <form action={signInWithGoogleAction}>
          <input type="hidden" name="next" value={next} />
          <button type="submit" className="nuvora-btn nuvora-btn-secondary w-full">
            Continue with Google
          </button>
        </form>
      )}

      <p className="text-xs text-dim">
        No account yet?{" "}
        <Link href="/auth/sign-up" className="text-muted underline hover:text-ink">
          Create one
        </Link>
        .
      </p>

      <p className="text-xs text-dim">
        Forgotten your password?{" "}
        <Link href="/auth/forgot-password" className="text-muted underline hover:text-ink">
          Reset it here
        </Link>
        . Waiting on a confirmation email?{" "}
        <Link href="/auth/confirm-email" className="text-muted underline hover:text-ink">
          Send it again
        </Link>
        .
      </p>
    </div>
  );
}
