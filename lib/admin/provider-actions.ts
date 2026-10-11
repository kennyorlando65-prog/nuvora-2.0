"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logAdminAction } from "@/lib/admin/audit";
import {
  getProvider,
  parseProviderForm,
  providerAuditShape,
  type ProviderInput,
} from "@/lib/admin/providers";
import { requireAdminColumns } from "@/lib/auth/guard";
import { credentialHint, encryptSecret, isEncryptionAvailable } from "@/lib/crypto/secret-box";

/**
 * Provider configuration mutations.
 *
 * WHY THESE USE THE SERVICE ROLE WHILE THE CATALOGUE DOES NOT.
 * The catalogue writes through the user-scoped client, so RLS authorises them. Supplier rows are
 * different: writing one means ENCRYPTING the credential, and that happens in application code.
 * If a browser session could write the ciphertext column directly, the credential's protection
 * would depend on the browser sending ciphertext rather than plaintext - which is not a
 * guarantee, it is a hope. So the encrypted value is written by the server using the privileged
 * client, behind `requireAdminColumns`, which refuses any caller who is not a verified admin.
 *
 * AUDIT GOES THROUGH THE USER-SCOPED CLIENT. `log_admin_action` stamps the actor from the
 * verified JWT, and the JWT belongs to the operator's session - not to the service-role key.
 * Passing the privileged client there would still work (service_role is admitted by the
 * function) but the actor would be "unknown", which defeats the point of the trail.
 *
 * THE CREDENTIAL IS WRITE-ONLY, AND THAT IS ENFORCED IN TWO PLACES.
 *   - `suppliers.credential_ciphertext` is removed from the authenticated column grants, so no
 *     session can read it back even if a query asked.
 *   - An empty credential field means "leave the stored key alone". Treating an empty box as a
 *     new value would erase a working key every time somebody edited the display name.
 */

function backTo(path: string, code: string | null, notice?: string): never {
  const search = new URLSearchParams();
  if (code) search.set("error", code);
  if (notice) search.set("notice", notice);
  const query = search.toString();
  redirect(`${path}${query ? `?${query}` : ""}`);
}

/** Fields shared by insert and update, with the credential handled separately. */
function providerRow(input: ProviderInput) {
  return {
    key: input.key,
    name: input.name,
    // `adapter` is retained for compatibility with the existing registry key, while
    // `implementation` names the code path. They are kept in step deliberately.
    adapter: input.implementation,
    implementation: input.implementation,
    base_url: input.baseUrl,
    auth_scheme: input.authScheme,
    auth_header_name: input.authHeaderName,
    mode: input.mode,
    is_active: input.isActive,
    supported_lines: input.supportedLines,
    capabilities: input.capabilities,
    request_mapping: input.requestMapping,
    webhook_path: input.webhookPath,
    webhook_signature_scheme: input.webhookSignatureScheme,
    notes: input.notes,
  };
}

export async function createProviderAction(formData: FormData): Promise<void> {
  const { supabase, privileged, user: actor } = await requireAdminColumns("/admin/providers");

  const parsed = parseProviderForm(formData, {
    isUpdate: false,
    hasStoredCredential: false,
    hasStoredWebhookSecret: false,
  });

  if (!parsed.ok) backTo("/admin/providers/new", parsed.error);

  const input = parsed.value;

  // A key already stored as a supplied credential... but encryption may not be configured. The
  // check happens BEFORE the insert so a provider is never created with a credential that could
  // not be encrypted, which would be a row whose key is missing with no explanation.
  if (input.credential && !isEncryptionAvailable()) {
    backTo("/admin/providers/new", "credential-required");
  }

  const { data: existing } = await supabase
    .from("suppliers")
    .select("key")
    .eq("key", input.key)
    .maybeSingle();

  if (existing) backTo("/admin/providers/new", "key-taken");

  const row: Record<string, unknown> = {
    ...providerRow(input),
    created_by: actor.id,
    updated_by: actor.id,
  };

  if (input.credential) {
    row.credential_ciphertext = encryptSecret(input.credential);
    row.credential_hint = credentialHint(input.credential);
    row.credential_updated_at = new Date().toISOString();
    row.credential_set_by = actor.id;
  }

  if (input.webhookSecret) {
    row.webhook_secret_ciphertext = encryptSecret(input.webhookSecret);
  }

  const { data: created, error } = await privileged
    .from("suppliers")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    // The schema refuses to enable a live provider with no endpoint, so this is where that
    // refusal surfaces as a message rather than a constraint name.
    if (error.message.includes("suppliers_live_requires_endpoint")) {
      backTo("/admin/providers/new", "url-required");
    }
    throw new Error(`Provider insert failed: ${error.message}`);
  }

  await logAdminAction(supabase, {
    action: "provider.create",
    entityTable: "suppliers",
    entityId: (created?.id as string) ?? input.key,
    after: providerAuditShape(row),
  });

  revalidatePath("/admin/providers");
  redirect(`/admin/providers/${input.key}?notice=created`);
}

