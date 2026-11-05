// The PostgreSQL runtime lease guarantees one application process. Share this
// account-level fence across billing and closure without holding a transaction
// open during payment-provider requests.
const active=new Map();
export async function withAccountLock(userId,callback){
 const previous=active.get(userId)||Promise.resolve();let release;
 const turn=new Promise(resolve=>{release=resolve;});active.set(userId,turn);
 await previous.catch(()=>{});
 try{return await callback();}finally{release();if(active.get(userId)===turn)active.delete(userId);}
}
export function withAccountLocks(userIds,callback){
 const ids=[...new Set(userIds)].sort();
 const next=index=>index===ids.length?callback():withAccountLock(ids[index],()=>next(index+1));
 return next(0);
}
export async function assertAccountOpen(db,userId){
 const user=await db.prepare('SELECT id,deleting_at FROM users WHERE id=?').get(userId);
 if(!user||user.deleting_at||user.id==='deleted-account')throw Object.assign(new Error('This account is closed or deletion is in progress.'),{status:409});
 return user;
}
