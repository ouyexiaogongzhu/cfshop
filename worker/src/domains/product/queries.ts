import { sanitizeFtsQuery } from "../../lib/fts";

export type ProductListItem = {
  id: string;
  slug: string;
  title: string;
  price: number;
  category: string;
  imageKey: string | null;
};

export type ProductVariantRow = {
  id: string;
  sku: string;
  options: string;
  currency: string;
  amount: number;
  available: number;
};

export type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  imageKey: string | null;
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
  offset: number,
  category?: string | null
): Promise<ProductListItem[]> {
  const categoryFilter = category?.trim();
  const { results } = await db
    .prepare(
      categoryFilter
        ? `SELECT p.id, p.slug, p.title, p.image_key AS imageKey, MIN(pr.amount) AS price, ${CATEGORY_EXPR} AS category
           FROM products p
           JOIN product_variants v ON v.product_id = p.id
           JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
           WHERE p.status = 'active' AND ${CATEGORY_EXPR} = ?
           GROUP BY p.id
           ORDER BY p.created_at
           LIMIT ? OFFSET ?`
        : `SELECT p.id, p.slug, p.title, p.image_key AS imageKey, MIN(pr.amount) AS price, ${CATEGORY_EXPR} AS category
           FROM products p
           JOIN product_variants v ON v.product_id = p.id
           JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
           WHERE p.status = 'active'
           GROUP BY p.id
           ORDER BY p.created_at
           LIMIT ? OFFSET ?`
    )
    .bind(...(categoryFilter ? [categoryFilter, limit, offset] : [limit, offset]))
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
      `SELECT p.id, p.slug, p.title, p.description, p.image_key AS imageKey, ${CATEGORY_EXPR} AS category
       FROM products p
       WHERE p.slug = ? AND p.status = 'active'`
    )
    .bind(slug)
    .first<ProductDetail>();
}

/** Active products matching an FTS5 query (prefix tokens). Empty/invalid q → []. */
export async function searchProducts(
  db: D1Database,
  q: string,
  limit: number
): Promise<ProductListItem[]> {
  const match = sanitizeFtsQuery(q);
  if (!match) return [];

  const { results } = await db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.image_key AS imageKey, MIN(pr.amount) AS price, ${CATEGORY_EXPR} AS category
       FROM products p
       JOIN products_fts ON products_fts.rowid = p.rowid
       JOIN product_variants v ON v.product_id = p.id
       JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
       WHERE p.status = 'active' AND products_fts MATCH ?
       GROUP BY p.id
       ORDER BY p.created_at
       LIMIT ?`
    )
    .bind(match, limit)
    .all<ProductListItem>();
  return results ?? [];
}

/** Variants + prices + stock for a product (all currencies). */
export async function listProductVariants(
  db: D1Database,
  productId: string
): Promise<ProductVariantRow[]> {
  const { results } = await db
    .prepare(
      `SELECT v.id, v.sku, v.options, pr.currency, pr.amount,
              COALESCE(i.available, 0) AS available
       FROM product_variants v
       JOIN prices pr ON pr.variant_id = v.id
       LEFT JOIN inventory i ON i.variant_id = v.id
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
