export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-panel-2">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <p className="text-sm font-semibold text-ink">NUVORA</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              A white-label digital services platform. Orders are paid for individually at
              checkout - NUVORA holds no balances and collects no identity documents.
            </p>
          </div>

          <nav aria-label="Legal" className="grid gap-2 text-xs">
            {[
              "Terms & Conditions",
              "Privacy Policy",
              "Refund & Cancellation",
              "Acceptable Use",
              "Cookie Policy",
            ].map((label) => (
              <span key={label} className="text-muted">
                {label}
                <span className="ml-2 font-mono text-[10px] text-dim">pending</span>
              </span>
            ))}
          </nav>
        </div>

        <p className="mt-8 border-t border-line-soft pt-5 font-mono text-[11px] text-dim">
          Legal pages are placeholders. Every policy must be reviewed by a qualified
          Nigerian lawyer, with an EU/UK adviser for GDPR, before launch.
        </p>
      </div>
    </footer>
  );
}
