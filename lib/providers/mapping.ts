/**
 * Declarative provider mapping.
 *
 * WHAT THIS SOLVES. The adapter contract in ./types.ts speaks in OUR vocabulary:
 * `cost_minor`, `status`, `payload`, `error_code`. A supplier speaks in theirs: `unit_price`,
 * `data.state`, `activation`, `err.code`. Something has to translate, and the only question
 * is whether that translation is hard-coded per supplier or described as data.
 *
 * Described as data, adding a supplier becomes a row and a mapping object rather than a new
 * adapter file. That is the whole point of this module.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not guess. If a response mapping names a path
 * that is absent, the adapter raises `malformed_response` and the line stays unfulfilled.
 * The tempting alternative - falling back to a bare `cost` or `amount` field - is how a
 * supplier's marketing figure gets mistaken for our cost and a margin goes negative without
 * anyone noticing. A loud failure is recoverable; a quiet wrong number is not.
 *
 * DIRECTION CONVENTION: request paths point at the SUPPLIER's field name (where we PUT our
 * value), response paths point INTO the supplier's response (where we READ theirs). Both are
 * written supplier-field-first so a mapping reads the way the supplier's docs read.
 */

import { ProviderError } from "./errors";
import type { ProviderFulfilmentState } from "./types";

/** A path into a JSON body. Dots for objects, brackets for array indices: `data.items[0].state`. */
export type JsonPath = string;

/**
 * Where our request values go in the supplier's request body.
 *
 * Every field has a default matching the reference contract documented in esim-live.ts, so a
 * supplier that follows it needs no request mapping at all.
 */
export type RequestMapping = {
  reference?: JsonPath;
  quantity?: JsonPath;
  key?: JsonPath;
  currency?: JsonPath;
  metadata?: JsonPath;
};

/** Where the values we need live in the supplier's response. */
export type ResponseMapping = {
  /** REQUIRED. Without a status path there is no way to know what happened. */
  status: JsonPath;
  /** Where the customer-facing deliverable is. Required to reach `completed`. */
  deliveryPayload?: JsonPath;
  supplierReference?: JsonPath;
  errorCode?: JsonPath;
  errorMessage?: JsonPath;
  retryable?: JsonPath;

  /**
   * Quote-response paths, all optional and defaulting to our own vocabulary.
   *
   * `costMinor` is the one that matters commercially: it says where the supplier's COST
   * appears. Getting it wrong is the single most expensive mapping error available here,
   * because a supplier's retail `price` field read as our cost would understate margin by the
   * supplier's own markup. There is no fallback chain for that reason - an absent path is an
   * exception, never a guess.
   */
  costMinor?: JsonPath;
  currency?: JsonPath;
  available?: JsonPath;
};

/** Endpoint paths, relative to the provider's base URL. `{key}` is the idempotency key. */
export type EndpointMapping = {
  quote: string;
  fulfil: string;
  status: string;
  health?: string;
  /** Path template for the inbound supplier callback, if the supplier sends one. */
  webhook?: string;
};

/**
 * The full mapping for one supplier.
 *
 * `statusVocabulary` maps the supplier's own status strings onto our three states. It is
 * spelled out rather than inferred because the same word does not mean the same thing across
 * suppliers: `processing` is `pending` for one and `failed` for another.
 */
export type ProviderMapping = {
  request?: RequestMapping;
  response: ResponseMapping;
  statusVocabulary?: Record<string, ProviderFulfilmentState>;
  endpoints?: Partial<EndpointMapping>;
};

/**
 * The reference contract, used when a supplier supplies no mapping.
 *
 * This is the shape documented in esim-live.ts. A supplier whose API matches it can be
 * configured with a base URL and a key alone - which is the honest extent of the "just paste
 * the URL" claim.
 */
export const DEFAULT_MAPPING: ProviderMapping = {
  request: { reference: "reference", quantity: "quantity", key: "key" },
  response: {
    status: "status",
    deliveryPayload: "payload",
    supplierReference: "reference",
    errorCode: "error_code",
    errorMessage: "error_message",
    retryable: "retryable",
  },
  endpoints: { quote: "/quotes", fulfil: "/fulfilments", status: "/fulfilments/{key}" },
};

/** Statuses at least one real supplier uses, so the common cases need no vocabulary at all. */
const BUILT_IN_VOCABULARY: Record<string, ProviderFulfilmentState> = {
  completed: "completed",
  complete: "completed",
  success: "completed",
  succeeded: "completed",
  delivered: "completed",
  fulfilled: "completed",
  active: "completed",
  pending: "pending",
  processing: "pending",
  queued: "pending",
  in_progress: "pending",
  submitted: "pending",
  accepted: "pending",
  failed: "failed",
  error: "failed",
  rejected: "failed",
  cancelled: "failed",
  canceled: "failed",
  expired: "failed",
};