export async function updateProviderAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "").trim().toLowerCase();
  if (!key) redirect("/admin/providers");

  const detailPath = `/admin/providers/${key}`;
  const { supabase, privileged, user: actor } = await requireAdminColumns(detailPath);

  // The stored credential state is read from the database, never from the form: a hidden field
  // claiming a credential exists would let a submitted form decide whether the enabling check
  // applies.
  const { data: stored } = await privileged
    .from("suppliers")
    .select("id, key, credential_hint, webhook_secret_ciphertext")
    .eq("key", key)
    .maybeSingle();

  if (!stored) backTo("/admin/providers", "not-found");

  const parsed = parseProviderForm(formData, {
    isUpdate: true,
    hasStoredCredential: Boolean(stored.credential_hint),
    hasStoredWebhookSecret: Boolean(stored.webhook_secret_ciphertext),
  });

  if (!parsed.ok) backTo(detailPath, parsed.error);

  const input = parsed.value;

  // The key is an immutable identifier: products reference it, the fulfilment registry resolves
  // by it, and the foreign key cascades on update. Changing it silently would mean the operator
  // thinks they renamed a supplier while every product kept pointing at the old one. A rename
  // is therefore a deliberate act with its own consequence, not a side effect of an edit.
  if (input.key !== key) backTo(detailPath, "key-invalid");

  if (input.credential && !isEncryptionAvailable()) {
    backTo(detailPath, "credential-required");
  }

  const { data: before } = await supabase
    .from("suppliers")
    .select(
      "key, name, implementation, base_url, auth_scheme, mode, is_active, capabilities, webhook_path, webhook_signature_scheme",
    )
    .eq("key", key)
    .maybeSingle();

  const row: Record<string, unknown> = { ...providerRow(input), updated_by: actor.id };

  // An empty credential field means "unchanged". Writing an empty ciphertext here would destroy
  // a working key during a cosmetic edit.
  if (input.credential) {
    row.credential_ciphertext = encryptSecret(input.credential);
    row.credential_hint = credentialHint(input.credential);
    row.credential_updated_at = new Date().toISOString();
    row.credential_set_by = actor.id;
  }

  if (input.webhookSecret) {
    row.webhook_secret_ciphertext = encryptSecret(input.webhookSecret);
  }

  const { error } = await privileged.from("suppliers").update(row).eq("key", key);

  if (error) {
    if (error.message.includes("suppliers_live_requires_endpoint")) {
      backTo(detailPath, "url-required");
    }
    if (error.message.includes("credential_required")) {
      backTo(detailPath, "credential-missing");
    }
    throw new Error(`Provider update failed: ${error.message}`);
  }

  await logAdminAction(supabase, {
    action: "provider.update",
    entityTable: "suppliers",
    entityId: (stored.id as string) ?? key,
    before: before ?? null,
    after: providerAuditShape(row),
  });

  revalidatePath("/admin/providers");
  revalidatePath(detailPath);
  redirect(`${detailPath}?notice=updated`);
}

/**
 * Enable or disable a provider.
 *
 * A separate action because enabling is the moment a supplier becomes able to take real orders,
 * and that deserves its own audit event. The schema's `suppliers_live_requires_endpoint` check
 * is what actually refuses an unusable live provider; this surfaces that refusal as a sentence.
 */
export async function setProviderEnabledAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "").trim().toLowerCase();
  const enable = String(formData.get("enable") ?? "") === "true";
  if (!key) redirect("/admin/providers");

  const detailPath = `/admin/providers/${key}`;
  const { supabase, privileged, user: actor } = await requireAdminColumns(detailPath);

  const { data: current } = await supabase
    .from("suppliers")
    .select("id, is_active, mode, base_url, auth_scheme, credential_hint, implementation")
    .eq("key", key)
    .maybeSingle();

  if (!current) backTo("/admin/providers", "not-found");

  const { error } = await privileged
    .from("suppliers")
    .update({ is_active: enable, updated_by: actor.id })
    .eq("key", key);

  if (error) {
    if (error.message.includes("suppliers_live_requires_endpoint")) {
      backTo(detailPath, "url-required");
    }
    throw new Error(`Provider state change failed: ${error.message}`);
  }

  await logAdminAction(supabase, {
    action: enable ? "provider.enable" : "provider.disable",
    entityTable: "suppliers",
    entityId: (current.id as string) ?? key,
    before: { is_active: current.is_active },
    after: { is_active: enable, mode: current.mode },
  });

  revalidatePath("/admin/providers");
  revalidatePath(detailPath);
  redirect(`${detailPath}?notice=${enable ? "enabled" : "disabled"}`);
}

/**
 * Deletes a provider.
 *
 * Refused while any product or historical order line references it. The foreign key from
 * `products.supplier_key` is ON DELETE RESTRICT precisely so this cannot silently orphan a
 * product: a product whose supplier no longer exists is an order that gets paid for and then
 * cannot be delivered. Disabling is the reversible alternative, and the message says so.
 */
export async function deleteProviderAction(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "").trim().toLowerCase();
  if (!key) redirect("/admin/providers");

  const detailPath = `/admin/providers/${key}`;
  const { supabase, privileged, user: actor } = await requireAdminColumns(detailPath);

  const { data: current } = await supabase
    .from("suppliers")
    .select("id, key, name, implementation, base_url, auth_scheme, mode, is_active, capabilities, webhook_path, webhook_signature_scheme")
    .eq("key", key)
    .maybeSingle();

  if (!current) backTo("/admin/providers", "not-found");

  const { error } = await privileged.from("suppliers").delete().eq("key", key);

  if (error) {
    if (error.message.includes("foreign key") || error.message.includes("violates")) {
      backTo(detailPath, "in-use");
    }
    throw new Error(`Provider delete failed: ${error.message}`);
  }

  await logAdminAction(supabase, {
    action: "provider.delete",
    entityTable: "suppliers",
    entityId: (current.id as string) ?? key,
    before: current as Record<string, unknown>,
  });

  revalidatePath("/admin/providers");
  redirect("/admin/providers?notice=deleted");
}
