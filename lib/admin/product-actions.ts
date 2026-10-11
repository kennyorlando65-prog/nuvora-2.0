"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logAdminAction } from "@/lib/admin/audit";
import { parseProductForm, recomputePriceSnapshot, type ProductInput } from "@/lib/admin/products";
import { requireAdminColumns } from "@/lib/auth/guard";

/**
 * Catalogue mutations.
 *
 * THREE RULES APPLIED TO EVERY WRITE IN THIS FILE.
 *
 * 1. The gate runs first. `requireAdminColumns` calls `requireAdmin`, so no path in this
 *    module can reach a database write without a verified admin session.
 *
 * 2. The DATA write uses the USER-SCOPED client, not the privileged one. RLS still applies,
 *    so the admin policy on `products` is what authorises the insert - the same policy the
 *    harness asserts against a non-admin. Only the price-snapshot work uses the service
 *    role, because `product_prices` genuinely has no client insert grant.
 *
 * 3. Every write is audited with before/after state. `supplier_cost_minor` is deliberately
 *    EXCLUDED from the audit payload: the audit log is readable by any admin, and copying
 *    the cost into a second table would widen where the commercial secret lives for no
 *    operational gain. The trail records the customer-side money fields plus the computed
 *    price and margin as observed VALUES, so "who changed this, and what did the price
 *    become" is answerable without the cost figure ever entering the log.
 *
 * Errors are reported as short codes in the URL and mapped to wording by the form, so no
 * submitted value is ever echoed back into the page.
 */

function backTo(path: string, code: string, extra?: Record<string, string>): never {
  const search = new URLSearchParams({ error: code, ...extra });
  redirect(`${path}?${search.toString()}`);
}

/** True when the error is a unique-constraint violation on the given column. */
function isUniqueViolation(message: string, column: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("duplicate key") && lower.includes(column);
}

/**
 * The audit payload for a product.
 *
 * Deliberately omits the cost figure itself - see rule 3 above.
 */
function auditShape(input: ProductInput) {
  return {
    sku: input.sku,
    slug: input.slug,
    name: input.name,
    product_line: input.productLine,
    status: input.status,
    currency: input.currency,
    base_price_minor: input.basePriceMinor,
    supplier_key: input.supplierKey,
    coverage_regions: input.coverageRegions,
  };
}

async function assertSupplierExists(
  supabase: SupabaseClient,
  supplierKey: string,
): Promise<boolean> {
  // products.supplier_key now carries a real foreign key, so this check is a courtesy that
  // produces a clear message instead of a constraint name. The database is still the
  // authority; this only decides what the operator reads.
  const { data } = await supabase
    .from("suppliers")
    .select("key")
    .eq("key", supplierKey)
    .maybeSingle();

  return Boolean(data);
}

export async function createProductAction(formData: FormData): Promise<void> {
  const { supabase, privileged, user } = await requireAdminColumns("/admin/products/new");

  const parsed = parseProductForm(formData);
  if (!parsed.ok) backTo("/admin/products/new", parsed.error);

  const input = parsed.value;

  if (!(await assertSupplierExists(supabase, input.supplierKey))) {
    backTo("/admin/products/new", "supplier-missing");
  }

  const { data: created, error } = await supabase
    .from("products")
    .insert({
      sku: input.sku,
      slug: input.slug,
      name: input.name,
      product_line: input.productLine,
      description: input.description,
      attributes: input.attributes,
      coverage_regions: input.coverageRegions,
      fulfilment_mode: input.fulfilmentMode,
      status: input.status,
      currency: input.currency,
      base_price_minor: input.basePriceMinor,
      supplier_key: input.supplierKey,
      supplier_reference: input.supplierReference,
      supplier_cost_minor: input.supplierCostMinor,
      supplier_currency: input.supplierCurrency,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error.message, "sku")) backTo("/admin/products/new", "duplicate-sku");
    if (isUniqueViolation(error.message, "slug")) backTo("/admin/products/new", "duplicate-slug");
    throw new Error(`Product insert failed: ${error.message}`);
  }

  const productId = created?.id as string | undefined;
  if (!productId) throw new Error("Product insert returned no id.");

  await logAdminAction(supabase, {
    action: "product.create",
    entityTable: "products",
    entityId: productId,
    after: auditShape(input),
  });

  // Compute the price the customer will actually be charged. Without this row the product
  // exists but checkout cannot price it, so this is not decoration.
  const snapshot = await recomputePriceSnapshot(privileged, productId);

  if (!snapshot.ok) {
    // A product that cannot be priced must not be sellable. Demoting to draft is the honest
    // outcome: the row the operator just typed is preserved, and the store refuses to sell
    // something it cannot price.
    if (input.status === "active") {
      await supabase.from("products").update({ status: "draft" }).eq("id", productId);
    }

    await logAdminAction(supabase, {
      action: "product.price_failed",
      entityTable: "products",
      entityId: productId,
      after: { reason: snapshot.reason },
    });

    backTo(`/admin/products/${productId}`, "saved-but-unpriced");
  }

  await logAdminAction(supabase, {
    action: "product.price_computed",
    entityTable: "products",
    entityId: productId,
    after: {
      customer_price_minor: snapshot.customerPriceMinor,
      margin_minor: snapshot.marginMinor,
      decided_by: snapshot.decidedBy,
      rule_name: snapshot.ruleName,
    },
  });

  revalidatePath("/admin/products");
  redirect(`/admin/products/${productId}?notice=created`);
}