/**
 * Read a value at a dotted path.
 *
 * Returns `undefined` when the path is absent. Note the distinction the caller must respect:
 * `undefined` means "the supplier did not send this", whereas an empty string is a value the
 * supplier DID send. Collapsing the two is how "no payload yet" becomes "empty payload".
 *
 * Array syntax is supported because suppliers routinely wrap results: `data.items[0].status`.
 * It is deliberately not a general expression language - a mapping config is data an operator
 * can read, and it should not be able to execute anything.
 */
export function readPath(source: unknown, path: JsonPath): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((segment) => segment !== "");

  let cursor: unknown = source;

  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;

    if (Array.isArray(cursor)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
      continue;
    }

    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

/** Throws unless the path resolves. Use where a missing value must stop the operation. */
export function readPathRequired(source: unknown, path: JsonPath, field: string): unknown {
  const value = readPath(source, path);
  if (value === undefined) {
    throw new ProviderError(
      "malformed_response",
      `${field} is missing from the supplier's response at path "${path}". ` +
        "Check the response mapping for this provider; the adapter will not guess a field name.",
    );
  }
  return value;
}

/**
 * Translate a supplier status string into our state.
 *
 * An unrecognised status is NEVER treated as success. It raises instead, because the
 * alternative - assuming a completed delivery - would mark an unfulfilled order as fulfilled
 * and stop anyone looking at it again.
 */
export function mapStatus(
  raw: unknown,
  vocabulary: Record<string, ProviderFulfilmentState> = {},
): ProviderFulfilmentState {
  const key = String(raw ?? "").trim().toLowerCase();

  // The supplier's own vocabulary wins over the built-in table, so a supplier whose
  // "processing" means failure can say so without fighting a default.
  const mapped = vocabulary[key] ?? BUILT_IN_VOCABULARY[key];

  if (!mapped) {
    throw new ProviderError(
      "malformed_response",
      `unrecognised fulfilment status ${JSON.stringify(raw)}. Add it to this provider's ` +
        "statusVocabulary rather than assuming it means success.",
    );
  }

  return mapped;
}

/**
 * Build a request body from our values, using the supplier's field names.
 *
 * Only fields the supplier declares are sent. An extra field is not harmless: suppliers
 * commonly reject unknown keys, and a rejected fulfil is an order that stops moving.
 */
export function buildRequestBody(
  mapping: RequestMapping | undefined,
  values: {
    reference: string;
    quantity: number;
    key: string;
    currency?: string | undefined;
    metadata?: Readonly<Record<string, string>> | undefined;
  },
): Record<string, unknown> {
  const fields = { ...DEFAULT_MAPPING.request, ...(mapping ?? {}) };
  const body: Record<string, unknown> = {};

  if (fields.reference) body[fields.reference] = values.reference;
  if (fields.quantity) body[fields.quantity] = values.quantity;
  if (fields.key) body[fields.key] = values.key;
  if (fields.currency && values.currency !== undefined) body[fields.currency] = values.currency;
  if (fields.metadata && values.metadata !== undefined) body[fields.metadata] = values.metadata;

  return body;
}

/** Parse a stored `request_mapping` JSON column into a validated mapping. */
export function parseProviderMapping(raw: unknown): ProviderMapping {
  if (raw === null || raw === undefined) return DEFAULT_MAPPING;

  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProviderError(
      "provider_not_configured",
      "request_mapping must be a JSON object describing endpoints and field names.",
    );
  }

  const record = raw as Record<string, unknown>;
  const response = record.response as ResponseMapping | undefined;

  // A mapping with no status path cannot determine an outcome, so it is refused at parse
  // time rather than at the first customer's order.
  if (!response || typeof response.status !== "string" || response.status === "") {
    throw new ProviderError(
      "provider_not_configured",
      'request_mapping.response.status is required: without it the adapter cannot tell a completed delivery from a failed one. Use "status" if the supplier returns it at the top level.',
    );
  }

  return {
    ...(record.request ? { request: record.request as RequestMapping } : {}),
    response,
    ...(record.statusVocabulary
      ? { statusVocabulary: record.statusVocabulary as Record<string, ProviderFulfilmentState> }
      : {}),
    ...(record.endpoints ? { endpoints: record.endpoints as Partial<EndpointMapping> } : {}),
  };
}

/** Resolve an endpoint path, substituting `{key}` where present. */
export function resolveEndpoint(
  template: string | undefined,
  fallback: string,
  substitutions: Record<string, string> = {},
): string {
  let path = template ?? fallback;
  for (const [name, value] of Object.entries(substitutions)) {
    path = path.replaceAll(`{${name}}`, encodeURIComponent(value));
  }
  return path.startsWith("/") ? path : `/${path}`;
}
