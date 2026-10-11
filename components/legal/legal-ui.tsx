import type { ReactNode } from "react";

import { LEGAL_REVIEW_NOTICE, policyUpdated } from "@/lib/site";

/**
 * Shared building blocks for the legal documents.
 *
 * These keep every policy on the same typography and the same honest status notice, so a
 * reader can tell instantly that a document is a draft rather than a finished policy.
 */

export function DraftNotice() {
  return (
    <aside role="note" className="mt-6 rounded-lg border border-accent/40 bg-panel-2 p-4">
      <p className="font-mono text-[11px] uppercase tracking-widest text-accent">
        Draft - requires legal review
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">{LEGAL_REVIEW_NOTICE}</p>
    </aside>
  );
}

export function LegalShell({
  label,
  title,
  summary,
  children,
  reviewNotice = true,
}: {
  label: string;
  title: string;
  summary?: string;
  children: ReactNode;
  reviewNotice?: boolean;
}) {
  return (
    <article className="max-w-3xl">
      <p className="nuvora-label">{label}</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{title}</h1>
      {summary ? (
        <p className="mt-4 text-base leading-relaxed text-muted">{summary}</p>
      ) : null}
      <p className="mt-3 font-mono text-xs text-dim">Last updated {policyUpdated}</p>
      {reviewNotice ? <DraftNotice /> : null}
      <div className="mt-10 flex flex-col gap-9">{children}</div>
    </article>
  );
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted">
        {children}
      </div>
    </section>
  );
}

export function LegalList({ items }: { items: readonly string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
