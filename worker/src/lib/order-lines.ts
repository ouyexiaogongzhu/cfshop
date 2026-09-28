import { reservationIdForOrderLine } from "./inventory-do";

export type OrderLineRow = {
  variant_id: string;
  qty: number;
};

/**
 * Order lines for an order, used by webhook settlement to find the
 * InventoryDO reservations that belong to the order.
 */
export async function orderLinesForOrder(env: Env, orderId: string): Promise<OrderLineRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT variant_id, qty FROM order_items WHERE order_id = ? ORDER BY rowid`
  )
    .bind(orderId)
    .all<{ variant_id: string; qty: number }>();
  return (results ?? []).map((row) => ({ variant_id: row.variant_id, qty: Number(row.qty) }));
}

export { reservationIdForOrderLine };
