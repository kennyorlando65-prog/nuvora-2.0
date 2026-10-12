import type { Metadata } from "next";
import Link from "next/link";

import { resendConfirmationAction } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/env.public";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

/**
 * The confirmation state, as a real page rather than a fleeting notice.
 *
 * WHY THIS IS A ROUTE. After signing up, the customer used to see an inline "check your
 * email" message on the sign-up form itself, and that was the only place it appeared. A
 * customer who closed the tab - or who never received the email because it went to spam, or
 * because the project's mailer ceiling was reached - had no way back to that message and no
 * way to ask for another link. Their account existed and was permanently unusable, with no
 * route in the product that acknowledged the situation.
 *
 * Confirmation is required for this project (Supabase reports mailer_autoconfirm: false), so
 * an unconfirmed account cannot sign in at all. That makes this page the single most
 * important dead end to have a way out of.
 *
 * NO ADDRESS IS CARRIED IN THE URL. The obvious design would redirect here with
 * ?email=... after sign-up, which would put a customer's email address into the browser
 * history, into the referrer of any outbound link on the page, and into any access log that
 * records query strings. Instead the address is asked for again - which is also the honest
 * requirement, because the point of the page is to send mail to an address the person can
 * actually reach.
 */
const ERRORS: Record<string, string> = {
  missing: "Enter the email address you signed up with.",
  throttled: "Too many requests. Wait ten minutes before trying again.",
};

export default async function ConfirmEmailPage({
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
          Confirm your email address
        </h1>
        <p className="text-sm text-muted">
          Your account is created, and one click on the link we sent finishes it.
        </p>
      </div>

      <p className="rounded-[var(--radius-card)] border border-line bg-panel px-4 py-3 text-sm leading-relaxed text-muted">
        We confirm the address because it is where your order codes and receipts are
        delivered. An address we have not confirmed is one we cannot reliably reach you on,
        and for a paid order that is the wrong place to be uncertain.
      </p>

      {errorCode && ERRORS[errorCode] && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {ERRORS[errorCode]}
        </p>
      )}

      {noticeCode === "sent" && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          If that address is waiting to be confirmed, a new link is on its way. It can only be
          used once. If it does not arrive within a few minutes, check the spam folder before
          asking again - each request sends a real email and there is a limit on how many can
          go out in an hour.
        </p>
      )}

      <form
        action={resendConfirmationAction}
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
          Send the confirmation link again
        </button>
      </form>

      <p className="text-xs text-dim">
        Already confirmed?{" "}
        <Link href="/auth/sign-in" className="text-muted underline hover:text-ink">
          Sign in
        </Link>
        . Wrong address on the account?{" "}
        <Link href="/contact" className="text-muted underline hover:text-ink">
          Contact support
        </Link>
        .
      </p>
    </div>
  );
}
