import Link from "next/link";

import { SignalMotif } from "@/components/brand/signal-motif";
import { Wordmark } from "@/components/brand/wordmark";
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
 * THE HEADER IS BUILT TO CARRY THE BRAND. The complaint was that the logo presence was weak
 * next to the rest of the layout. So the mark is now large, has the accent hairline under it,
 * and sits in a taller header band - the word is the loudest thing in the bar rather than
 * something squeezed in at the left. The mark links home, which is the one navigation
 * behaviour a header wordmark is expected to have.
 *
 * The mark itself is the plain word NUVORA in clean type. There is no logo file and none is
 * invented; see components/brand/wordmark.tsx.
 */
export function MarketingSiteHeader() {
  const nav = [
    { href: "/#what", label: "What we sell" },
    { href: "/#why", label: "Why NUVORA" },
    { href: "/#how", label: "How it works" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Support" },
  ];

  return (
    <header className="nuvora-surface-marketing sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      {/* The signal rule runs along the very top of the header: the motif's first appearance,
          where it is always visible and never in the way of content. */}
      <div className="overflow-hidden border-b border-line-soft">
        <SignalMotif variant="rule" />
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
        <Wordmark
          href="/"
          label="NUVORA home"
          size="md"
          rule
          className="shrink-0 py-0.5"
        />

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
 *
 * It also repeats the motif at the foot of the page, which closes the brand's frame: the
 * signal appears at the top and bottom of every public page, so a visitor always knows they
 * are inside NUVORA even when they have scrolled a long way past the header.
 */
export function MarketingSiteFooter() {
  return (
    <footer className="nuvora-surface-marketing border-t border-line">
      <div className="overflow-hidden border-b border-line-soft">
        <SignalMotif variant="rule" />
      </div>

      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-sm">
            <Wordmark size="sm" rule />
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
