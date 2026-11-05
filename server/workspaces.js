import {assertAccountOpen} from './account-lock.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export const workspaceSchema=z.object({name:z.string().trim().min(2).max(60),game_focus:z.enum(['mixed','asa','ase','dayz']).default('mixed')}).strict();
export async function ensurePersonalWorkspace(db,userId){
 return db.transaction(async()=>{
  await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);await assertAccountOpen(db,userId);
  let row=await db.prepare('SELECT id FROM workspaces WHERE owner_id=? AND closed_at IS NULL ORDER BY created_at,id LIMIT 1').get(userId);
  if(!row){row={id:randomUUID()};await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run(row.id,userId,Date.now());}
  return row.id;
 });
}
export async function createWorkspace(db,session,input){
 const value=workspaceSchema.parse(input);
 return db.transaction(async()=>{
  await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(session.user_id);await assertAccountOpen(db,session.user_id);
  const count=(await db.prepare('SELECT count(*) AS n FROM workspaces WHERE owner_id=?').get(session.user_id)).n;
  if(count>=10)throw Object.assign(new Error('You can own up to 10 workspaces.'),{status:403});
  if(await db.prepare('SELECT id FROM workspaces WHERE owner_id=? AND lower(name)=lower(?)').get(session.user_id,value.name))throw Object.assign(new Error('Choose a different workspace name.'),{status:409});
  const id=randomUUID();await db.prepare('INSERT INTO workspaces(id,owner_id,name,game_focus,created_at) VALUES(?,?,?,?,?)').run(id,session.user_id,value.name,value.game_focus,Date.now());
  await db.prepare('INSERT INTO session_workspaces VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET workspace_id=excluded.workspace_id').run(session.token_hash,id);
  return{id,name:value.name,game_focus:value.game_focus};
 });
}
