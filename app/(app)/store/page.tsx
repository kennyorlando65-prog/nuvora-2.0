import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader, Pill } from "@/components/app/ui";
import { requireUser } from "@/lib/app/session";
import { listStoreProducts } from "@/lib/app/queries";
import { PRODUCT_LINE_LABELS, formatMoney, labelOf } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Store" };

/**
 * The store.
 *
 * Reads the live catalogue through the user-scoped client, so RLS returns only products
 * with `status = 'active'` and only the price columns a customer may see. Supplier cost is
 * not in the column list and could not be selected even if this file asked for it.
 *
 * THE EMPTY STATE IS THE HONEST ONE. The catalogue is genuinely empty until the operator
 * adds real products, and no placeholder products are ever seeded. So the empty state says
 * exactly that, rather than showing a fake product to make the page look finished.
 */
export default async function StorePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase } = await requireUser("/store");
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : "";

  const products = await listStoreProducts(supabase, search);

  return (
    <>
      <PageHeader
        label="The Digital Store"
        title="Store"
        description="eSIM data plans, top-ups, gift cards, game credits and subscriptions. Prices are confirmed on our server at checkout."
      />

      <form action="/store" method="get" className="flex flex-wrap gap-2">
        <label htmlFor="store-search" className="sr-only">
          Search products
        </label>
        <input
          id="store-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Search by name or code"
          className="nuvora-input max-w-sm"
        />
        <button type="submit" className="nuvora-btn nuvora-btn-secondary">
          Search
        </button>
        {search && (
          <Link href="/store" className="nuvora-btn nuvora-btn-ghost">
            Clear
          </Link>
        )}
      </form>

      {products.length === 0 ? (
        <EmptyState
          title={search ? "Nothing matched that search" : "The store is not open yet"}
          hint={
            search
              ? "Try a shorter word, or clear the search to see everything that is on sale."
              : "No products have been published yet. This is the expected state of a new store - nothing is shown until the operator adds a real product with a real price."
          }
          action={
            search ? (
              <Link href="/store" className="nuvora-btn nuvora-btn-secondary">
                Clear the search
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            // The live snapshot wins; the base price is only the fallback target. Showing
            // the snapshot is what makes this screen agree with what checkout will charge.
            const price = product.customer_price_minor ?? Number(product.base_price_minor);

            return (
              <article key={product.id} className="nuvora-card flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-ink">
                      {product.name}
                    </h2>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-dim">
                      {product.sku}
                    </p>
                  </div>
                  <Pill label={labelOf(PRODUCT_LINE_LABELS, product.product_line)} tone="info" />
                </div>

                {product.description && (
                  <p className="text-sm leading-relaxed text-muted">{product.description}</p>
                )}

                <div className="mt-auto flex items-end justify-between gap-3 border-t border-line-soft pt-3">
                  <div>
                    <p className="nuvora-label">Price</p>
                    <p className="font-mono text-lg font-semibold text-ink">
                      {formatMoney(price, product.currency)}
                    </p>
                  </div>
                  <Link
                    href={`/store/${product.id}`}
                    className="nuvora-btn nuvora-btn-primary px-4 py-2"
                  >
                    View
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Card title="How pricing works here">
        <p className="text-xs leading-relaxed text-muted">
          The price shown is the price you pay. It is calculated on our server from the
          product and any active pricing rule, and it is recalculated again at checkout - so
          a price edited in your browser cannot change what you are charged. There is no
          wallet and no balance: each order is paid for on its own.
        </p>
      </Card>
    </>
  );
}
