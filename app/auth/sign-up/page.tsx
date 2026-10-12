import type { Metadata } from "next";
import Link from "next/link";

import { PasswordField } from "@/components/auth/password-field";
import { signUpAction } from "@/lib/auth/actions";
import { isSupabaseConfigured } from "@/lib/env.public";

export const metadata: Metadata = {
  title: "Create your account",
  robots: { index: false, follow: false },
};

/**
 * Customer sign-up.
 *
 * Uses Supabase Auth, the same system the admin area uses, so `auth.uid()` and every RLS
 * policy work as designed. A separate customer auth system would produce sessions the
 * database cannot see, and the order policies would then deny the very customers they
 * exist to admit.
 *
 * Failure codes are mapped to wording here rather than passed through from the action, so
 * nothing a user typed is ever echoed back into the page.
 */
const ERRORS: Record<string, string> = {
  missing: "Enter your email address and a password of at least 8 characters.",
  "weak-password": "That password is too short. Use at least 8 characters.",
  "already-registered":
    "An account already exists for that address. Sign in instead, or reset the password.",
  throttled: "Too many attempts. Wait ten minutes before trying again.",
  "signup-failed": "The account could not be created. Try again in a moment.",
};

export default async function SignUpPage({
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
        <span className="nuvora-label">Create account</span>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Create your NUVORA account
        </h1>
        <p className="text-sm text-muted">
          An email address and a password is all we ask for. No documents, no selfie, no
          waiting for approval.
        </p>
      </div>

      {!configured && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Sign-up is not available yet because the site is not fully configured. Please try
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

      {noticeCode === "check-email" && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          Your account has been created. Check your email for a confirmation link, then sign
          in. Nothing arrives in a few minutes?{" "}
          <Link href="/auth/confirm-email" className="underline hover:text-accent">
            Send the link again
          </Link>
          .
        </p>
      )}

      <form action={signUpAction} className="nuvora-card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="full_name" className="nuvora-label">
            Your name
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            required
            maxLength={120}
            aria-invalid={errorCode === "missing" || undefined}
            className={`nuvora-input ${errorCode === "missing" ? "nuvora-input-invalid" : ""}`}
            placeholder="Ada Obi"
          />
        </div>

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
            aria-invalid={errorCode === "already-registered" || undefined}
            className={`nuvora-input ${
              errorCode === "already-registered" ? "nuvora-input-invalid" : ""
            }`}
            placeholder="you@example.com"
          />
          <p className="text-[11px] text-dim">
            Your codes and receipts are delivered here, so use an address you can reach.
          </p>
        </div>

        <PasswordField
          name="password"
          label="Password"
          autoComplete="new-password"
          minLength={8}
          invalid={errorCode === "weak-password" || errorCode === "missing"}
          hint="At least 8 characters."
        />

        <button
          type="submit"
          disabled={!configured}
          className="nuvora-btn nuvora-btn-primary mt-1 w-full"
        >
          Create account
        </button>
      </form>

      <p className="text-xs leading-relaxed text-dim">
        By creating an account you agree to the{" "}
        <Link href="/legal/terms" className="text-muted underline hover:text-accent">
          Terms &amp; Conditions
        </Link>{" "}
        and the{" "}
        <Link href="/legal/privacy" className="text-muted underline hover:text-accent">
          Privacy Policy
        </Link>
        . Both are working drafts pending legal review.
      </p>

      <p className="text-xs text-dim">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="text-muted underline hover:text-ink">
          Sign in
        </Link>
      </p>
    </div>
  );
}
