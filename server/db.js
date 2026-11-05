import {Pool,types} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {migrateDatabase} from './migrations.js';

// Translate value placeholders; quoted strings, identifiers and comments stay literal.
export function compileQuery(sql){
  let text='',count=0,quote=null,line=false,block=false;
  for(let i=0;i<sql.length;i++){
    const c=sql[i],next=sql[i+1];
    if(line){text+=c;if(c==='\n')line=false;continue;}
    if(block){text+=c;if(c==='*'&&next==='/'){text+=next;i++;block=false;}continue;}
    if(quote){text+=c;if(c===quote){if(next===quote){text+=next;i++;}else quote=null;}continue;}
    if(c==='-'&&next==='-'){text+='--';i++;line=true;continue;}
    if(c==='/'&&next==='*'){text+='/*';i++;block=true;continue;}
    if(c==="'"||c==='"'){quote=c;text+=c;continue;}
    text+=c==='?'?`$${++count}`:c;
  }
  return{text,count};
}
const numberParser=value=>{const n=Number(value);if(!Number.isFinite(n))throw new Error('Invalid database numeric value.');return n;};
const intParser=value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('Database integer exceeds JavaScript precision.');return n;};
export async function openDatabase(connection=process.env.DATABASE_URL,options={}){
  const testing=connection===':memory:';
  if(testing&&!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required. Run npm run test:unit for isolated PostgreSQL fixtures.');
  if(!testing&&!connection&&!process.env.PGHOST)throw new Error('Configure DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD for PostgreSQL.');
  if(connection&&connection!==':memory:'&&!/^postgres(?:ql)?:\/\//.test(connection))throw new Error('PostgreSQL requires a postgres:// URL. Use db:import-sqlite for an existing SQLite file.');
  const schema=testing?`rookrift_test_${randomUUID().replaceAll('-','')}`:options.schema||'public';
  if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw new Error('Invalid database schema.');
  const max=Number(options.max||process.env.PG_POOL_MAX||10);
  if(!Number.isInteger(max)||max<2||max>100)throw new Error('PG_POOL_MAX must be an integer from 2 to 100.');
  const pool=new Pool({connectionString:testing?process.env.TEST_DATABASE_URL:connection||undefined,max,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'rookrift',options:`-c search_path=${schema}`,types:{getTypeParser(oid,format){return oid===20?intParser:oid===1700?numberParser:types.getTypeParser(oid,format);}}});
  pool.on('error',()=>console.error('A PostgreSQL connection was interrupted.'));
  const transactionContext=new AsyncLocalStorage(),compiled=new Map();let closed=false,lease=null;
  const db={dialect:'postgres',schema,
    query(text,values=[]){return(transactionContext.getStore()||pool).query(text,values);},
    prepare(sql){let statement=compiled.get(sql);if(!statement){statement=compileQuery(sql);if(compiled.size>=512)compiled.delete(compiled.keys().next().value);compiled.set(sql,statement);}const execute=async args=>{if(statement.count!==args.length)throw new Error(`Expected ${statement.count} database parameters; received ${args.length}.`);return db.query(statement.text,args);};return{all:async(...args)=>(await execute(args)).rows,get:async(...args)=>(await execute(args)).rows[0],run:async(...args)=>{const result=await execute(args);return{changes:result.rowCount};}};},
    async exec(sql){if(/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql))throw new Error('Use db.transaction() for connection-bound transactions.');await db.query(sql);},
    async transaction(callback){if(transactionContext.getStore())return callback();const client=await pool.connect();try{await client.query('BEGIN');const result=await transactionContext.run(client,callback);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}},
    withWorkspaceLock(id,callback){return db.transaction(async()=>{const row=await db.prepare('SELECT id FROM workspaces WHERE id=? FOR UPDATE').get(id);if(!row)throw Object.assign(new Error('Workspace not found.'),{status:404});return callback();});},
    async acquireRuntimeLock(onLost=()=>{}){if(lease)throw new Error('Runtime lease already held.');const client=await pool.connect();try{const result=await client.query('SELECT pg_try_advisory_lock(93002,hashtext(current_schema())) AS locked');if(!result.rows[0].locked)throw new Error('Another Rookrift runtime is active. Run one application replica.');client.on('error',onLost);lease={client,onLost};}catch(error){client.release();throw error;}},
    async withMaintenanceLock(callback){const client=await pool.connect();let locked=false;const onError=()=>{};client.on('error',onError);try{locked=(await client.query('SELECT pg_try_advisory_lock(93002,hashtext(current_schema())) AS locked')).rows[0].locked;if(!locked)throw new Error('Stop the Rookrift runtime before importing data.');await client.query('BEGIN');const result=await transactionContext.run(client,callback);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{if(locked)await client.query('SELECT pg_advisory_unlock(93002,hashtext(current_schema()))').catch(()=>{});client.off('error',onError);client.release();}},
    async ping(){await db.query('SELECT 1');},
    async close(){if(closed)return;closed=true;if(lease){const{client,onLost}=lease;client.off('error',onLost);await client.query('SELECT pg_advisory_unlock(93002,hashtext(current_schema()))').catch(()=>{});client.release();lease=null;}try{if(testing)await pool.query(`DROP SCHEMA "${schema}" CASCADE`);}finally{await pool.end();}}
  };
  try{if(testing)await db.query(`CREATE SCHEMA "${schema}"`);await migrateDatabase(db);return db;}catch(error){await db.close().catch(()=>{});throw error;}
}
export const listServers=async(db,workspaceId)=>db.prepare('SELECT * FROM servers WHERE workspace_id=? ORDER BY created_at,id').all(workspaceId);
export function publicServer(row,paused=false){const{password,workspace_id,player_list,...server}=row;return{...server,maintenance:Boolean(server.maintenance),paused};}
export function playerSnapshot(servers){return servers.filter(server=>server.status==='online'&&!server.paused).flatMap(server=>{let players;try{players=JSON.parse(server.player_list||'[]');}catch{players=[];}return(Array.isArray(players)?players:[]).slice(0,1000).filter(line=>typeof line==='string').map((line,index)=>{const separator=line.lastIndexOf(',');return{id:`${server.id}:${index}`,name:separator>-1?line.slice(0,separator).trim():line,identifier:separator>-1?line.slice(separator+1).trim():'',server_id:server.id,server_name:server.name,game:server.game,cluster:server.cluster,checked_at:server.last_checked};});});}
export async function audit(db,workspace,title,detail,level='info',server=null){return db.transaction(async()=>{const row=await db.prepare('SELECT closed_at FROM workspaces WHERE id=? FOR KEY SHARE').get(workspace);if(!row||row.closed_at)return;await db.prepare('INSERT INTO activity VALUES(?,?,?,?,?,?,?)').run(randomUUID(),workspace,server,title,detail.slice(0,1500),level,Date.now());});}
