import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

function admin(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer test-admin");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return SELF.fetch(`https://example.com/api/admin${path}`, { ...init, headers });
}

async function insertOrder(status: string, createdAt: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO orders (id, email, status, currency, subtotal, shipping_amount, tax, total, created_at)
     VALUES (?, ?, ?, 'usd', 2500, 500, 0, 3000, ?)`
  )
    .bind(id, `${id}@example.com`, status, createdAt)
    .run();
  return id;
}

describe("admin auth", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/orders");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for the wrong bearer token", async () => {
    const res = await SELF.fetch("https://example.com/api/admin/products", {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope", slug: "nope", variants: [] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("POST /api/admin/products", () => {
  it("creates an active product that the store can list", async () => {
    const slug = `tee-${crypto.randomUUID()}`;
    const sku = `SKU-${crypto.randomUUID()}`;
    const res = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Heavy Tee",
        slug,
        description: "Cotton",
        status: "active",
        variants: [{ sku, options: { size: "M" }, price: 2500, available: 10 }],
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; slug: string };
    expect(created).toEqual({ id: expect.any(String), slug });

    const list = await SELF.fetch("https://example.com/api/store/products?limit=100");
    expect(list.status).toBe(200);
    const products = (await list.json()) as Array<{
      id: string;
      slug: string;
      title: string;
      price: number;
      category: string;
    }>;
    expect(products.find((product) => product.slug === slug)).toEqual({
      id: created.id,
      slug,
      title: "Heavy Tee",
      price: 2500,
      category: "Goods",
    });

    const stored = await env.DB.prepare(
      `SELECT v.sku, v.options, pr.currency, pr.amount, i.available
       FROM product_variants v
       JOIN prices pr ON pr.variant_id = v.id
       JOIN inventory i ON i.variant_id = v.id
       WHERE v.product_id = ?`
    )
      .bind(created.id)
      .first<{ sku: string; options: string; currency: string; amount: number; available: number }>();
    expect(stored).toEqual({
      sku,
      options: JSON.stringify({ size: "M" }),
      currency: "usd",
      amount: 2500,
      available: 10,
    });
  });

  it("rejects an empty variant list", async () => {
    const res = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Empty",
        slug: `empty-${crypto.randomUUID()}`,
        variants: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the slug is already taken", async () => {
    const slug = `dup-${crypto.randomUUID()}`;
    const first = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "First",
        slug,
        status: "active",
        variants: [{ sku: `A-${crypto.randomUUID()}`, price: 100, available: 1 }],
      }),
    });
    expect(first.status).toBe(201);

    const second = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Second",
        slug,
        variants: [{ sku: `B-${crypto.randomUUID()}`, price: 100, available: 1 }],
      }),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "conflict" });

    const sku = `SKU-${crypto.randomUUID()}`;
    const created = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Has SKU",
        slug: `sku-owner-${crypto.randomUUID()}`,
        variants: [{ sku, price: 100, available: 1 }],
      }),
    });
    expect(created.status).toBe(201);

    const duplicateSku = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Stolen SKU",
        slug: `sku-thief-${crypto.randomUUID()}`,
        variants: [{ sku, price: 100, available: 1 }],
      }),
    });
    expect(duplicateSku.status).toBe(409);
    expect(await duplicateSku.json()).toEqual({ error: "conflict" });

    const leftover = await env.DB.prepare(`SELECT id FROM products WHERE title = 'Stolen SKU'`).first();
    expect(leftover).toBeNull();
  });
});

describe("PATCH /api/admin/products/:id", () => {
  it("updates title and status and returns the product", async () => {
    const slug = `patch-${crypto.randomUUID()}`;
    const createdRes = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Before",
        slug,
        description: "Keep me",
        variants: [{ sku: `P-${crypto.randomUUID()}`, price: 500 }],
      }),
    });
    const created = (await createdRes.json()) as { id: string };

    const res = await admin(`/products/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "After", status: "active" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: created.id,
      slug,
      title: "After",
      description: "Keep me",
      status: "active",
    });
  });

  it("returns 404 for an unknown product", async () => {
    const res = await admin(`/products/${crypto.randomUUID()}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Missing" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/inventory/:variantId", () => {
  it("applies a delta and records an admin adjustment", async () => {
    const sku = `INV-${crypto.randomUUID()}`;
    const createdRes = await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Stocked",
        slug: `stock-${crypto.randomUUID()}`,
        status: "active",
        variants: [{ sku, price: 1000, available: 10 }],
      }),
    });
    expect(createdRes.status).toBe(201);

    const variant = await env.DB.prepare(`SELECT id FROM product_variants WHERE sku = ?`)
      .bind(sku)
      .first<{ id: string }>();
    expect(variant).not.toBeNull();
    const variantId = variant?.id ?? "";

    const res = await admin(`/inventory/${variantId}`, {
      method: "POST",
      body: JSON.stringify({ delta: -3 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ variantId, available: 7 });

    const movement = await env.DB.prepare(
      `SELECT delta, reason FROM inventory_movements WHERE variant_id = ?`
    )
      .bind(variantId)
      .first<{ delta: number; reason: string }>();
    expect(movement).toEqual({ delta: -3, reason: "admin_adjust" });
  });

  it("inserts inventory when the row is missing", async () => {
    const sku = `MISS-${crypto.randomUUID()}`;
    await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Unstocked",
        slug: `unstocked-${crypto.randomUUID()}`,
        variants: [{ sku, price: 100 }],
      }),
    });
    const variant = await env.DB.prepare(`SELECT id FROM product_variants WHERE sku = ?`)
      .bind(sku)
      .first<{ id: string }>();
    const variantId = variant?.id ?? "";
    await env.DB.prepare(`DELETE FROM inventory WHERE variant_id = ?`).bind(variantId).run();

    const res = await admin(`/inventory/${variantId}`, {
      method: "POST",
      body: JSON.stringify({ delta: 4 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ variantId, available: 4 });
  });

  it("rejects a delta that would make stock negative and does not write", async () => {
    const sku = `NEG-${crypto.randomUUID()}`;
    await admin("/products", {
      method: "POST",
      body: JSON.stringify({
        title: "Low",
        slug: `low-${crypto.randomUUID()}`,
        variants: [{ sku, price: 100, available: 1 }],
      }),
    });
    const variant = await env.DB.prepare(`SELECT id FROM product_variants WHERE sku = ?`)
      .bind(sku)
      .first<{ id: string }>();
    const variantId = variant?.id ?? "";

    const res = await admin(`/inventory/${variantId}`, {
      method: "POST",
      body: JSON.stringify({ delta: -5 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "negative_stock" });

    const row = await env.DB.prepare(`SELECT available FROM inventory WHERE variant_id = ?`)
      .bind(variantId)
      .first<{ available: number }>();
    expect(row).toEqual({ available: 1 });
    const movement = await env.DB.prepare(
      `SELECT id FROM inventory_movements WHERE variant_id = ?`
    )
      .bind(variantId)
      .first();
    expect(movement).toBeNull();
  });

  it("returns 404 for an unknown variant", async () => {
    const res = await admin(`/inventory/${crypto.randomUUID()}`, {
      method: "POST",
      body: JSON.stringify({ available: 3 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/admin/orders", () => {
  it("returns orders newest first with camelCase amounts", async () => {
    const older = await insertOrder("paid", "2999-01-01 00:00:00");
    const newer = await insertOrder("unpaid", "2999-06-01 00:00:00");

    const res = await admin("/orders?limit=1");
    expect(res.status).toBe(200);
    const page = (await res.json()) as Array<{
      id: string;
      email: string;
      status: string;
      currency: string;
      subtotal: number;
      shippingAmount: number;
      tax: number;
      total: number;
      createdAt: string;
    }>;
    expect(page).toEqual([
      {
        id: newer,
        email: `${newer}@example.com`,
        status: "unpaid",
        currency: "usd",
        subtotal: 2500,
        shippingAmount: 500,
        tax: 0,
        total: 3000,
        createdAt: "2999-06-01 00:00:00",
      },
    ]);

    const offset = await admin("/orders?limit=1&offset=1");
    const second = (await offset.json()) as Array<{ id: string }>;
    expect(second[0]?.id).toBe(older);
  });
});

describe("POST /api/admin/orders/:id/shipments", () => {
  it("ships an order and updates tracking on a second call", async () => {
    const orderId = await insertOrder("paid", "2026-03-01 00:00:00");

    const first = await admin(`/orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({ trackingNumber: "TRACK-1", carrier: "ups" }),
    });
    expect(first.status).toBe(201);
    const created = (await first.json()) as {
      id: string;
      orderId: string;
      trackingNumber: string;
      carrier: string;
      status: string;
    };
    expect(created).toEqual({
      id: expect.any(String),
      orderId,
      trackingNumber: "TRACK-1",
      carrier: "ups",
      status: "shipped",
    });

    const shipped = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{ status: string }>();
    expect(shipped).toEqual({ status: "shipped" });

    const second = await admin(`/orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({ trackingNumber: "TRACK-2", carrier: "dhl" }),
    });
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual({
      id: created.id,
      orderId,
      trackingNumber: "TRACK-2",
      carrier: "dhl",
      status: "shipped",
    });

    const rows = await env.DB.prepare(
      `SELECT tracking_number, carrier FROM shipments WHERE order_id = ?`
    )
      .bind(orderId)
      .all<{ tracking_number: string; carrier: string }>();
    expect(rows.results).toEqual([{ tracking_number: "TRACK-2", carrier: "dhl" }]);
  });

  it("rejects a shipment for a refunded order", async () => {
    const orderId = await insertOrder("refunded", "2026-04-01 00:00:00");
    const res = await admin(`/orders/${orderId}/shipments`, {
      method: "POST",
      body: JSON.stringify({ trackingNumber: "NOPE", carrier: "usps" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "refunded" });

    const order = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{ status: string }>();
    expect(order).toEqual({ status: "refunded" });
    const shipment = await env.DB.prepare(`SELECT id FROM shipments WHERE order_id = ?`)
      .bind(orderId)
      .first();
    expect(shipment).toBeNull();
  });

  it("returns 404 when the order does not exist", async () => {
    const res = await admin(`/orders/${crypto.randomUUID()}/shipments`, {
      method: "POST",
      body: JSON.stringify({ trackingNumber: "GONE" }),
    });
    expect(res.status).toBe(404);
  });
});
