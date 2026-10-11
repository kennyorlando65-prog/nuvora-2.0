import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ProviderError } from "@/lib/providers/errors";
import { resolveAdapterForKey } from "@/lib/providers/resolve";
import type { ProviderFulfilResult, SupplierAdapter } from "@/lib/providers/types";

/**
 * Fulfilment: turning a paid order into delivered goods.
 *
 * THE GAP THIS CLOSES. Before this module, a paid order set `order_items.fulfilment_status` to
 * 'pending' at creation and nothing ever advanced it. A customer could be charged and receive
 * nothing, with no record that anything was attempted. Everything below exists so that a
 * payment has a consequence.
 *
 * DESIGN CONSTRAINTS THAT SHAPED IT
 *
 * 1. IDEMPOTENCY IS THE LINE ID. The adapter contract requires a stable key, and
 *    `order_items.id` is exactly the right one: it is unique per unit of goods, stable across
 *    retries, and already the thing the supplier should key on. Nothing generates a fresh key
 *    per attempt, because that is precisely how a timeout produces two eSIMs.
 *
 * 2. EVERY ATTEMPT IS RECORDED, WIN OR LOSE. `fulfilment_attempts` is written before the
 *    outcome is acted upon, so a crash between the supplier call and the status update leaves
 *    evidence rather than silence. This is what makes the attempt ceiling meaningful.
 *
 * 3. THE DATABASE ENFORCES THE INVARIANT. A line cannot be marked 'completed' with a null
 *    payload (order_items_delivered_iff_payload), so this code cannot record a delivery that
 *    has nothing in it.
 *
 * 4. FAILURE IS NOT EXCEPTIONAL. A supplier being down is ordinary. This function returns a
 *    report instead of throwing for per-line failures, and reserves throwing for the case
 *    where the DATA is wrong - because that is a bug, not weather.
 */

/** Terminal and non-terminal line states, mirroring public.fulfilment_status. */
export type FulfilmentStatus = "pending" | "submitted" | "completed" | "failed" | "refunded";

/** Order states this module may set, mirroring public.order_status. */
type OrderStatus =
  | "paid"
  | "fulfilling"
  | "fulfilled"
  | "partially_fulfilled"
  | "failed";

export type LineOutcome = {
  orderItemId: string;
  productName: string;
  status: FulfilmentStatus;
  attemptNumber: number;
  /** True when the adapter reported the goods were delivered. */
  delivered: boolean;
  /** True when no further automatic attempt is warranted. */
  terminal: boolean;
  detail: string;
};

export type FulfilmentReport = {
  orderId: string;
  orderNumber: string;
  lines: LineOutcome[];
  orderStatus: OrderStatus | null;
  /** Lines that were already completed before this call, so they were left alone. */
  skippedAlreadyDelivered: number;
  /** Lines that hit the attempt ceiling and now need a human. */
  needsHuman: number;
  /** True when every non-refunded line is now completed. */
  fullyFulfilled: boolean;
};

/** How many automatic attempts a single line may have before an operator must intervene. */
const DEFAULT_MAX_ATTEMPTS = 3;

/** The shape of a line as read for fulfilment, including the supplier resolved by FK. */
type FulfilmentLine = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  fulfilment_status: FulfilmentStatus;
  products: { supplier_key: string; supplier_reference: string | null } | null;
};

export type FulfilOrderOptions = {
  orderId: string;
  /** Injected clock, so tests are not time-dependent. */
  now?: () => Date;
  /** Overrides the attempt ceiling, which otherwise comes from app_settings. */
  maxAttempts?: number;
  /**
   * When set, the run was started by an administrator and the audit trail records it. A
   * webhook-driven run passes nothing: there is no human actor to attribute.
   */
  actorUserId?: string | undefined;
  /** Why this run happened. Recorded on each attempt for later forensics. */
  trigger: "payment_webhook" | "manual_retry" | "callback" | "sweep";
};

/**
 * Fulfil every outstanding line on an order.
 *
 * Callers: the gateway webhook (after a payment is verified), the supplier callback receiver,
 * the admin retry action, and a sweep. All four route through here so there is one definition
 * of what "fulfil this order" means.
 */
