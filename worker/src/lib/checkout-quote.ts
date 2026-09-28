export type QuoteLine = { variantId: string; qty: number };

export type PricedLine = QuoteLine & {
  unitAmount: number;
  title: string;
  lineTotal: number;
};

export type CheckoutQuote = {
  currency: "usd";
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  shippingMethodId: string;
  country: string | null;
  lines: PricedLine[];
};

export type QuoteInput = {
  shippingMethodId: string;
  country: string | null;
  lines: QuoteLine[];
};

export function asCents(value: unknown): number | null {
  let amount = value;
  if (typeof amount === "bigint") amount = Number(amount);
  if (typeof amount === "string" && /^-?\d+$/.test(amount)) amount = Number(amount);
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) return null;
  return amount;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function parseQuoteLines(value: unknown): QuoteLine[] | "invalid" {
  if (!Array.isArray(value)) return "invalid";
  const lines: QuoteLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "invalid";
    const variantId = (entry as { variantId?: unknown }).variantId;
    const qty = positiveInteger((entry as { qty?: unknown }).qty);
    if (typeof variantId !== "string" || variantId.length === 0 || qty === null) return "invalid";
    lines.push({ variantId, qty });
  }
  return lines;
}

/** Combine duplicate variant rows so one reservation covers the full quantity. */
export function mergeQuoteLines(lines: QuoteLine[]): QuoteLine[] | "invalid" {
  const qtyByVariant = new Map<string, number>();
  const order: string[] = [];
  for (const line of lines) {
    const next = (qtyByVariant.get(line.variantId) ?? 0) + line.qty;
    if (!Number.isSafeInteger(next) || next <= 0) return "invalid";
    if (!qtyByVariant.has(line.variantId)) order.push(line.variantId);
    qtyByVariant.set(line.variantId, next);
  }
  return order.map((variantId) => ({ variantId, qty: qtyByVariant.get(variantId) ?? 0 }));
}

export function normalizeCountry(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toUpperCase();
}

async function activeVariantPrice(
  db: D1Database,
  variantId: string
): Promise<{ unitAmount: number; title: string } | null> {
  const row = await db
    .prepare(
      `SELECT pr.amount AS amount, p.title AS title
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       JOIN prices pr ON pr.variant_id = v.id AND pr.currency = 'usd'
       WHERE v.id = ? AND p.status = 'active'`
    )
    .bind(variantId)
    .first<{ amount: number; title: string }>();
  if (!row) return null;
  const unitAmount = asCents(row.amount);
  if (unitAmount === null) return null;
  return { unitAmount, title: row.title };
}

export async function buildCheckoutQuote(
  db: D1Database,
  input: QuoteInput
): Promise<CheckoutQuote | "not_found" | "invalid"> {
  if (input.lines.length === 0) return "invalid";

  const merged = mergeQuoteLines(input.lines);
  if (merged === "invalid") return "invalid";

  const prices = new Map<string, { unitAmount: number; title: string }>();
  const priced: PricedLine[] = [];
  let subtotal = 0;

  for (const line of merged) {
    let row = prices.get(line.variantId);
    if (row === undefined) {
      const lookedUp = await activeVariantPrice(db, line.variantId);
      if (lookedUp === null) return "not_found";
      row = lookedUp;
      prices.set(line.variantId, row);
    }
    const lineTotal = row.unitAmount * line.qty;
    if (!Number.isSafeInteger(lineTotal)) return "invalid";
    subtotal += lineTotal;
    priced.push({
      variantId: line.variantId,
      qty: line.qty,
      unitAmount: row.unitAmount,
      title: row.title,
      lineTotal,
    });
  }

  const method = await db
    .prepare(`SELECT amount FROM shipping_methods WHERE id = ?`)
    .bind(input.shippingMethodId)
    .first<{ amount: number }>();
  if (!method) return "not_found";
  const shipping = asCents(method.amount);
  if (shipping === null) return "not_found";

  const tax = 0;
  const total = subtotal + shipping + tax;
  if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total)) return "invalid";

  return {
    currency: "usd",
    subtotal,
    shipping,
    tax,
    total,
    shippingMethodId: input.shippingMethodId,
    country: input.country,
    lines: priced,
  };
}
