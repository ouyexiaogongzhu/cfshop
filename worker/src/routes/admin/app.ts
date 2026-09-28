import { Hono } from "hono";
import { requireAdmin } from "../../lib/admin";
import { reconcileInventoryDoAvailable } from "../../lib/inventory-do";

declare global {
  interface Env {
    ADMIN_TOKEN: string;
  }
}

/** Operator API. Mounted at /api/admin. */
export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.use("*", requireAdmin);

type ProductStatus = "draft" | "active" | "archived";

type CreateVariant = {
  sku: string;
  options: Record<string, unknown>;
  price: number;
  available: number;
};

type CreateProduct = {
  title: string;
  slug: string;
  description: string;
  status: ProductStatus;
  variants: CreateVariant[];
};

type ProductRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: ProductStatus;
  image_key: string | null;
};

type AdminProductListRow = {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  image_key: string | null;
  updated_at: string;
};

type AdminVariantRow = {
  id: string;
  product_id: string;
  sku: string;
  available: number | null;
};

type OrderRow = {
  id: string;
  email: string;
  status: string;
  currency: string;
  subtotal: number;
  shipping_amount: number;
  tax: number;
  total: number;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isProductStatus(value: unknown): value is ProductStatus {
  return value === "draft" || value === "active" || value === "archived";
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? `${err.message} ${errorCause(err.cause)}` : String(err);
  return message.includes("UNIQUE constraint failed");
}

function errorCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.message} ${errorCause(cause.cause)}`;
  return cause === undefined ? "" : String(cause);
}

async function readJson(request: Request): Promise<unknown> {
  return request.json();
}

function parseCreateProduct(body: unknown): CreateProduct | "bad_request" {
  if (!isRecord(body)) return "bad_request";
  const title = body.title;
  const slug = body.slug;
  const description = body.description;
  const status = body.status;
  const variants = body.variants;
  if (typeof title !== "string" || title.length === 0) return "bad_request";
  if (typeof slug !== "string" || slug.length === 0) return "bad_request";
  if (description !== undefined && typeof description !== "string") return "bad_request";
  if (status !== undefined && !isProductStatus(status)) return "bad_request";
  if (!Array.isArray(variants) || variants.length === 0) return "bad_request";

  const parsed: CreateVariant[] = [];
  for (const item of variants) {
    if (!isRecord(item)) return "bad_request";
    if (typeof item.sku !== "string" || item.sku.length === 0) return "bad_request";
    if (!isInteger(item.price) || item.price < 0) return "bad_request";
    if (item.available !== undefined && (!isInteger(item.available) || item.available < 0)) {
      return "bad_request";
    }
    if (item.options !== undefined && !isRecord(item.options)) return "bad_request";
    parsed.push({
      sku: item.sku,
      options: item.options === undefined ? {} : item.options,
      price: item.price,
      available: item.available === undefined ? 0 : item.available,
    });
  }

  return {
    title,
    slug,
    description: typeof description === "string" ? description : "",
    status: status === undefined ? "draft" : status,
    variants: parsed,
  };
}

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

adminRoutes.get("/products", async (c) => {
  const limit = pageLimit(c.req.query("limit"));
  const offset = pageOffset(c.req.query("offset"));
  const db = c.env.DB;
  const { results: products } = await db
    .prepare(
      `SELECT id, slug, title, status, image_key, updated_at
       FROM products
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all<AdminProductListRow>();

  const ids = (products ?? []).map((p) => p.id);
  let variants: AdminVariantRow[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT v.id, v.product_id, v.sku, i.available
         FROM product_variants v
         LEFT JOIN inventory i ON i.variant_id = v.id
         WHERE v.product_id IN (${placeholders})
         ORDER BY v.sku`
      )
      .bind(...ids)
      .all<AdminVariantRow>();
    variants = results ?? [];
  }

  const byProduct = new Map<string, AdminVariantRow[]>();
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push(v);
    byProduct.set(v.product_id, list);
  }

  return c.json(
    (products ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      imageKey: p.image_key,
      imageUrl: p.image_key ? `/api/media/${p.image_key}` : null,
      updatedAt: p.updated_at,
      variants: (byProduct.get(p.id) ?? []).map((v) => ({
        id: v.id,
        sku: v.sku,
        available: v.available ?? 0,
      })),
    }))
  );
});

adminRoutes.post("/products", async (c) => {
  let body: unknown;
  try {
    body = await readJson(c.req.raw);
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const parsed = parseCreateProduct(body);
  if (parsed === "bad_request") return c.json({ error: "bad_request" }, 400);

  const db = c.env.DB;
  const productId = crypto.randomUUID();
  const seededVariants: Array<{ id: string; available: number }> = [];
  const statements = [
    db
      .prepare(
        `INSERT INTO products (id, title, slug, description, status)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(productId, parsed.title, parsed.slug, parsed.description, parsed.status),
  ];

  for (const variant of parsed.variants) {
    const variantId = crypto.randomUUID();
    const priceId = crypto.randomUUID();
    seededVariants.push({ id: variantId, available: variant.available });
    statements.push(
      db
        .prepare(
          `INSERT INTO product_variants (id, product_id, sku, options)
           VALUES (?, ?, ?, ?)`
        )
        .bind(variantId, productId, variant.sku, JSON.stringify(variant.options)),
      db
        .prepare(
          `INSERT INTO prices (id, variant_id, currency, amount)
           VALUES (?, ?, 'usd', ?)`
        )
        .bind(priceId, variantId, variant.price),
      db
        .prepare(`INSERT INTO inventory (variant_id, available) VALUES (?, ?)`)
        .bind(variantId, variant.available)
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: "conflict" }, 409);
    throw err;
  }

  for (const variant of seededVariants) {
    await reconcileInventoryDoAvailable(c.env, variant.id, variant.available);
  }

  return c.json({ id: productId, slug: parsed.slug }, 201);
});

