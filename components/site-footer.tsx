import Link from "next/link";

import { legalDocuments, sitePages } from "@/lib/site";

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

          <nav aria-label="Site" className="grid gap-2 text-xs">
            <p className="nuvora-label">Company</p>
            {sitePages.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                className="text-muted transition-colors hover:text-accent"
              >
                {page.label}
              </Link>
            ))}
          </nav>

          <nav aria-label="Legal" className="grid gap-2 text-xs">
            <p className="nuvora-label">Legal</p>
            {legalDocuments
              .filter((document) => document.href !== "/legal")
              .map((document) => (
                <Link
                  key={document.href}
                  href={document.href}
                  className="text-muted transition-colors hover:text-accent"
                >
                  {document.label}
                </Link>
              ))}
          </nav>
        </div>

        <p className="mt-8 border-t border-line-soft pt-5 text-xs leading-relaxed text-dim">
          Every legal document on this site is a working draft. Each must be reviewed by a
          qualified Nigerian lawyer, and by an EU or UK adviser for GDPR, before launch. It
          is not legal advice and it is not final.
        </p>
      </div>
    </footer>
  );
}
