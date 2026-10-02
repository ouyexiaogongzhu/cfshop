import { Hono } from "hono";
import {
  PaymentUnavailableError,
  resolveStripeWebhookVerifier,
  WebhookVerificationError,
} from "../../lib/payments";
import { orderLinesForOrder } from "../../lib/order-lines";
import { reservationIdForOrderLine } from "../../lib/inventory-do";

export const stripeWebhookRoutes = new Hono<{ Bindings: Env }>();

/**
 * Stripe webhook entry point.
 *
 * Pipeline: verify signature -> record event (idempotent via
 * payment_events UNIQUE(provider, event_id)) -> apply the event to the
 * order (paid / refunded) -> settle InventoryDO reservations.
 *
 * Delivery retries and replays hit the UNIQUE constraint, are recognized
 * as duplicates, and return 200 without touching the order again.
 */
stripeWebhookRoutes.post("/stripe", async (c) => {
  const payload = await c.req.text();
  const signature = c.req.header("stripe-signature") ?? null;

  let event;
  try {
    const provider = resolveStripeWebhookVerifier(c.env);
    event = await provider.verifyWebhookSignature(payload, signature);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return c.json({ error: err.message }, 400);
    if (err instanceof PaymentUnavailableError) return c.json({ error: err.message }, 503);
    throw err;
  }

  // Idempotency gate: claim the event before doing any work. A duplicate
  // insert (Stripe retry / replay) short-circuits as already processed.
  let duplicate = false;
  try {
    await c.env.DB.prepare(
      `INSERT INTO payment_events (id, provider, event_id, event_type, order_id)
       VALUES (?, 'stripe', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), event.eventId, event.type, event.orderId)
      .run();
  } catch (err) {
    // UNIQUE(provider, event_id) violation == Stripe retry / replayed event.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      duplicate = true;
    } else {
      throw err;
    }
  }
  if (duplicate) {
    return c.json({ received: true, eventId: event.eventId, type: event.type, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed" && event.orderId) {
      await markOrderPaid(c.env, event.orderId);
    } else if (event.type === "charge.refunded" && event.orderId) {
      await markOrderRefunded(c.env, event.orderId);
    }
    // Unrecognized types (or events without an order) are stored and ACKed.
    return c.json({ received: true, eventId: event.eventId, type: event.type });
  } catch (err) {
    // Release the claim so Stripe's retry can reprocess this event.
    await c.env.DB.prepare(`DELETE FROM payment_events WHERE provider = 'stripe' AND event_id = ?`)
      .bind(event.eventId)
      .run();
    throw err;
  }
});

/**
 * pending -> paid. Finalizes each order line's reservation in the
 * InventoryDO (reserved -> sold) and mirrors the sale into D1 stock.
 */
async function markOrderPaid(env: Env, orderId: string): Promise<void> {
  const order = await env.DB.prepare(`SELECT id, status FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{ id: string; status: string }>();
  if (!order) return; // Unknown order: keep the event recorded, ACK.

  // The transition is the gate: side effects run only when this UPDATE actually matched a
  // pending order. Without the change check, a refunded/shipped order would still settle.
  const paid = await env.DB.prepare(
    `UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`
  )
    .bind(orderId)
    .run();
  if ((paid.meta.changes ?? 0) === 0) return;

  const lines = await orderLinesForOrder(env, orderId);

  // DO-then-D1 (compensating pattern used by checkout): confirm DO
  // reservations first, then best-effort mirror into the D1 ledger.
  for (const line of lines) {
    const reservationId = reservationIdForOrderLine(orderId, line.variant_id);
    await env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName(line.variant_id)).confirm(reservationId);
    await env.DB.prepare(
      `UPDATE inventory
       SET reserved = MAX(reserved - ?, 0), sold = sold + ?, updated_at = datetime('now')
       WHERE variant_id = ?`
    )
      .bind(line.qty, line.qty, line.variant_id)
      .run();
  }
}

/** paid/pending -> refunded. Restocks by releasing any live reservations. */
async function markOrderRefunded(env: Env, orderId: string): Promise<void> {
  const order = await env.DB.prepare(`SELECT id, status FROM orders WHERE id = ?`)
    .bind(orderId)
    .first<{ id: string; status: string }>();
  if (!order) return;

  // Refund is legal from pending or paid only, and — like the paid path — the matched-row
  // count is the gate for the restock loop below.
  const refunded = await env.DB.prepare(
    `UPDATE orders SET status = 'refunded' WHERE id = ? AND status IN ('pending', 'paid')`
  )
    .bind(orderId)
    .run();
  if ((refunded.meta.changes ?? 0) === 0) return;

  // `sold` is only ever incremented by markOrderPaid, so only a previously-paid order may
  // decrement it. Refunding a still-pending order must not eat another order's sold count.
  const wasPaid = order.status === "paid";
  const lines = await orderLinesForOrder(env, orderId);

  for (const line of lines) {
    const reservationId = reservationIdForOrderLine(orderId, line.variant_id);
    // On a paid order the reservation is already `confirmed`; this is a
    // no-op. On a pending order it releases stock back to available.
    await env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName(line.variant_id)).release(reservationId);
    // Reverse exactly the counter markOrderPaid moved, so refund is its inverse.
    const sql = wasPaid
      ? `UPDATE inventory
         SET reserved = MAX(reserved - ?, 0), available = available + ?,
             sold = MAX(sold - ?, 0), updated_at = datetime('now')
         WHERE variant_id = ?`
      : `UPDATE inventory
         SET reserved = MAX(reserved - ?, 0), available = available + ?,
             updated_at = datetime('now')
         WHERE variant_id = ?`;
    const args = wasPaid
      ? [line.qty, line.qty, line.qty, line.variant_id]
      : [line.qty, line.qty, line.variant_id];
    await env.DB.prepare(sql)
      .bind(...args)
      .run();
  }
}
