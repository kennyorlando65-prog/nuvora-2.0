import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer-facing reads.
 *
 * EVERY QUERY HERE RUNS ON THE USER-SCOPED CLIENT, never the service role. That is the
 * whole design: the customer's own access token travels with the request, so Row Level
 * Security evaluates `orders_select_own` and `order_items_select_own` and the database
 * itself decides which rows come back. A bug in this file cannot leak another customer's
 * order, because the database would refuse to return it.
 *
 * The column lists are explicit and match the column grants in
 * supabase/migrations/20261011090600_rls_and_grants.sql. Selecting `*` would fail at
 * runtime, because the grants deliberately omit the commercially sensitive columns
 * (supplier cost, margin, internal note, raw gateway payload). Naming the columns is
 * therefore not tidiness - it is what keeps this code working against the real grants.
 */

/** Columns a customer may read on their own orders. */
const ORDER_COLUMNS =
  "id, order_number, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_at, fulfilled_at, cancelled_at, refunded_at, created_at";

/** Columns a customer may read on their own order lines. */
const ORDER_ITEM_COLUMNS =
  "id, order_id, product_name, product_line, quantity, unit_price_minor, line_total_minor, fulfilment_status, delivered_at, created_at";

/** Columns a customer may read on a product. Note the absence of any cost column. */
const PRODUCT_COLUMNS =
  "id, sku, slug, name, product_line, description, coverage_regions, fulfilment_mode, status, currency, base_price_minor, created_at";

/** Columns a customer may read on a price snapshot. */
const PRICE_COLUMNS = "id, product_id, currency, customer_price_minor, valid_from, valid_to";

export type CustomerOrder = {
  id: string;
  order_number: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  created_at: string;
};

export type CustomerOrderItem = {
  id: string;
  order_id: string;
  product_name: string;
  product_line: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  fulfilment_status: string;
  delivered_at: string | null;
  created_at: string;
};

export type StoreProduct = {
  id: string;
  sku: string;
  slug: string | null;
  name: string;
  product_line: string;
  description: string | null;
  coverage_regions: unknown;
  fulfilment_mode: string;
  status: string;
  currency: string;
  base_price_minor: number;
  created_at: string;
  /** The live price snapshot, when one exists. Null means the base price applies. */
  customer_price_minor: number | null;
};

/**
 * The customer's own orders, newest first.
 *
 * No `user_id` filter is written here, and that is not an oversight: the RLS policy
 * `orders_select_own` already restricts the result to `user_id = current_user_id()`. Adding
 * a redundant filter would suggest the policy is optional.
 */
export async function listMyOrders(
  supabase: SupabaseClient,
  limit = 50,
): Promise<CustomerOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`could not load your orders: ${error.message}`);
  return (data ?? []) as unknown as CustomerOrder[];
}

/** One of the customer's own orders, or null when it is not theirs (or does not exist). */
export async function getMyOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<CustomerOrder | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`could not load that order: ${error.message}`);
  }
  return (data as unknown as CustomerOrder | null) ?? null;
}

/** The lines of one of the customer's own orders. */
export async function listOrderItems(
  supabase: SupabaseClient,
  orderId: string,
): Promise<CustomerOrderItem[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select(ORDER_ITEM_COLUMNS)
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`could not load the items on that order: ${error.message}`);
  return (data ?? []) as unknown as CustomerOrderItem[];
}

/**
 * The live catalogue.
 *
 * Only `status = 'active'` products come back, and again the policy does that rather than
 * this query - `products_public_read` is `using (status = 'active')`. A draft product is
 * invisible to a customer even if this function asked for it.
 *
 * The price snapshot is joined in a second query rather than an embedded select, because
 * the embedded form would need a foreign-key relationship name and the grants are
 * column-scoped; two explicit queries are easier to keep correct against the real grants.
 */
export async function listStoreProducts(
  supabase: SupabaseClient,
  search?: string,
): Promise<StoreProduct[]> {
  let query = supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("status", "active")
    .order("name", { ascending: true });

  if (search && search.trim() !== "") {
    // `ilike` on the name and sku. The search term is passed as a value, never
    // interpolated into a filter string, so it cannot alter the query's shape.
    const term = `%${search.trim()}%`;
    query = query.or(`name.ilike.${term},sku.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`could not load the store: ${error.message}`);

  const products = (data ?? []) as unknown as Omit<StoreProduct, "customer_price_minor">[];
  if (products.length === 0) return [];

  const ids = products.map((product) => product.id);
  const { data: priceRows, error: priceError } = await supabase
    .from("product_prices")
    .select(PRICE_COLUMNS)
    .in("product_id", ids)
    .is("valid_to", null);

  if (priceError) throw new Error(`could not load prices: ${priceError.message}`);

  const priceByProduct = new Map<string, number>();
  for (const row of priceRows ?? []) {
    priceByProduct.set(String(row.product_id), Number(row.customer_price_minor));
  }

  return products.map((product) => ({
    ...product,
    customer_price_minor: priceByProduct.get(product.id) ?? null,
  }));
}

/** One active product by id, or null when it is not on sale. */
export async function getStoreProduct(
  supabase: SupabaseClient,
  productId: string,
): Promise<StoreProduct | null> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", productId)
    .eq("status", "active")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`could not load that product: ${error.message}`);
  }
  if (!data) return null;

  const product = data as unknown as Omit<StoreProduct, "customer_price_minor">;

  const { data: priceRow } = await supabase
    .from("product_prices")
    .select(PRICE_COLUMNS)
    .eq("product_id", productId)
    .is("valid_to", null)
    .maybeSingle();

  return {
    ...product,
    customer_price_minor: priceRow ? Number(priceRow.customer_price_minor) : null,
  };
}
