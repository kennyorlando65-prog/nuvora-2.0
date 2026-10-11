"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logAdminAction } from "@/lib/admin/audit";
import { INDEFINITE_BAN_DURATION, parseModerationForm } from "@/lib/admin/users";
import { requireAdminColumns } from "@/lib/auth/guard";

/**
 * Account suspension.
 *
 * TWO WRITES, AND BOTH ARE NECESSARY.
 *
 *   1. `public.user_moderation` records WHY, by whom, and until when - through the user-scoped
 *      client, so the admin RLS policy authorises it and the insert/update grants added in
 *      migration 20261011091000 make it reachable.
 *
 *   2. Supabase Auth's ban flag is set through the Auth admin API, which needs the service
 *      role. This is the write that actually REVOKES THE SESSION and prevents a new sign-in.
 *
 * Doing only the first would leave a blocked account that can still sign in; doing only the
 * second would leave an account nobody can explain. The order matters too: the local row is
 * written FIRST, so if the Auth call were to fail the record of the decision already exists.
 * A decision that is recorded but not applied is recoverable by a retry; a block that is
 * applied but not recorded is a support ticket nobody can answer.
 *
 * SELF-BLOCKING IS REFUSED. An operator who blocks their own account has locked the only
 * person who could unblock it, and the recovery path is a service-role call by hand.
 */

function backTo(userId: string, code: string | null, notice?: string): never {
  const search = new URLSearchParams();
  if (code) search.set("error", code);
  if (notice) search.set("notice", notice);
  redirect(`/admin/users/${userId}?${search.toString()}`);
}

export async function setModerationAction(formData: FormData): Promise<void> {
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!userId) redirect("/admin/users");

  const { supabase, privileged, user: actor } = await requireAdminColumns(`/admin/users/${userId}`);

  const parsed = parseModerationForm(formData);
  if (!parsed.ok) backTo(userId, parsed.error);

  if (parsed.status !== "active" && userId === actor.id) {
    backTo(userId, "self-block");
  }

  // The current state, so the audit entry records a real transition.
  const { data: existing } = await supabase
    .from("user_moderation")
    .select("user_id, status, reason, suspended_at, suspended_until")
    .eq("user_id", userId)
    .maybeSingle();

  // The Auth admin API needs the email; it is only available through the admin API, and the
  // account must exist before a moderation row can reference it.
  const { data: authUserData, error: authReadError } = await privileged.auth.admin.getUserById(userId);

  if (authReadError || !authUserData?.user) {
    backTo(userId, "user-not-found");
  }

  const email = authUserData.user.email ?? `unknown+${userId}@invalid.local`;
  const nowIso = new Date().toISOString();

  const moderationRow = {
    user_id: userId,
    email,
    status: parsed.status,
    reason: parsed.reason,
    suspended_at: parsed.status === "active" ? null : (existing?.suspended_at ?? nowIso),
    suspended_until: parsed.status === "suspended" ? parsed.until : null,
    suspended_by: parsed.status === "active" ? null : actor.id,
  };

  // Upsert through the user-scoped client: RLS authorises it, and the first suspension has no
  // row to update, which is why INSERT is granted for this table and not for app_settings.
  const { error: moderationError } = await supabase
    .from("user_moderation")
    .upsert(moderationRow, { onConflict: "user_id" });

  if (moderationError) {
    throw new Error(`Moderation row could not be written: ${moderationError.message}`);
  }

  // GoTrue takes a DURATION, not a timestamp. "none" is the documented way to clear a ban.
  const banDuration =
    parsed.status === "active"
      ? "none"
      : parsed.status === "banned"
        ? INDEFINITE_BAN_DURATION
        : parsed.until
          ? `${Math.max(1, Math.ceil((new Date(parsed.until).getTime() - Date.now()) / 3_600_000))}h`
          : INDEFINITE_BAN_DURATION;

  const { error: banError } = await privileged.auth.admin.updateUserById(userId, {
    ban_duration: banDuration,
  });

  if (banError) {
    // The moderation row is already written, so the decision is on file. The operator is told
    // the enforcement half failed, which is the honest state - and a retry is safe because the
    // upsert is idempotent.
    await logAdminAction(supabase, {
      action: "user.moderation_enforcement_failed",
      entityTable: "user_moderation",
      entityId: userId,
      after: { status: parsed.status, error: banError.message },
    });

    backTo(userId, "auth-update-failed");
  }

  await logAdminAction(supabase, {
    action: parsed.status === "active" ? "user.unblock" : `user.${parsed.status}`,
    entityTable: "user_moderation",
    entityId: userId,
    before: existing ?? null,
    after: {
      status: parsed.status,
      reason: parsed.reason,
      suspended_until: moderationRow.suspended_until,
      ban_duration: banDuration,
    },
  });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  backTo(userId, null, "saved");
}

// NOTE: no error-message map is exported from this file. A "use server" module may only export
// async functions - every export becomes an action endpoint and a plain object is a build error.
// The wording lives in lib/admin/users.ts as USER_ERRORS, where the page reads it.
