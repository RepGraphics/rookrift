import {randomBytes} from 'node:crypto';
import {hash,verifyPassword} from './crypto.js';
const fail=message=>{throw Object.assign(new Error(message),{status:401});};

export function createPasswordLogin(db,account){return{
 async begin(email,password){
  const user=await db.prepare('SELECT u.id,u.deleting_at,a.password_hash,EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended,COALESCE((SELECT totp_enabled FROM account_security WHERE user_id=u.id),0) AS totp_enabled FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE a.email=?').get(email);
  if(!user||user.suspended||user.deleting_at||!await verifyPassword(password,user.password_hash))fail('Email or password is incorrect.');
  if(!user.totp_enabled)return{user_id:user.id};
  const challenge=randomBytes(32).toString('hex');
  await db.transaction(async()=>{await db.prepare('DELETE FROM login_challenges WHERE user_id=? OR expires_at<?').run(user.id,Date.now());await db.prepare('INSERT INTO login_challenges(token_hash,user_id,credential_hash,expires_at) VALUES(?,?,?,?)').run(hash(challenge),user.id,hash(user.password_hash),Date.now()+300000);});
  return{requires_totp:true,challenge};
 },
 async complete(challenge,code){
  if(!/^[a-f0-9]{64}$/.test(challenge||''))fail('Your sign-in expired. Enter your email and password again.');
  // Attempts commit before verification, including failed codes.
  const row=await db.prepare('UPDATE login_challenges SET attempts=attempts+1 WHERE token_hash=? AND expires_at>? AND attempts<5 RETURNING *').get(hash(challenge),Date.now());
  if(!row)fail('Your sign-in expired or reached its attempt limit. Enter your email and password again.');
  const user=await db.prepare('SELECT u.id,u.deleting_at,a.password_hash,EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended FROM users u JOIN local_accounts a ON a.user_id=u.id WHERE u.id=?').get(row.user_id);
  if(!user||user.suspended||user.deleting_at||hash(user.password_hash)!==row.credential_hash)fail('Your sign-in changed. Enter your email and password again.');
  if(!/^\d{6}$/.test(code||'')||!await account.verifyTotp(user.id,code))fail('That authenticator code is incorrect. Try again.');
  if(!await db.prepare('DELETE FROM login_challenges WHERE token_hash=? AND expires_at>? RETURNING user_id').get(hash(challenge),Date.now()))fail('Your sign-in expired. Enter your email and password again.');
  return{user_id:user.id};
 },
 async cancel(challenge){if(challenge)await db.prepare('DELETE FROM login_challenges WHERE token_hash=?').run(hash(challenge));}
};}
