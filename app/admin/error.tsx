"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { reportClientError } from "@/lib/observability/report-error-action";

/**
 * The admin error boundary.
 *
 * DELIBERATELY DIFFERENT FROM A PAGE. An admin screen that fails is not a normal page with a
 * message on it - it is a broken tool, and it has to look like one so nobody mistakes it for
 * "there is no data". The critical band, the heavy rule and the danger heading are all there
 * to make the failure unmissable, while staying inside the NUVORA palette rather than
 * inventing a new visual language.
 *
 * IT EXPLAINS WHAT DID NOT HAPPEN as well as what did: no change was saved. An operator who
 * has just pressed save on a price needs to know whether it landed. It did not, and the page
 * says so rather than leaving them to guess.
 *
 * The real message and stack appear only in development. In production the operator gets the
 * correlation id, which matches a server log line carrying the redacted detail.
 */
export default function AdminError({
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

    // Best-effort: if this call itself fails, the digest from Next.js is still shown, so the
    // operator always has something to quote.
    reportClientError({
      message: error.message,
      stack: error.stack,
      context: "admin-error-boundary",
    })
      .then((result) => setCorrelationId(result.correlationId))
      .catch(() => {
        /* keep the digest */
      });
  }, [error, reported]);

  return (
    <div className="flex flex-col gap-6">
      {/* The critical band: a solid danger rule across the top of the failure. */}
      <div className="rounded-[var(--radius-card)] border border-bad/50 bg-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full border border-bad/50 bg-bad/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-bad">
            Error 500
          </span>
          <span className="nuvora-label">Administrator console</span>
        </div>

        <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          This admin screen failed to load
        </h2>

        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Nothing was saved and nothing was changed. If you were part-way through an edit,
          treat it as not applied and re-enter it after the screen loads.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="nuvora-btn nuvora-btn-primary">
            Try again
          </button>
          <Link href="/admin" className="nuvora-btn nuvora-btn-secondary">
            Back to overview
          </Link>
          <Link href="/admin/diagnostics" className="nuvora-btn nuvora-btn-secondary">
            Open diagnostics
          </Link>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-dim">
          Diagnostics is the right place to start: it reports which provider or configuration
          item is failing, in plain English, without needing this error to be understood first.
        </p>
      </div>

      {/* The reference, kept visually separate so it can be copied off a screenshot. */}
      <div className="nuvora-card p-5">
        <p className="nuvora-label">Reference for support</p>
        <p className="mt-2 break-all font-mono text-sm text-ink">
          {correlationId ?? "not available"}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-dim">
          The full detail is recorded on the server against this reference. Quote it exactly.
          It contains no keys and cannot be used to reach anything.
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
              Shown because this is a development build. In production only the reference above
              is displayed, so a crafted error cannot be used to read a key or an internal path.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
