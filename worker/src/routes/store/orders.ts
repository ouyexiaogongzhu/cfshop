import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { normalizeCountry, parseQuoteLines, type QuoteLine } from "../../lib/checkout-quote";
import {
  createStoreOrder,
  getStoreOrderByIdAndEmail,
  getStoreOrderByIdempotencyKey,
  InsufficientInventoryError,
  orderResponseBody,
  type StoreOrderRecord,
} from "../../lib/orders";

const CART_COOKIE = "cfshop_cart";

type StoreContext = Context<{ Bindings: Env }>;

export const orderRoutes = new Hono<{ Bindings: Env }>();

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

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

async function resolveLines(
  c: StoreContext,
  body: Record<string, unknown>
): Promise<QuoteLine[] | "empty_cart" | "invalid"> {
  if (body.items !== undefined) {
    const parsed = parseQuoteLines(body.items);
    if (parsed === "invalid") return "invalid";
    if (parsed.length === 0) return "empty_cart";
    return parsed;
  }
  const cartId = getCookie(c, CART_COOKIE);
  if (!cartId) return "empty_cart";
  const state = await c.env.CART_DO.get(c.env.CART_DO.idFromName(cartId)).getState();
  const lines = state.items.map((item) => ({ variantId: item.variantId, qty: item.qty }));
  if (lines.length === 0) return "empty_cart";
  return lines;
}

export function readIdempotencyKey(c: StoreContext, body: Record<string, unknown>): string | undefined {
  const header = c.req.header("Idempotency-Key")?.trim();
  if (header && header.length > 0) return header;
  if (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length > 0) {
    return body.idempotencyKey.trim();
  }
  return undefined;
}

function isOrderRecord(value: StoreOrderRecord | Response): value is StoreOrderRecord {
  return !(value instanceof Response);
}

export async function placePendingOrder(
  c: StoreContext,
  body: Record<string, unknown>,
  email: string,
  country: string | null
): Promise<StoreOrderRecord | Response> {
  const key = readIdempotencyKey(c, body);
  if (key) {
    const existing = await getStoreOrderByIdempotencyKey(c.env, key);
    if (existing) return existing;
  }

  const lines = await resolveLines(c, body);
  if (lines === "invalid") return c.json({ error: "invalid_request" }, 400);
  if (lines === "empty_cart") return c.json({ error: "empty_cart" }, 400);

  const usesCart = body.items === undefined;
  const cartId = usesCart ? getCookie(c, CART_COOKIE) : null;
  const cartStub = cartId ? c.env.CART_DO.get(c.env.CART_DO.idFromName(cartId)) : null;

  try {
    if (cartStub) await cartStub.lock();
    const record = await createStoreOrder({
      env: c.env,
      email,
      shippingMethodId: String(body.shippingMethodId),
      country,
      lines,
      idempotencyKey: key,
    });
    if (cartStub && record.created) {
      await cartStub.unlock();
      await cartStub.clear();
    } else if (cartStub) {
      await cartStub.unlock();
    }
    return record;
  } catch (err) {
    if (cartStub) await cartStub.unlock();
    if (err instanceof InsufficientInventoryError) return c.json({ error: "insufficient_inventory" }, 409);
    if (err instanceof Error && (err.message === "not_found" || err.message === "invalid_request")) {
      return c.json({ error: err.message }, err.message === "not_found" ? 404 : 400);
    }
    throw err;
  }
}

orderRoutes.post("/orders", async (c) => {
  const body = await readJsonObject(c);
  if (!body || typeof body.shippingMethodId !== "string" || body.shippingMethodId.length === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ error: "invalid_request" }, 400);
  const country = normalizeCountry(body.country);
  if (country === "invalid") return c.json({ error: "invalid_request" }, 400);

  const placed = await placePendingOrder(c, body, email, country);
  if (!isOrderRecord(placed)) return placed;
  return c.json(orderResponseBody(placed), placed.created ? 201 : 200);
});

orderRoutes.get("/orders/:id", async (c) => {
  const email = c.req.query("email");
  if (!email) return c.json({ error: "invalid_request" }, 400);
  const record = await getStoreOrderByIdAndEmail(c.env, c.req.param("id"), email);
  if (!record) return c.json({ error: "not_found" }, 404);
  return c.json(orderResponseBody(record));
});
