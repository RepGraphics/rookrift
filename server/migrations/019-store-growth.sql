ALTER TABLE store_products ADD COLUMN stock_limit INTEGER CHECK(stock_limit BETWEEN 0 AND 1000000);
ALTER TABLE store_products ADD COLUMN customer_limit INTEGER CHECK(customer_limit BETWEEN 1 AND 10000);
ALTER TABLE store_products ADD COLUMN available_from BIGINT;
ALTER TABLE store_products ADD COLUMN available_until BIGINT;
ALTER TABLE community_stores ADD COLUMN goal_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_stores ADD COLUMN goal_amount INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE community_stores ADD COLUMN goal_title TEXT NOT NULL DEFAULT 'Support this month’s server costs';
CREATE TABLE store_promotions (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 name TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('coupon','sale')),code TEXT,
 discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),discount_value INTEGER NOT NULL,
 minimum_amount INTEGER NOT NULL DEFAULT 0,product_ids TEXT NOT NULL DEFAULT '[]',category_ids TEXT NOT NULL DEFAULT '[]',
 starts_at BIGINT,ends_at BIGINT,usage_limit INTEGER,customer_limit INTEGER,
 enabled INTEGER NOT NULL DEFAULT 1,archived INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX idx_store_promotion_code ON store_promotions(workspace_id,code) WHERE code IS NOT NULL;
CREATE INDEX idx_store_promotions ON store_promotions(workspace_id,archived,enabled);
ALTER TABLE store_orders ADD COLUMN base_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_orders ADD COLUMN discount_label TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN discount_code TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN promotion_id TEXT REFERENCES store_promotions(id) ON DELETE SET NULL;
ALTER TABLE store_orders ADD COLUMN paid_at BIGINT;
UPDATE store_orders SET base_amount=amount;
UPDATE store_orders SET paid_at=created_at WHERE payment_status IN ('paid','refunded','partially_refunded','disputed');
CREATE INDEX idx_store_reservations ON store_orders(workspace_id,product_id,user_id,payment_status);
CREATE INDEX idx_store_promotion_usage ON store_orders(workspace_id,promotion_id,user_id,payment_status);
CREATE INDEX idx_store_sales_time ON store_orders(workspace_id,paid_at);
