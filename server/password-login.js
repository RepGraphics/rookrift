import {randomBytes} from 'node:crypto';
import {hash,verifyPassword,hashPassword} from './crypto.js';
import {withAccountLock,assertAccountOpen} from './account-lock.js';
import {clearPasswordState} from './password-state.js';
const fail=message=>{throw Object.assign(new Error(message),{status:401});};

export function createPasswordLogin(db,account){return{
 async begin(email,password){
  const user=await db.prepare('SELECT u.id,u.deleting_at,a.password_hash,(SELECT expires_at FROM temporary_passwords WHERE user_id=u.id) AS temporary_expires_at,EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended,COALESCE((SELECT totp_enabled FROM account_security WHERE user_id=u.id),0) AS totp_enabled FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE a.email=?').get(email);
  if(!user||user.suspended||user.deleting_at||!await verifyPassword(password,user.password_hash))fail('Email or password is incorrect.');
  if(user.temporary_expires_at&&user.temporary_expires_at<=Date.now())fail('Your temporary password has expired. Request a reset link or contact support.');
  if(!user.totp_enabled)return{user_id:user.id,credential_hash:hash(user.password_hash),totp_verified:false};
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
  return{user_id:user.id,credential_hash:hash(user.password_hash),totp_verified:true};
 },
 async finalize(result,issueSession){return withAccountLock(result.user_id,async()=>db.transaction(async()=>{
  await assertAccountOpen(db,result.user_id);
  const user=await db.prepare('SELECT a.password_hash,t.expires_at,COALESCE(s.totp_enabled,0) AS totp_enabled,EXISTS(SELECT 1 FROM suspended_users x WHERE x.user_id=a.user_id) AS suspended FROM local_accounts a LEFT JOIN temporary_passwords t ON t.user_id=a.user_id LEFT JOIN account_security s ON s.user_id=a.user_id WHERE a.user_id=?').get(result.user_id);
  if(!user||user.suspended||hash(user.password_hash)!==result.credential_hash||(user.totp_enabled&&!result.totp_verified))fail('Your sign-in changed. Enter your email and password again.');
  if(user.expires_at){
   if(user.expires_at<=Date.now())fail('Your temporary password has expired. Request a reset link or contact support.');
   const challenge=randomBytes(32).toString('hex');await db.prepare('DELETE FROM password_change_challenges WHERE user_id=? OR expires_at<?').run(result.user_id,Date.now());
   await db.prepare('INSERT INTO password_change_challenges(token_hash,user_id,credential_hash,totp_verified,expires_at) VALUES(?,?,?,?,?)').run(hash(challenge),result.user_id,result.credential_hash,Number(result.totp_verified),Math.min(user.expires_at,Date.now()+300000));return{requires_password_change:true,challenge};
  }
  await issueSession(result.user_id);return{ok:true};
 }));},
 async replaceTemporary(challenge,password,issueSession){
  if(!/^[a-f0-9]{64}$/.test(challenge||''))fail('Your password-change step expired. Sign in again.');
  if(typeof password!=='string'||password.length<8||password.length>128)throw Object.assign(new Error('Choose a password between 8 and 128 characters.'),{status:400});
  const row=await db.prepare('SELECT * FROM password_change_challenges WHERE token_hash=? AND expires_at>?').get(hash(challenge),Date.now());if(!row)fail('Your password-change step expired. Sign in again.');
  return withAccountLock(row.user_id,async()=>{
   await assertAccountOpen(db,row.user_id);const user=await db.prepare('SELECT a.password_hash,t.expires_at,COALESCE((SELECT totp_enabled FROM account_security WHERE user_id=a.user_id),0) AS totp_enabled,EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=a.user_id) AS suspended FROM local_accounts a JOIN temporary_passwords t ON t.user_id=a.user_id WHERE a.user_id=?').get(row.user_id);
   if(!user||user.suspended||user.expires_at<=Date.now()||hash(user.password_hash)!==row.credential_hash||(user.totp_enabled&&!row.totp_verified))fail('Your sign-in changed. Enter your email and password again.');
   if(await verifyPassword(password,user.password_hash))throw Object.assign(new Error('Choose a different password from the temporary password.'),{status:400});
   const encoded=await hashPassword(password);
   return db.transaction(async()=>{if(!await db.prepare('DELETE FROM password_change_challenges WHERE token_hash=? AND expires_at>? RETURNING user_id').get(hash(challenge),Date.now()))fail('Your password-change step expired. Sign in again.');await db.prepare('UPDATE local_accounts SET password_hash=? WHERE user_id=?').run(encoded,row.user_id);await clearPasswordState(db,row.user_id);await issueSession(row.user_id);return{ok:true};});
  });
 },
 async cancel(challenge,passwordChange){if(challenge)await db.prepare('DELETE FROM login_challenges WHERE token_hash=?').run(hash(challenge));if(passwordChange)await db.prepare('DELETE FROM password_change_challenges WHERE token_hash=?').run(hash(passwordChange));}
};}