export async function fulfilOrderLines(
  privileged: SupabaseClient,
  options: FulfilOrderOptions,
): Promise<FulfilmentReport> {
  const { orderId, trigger } = options;
  const now = options.now ?? (() => new Date());

  const maxAttempts = options.maxAttempts ?? (await readMaxAttempts(privileged));

  // -- 1. the order ------------------------------------------------------------
  const { data: orderRow, error: orderError } = await privileged
    .from("orders")
    .select("id, order_number, status, currency")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    throw new Error(`Could not read order ${orderId} for fulfilment: ${orderError.message}`);
  }
  if (!orderRow) {
    throw new Error(`Order ${orderId} does not exist; refusing to fulfil.`);
  }

  const orderNumber = orderRow.order_number as string;

  // -- 2. the lines ------------------------------------------------------------
  // Only lines that actually need work. A completed line is never re-sent: refunded lines are
  // excluded too, because re-delivering something already refunded would give away goods.
  const { data: lineRows, error: linesError } = await privileged
    .from("order_items")
    .select(
      "id, order_id, product_id, product_name, quantity, fulfilment_status, " +
        "products!inner(supplier_key, supplier_reference)",
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (linesError) {
    throw new Error(`Could not read order lines for ${orderNumber}: ${linesError.message}`);
  }

  const allLines = (lineRows ?? []) as unknown as FulfilmentLine[];
  const outstanding = allLines.filter(
    (line) => line.fulfilment_status === "pending" || line.fulfilment_status === "submitted",
  );

  const report: FulfilmentReport = {
    orderId,
    orderNumber,
    lines: [],
    orderStatus: null,
    skippedAlreadyDelivered: allLines.length - outstanding.length,
    needsHuman: 0,
    fullyFulfilled: false,
  };

  if (outstanding.length === 0) {
    // Nothing to do. The order status is still recomputed, because a previous run may have
    // delivered everything without managing to update the parent - which is exactly the state a
    // crash between those two writes leaves behind.
    report.orderStatus = await reconcileOrderStatus(privileged, orderId, allLines, now);
    report.fullyFulfilled = report.orderStatus === "fulfilled";
    return report;
  }

  // -- 3. fulfil each line -----------------------------------------------------
  for (const line of outstanding) {
    const outcome = await fulfilOneLine(privileged, {
      line,
      orderNumber,
      maxAttempts,
      trigger,
      now,
      ...(options.actorUserId ? { actorUserId: options.actorUserId } : {}),
    });

    report.lines.push(outcome);
    if (!outcome.delivered && outcome.terminal) report.needsHuman += 1;
  }

  // -- 4. move the parent order ------------------------------------------------
  // Read the lines back rather than tracking them in memory: the writes above are the truth,
  // and recomputing from them means the parent cannot disagree with its children.
  const { data: refreshed, error: refreshError } = await privileged
    .from("order_items")
    .select("id, fulfilment_status")
    .eq("order_id", orderId);

  if (refreshError) {
    throw new Error(
      `Lines were fulfilled but the order status could not be recomputed for ${orderNumber}: ${refreshError.message}`,
    );
  }

  const refreshedLines = (refreshed ?? []) as unknown as FulfilmentLine[];
  report.orderStatus = await reconcileOrderStatus(privileged, orderId, refreshedLines, now);
  report.fullyFulfilled = report.orderStatus === "fulfilled";

  // -- 5. audit ---------------------------------------------------------------
  // A manual retry is a human action on a customer's order, so it belongs in the trail. A
  // webhook-driven run is automatic and would flood it.
  if (trigger === "manual_retry" && options.actorUserId) {
    await privileged.rpc("log_admin_action", {
      p_action: "order.fulfilment_retry",
      p_entity_table: "orders",
      p_entity_id: orderId,
      p_before: null,
      p_after: {
        order_number: orderNumber,
        lines: report.lines.map((l) => ({
          order_item_id: l.orderItemId,
          status: l.status,
          attempt: l.attemptNumber,
        })),
        order_status: report.orderStatus,
      },
      p_correlation: null,
    });
  }

  return report;
}

