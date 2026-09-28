import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const VARIANT_A = "var_cart_a";
const VARIANT_B = "var_cart_b";
const VARIANT_DRAFT = "var_cart_draft";
const VARIANT_EUR = "var_cart_eur";
const PRICE_A = 1999;
const PRICE_B = 450;

type CartState = {
  items: {
    itemId: string;
    variantId: string;
    qty: number;
    title?: string;
    unitAmount?: number | null;
    currency?: string;
  }[];
  locked: boolean;
};

type ShippingBody = {
  country: string | null;
  methods: {
    id: string;
    code: string;
    title: string;
    zone: string;
    currency: string;
    amount: number;
    selected: boolean;
  }[];
};

type Preview = {
  preview: boolean;
  payment: string;
  currency: string;
  subtotal: number;
  discountCode: string | null;
  discountAmount: number;
  shipping: number;
  tax: number;
  total: number;
  shippingMethodId: string;
  country: string | null;
  orderId: null;
};

async function insertProduct(opts: {
  productId: string;
  variantId: string;
  priceId: string;
  sku: string;
  slug: string;
  amount: number;
  status?: string;
  currency?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, title, slug, description, status) VALUES (?, ?, ?, '', ?)`
  )
    .bind(opts.productId, opts.slug, opts.slug, opts.status ?? "active")
    .run();
  await env.DB.prepare(
    `INSERT INTO product_variants (id, product_id, sku, options) VALUES (?, ?, ?, '{}')`
  )
    .bind(opts.variantId, opts.productId, opts.sku)
    .run();
  await env.DB.prepare(
    `INSERT INTO prices (id, variant_id, currency, amount) VALUES (?, ?, ?, ?)`
  )
    .bind(opts.priceId, opts.variantId, opts.currency ?? "usd", opts.amount)
    .run();
}

beforeAll(async () => {
  await insertProduct({
    productId: "prod_cart_a",
    variantId: VARIANT_A,
    priceId: "price_cart_a",
    sku: "sku-cart-a",
    slug: "cart-a",
    amount: PRICE_A,
  });
  await insertProduct({
    productId: "prod_cart_b",
    variantId: VARIANT_B,
    priceId: "price_cart_b",
    sku: "sku-cart-b",
    slug: "cart-b",
    amount: PRICE_B,
  });
  await insertProduct({
    productId: "prod_cart_draft",
    variantId: VARIANT_DRAFT,
    priceId: "price_cart_draft",
    sku: "sku-cart-draft",
    slug: "cart-draft",
    amount: 100,
    status: "draft",
  });
  await insertProduct({
    productId: "prod_cart_eur",
    variantId: VARIANT_EUR,
    priceId: "price_cart_eur",
    sku: "sku-cart-eur",
    slug: "cart-eur",
    amount: 999,
    currency: "eur",
  });
});

function cookieHeader(cartId: string): string {
  return `cfshop_cart=${cartId}`;
}

function cartIdFromSetCookie(res: Response): string {
  const lines =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const header = lines.find((value) => value.toLowerCase().startsWith("cfshop_cart=")) ?? "";
  expect(header).toMatch(/HttpOnly/i);
  expect(header).toMatch(/Secure/i);
  expect(header).toMatch(/SameSite=Lax/i);
  expect(header).toMatch(/Path=\//i);
  const id = /^cfshop_cart=([^;]+)/.exec(header)?.[1];
  expect(id).toBeTruthy();
  return id ?? "";
}

async function createCart(): Promise<{ cartId: string; cookie: string }> {
  const res = await SELF.fetch("https://example.com/api/store/cart", { method: "POST" });
  expect(res.status).toBe(201);
  const body = await res.json<{ cartId: string; items: unknown[]; locked: boolean }>();
  const cartId = cartIdFromSetCookie(res);
  expect(body).toEqual({ cartId, items: [], locked: false });
  return { cartId, cookie: cookieHeader(cartId) };
}

async function orderCount(): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();
  return Number(row?.n ?? -1);
}

describe("cart", () => {
  it("creates a cart cookie and reuses it", async () => {
    const first = await createCart();
    const again = await SELF.fetch("https://example.com/api/store/cart", {
      method: "POST",
      headers: { cookie: first.cookie },
    });
    expect(again.status).toBe(201);
    const body = await again.json<{ cartId: string; items: unknown[]; locked: boolean }>();
    expect(body).toEqual({ cartId: first.cartId, items: [], locked: false });
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("returns no_cart when the cookie is missing", async () => {
    const res = await SELF.fetch("https://example.com/api/store/cart");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no_cart" });
  });

  it("adds, updates, and removes active variants", async () => {
    const { cookie } = await createCart();
    const added = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_A, qty: 2 }),
    });
    expect(added.status).toBe(200);
    const afterAdd = await added.json<CartState>();
    expect(afterAdd.locked).toBe(false);
    expect(afterAdd.items).toHaveLength(1);
    const item = afterAdd.items[0];
    expect(item?.variantId).toBe(VARIANT_A);
    expect(item?.qty).toBe(2);

    const again = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_A, qty: 3 }),
    });
    const merged = await again.json<CartState>();
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({
      itemId: item?.itemId,
      variantId: VARIANT_A,
      qty: 5,
      title: expect.any(String),
      unitAmount: PRICE_A,
    });

    const other = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_B, qty: 1 }),
    });
    expect((await other.json<CartState>()).items).toHaveLength(2);

    const itemId = item?.itemId ?? "";
    const patched = await SELF.fetch(`https://example.com/api/store/cart/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ qty: 1 }),
    });
    expect(patched.status).toBe(200);
    const afterPatch = await patched.json<CartState>();
    expect(afterPatch.items.find((row) => row.itemId === itemId)?.qty).toBe(1);

    const removed = await SELF.fetch(`https://example.com/api/store/cart/items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ qty: 0 }),
    });
    const afterRemove = await removed.json<CartState>();
    expect(afterRemove.items.map((row) => row.variantId)).toEqual([VARIANT_B]);

    const remainingId = afterRemove.items[0]?.itemId ?? "";
    const deleted = await SELF.fetch(`https://example.com/api/store/cart/items/${remainingId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ items: [], locked: false });

    const got = await SELF.fetch("https://example.com/api/store/cart", { headers: { cookie } });
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ items: [], locked: false });
  });

  it("rejects unknown, inactive, and non-positive quantities", async () => {
    const { cookie } = await createCart();
    const missing = await SELF.fetch("https://example.com/api/store/cart/items", { method: "POST" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "no_cart" });

    const unknown = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: "var_missing", qty: 1 }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not_found" });

    const draft = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_DRAFT, qty: 1 }),
    });
    expect(draft.status).toBe(404);
    expect(await draft.json()).toEqual({ error: "not_found" });

    const badQty = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_A, qty: 1.5 }),
    });
    expect(badQty.status).toBe(400);
    expect(await badQty.json()).toEqual({ error: "invalid_qty" });

    const eur = await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_EUR, qty: 1 }),
    });
    expect(eur.status).toBe(200);

    const patch = await SELF.fetch("https://example.com/api/store/cart/items/nope", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ qty: 1 }),
    });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ error: "no_cart" });
  });
});

