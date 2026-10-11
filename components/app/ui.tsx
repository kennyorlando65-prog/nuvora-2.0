import Link from "next/link";

import { TONE_CLASS, type Tone } from "@/lib/admin/format";

/**
 * Shared presentation primitives for the signed-in app.
 *
 * Server-rendered throughout - none of these needs state, so none of them pulls a client
 * bundle into a customer page.
 *
 * The tone classes come from lib/admin/format.ts, which is the one place a status is
 * mapped to a colour. Sharing it is deliberate: an order that reads "Paid" in green on the
 * customer's page and "Paid" in amber on the operator's page is how two people end up
 * disagreeing about what an order's state means.
 */

export function PageHeader({
  label,
  title,
  description,
  actions,
}: {
  label: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="nuvora-label">{label}</span>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return <span className={`nuvora-pill ${TONE_CLASS[tone]}`}>{label}</span>;
}

/**
 * A stat card with a coloured icon block, as in the reference layout.
 *
 * The icon is a small geometric mark drawn in CSS rather than an emoji or an icon font:
 * the brief forbids emojis, and an icon dependency for four shapes would be a poor trade.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
}) {
  const iconBg =
    tone === "ok"
      ? "bg-ok/15 text-ok"
      : tone === "bad"
        ? "bg-bad/15 text-bad"
        : tone === "warn"
          ? "bg-warn/15 text-warn"
          : tone === "info"
            ? "bg-info/15 text-info"
            : "bg-accent-soft text-accent";

  return (
    <div className="nuvora-card flex items-start gap-3 p-4">
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${iconBg}`}
      >
        <span className="block h-2.5 w-2.5 rounded-[3px] bg-current" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="nuvora-label">{label}</span>
        <span className="text-xl font-semibold tracking-tight text-ink">{value}</span>
        {hint && <span className="text-xs text-dim">{hint}</span>}
      </div>
    </div>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="nuvora-card flex flex-col gap-4 p-5">
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Empty state that says WHY it is empty.
 *
 * "You have not ordered yet" and "nothing matched your search" are different facts, and a
 * customer who cannot tell them apart will assume the store is broken. The caller passes
 * the wording, because only the caller knows which of the two it is.
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="nuvora-card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-md text-xs leading-relaxed text-dim">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: React.ReactNode;
}) {
  const border =
    tone === "bad"
      ? "border-bad/40"
      : tone === "warn"
        ? "border-warn/40"
        : tone === "ok"
          ? "border-ok/40"
          : "border-line";

  return (
    <p
      role="status"
      className={`rounded-[var(--radius-card)] border ${border} bg-panel px-4 py-3 text-sm text-muted`}
    >
      {children}
    </p>
  );
}

/** A horizontal scroll container: tables must not break the page on a phone. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[36rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`border-b border-line pb-2 pt-1 font-mono text-[10px] uppercase tracking-wider text-dim ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  mono,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`border-b border-line-soft py-2.5 pr-3 align-top text-ink ${
        align === "right" ? "text-right" : "text-left"
      } ${mono ? "font-mono text-xs" : ""}`}
    >
      {children}
    </td>
  );
}

export function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-muted underline underline-offset-2 hover:text-accent">
      {children}
    </Link>
  );
}
