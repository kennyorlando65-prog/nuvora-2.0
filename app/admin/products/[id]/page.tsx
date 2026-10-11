import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductForm, ProductMessages } from "@/components/admin/product-form";
import { Badge, Card, PageHeader, TableWrap, Td, Th } from "@/components/admin/ui";
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUS_TONES,
  formatDateTime,
  formatMoney,
  formatPercent,
  labelOf,
  marginPercent,
  toneOf,
} from "@/lib/admin/format";
import {
  PRODUCT_PUBLIC_COLUMNS,
  readCurrentPrices,
  readProductCosts,
  type ProductInput,
} from "@/lib/admin/products";
import { setProductStatusAction, updateProductAction } from "@/lib/admin/product-actions";
import { requireAdminColumns } from "@/lib/auth/guard";

export const metadata: Metadata = { title: "Product" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Product detail and edit.
 *
 * Price history is shown alongside the editor because the two belong together: an operator
 * changing a cost needs to see what the previous price was, and when it changed, or they
 * cannot tell a correction from a regression.
 */
export default async function AdminProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (!UUID.test(id)) notFound();

  const error = typeof query.error === "string" ? query.error : undefined;
  const notice = typeof query.notice === "string" ? query.notice : undefined;

  const { supabase, privileged } = await requireAdminColumns(`/admin/products/${id}`);

  const { data: product, error: productError } = await supabase
    .from("products")
    .select(PRODUCT_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (productError) throw new Error(`Product query failed: ${productError.message}`);
  if (!product) notFound();

  const [{ data: suppliers }, costs, prices, history] = await Promise.all([
    supabase.from("suppliers").select("key, name, mode, is_active").order("name"),
    readProductCosts(privileged, [id]),
    readCurrentPrices(privileged, [id]),
    // Price history, newest first. Read through the privileged client because the rows carry
    // the cost and margin snapshot, which no client role may select.
    privileged
      ? privileged
          .from("product_prices")
          .select(
            "id, customer_price_minor, margin_minor, supplier_cost_minor, engine_version, computed_at, valid_from, valid_to, pricing_rules(name)",
          )
          .eq("product_id", id)
          .order("computed_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const cost = costs.byId[id] ?? null;
  const price = prices.byId[id] ?? null;
  const currency = product.currency as string;

  const formProduct: ProductInput & { id: string } = {
    id,
    sku: product.sku as string,
    slug: product.slug as string,
    name: product.name as string,
    productLine: product.product_line as string,
    description: (product.description as string | null) ?? null,
    fulfilmentMode: product.fulfilment_mode as string,
    status: product.status as string,
    currency,
    basePriceMinor: Number(product.base_price_minor),
    supplierKey: cost?.supplierKey ?? "",
    supplierReference: cost?.supplierReference ?? null,
    supplierCostMinor: cost?.supplierCostMinor ?? 0,
    supplierCurrency: cost?.supplierCurrency ?? currency,
    coverageRegions: (product.coverage_regions as string[]) ?? [],
    attributes: (product.attributes as Record<string, unknown>) ?? {},
  };

  const historyRows = (history.data ?? []) as Array<Record<string, unknown>>;

  return (
    <>
      <Link href="/admin/products" className="text-xs text-muted underline hover:text-accent">
        Back to catalogue
      </Link>

      <PageHeader
        label={product.sku as string}
        title={product.name as string}
        description="Editing recomputes the price and writes a new snapshot. Previous snapshots are closed, not overwritten, so historic orders keep pointing at the price they were charged."
        actions={
          <Badge
            label={labelOf(PRODUCT_STATUS_LABELS, product.status as string)}
            tone={toneOf(PRODUCT_STATUS_TONES, product.status as string)}
          />
        }
      />

      <ProductMessages error={error} notice={notice} />

      {!costs.available && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-accent/40 bg-panel px-4 py-3 text-sm text-muted"
        >
          <strong className="text-ink">Cost and supplier fields are unavailable.</strong>{" "}
          {costs.unavailableReason} Saving while they are unavailable would write a zero cost
          over the real one, which is why the fields below are empty rather than prefilled -
          check them before saving.
        </p>
      )}

      <Card title="Publishing">
        <div className="flex flex-wrap items-center gap-3">
          {(["active", "draft", "archived"] as const)
            .filter((status) => status !== product.status)
            .map((status) => (
              <form key={status} action={setProductStatusAction}>
                <input type="hidden" name="product_id" value={id} />
                <input type="hidden" name="status" value={status} />
                <button
                  type="submit"
                  className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  {status === "active"
                    ? "Publish (put on sale)"
                    : status === "draft"
                      ? "Revert to draft"
                      : "Archive (withdraw)"}
                </button>
              </form>
            ))}
        </div>
        <p className="text-xs text-dim">
          Publishing recomputes and stores the price first, and refuses if it cannot be
          computed. That is deliberate: an active product with no current price cannot be
          priced at checkout, so the store would take a customer to a failing basket.
        </p>
      </Card>

      <ProductForm
        action={updateProductAction}
        suppliers={suppliers ?? []}
        product={formProduct}
        cost={cost}
        price={price}
        submitLabel="Save and recompute price"
      />

      <Card
        title="Price history"
        description="The ten most recent computations. Rows are closed rather than overwritten, so this is evidence rather than a log."
      >
        {historyRows.length === 0 ? (
          <p className="text-sm text-muted">
            No price has ever been computed for this product
            {costs.available ? "" : " as far as this session can see"}.
          </p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Computed</Th>
                <Th align="right">Customer price</Th>
                <Th align="right">Supplier cost</Th>
                <Th align="right">Margin</Th>
                <Th>Engine</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((row) => {
                const rowCurrency = currency;
                const customerPrice = Number(row.customer_price_minor);
                const margin = Number(row.margin_minor);
                const relation = row.pricing_rules as
                  | { name?: string }
                  | Array<{ name?: string }>
                  | null;
                const ruleName = Array.isArray(relation)
                  ? (relation[0]?.name ?? null)
                  : (relation?.name ?? null);

                return (
                  <tr key={row.id as string}>
                    <Td mono>{formatDateTime(row.computed_at as string)}</Td>
                    <Td align="right" mono>
                      {formatMoney(customerPrice, rowCurrency)}
                      {ruleName && (
                        <span className="block text-[10px] text-dim">rule: {ruleName}</span>
                      )}
                      {!ruleName && (
                        <span className="block text-[10px] text-dim">from base price</span>
                      )}
                    </Td>
                    <Td align="right" mono>
                      {formatMoney(Number(row.supplier_cost_minor), rowCurrency)}
                    </Td>
                    <Td align="right" mono>
                      <span className={margin < 0 ? "text-bad" : "text-ink"}>
                        {formatMoney(margin, rowCurrency)}
                      </span>
                      <span className="block text-[10px] text-dim">
                        {formatPercent(marginPercent(margin, customerPrice))}
                      </span>
                    </Td>
                    <Td mono>
                      <span className="text-dim">{row.engine_version as string}</span>
                    </Td>
                    <Td>
                      {row.valid_to === null ? (
                        <Badge label="Current" tone="ok" />
                      ) : (
                        <Badge label="Superseded" tone="neutral" />
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
