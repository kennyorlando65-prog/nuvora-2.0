import Link from "next/link";

import { ORDER_STATUS_LABELS, FULFILMENT_LABELS } from "@/lib/admin/format";
import type { OrderFilters } from "@/lib/admin/orders";

/**
 * Order filters as a plain GET form.
 *
 * NO CLIENT JAVASCRIPT, DELIBERATELY. A `<form method="get">` submits the fields as a query
 * string, which means: the filter state lives in the URL and can be bookmarked, shared or
 * reloaded; the back button works; and the page functions with JavaScript disabled. A
 * client component managing filter state in React would be more code and would lose all
 * three properties.
 *
 * It also means the operator can paste a filtered URL into a support thread and the person
 * reading it sees the same rows.
 */

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABELS);
const FULFILMENT_OPTIONS = Object.entries(FULFILMENT_LABELS);
const PROVIDER_OPTIONS: Array<[string, string]> = [
  ["paystack", "Paystack"],
  ["flutterwave", "Flutterwave"],
];

const FIELD =
  "rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";

export function OrderFilters({ filters }: { filters: OrderFilters }) {
  return (
    <form method="get" action="/admin/orders" className="nuvora-card flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Order number or email"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Order status</span>
          <select name="status" defaultValue={filters.status} className={FIELD}>
            <option value="">Any status</option>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Fulfilment</span>
          <select name="fulfilment" defaultValue={filters.fulfilment} className={FIELD}>
            <option value="">Any fulfilment state</option>
            {FULFILMENT_OPTIONS.map(([value, label]) => (
              <option key={value} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Gateway</span>
          <select name="provider" defaultValue={filters.provider} className={FIELD}>
            <option value="">Any gateway</option>
            {PROVIDER_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Created from</span>
          <input type="date" name="from" defaultValue={filters.from} className={FIELD} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="nuvora-label">Created to</span>
          <input type="date" name="to" defaultValue={filters.to} className={FIELD} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
        >
          Apply filters
        </button>
        <Link
          href="/admin/orders"
          className="rounded-md border border-line bg-panel px-4 py-2 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
        >
          Clear
        </Link>
        <span className="text-xs text-dim">
          Dates are inclusive. Search accepts an order number or part of an email address.
        </span>
      </div>
    </form>
  );
}
