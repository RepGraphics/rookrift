export async function clearPasswordState(db,userId,{keepSession=null}={}){
 if(keepSession)await db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId,keepSession);
 else await db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
 for(const table of ['password_reset_tokens','login_challenges','password_change_challenges','temporary_passwords','account_challenges'])await db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(userId);
 await db.prepare("UPDATE email_outbox SET status='cancelled',payload=NULL,last_error='Password already updated.' WHERE user_id=? AND kind='password_reset' AND status IN ('pending','failed')").run(userId);
}
