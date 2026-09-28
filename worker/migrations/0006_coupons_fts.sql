-- Coupons/discounts, order discount columns, and products FTS5 search.

CREATE TABLE discounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed_amount')),
  value INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  min_purchase_cents INTEGER NOT NULL DEFAULT 0,
  max_discount_cents INTEGER,
  starts_at TEXT,
  expires_at TEXT,
  usage_limit INTEGER,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE discount_usage (
  id TEXT PRIMARY KEY,
  discount_id TEXT NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  discount_amount_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discount_usage_discount ON discount_usage (discount_id);
CREATE INDEX idx_discount_usage_order ON discount_usage (order_id);
CREATE INDEX idx_discount_usage_email ON discount_usage (discount_id, customer_email);

ALTER TABLE orders ADD COLUMN discount_code TEXT;
ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;

CREATE VIRTUAL TABLE products_fts USING fts5(
  title,
  description,
  slug,
  content='products',
  content_rowid='rowid'
);

CREATE TRIGGER products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, title, description, slug)
  VALUES (new.rowid, new.title, new.description, new.slug);
END;

CREATE TRIGGER products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, title, description, slug)
  VALUES ('delete', old.rowid, old.title, old.description, old.slug);
END;

CREATE TRIGGER products_fts_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, title, description, slug)
  VALUES ('delete', old.rowid, old.title, old.description, old.slug);
  INSERT INTO products_fts(rowid, title, description, slug)
  VALUES (new.rowid, new.title, new.description, new.slug);
END;

INSERT INTO products_fts(products_fts) VALUES ('rebuild');

INSERT INTO discounts (
  id, code, type, value, status, min_purchase_cents, max_discount_cents, usage_count
) VALUES (
  'disc_welcome10', 'WELCOME10', 'percentage', 10, 'active', 0, 2000, 0
);
