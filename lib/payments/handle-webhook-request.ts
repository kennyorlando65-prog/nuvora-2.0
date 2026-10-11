import "server-only";

import { NextResponse } from "next/server";

import { getGatewayForWebhook, isWebhookProvider } from "./index";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { createSupabaseWebhookStore } from "./supabase-store";
import { processWebhook } from "./webhook";
import { fulfilOrderLines } from "@/lib/fulfilment/fulfil-order";
import type { WebhookProvider } from "./types";

/**
 * Shared webhook request handler.
 *
 * Both gateway routes use this, so the money-critical sequence exists once. The route
 * files themselves only name their provider.
 *
 * THE RAW BODY IS READ AS TEXT FIRST, and passed on unparsed. Signatures are computed over
 * the exact bytes received, so reading the body as JSON first and re-serialising it would
 * change the whitespace and break verification - or worse, tempt someone to "fix" it by
 * skipping verification.
 *
 * The response body reveals nothing about why an event was handled a certain way, so the
 * endpoint cannot be used as an oracle to probe order numbers. Detail is logged server-side.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;

export async function handleWebhookRequest(
  providerParam: string,
  request: Request,
): Promise<NextResponse> {
  if (!isWebhookProvider(providerParam)) {
    return NextResponse.json({ received: false }, { status: 404 });
  }
  const provider: WebhookProvider = providerParam;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ received: false }, { status: 413 });
  }

  // Read the raw text BEFORE anything else. This is the bytes the signature covers.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ received: false }, { status: 413 });
  }

  let gateway;
  try {
    gateway = getGatewayForWebhook(provider);
  } catch (error) {
    // Not configured means we cannot verify the signature, so we must reject rather than
    // proceed unauthenticated. 503 asks the gateway to retry once the key is in place.
    console.error(`[webhook:${provider}] gateway unavailable`, error);
    return NextResponse.json({ received: false }, { status: 503 });
  }

  let result;
  try {
    result = await processWebhook({
      provider,
      gateway,
      rawBody,
      headers: request.headers,
      store: createSupabaseWebhookStore(getServiceRoleClient()),
    });
  } catch (error) {
    // A storage failure (database unreachable, for instance) must return 500 so the
    // gateway retries. Returning 200 here would silently drop a real payment.
    console.error(`[webhook:${provider}] processing failed`, error);
    return NextResponse.json({ received: false }, { status: 500 });
  }

  // Operator visibility: the outcome and the reason, never the payload or a key.
  console.log(`[webhook:${provider}] ${result.outcome} - ${result.detail}`);

  // -- fulfilment ---------------------------------------------------------------
  // A verified payment now has a consequence. This is the step whose absence meant a customer
  // could be charged and receive nothing.
  //
  // WHY THIS IS CATCH-AND-LOG RATHER THAN THROW. The payment is already recorded by the time
  // we get here, so returning 5xx would tell the gateway to resend an event we have already
  // handled - correct for the payment, noisy for the gateway, and no more reliable for the
  // delivery than the paths that exist for it. Fulfilment has its own retry machinery: the
  // idempotent retry below, the supplier callback receiver, the admin retry, and the attempt
  // ceiling that surfaces a stuck line to an operator. A failure here is therefore reported
  // loudly in the logs and left to that machinery rather than escalating into a gateway retry
  // storm.
  if ((result.outcome === "paid" || result.outcome === "already_paid") && result.orderId) {
    try {
      const report = await fulfilOrderLines(getServiceRoleClient(), {
        orderId: result.orderId,
        trigger: "payment_webhook",
      });

      const delivered = report.lines.filter((line) => line.delivered).length;
      console.log(
        `[webhook:${provider}] fulfilment for ${report.orderNumber}: ` +
          `${delivered}/${report.lines.length} delivered, order now ${report.orderStatus ?? "unchanged"}` +
          (report.needsHuman > 0 ? `, ${report.needsHuman} line(s) need an operator` : ""),
      );
    } catch (error) {
      // Deliberately swallowed after logging. See the note above: a delivery problem must not
      // be reported to the gateway as a payment problem.
      console.error(
        `[webhook:${provider}] fulfilment failed for order ${result.orderId}; ` +
          "the payment is recorded and the delivery can be retried from the admin order page.",
        error,
      );
    }
  }

  return NextResponse.json(
    { received: true },
    { status: result.httpStatus, headers: { "cache-control": "no-store" } },
  );
}
