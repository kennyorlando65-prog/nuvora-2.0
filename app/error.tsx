"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side error reporting arrives with the Communications module.
    // Until then, log the digest so it can be matched to a server log entry.
    console.error("[nuvora] unhandled route error", error.digest ?? error.message);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start px-5 py-24">
      <p className="nuvora-label">Error 500</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Something went wrong</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        This page failed to render. Any payment you were making was not completed, and no
        order was created. You can retry safely.
      </p>
      {error.digest ? (
        <p className="mt-4 font-mono text-xs text-dim">Reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-8 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg transition-colors hover:brightness-110"
      >
        Try again
      </button>
    </section>
  );
}
