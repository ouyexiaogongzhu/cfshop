import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const CART_COOKIE = "cfshop_cart";

type StoreContext = Context<{ Bindings: Env }>;

export const cartRoutes = new Hono<{ Bindings: Env }>();

function readCartId(c: StoreContext): string | null {
  const cartId = getCookie(c, CART_COOKIE);
  return cartId ? cartId : null;
}

function setCartCookie(c: StoreContext, cartId: string): void {
  setCookie(c, CART_COOKIE, cartId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
}

function cartStub(c: StoreContext, cartId: string) {
  return c.env.CART_DO.get(c.env.CART_DO.idFromName(cartId));
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function integerQty(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value;
}

async function readJsonObject(c: StoreContext): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/** Active catalog row: variants joined to products with status = 'active'. */
async function activeVariantExists(db: D1Database, variantId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT v.id
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id = ? AND p.status = 'active'`
    )
    .bind(variantId)
    .first<{ id: string }>();
  return row !== null;
}

cartRoutes.post("/cart", async (c) => {
  const existing = readCartId(c);
  const cartId = existing ?? crypto.randomUUID();
  if (!existing) setCartCookie(c, cartId);
  const state = await cartStub(c, cartId).getState();
  return c.json({ cartId, items: state.items, locked: state.locked }, 201);
});

cartRoutes.get("/cart", async (c) => {
  const cartId = readCartId(c);
  if (!cartId) return c.json({ error: "no_cart" }, 404);
  const state = await cartStub(c, cartId).getState();
  return c.json({ items: state.items, locked: state.locked });
});

cartRoutes.post("/cart/items", async (c) => {
  const cartId = readCartId(c);
  if (!cartId) return c.json({ error: "no_cart" }, 404);

  const body = await readJsonObject(c);
  if (!body || typeof body.variantId !== "string" || body.variantId.length === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const qty = positiveInteger(body.qty);
  if (qty === null) return c.json({ error: "invalid_qty" }, 400);

  const found = await activeVariantExists(c.env.DB, body.variantId);
  if (!found) return c.json({ error: "not_found" }, 404);

  const state = await cartStub(c, cartId).addItem(body.variantId, qty);
  return c.json({ items: state.items, locked: state.locked });
});

cartRoutes.patch("/cart/items/:itemId", async (c) => {
  const cartId = readCartId(c);
  if (!cartId) return c.json({ error: "no_cart" }, 404);

  const body = await readJsonObject(c);
  const qty = body ? integerQty(body.qty) : null;
  if (qty === null) return c.json({ error: "invalid_qty" }, 400);

  const state = await cartStub(c, cartId).updateQty(c.req.param("itemId"), qty);
  return c.json({ items: state.items, locked: state.locked });
});

cartRoutes.delete("/cart/items/:itemId", async (c) => {
  const cartId = readCartId(c);
  if (!cartId) return c.json({ error: "no_cart" }, 404);
  const state = await cartStub(c, cartId).removeItem(c.req.param("itemId"));
  return c.json({ items: state.items, locked: state.locked });
});
