-- Users, addresses, flat shipping, orders, and shipments.
-- Checkout does not write orders yet; admin list/ship still need the tables.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_addresses_user ON addresses (user_id);

CREATE TABLE shipping_methods (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('HK', 'INTL')),
  currency TEXT NOT NULL DEFAULT 'usd',
  amount INTEGER NOT NULL
);

INSERT INTO shipping_methods (id, code, title, zone, currency, amount) VALUES
  ('ship_hk', 'hk', 'Hong Kong', 'HK', 'usd', 500),
  ('ship_intl', 'international', 'International', 'INTL', 'usd', 2500);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'shipped', 'delivered', 'refunded')),
  currency TEXT NOT NULL DEFAULT 'usd',
  subtotal INTEGER NOT NULL,
  shipping_amount INTEGER NOT NULL DEFAULT 0,
  shipping_method_id TEXT REFERENCES shipping_methods(id),
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  address_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_orders_created ON orders (created_at);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_amount INTEGER NOT NULL
);

CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
