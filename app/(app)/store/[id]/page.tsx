import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, PageHeader, Pill } from "@/components/app/ui";
import { CheckoutForm } from "@/components/app/checkout-form";
import { requireUser } from "@/lib/app/session";
import { getStoreProduct } from "@/lib/app/queries";
import { PRODUCT_LINE_LABELS, formatMoney, labelOf } from "@/lib/admin/format";

export const metadata: Metadata = { title: "Product" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One product, with the buy control.
 *
 * The price shown here is for DISPLAY ONLY. The checkout route recomputes it from the
 * database and ignores anything the browser sends, so this page cannot be used to change
 * what an order costs - it can only be used to decide whether to place one.
 */
export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const { supabase, user } = await requireUser(`/store/${id}`);
  const product = await getStoreProduct(supabase, id);

  if (!product) notFound();

  const price = product.customer_price_minor ?? Number(product.base_price_minor);
  const regions = Array.isArray(product.coverage_regions)
    ? (product.coverage_regions as unknown[]).filter(
        (region): region is string => typeof region === "string",
      )
    : [];

  return (
    <>
      <Link href="/store" className="text-xs text-muted underline hover:text-accent">
        Back to the store
      </Link>

      <PageHeader
        label={product.sku}
        title={product.name}
        description={product.description ?? undefined}
        actions={<Pill label={labelOf(PRODUCT_LINE_LABELS, product.product_line)} tone="info" />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-4">
          <Card title="What you are buying">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="nuvora-label">Product line</dt>
                <dd className="mt-1 text-sm text-ink">
                  {labelOf(PRODUCT_LINE_LABELS, product.product_line)}
                </dd>
              </div>
              <div>
                <dt className="nuvora-label">Delivery</dt>
                <dd className="mt-1 text-sm text-ink">
                  {product.fulfilment_mode === "automatic"
                    ? "Automatic, as soon as payment is confirmed"
                    : "Handled by our team after payment"}
                </dd>
              </div>
              <div>
                <dt className="nuvora-label">Currency</dt>
                <dd className="mt-1 font-mono text-sm text-ink">{product.currency}</dd>
              </div>
              <div>
                <dt className="nuvora-label">Coverage</dt>
                <dd className="mt-1 text-sm text-ink">
                  {regions.length > 0 ? regions.join(", ") : "Not region-restricted"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Before you pay">
            <ul className="flex flex-col gap-2 text-xs leading-relaxed text-muted">
              <li>
                The price is recalculated on our server at checkout. What you see here is
                what you will be charged.
              </li>
              <li>
                Payment goes to the payment gateway directly. NUVORA holds no balance for
                you and there is nothing to top up.
              </li>
              <li>
                Delivery is digital. Once the gateway confirms payment, the supplier issues
                your code and it appears on your order page.
              </li>
              <li>
                Refunds are governed by the Refund &amp; Cancellation policy, which is a
                working draft pending legal review.
              </li>
            </ul>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card title="Place an order">
            <p className="nuvora-label">Price each</p>
            <p className="font-mono text-2xl font-semibold text-ink">
              {formatMoney(price, product.currency)}
            </p>
            <div className="mt-4">
              <CheckoutForm
                productId={product.id}
                productName={product.name}
                unitPriceMinor={price}
                currency={product.currency}
                accountEmail={user.email ?? ""}
                emailConfirmed={Boolean(user.email_confirmed_at)}
              />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
