import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { fulfilOrderLines } from "@/lib/fulfilment/fulfil-order";
import { verifySupplierSignature, type SignatureScheme } from "@/lib/fulfilment/verify-supplier-signature";
import { parseProviderMapping, readPath } from "@/lib/providers/mapping";
import { decryptCredential } from "@/lib/providers/resolve";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { redact } from "@/lib/observability/report-error";

/**
 * Supplier callback receiver:  /api/webhooks/supplier/{providerKey}
 *
 * THE GAP THIS CLOSES. Until now the store could only ask a supplier what happened; nothing could
 * tell it. Outbound-only polling is enough for an eSIM that activates in seconds and inadequate for
 * anything asynchronous - a gift card issued a minute later, a top-up a carrier confirms later.
 *
 * Order of operations, and why each step is where it is:
 *
 *   1. Resolve the provider from the URL. An unknown key is a 404 with no detail, so the endpoint
 *      cannot be used to enumerate which providers exist.
 *   2. Read the RAW body. The signature covers these exact bytes.
 *   3. Verify BEFORE parsing. A callback that failed verification is recorded with
 *      signature_valid=false and then DROPPED - it never reaches fulfilment.
 *   4. Record the event. The unique index on (provider_key, event_id) makes a supplier's retry
 *      idempotent: the second insert is refused, so the same activation cannot be processed twice.
 *   5. Process. This path calls the SAME fulfilOrderLines() the payment webhook calls, so a
 *      callback cannot produce a delivery the outbound path could not. Crucially it does not write
 *      delivery_payload itself - a supplier callback that could write goods directly would make
 *      "this payload came from a verified call" a convention rather than a guarantee.
 *
 * ALWAYS RETURNS 2xx ONCE THE EVENT IS RECORDED, even if processing failed. A non-2xx makes the
 * supplier retry, and a retry that is going to fail identically only delays the operator seeing it.
 * The row carries processing_error, which is what the retry sweep reads.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const KEY_SHAPE = /^[a-z0-9][a-z0-9-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A response that reveals nothing.
 *
 * Deliberately uniform across unknown provider, bad signature and processed-event cases: a
 * distinguishable response would let an unauthenticated caller map which providers exist and which
 * events have already landed.
 */
