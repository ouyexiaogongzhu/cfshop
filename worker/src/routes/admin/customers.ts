import { Hono } from "hono";

type CustomerAgg = {
  email: string;
  order_count: number;
  total_spent: number;
  last_order_at: string;
};

type CustomerOrder = {
  id: string;
  status: string;
  currency: string;
  subtotal: number;
  shipping_amount: number;
  tax: number;
  total: number;
  discount_code: string | null;
  discount_amount: number;
  created_at: string;
};

function pageLimit(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 20;
  return Math.min(n, 100);
}

function pageOffset(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return n;
}

export const customerRoutes = new Hono<{ Bindings: Env }>();

customerRoutes.get("/customers", async (c) => {
  const limit = pageLimit(c.req.query("limit"));
  const offset = pageOffset(c.req.query("offset"));
  const search = c.req.query("search")?.trim().toLowerCase() ?? "";

  const { results } = await c.env.DB.prepare(
    search
      ? `SELECT email,
                COUNT(*) AS order_count,
                SUM(total) AS total_spent,
                MAX(created_at) AS last_order_at
         FROM orders
         WHERE lower(email) LIKE ?
         GROUP BY lower(email)
         ORDER BY last_order_at DESC
         LIMIT ? OFFSET ?`
      : `SELECT email,
                COUNT(*) AS order_count,
                SUM(total) AS total_spent,
                MAX(created_at) AS last_order_at
         FROM orders
         GROUP BY lower(email)
         ORDER BY last_order_at DESC
         LIMIT ? OFFSET ?`
  )
    .bind(...(search ? [`%${search}%`, limit, offset] : [limit, offset]))
    .all<CustomerAgg>();

  return c.json(
    (results ?? []).map((row) => ({
      email: row.email,
      orderCount: Number(row.order_count),
      totalSpent: Number(row.total_spent),
      lastOrderAt: row.last_order_at,
    }))
  );
});

customerRoutes.get("/customers/:email/orders", async (c) => {
  const email = decodeURIComponent(c.req.param("email")).trim().toLowerCase();
  if (!email) return c.json({ error: "bad_request" }, 400);

  const limit = pageLimit(c.req.query("limit"));
  const offset = pageOffset(c.req.query("offset"));

  const { results } = await c.env.DB.prepare(
    `SELECT id, status, currency, subtotal, shipping_amount, tax, total,
            discount_code, discount_amount, created_at
     FROM orders
     WHERE lower(email) = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(email, limit, offset)
    .all<CustomerOrder>();

  return c.json(
    (results ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      currency: row.currency,
      subtotal: Number(row.subtotal),
      shippingAmount: Number(row.shipping_amount),
      tax: Number(row.tax),
      total: Number(row.total),
      discountCode: row.discount_code,
      discountAmount: Number(row.discount_amount ?? 0),
      createdAt: row.created_at,
    }))
  );
});
