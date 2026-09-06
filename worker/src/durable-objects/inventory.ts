import { DurableObject } from "cloudflare:workers";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export type ReservationStatus = "reserved" | "released" | "confirmed";

export type StockSnapshot = {
  variantId: string;
  available: number;
  reserved: number;
  sold: number;
};

/**
 * Per-variant stock ledger: reserve moves available→reserved, confirm moves
 * reserved→sold, release/alarm-expiry moves reserved→available.
 * Callers pass their own reservationId (UUID) so retries are idempotent
 * via the PRIMARY KEY.
 *
 * Atomicity note: DO SQLite `sql.exec` is synchronous and the DO is
 * single-threaded per event loop turn, so the check → insert → decrement
 * sequence in reserve() cannot interleave with another RPC — it is atomic
 * without an explicit transaction. If async I/O ever gets interleaved into
 * this method, wrap the writes in ctx.storage.transaction() instead.
 */
export class InventoryDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS stock (
        variant_id TEXT PRIMARY KEY,
        available INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        sold INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL,
        qty INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        reserved_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reservations_expiry
        ON reservations (status, reserved_at);
    `);
  }

  async reserve(variantId: string, qty: number, reservationId: string): Promise<void> {
    if (qty <= 0) throw new Error("qty must be positive");
    // Idempotency: a repeated reservationId is a no-op, not an error.
    const existing = this.ctx.storage.sql
      .exec(`SELECT id FROM reservations WHERE id = ?`, reservationId)
      .toArray();
    if (existing.length > 0) return;

    const snapshot = this.#stockRow(variantId);
    if (snapshot.available < qty) throw new Error(`insufficient stock for ${variantId}`);

    this.ctx.storage.sql.exec(
      `INSERT INTO reservations (id, variant_id, qty, status, reserved_at)
       VALUES (?, ?, ?, 'reserved', ?)`,
      reservationId,
      variantId,
      qty,
      Date.now()
    );
    this.ctx.storage.sql.exec(
      `UPDATE stock SET available = available - ?, reserved = reserved + ?
       WHERE variant_id = ?`,
      qty,
      qty,
      variantId
    );
    // Make sure the expiry alarm is armed (keep an existing earlier alarm).
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + RESERVATION_TTL_MS);
    }
  }

  // Flip a live reservation and rebalance the ledger in one synchronous pass.
  #settle(reservationId: string, status: Exclude<ReservationStatus, "reserved">): void {
    const changed = this.ctx.storage.sql
      .exec(
        `UPDATE reservations SET status = ? WHERE id = ? AND status = 'reserved'
         RETURNING qty, variant_id`,
        status,
        reservationId
      )
      .toArray();
    for (const row of changed) {
      const r = row as Record<string, string | number>;
      // released: reserved→available. confirmed: reserved→sold.
      const column = status === "released" ? "available" : "sold";
      this.ctx.storage.sql.exec(
        `UPDATE stock SET reserved = reserved - ?, ${column} = ${column} + ?
         WHERE variant_id = ?`,
        Number(r.qty),
        Number(r.qty),
        String(r.variant_id)
      );
    }
  }

  async release(reservationId: string): Promise<void> {
    this.#settle(reservationId, "released");
  }

  async confirm(reservationId: string): Promise<void> {
    this.#settle(reservationId, "confirmed");
  }

  async available(variantId: string): Promise<StockSnapshot> {
    return this.#stockRow(variantId);
  }

  async setStock(variantId: string, available: number): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO stock (variant_id, available) VALUES (?, ?)
       ON CONFLICT(variant_id) DO UPDATE SET available = excluded.available`,
      variantId,
      available
    );
  }

  #stockRow(variantId: string): StockSnapshot {
    const rows = this.ctx.storage.sql
      .exec<Record<string, string | number>>(
        `SELECT available, reserved, sold FROM stock WHERE variant_id = ?`,
        variantId
      )
      .toArray();
    if (rows.length === 0) return { variantId, available: 0, reserved: 0, sold: 0 };
    const r = rows[0]!;
    return {
      variantId,
      available: Number(r.available),
      reserved: Number(r.reserved),
      sold: Number(r.sold),
    };
  }

  // Release reservations older than the TTL, then re-arm for the next expiry.
  async alarm(): Promise<void> {
    const cutoff = Date.now() - RESERVATION_TTL_MS;
    const expired = this.ctx.storage.sql
      .exec<Record<string, string | number>>(
        `UPDATE reservations SET status = 'released'
         WHERE status = 'reserved' AND reserved_at < ?
         RETURNING qty, variant_id`,
        cutoff
      )
      .toArray();
    for (const row of expired) {
      this.ctx.storage.sql.exec(
        `UPDATE stock SET available = available + ?, reserved = reserved - ?
         WHERE variant_id = ?`,
        Number(row.qty),
        Number(row.qty),
        String(row.variant_id)
      );
    }
    const next = this.ctx.storage.sql
      .exec<Record<string, string | number>>(
        `SELECT MIN(reserved_at) AS next_at FROM reservations WHERE status = 'reserved'`
      )
      .toArray();
    const nextAt = next.length > 0 ? Number(next[0]!.next_at) : NaN;
    if (Number.isFinite(nextAt)) {
      await this.ctx.storage.setAlarm(Math.max(nextAt + RESERVATION_TTL_MS, Date.now() + 1000));
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}
