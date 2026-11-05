ALTER TABLE workspaces ADD COLUMN paypal_subscription_id TEXT UNIQUE;
ALTER TABLE store_orders ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'stripe' CHECK(payment_provider IN ('stripe','paypal'));
ALTER TABLE store_orders ADD COLUMN paypal_order_id TEXT UNIQUE;
CREATE TABLE paypal_events (id TEXT PRIMARY KEY,created_at BIGINT NOT NULL);
