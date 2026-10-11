import type { Metadata } from "next";
import Link from "next/link";

import { signInAction, signInWithGoogleAction } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/env.public";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * Operator sign-in.
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
  "not-authorised": "That account does not have access to the admin area.",
};

const NOTICES: Record<string, string> = {
  "signed-out": "You have been signed out.",
  "reset-sent": "If that address has an account, a reset link is on its way.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/admin";
  const errorCode = typeof params.error === "string" ? params.error : "";
  const noticeCode = typeof params.notice === "string" ? params.notice : "";

  const googleEnabled = process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true";
  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-16">
      <div className="flex flex-col gap-2">
        <span className="nuvora-label">Operator access</span>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in to NUVORA</h1>
        <p className="text-sm text-muted">
          This area is restricted to NUVORA operators. Customer accounts sign in from the
          storefront.
        </p>
      </div>

      {!configured && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Supabase is not configured, so sign-in cannot work. Set
          <code className="mx-1 font-mono text-xs text-accent">NEXT_PUBLIC_SUPABASE_URL</code>
          and
          <code className="mx-1 font-mono text-xs text-accent">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          in Vercel, then redeploy.
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
            className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-dim focus:border-accent focus:outline-none"
            placeholder="operator@nuvora.example"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="nuvora-label">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="mt-1 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={!configured}
        >
          Sign in
        </button>
      </form>

      {googleEnabled && (
        <form action={signInWithGoogleAction}>
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="w-full rounded-md border border-line bg-panel px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-accent"
          >
            Continue with Google
          </button>
        </form>
      )}

      <p className="text-xs text-dim">
        Forgotten your password? Ask another operator to issue a reset link, or use the
        recovery flow from your account page.{" "}
        <Link href="/" className="text-muted underline hover:text-ink">
          Back to the store
        </Link>
      </p>
    </div>
  );
}
