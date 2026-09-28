import type { InventoryDO } from "../durable-objects/inventory";

export function inventoryStub(env: Env, variantId: string): DurableObjectStub<InventoryDO> {
  return env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName(variantId));
}

export function reservationIdForOrderLine(orderId: string, variantId: string): string {
  return `${orderId}:${variantId}`;
}

/**
 * Seed the per-variant ledger from D1 the first time this DO is touched.
 * Later checkouts use the DO balance; `reserve` decrements `available`.
 */
export async function syncInventoryDoFromD1(env: Env, variantId: string): Promise<void> {
  const stub = inventoryStub(env, variantId);
  const snap = await stub.available(variantId);
  const touched = snap.available !== 0 || snap.reserved !== 0 || snap.sold !== 0;
  if (touched) return;

  const row = await env.DB.prepare(`SELECT available FROM inventory WHERE variant_id = ?`)
    .bind(variantId)
    .first<{ available: number | string }>();
  if (!row) return;
  const available = typeof row.available === "string" ? Number(row.available) : row.available;
  if (!Number.isSafeInteger(available)) return;
  await stub.setStock(variantId, available);
}

/** Force DO `available` to match an admin D1 write (preserves reserved/sold). */
export async function reconcileInventoryDoAvailable(
  env: Env,
  variantId: string,
  available: number
): Promise<void> {
  if (!Number.isSafeInteger(available) || available < 0) {
    throw new Error("invalid_available");
  }
  await inventoryStub(env, variantId).setStock(variantId, available);
}

/** Decrement available stock inside InventoryDO (moved into `reserved`). */
export async function reserveLineStock(
  env: Env,
  variantId: string,
  qty: number,
  reservationId: string
): Promise<void> {
  await syncInventoryDoFromD1(env, variantId);
  await inventoryStub(env, variantId).reserve(variantId, qty, reservationId);
}

export async function releaseReservation(
  env: Env,
  variantId: string,
  reservationId: string
): Promise<void> {
  await inventoryStub(env, variantId).release(reservationId);
}

export async function releaseOrderReservations(
  env: Env,
  orderId: string,
  lines: { variantId: string }[]
): Promise<void> {
  for (const line of lines) {
    try {
      await releaseReservation(env, line.variantId, reservationIdForOrderLine(orderId, line.variantId));
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "release_reservation_failed",
          orderId,
          variantId: line.variantId,
          error: String(err),
        })
      );
    }
  }
}
