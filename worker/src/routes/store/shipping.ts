import { Hono } from "hono";

type ShippingRow = {
  id: string;
  code: string;
  title: string;
  zone: string;
  currency: string;
  amount: number;
};

export const shippingRoutes = new Hono<{ Bindings: Env }>();

function asCents(value: unknown): number | null {
  let amount = value;
  if (typeof amount === "bigint") amount = Number(amount);
  if (typeof amount === "string" && /^-?\d+$/.test(amount)) amount = Number(amount);
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) return null;
  return amount;
}

shippingRoutes.get("/shipping-methods", async (c) => {
  const raw = c.req.query("country");
  const country = raw && raw.trim() !== "" ? raw.trim() : null;
  const upper = country?.toUpperCase() ?? null;

  const { results } = await c.env.DB.prepare(
    `SELECT id, code, title, zone, currency, amount
     FROM shipping_methods
     ORDER BY CASE zone WHEN 'HK' THEN 0 ELSE 1 END, id`
  ).all<ShippingRow>();

  const methods = results.flatMap((row) => {
    const zone = String(row.zone);
    const amount = asCents(row.amount);
    if (amount === null) return [];
    const selected =
      upper === null ? false : upper === "HK" ? zone === "HK" : zone === "INTL";
    return [
      {
        id: String(row.id),
        code: String(row.code),
        title: String(row.title),
        zone,
        currency: String(row.currency),
        amount,
        selected,
      },
    ];
  });

  methods.sort((a, b) => {
    if (a.selected === b.selected) return 0;
    return a.selected ? -1 : 1;
  });

  return c.json({ country, methods });
});
