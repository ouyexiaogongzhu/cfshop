import { Hono } from "hono";
import {
  getActiveProductBySlug,
  listActiveProducts,
  listProductVariants,
  parseOptions,
} from "../../domains/product/queries";
import { jsonError } from "../../lib/errors";

export const productRoutes = new Hono<{ Bindings: Env }>();

// Active products with cheapest USD price (integer cents) + category label.
productRoutes.get("/products", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const results = await listActiveProducts(c.env.DB, limit, offset);
  return c.json(results);
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
  }));
  return c.json({ ...product, variants });
});
