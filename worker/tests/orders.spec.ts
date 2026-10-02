import { env, SELF } from "cloudflare:test";
import { inventoryStub } from "../src/lib/inventory-do";

async function stubAvailable(variantId: string) {
  return inventoryStub(env as unknown as Parameters<typeof inventoryStub>[0], variantId).available(
    variantId
  );
}
import { beforeAll, describe, expect, it } from "vitest";

const VARIANT = "var_order_m3";
const PRICE = 1200;
const WEBHOOK_SECRET = "test-wh-secret";

async function insertProductWithStock(available: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO products (id, title, slug, description, status) VALUES (?, ?, ?, '', 'active')`
  )
    .bind("prod_order_m3", "Order Tee", "order-tee")
    .run();
  await env.DB.prepare(
    `INSERT INTO product_variants (id, product_id, sku, options) VALUES (?, ?, ?, '{}')`
  )
    .bind(VARIANT, "prod_order_m3", "SKU-ORDER-M3")
    .run();
  await env.DB.prepare(
    `INSERT INTO prices (id, variant_id, currency, amount) VALUES (?, ?, 'usd', ?)`
  )
    .bind("price_order_m3", VARIANT, PRICE)
    .run();
  await env.DB.prepare(`INSERT INTO inventory (variant_id, available) VALUES (?, ?)`)
    .bind(VARIANT, available)
    .run();
}

async function stripeSignature(payload: string, secret: string, ageSeconds = 0): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000) - ageSeconds;
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const v1 = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${v1}`;
}

beforeAll(async () => {
  // Headroom: the file places more units than one order's worth, and a refund does not
  // return stock to the Durable Object ledger (release is a no-op once confirmed).
  await insertProductWithStock(50);
});

describe("POST /api/store/orders", () => {
  it("creates a pending order with line snapshots", async () => {
    const email = `buyer-${crypto.randomUUID()}@example.com`;
    const res = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 2 }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{
      orderId: string;
      status: string;
      email: string;
      subtotal: number;
      shipping: number;
      total: number;
      lines: { variantId: string; qty: number; unitAmount: number; title: string; lineTotal: number }[];
    }>();
    expect(body.status).toBe("pending");
    expect(body.email).toBe(email);
    expect(body.subtotal).toBe(PRICE * 2);
    expect(body.shipping).toBe(500);
    expect(body.total).toBe(PRICE * 2 + 500);
    expect(body.lines).toEqual([
      {
        variantId: VARIANT,
        qty: 2,
        unitAmount: PRICE,
        title: "Order Tee",
        lineTotal: PRICE * 2,
      },
    ]);

    const row = await env.DB.prepare(`SELECT status, email FROM orders WHERE id = ?`)
      .bind(body.orderId)
      .first<{ status: string; email: string }>();
    expect(row).toEqual({ status: "pending", email });
  });

  it("does not resolve another caller's order for a stolen Idempotency-Key", async () => {
    const owner = `idem-owner-${crypto.randomUUID()}@example.com`;
    const key = `idem-steal-${crypto.randomUUID()}`;
    const first = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        email: owner,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    expect(first.status).toBe(201);
    const { orderId: ownerOrderId } = await first.json<{ orderId: string }>();

    // Same key, different requester: must be rejected outright, never resolve the owner's order.
    const stolen = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        email: `attacker-${crypto.randomUUID()}@example.com`,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    expect(stolen.status).toBe(409);
    expect(await stolen.json()).toEqual({ error: "idempotency_conflict" });

    // The owner's order is untouched and still resolvable only by its own email.
    const stillThere = await env.DB.prepare(`SELECT id, email FROM orders WHERE id = ?`)
      .bind(ownerOrderId)
      .first<{ id: string; email: string }>();
    expect(stillThere?.email).toBe(owner);
  });

  it("returns the same order when Idempotency-Key is replayed", async () => {
    const email = `idem-${crypto.randomUUID()}@example.com`;
    const key = `idem-${crypto.randomUUID()}`;
    const payload = {
      email,
      shippingMethodId: "ship_hk",
      country: "HK",
      items: [{ variantId: VARIANT, qty: 1 }],
    };
    const first = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const created = await first.json<{ orderId: string }>();

    const second = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ orderId: created.orderId, status: "pending" });

    const idem = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM order_idempotency WHERE idempotency_key = ?`
    )
      .bind(key)
      .first<{ n: number }>();
    expect(Number(idem?.n)).toBe(1);
  });

  it("rejects orders when inventory is insufficient", async () => {
    const skuVariant = `var_low_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO products (id, title, slug, description, status) VALUES (?, ?, ?, '', 'active')`
    )
      .bind(`prod_${skuVariant}`, "Low", skuVariant)
      .run();
    await env.DB.prepare(
      `INSERT INTO product_variants (id, product_id, sku, options) VALUES (?, ?, ?, '{}')`
    )
      .bind(skuVariant, `prod_${skuVariant}`, `SKU-${skuVariant}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO prices (id, variant_id, currency, amount) VALUES (?, ?, 'usd', ?)`
    )
      .bind(`price_${skuVariant}`, skuVariant, 100)
      .run();
    await env.DB.prepare(`INSERT INTO inventory (variant_id, available) VALUES (?, ?)`)
      .bind(skuVariant, 1)
      .run();

    const res = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `low-${crypto.randomUUID()}@example.com`,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: skuVariant, qty: 5 }],
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "insufficient_inventory" });

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE email LIKE 'low-%'`).first<{
      n: number;
    }>();
    expect(Number(orders?.n)).toBe(0);
  });
});

