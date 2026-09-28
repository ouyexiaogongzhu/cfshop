import { Hono } from "hono";

type DiscountType = "percentage" | "fixed_amount";
type DiscountStatus = "active" | "disabled";

type DiscountRow = {
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
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isDiscountType(value: unknown): value is DiscountType {
  return value === "percentage" || value === "fixed_amount";
}

function isDiscountStatus(value: unknown): value is DiscountStatus {
  return value === "active" || value === "disabled";
}

function isUniqueViolation(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNIQUE constraint failed");
}

function toJson(row: DiscountRow) {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: Number(row.value),
    status: row.status,
    minPurchaseCents: Number(row.min_purchase_cents),
    maxDiscountCents: row.max_discount_cents === null ? null : Number(row.max_discount_cents),
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
    usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
    usageCount: Number(row.usage_count),
    createdAt: row.created_at,
  };
}

export const discountRoutes = new Hono<{ Bindings: Env }>();

discountRoutes.get("/discounts", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, code, type, value, status, min_purchase_cents, max_discount_cents,
            starts_at, expires_at, usage_limit, usage_count, created_at
     FROM discounts
     ORDER BY created_at DESC`
  ).all<DiscountRow>();

  return c.json((results ?? []).map(toJson));
});

discountRoutes.post("/discounts", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "bad_request" }, 400);

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const type = body.type;
  const value = body.value;
  if (!code || !isDiscountType(type) || !isInteger(value) || value < 0) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (type === "percentage" && value > 100) {
    return c.json({ error: "bad_request" }, 400);
  }

  const minPurchaseCents =
    body.minPurchaseCents === undefined ? 0 : body.minPurchaseCents;
  const maxDiscountCents =
    body.maxDiscountCents === undefined ? null : body.maxDiscountCents;
  const startsAt = body.startsAt === undefined ? null : body.startsAt;
  const expiresAt = body.expiresAt === undefined ? null : body.expiresAt;
  const usageLimit = body.usageLimit === undefined ? null : body.usageLimit;

  if (!isInteger(minPurchaseCents) || minPurchaseCents < 0) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (
    maxDiscountCents !== null &&
    (!isInteger(maxDiscountCents) || maxDiscountCents < 0)
  ) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (startsAt !== null && typeof startsAt !== "string") {
    return c.json({ error: "bad_request" }, 400);
  }
  if (expiresAt !== null && typeof expiresAt !== "string") {
    return c.json({ error: "bad_request" }, 400);
  }
  if (usageLimit !== null && (!isInteger(usageLimit) || usageLimit < 0)) {
    return c.json({ error: "bad_request" }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO discounts (
         id, code, type, value, status, min_purchase_cents, max_discount_cents,
         starts_at, expires_at, usage_limit
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        code,
        type,
        value,
        minPurchaseCents,
        maxDiscountCents,
        startsAt,
        expiresAt,
        usageLimit
      )
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) return c.json({ error: "conflict" }, 409);
    throw err;
  }

  const row = await c.env.DB.prepare(
    `SELECT id, code, type, value, status, min_purchase_cents, max_discount_cents,
            starts_at, expires_at, usage_limit, usage_count, created_at
     FROM discounts WHERE id = ?`
  )
    .bind(id)
    .first<DiscountRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toJson(row), 201);
});

discountRoutes.patch("/discounts/:id", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "bad_request" }, 400);

  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT id, type FROM discounts WHERE id = ?`)
    .bind(id)
    .first<{ id: string; type: DiscountType }>();
  if (!existing) return c.json({ error: "not_found" }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];

  if (body.status !== undefined) {
    if (!isDiscountStatus(body.status)) return c.json({ error: "bad_request" }, 400);
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (body.code !== undefined) {
    if (typeof body.code !== "string" || body.code.trim().length === 0) {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("code = ?");
    binds.push(body.code.trim().toUpperCase());
  }
  if (body.value !== undefined) {
    if (!isInteger(body.value) || body.value < 0) return c.json({ error: "bad_request" }, 400);
    if (existing.type === "percentage" && body.value > 100) {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("value = ?");
    binds.push(body.value);
  }
  if (body.minPurchaseCents !== undefined) {
    if (!isInteger(body.minPurchaseCents) || body.minPurchaseCents < 0) {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("min_purchase_cents = ?");
    binds.push(body.minPurchaseCents);
  }
  if (body.maxDiscountCents !== undefined) {
    if (
      body.maxDiscountCents !== null &&
      (!isInteger(body.maxDiscountCents) || body.maxDiscountCents < 0)
    ) {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("max_discount_cents = ?");
    binds.push(body.maxDiscountCents);
  }
  if (body.startsAt !== undefined) {
    if (body.startsAt !== null && typeof body.startsAt !== "string") {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("starts_at = ?");
    binds.push(body.startsAt);
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt !== null && typeof body.expiresAt !== "string") {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("expires_at = ?");
    binds.push(body.expiresAt);
  }
  if (body.usageLimit !== undefined) {
    if (body.usageLimit !== null && (!isInteger(body.usageLimit) || body.usageLimit < 0)) {
      return c.json({ error: "bad_request" }, 400);
    }
    sets.push("usage_limit = ?");
    binds.push(body.usageLimit);
  }

  if (sets.length > 0) {
    try {
      await c.env.DB.prepare(`UPDATE discounts SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...binds, id)
        .run();
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: "conflict" }, 409);
      throw err;
    }
  }

  const row = await c.env.DB.prepare(
    `SELECT id, code, type, value, status, min_purchase_cents, max_discount_cents,
            starts_at, expires_at, usage_limit, usage_count, created_at
     FROM discounts WHERE id = ?`
  )
    .bind(id)
    .first<DiscountRow>();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(toJson(row));
});
