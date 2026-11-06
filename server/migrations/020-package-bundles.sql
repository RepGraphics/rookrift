ALTER TABLE store_products ADD COLUMN bundle_contents TEXT NOT NULL DEFAULT '[]';
ALTER TABLE store_orders ADD COLUMN bundle_contents TEXT NOT NULL DEFAULT '[]';
