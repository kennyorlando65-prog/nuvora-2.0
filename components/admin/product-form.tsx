import {
  PRODUCT_ERRORS,
  type ProductCost,
  type ProductInput,
  type ProductPriceSnapshot,
} from "@/lib/admin/products";

/**
 * The product form, shared by create and edit.
 *
 * A plain <form> posting to a Server Action. No client state, which means the operator can
 * submit, be told exactly what is wrong, and correct it, without any of the catalogue data
 * entering a browser bundle - and without a client-side "is this valid" check pretending to
 * be the authority. The validation that matters runs on the server in `parseProductForm`.
 *
 * CUSTOMER PRICE AND SUPPLIER COST ARE SEPARATE FIELDS AND STAY SEPARATE.
 * The brief asks for the margin to be derived and never hardcoded, and the schema enforces
 * that: `product_prices.margin_minor` has a CHECK that it equals price minus cost. There is
 * therefore no margin field on this form, and there cannot be one - a typed-in margin would
 * have nothing to validate against.
 */

const FIELD = "nuvora-input";

const PRODUCT_LINES: Array<[string, string]> = [
  ["esim", "eSIM"],
  ["topup", "Top-up"],
  ["gift_card", "Gift card"],
  ["game_credit", "Game credit"],
  ["subscription", "Subscription"],
];

const FULFILMENT_MODES: Array<[string, string]> = [
  ["instant_esim", "Instant eSIM profile"],
  ["instant_code", "Instant code or voucher"],
  ["manual", "Manual fulfilment"],
];

const STATUSES: Array<[string, string]> = [
  ["draft", "Draft - not on sale"],
  ["active", "Active - on sale"],
  ["archived", "Archived - withdrawn"],
];

function Label({
  children,
  hint,
  htmlFor,
}: {
  children: React.ReactNode;
  hint?: string;
  htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="nuvora-label">{children}</span>
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  );
}

