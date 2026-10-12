import type { Metadata } from "next";
import Link from "next/link";

import { requestPasswordResetAction } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/env.public";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

/**
 * Ask for a password-reset link.
 *
 * WHY THIS PAGE EXISTS AT ALL. Before this, the sign-in page told the user to "use the
 * recovery flow from your account page" - and there is no customer account page in this app,
 * so the advice pointed at something that did not exist. The action that sends the reset
 * email existed too, but nothing imported it: it was unreachable dead code. A customer who
 * forgot their password had no route back into their own account.
 *
 * The confirmation shown is deliberately the same whether or not the address has an account,
 * which is why the outcome is never read here - see the note in requestPasswordResetAction.
 * Displaying "we could not find that address" would turn this page into a way to test which
 * email addresses are NUVORA customers.
 */
const ERRORS: Record<string, string> = {
  missing: "Enter the email address you signed up with.",
  throttled: "Too many requests. Wait ten minutes before trying again.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const noticeCode = typeof params.notice === "string" ? params.notice : "";
  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-16">
      <div className="flex flex-col gap-2">
        <Link href="/" className="nuvora-wordmark text-sm" aria-label="NUVORA home">
          NUVORA
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Reset your password
        </h1>
        <p className="text-sm text-muted">
          Enter your email address and we will send a link to set a new password.
        </p>
      </div>

      {!configured && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Password reset is not available yet because the site is not fully configured.
          Please try again later.
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

      {noticeCode === "reset-sent" && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          If that address has a NUVORA account, a reset link is on its way. The link can only
          be used once and it expires, so if it does not arrive, request another.
        </p>
      )}

      <form
        action={requestPasswordResetAction}
        className="nuvora-card flex flex-col gap-4 p-5"
      >
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
            aria-invalid={errorCode === "missing" || undefined}
            className={`nuvora-input ${errorCode === "missing" ? "nuvora-input-invalid" : ""}`}
            placeholder="you@example.com"
          />
        </div>

        <button
          type="submit"
          disabled={!configured}
          className="nuvora-btn nuvora-btn-primary mt-1 w-full"
        >
          Send the reset link
        </button>
      </form>

      <p className="text-xs text-dim">
        Remembered it?{" "}
        <Link href="/auth/sign-in" className="text-muted underline hover:text-ink">
          Back to sign in
        </Link>
        . No account yet?{" "}
        <Link href="/auth/sign-up" className="text-muted underline hover:text-ink">
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
