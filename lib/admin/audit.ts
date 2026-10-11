import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audit-log writer for admin mutations.
 *
 * The actor is stamped BY THE DATABASE from the verified JWT (see
 * public.log_admin_action), not by this function. That is the point: if the application
 * passed an actor id, the trail would record whatever it was told, and a compromised or
 * merely buggy route could attribute an action to somebody who never performed it. Here a
 * caller cannot lie about who they are, and a non-admin cannot write to the trail at all.
 *
 * The client passed in MUST be the user-scoped client from `getSupabaseServerClient()`,
 * not the service-role client. The service-role client carries no user JWT, so
 * `current_user_id()` would resolve to null and every entry would be anonymous.
 */

export type AuditEntry = {
  action: string;
  entityTable: string;
  entityId?: string | null;
  /** State before the change. Never include a secret, a key or a raw payload. */
  before?: unknown;
  /** State after the change. Never include a secret, a key or a raw payload. */
  after?: unknown;
  correlationId?: string | null;
};

/**
 * Writes the entry and returns its id.
 *
 * Throws on failure rather than swallowing it. A mutation that succeeded while its audit
 * entry silently failed is the worst of both worlds: the change is live and there is no
 * record of who made it. Callers should treat an audit failure as a failed operation.
 */
export async function logAdminAction(
  supabase: SupabaseClient,
  entry: AuditEntry,
): Promise<number> {
  const { data, error } = await supabase.rpc("log_admin_action", {
    p_action: entry.action,
    p_entity_table: entry.entityTable,
    p_entity_id: entry.entityId ?? null,
    p_before: entry.before ?? null,
    p_after: entry.after ?? null,
    p_correlation: entry.correlationId ?? null,
  });

  if (error) {
    throw new Error(
      `Audit log write failed for action "${entry.action}" on "${entry.entityTable}": ${error.message}`,
    );
  }

  return typeof data === "number" ? data : Number(data);
}
