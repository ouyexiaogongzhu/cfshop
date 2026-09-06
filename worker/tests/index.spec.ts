import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { InventoryDO } from "../src/durable-objects/inventory";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/store/products", () => {
  it("returns an empty array when no active products exist", async () => {
    const res = await SELF.fetch("https://example.com/api/store/products");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("returns 404 for an unknown product slug", async () => {
    const res = await SELF.fetch("https://example.com/api/store/products/nope");
    expect(res.status).toBe(404);
  });
});

describe("InventoryDO", () => {
  it("reserve drops availability, release restores it", async () => {
    const stub = env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName("test-reserve-release"));
    const out = await runInDurableObject(stub, async (instance) => {
      await instance.setStock("v_test", 10);
      await instance.reserve("v_test", 3, "res-1");
      const during = await instance.available("v_test");
      await instance.release("res-1");
      const after = await instance.available("v_test");
      return { during, after };
    });
    expect(out.during).toEqual({ variantId: "v_test", available: 7, reserved: 3, sold: 0 });
    expect(out.after).toEqual({ variantId: "v_test", available: 10, reserved: 0, sold: 0 });
  });

  it("confirm moves reserved stock into sold", async () => {
    const stub = env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName("test-confirm"));
    const snap = await runInDurableObject(stub, async (instance) => {
      await instance.setStock("v_c", 10);
      await instance.reserve("v_c", 3, "res-c1");
      await instance.confirm("res-c1");
      return instance.available("v_c");
    });
    expect(snap).toEqual({ variantId: "v_c", available: 7, reserved: 0, sold: 3 });
  });

  it("rejects reserving more than available", async () => {
    const stub = env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName("test-over-reserve"));
    await expect(
      runInDurableObject(stub, async (instance) => {
        await instance.setStock("v_test", 2);
        await instance.reserve("v_test", 5, "res-2");
      })
    ).rejects.toThrow(/insufficient stock/);
  });

  // Flash-sale shape: 10 parallel buyers on stock of 5 → exactly 5 succeed,
  // no oversell. RPC calls on a stub are serialized by the DO runtime.
  it("sells exactly 5 units to 10 parallel reserves", async () => {
    const stub = env.INVENTORY_DO.get(env.INVENTORY_DO.idFromName("test-concurrent"));
    await runInDurableObject(stub, async (instance) => {
      await instance.setStock("v_flash", 5);
    });
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        stub.reserve("v_flash", 1, `res-conc-${i}`).then(
          () => "ok" as const,
          () => "rejected" as const
        )
      )
    );
    expect(outcomes.filter((o) => o === "ok").length).toBe(5);
    const snap = await stub.available("v_flash");
    expect(snap.available).toBe(0);
    expect(snap.reserved).toBe(5);
    expect(snap.sold).toBe(0);
  });
});
