import Link from "next/link";

import { TONE_CLASS, type Tone } from "@/lib/admin/format";

/**
 * Shared admin presentation primitives.
 *
 * Server-rendered throughout - none of these needs state, so none of them pulls a client
 * bundle into an admin page. That matters more here than on the storefront: every byte of
 * client JavaScript on an admin route is a place order data, supplier cost or margin could
 * leak into a bundle the browser holds.
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
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Badge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONE_CLASS[tone]}`}
    >
      {label}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="nuvora-card flex flex-col gap-1.5 p-4">
      <span className="nuvora-label">{label}</span>
      <span
        className={`text-2xl font-semibold tracking-tight ${
          tone === "bad"
            ? "text-bad"
            : tone === "warn"
              ? "text-accent"
              : tone === "ok"
                ? "text-ok"
                : "text-ink"
        }`}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </div>
  );
}

/**
 * Empty state that says WHY it is empty.
 *
 * "No orders yet" and "No orders matched this filter" are different facts, and an operator
 * who cannot tell them apart will assume the admin area is broken. The caller passes the
 * wording, because only the caller knows which of the two it is.
 */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="nuvora-card flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-md text-xs text-dim">{hint}</p>}
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
            {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
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
        ? "border-accent/40"
        : tone === "ok"
          ? "border-ok/40"
          : "border-line";

  return (
    <p role="status" className={`rounded-[var(--radius-card)] border ${border} bg-panel px-4 py-3 text-sm text-muted`}>
      {children}
    </p>
  );
}

/** A horizontal scroll container: admin tables must not break the page on a phone. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[42rem] border-collapse text-sm">{children}</table>
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
