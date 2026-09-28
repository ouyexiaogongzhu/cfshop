import type { CheckoutQuote, QuoteLine } from "./checkout-quote";
import { buildCheckoutQuote } from "./checkout-quote";
import { DiscountError } from "./discounts";
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
  address?: Record<string, unknown> | null;
  shipment?: { trackingNumber: string; carrier: string } | null;
};

export type CreateStoreOrderInput = {
  env: Env;
  email: string;
  shippingMethodId: string;
  country: string | null;
  lines: QuoteLine[];
  idempotencyKey?: string;
  addressJson?: string;
  discountCode?: string | null;
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
  address_json: string | null;
  discount_code: string | null;
  discount_amount: number;
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
    discountCode: order.discount_code ?? null,
    discountAmount: Number(order.discount_amount ?? 0),
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
    `SELECT id, email, status, currency, subtotal, shipping_amount, tax, total,
            shipping_method_id, address_json, discount_code, discount_amount
     FROM orders WHERE id = ?`
  )
    .bind(orderId)
    .first<OrderRow>();
  if (!order) return null;
  const quote = await loadOrderQuote(env, order);
  const shipment = await env.DB.prepare(
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

  return {
    orderId: order.id,
    status: order.status,
    quote,
    email: order.email,
    created: false,
    address,
    shipment: shipment
      ? { trackingNumber: shipment.tracking_number, carrier: shipment.carrier }
      : null,
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
  const { env, email, shippingMethodId, country, lines, idempotencyKey, addressJson, discountCode } =
    input;
  const normalizedEmail = email.trim().toLowerCase();

  if (idempotencyKey) {
    const existing = await getStoreOrderByIdempotencyKey(env, idempotencyKey);
    if (existing) return existing;
  }

  let quoteResult: Awaited<ReturnType<typeof buildCheckoutQuote>>;
  try {
    quoteResult = await buildCheckoutQuote(env.DB, {
      shippingMethodId,
      country,
      lines,
      discountCode: discountCode ?? null,
      email: normalizedEmail,
    });
  } catch (err) {
    if (err instanceof DiscountError) throw err;
    throw err;
  }
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
           id, email, status, currency, subtotal, shipping_amount, shipping_method_id,
           tax, total, address_json, discount_code, discount_amount
         ) VALUES (?, ?, 'pending', 'usd', ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        orderId,
        normalizedEmail,
        quote.subtotal,
        quote.shipping,
        quote.shippingMethodId,
        quote.tax,
        quote.total,
        addressJson ?? JSON.stringify({ country }),
        quote.discountCode,
        quote.discountAmount
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

    if (quote.discountCode && quote.discountAmount > 0) {
      const discount = await env.DB.prepare(`SELECT id FROM discounts WHERE code = ?`)
        .bind(quote.discountCode)
        .first<{ id: string }>();
      if (discount) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO discount_usage (id, discount_id, order_id, customer_email, discount_amount_cents)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), discount.id, orderId, normalizedEmail, quote.discountAmount),
          env.DB.prepare(
            `UPDATE discounts SET usage_count = usage_count + 1 WHERE id = ?`
          ).bind(discount.id)
        );
      }
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
    address: addressJson
      ? (JSON.parse(addressJson) as Record<string, unknown>)
      : { country },
    shipment: null,
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
    discountCode: quote.discountCode,
    discountAmount: quote.discountAmount,
    shipping: quote.shipping,
    tax: quote.tax,
    total: quote.total,
    shippingMethodId: quote.shippingMethodId,
    country: quote.country,
    address: record.address ?? null,
    shipment: record.shipment ?? null,
    lines: quote.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      unitAmount: line.unitAmount,
      title: line.title,
      lineTotal: line.lineTotal,
    })),
  };
}