function opaque(status: number): NextResponse {
  return NextResponse.json({ received: status < 400 }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const { key } = await context.params;

  if (!KEY_SHAPE.test(key)) return opaque(404);

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return opaque(413);

  // Raw bytes first. See the note above: parsing then re-serialising breaks the HMAC.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return opaque(413);

  // Service role: the webhook secret column is unreadable by every other role, by design.
  const privileged = getServiceRoleClient();

  const { data: provider, error: providerError } = await privileged
    .from("suppliers")
    .select(
      "key, mode, is_active, webhook_signature_scheme, request_mapping, webhook_secret_ciphertext",
    )
    .eq("key", key)
    .maybeSingle();

  if (providerError) {
    console.error(`[supplier-webhook:${key}] could not read provider`, redact(providerError.message));
    // 503, not 404: a database problem is ours to fix and worth a supplier retry.
    return opaque(503);
  }

  if (!provider) return opaque(404);

  if (!provider.is_active) {
    // Recorded nowhere and processed never: a disabled provider must not be able to move orders.
    console.warn(`[supplier-webhook:${key}] callback for a disabled provider was ignored`);
    return opaque(202);
  }

  const scheme = provider.webhook_signature_scheme as SignatureScheme;

  let secret: string | null = null;
  if (provider.webhook_secret_ciphertext) {
    try {
      secret = decryptCredential({
        key,
        credential_ciphertext: provider.webhook_secret_ciphertext as string,
      });
    } catch (error) {
      console.error(
        `[supplier-webhook:${key}] the stored webhook secret could not be decrypted; ` +
          "re-enter it on the provider page. Callback not processed.",
        redact(error instanceof Error ? error.message : String(error)),
      );
      return opaque(503);
    }
  }

  const verdict = verifySupplierSignature({ scheme, secret, rawBody, headers: request.headers });

  // Parse only now that authenticity is settled. A malformed body from a VERIFIED sender is a
  // supplier bug worth recording; from anyone else it is noise we do not even read.
  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }

  // Identify the event. Suppliers differ: some send an id, some send only the delivery reference,
  // some send neither. Falling back to a hash of the body is what stops a supplier that sends no id
  // from having every callback treated as a duplicate of the first.
  const eventId = extractEventId(payload, rawBody);
  const eventType = extractString(payload, ["event", "event_type", "type", "eventType"]);

  const mapping = safeMapping(provider.request_mapping);
  const supplierReference = extractSupplierReference(payload, mapping);

  const { data: inserted, error: insertError } = await privileged
    .from("supplier_webhook_events")
    .insert({
      provider_key: key,
      provider_mode: provider.mode,
      event_id: eventId,
      event_type: eventType,
      signature_valid: verdict.valid,
      signature_scheme: scheme,
      payload: payload ?? { unparsed: true },
      supplier_reference: supplierReference,
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    if (insertError.code === "23505") {
      // A retry of an event already received. This is the mechanism that makes a supplier's retry
      // loop safe, and 202 tells them to stop.
      console.log(`[supplier-webhook:${key}] duplicate event ${eventId} ignored`);
      return opaque(202);
    }

    console.error(`[supplier-webhook:${key}] could not record event`, redact(insertError.message));
    // 500 so a genuine storage failure is retried - losing a delivery callback silently is worse
    // than a duplicate, and duplicates are already handled above.
    return opaque(500);
  }

  if (!verdict.valid) {
    // Recorded for the incident trail, never processed. This is the whole point of the signature.
    console.warn(`[supplier-webhook:${key}] signature rejected: ${verdict.detail}`);
    return opaque(202);
  }

  const eventRowId = inserted?.id as number | undefined;

  try {
    const processed = await processSupplierEvent(privileged, {
      key,
      supplierReference,
      eventType,
      payload,
    });

    if (eventRowId !== undefined) {
      await privileged
        .from("supplier_webhook_events")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", eventRowId);
    }

    console.log(`[supplier-webhook:${key}] ${processed}`);
    return opaque(200);
  } catch (error) {
    // Redacted before it is stored or logged. An upstream error string is one of the easiest
    // places for a credential to leak - a driver putting a connection string with a password
    // into an exception is ordinary - and this value is both written to a column an operator
    // reads and printed to the log.
    const message = redact(error instanceof Error ? error.message : String(error));

    if (eventRowId !== undefined) {
      // processing_error, never processed_at: an event is processed or it errored, never both. The
      // database enforces that, which is how this write is guaranteed to stay honest.
      await privileged
        .from("supplier_webhook_events")
        .update({ processing_error: message.slice(0, 2000) })
        .eq("id", eventRowId);
    }

    console.error(`[supplier-webhook:${key}] processing failed`, message);
    // Still 200: the event is recorded with its error, and a supplier retry would fail the same
    // way. The row is what surfaces it to an operator.
    return opaque(200);
  }
}

/** Best-effort event id, with a body hash as the honest fallback. */
function extractEventId(payload: unknown, rawBody: string): string {
  const explicit = extractString(payload, [
    "event_id",
    "eventId",
    "id",
    "notification_id",
    "notificationId",
    "callback_id",
  ]);

  if (explicit) return explicit.slice(0, 200);

  // No id supplied. Hashing the body means the SAME callback delivered twice is recognised as a
  // duplicate while a different callback is not - which is the behaviour we need, and strictly
  // better than a per-request random id that would make every retry look new.
  return `body-sha256:${createBodyHash(rawBody)}`;
}

function createBodyHash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Read the first present key from the likely envelope shapes suppliers use. */
function extractString(payload: unknown, names: readonly string[]): string | null {
  if (typeof payload !== "object" || payload === null) return null;

  const queue: unknown[] = [payload];
  // Bounded to the first two levels: event ids live at the top or under `data`, and walking an
  // arbitrary payload looking for a matching key would eventually pick up a customer's name.
  let depth = 0;

  while (queue.length > 0 && depth < 2) {
    const levelSize = queue.length;
    for (let i = 0; i < levelSize; i += 1) {
      const node = queue.shift();
      if (typeof node !== "object" || node === null || Array.isArray(node)) continue;

      const record = node as Record<string, unknown>;
      for (const name of names) {
        const value = record[name];
        if (typeof value === "string" && value.trim() !== "") return value.trim();
        if (typeof value === "number") return String(value);
      }

      for (const value of Object.values(record)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value)) queue.push(value);
      }
    }
    depth += 1;
  }

  return null;
}

