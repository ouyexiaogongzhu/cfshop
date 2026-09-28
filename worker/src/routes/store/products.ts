import { Hono } from "hono";
import {
  getActiveProductBySlug,
  listActiveProducts,
  listProductVariants,
  parseOptions,
  searchProducts,
} from "../../domains/product/queries";
import { jsonError } from "../../lib/errors";

export const productRoutes = new Hono<{ Bindings: Env }>();

function withImageUrl<T extends { imageKey: string | null }>(row: T) {
  const { imageKey, ...rest } = row;
  return {
    ...rest,
    imageKey,
    imageUrl: imageKey ? `/api/media/${imageKey}` : null,
  };
}

// Active products with cheapest USD price (integer cents) + category label.
productRoutes.get("/products", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const category = c.req.query("category")?.trim() || null;
  const results = await listActiveProducts(c.env.DB, limit, offset, category);
  return c.json(results.map(withImageUrl));
});

productRoutes.get("/products/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  const results = await searchProducts(c.env.DB, q, limit);
  return c.json(results.map(withImageUrl));
});

productRoutes.get("/products/:slug", async (c) => {
  const product = await getActiveProductBySlug(c.env.DB, c.req.param("slug"));
  if (!product) return jsonError(c, 404, "not_found");

  const rows = await listProductVariants(c.env.DB, product.id);
  const variants = rows.map((v) => ({
    id: v.id,
    sku: v.sku,
    options: parseOptions(v.options),
    currency: v.currency,
    amount: v.amount,
    available: Number(v.available) || 0,
  }));
  return c.json({ ...withImageUrl(product), variants });
});