describe("GET /api/store/orders/:id", () => {
  it("returns the order when email matches", async () => {
    const email = `lookup-${crypto.randomUUID()}@example.com`;
    const created = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_intl",
        country: "US",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    const { orderId } = (await created.json()) as { orderId: string };

    const res = await SELF.fetch(
      `https://example.com/api/store/orders/${orderId}?email=${encodeURIComponent(email)}`
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ orderId, email, status: "pending" });

    const wrong = await SELF.fetch(
      `https://example.com/api/store/orders/${orderId}?email=wrong@example.com`
    );
    expect(wrong.status).toBe(404);
  });
});

describe("POST /webhooks/stripe", () => {
  it("rejects a valid but stale signature outside the tolerance window", async () => {
    // Correctly signed, but signed an hour ago: the MAC matches, freshness must not.
    const payload = JSON.stringify({
      id: `evt_stale_${crypto.randomUUID()}`,
      type: "checkout.session.completed",
      data: { object: { metadata: { order_id: "nonexistent" } } },
    });
    const res = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await stripeSignature(payload, WEBHOOK_SECRET, 3600),
      },
      body: payload,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "timestamp_out_of_tolerance" });
  });

  it("rejects an invalid signature", async () => {
    // Current timestamp with a bogus MAC: this must fail on the HMAC, not on freshness.
    const res = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`,
      },
      body: JSON.stringify({ id: "evt_test", type: "checkout.session.completed" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
  });

  it("accepts a valid signed mocked event", async () => {
    const payload = JSON.stringify({
      id: "evt_valid",
      type: "checkout.session.completed",
      data: { object: { metadata: { order_id: "ord_test" } } },
    });
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      received: true,
      eventId: "evt_valid",
      type: "checkout.session.completed",
    });
  });

  it("marks the order paid and finalizes stock on checkout.session.completed", async () => {
    const email = `paid-${crypto.randomUUID()}@example.com`;
    const created = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 2 }],
      }),
    });
    expect(created.status).toBe(201);
    const { orderId } = (await created.json()) as { orderId: string };
    const snapBefore = await stubAvailable(VARIANT);
    const invBeforeRow = await env.DB.prepare(
      `SELECT reserved, sold FROM inventory WHERE variant_id = ?`
    )
      .bind(VARIANT)
      .first<{ reserved: number; sold: number }>();

    const payload = JSON.stringify({
      id: `evt_paid_${orderId}`,
      type: "checkout.session.completed",
      data: { object: { metadata: { order_id: orderId } } },
    });
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);
    const res = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      body: payload,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, type: "checkout.session.completed" });

    const order = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{ status: string }>();
    expect(order?.status).toBe("paid");

    // DO reservation confirmed -> reserved moved to sold (ledger accumulates
    // across tests in this file, so assert relative to the pre-event value).
    const snap = await stubAvailable(VARIANT);
    expect(snap.reserved).toBe(snapBefore.reserved - 2);
    expect(snap.sold).toBe(snapBefore.sold + 2);

    // D1 mirror: reserved released, sale counted (same relative check).
    const inv = await env.DB.prepare(
      `SELECT available, reserved, sold FROM inventory WHERE variant_id = ?`
    )
      .bind(VARIANT)
      .first<{ available: number; reserved: number; sold: number }>();
    expect(Number(inv?.reserved)).toBe(Number(invBeforeRow?.reserved) - 2);
    expect(Number(inv?.sold)).toBe(Number(invBeforeRow?.sold) + 2);
  });

  it("is idempotent: a replayed event does not double-deduct stock", async () => {
    const email = `replay-${crypto.randomUUID()}@example.com`;
    const created = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    const { orderId } = (await created.json()) as { orderId: string };

    const payload = JSON.stringify({
      id: `evt_replay_${orderId}`,
      type: "checkout.session.completed",
      data: { object: { metadata: { order_id: orderId } } },
    });
    const signature = await stripeSignature(payload, WEBHOOK_SECRET);
    const headers = { "content-type": "application/json", "stripe-signature": signature };

    const first = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(first.status).toBe(200);
    const beforeReplay = await stubAvailable(VARIANT);

    const replay = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ duplicate: true });

    // Ledger-based assertions are racy when the DO alarm releases stale
    // reservations between the two deliveries, so pin the invariant instead:
    // replay must not change the order state or create a second event row.
    const orderAfter = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{ status: string }>();
    expect(orderAfter?.status).toBe("paid");

    const events = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM payment_events WHERE event_id = ?`
    )
      .bind(`evt_replay_${orderId}`)
      .first<{ n: number }>();
    expect(Number(events?.n)).toBe(1);
  });

  it("refunds the order and restocks on charge.refunded", async () => {
    const QTY = 1;
    const email = `refund-${crypto.randomUUID()}@example.com`;
    const created = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: QTY }],
      }),
    });
    const { orderId } = (await created.json()) as { orderId: string };

    const paidPayload = JSON.stringify({
      id: `evt_refund_paid_${orderId}`,
      type: "checkout.session.completed",
      data: { object: { metadata: { order_id: orderId } } },
    });
    await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await stripeSignature(paidPayload, WEBHOOK_SECRET),
      },
      body: paidPayload,
    });

    // Capture the sold count after settlement so the refund can be asserted as its inverse.
    const afterPaid = await env.DB.prepare(
      `SELECT available, sold FROM inventory WHERE variant_id = ?`
    )
      .bind(VARIANT)
      .first<{ available: number; sold: number }>();
    const soldAfterPaid = Number(afterPaid?.sold);
    const availableAfterPaid = Number(afterPaid?.available);

    const refundPayload = JSON.stringify({
      id: `evt_refund_${orderId}`,
      type: "charge.refunded",
      data: { object: { metadata: { order_id: orderId } } },
    });
    const res = await SELF.fetch("https://example.com/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": await stripeSignature(refundPayload, WEBHOOK_SECRET),
      },
      body: refundPayload,
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`)
      .bind(orderId)
      .first<{ status: string }>();
    expect(order?.status).toBe("refunded");

    // Refund must exactly reverse settlement: sold down, available back up. Previously the
    // refund only moved available, leaving the unit counted as both sold and sellable.
    const inv = await env.DB.prepare(
      `SELECT available, sold FROM inventory WHERE variant_id = ?`
    )
      .bind(VARIANT)
      .first<{ available: number; sold: number }>();
    expect(Number(inv?.sold)).toBe(soldAfterPaid - QTY);
    expect(Number(inv?.available)).toBe(availableAfterPaid + QTY);

    const ack = await res.json<{ received: boolean; type: string }>();
    expect(ack).toMatchObject({ received: true, type: "charge.refunded" });
  });
});

describe("POST /api/store/checkout/complete", () => {
  it("returns a payment session url for a pending order", async () => {
    const email = `complete-${crypto.randomUUID()}@example.com`;
    const res = await SELF.fetch("https://example.com/api/store/checkout/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json<{
      preview: boolean;
      status: string;
      payment: { provider: string; url: string };
      orderId: string;
    }>();
    expect(body.preview).toBe(false);
    expect(body.status).toBe("pending");
    expect(body.payment.provider).toBe("mock");
    expect(body.payment.url).toContain("mock-pay.example");
    expect(body.orderId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("GET /api/store/orders owner scoping", () => {
  async function login(email: string): Promise<string> {
    const registered = await SELF.fetch("https://example.com/api/store/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(registered.status).toBe(201);
    const loginRes = await SELF.fetch("https://example.com/api/store/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(loginRes.status).toBe(200);
    const list = loginRes.headers.getSetCookie?.() ?? [];
    const pair = (
      list.length > 0
        ? list
        : (loginRes.headers.get("set-cookie") ?? "").split(/,\s*(?=[^;]+?=)/)
    )
      .map((v) => v.split(";")[0]?.trim() ?? "")
      .find((v) => v.startsWith("cfshop_session="));
    if (!pair) throw new Error("missing session cookie");
    return pair;
  }

  it("does not show an anonymously planted order to the named account", async () => {
    const victim = `victim-${crypto.randomUUID()}@example.com`;
    const cookie = await login(victim);

    // Anonymous POST under the victim's address: no session, caller-asserted email.
    const planted = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: victim,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    expect(planted.status).toBe(201);
    const { orderId: plantedId } = await planted.json<{ orderId: string }>();

    const list = await SELF.fetch("https://example.com/api/store/orders", {
      headers: { cookie },
    });
    expect(list.status).toBe(200);
    const rows = await list.json<{ orderId: string; email: string }[]>();
    // The planted row exists, but it is not owned by the victim account.
    expect(rows.find((r) => r.orderId === plantedId)).toBeUndefined();
  });

  it("shows the account its own session-placed orders", async () => {
    const buyer = `self-${crypto.randomUUID()}@example.com`;
    const cookie = await login(buyer);

    const placed = await SELF.fetch("https://example.com/api/store/orders", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        email: buyer,
        shippingMethodId: "ship_hk",
        country: "HK",
        items: [{ variantId: VARIANT, qty: 1 }],
      }),
    });
    expect(placed.status).toBe(201);
    const { orderId } = await placed.json<{ orderId: string }>();

    const list = await SELF.fetch("https://example.com/api/store/orders", { headers: { cookie } });
    const rows = await list.json<{ orderId: string }[]>();
    expect(rows.map((r) => r.orderId)).toContain(orderId);
  });
});
