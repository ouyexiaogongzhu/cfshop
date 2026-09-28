-- Payment event idempotency for Stripe webhooks.
-- A unique (provider, event_id) pair guarantees each provider event is
-- processed at most once even when Stripe retries delivery.

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  order_id TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, event_id)
);

CREATE INDEX idx_payment_events_order ON payment_events (order_id);