export function ProductForm({
  action,
  suppliers,
  product,
  cost,
  price,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  suppliers: Array<{ key: string; name: string; mode: string; is_active: boolean }>;
  product?: ProductInput & { id: string };
  cost?: ProductCost | null;
  price?: ProductPriceSnapshot | null;
  submitLabel: string;
}) {
  const minorToInput = (minor: number | null | undefined): string =>
    minor === null || minor === undefined ? "" : (minor / 100).toFixed(2);

  return (
    <form action={action} className="flex flex-col gap-5">
      {product && <input type="hidden" name="product_id" value={product.id} />}

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Identity</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="name">Product name</Label>
            <input
              id="name"
              name="name"
              required
              defaultValue={product?.name ?? ""}
              placeholder="Europe 10GB / 30 days"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="sku" hint="Unique. Letters, digits, dot, underscore, hyphen.">
              SKU
            </Label>
            <input
              id="sku"
              name="sku"
              required
              defaultValue={product?.sku ?? ""}
              placeholder="ESIM-EU-10GB-30D"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="slug" hint="Lower case, used in the storefront URL.">
              Slug
            </Label>
            <input
              id="slug"
              name="slug"
              required
              defaultValue={product?.slug ?? ""}
              placeholder="europe-10gb-30-days"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="product_line">Product line</Label>
            <select
              id="product_line"
              name="product_line"
              defaultValue={product?.productLine ?? "esim"}
              className={FIELD}
            >
              {PRODUCT_LINES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={product?.description ?? ""}
              placeholder="What the customer receives, and any conditions attached to it."
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label
              htmlFor="coverage_regions"
              hint="Comma-separated ISO country codes, or GLOBAL."
            >
              Coverage regions
            </Label>
            <input
              id="coverage_regions"
              name="coverage_regions"
              defaultValue={product?.coverageRegions.join(", ") ?? ""}
              placeholder="GB, FR, DE, ES, IT or GLOBAL"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="attributes" hint="Optional JSON object for line-specific detail.">
              Attributes
            </Label>
            <textarea
              id="attributes"
              name="attributes"
              rows={3}
              defaultValue={
                product && Object.keys(product.attributes).length > 0
                  ? JSON.stringify(product.attributes, null, 2)
                  : ""
              }
              placeholder={'{ "data_gb": 10, "validity_days": 30, "network": "multi" }'}
              className={`${FIELD} font-mono text-xs`}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Pricing and cost</legend>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="currency" hint="Three-letter code.">
              Customer currency
            </Label>
            <input
              id="currency"
              name="currency"
              required
              defaultValue={product?.currency ?? "NGN"}
              className={`${FIELD} uppercase`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="base_price"
              hint="Charge when no margin rule applies. Not a floor over a rule."
            >
              Customer price
            </Label>
            <input
              id="base_price"
              name="base_price"
              required
              inputMode="decimal"
              defaultValue={product ? minorToInput(product.basePriceMinor) : ""}
              placeholder="4500.00"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="supplier_currency">Supplier currency</Label>
            <input
              id="supplier_currency"
              name="supplier_currency"
              defaultValue={product?.supplierCurrency ?? product?.currency ?? "NGN"}
              className={`${FIELD} uppercase`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="supplier_cost"
              hint="What we pay the supplier. Never shown to a customer."
            >
              Supplier cost
            </Label>
            <input
              id="supplier_cost"
              name="supplier_cost"
              required
              inputMode="decimal"
              defaultValue={cost?.supplierCostMinor != null ? minorToInput(cost.supplierCostMinor) : ""}
              placeholder="3800.00"
              className={FIELD}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="supplier_key" hint="The supplier must already be configured.">
              Supplier
            </Label>
            <select
              id="supplier_key"
              name="supplier_key"
              defaultValue={product?.supplierKey ?? ""}
              className={FIELD}
            >
              <option value="">Select a supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.key} value={supplier.key}>
                  {supplier.name} ({supplier.mode}
                  {supplier.is_active ? "" : ", disabled"})
                </option>
              ))}
            </select>
            {suppliers.length === 0 && (
              <span className="text-xs text-accent">
                No suppliers exist yet. Create one on the providers page first - a product
                cannot name a supplier that does not exist.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="supplier_reference" hint="The supplier's own SKU or plan code.">
              Supplier reference
            </Label>
            <input
              id="supplier_reference"
              name="supplier_reference"
              defaultValue={cost?.supplierReference ?? ""}
              placeholder="EU-10GB-30D"
              className={FIELD}
            />
          </div>
        </div>

        {cost?.supplierCostMinor != null && (
          <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-xs text-muted">
            Stored supplier cost:{" "}
            <span className="font-mono text-ink">
              {(cost.supplierCostMinor / 100).toFixed(2)} {cost.supplierCurrency}
            </span>
            . The margin is derived from the customer price minus this figure; it is never
            entered by hand, and the database rejects a price below it.
          </p>
        )}
      </fieldset>

      <fieldset className="nuvora-card flex flex-col gap-4 p-5">
        <legend className="nuvora-label px-1">Delivery and visibility</legend>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="fulfilment_mode">Fulfilment mode</Label>
            <select
              id="fulfilment_mode"
              name="fulfilment_mode"
              defaultValue={product?.fulfilmentMode ?? "instant_esim"}
              className={FIELD}
            >
              {FULFILMENT_MODES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="status"
              hint="Active products are visible to shoppers and can be ordered."
            >
              Status
            </Label>
            <select
              id="status"
              name="status"
              defaultValue={product?.status ?? "draft"}
              className={FIELD}
            >
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {price && (
          <p className="rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-xs text-muted">
            Current computed price:{" "}
            <span className="font-mono text-ink">
              {price.customerPriceMinor === null ? "-" : (price.customerPriceMinor / 100).toFixed(2)}
            </span>
            {price.ruleName ? ` under rule "${price.ruleName}"` : " from the base price (no rule applies)"}.
            {price.marginMinor !== null && (
              <>
                {" "}
                Margin{" "}
                <span className="font-mono text-ink">{(price.marginMinor / 100).toFixed(2)}</span>
                {price.customerPriceMinor ? (
                  <>
                    {" "}
                    (
                    {((price.marginMinor / price.customerPriceMinor) * 100).toFixed(1)}%)
                  </>
                ) : null}
                .
              </>
            )}
          </p>
        )}

        <p className="text-xs text-dim">
          Saving recomputes the price through the same engine checkout uses, and writes a new
          price snapshot. A product whose price cannot be computed is demoted to draft rather
          than left on sale with a price the store cannot honour.
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="nuvora-btn nuvora-btn-primary"
        >
          {submitLabel}
        </button>
        <span className="text-xs text-dim">
          Every field is re-validated on the server. Nothing on this form is trusted.
        </span>
      </div>
    </form>
  );
}

/** Error and notice banners, driven by the short codes the actions return. */
export function ProductMessages({ error, notice }: { error?: string; notice?: string }) {
  const errorText = error ? (PRODUCT_ERRORS[error] ?? "The change was refused.") : "";

  const noticeText =
    notice === "created"
      ? "Product created and its price computed."
      : notice === "updated"
        ? "Product saved and its price recomputed."
        : notice === "status"
          ? "Status changed."
          : "";

  return (
    <>
      {errorText && (
        <p
          role="alert"
          className="rounded-[var(--radius-card)] border border-bad/40 bg-panel px-4 py-3 text-sm text-ink"
        >
          {errorText}
        </p>
      )}
      {noticeText && (
        <p
          role="status"
          className="rounded-[var(--radius-card)] border border-ok/40 bg-panel px-4 py-3 text-sm text-muted"
        >
          {noticeText}
        </p>
      )}
    </>
  );
}
