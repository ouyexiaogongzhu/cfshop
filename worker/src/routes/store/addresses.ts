import { Hono } from "hono";
import type { Context } from "hono";
import { readSessionUserId, sessionCookie } from "../../lib/session";

export const addressRoutes = new Hono<{ Bindings: Env }>();

type AddressRow = {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
};

type Address = {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    name: row.name,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
  };
}

function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 200) return null;
  return text;
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > 200) return null;
  return text;
}

async function signedInUserId(c: Context<{ Bindings: Env }>): Promise<string | null> {
  return readSessionUserId(c.env.CACHE, sessionCookie(c));
}

addressRoutes.get("/addresses", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const { results } = await c.env.DB.prepare(
    `SELECT id, name, line1, line2, city, region, postal_code, country
     FROM addresses
     WHERE user_id = ?
     ORDER BY rowid`
  )
    .bind(userId)
    .all<AddressRow>();
  return c.json(results.map(toAddress));
});

addressRoutes.post("/addresses", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }
  if (!isRecord(body)) return c.json({ error: "invalid_input" }, 400);

  const name = requiredText(body.name);
  const line1 = requiredText(body.line1);
  const line2 = optionalText(body.line2);
  const city = requiredText(body.city);
  const region = optionalText(body.region);
  const postalCode = optionalText(body.postalCode);
  const country =
    typeof body.country === "string" && /^[A-Za-z]{2}$/.test(body.country.trim())
      ? body.country.trim().toUpperCase()
      : null;

  if (!name || !line1 || line2 === null || !city || region === null || postalCode === null || !country) {
    return c.json({ error: "invalid_input" }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO addresses (id, user_id, name, line1, line2, city, region, postal_code, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, name, line1, line2, city, region, postalCode, country)
    .run();

  const address: Address = { id, name, line1, line2, city, region, postalCode, country };
  return c.json(address, 201);
});

addressRoutes.delete("/addresses/:id", async (c) => {
  const userId = await signedInUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const deleted = await c.env.DB.prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  if (deleted.meta.changes === 0) return c.json({ error: "not_found" }, 404);
  return c.body(null, 204);
});