/**
 * Fulfil a single line, recording the attempt whatever happens.
 *
 * The attempt row is written BEFORE the outcome is applied to the line, and that order matters:
 * if the process dies between the supplier answering and the line being updated, the attempt
 * ledger still shows the call happened. A line stuck in 'submitted' with an attempt recorded is
 * diagnosable; a line stuck with nothing recorded is not.
 */
async function fulfilOneLine(
  privileged: SupabaseClient,
  args: {
    line: FulfilmentLine;
    orderNumber: string;
    maxAttempts: number;
    trigger: FulfilOrderOptions["trigger"];
    now: () => Date;
    actorUserId?: string;
  },
): Promise<LineOutcome> {
  const { line, orderNumber, maxAttempts, trigger, now } = args;

  const supplierKey = line.products?.supplier_key;
  if (!supplierKey) {
    // The FK from products to suppliers makes this unreachable for a real row, which is why it
    // is a thrown error and not a handled outcome: it means the query is wrong.
    throw new Error(
      `Order line ${line.id} has no resolved supplier. The products join did not return a supplier_key.`,
    );
  }

  const attemptNumber = (await countAttempts(privileged, line.id)) + 1;

  if (attemptNumber > maxAttempts) {
    // Deliberately not an attempt row: nothing was tried. The ceiling exists so a broken
    // supplier is not hammered forever behind an operator's back.
    return {
      orderItemId: line.id,
      productName: line.product_name,
      status: line.fulfilment_status,
      attemptNumber: attemptNumber - 1,
      delivered: false,
      terminal: true,
      detail:
        `Reached the automatic attempt ceiling (${maxAttempts}). ` +
        "An operator must retry by hand once the cause is understood.",
    };
  }

  let adapter: SupplierAdapter | null;
  try {
    adapter = await resolveAdapterForKey(privileged, supplierKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordAttempt(privileged, {
      orderItemId: line.id,
      attemptNumber,
      providerKey: supplierKey,
      providerMode: "sandbox",
      isSandbox: true,
      outcome: "error",
      errorCode: error instanceof ProviderError ? error.code : "provider_not_configured",
      retryable: false,
      latencyMs: null,
      detail: `Could not resolve a supplier adapter: ${message}`,
      trigger,
    });

    // Configuration is not transient. Retrying cannot fix a missing base URL, so this is
    // terminal and the operator is sent to the provider page.
    await markLineFailed(privileged, line.id, `Supplier not usable: ${message}`);
    return {
      orderItemId: line.id,
      productName: line.product_name,
      status: "failed",
      attemptNumber,
      delivered: false,
      terminal: true,
      detail: `Supplier "${supplierKey}" is not usable: ${message}`,
    };
  }

  if (!adapter) {
    await markLineFailed(privileged, line.id, `Supplier "${supplierKey}" is not registered.`);
    return {
      orderItemId: line.id,
      productName: line.product_name,
      status: "failed",
      attemptNumber,
      delivered: false,
      terminal: true,
      detail: `No provider row exists for supplier "${supplierKey}".`,
    };
  }

  if (!adapter.capabilities.includes("fulfil")) {
    await markLineFailed(
      privileged,
      line.id,
      `Supplier "${supplierKey}" is not configured for fulfilment.`,
    );
    return {
      orderItemId: line.id,
      productName: line.product_name,
      status: "failed",
      attemptNumber,
      delivered: false,
      terminal: true,
      detail: `Provider "${supplierKey}" does not declare the fulfil capability.`,
    };
  }

  /**
   * Reconcile before submitting, when a previous attempt ended ambiguously.
   *
   * A timeout or a dropped connection does NOT tell us whether the supplier acted. Asking for
   * the status first is what makes the retry safe: if the goods were already issued, we adopt
   * the existing delivery instead of requesting a second one. Without this step, a retry after a
   * timeout is a coin flip on giving away stock.
   */
  const ambiguous = await lastAttemptWasAmbiguous(privileged, line.id);
  if (ambiguous) {
    try {
      const existing = await adapter.getStatus(line.id);
      if (existing) {
        await applyOutcome(privileged, line, existing, attemptNumber, supplierKey, trigger, now());
        return outcomeFrom(existing, line, attemptNumber, "Adopted the delivery from the previous attempt.");
      }
    } catch (error) {
      // A status check that fails does not block a retry; it only means we could not confirm.
      // Proceeding is still safe because the idempotency key protects the supplier side.
      const message = error instanceof Error ? error.message : String(error);
      await recordAttempt(privileged, {
        orderItemId: line.id,
        attemptNumber,
        providerKey: supplierKey,
        providerMode: adapter.mode,
        isSandbox: adapter.isSandbox,
        outcome: "error",
        errorCode: "status_check_failed",
        retryable: true,
        latencyMs: null,
        detail: `Pre-retry status check failed, proceeding with the idempotent retry: ${message}`,
        trigger,
      });
    }
  }

  // -- the call ---------------------------------------------------------------
  const startedAt = Date.now();
  let result: ProviderFulfilResult;

  try {
    result = await adapter.fulfil({
      supplierReference: line.products?.supplier_reference ?? line.product_id,
      quantity: line.quantity,
      // The line id, not a fresh key. This is the property that makes a retry a retry.
      idempotencyKey: line.id,
      metadata: { orderNumber },
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const providerError = error instanceof ProviderError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    const retryable = providerError?.retryable ?? false;

    await recordAttempt(privileged, {
      orderItemId: line.id,
      attemptNumber,
      providerKey: supplierKey,
      providerMode: adapter.mode,
      isSandbox: adapter.isSandbox,
      outcome: "error",
      errorCode: providerError?.code ?? "unknown_error",
      retryable,
      latencyMs,
      detail: message,
      trigger,
    });

    // A retryable transport error leaves the line in 'submitted', which means "in flight, worth
    // another attempt". A non-retryable one is a decision the supplier has already made, so the
    // line is marked failed and stops consuming attempts.
    if (retryable) {
      await markLineSubmitted(privileged, line.id, supplierKey, message);
      return {
        orderItemId: line.id,
        productName: line.product_name,
        status: "submitted",
        attemptNumber,
        delivered: false,
        terminal: attemptNumber >= maxAttempts,
        detail: `Transient supplier failure (${providerError?.code ?? "unknown"}): ${message}`,
      };
    }

    await markLineFailed(privileged, line.id, message);
    return {
      orderItemId: line.id,
      productName: line.product_name,
      status: "failed",
      attemptNumber,
      delivered: false,
      terminal: true,
      detail: `Supplier refused the delivery (${providerError?.code ?? "unknown"}): ${message}`,
    };
  }

  const latencyMs = Date.now() - startedAt;
  await applyOutcome(privileged, line, result, attemptNumber, supplierKey, trigger, now(), latencyMs);

  return outcomeFrom(
    result,
    line,
    attemptNumber,
    result.state === "completed"
      ? result.isSandbox
        ? "Delivered by the sandbox simulator. NOT a real good."
        : "Delivered by the supplier."
      : result.state === "pending"
        ? "Accepted by the supplier and awaiting activation."
        : `Supplier reported failure: ${result.error?.message ?? "no detail given"}`,
  );
}

/** Persist the outcome of a completed call: attempt row, then line state, then payload. */
async function applyOutcome(
  privileged: SupabaseClient,
  line: FulfilmentLine,
  result: ProviderFulfilResult,
  attemptNumber: number,
  supplierKey: string,
  trigger: FulfilOrderOptions["trigger"],
  at: Date,
  latencyMs: number | null = null,
): Promise<void> {
  await recordAttempt(privileged, {
    orderItemId: line.id,
    attemptNumber,
    providerKey: supplierKey,
    providerMode: result.mode,
    isSandbox: result.isSandbox,
    outcome: result.state,
    errorCode: result.error?.code ?? null,
    retryable: result.error?.retryable ?? null,
    latencyMs,
    detail: result.isSandbox
      ? "Sandbox delivery. No supplier traffic left this process."
      : `Supplier state: ${result.state}.`,
    trigger,
  });

  if (result.state === "completed") {
    // The database refuses 'completed' with a null payload, so a completed result without one
    // is caught here rather than at the constraint, where the message would be less clear.
    if (!result.deliveryPayload) {
      await markLineFailed(
        privileged,
        line.id,
        "Supplier reported completion without a delivery payload; refusing to record it as delivered.",
      );
      return;
    }

    const { error } = await privileged
      .from("order_items")
      .update({
        fulfilment_status: "completed",
        delivery_payload: result.deliveryPayload,
        delivered_at: at.toISOString(),
        supplier_reference: result.supplierReference || supplierKey,
        fulfilment_error: null,
      })
      .eq("id", line.id);

    if (error) {
      throw new Error(
        `Supplier delivered line ${line.id} but the delivery could not be recorded: ${error.message}. ` +
          "The attempt ledger shows the call happened; retry will reconcile rather than re-deliver.",
      );
    }
    return;
  }

  if (result.state === "pending") {
    await markLineSubmitted(privileged, line.id, result.supplierReference || supplierKey, null);
    return;
  }

  await markLineFailed(
    privileged,
    line.id,
    result.error?.message ?? "Supplier reported a failure with no detail.",
  );
}

async function markLineSubmitted(
  privileged: SupabaseClient,
  orderItemId: string,
  supplierReference: string,
  errorText: string | null,
): Promise<void> {
  await privileged
    .from("order_items")
    .update({
      fulfilment_status: "submitted",
      supplier_reference: supplierReference,
      ...(errorText ? { fulfilment_error: errorText } : {}),
    })
    .eq("id", orderItemId);
}

async function markLineFailed(
  privileged: SupabaseClient,
  orderItemId: string,
  errorText: string,
): Promise<void> {
  await privileged
    .from("order_items")
    .update({ fulfilment_status: "failed", fulfilment_error: errorText })
    .eq("id", orderItemId);
}

/**
 * Write one attempt row.
 *
 * `attempt_number` is unique per line, so a duplicate means two runs decided on the same number
 * concurrently - an operator retrying while a webhook is still processing, most likely. That is
 * reported and swallowed rather than thrown: the second caller's work is redundant, not
 * dangerous, because the idempotency key keeps the supplier side safe either way.
 */
async function recordAttempt(
  privileged: SupabaseClient,
  args: {
    orderItemId: string;
    attemptNumber: number;
    providerKey: string;
    providerMode: string;
    isSandbox: boolean;
    outcome: string;
    errorCode: string | null;
    retryable: boolean | null;
    latencyMs: number | null;
    detail: string;
    trigger: FulfilOrderOptions["trigger"];
  },
): Promise<void> {
  const { error } = await privileged.from("fulfilment_attempts").insert({
    order_item_id: args.orderItemId,
    attempt_number: args.attemptNumber,
    provider_key: args.providerKey,
    provider_mode: args.providerMode,
    is_sandbox: args.isSandbox,
    outcome: args.outcome,
    error_code: args.errorCode,
    retryable: args.retryable,
    latency_ms: args.latencyMs,
    detail: `[${args.trigger}] ${args.detail}`,
  });

  if (error) {
    console.error(
      `[fulfilment] could not record attempt ${args.attemptNumber} for line ${args.orderItemId}: ${error.message}`,
    );
  }
}

async function countAttempts(privileged: SupabaseClient, orderItemId: string): Promise<number> {
  const { count, error } = await privileged
    .from("fulfilment_attempts")
    .select("*", { count: "exact", head: true })
    .eq("order_item_id", orderItemId);

  if (error) {
    // Treated as zero: refusing to fulfil because the ledger could not be read would turn an
    // observability failure into a delivery outage. The unique constraint still stops a
    // duplicate attempt number from being written twice.
    console.error(
      `[fulfilment] could not count attempts for line ${orderItemId}, assuming none: ${error.message}`,
    );
    return 0;
  }

  return count ?? 0;
}

/**
 * Whether the most recent attempt ended without telling us what the supplier did.
 *
 * Only a timeout or a transport error qualifies. A 500, an explicit failure or a success all
 * carry information; a dropped connection carries none, and that is the case where asking first
 * prevents a double delivery.
 */
async function lastAttemptWasAmbiguous(
  privileged: SupabaseClient,
  orderItemId: string,
): Promise<boolean> {
  const { data, error } = await privileged
    .from("fulfilment_attempts")
    .select("error_code, outcome")
    .eq("order_item_id", orderItemId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;

  return data.error_code === "timeout" || data.error_code === "transport_error";
}

function outcomeFrom(
  result: ProviderFulfilResult,
  line: FulfilmentLine,
  attemptNumber: number,
  detail: string,
): LineOutcome {
  return {
    orderItemId: line.id,
    productName: line.product_name,
    status:
      result.state === "completed" ? "completed" : result.state === "pending" ? "submitted" : "failed",
    attemptNumber,
    delivered: result.state === "completed",
    terminal: result.state === "failed" && !(result.error?.retryable ?? false),
    detail,
  };
}

/**
 * Recompute the parent order's status from its lines.
 *
 * Only ever moves the order FORWARD, and never touches a cancelled or refunded order: a
 * refunded order whose lines are later delivered must not silently become 'fulfilled'. That
 * combination is a real support case (refund issued, supplier then succeeded) and it needs a
 * human, not an automatic transition.
 */
async function reconcileOrderStatus(
  privileged: SupabaseClient,
  orderId: string,
  lines: Array<{ fulfilment_status: FulfilmentStatus }>,
  now: () => Date,
): Promise<OrderStatus | null> {
  const { data: current, error: readError } = await privileged
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();

  if (readError || !current) return null;

  const status = current.status as string;

  // Orders in these states are left exactly as they are.
  if (["pending_payment", "cancelled", "refunded", "partially_refunded"].includes(status)) {
    return status as OrderStatus;
  }

  const relevant = lines.filter((line) => line.fulfilment_status !== "refunded");

  if (relevant.length === 0) return status as OrderStatus;

  const completed = relevant.filter((line) => line.fulfilment_status === "completed").length;
  const failed = relevant.filter((line) => line.fulfilment_status === "failed").length;

  let next: OrderStatus;
  let fulfilledAt: string | null = null;

  if (completed === relevant.length) {
    next = "fulfilled";
    fulfilledAt = now().toISOString();
  } else if (completed > 0) {
    // Some goods delivered, some not. 'partially_fulfilled' is the honest state and it is what
    // puts the order on an operator's queue instead of looking finished.
    next = "partially_fulfilled";
  } else if (failed === relevant.length) {
    next = "failed";
  } else {
    // In flight: nothing delivered, nothing finally failed.
    next = "fulfilling";
  }

  if (next === status && !(next === "fulfilled" && fulfilledAt)) return next;

  const { error: writeError } = await privileged
    .from("orders")
    .update({
      status: next,
      ...(fulfilledAt && status !== "fulfilled" ? { fulfilled_at: fulfilledAt } : {}),
    })
    .eq("id", orderId);

  if (writeError) {
    // The lines are correct and the attempt ledger is complete, so this is recoverable: the next
    // run reconciles the parent. Logged loudly rather than thrown, so a fulfilled delivery is
    // never reported as a failure.
    console.error(
      `[fulfilment] lines are settled but order ${orderId} could not be moved to '${next}': ${writeError.message}`,
    );
    return status as OrderStatus;
  }

  return next;
}

/** The automatic attempt ceiling, from app_settings so it can be tuned without a deploy. */
async function readMaxAttempts(privileged: SupabaseClient): Promise<number> {
  const { data, error } = await privileged
    .from("app_settings")
    .select("value")
    .eq("key", "operations.fulfilment_max_attempts")
    .maybeSingle();

  if (error || !data) return DEFAULT_MAX_ATTEMPTS;

  const parsed = Number(data.value);

  // A nonsense setting must not become an infinite retry loop or a zero-attempt dead end.
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    console.error(
      `[fulfilment] operations.fulfilment_max_attempts is ${JSON.stringify(data.value)}; ` +
        `using the default of ${DEFAULT_MAX_ATTEMPTS}.`,
    );
    return DEFAULT_MAX_ATTEMPTS;
  }

  return parsed;
}
