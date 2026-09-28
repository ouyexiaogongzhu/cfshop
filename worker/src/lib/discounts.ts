export type DiscountType = "percentage" | "fixed_amount";
export type DiscountStatus = "active" | "disabled";

export type Discount = {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  status: DiscountStatus;
  min_purchase_cents: number;
  max_discount_cents: number | null;
  starts_at: string | null;
  expires_at: string | null;
  usage_limit: number | null;
  usage_count: number;
};

export type AppliedDiscount = {
  discountId: string;
  code: string;
  amount: number;
};

export class DiscountError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "DiscountError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function validateDiscount(
  db: D1Database,
  discount: Discount,
  subtotalCents: number,
  _customerEmail?: string
): Promise<void> {
  if (discount.status !== "active") {
    throw new DiscountError("Discount is not active");
  }

  const currentTime = nowIso();
  if (discount.starts_at && currentTime < discount.starts_at) {
    throw new DiscountError("Discount has not started yet");
  }
  if (discount.expires_at && currentTime > discount.expires_at) {
    throw new DiscountError("Discount has expired");
  }

  if (discount.min_purchase_cents > 0 && subtotalCents < discount.min_purchase_cents) {
    throw new DiscountError(
      `Minimum purchase of $${(discount.min_purchase_cents / 100).toFixed(2)} required`
    );
  }

  if (discount.usage_limit !== null && discount.usage_count >= discount.usage_limit) {
    throw new DiscountError("Discount usage limit reached");
  }
}

export function calculateDiscount(discount: Discount, subtotalCents: number): number {
  switch (discount.type) {
    case "percentage": {
      let amount = Math.floor((subtotalCents * discount.value) / 100);
      if (discount.max_discount_cents !== null && amount > discount.max_discount_cents) {
        amount = discount.max_discount_cents;
      }
      return amount;
    }
    case "fixed_amount": {
      return Math.min(discount.value, subtotalCents);
    }
    default:
      return 0;
  }
}

export async function applyDiscountCode(
  db: D1Database,
  code: string,
  subtotalCents: number,
  email?: string
): Promise<AppliedDiscount> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) throw new DiscountError("Discount code is required");

  const row = await db
    .prepare(
      `SELECT id, code, type, value, status, min_purchase_cents, max_discount_cents,
              starts_at, expires_at, usage_limit, usage_count
       FROM discounts WHERE code = ?`
    )
    .bind(normalized)
    .first<Discount>();

  if (!row) throw new DiscountError("Discount code not found");

  const discount: Discount = {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    status: row.status,
    min_purchase_cents: Number(row.min_purchase_cents),
    max_discount_cents: row.max_discount_cents === null ? null : Number(row.max_discount_cents),
    starts_at: row.starts_at,
    expires_at: row.expires_at,
    usage_limit: row.usage_limit === null ? null : Number(row.usage_limit),
    usage_count: Number(row.usage_count),
  };

  await validateDiscount(db, discount, subtotalCents, email);
  const amount = calculateDiscount(discount, subtotalCents);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new DiscountError("Invalid discount amount");
  }

  return { discountId: discount.id, code: discount.code, amount };
}
