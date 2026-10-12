import type { Metadata } from "next";
import Link from "next/link";

import { PasswordField } from "@/components/auth/password-field";
import { updatePasswordAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/guard";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

/**
 * Choose a new password - the destination the reset email points at.
 *
 * THIS ROUTE DID NOT EXIST. requestPasswordResetAction sent a reset email whose link
 * resolved, through /auth/callback, to /auth/update-password - and that path 404'd. So the
 * reset flow handed the customer a valid session and then dropped them on a Not Found page
 * with no way to set a password. The link was not broken at the email end; it was broken
 * because the page it promised had never been written.
 *
 * NO REDIRECT WHEN THERE IS NO SESSION, and that is deliberate. Every other page in the auth
 * area pushes an anonymous visitor at the sign-in form, but that would be wrong here: the
 * reason someone lands here without a session is that their reset link expired, was already
 * used, or was opened in a different browser from the one that requested it - and bouncing
 * them to a sign-in form asking for the password they have forgotten is a loop they cannot
 * escape. They get the state explained and a link that issues a fresh one instead.
 */
const ERRORS: Record<string, string> = {
  "weak-password": "That password is too short. Use at least 8 characters.",
  mismatch: "The two passwords did not match. Type them again.",
  "no-session": "That reset link has expired or was already used. Request a new one.",
  "same-password": "That is the password you already had. Choose a different one.",
  "update-failed":
    "The password could not be changed. Request a new reset link and try again.",
  throttled: "Too many attempts. Wait ten minutes before trying again.",
};

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorCode = typeof params.error === "string" ? params.error : "";
  const noticeCode = typeof params.notice === "string" ? params.notice : "";

  // A valid arrival has a session: the emailed link carries a code, /auth/callback exchanges
  // it for one server-side, and the cookie is already set by the time this page renders.
  const { user } = await getSessionUser();

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-5 py-16">
      <div className="flex flex-col gap-2">
        <Link href="/" className="nuvora-wordmark text-sm" aria-label="NUVORA home">
          NUVORA
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          Set a new password
        </h1>
      </div>
      {children}
    </div>
  );

  if (!user) {
    return shell(
      <>
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {errorCode && ERRORS[errorCode]
            ? ERRORS[errorCode]
            : "This page needs a valid reset link. The one you followed has expired or was already used."}
        </p>

        <p className="text-sm leading-relaxed text-muted">
          Reset links can only be used once, and they expire. Requesting a new one takes a
          moment and does not change your password.
        </p>

        <Link href="/auth/forgot-password" className="nuvora-btn nuvora-btn-primary w-full">
          Request a new reset link
        </Link>

        <p className="text-xs text-dim">
          <Link href="/auth/sign-in" className="text-muted underline hover:text-ink">
            Back to sign in
          </Link>
        </p>
      </>,
    );
  }

  if (noticeCode === "updated") {
    return shell(
      <>
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Your password has been changed. You are signed in on this device.
        </p>

        <p className="text-sm leading-relaxed text-muted">
          Anywhere else you are signed in - another browser, another phone - still holds a
          session under the old password until it expires or you sign out there. Your new
          password is the one that works from now on.
        </p>

        <Link href="/dashboard" className="nuvora-btn nuvora-btn-primary w-full">
          Continue to your dashboard
        </Link>
      </>,
    );
  }

  return shell(
    <>
      <p className="text-sm text-muted">
        Signed in as <span className="text-ink">{user.email ?? "your account"}</span>. Choose
        a new password.
      </p>

      {errorCode && ERRORS[errorCode] && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {ERRORS[errorCode]}
        </p>
      )}

      <form action={updatePasswordAction} className="nuvora-card flex flex-col gap-4 p-5">
        <PasswordField
          name="password"
          label="New password"
          autoComplete="new-password"
          minLength={8}
          invalid={errorCode === "weak-password" || errorCode === "missing"}
          hint="At least 8 characters."
        />

        <PasswordField
          name="confirm_password"
          label="Type it again"
          autoComplete="new-password"
          minLength={8}
          invalid={errorCode === "mismatch"}
          hint="Both boxes must match exactly."
        />

        <button type="submit" className="nuvora-btn nuvora-btn-primary mt-1 w-full">
          Change my password
        </button>
      </form>

      <p className="text-xs leading-relaxed text-dim">
        If you did not ask for this, someone may have opened the reset link sent to your email.
        Changing the password here locks them out - the new one is what works.
      </p>
    </>,
  );
}
