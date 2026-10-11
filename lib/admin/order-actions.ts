"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { fulfilOrderLines } from "@/lib/fulfilment/fulfil-order";
import { requireAdminColumns } from "@/lib/auth/guard";

/**
 * Order actions.
 *
 * Currently one: retry a delivery by hand.
 *
 * WHY A MANUAL RETRY EXISTS AT ALL, given there is automatic retrying. Automatic retries stop at
 * the attempt ceiling on purpose, because a supplier that has permanently rejected a product would
 * otherwise be hammered forever while an operator sees a queue that keeps clearing itself. The
 * ceiling converts an infinite silent loop into a visible task for a human - and this action is how
 * that human clears it after fixing the cause (a corrected mapping, a re-entered API key, a
 * supplier that came back up).
 *
 * It is deliberately not a "force deliver" button. It runs the same fulfilOrderLines() path the
 * payment webhook runs, so it cannot produce a delivery the automatic path could not, and it is
 * recorded in the audit log with the operator's identity stamped from their session.
 */

export async function retryFulfilmentAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get("orderId") ?? "");

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(orderId)) {
    redirect("/admin/orders?error=bad-order-id");
  }

  // The gate runs first and yields both clients. Fulfilment needs the privileged one because
  // suppliers.credential_ciphertext is unreadable by any other role, and because the attempt
  // ledger is service-role only.
  const { user, privileged } = await requireAdminColumns(`/admin/orders/${orderId}`);

  let notice: string;
  let error: string | undefined;

  try {
    const report = await fulfilOrderLines(privileged, {
      orderId,
      trigger: "manual_retry",
      // Recorded in the audit log, and stamped from the JWT by log_admin_action rather than
      // trusted from this variable.
      actorUserId: user.id,
    });

    const delivered = report.lines.filter((line) => line.delivered).length;
    const attempted = report.lines.length;

    if (attempted === 0) {
      notice = `Nothing to retry: every line on ${report.orderNumber} is already settled.`;
    } else if (report.fullyFulfilled) {
      notice = `${report.orderNumber} is now fully fulfilled (${delivered} of ${attempted} lines delivered in this attempt).`;
    } else if (report.needsHuman > 0) {
      notice = `${delivered} of ${attempted} lines delivered. ${report.needsHuman} still need attention - check the fulfilment error on each line.`;
      error = "partial";
    } else {
      notice = `${delivered} of ${attempted} lines delivered. The remaining lines are still in flight at the supplier.`;
    }
  } catch (thrown) {
    // Surfaces the real cause, which for fulfilment is almost always configuration: a missing
    // base URL, an absent API key, an encryption key that changed. Saying so is the difference
    // between a fixable message and "something went wrong".
    error = "failed";
    notice = thrown instanceof Error ? thrown.message : "Fulfilment failed for an unknown reason.";
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");

  const params = new URLSearchParams();
  if (error) params.set("error", error);
  params.set("notice", notice);

  redirect(`/admin/orders/${orderId}?${params.toString()}`);
}
