export type ProductListItem = {
  id: string;
  slug: string;
  title: string;
  price: number;
  category: string;
};

export type ProductVariantRow = {
  id: string;
  sku: string;
  options: string;
  currency: string;
  amount: number;
};

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
};

/** First linked category name, or `"Goods"` when the product has none. */
const CATEGORY_EXPR = `COALESCE(
  (SELECT c.name
   FROM product_categories pc
   JOIN categories c ON c.id = pc.category_id
   WHERE pc.product_id = p.id
   ORDER BY c.name
   LIMIT 1),
  'Goods'
)`;

/** Active products with cheapest USD price (integer cents) and category label. */
export async function listActiveProducts(
  db: D1Database,
  limit: number,
  offset: number
): Promise<ProductListItem[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, MIN(pr.amount) AS price, ${CATEGORY_EXPR} AS category
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
       WHERE p.status = 'active'
       GROUP BY p.id
       ORDER BY p.created_at
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<ProductListItem>();
  return results ?? [];
}

/** Active product by slug, including category label. */
export async function getActiveProductBySlug(
  db: D1Database,
  slug: string
): Promise<ProductDetail | null> {
  return db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.description, ${CATEGORY_EXPR} AS category
       FROM products p
       WHERE p.slug = ? AND p.status = 'active'`
    )
    .bind(slug)
    .first<ProductDetail>();
}

/** Variants + prices for a product (all currencies). */
export async function listProductVariants(
  db: D1Database,
  productId: string
): Promise<ProductVariantRow[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.sku, v.options, pr.currency, pr.amount
       FROM product_variants v
       JOIN prices pr ON pr.variant_id = v.id
       WHERE v.product_id = ?`
    )
    .bind(productId)
    .all<ProductVariantRow>();
  return results ?? [];
}

/** Parse SQLite JSON `options` into an object when valid. */
export function parseOptions(raw: string): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // keep raw string
  }
  return raw;
}
