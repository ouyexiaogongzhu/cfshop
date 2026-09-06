import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CartDO } from "./durable-objects/cart";
import { InventoryDO } from "./durable-objects/inventory";

export { CartDO, InventoryDO };

const app = new Hono<{ Bindings: Env }>();

// Request logging: method, path, status, ms.
app.use(async (c, next) => {
  const start = performance.now();
  await next();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    })
  );
});

app.onError((err, c) => {
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  if (status >= 500) {
    console.error(
      JSON.stringify({ level: "error", msg: "unhandled", path: c.req.path, error: String(err) })
    );
  }
  return c.json(
    { error: err instanceof Error ? err.message : "internal_error" },
    status as ContentfulStatusCode
  );
});

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

// One query: active products with their cheapest USD price (integer cents).
app.get("/api/store/products", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.title, MIN(pr.amount) AS price
     FROM products p
     JOIN product_variants v ON v.product_id = p.id
     JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
     WHERE p.status = 'active'
     GROUP BY p.id
     ORDER BY p.created_at
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all<{ id: string; slug: string; title: string; price: number }>();
  return c.json(results);
});

app.get("/api/store/products/:slug", async (c) => {
  const db = c.env.DB;
  const product = await db
    .prepare(`SELECT id, slug, title, description FROM products WHERE slug = ? AND status = 'active'`)
    .bind(c.req.param("slug"))
    .first<{ id: string; slug: string; title: string; description: string }>();
  if (!product) return c.json({ error: "not_found" }, 404);

  const { results: variants } = await db
    .prepare(
      `SELECT v.id, v.sku, v.options, pr.currency, pr.amount
       FROM product_variants v
       JOIN prices pr ON pr.variant_id = v.id
       WHERE v.product_id = ?`
    )
    .bind(product.id)
    .all<{ id: string; sku: string; options: string; currency: string; amount: number }>();
  return c.json({ ...product, variants });
});

export default {
  fetch: app.fetch,
  // Scaffold: log and ack. Real handlers (email, fulfillment, outbox drain) come in M3.
  queue: async (batch: MessageBatch<unknown>) => {
    for (const message of batch.messages) {
      console.log(JSON.stringify({ level: "info", msg: "queue_message", body: message.body }));
      message.ack();
    }
  },
};
