import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-2xl flex-col items-start px-5 py-24">
      <p className="nuvora-label">Error 404</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
        This page does not exist
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The link may be old or mistyped. Nothing was charged and no order was affected.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg transition-colors hover:brightness-110"
        >
          Back to the store
        </Link>
        <a
          href="mailto:support@example.com"
          className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Contact support
        </a>
      </div>
    </section>
  );
}