adminRoutes.patch("/products/:id", async (c) => {
  let body: unknown;
  try {
    body = await readJson(c.req.raw);
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "bad_request" }, 400);

  const title = body.title;
  const description = body.description;
  const status = body.status;
  const imageKey = body.imageKey;
  if (title !== undefined && (typeof title !== "string" || title.length === 0)) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (description !== undefined && typeof description !== "string") {
    return c.json({ error: "bad_request" }, 400);
  }
  if (status !== undefined && !isProductStatus(status)) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (
    imageKey !== undefined &&
    imageKey !== null &&
    (typeof imageKey !== "string" ||
      imageKey.includes("..") ||
      !/^products\/[a-zA-Z0-9._/-]+\.(png|jpe?g|webp)$/i.test(imageKey))
  ) {
    return c.json({ error: "bad_request" }, 400);
  }

  const id = c.req.param("id");
  const db = c.env.DB;
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof title === "string") {
    sets.push("title = ?");
    binds.push(title);
  }
  if (typeof description === "string") {
    sets.push("description = ?");
    binds.push(description);
  }
  if (isProductStatus(status)) {
    sets.push("status = ?");
    binds.push(status);
  }
  if (imageKey === null) {
    sets.push("image_key = NULL");
  } else if (typeof imageKey === "string") {
    sets.push("image_key = ?");
    binds.push(imageKey);
  }

  if (sets.length === 0) {
    const row = await db
      .prepare(
        `SELECT id, slug, title, description, status, image_key FROM products WHERE id = ?`
      )
      .bind(id)
      .first<ProductRow>();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      status: row.status,
      imageKey: row.image_key,
    });
  }

  sets.push("updated_at = datetime('now')");
  const row = await db
    .prepare(
      `UPDATE products SET ${sets.join(", ")} WHERE id = ?
       RETURNING id, slug, title, description, status, image_key`
    )
    .bind(...binds, id)
    .first<ProductRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status,
    imageKey: row.image_key,
  });
});

adminRoutes.post("/media", async (c) => {
  const contentType = c.req.header("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return c.json({ error: "bad_request" }, 400);
  }

  const form = await c.req.parseBody();
  const file = form.file;
  const keyField = form.key;
  if (!(file instanceof File)) return c.json({ error: "bad_request" }, 400);
  if (typeof keyField !== "string" || !keyField) return c.json({ error: "bad_request" }, 400);

  const key = keyField.replace(/^\/+/, "");
  if (key.includes("..") || !/^products\/[a-zA-Z0-9._/-]+\.(png|jpe?g|webp)$/i.test(key)) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (file.size > 2_000_000) return c.json({ error: "too_large" }, 413);

  const forcedType = forcedImageType(key);
  if (!forcedType) return c.json({ error: "bad_request" }, 400);

  await c.env.MEDIA.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: forcedType },
  });

  return c.json({ key, imageUrl: `/api/media/${key}` }, 201);
});

function forcedImageType(key: string): string | null {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

adminRoutes.post("/inventory/:variantId", async (c) => {
  let body: unknown;
  try {
    body = await readJson(c.req.raw);
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "bad_request" }, 400);

  const hasAvailable = Object.prototype.hasOwnProperty.call(body, "available");
  const hasDelta = Object.prototype.hasOwnProperty.call(body, "delta");
  if (hasAvailable === hasDelta) return c.json({ error: "bad_request" }, 400);
  if (hasAvailable && !isInteger(body.available)) return c.json({ error: "bad_request" }, 400);
  if (hasDelta && !isInteger(body.delta)) return c.json({ error: "bad_request" }, 400);

  const variantId = c.req.param("variantId");
  const db = c.env.DB;
  const variant = await db
    .prepare(`SELECT id FROM product_variants WHERE id = ?`)
    .bind(variantId)
    .first<{ id: string }>();
  if (!variant) return c.json({ error: "not_found" }, 404);

  const currentRow = await db
    .prepare(`SELECT available FROM inventory WHERE variant_id = ?`)
    .bind(variantId)
    .first<{ available: number }>();
  const current = currentRow?.available ?? 0;
  const next = hasAvailable ? (body.available as number) : current + (body.delta as number);
  const delta = next - current;
  if (next < 0) return c.json({ error: "negative_stock" }, 400);

  await db.batch([
    db
      .prepare(
        `INSERT INTO inventory (variant_id, available, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(variant_id) DO UPDATE SET
           available = excluded.available,
           updated_at = datetime('now')`
      )
      .bind(variantId, next),
    db
      .prepare(
        `INSERT INTO inventory_movements (id, variant_id, delta, reason)
         VALUES (?, ?, ?, 'admin_adjust')`
      )
      .bind(crypto.randomUUID(), variantId, delta),
  ]);

  await reconcileInventoryDoAvailable(c.env, variantId, next);

  return c.json({ variantId, available: next });
});

