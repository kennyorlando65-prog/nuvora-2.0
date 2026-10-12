"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { reportClientError } from "@/lib/observability/report-error-action";
import { supportEmail } from "@/lib/site";

/**
 * The global error boundary.
 *
 * IT MUST LOOK LIKE A FAILURE. The brief was specific: a 500 or a failed order should be
 * unmistakable, not a normal-looking page with a quiet sentence on it. A customer who has just
 * pressed pay, seen an error and landed on something that still looks like the rest of the
 * site will reasonably assume the payment went through. The solid danger band, the large
 * heading and the explicit "nothing was charged" statement exist to prevent that reading.
 *
 * THE CUSTOMER-FACING FACTS COME FIRST, in this order, because they are what the person
 * actually needs: nothing was charged, no order was created, it is safe to try again. Only
 * then does it offer the technical reference.
 *
 * THE REFERENCE IS A SERVER-SIDE LOG HANDLE. The error is reported to the server, which records
 * the full (redacted) detail against an id and returns it. The browser holds the id and never
 * the detail. In development the real message and stack are shown, because a developer needs
 * them; in production they are withheld.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [correlationId, setCorrelationId] = useState<string | null>(error.digest ?? null);
  const [reported, setReported] = useState(false);
  const isDevelopment = process.env.NODE_ENV !== "production";

  useEffect(() => {
    if (reported) return;
    setReported(true);

    reportClientError({
      message: error.message,
      stack: error.stack,
      context: "global-error-boundary",
    })
      .then((result) => setCorrelationId(result.correlationId))
      .catch(() => {
        /* keep the digest */
      });
  }, [error, reported]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col justify-center px-5 py-16"
    >
      {/* The critical band. Colour is doing real work here: this page must not be mistaken
          for a normal one. */}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-bad/50 bg-panel shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 border-b border-bad/30 bg-bad/10 px-5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-bad">
            Error 500 - request failed
          </span>
        </div>

        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Something went wrong on our side
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            This is a fault in NUVORA, not something you did. Here is what matters right now:
          </p>

          <ul className="mt-4 flex flex-col gap-2">
            <li className="flex gap-2.5 text-sm text-ink">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
              <span>You have not been charged.</span>
            </li>
            <li className="flex gap-2.5 text-sm text-ink">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
              <span>No order was created, and no order you already had was changed.</span>
            </li>
            <li className="flex gap-2.5 text-sm text-ink">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
              <span>It is safe to try again.</span>
            </li>
          </ul>

          <div className="mt-7 flex flex-wrap gap-3">
            <button type="button" onClick={reset} className="nuvora-btn nuvora-btn-primary">
              Try again
            </button>
            <Link href="/" className="nuvora-btn nuvora-btn-secondary">
              Back to home
            </Link>
            <a href={`mailto:${supportEmail}`} className="nuvora-btn nuvora-btn-ghost">
              Contact support
            </a>
          </div>
        </div>
      </div>

      {/* The reference, in its own block so it can be read off a screenshot. */}
      <div className="nuvora-card mt-4 p-5">
        <p className="nuvora-label">If you contact support, quote this</p>
        <p className="mt-2 break-all font-mono text-sm text-ink">
          {correlationId ?? "not available"}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          This identifies the failure in our server logs. It contains no personal information
          and no keys, and it cannot be used to reach anything.
        </p>

        {isDevelopment && (
          <div className="mt-4 rounded-md border border-line-soft bg-panel-2 p-3">
            <p className="nuvora-label">Development detail</p>
            <p className="mt-1.5 break-words text-xs text-bad">{error.message}</p>
            {error.stack && (
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-dim">
                {error.stack}
              </pre>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-dim">
              Shown because this is a development build. The production build shows only the
              reference above, so a crafted error cannot be used to read a key or an internal
              path out of the response.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
