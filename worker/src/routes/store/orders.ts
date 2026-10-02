import { Hono } from "hono";
import type { Context } from "hono";
import { normalizeCountry, parseQuoteLines, type QuoteLine } from "../../lib/checkout-quote";
import { DiscountError } from "../../lib/discounts";
import {
  createStoreOrder,
  getStoreOrderByIdAndEmail,
  getStoreOrderByIdempotencyKey,
  IdempotencyConflictError,
  InsufficientInventoryError,
  orderResponseBody,
  type StoreOrderRecord,
} from "../../lib/orders";
import { readSessionUserId, sessionCookie } from "../../lib/session";
import { readCartId } from "./cart";

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

function requiredText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

function optionalText(value: unknown, max = 200): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > max) return null;
  return text;
}

function parseAddressJson(body: Record<string, unknown>, country: string | null): string | "invalid" {
  const address = body.address;
  if (address === undefined) {
    return JSON.stringify({ country });
  }
  if (!address || typeof address !== "object" || Array.isArray(address)) return "invalid";
  const row = address as Record<string, unknown>;
  const name = requiredText(row.name);
  const line1 = requiredText(row.line1);
  const line2 = optionalText(row.line2);
  const city = requiredText(row.city);
  const region = optionalText(row.region);
  const postalCode = optionalText(row.postalCode);
  const addrCountry =
    typeof row.country === "string" && /^[A-Za-z]{2}$/.test(row.country.trim())
      ? row.country.trim().toUpperCase()
      : country;
  if (!name || !line1 || line2 === null || !city || region === null || postalCode === null || !addrCountry) {
    return "invalid";
  }
  return JSON.stringify({
    name,
    line1,
    line2,
    city,
    region,
    postalCode,
    country: addrCountry,
  });
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
  const cartId = readCartId(c);
  if (!cartId) return "empty_cart";
  const state = await c.env.CART_DO.get(c.env.CART_DO.idFromName(cartId)).getState();
  const lines = state.items.map((item) => ({ variantId: item.variantId, qty: item.qty }));
  if (lines.length === 0) return "empty_cart";
  return lines;
}

export function readIdempotencyKey(c: StoreContext, body: Record<string, unknown>): string | undefined {
  // Bounded: the key becomes a PRIMARY KEY, so an unbounded caller string must not reach it.
  const bound = (value: unknown): string | undefined => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed.length > 0 && trimmed.length <= 255 ? trimmed : undefined;
  };
  return bound(c.req.header("Idempotency-Key")) ?? bound(body.idempotencyKey);
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
    const existing = await getStoreOrderByIdempotencyKey(c.env, key, email);
    if (existing.kind === "own") return existing.record;
    if (existing.kind === "conflict") return c.json({ error: "idempotency_conflict" }, 409);
  }

  const lines = await resolveLines(c, body);
  if (lines === "invalid") return c.json({ error: "invalid_request" }, 400);
  if (lines === "empty_cart") return c.json({ error: "empty_cart" }, 400);

  const addressJson = parseAddressJson(body, country);
  if (addressJson === "invalid") return c.json({ error: "invalid_request" }, 400);

  const usesCart = body.items === undefined;
  const cartId = usesCart ? readCartId(c) : null;
  const cartStub = cartId ? c.env.CART_DO.get(c.env.CART_DO.idFromName(cartId)) : null;

  const discountCode =
    typeof body.discountCode === "string" && body.discountCode.trim().length > 0
      ? body.discountCode.trim()
      : null;

  try {
    if (cartStub) await cartStub.lock();
    const record = await createStoreOrder({
      env: c.env,
      email,
      // Bind to the session when the placer has one. A guest POST leaves this NULL, so an
      // anonymous caller can no longer write a row into a registered account's order list.
      userId: await readSessionUserId(c.env.CACHE, sessionCookie(c)),
      shippingMethodId: String(body.shippingMethodId),
      country,
      lines,
      idempotencyKey: key,
      addressJson,
      discountCode,
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
    if (err instanceof IdempotencyConflictError) return c.json({ error: "idempotency_conflict" }, 409);
    if (err instanceof DiscountError) return c.json({ error: err.message }, 400);
    if (err instanceof Error && (err.message === "not_found" || err.message === "invalid_request")) {
      return c.json({ error: err.message }, err.message === "not_found" ? 404 : 400);
    }
    throw err;
  }
}

orderRoutes.get("/orders", async (c) => {
  const userId = await readSessionUserId(c.env.CACHE, sessionCookie(c));
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  // Owner-scoped: the session principal, not the caller-asserted email. Guest rows placed
  // before an account existed carry user_id = NULL and are not claimable by email here;
  // they stay reachable through the orderId + email lookup on GET /orders/:id.
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ id: string }>();
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 50);
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, status, currency, subtotal, shipping_amount, tax, total, created_at
     FROM orders
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(userId, limit)
    .all<{
      id: string;
      email: string;
      status: string;
      currency: string;
      subtotal: number;
      shipping_amount: number;
      tax: number;
      total: number;
      created_at: string;
    }>();

  return c.json(
    (results ?? []).map((row) => ({
      orderId: row.id,
      email: row.email,
      status: row.status,
      currency: row.currency,
      subtotal: row.subtotal,
      shipping: row.shipping_amount,
      tax: row.tax,
      total: row.total,
      createdAt: row.created_at,
    }))
  );
});

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
