import {DatabaseSync} from 'node:sqlite';
export const importTables=['users','workspaces','sessions','oauth_states','servers','schedules','activity','metrics','stripe_events','announcement_templates','maintenance_windows','notifications','incidents','schedule_runs','moderation','hosting_connections','ban_directory_reports','workspace_members','team_invitations','session_workspaces','staff_audit','player_profiles','player_observations','player_notes'];
const secretFields={users:'access_token',servers:'password',hosting_connections:'api_key'};
export async function importSqlite(db,filename,vault){
  if(!filename||!vault)throw new Error('A SQLite path and the original encryption key are required.');
  const source=new DatabaseSync(filename,{readOnly:true});
  try{
    source.exec('BEGIN');
    if(source.prepare('PRAGMA user_version').get().user_version!==4)throw new Error('Import requires SQLite schema version 4. Upgrade the old installation to Rookrift 0.5 first.');
    return await db.withMaintenanceLock(async()=>{
      for(const table of importTables)if((await db.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n!==0)throw new Error('The PostgreSQL destination must be empty. No data has been overwritten.');
      const counts={};
      for(const table of importTables){
        const count=source.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
        const first=source.prepare(`SELECT * FROM "${table}" LIMIT 1`).get();counts[table]=count;
        const destination=(await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND is_identity=\'NO\' ORDER BY ordinal_position',[table])).rows.map(row=>row.column_name);
        const columns=destination.filter(name=>first&&Object.hasOwn(first,name));
        for(const name of columns)if(!/^[a-z_]+$/.test(name))throw new Error('Invalid source column.');
        async function flush(batch){const values=[];
          for(const row of batch){const secret=secretFields[table];if(secret)try{vault.decrypt(row[secret]);}catch{throw new Error('Stored credentials cannot be decrypted. Supply the original ENCRYPTION_KEY.');}for(const column of columns)values.push(row[column]);}
          const tuples=batch.map((_,i)=>`(${columns.map((_,j)=>`$${i*columns.length+j+1}`).join(',')})`).join(',');
          await db.query(`INSERT INTO "${table}"(${columns.map(c=>`"${c}"`).join(',')}) VALUES ${tuples}`,values);
        }
        let batch=[];for(const row of source.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).iterate()){batch.push(row);if(batch.length===200){await flush(batch);batch=[];}}if(batch.length)await flush(batch);
        if((await db.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n!==count)throw new Error(`Import verification failed for ${table}.`);
      }
      return counts;
    });
  }finally{source.close();}
}
