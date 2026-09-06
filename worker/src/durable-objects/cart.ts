import { DurableObject } from "cloudflare:workers";

export type CartItem = {
  itemId: string;
  variantId: string;
  qty: number;
};

export type CartState = {
  items: CartItem[];
  locked: boolean;
};

/**
 * Per-cart Durable Object. Cart state lives in the DO's private SQLite DB;
 * the checkout lock prevents mutation while an order is being placed.
 */
export class CartDO extends DurableObject {
  #lockKey = "checkout_locked";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS cart_items (
        item_id TEXT PRIMARY KEY,
        variant_id TEXT NOT NULL UNIQUE,
        qty INTEGER NOT NULL CHECK (qty > 0)
      )
    `);
  }

  async #isLocked(): Promise<boolean> {
    return (await this.ctx.storage.get<boolean>(this.#lockKey)) === true;
  }

  async #assertUnlocked(): Promise<void> {
    if (await this.#isLocked()) throw new Error("cart is locked for checkout");
  }

  async addItem(variantId: string, qty: number): Promise<CartState> {
    if (qty <= 0) throw new Error("qty must be positive");
    await this.#assertUnlocked();
    // Reuse the row when the variant is already in the cart.
    this.ctx.storage.sql.exec(
      `INSERT INTO cart_items (item_id, variant_id, qty) VALUES (?, ?, ?)
       ON CONFLICT(variant_id) DO UPDATE SET qty = qty + excluded.qty`,
      crypto.randomUUID(),
      variantId,
      qty
    );
    return this.getState();
  }

  async updateQty(itemId: string, qty: number): Promise<CartState> {
    await this.#assertUnlocked();
    if (qty <= 0) {
      return this.removeItem(itemId);
    }
    this.ctx.storage.sql.exec(
      `UPDATE cart_items SET qty = ? WHERE item_id = ?`,
      qty,
      itemId
    );
    return this.getState();
  }

  async removeItem(itemId: string): Promise<CartState> {
    await this.#assertUnlocked();
    this.ctx.storage.sql.exec(
      `DELETE FROM cart_items WHERE item_id = ?`,
      itemId
    );
    return this.getState();
  }

  async getState(): Promise<CartState> {
    const rows = this.ctx.storage.sql
      .exec<Record<string, string | number>>(
        `SELECT item_id, variant_id, qty FROM cart_items ORDER BY rowid`
      )
      .toArray();
    return {
      items: rows.map((r) => ({
        itemId: String(r.item_id),
        variantId: String(r.variant_id),
        qty: Number(r.qty),
      })),
      locked: await this.#isLocked(),
    };
  }

  async clear(): Promise<CartState> {
    await this.#assertUnlocked();
    this.ctx.storage.sql.exec(`DELETE FROM cart_items`);
    return this.getState();
  }

  async lock(): Promise<void> {
    await this.ctx.storage.put(this.#lockKey, true);
  }

  async unlock(): Promise<void> {
    await this.ctx.storage.put(this.#lockKey, false);
  }
}
