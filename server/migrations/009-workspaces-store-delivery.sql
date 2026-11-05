ALTER TABLE workspaces DROP CONSTRAINT workspaces_owner_id_key;
ALTER TABLE workspaces ADD COLUMN game_focus TEXT NOT NULL DEFAULT 'mixed' CHECK(game_focus IN ('mixed','asa','ase','dayz'));
CREATE INDEX idx_workspaces_owner ON workspaces(owner_id,created_at,id);
CREATE TABLE store_categories (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),name TEXT NOT NULL,
 sort_order INTEGER NOT NULL DEFAULT 0,created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX idx_store_category_name ON store_categories(workspace_id,lower(name));
ALTER TABLE store_products ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE store_products ADD COLUMN category_id TEXT REFERENCES store_categories(id) ON DELETE SET NULL;
ALTER TABLE store_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE store_products ADD COLUMN delivery_actions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE store_orders ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN category_name TEXT NOT NULL DEFAULT '';
ALTER TABLE store_orders ADD COLUMN delivery_actions TEXT NOT NULL DEFAULT '[]';
ALTER TABLE store_orders ADD COLUMN discord_user_id TEXT;
CREATE TABLE store_delivery_jobs (
 id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id),order_id TEXT NOT NULL REFERENCES store_orders(id),
 position INTEGER NOT NULL,type TEXT NOT NULL CHECK(type IN ('rcon','discord_role')),payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','executing','succeeded','blocked','uncertain','cancelled')),
 detail TEXT NOT NULL DEFAULT '',attempts INTEGER NOT NULL DEFAULT 0,preexisting INTEGER,next_attempt BIGINT NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE(order_id,position)
);
CREATE INDEX idx_store_delivery_queue ON store_delivery_jobs(status,created_at);
CREATE INDEX idx_store_delivery_workspace ON store_delivery_jobs(workspace_id,order_id,position);
