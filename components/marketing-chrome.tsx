import Link from "next/link";

import { supportEmail } from "@/lib/site";

/**
 * The public front door's chrome: header and footer.
 *
 * WHAT IS DELIBERATELY NOT HERE: a "Store" link and a "Browse the store" button. The
 * catalogue is empty until the operator adds real products, and a shop with nothing in it
 * reads as a broken site. The public side therefore explains and invites sign-up; the
 * store lives behind the sign-in, where an empty catalogue is an honest empty state
 * rather than a broken shopfront.
 *
 * The wordmark is the plain word NUVORA. There is no logo file and none is invented.
 */
export function MarketingSiteHeader() {
  const nav = [
    { href: "/#what", label: "What we sell" },
    { href: "/#how", label: "How it works" },
    { href: "/#trust", label: "How we operate" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Support" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" className="flex items-baseline gap-2" aria-label="NUVORA home">
          <span className="nuvora-wordmark text-base">NUVORA</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-2 text-sm text-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/auth/sign-in" className="nuvora-btn nuvora-btn-ghost px-3 py-2">
            Log in
          </Link>
          <Link href="/auth/sign-up" className="nuvora-btn nuvora-btn-primary px-4 py-2">
            Create account
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * The public footer.
 *
 * Carries the legal review notice, because the honest status of those documents is
 * something a visitor should be able to see without opening one.
 */
export function MarketingSiteFooter() {
  return (
    <footer className="border-t border-line bg-panel-2">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <p className="nuvora-wordmark text-sm">NUVORA</p>
            <p className="mt-3 text-xs leading-relaxed text-muted">
              A white-label digital services platform. Orders are paid for individually at
              checkout - NUVORA holds no balances and collects no identity documents.
            </p>
            <p className="mt-3 text-xs text-dim">
              Support:{" "}
              <a
                href={`mailto:${supportEmail}`}
                className="text-muted underline underline-offset-2 hover:text-accent"
              >
                {supportEmail}
              </a>
            </p>
          </div>

          <nav aria-label="Company" className="grid gap-2 text-xs">
            <p className="nuvora-label">Company</p>
            {[
              { href: "/about", label: "About" },
              { href: "/contact", label: "Contact & support" },
              { href: "/status", label: "Status" },
            ].map((page) => (
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
            {[
              { href: "/legal/terms", label: "Terms & Conditions" },
              { href: "/legal/privacy", label: "Privacy Policy" },
              { href: "/legal/cookies", label: "Cookie Policy" },
              { href: "/legal/refunds", label: "Refund & Cancellation" },
              { href: "/legal/acceptable-use", label: "Acceptable Use" },
              { href: "/legal/aml-kyc", label: "AML / KYC" },
            ].map((document) => (
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
