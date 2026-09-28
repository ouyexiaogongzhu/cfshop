import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { CartDO } from "./durable-objects/cart";
import { InventoryDO } from "./durable-objects/inventory";
import { adminRoutes } from "./routes/admin/app";
import { addressRoutes } from "./routes/store/addresses";
import { authRoutes } from "./routes/store/auth";
import { cartRoutes } from "./routes/store/cart";
import { checkoutRoutes } from "./routes/store/checkout";
import { orderRoutes } from "./routes/store/orders";
import { productRoutes } from "./routes/store/products";
import { shippingRoutes } from "./routes/store/shipping";
import { stripeWebhookRoutes } from "./routes/webhooks/stripe";

export { CartDO, InventoryDO };

const app = new Hono<{ Bindings: Env }>();

// Request logging: method, path, status, ms.
app.use(async (c, next) => {
  const start = performance.now();
  await next();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "request",
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
    })
  );
});

app.onError((err, c) => {
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  if (status >= 500) {
    console.error(
      JSON.stringify({ level: "error", msg: "unhandled", path: c.req.path, error: String(err) })
    );
  }
  return c.json(
    { error: err instanceof Error ? err.message : "internal_error" },
    status as ContentfulStatusCode
  );
});

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ ok: true });
});

app.route("/api/store", productRoutes);
app.route("/api/store", authRoutes);
app.route("/api/store", addressRoutes);
app.route("/api/store", cartRoutes);
app.route("/api/store", shippingRoutes);
app.route("/api/store", checkoutRoutes);
app.route("/api/store", orderRoutes);
app.route("/api/admin", adminRoutes);
app.route("/webhooks", stripeWebhookRoutes);

export default {
  fetch: app.fetch,
  // Scaffold: log and ack. Real handlers (email, fulfillment, outbox drain) come later.
  queue: async (batch: MessageBatch<unknown>) => {
    for (const message of batch.messages) {
      console.log(JSON.stringify({ level: "info", msg: "queue_message", body: message.body }));
      message.ack();
    }
  },
};