export async function updateProductAction(formData: FormData): Promise<void> {
  const productId = String(formData.get("product_id") ?? "").trim();
  if (!productId) backTo("/admin/products", "not-found");

  const detailPath = `/admin/products/${productId}`;
  const { supabase, privileged, user: actor } = await requireAdminColumns(detailPath);

  const parsed = parseProductForm(formData);
  if (!parsed.ok) backTo(detailPath, parsed.error);

  const input = parsed.value;

  if (!(await assertSupplierExists(supabase, input.supplierKey))) {
    backTo(detailPath, "supplier-missing");
  }

  // Read the current row so the audit entry can record real before/after state rather than
  // asserting that something changed.
  const { data: before } = await supabase
    .from("products")
    .select("sku, slug, name, product_line, status, currency, base_price_minor, supplier_key")
    .eq("id", productId)
    .maybeSingle();

  if (!before) backTo("/admin/products", "not-found");

  const { error } = await supabase
    .from("products")
    .update({
      sku: input.sku,
      slug: input.slug,
      name: input.name,
      product_line: input.productLine,
      description: input.description,
      attributes: input.attributes,
      coverage_regions: input.coverageRegions,
      fulfilment_mode: input.fulfilmentMode,
      status: input.status,
      currency: input.currency,
      base_price_minor: input.basePriceMinor,
      supplier_key: input.supplierKey,
      supplier_reference: input.supplierReference,
      supplier_cost_minor: input.supplierCostMinor,
      supplier_currency: input.supplierCurrency,
      updated_by: actor.id,
    })
    .eq("id", productId);

  if (error) {
    if (isUniqueViolation(error.message, "sku")) backTo(detailPath, "duplicate-sku");
    if (isUniqueViolation(error.message, "slug")) backTo(detailPath, "duplicate-slug");
    throw new Error(`Product update failed: ${error.message}`);
  }

  await logAdminAction(supabase, {
    action: "product.update",
    entityTable: "products",
    entityId: productId,
    before: before as Record<string, unknown>,
    after: auditShape(input),
  });

  // Any change to price, cost, supplier or line can move the computed price, so the
  // snapshot is always recomputed rather than only when a price field looks different.
  const snapshot = await recomputePriceSnapshot(privileged, productId);

  if (!snapshot.ok) {
    if (input.status === "active") {
      await supabase.from("products").update({ status: "draft" }).eq("id", productId);
    }

    await logAdminAction(supabase, {
      action: "product.price_failed",
      entityTable: "products",
      entityId: productId,
      after: { reason: snapshot.reason },
    });

    backTo(detailPath, "saved-but-unpriced");
  }

  await logAdminAction(supabase, {
    action: "product.price_computed",
    entityTable: "products",
    entityId: productId,
    after: {
      customer_price_minor: snapshot.customerPriceMinor,
      margin_minor: snapshot.marginMinor,
      decided_by: snapshot.decidedBy,
      rule_name: snapshot.ruleName,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath(detailPath);
  redirect(`${detailPath}?notice=updated`);
}

/**
 * Publish / unpublish.
 *
 * Kept as its own action rather than a checkbox on the edit form so that the transition is
 * auditable as a discrete event. "Who put this on sale, and when" is a question a catalogue
 * has to be able to answer, and a status field bundled into a general save cannot.
 */
export async function setProductStatusAction(formData: FormData): Promise<void> {
  const productId = String(formData.get("product_id") ?? "").trim();
  const nextStatus = String(formData.get("status") ?? "").trim();
  if (!productId) backTo("/admin/products", "not-found");

  const detailPath = `/admin/products/${productId}`;
  const { supabase, privileged, user: actor } = await requireAdminColumns(detailPath);

  if (!["active", "draft", "archived"].includes(nextStatus)) {
    backTo(detailPath, "status-invalid");
  }

  const { data: current } = await supabase
    .from("products")
    .select("status, name")
    .eq("id", productId)
    .maybeSingle();

  if (!current) backTo("/admin/products", "not-found");

  // Publishing is gated on a computable price. This is the check that stops an unpriced
  // product reaching the storefront, where the failure would surface as a customer unable to
  // complete a purchase.
  if (nextStatus === "active") {
    const snapshot = await recomputePriceSnapshot(privileged, productId);

    if (!snapshot.ok) {
      await logAdminAction(supabase, {
        action: "product.publish_refused",
        entityTable: "products",
        entityId: productId,
        after: { reason: snapshot.reason, requested_status: nextStatus },
      });

      backTo(detailPath, "saved-but-unpriced");
    }
  }

  const { error } = await supabase
    .from("products")
    .update({ status: nextStatus, updated_by: actor.id })
    .eq("id", productId);

  if (error) throw new Error(`Status update failed: ${error.message}`);

  await logAdminAction(supabase, {
    action: nextStatus === "active" ? "product.publish" : "product.unpublish",
    entityTable: "products",
    entityId: productId,
    before: { status: current.status },
    after: { status: nextStatus },
  });

  revalidatePath("/admin/products");
  revalidatePath(detailPath);
  redirect(`${detailPath}?notice=status`);
}

// NOTE there is deliberately no `export { PRODUCT_ERRORS }` here.
// A "use server" module may only export async functions - the compiler turns every export
// into a server-action endpoint. Exporting a plain object from one is a build error, and it
// would also be wrong if it worked: an error-code map belongs to the form that renders it,
// not to the endpoint that throws the codes. The form imports it from lib/admin/products.ts.
