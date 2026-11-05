ALTER TABLE community_sites ADD COLUMN join_requests_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_sites ADD COLUMN staff_applications_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE community_sites ADD COLUMN join_questions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE community_sites ADD COLUMN staff_questions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE community_sites ADD COLUMN builder_draft TEXT NOT NULL DEFAULT '{}';
ALTER TABLE community_sites ADD COLUMN builder_published TEXT NOT NULL DEFAULT '{}';
ALTER TABLE community_sites ADD COLUMN builder_published_at BIGINT;
UPDATE community_sites SET join_requests_open=applications_open,staff_applications_open=applications_open,join_questions=questions,staff_questions=questions;
CREATE TABLE community_stores (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),enabled INTEGER NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'gbp',delivery_note TEXT NOT NULL DEFAULT 'Community staff arrange in-game delivery.',
 refund_policy TEXT NOT NULL DEFAULT '',stripe_account_id TEXT UNIQUE,country TEXT NOT NULL DEFAULT 'GB',
 charges_enabled INTEGER NOT NULL DEFAULT 0,updated_at BIGINT NOT NULL
);
CREATE TABLE store_products (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,
 description TEXT NOT NULL,price INTEGER NOT NULL CHECK(price BETWEEN 50 AND 100000),game TEXT NOT NULL CHECK(game IN ('asa','ase')),
 published INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE TABLE store_orders (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),user_id TEXT NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL REFERENCES store_products(id),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',game TEXT NOT NULL,identifier TEXT NOT NULL,
 delivery_note TEXT NOT NULL DEFAULT '',refund_policy TEXT NOT NULL DEFAULT '',
 amount INTEGER NOT NULL,currency TEXT NOT NULL,stripe_account_id TEXT NOT NULL,
 checkout_session_id TEXT UNIQUE,payment_intent_id TEXT UNIQUE,checkout_url TEXT,
 payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','expired','failed','refunded','partially_refunded','disputed')),
 fulfillment_status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK(fulfillment_status IN ('awaiting_payment','pending','fulfilled','review_required')),
 fulfillment_note TEXT NOT NULL DEFAULT '',fulfilled_by TEXT,fulfilled_at BIGINT,
 created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL
);
CREATE TABLE store_stripe_events(id TEXT PRIMARY KEY,created_at BIGINT NOT NULL);
CREATE INDEX idx_store_products ON store_products(workspace_id,created_at);
CREATE INDEX idx_store_orders ON store_orders(workspace_id,created_at DESC);
CREATE INDEX idx_store_buyer_orders ON store_orders(workspace_id,user_id,created_at DESC);
