"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logAdminAction } from "@/lib/admin/audit";
import { listSettings, parseSettingsForm } from "@/lib/admin/settings";
import { requireAdmin } from "@/lib/auth/guard";

/**
 * Settings mutations.
 *
 * Writes use the USER-SCOPED client, not the service role, which is only possible because
 * migration 20261011091000 granted `authenticated` UPDATE on app_settings. That is the point:
 * authorisation stays with the RLS policy and `is_admin()`, evaluated by the database against
 * the verified JWT. Reaching for the service role here would have worked, and would have made
 * this the one admin surface where a guard bug could not be caught by the database.
 *
 * Each setting is updated individually so the audit entry can carry a real before/after pair.
 * A bulk update would be one round trip cheaper and would record a single opaque change that
 * nobody could read back later.
 *
 * The declared `value_type` is what drives validation - the form's field list comes from the
 * database, not from a hardcoded list in the page - so a setting added by a future migration
 * gets validation for free provided its type is one this function knows.
 */

function backTo(code: string | null, notice?: string): never {
  const search = new URLSearchParams();
  if (code) search.set("error", code);
  if (notice) search.set("notice", notice);
  const query = search.toString();
  redirect(`/admin/settings${query ? `?${query}` : ""}`);
}

export async function updateSettingsAction(formData: FormData): Promise<void> {
  const { supabase } = await requireAdmin("/admin/settings");

  // The declared types are read first: parseSettingsForm validates each submitted value against
  // the type the DATABASE declares, so the client cannot change what a field is allowed to hold.
  const settings = await listSettings(supabase);
  const parsed = parseSettingsForm(formData, settings);

  if (!parsed.ok) {
    // The message is passed through a code rather than the text itself, so no submitted value
    // is ever echoed into the page.
    backTo("validation");
  }

  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  let changed = 0;

  for (const input of parsed.values) {
    const before = byKey.get(input.key);
    if (!before) continue;

    // Skip a no-op so the audit log records decisions rather than every button press.
    if (JSON.stringify(before.value) === JSON.stringify(input.value)) continue;

    const { error } = await supabase
      .from("app_settings")
      .update({ value: input.value, updated_by: null })
      .eq("key", input.key);

    if (error) {
      throw new Error(`Setting "${input.key}" could not be saved: ${error.message}`);
    }

    await logAdminAction(supabase, {
      action: "setting.update",
      entityTable: "app_settings",
      entityId: input.key,
      before: { value: before.value },
      after: { value: input.value },
    });

    changed += 1;
  }

  revalidatePath("/admin/settings");
  // The footer and storefront read public settings, so they are revalidated too - otherwise a
  // corrected support email would keep rendering the old one.
  revalidatePath("/");

  backTo(null, changed === 0 ? "unchanged" : "saved");
}

// NOTE: the validation message is resolved by the PAGE, not here, because a "use server" module
// may only export async functions. Returning or exporting a message map from this file is a
// build error - and the map belongs with the form anyway.
