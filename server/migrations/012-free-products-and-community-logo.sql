ALTER TABLE store_products DROP CONSTRAINT store_products_price_check;
ALTER TABLE store_products ADD CONSTRAINT store_products_price_check CHECK(price BETWEEN 0 AND 100000);
ALTER TABLE community_sites ADD COLUMN logo_url TEXT NOT NULL DEFAULT '';
