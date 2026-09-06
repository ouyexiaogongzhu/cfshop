-- M1 initial schema (SQLite/D1 dialect). IDs are TEXT (crypto.randomUUID() app-side).
PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  options TEXT NOT NULL DEFAULT '{}', -- JSON, e.g. {"size":"M"}
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE product_categories (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE TABLE prices (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cents
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (variant_id, currency)
);

CREATE TABLE inventory (
  variant_id TEXT PRIMARY KEY,
  available INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

-- Indexes: slug lookups + FK join columns.
CREATE INDEX idx_products_status ON products (status);
CREATE INDEX idx_variants_product ON product_variants (product_id);
CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_product_categories_category ON product_categories (category_id);
CREATE INDEX idx_prices_variant ON prices (variant_id);
CREATE INDEX idx_movements_variant ON inventory_movements (variant_id);
CREATE INDEX idx_outbox_status ON outbox (status);
