-- Allow checkout orders in `pending` (awaiting payment) and idempotency keys.
-- SQLite cannot ALTER a CHECK constraint. Rebuild orders and recreate
-- dependent tables while foreign keys stay enabled (drop children first).

CREATE TABLE orders_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'unpaid', 'paid', 'shipped', 'delivered', 'refunded')
  ),
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal INTEGER NOT NULL,
  shipping_amount INTEGER NOT NULL DEFAULT 0,
  shipping_method_id TEXT REFERENCES shipping_methods(id),
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  address_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO orders_new (
  id, email, status, currency, subtotal, shipping_amount, shipping_method_id, tax, total, address_json, created_at
)
SELECT
  id, email, status, currency, subtotal, shipping_amount, shipping_method_id, tax, total, address_json, created_at
FROM orders;

CREATE TABLE order_items_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders_new(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_amount INTEGER NOT NULL
);

INSERT INTO order_items_new (id, order_id, variant_id, title, qty, unit_amount)
SELECT id, order_id, variant_id, title, qty, unit_amount FROM order_items;

CREATE TABLE shipments_new (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders_new(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO shipments_new (id, order_id, tracking_number, carrier, created_at)
SELECT id, order_id, tracking_number, carrier, created_at FROM shipments;

DROP TABLE shipments;
DROP TABLE order_items;
DROP TABLE orders;

ALTER TABLE orders_new RENAME TO orders;
ALTER TABLE order_items_new RENAME TO order_items;
ALTER TABLE shipments_new RENAME TO shipments;

CREATE INDEX idx_orders_created ON orders (created_at);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE order_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_order_idempotency_order ON order_idempotency (order_id);
