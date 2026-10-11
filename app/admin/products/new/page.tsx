import type { Metadata } from "next";
import Link from "next/link";

import { ProductForm, ProductMessages } from "@/components/admin/product-form";
import { PageHeader } from "@/components/admin/ui";
import { createProductAction } from "@/lib/admin/product-actions";
import { requireAdmin } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "New product" };

/**
 * Create a product.
 *
 * The supplier list is read with the admin session's own client. Every column involved is in
 * the `authenticated` allow-list, and RLS limits the rows to an admin - a non-admin calling
 * this page never reaches the query at all, because `requireAdmin` redirects first.
 */
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const notice = typeof params.notice === "string" ? params.notice : undefined;

  const { supabase } = await requireAdmin("/admin/products/new");

  const { data: suppliers, error: supplierError } = await supabase
    .from("suppliers")
    .select("key, name, mode, is_active")
    .order("name", { ascending: true });

  if (supplierError) throw new Error(`Supplier list failed: ${supplierError.message}`);

  return (
    <>
      <Link href="/admin/products" className="text-xs text-muted underline hover:text-accent">
        Back to catalogue
      </Link>

      <PageHeader
        label="New"
        title="Add a product"
        description="Customer price and supplier cost are entered separately. The margin is derived from them when the product is saved, and the database refuses a price below cost."
      />

      <ProductMessages error={error} notice={notice} />

      <ProductForm
        action={createProductAction}
        suppliers={suppliers ?? []}
        submitLabel="Create product"
      />

      <p className="text-xs text-dim">
        Saving recomputes the price through the same engine checkout uses and writes a price
        snapshot. If the price cannot be computed, the product is saved as a draft so it never
        reaches the storefront unsellable.
      </p>
    </>
  );
}
