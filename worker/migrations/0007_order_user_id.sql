-- Bind orders to the account that placed them.
--
-- `email` alone is caller-asserted at guest checkout, so an anonymous POST could write a
-- row into a registered customer's account order history. `user_id` records the session
-- principal when there is one; guest rows stay NULL and keep their existing
-- orderId + email retrieval path.
--
-- Plain ADD COLUMN: no CHECK constraint changes, so no table rebuild is needed.

ALTER TABLE orders ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id, created_at DESC);
