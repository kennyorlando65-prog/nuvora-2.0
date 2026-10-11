import Link from "next/link";
import type { ReactNode } from "react";

import { legalDocuments } from "@/lib/site";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[240px_1fr] lg:gap-14">
      <nav aria-label="Legal and policies" className="lg:sticky lg:top-20 lg:self-start">
        <p className="nuvora-label">Legal &amp; policies</p>
        <ul className="mt-3 flex flex-col gap-1">
          {legalDocuments.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-ink"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 border-t border-line-soft pt-4 text-xs leading-relaxed text-dim">
          Every document in this section is a working draft pending review by a qualified
          Nigerian lawyer, with an EU or UK adviser for GDPR.
        </p>
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
