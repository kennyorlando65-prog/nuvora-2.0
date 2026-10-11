import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { WebhookProvider } from "./types";
import type { PaymentUpsert, RecordEventResult, WebhookOrder, WebhookStore } from "./webhook";

/**
 * The WebhookStore, implemented against Supabase with the service-role client.
 *
 * Everything here is server-side only. The service-role key bypasses RLS, which is why
 * webhook_events and payments carry no client write policy at all.
 *
 * IDEMPOTENCY IS DELEGATED TO THE DATABASE. `recordWebhookEvent` relies on the UNIQUE
 * index on (provider, event_id) rather than a read-then-write check, because a read-then-
 * write loses the race when a gateway delivers the same event twice concurrently - which
 * is exactly when double fulfilment would happen.
 */

export function createSupabaseWebhookStore(client: SupabaseClient): WebhookStore {
  return {
    async recordWebhookEvent(args: {
      provider: WebhookProvider;
      eventId: string;
      eventType: string;
      signatureValid: boolean;
      payload: unknown;
    }): Promise<RecordEventResult> {
      const insert = await client
        .from("webhook_events")
        .insert({
          provider: args.provider,
          event_id: args.eventId,
          event_type: args.eventType,
          signature_valid: args.signatureValid,
          payload: args.payload ?? {},
        })
        .select("id")
        .single();

      if (!insert.error) {
        return { id: String(insert.data.id), isNew: true };
      }

      // 23505 is unique_violation: this event has already been recorded. That is the
      // dedupe working, not a failure.
      if (insert.error.code === "23505") {
        const existing = await client
          .from("webhook_events")
          .select("id")
          .eq("provider", args.provider)
          .eq("event_id", args.eventId)
          .single();

        if (existing.error || !existing.data) {
          throw new Error(
            `webhook_events dedupe fired but the existing row could not be read: ${existing.error?.message ?? "no row"}`,
          );
        }
        return { id: String(existing.data.id), isNew: false };
      }

      throw new Error(`could not record webhook event: ${insert.error.message}`);
    },

    async markEventProcessed(args: { id: string; error?: string }): Promise<void> {
      // Exactly one of the two columns is set, which the table's CHECK enforces. Writing
      // both would violate it.
      const patch =
        args.error === undefined
          ? { processed_at: new Date().toISOString(), processing_error: null }
          : { processing_error: args.error };

      const { error } = await client.from("webhook_events").update(patch).eq("id", args.id);
      if (error) throw new Error(`could not mark webhook event processed: ${error.message}`);
    },

    async findOrderByNumber(orderNumber: string): Promise<WebhookOrder | null> {
      const { data, error } = await client
        .from("orders")
        .select("id, order_number, status, currency, total_minor")
        .eq("order_number", orderNumber)
        .maybeSingle();

      if (error) throw new Error(`could not look up order ${orderNumber}: ${error.message}`);
      if (!data) return null;

      return {
        id: String(data.id),
        orderNumber: String(data.order_number),
        status: String(data.status),
        currency: String(data.currency),
        totalMinor: BigInt(data.total_minor as number | string),
      };
    },

    async hasSucceededPayment(orderId: string): Promise<boolean> {
      const { count, error } = await client
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("order_id", orderId)
        .eq("status", "succeeded");

      if (error) throw new Error(`could not check existing payments: ${error.message}`);
      return (count ?? 0) > 0;
    },

    async upsertPayment(orderId: string, payment: PaymentUpsert): Promise<void> {
      const { error } = await client.from("payments").upsert(
        {
          order_id: orderId,
          provider: payment.provider,
          provider_reference: payment.providerReference,
          provider_transaction_id: payment.providerTransactionId,
          status: payment.status,
          amount_minor: Number(payment.amountMinor),
          currency: payment.currency,
          channel: payment.channel,
          fee_minor: payment.feeMinor === null ? null : Number(payment.feeMinor),
          verified_at: payment.verifiedAt ? payment.verifiedAt.toISOString() : null,
          raw_payload: payment.raw,
        },
        // The upsert target is the unique index on (provider, provider_reference), so a
        // repeated event updates the same payment row instead of inserting a second one.
        { onConflict: "provider,provider_reference" },
      );

      if (error) throw new Error(`could not record payment: ${error.message}`);
    },

    async markOrderPaid(args: { orderId: string; paidAt: Date }): Promise<void> {
      const { error } = await client
        .from("orders")
        .update({ status: "paid", paid_at: args.paidAt.toISOString() })
        .eq("id", args.orderId);

      if (error) throw new Error(`could not mark order paid: ${error.message}`);
    },
  };
}
