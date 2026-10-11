/**
 * Presentation helpers for the admin surface.
 *
 * Deliberately one place, so the same status cannot be rendered as "Paid" on one page and
 * "paid" on another - which is how two operators end up disagreeing about what an order's
 * state means.
 */

/**
 * Money arrives as an integer of MINOR units (kobo, cents) everywhere in this codebase,
 * because floating point is not a currency. This is the single place it becomes a string.
 *
 * ASSUMES A TWO-DECIMAL CURRENCY. Every currency NUVORA sells in is two-decimal (NGN, USD,
 * EUR, GBP). A zero-decimal currency such as JPY would need a divisor of 1, so if one is
 * ever added this function is the thing that must change - and it would be wrong quietly,
 * which is why the assumption is written down rather than implied.
 */
export function formatMoney(minor: number | null | undefined, currency = "NGN"): string {
  if (minor === null || minor === undefined) return "-";

  const major = minor / 100;

  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    // An unrecognised currency code must not blank the page; show it plainly instead.
    return `${currency} ${major.toFixed(2)}`;
  }
}

/** A signed margin, so a negative is unmistakable rather than merely small. */
export function formatSignedMoney(minor: number, currency = "NGN"): string {
  const sign = minor < 0 ? "-" : "+";
  return `${sign}${formatMoney(Math.abs(minor), currency)}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";

  // Rendered in a fixed West Africa Time so two operators in different timezones reading
  // the same screen quote the same minute when they talk to each other.
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(date);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Africa/Lagos",
  }).format(date);
}

/** Margin as a percentage of the customer price. Null when the price is zero. */
export function marginPercent(marginMinor: number, customerPriceMinor: number): number | null {
  if (customerPriceMinor <= 0) return null;
  return (marginMinor / customerPriceMinor) * 100;
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return "-";
  return `${value.toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// Status labels and tones
//
// Tones map to the existing palette in app/globals.css. They are applied as full class
// strings rather than composed at the call site so Tailwind's scanner can see every
// literal - a `text-${tone}` template would be purged from the production stylesheet and
// the badges would silently lose their colour.
// ---------------------------------------------------------------------------

export type Tone = "ok" | "bad" | "warn" | "info" | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "border-ok/40 text-ok",
  bad: "border-bad/40 text-bad",
  warn: "border-accent/40 text-accent",
  info: "border-info/40 text-info",
  neutral: "border-line text-muted",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  fulfilling: "Fulfilling",
  fulfilled: "Fulfilled",
  partially_fulfilled: "Partially fulfilled",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const ORDER_STATUS_TONES: Record<string, Tone> = {
  pending_payment: "warn",
  paid: "info",
  fulfilling: "info",
  fulfilled: "ok",
  partially_fulfilled: "warn",
  failed: "bad",
  cancelled: "neutral",
  refunded: "neutral",
};

export const FULFILMENT_LABELS: Record<string, string> = {
  pending: "Pending",
  submitted: "Submitted",
  completed: "Completed",
  failed: "Failed",
  refunded: "Refunded",
};

export const FULFILMENT_TONES: Record<string, Tone> = {
  pending: "warn",
  submitted: "info",
  completed: "ok",
  failed: "bad",
  refunded: "neutral",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  initialised: "Initialised",
  pending: "Pending",
  succeeded: "Succeeded",
  failed: "Failed",
  abandoned: "Abandoned",
  reversed: "Reversed",
};

export const PAYMENT_STATUS_TONES: Record<string, Tone> = {
  initialised: "neutral",
  pending: "warn",
  succeeded: "ok",
  failed: "bad",
  abandoned: "neutral",
  reversed: "bad",
};

export const PRODUCT_LINE_LABELS: Record<string, string> = {
  esim: "eSIM",
  topup: "Top-up",
  gift_card: "Gift card",
  game_credit: "Game credit",
  subscription: "Subscription",
};

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

export const PRODUCT_STATUS_TONES: Record<string, Tone> = {
  draft: "neutral",
  active: "ok",
  archived: "warn",
};

export const USER_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  banned: "Banned",
};

export const USER_STATUS_TONES: Record<string, Tone> = {
  active: "ok",
  suspended: "warn",
  banned: "bad",
};

export const AUTH_SCHEME_LABELS: Record<string, string> = {
  bearer: "Bearer token",
  api_key_header: "API key header",
  basic: "HTTP Basic",
  query_param: "Query parameter",
  none: "None",
};

export const WEBHOOK_SCHEME_LABELS: Record<string, string> = {
  none: "Unsigned (not accepted for live)",
  hmac_sha256_hex: "HMAC-SHA256 (hex)",
  hmac_sha256_base64: "HMAC-SHA256 (base64)",
  shared_header: "Shared secret header",
};

/** Safe label lookup: an unknown enum value shows itself rather than an empty cell. */
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "-";
  return map[value] ?? value;
}

export function toneOf(map: Record<string, Tone>, value: string | null | undefined): Tone {
  if (!value) return "neutral";
  return map[value] ?? "neutral";
}
