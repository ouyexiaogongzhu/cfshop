import type { CheckoutQuote, QuoteLine } from "./checkout-quote";
import { buildCheckoutQuote } from "./checkout-quote";
import {
  releaseOrderReservations,
  reservationIdForOrderLine,
  reserveLineStock,
} from "./inventory-do";

export class InsufficientInventoryError extends Error {
  status = 409;
  constructor(message = "insufficient_inventory") {
    super(message);
    this.name = "InsufficientInventoryError";
  }
}

export type StoreOrderRecord = {
  orderId: string;
  status: string;
  quote: CheckoutQuote;
  email: string;
  created: boolean;
};

export type CreateStoreOrderInput = {
  env: Env;
  email: string;
  shippingMethodId: string;
  country: string | null;
  lines: QuoteLine[];
  idempotencyKey?: string;
  addressJson?: string;
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
  shipping_method_id: string | null;
};

async function loadOrderQuote(env: Env, order: OrderRow): Promise<CheckoutQuote> {
  const { results: items } = await env.DB.prepare(
    `SELECT variant_id, title, qty, unit_amount FROM order_items WHERE order_id = ? ORDER BY rowid`
  )
    .bind(order.id)
    .all<{ variant_id: string; title: string; qty: number; unit_amount: number }>();

  return {
    currency: "usd",
    subtotal: Number(order.subtotal),
    shipping: Number(order.shipping_amount),
    tax: Number(order.tax),
    total: Number(order.total),
    shippingMethodId: order.shipping_method_id ?? "",
    country: null,
    lines: items.map((row) => ({
      variantId: row.variant_id,
      qty: Number(row.qty),
      unitAmount: Number(row.unit_amount),
      title: row.title,
      lineTotal: Number(row.unit_amount) * Number(row.qty),
    })),
  };
}

async function loadOrderById(env: Env, orderId: string): Promise<StoreOrderRecord | null> {
  const order = await env.DB.prepare(
    `SELECT id, email, status, currency, subtotal, shipping_amount, tax, total, shipping_method_id
     FROM orders WHERE id = ?`
  )
    .bind(orderId)
    .first<OrderRow>();
  if (!order) return null;
  const quote = await loadOrderQuote(env, order);
  return {
    orderId: order.id,
    status: order.status,
    quote,
    email: order.email,
    created: false,
  };
}

export async function getStoreOrderByIdempotencyKey(
  env: Env,
  idempotencyKey: string
): Promise<StoreOrderRecord | null> {
  const link = await env.DB.prepare(`SELECT order_id FROM order_idempotency WHERE idempotency_key = ?`)
    .bind(idempotencyKey)
    .first<{ order_id: string }>();
  if (!link) return null;
  return loadOrderById(env, link.order_id);
}

export async function getStoreOrderByIdAndEmail(
  env: Env,
  orderId: string,
  email: string
): Promise<StoreOrderRecord | null> {
  const record = await loadOrderById(env, orderId);
  if (!record || record.email.toLowerCase() !== email.trim().toLowerCase()) return null;
  return record;
}

export async function createStoreOrder(input: CreateStoreOrderInput): Promise<StoreOrderRecord> {
  const { env, email, shippingMethodId, country, lines, idempotencyKey, addressJson } = input;
  const normalizedEmail = email.trim().toLowerCase();

  if (idempotencyKey) {
    const existing = await getStoreOrderByIdempotencyKey(env, idempotencyKey);
    if (existing) return existing;
  }

  const quoteResult = await buildCheckoutQuote(env.DB, { shippingMethodId, country, lines });
  if (quoteResult === "invalid") throw new Error("invalid_request");
  if (quoteResult === "not_found") throw new Error("not_found");
  const quote = quoteResult;

  const orderId = crypto.randomUUID();
  const reserved: QuoteLine[] = [];

  try {
    for (const line of quote.lines) {
      try {
        await reserveLineStock(
          env,
          line.variantId,
          line.qty,
          reservationIdForOrderLine(orderId, line.variantId)
        );
        reserved.push({ variantId: line.variantId, qty: line.qty });
      } catch (err) {
        await releaseOrderReservations(env, orderId, reserved);
        if (err instanceof Error && /insufficient stock/i.test(err.message)) {
          throw new InsufficientInventoryError();
        }
        throw err;
      }
    }

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        `INSERT INTO orders (
           id, email, status, currency, subtotal, shipping_amount, shipping_method_id, tax, total, address_json
         ) VALUES (?, ?, 'pending', 'usd', ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId,
        normalizedEmail,
        quote.subtotal,
        quote.shipping,
        quote.shippingMethodId,
        quote.tax,
        quote.total,
        addressJson ?? JSON.stringify({ country })
      ),
    ];

    for (const line of quote.lines) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO order_items (id, order_id, variant_id, title, qty, unit_amount)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), orderId, line.variantId, line.title, line.qty, line.unitAmount),
        env.DB.prepare(
          `UPDATE inventory
           SET available = available - ?, reserved = reserved + ?, updated_at = datetime('now')
           WHERE variant_id = ?`
        ).bind(line.qty, line.qty, line.variantId)
      );
    }

    if (idempotencyKey) {
      statements.push(
        env.DB.prepare(`INSERT INTO order_idempotency (idempotency_key, order_id) VALUES (?, ?)`).bind(
          idempotencyKey,
          orderId
        )
      );
    }

    await env.DB.batch(statements);
  } catch (err) {
    await releaseOrderReservations(env, orderId, reserved);
    throw err;
  }

  return {
    orderId,
    status: "pending",
    quote: { ...quote, country },
    email: normalizedEmail,
    created: true,
  };
}

export function orderResponseBody(record: StoreOrderRecord): Record<string, unknown> {
  const { quote } = record;
  return {
    orderId: record.orderId,
    status: record.status,
    email: record.email,
    currency: quote.currency,
    subtotal: quote.subtotal,
    shipping: quote.shipping,
    tax: quote.tax,
    total: quote.total,
    shippingMethodId: quote.shippingMethodId,
    country: quote.country,
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      unitAmount: line.unitAmount,
      title: line.title,
      lineTotal: line.lineTotal,
    })),
  };
}
