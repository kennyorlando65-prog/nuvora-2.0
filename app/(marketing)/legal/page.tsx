import type { Metadata } from "next";
import Link from "next/link";

import { LegalShell } from "@/components/legal/legal-ui";
import { legalDocuments } from "@/lib/site";

export const metadata: Metadata = {
  title: "Legal & policies",
  description:
    "Every NUVORA policy in one place: terms, privacy, cookies, refunds, acceptable use and AML/KYC - each a working draft pending legal review.",
};

export default function LegalIndexPage() {
  return (
    <LegalShell
      label="Legal"
      title="Legal & policies"
      summary="Every policy that governs the NUVORA platform. Each one is a working draft and each one carries its own review notice - none of them has been signed off by a lawyer yet."
      reviewNotice={false}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {legalDocuments
          .filter((document) => document.href !== "/legal")
          .map((document) => (
            <Link
              key={document.href}
              href={document.href}
              className="nuvora-card p-5 transition-colors hover:border-accent"
            >
              <p className="text-sm font-semibold text-ink">{document.label}</p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-widest text-accent">
                Draft - review required
              </p>
            </Link>
          ))}
      </div>

      <section className="nuvora-card border-accent/40 p-6">
        <h2 className="text-sm font-semibold text-ink">How to read these documents</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Treat everything in this section as drafting material, not as binding terms. It is
          written to describe what NUVORA actually does - no wallet, no stored balance, no
          identity documents, per-order payments - so that a Nigerian lawyer (and an EU or UK
          adviser for GDPR) has an accurate description to review rather than a generic
          template to correct.
        </p>
      </section>
    </LegalShell>
  );
}
