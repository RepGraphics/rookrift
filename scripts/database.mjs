import {openDatabase} from '../server/db.js';
import {createVault} from '../server/crypto.js';
import {importSqlite} from '../server/import-sqlite.js';
const [command,filename]=process.argv.slice(2);let db;
try{
  if(!['migrate','import-sqlite'].includes(command))throw new Error('Use migrate or import-sqlite <path>.');
  db=await openDatabase();
  if(command==='migrate')console.log('PostgreSQL schema is up to date.');
  else{const counts=await importSqlite(db,filename,createVault(process.env.ENCRYPTION_KEY));console.log('SQLite import committed and row counts verified. Keep the source backup and original encryption key.');for(const[table,count]of Object.entries(counts))console.log(`${table}: ${count}`);}
}catch(error){console.error(error.code?'Database operation failed. No credentials are logged; check connectivity and database permissions.':error.message);process.exitCode=1;}
finally{await db?.close();}