describe("shipping methods", () => {
  it("selects Hong Kong first when the country is HK", async () => {
    const res = await SELF.fetch("https://example.com/api/store/shipping-methods?country=hk");
    expect(res.status).toBe(200);
    const body = await res.json<ShippingBody>();
    expect(body.country).toBe("hk");
    expect(body.methods.map((method) => method.zone)).toEqual(["HK", "INTL"]);
    expect(body.methods[0]).toMatchObject({
      id: "ship_hk",
      code: "hk",
      title: "Hong Kong",
      zone: "HK",
      currency: "usd",
      amount: 500,
      selected: true,
    });
    expect(body.methods[1]).toMatchObject({
      id: "ship_intl",
      code: "international",
      title: "International",
      zone: "INTL",
      currency: "usd",
      amount: 2500,
      selected: false,
    });
  });

  it("selects international shipping for other countries", async () => {
    const res = await SELF.fetch("https://example.com/api/store/shipping-methods?country=US");
    expect(res.status).toBe(200);
    const body = await res.json<ShippingBody>();
    expect(body.country).toBe("US");
    expect(body.methods.map((method) => [method.zone, method.selected])).toEqual([
      ["INTL", true],
      ["HK", false],
    ]);
    expect(body.methods[0]?.amount).toBe(2500);
    expect(body.methods[1]?.amount).toBe(500);
  });

  it("returns both methods with nothing selected when country is omitted", async () => {
    const res = await SELF.fetch("https://example.com/api/store/shipping-methods");
    expect(res.status).toBe(200);
    const body = await res.json<ShippingBody>();
    expect(body.country).toBeNull();
    expect(body.methods).toHaveLength(2);
    expect(body.methods.every((method) => method.selected === false)).toBe(true);
  });
});

