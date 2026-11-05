import {readFile} from 'node:fs/promises';
const migrations=[{version:1,file:new URL('./migrations/001-postgres.sql',import.meta.url)},{version:2,file:new URL('./migrations/002-community.sql',import.meta.url)},{version:3,file:new URL('./migrations/003-workflows.sql',import.meta.url)},{version:4,file:new URL('./migrations/004-local-accounts.sql',import.meta.url)},{version:5,file:new URL('./migrations/005-community-connections.sql',import.meta.url)},{version:6,file:new URL('./migrations/006-platform-admin.sql',import.meta.url)},{version:7,file:new URL('./migrations/007-platform-settings.sql',import.meta.url)},{version:8,file:new URL('./migrations/008-community-growth.sql',import.meta.url)}];
export async function migrateDatabase(db){return db.transaction(async()=>{
  await db.query('SELECT pg_advisory_xact_lock(93001,hashtext(current_schema()))');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at BIGINT NOT NULL)');
  const applied=new Set((await db.query('SELECT version FROM schema_migrations')).rows.map(row=>row.version));
  if([...applied].some(version=>version>migrations.at(-1).version))throw new Error('This database requires a newer Rookrift release.');
  for(const migration of migrations)if(!applied.has(migration.version)){await db.query(await readFile(migration.file,'utf8'));await db.query('INSERT INTO schema_migrations VALUES($1,$2)',[migration.version,Date.now()]);}
});}
