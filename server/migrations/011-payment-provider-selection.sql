ALTER TABLE community_stores ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'stripe'
  CHECK(payment_provider IN ('stripe','paypal_ipn','paypal_business','tebex'));
ALTER TABLE community_stores ADD COLUMN payment_checkout_url TEXT NOT NULL DEFAULT '';
