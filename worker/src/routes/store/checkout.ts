import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { buildCheckoutQuote, normalizeCountry, parseQuoteLines, type QuoteLine } from "../../lib/checkout-quote";
import { DiscountError } from "../../lib/discounts";
import { orderResponseBody, type StoreOrderRecord } from "../../lib/orders";
import { PaymentUnavailableError, resolvePaymentProvider } from "../../lib/payments";
import { placePendingOrder } from "./orders";

const CART_COOKIE = "cfshop_cart";

type StoreContext = Context<{ Bindings: Env }>;

export const checkoutRoutes = new Hono<{ Bindings: Env }>();

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

checkoutRoutes.post("/checkout", async (c) => {
  const body = await readJsonObject(c);
  if (!body || typeof body.shippingMethodId !== "string" || body.shippingMethodId.length === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }

  const country = normalizeCountry(body.country);
  if (country === "invalid") return c.json({ error: "invalid_request" }, 400);

  const lines = await resolveLines(c, body);
  if (lines === "invalid") return c.json({ error: "invalid_request" }, 400);
  if (lines === "empty_cart") return c.json({ error: "empty_cart" }, 400);

  const discountCode =
    typeof body.discountCode === "string" && body.discountCode.trim().length > 0
      ? body.discountCode.trim()
      : null;
  const email =
    typeof body.email === "string" && body.email.trim().length > 0
      ? body.email.trim().toLowerCase()
      : null;

  let quote: Awaited<ReturnType<typeof buildCheckoutQuote>>;
  try {
    quote = await buildCheckoutQuote(c.env.DB, {
      shippingMethodId: body.shippingMethodId,
      country,
      lines,
      discountCode,
      email,
    });
  } catch (err) {
    if (err instanceof DiscountError) return c.json({ error: err.message }, 400);
    throw err;
  }
  if (quote === "not_found") return c.json({ error: "not_found" }, 404);
  if (quote === "invalid") return c.json({ error: "invalid_request" }, 400);

  return c.json({
    preview: true,
    payment: "unavailable",
    currency: quote.currency,
    subtotal: quote.subtotal,
    discountCode: quote.discountCode,
    discountAmount: quote.discountAmount,
    shipping: quote.shipping,
    tax: quote.tax,
    total: quote.total,
    shippingMethodId: quote.shippingMethodId,
    country: quote.country,
    orderId: null,
  });
});

async function paymentSession(c: StoreContext, record: StoreOrderRecord) {
  const provider = resolvePaymentProvider(c.env);
  return provider.createCheckoutSession({
    orderId: record.orderId,
    amount: record.quote.total,
    currency: record.quote.currency,
    customerEmail: record.email,
  });
}

checkoutRoutes.post("/checkout/complete", async (c) => {
  const body = await readJsonObject(c);
  if (!body || typeof body.shippingMethodId !== "string" || body.shippingMethodId.length === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email) return c.json({ error: "invalid_request" }, 400);
  const country = normalizeCountry(body.country);
  if (country === "invalid") return c.json({ error: "invalid_request" }, 400);

  const placed = await placePendingOrder(c, body, email, country);
  if (placed instanceof Response) return placed;

  try {
    const session = await paymentSession(c, placed);
    return c.json(
      { ...orderResponseBody(placed), preview: false, payment: session },
      placed.created ? 201 : 200
    );
  } catch (err) {
    if (err instanceof PaymentUnavailableError) return c.json({ error: err.message }, 503);
    throw err;
  }
});