adminRoutes.get("/orders", async (c) => {
  const limit = pageLimit(c.req.query("limit"));
  const offset = pageOffset(c.req.query("offset"));
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, status, currency, subtotal, shipping_amount, tax, total, created_at
     FROM orders
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all<OrderRow>();

  return c.json(
    results.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
      currency: row.currency,
      subtotal: row.subtotal,
      shippingAmount: row.shipping_amount,
      tax: row.tax,
      total: row.total,
      createdAt: row.created_at,
    }))
  );
});

adminRoutes.get("/orders/:id", async (c) => {
  const orderId = c.req.param("id");
  const order = await c.env.DB.prepare(
    `SELECT id, email, status, currency, subtotal, shipping_amount, tax, total, created_at, address_json
     FROM orders WHERE id = ?`
  )
    .bind(orderId)
    .first<OrderRow & { address_json: string | null }>();
  if (!order) return c.json({ error: "not_found" }, 404);

  const { results: items } = await c.env.DB.prepare(
    `SELECT variant_id, title, qty, unit_amount FROM order_items WHERE order_id = ? ORDER BY rowid`
  )
    .bind(orderId)
    .all<{ variant_id: string; title: string; qty: number; unit_amount: number }>();

  const shipment = await c.env.DB.prepare(
    `SELECT tracking_number, carrier FROM shipments WHERE order_id = ?`
  )
    .bind(orderId)
    .first<{ tracking_number: string; carrier: string }>();

  let address: Record<string, unknown> | null = null;
  if (order.address_json) {
    try {
      const parsed: unknown = JSON.parse(order.address_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        address = parsed as Record<string, unknown>;
      }
    } catch {
      address = null;
    }
  }

  return c.json({
    id: order.id,
    email: order.email,
    status: order.status,
    currency: order.currency,
    subtotal: order.subtotal,
    shippingAmount: order.shipping_amount,
    tax: order.tax,
    total: order.total,
    createdAt: order.created_at,
    address,
    shipment: shipment
      ? { trackingNumber: shipment.tracking_number, carrier: shipment.carrier }
      : null,
    lines: (items ?? []).map((row) => ({
      variantId: row.variant_id,
      title: row.title,
      qty: row.qty,
      unitAmount: row.unit_amount,
      lineTotal: row.qty * row.unit_amount,
    })),
  });
});

adminRoutes.post("/orders/:id/shipments", async (c) => {
  let body: unknown;
  try {
    body = await readJson(c.req.raw);
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "bad_request" }, 400);
  if (typeof body.trackingNumber !== "string" || body.trackingNumber.length === 0) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (body.carrier !== undefined && typeof body.carrier !== "string") {
    return c.json({ error: "bad_request" }, 400);
  }

  const orderId = c.req.param("id");
  const trackingNumber = body.trackingNumber;
  const carrier = typeof body.carrier === "string" ? body.carrier : "";
  const db = c.env.DB;

  const order = await db
    .prepare(`SELECT id, status FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{ id: string; status: string }>();
  if (!order) return c.json({ error: "not_found" }, 404);
  if (order.status === "refunded") return c.json({ error: "refunded" }, 409);

  const existing = await db
    .prepare(`SELECT id FROM shipments WHERE order_id = ?`)
    .bind(orderId)
    .first<{ id: string }>();
  const shipmentId = existing?.id ?? crypto.randomUUID();

  const writeShipment = existing
    ? db
        .prepare(`UPDATE shipments SET tracking_number = ?, carrier = ? WHERE order_id = ?`)
        .bind(trackingNumber, carrier, orderId)
    : db
        .prepare(
          `INSERT INTO shipments (id, order_id, tracking_number, carrier)
           VALUES (?, ?, ?, ?)`
        )
        .bind(shipmentId, orderId, trackingNumber, carrier);

  await db.batch([
    writeShipment,
    db.prepare(`UPDATE orders SET status = 'shipped' WHERE id = ? AND status != 'refunded'`).bind(orderId),
  ]);

  return c.json(
    { id: shipmentId, orderId, trackingNumber, carrier, status: "shipped" as const },
    201
  );
});
