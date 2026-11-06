import {randomBytes} from 'node:crypto';
import {z} from 'zod';
import {hash,hashPassword} from './crypto.js';
import {withAccountLock} from './account-lock.js';
import {clearPasswordState} from './password-state.js';
import {recordPlatformActivity} from './platform-activity.js';
const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const schema=z.object({method:z.enum(['email','generate']),confirmation:z.string().trim().max(254),request_id:z.string().uuid()}).strict();
export function createAdminPasswords(db,email){
 async function target(actor,id){
  if(!actor?.platform_admin)fail('Platform administrator access required.',403);
  const row=await db.prepare(`SELECT u.id,u.deleting_at,a.email,EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id) AS root,
   EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended
   FROM users u LEFT JOIN local_accounts a ON a.user_id=u.id WHERE u.id=?`).get(id);
  if(!row||row.id==='deleted-account')fail('User not found.',404);
  if(row.root||row.id===actor.id)fail('Use My account to manage your own password. Platform root passwords cannot be reset here.');
  if(row.deleting_at||row.suspended)fail('Restore this account before resetting its password.');
  if(!row.email)fail('This account uses external sign-in and has no local password to reset.');
  return row;
 }
 return{
  async options(actor,id){await target(actor,id);return{email_available:Boolean((await email.settings()).configured)};},
  async reset(actor,id,input){
   if(!actor?.platform_admin)fail('Platform administrator access required.',403);
   const value=schema.parse(input);
   return withAccountLock(id,async()=>{
    const user=await target(actor,id);if(value.confirmation.toLowerCase()!==user.email.toLowerCase())fail('Type the account email to confirm this reset.',400);
    const password=value.method==='generate'?randomBytes(18).toString('base64url'):null,encoded=password?await hashPassword(password):null;
    return db.transaction(async()=>{
     await db.prepare('DELETE FROM admin_password_operations WHERE created_at<?').run(Date.now()-90*86400000);
     if(await db.prepare('SELECT id FROM admin_password_operations WHERE id=?').get(value.request_id))fail('This reset request was already processed. A generated password cannot be revealed again. Start a new reset if needed.');
     const expires=Date.now()+(password?86400000:3600000);
     if(password){
      await clearPasswordState(db,id);
      await db.prepare('UPDATE local_accounts SET password_hash=? WHERE user_id=?').run(encoded,id);
      await db.prepare('INSERT INTO temporary_passwords(user_id,expires_at,created_at) VALUES(?,?,?)').run(id,expires,Date.now());
     }else{
      await db.prepare('DELETE FROM password_reset_tokens WHERE user_id=?').run(id);
      await db.prepare("UPDATE email_outbox SET status='cancelled',payload=NULL,last_error='Replaced by a newer reset request.' WHERE user_id=? AND kind='password_reset' AND status IN ('pending','failed')").run(id);
      const token=randomBytes(32).toString('hex');if(!await email.passwordReset(id,token,expires))fail('Email delivery is not configured. Set up Email delivery in Global settings, or generate a temporary password.');
      await db.prepare('INSERT INTO password_reset_tokens VALUES(?,?,?,NULL)').run(hash(token),id,expires);
     }
     await db.prepare('INSERT INTO admin_password_operations VALUES(?,?,?,?)').run(value.request_id,id,value.method,Date.now());
     await recordPlatformActivity(db,actor,password?'Temporary password generated':'Password reset email queued',{targetUser:id});
     return password?{ok:true,password,expires_at:expires,message:'Temporary password generated. It is shown once and must be replaced at password sign-in.'}:{ok:true,expires_at:expires,message:'Password reset email queued. The link expires in one hour. Delivery status is available in Email delivery.'};
    });
   });
  }
 };
}
