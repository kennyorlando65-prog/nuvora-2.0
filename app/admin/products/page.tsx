import type { Metadata } from "next";
import Link from "next/link";

import { Badge, Card, EmptyState, InlineLink, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import {
  PRODUCT_LINE_LABELS,
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_TONES,
  formatDate,
  formatMoney,
  formatPercent,
  labelOf,
  marginPercent,
  toneOf,
} from "@/lib/admin/format";
import { PRODUCT_PUBLIC_COLUMNS, readCurrentPrices, readProductCosts } from "@/lib/admin/products";
import { requireAdminColumns } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Catalogue" };

/**
 * Catalogue list.
 *
 * The cost and margin columns here are read through the privileged client and are NEVER
 * part of any customer-facing response. When the privileged reader is unavailable the
 * columns show "unavailable" and the page says so - a zero in a cost column would read as
 * free and would make every margin on the screen wrong.
 */
export default async function AdminProductsPage() {
  const { supabase, privileged } = await requireAdminColumns("/admin/products");

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Catalogue query failed: ${error.message}`);

  const products = data ?? [];
  const ids = products.map((p) => p.id as string);

  const [costs, prices] = await Promise.all([
    readProductCosts(privileged, ids),
    readCurrentPrices(privileged, ids),
  ]);

  return (
    <>
      <PageHeader
        label="Commerce"
        title="Catalogue"
        description="Products available to sell. Customer price and supplier cost are held separately and the margin is derived from them, never entered."
        actions={
          <Link
            href="/admin/products/new"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Add product
          </Link>
        }
      />

      {!costs.available && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-accent/40 bg-panel px-4 py-3 text-sm text-muted"
        >
          <strong className="text-ink">Cost and margin are unavailable.</strong>{" "}
          {costs.unavailableReason} They are read through a privileged server reader. Set{" "}
          <code className="font-mono text-xs text-accent">SUPABASE_SERVICE_ROLE_KEY</code> in
          Vercel to restore them. Until then, blank means UNKNOWN rather than zero.
        </p>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="The catalogue is empty"
          hint="This is the expected state of a new store, and no placeholder products are ever seeded. Add a supplier on the providers page first, then create a product here."
        />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Line</Th>
                <Th>Status</Th>
                <Th align="right">Customer price</Th>
                <Th align="right">Supplier cost</Th>
                <Th align="right">Margin</Th>
                <Th>Supplier</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const id = product.id as string;
                const cost = costs.byId[id] ?? null;
                const price = prices.byId[id] ?? null;
                const currency = product.currency as string;

                // The live price is the snapshot's; the base price is only the fallback
                // target. Showing the snapshot is what makes the screen agree with checkout.
                const customerPrice =
                  price?.customerPriceMinor ?? Number(product.base_price_minor);
                const margin =
                  price?.marginMinor ??
                  (cost?.supplierCostMinor != null
                    ? customerPrice - cost.supplierCostMinor
                    : null);

                return (
                  <tr key={id}>
                    <Td>
                      <Link
                        href={`/admin/products/${id}`}
                        className="block text-ink underline underline-offset-2 hover:text-accent"
                      >
                        {product.name as string}
                      </Link>
                      <span className="block font-mono text-xs text-dim">
                        {product.sku as string}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs text-muted">
                        {labelOf(PRODUCT_LINE_LABELS, product.product_line as string)}
                      </span>
                    </Td>
                    <Td>
                      <Badge
                        label={labelOf(PRODUCT_STATUS_LABELS, product.status as string)}
                        tone={toneOf(PRODUCT_STATUS_TONES, product.status as string)}
                      />
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(customerPrice, currency)}
                      {price?.ruleName && (
                        <span className="block text-[10px] text-dim">rule: {price.ruleName}</span>
                      )}
                      {!price?.ruleName && price && (
                        <span className="block text-[10px] text-dim">from base price</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {cost?.supplierCostMinor != null ? (
                        formatMoney(cost.supplierCostMinor, cost.supplierCurrency ?? currency)
                      ) : (
                        <span className="text-dim">unavailable</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {margin === null ? (
                        <span className="text-dim">unavailable</span>
                      ) : (
                        <span className={margin < 0 ? "text-bad" : "text-ink"}>
                          {formatMoney(margin, currency)}
                          <span className="block text-[10px] text-dim">
                            {formatPercent(marginPercent(margin, customerPrice))}
                          </span>
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="font-mono text-xs text-muted">
                        {cost?.supplierKey ?? "unavailable"}
                      </span>
                    </Td>
                    <Td mono>{formatDate(product.updated_at as string)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

          <Card title="How the margin is derived">
            <p className="text-xs text-muted">
              The margin is the customer price minus the supplier cost, and the database
              enforces that identity: <span className="font-mono text-ink">product_prices.margin_minor</span>{" "}
              carries a CHECK that it equals the difference, so an inconsistent margin cannot
              be stored at all. Supplier cost and margin are removed from the client column
              grants, so neither is readable by a browser session - not even an admin one.
            </p>
          </Card>

          <p className="text-xs text-dim">
            Need to change how prices are computed across products? Margin rules live in{" "}
            <InlineLink href="/admin/settings">settings</InlineLink>. Until they do, every
            product is priced from its own base price, with no rule applied.
          </p>
        </>
      )}
    </>
  );
}
