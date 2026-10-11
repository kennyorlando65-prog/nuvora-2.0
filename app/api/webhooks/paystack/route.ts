import { handleWebhookRequest } from "@/lib/payments/handle-webhook-request";

/**
 * Paystack webhook endpoint.
 *
 * Configure this URL in Paystack -> Settings -> API Keys & Webhooks:
 *
 *   {NEXT_PUBLIC_SITE_URL}/api/webhooks/paystack
 *
 * See lib/payments/handle-webhook-request.ts for the verification sequence, and
 * lib/payments/webhook.ts for why nothing here is marked paid on the strength of the
 * request body alone.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleWebhookRequest("paystack", request);
}
