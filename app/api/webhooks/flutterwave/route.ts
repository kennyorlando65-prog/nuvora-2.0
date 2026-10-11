import { handleWebhookRequest } from "@/lib/payments/handle-webhook-request";

/**
 * Flutterwave webhook endpoint.
 *
 * Configure this URL in Flutterwave -> Settings -> Webhooks, and set the same Secret hash
 * value in FLUTTERWAVE_WEBHOOK_SECRET_HASH:
 *
 *   {NEXT_PUBLIC_SITE_URL}/api/webhooks/flutterwave
 *
 * Note that Flutterwave's `verif-hash` is a STATIC shared string, not a signature over the
 * body - which is exactly why the server re-verifies every transaction against the
 * Flutterwave API before anything is marked paid.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleWebhookRequest("flutterwave", request);
}