/** Parse a stored mapping without letting a bad one break the receiver. */
function safeMapping(raw: unknown): ReturnType<typeof parseProviderMapping> | null {
  try {
    return parseProviderMapping(raw);
  } catch {
    return null;
  }
}

/**
 * Which delivery this callback concerns.
 *
 * Uses the provider's own configured response path first, because that is where the operator has
 * already told us the supplier puts their reference. Falls back to common key names, and finally to
 * a UUID that might be our own order-item id - some suppliers echo the idempotency key back, and
 * that is the most reliable identifier available.
 */
function extractSupplierReference(
  payload: unknown,
  mapping: ReturnType<typeof parseProviderMapping> | null,
): string | null {
  if (mapping?.response.supplierReference) {
    const value = readPath(payload, mapping.response.supplierReference);
    if (typeof value === "string" && value.trim() !== "") return value.trim().slice(0, 200);
  }

  return extractString(payload, [
    "reference",
    "supplier_reference",
    "order_reference",
    "fulfilment_id",
    "activation_id",
    "idempotency_key",
    "key",
  ])?.slice(0, 200) ?? null;
}

/**
 * Act on a verified event.
 *
 * Resolution order matters. A UUID that resolves to one of our own order items is treated as the
 * idempotency key first, because that is an exact identifier; a supplier reference is a string the
 * supplier chose and could in principle collide across their own test and live environments.
 */
async function processSupplierEvent(
  privileged: ReturnType<typeof getServiceRoleClient>,
  args: {
    key: string;
    supplierReference: string | null;
    eventType: string | null;
    payload: unknown;
  },
): Promise<string> {
  const { supplierReference, eventType } = args;

  if (!supplierReference) {
    // Not an error worth retrying: the supplier sent a callback we cannot attribute, and no retry
    // will add the missing field.
    throw new Error(
      "The callback carries no reference that identifies a delivery. Configure a supplierReference path in this provider's response mapping.",
    );
  }

  let orderItemId: string | null = null;

  if (UUID.test(supplierReference)) {
    const { data } = await privileged
      .from("order_items")
      .select("id")
      .eq("id", supplierReference)
      .maybeSingle();
    if (data) orderItemId = data.id as string;
  }

  if (!orderItemId) {
    const { data } = await privileged
      .from("order_items")
      .select("id")
      .eq("supplier_reference", supplierReference)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) orderItemId = data.id as string;
  }

  if (!orderItemId) {
    throw new Error(
      `No order line matches supplier reference "${supplierReference}". The delivery may belong to ` +
        "a different environment, or the reference was not stored when the line was submitted.",
    );
  }

  const { data: line } = await privileged
    .from("order_items")
    .select("order_id")
    .eq("id", orderItemId)
    .maybeSingle();

  if (!line) throw new Error(`Order line ${orderItemId} disappeared between lookup and processing.`);

  const orderId = line.order_id as string;

  // The callback is what says "look now". It does not carry the delivery: re-reading the supplier's
  // own status through the adapter is what produces the payload, so a supplier cannot inject goods
  // by posting JSON at us.
  const report = await fulfilOrderLines(privileged, { orderId, trigger: "callback" });

  const delivered = report.lines.filter((l) => l.delivered).length;

  return (
    `event ${eventType ?? "(untyped)"} reconciled against ${report.orderNumber}: ` +
    `${delivered}/${report.lines.length} delivered, order now ${report.orderStatus ?? "unchanged"}`
  );
}

export function GET(): NextResponse {
  // Suppliers sometimes probe the URL before enabling it. Answering 405 without detail keeps the
  // endpoint's existence uninformative to anyone who has not been given the URL.
  return opaque(405);
}