describe("checkout preview", () => {
  it("prices explicit items, charges flat shipping, and writes no order", async () => {
    expect(await orderCount()).toBe(0);
    const res = await SELF.fetch("https://example.com/api/store/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shippingMethodId: "ship_hk",
        country: "hk",
        items: [
          { variantId: VARIANT_A, qty: 2 },
          { variantId: VARIANT_B, qty: 1 },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<Preview>();
    const subtotal = PRICE_A * 2 + PRICE_B;
    expect(body).toEqual({
      preview: true,
      payment: "unavailable",
      currency: "usd",
      subtotal,
      discountCode: null,
      discountAmount: 0,
      shipping: 500,
      tax: 0,
      total: subtotal + 500,
      shippingMethodId: "ship_hk",
      country: "HK",
      orderId: null,
    });
    expect(Number.isSafeInteger(body.subtotal)).toBe(true);
    expect(Number.isSafeInteger(body.total)).toBe(true);
    expect(await orderCount()).toBe(0);

    const items = await env.DB.prepare(`SELECT COUNT(*) AS n FROM order_items`).first<{ n: number }>();
    const shipments = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shipments`).first<{ n: number }>();
    const outbox = await env.DB.prepare(`SELECT COUNT(*) AS n FROM outbox`).first<{ n: number }>();
    expect(Number(items?.n)).toBe(0);
    expect(Number(shipments?.n)).toBe(0);
    expect(Number(outbox?.n)).toBe(0);
  });

  it("uses the cart when items are omitted", async () => {
    const { cookie } = await createCart();
    await SELF.fetch("https://example.com/api/store/cart/items", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ variantId: VARIANT_A, qty: 2 }),
    });
    const res = await SELF.fetch("https://example.com/api/store/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ shippingMethodId: "ship_intl", country: "us" }),
    });
    expect(res.status).toBe(200);
    const subtotal = PRICE_A * 2;
    expect(await res.json()).toEqual({
      preview: true,
      payment: "unavailable",
      currency: "usd",
      subtotal,
      discountCode: null,
      discountAmount: 0,
      shipping: 2500,
      tax: 0,
      total: subtotal + 2500,
      shippingMethodId: "ship_intl",
      country: "US",
      orderId: null,
    });
    expect(await orderCount()).toBe(0);
  });

  it("returns empty_cart when there is no cart and no items", async () => {
    const res = await SELF.fetch("https://example.com/api/store/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shippingMethodId: "ship_hk", country: "HK" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_cart" });
  });

  it("returns 404 for an unknown variant or shipping method", async () => {
    const variant = await SELF.fetch("https://example.com/api/store/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT_DRAFT, qty: 1 }],
      }),
    });
    expect(variant.status).toBe(404);
    expect(await variant.json()).toEqual({ error: "not_found" });

    const method = await SELF.fetch("https://example.com/api/store/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shippingMethodId: "ship_missing",
        country: null,
        items: [{ variantId: VARIANT_A, qty: 1 }],
      }),
    });
    expect(method.status).toBe(404);
    expect(await method.json()).toEqual({ error: "not_found" });
    expect(await orderCount()).toBe(0);
  });
});
