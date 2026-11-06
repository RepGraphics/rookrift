import {randomBytes,randomUUID} from 'node:crypto';
import {generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {z} from 'zod';
import {hash,verifyPassword} from './crypto.js';
import {withAccountLock,assertAccountOpen} from './account-lock.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const DELETED='deleted-account';
export function createAccountDeletion(db,{billing,service,account,store,env=process.env,webauthn={generateAuthenticationOptions,verifyAuthenticationResponse}}){
 const origin=new URL(env.APP_URL||'http://localhost:3000').origin,rpID=new URL(origin).hostname;
 const owned=user=>db.prepare('SELECT * FROM workspaces WHERE owner_id=? AND closed_at IS NULL ORDER BY id').all(user);
 const proofRow=(user,session,token)=>db.prepare('SELECT * FROM account_deletion_proofs WHERE token_hash=? AND user_id=? AND session_token_hash=? AND expires_at>?').get(hash(token||''),user,session.token_hash,Date.now());
 async function issue(user,session,method){const token=randomBytes(32).toString('hex');await db.prepare('DELETE FROM account_deletion_proofs WHERE user_id=? AND session_token_hash=?').run(user,session.token_hash);await db.prepare('INSERT INTO account_deletion_proofs VALUES(?,?,?,?,?)').run(hash(token),user,session.token_hash,method,Date.now()+600000);return token;}
 function noSupportView(session){if(session.impersonating)fail('Leave support view before managing account deletion.',403);}
 async function verifyBusy(user,workspaces){
  const ids=workspaces.map(w=>w.id);for(const ws of ids){
   const servers=await db.prepare('SELECT id FROM servers WHERE workspace_id=?').all(ws);if(servers.some(s=>service.isBusy?.(s.id)))fail('A server command is running. Wait for it to finish before deleting the account.',409);
   if(await db.prepare("SELECT 1 FROM workflow_runs WHERE workspace_id=? AND status IN ('queued','running','waiting') LIMIT 1").get(ws))fail('Cancel active workflows in this workspace before deleting the account.',409);
   if(await db.prepare("SELECT 1 FROM config_applications WHERE workspace_id=? AND status IN ('applying','rolling_back') LIMIT 1").get(ws))fail('Wait for configuration deployment or rollback to finish before deletion.',409);
  }
  if(await db.prepare("SELECT 1 FROM store_delivery_jobs j JOIN store_orders o ON o.id=j.order_id WHERE j.status='executing' AND (o.user_id=? OR o.workspace_id IN (SELECT id FROM workspaces WHERE owner_id=?)) LIMIT 1").get(user,user))fail('A purchase action is executing. Wait for its outcome before deleting the account.',409);
 }
 async function erase(user,workspaces){
  await db.prepare("INSERT INTO users(id,name,access_token) VALUES(?,'Deleted member','') ON CONFLICT DO NOTHING").run(DELETED);
  // Keep minimal financial references and existing purchase terms. Remove the
  // account recipient and stop unsent automatic actions before removing logins.
  await db.prepare("UPDATE store_delivery_jobs SET status='cancelled',detail='Account or community closed before automatic delivery.',payload='{}',updated_at=? WHERE status IN ('pending','blocked','uncertain') AND order_id IN (SELECT id FROM store_orders WHERE user_id=? OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id=?))").run(Date.now(),user.id,user.id);
  await db.prepare("UPDATE store_delivery_jobs SET payload='{}' WHERE order_id IN (SELECT id FROM store_orders WHERE user_id=?)").run(user.id);
  await db.prepare("UPDATE store_orders SET fulfillment_status=CASE WHEN payment_status='paid' AND fulfillment_status<>'fulfilled' THEN 'review_required' ELSE fulfillment_status END,identifier='',discord_user_id=NULL,delivery_actions='[]',checkout_url=NULL,discount_label='',discount_code='',user_id=?,updated_at=? WHERE user_id=?").run(DELETED,Date.now(),user.id);
  await db.prepare("UPDATE store_orders SET fulfilled_by='Deleted member' WHERE fulfilled_by=?").run(user.id);
  await db.prepare("UPDATE staff_audit SET user_id=?,actor='Deleted member' WHERE user_id=?").run(DELETED,user.id);
  await db.prepare("UPDATE player_notes SET author_id=?,author_name='Deleted member' WHERE author_id=?").run(DELETED,user.id);
  await db.prepare("UPDATE community_applications SET reviewed_by='Deleted member' WHERE reviewed_by=?").run(user.id);
  await db.prepare('DELETE FROM community_applications WHERE user_id=?').run(user.id);await db.prepare('DELETE FROM community_rsvps WHERE user_id=?').run(user.id);await db.prepare('DELETE FROM workspace_members WHERE user_id=?').run(user.id);
  const discord=user.discord_id||(/^\d{17,20}$/.test(user.id)?user.id:null);if(discord)await db.prepare('DELETE FROM team_invitations WHERE discord_user_id=?').run(discord);
  for(const ws of workspaces){
   await db.prepare("UPDATE store_orders SET fulfillment_status=CASE WHEN payment_status='paid' AND fulfillment_status<>'fulfilled' THEN 'review_required' ELSE fulfillment_status END,delivery_actions='[]',checkout_url=NULL,discount_label='',discount_code='' WHERE workspace_id=?").run(ws.id);
   await db.prepare("UPDATE store_delivery_jobs SET payload='{}' WHERE workspace_id=?").run(ws.id);
   await db.prepare('DELETE FROM store_promotions WHERE workspace_id=?').run(ws.id);
   await db.prepare("UPDATE store_products SET published=0,archived=1,title='Archived product',description='',image_url='',category_id=NULL,delivery_actions='[]' WHERE workspace_id=?").run(ws.id);
   await db.prepare('DELETE FROM servers WHERE workspace_id=?').run(ws.id);
   for(const table of ['config_templates','player_profiles','community_posts','community_events','community_applications','community_game_accounts','community_members','community_link_codes','notifications','activity','maintenance_windows','announcement_templates','staff_audit','workspace_members','team_invitations','store_categories','billing_checkout_attempts'])await db.prepare('DELETE FROM '+table+' WHERE workspace_id=?').run(ws.id);
   await db.prepare("UPDATE community_sites SET title='Closed community',summary='',rules='',discord_url='',logo_url='',enabled=0,applications_open=0,join_requests_open=0,staff_applications_open=0,questions='[]',join_questions='[]',staff_questions='[]',server_ids='[]',builder_draft='{}',builder_published='{}',builder_published_at=NULL WHERE workspace_id=?").run(ws.id);
   await db.prepare("UPDATE community_stores SET enabled=0,charges_enabled=0,delivery_note='',refund_policy='',payment_checkout_url='',goal_enabled=0,goal_title='' WHERE workspace_id=?").run(ws.id);
   await db.prepare('DELETE FROM session_workspaces WHERE workspace_id=?').run(ws.id);
   await db.prepare("UPDATE workspaces SET owner_id=?,name='Closed workspace',plan='scout',subscription_status='canceled',guild_id=NULL,guild_name=NULL,alert_channel_id=NULL,alerts_enabled=0,ban_sharing_enabled=0,ban_public_name='',closed_at=? WHERE id=?").run(DELETED,Date.now(),ws.id);
  }
  await db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT session_token_hash FROM platform_impersonations WHERE root_user_id=?)').run(user.id);
  await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  await db.prepare('DELETE FROM users WHERE id=?').run(user.id);
 }
 return{
  async status(user,session,token){noSupportView(session);const workspaces=await owned(user),local=await db.prepare('SELECT 1 FROM local_accounts WHERE user_id=?').get(user),identity=await db.prepare('SELECT id,discord_id FROM users WHERE id=?').get(user),keys=await db.prepare('SELECT count(*) AS n FROM account_passkeys WHERE user_id=?').get(user);const check=billing.deletionStatus?await billing.deletionStatus(workspaces):{allowed:workspaces.every(w=>['free','canceled','expired','incomplete_expired'].includes(w.subscription_status)),memberships:workspaces.map(w=>({workspace_id:w.id,workspace_name:w.name,allowed:['free','canceled','expired','incomplete_expired'].includes(w.subscription_status),message:'Billing verification is unavailable. Contact support for paid memberships.'}))};return{...check,reauthenticated:Boolean(await proofRow(user,session,token)),methods:{password:Boolean(local),passkey:keys.n>0,discord:Boolean(identity?.discord_id||/^\d{17,20}$/.test(user))},workspaces:workspaces.length,servers:(await db.prepare('SELECT count(*) AS n FROM servers WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id=?)').get(user)).n};},
  async password(user,session,input){noSupportView(session);const v=z.object({password:z.string().min(1).max(128)}).strict().parse(input),local=await db.prepare('SELECT password_hash FROM local_accounts WHERE user_id=?').get(user);if(!local||!await verifyPassword(v.password,local.password_hash))fail('Your current password is incorrect.',401);return issue(user,session,'password');},
  async passkeyOptions(user,session){noSupportView(session);const keys=await db.prepare('SELECT credential_id FROM account_passkeys WHERE user_id=?').all(user);if(!keys.length)fail('No passkey is registered for this account.',409);const options=await webauthn.generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:keys.map(k=>({id:k.credential_id}))}),id=randomUUID();await db.prepare('INSERT INTO account_deletion_challenges VALUES(?,?,?,?,?,?)').run(id,user,session.token_hash,'passkey',options.challenge,Date.now()+300000);return{...options,challenge_id:id};},
  async passkey(user,session,input){noSupportView(session);const challenge=await db.prepare("DELETE FROM account_deletion_challenges WHERE id=? AND user_id=? AND session_token_hash=? AND kind='passkey' AND expires_at>? RETURNING challenge").get(input.challenge_id,user,session.token_hash,Date.now());if(!challenge)fail('This deletion challenge expired. Try again.',401);const key=await db.prepare('SELECT * FROM account_passkeys WHERE user_id=? AND credential_id=?').get(user,input.response?.id);if(!key)fail('Use a passkey belonging to this account.',401);const verified=await webauthn.verifyAuthenticationResponse({response:input.response,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.credential_id,publicKey:new Uint8Array(key.public_key),counter:key.counter,transports:JSON.parse(key.transports)}});if(!verified.verified)fail('Passkey verification failed.',401);if(!(await db.prepare('UPDATE account_passkeys SET counter=?,last_used_at=? WHERE id=? AND counter=?').run(verified.authenticationInfo.newCounter,Date.now(),key.id,key.counter)).changes)fail('The passkey changed. Verify again.',409);return issue(user,session,'passkey');},
  async beginDiscord(user,session){noSupportView(session);const state=randomBytes(32).toString('hex');await db.prepare('INSERT INTO account_deletion_challenges VALUES(?,?,?,?,?,?)').run(hash(state),user,session.token_hash,'discord','',Date.now()+600000);return state;},
  async discordState(state,sessionHash){return db.prepare("DELETE FROM account_deletion_challenges WHERE id=? AND session_token_hash=? AND kind='discord' AND expires_at>? RETURNING user_id,session_token_hash").get(hash(state),sessionHash,Date.now());},
  async discordProof(challenge,discordId){const user=await db.prepare('SELECT id,discord_id FROM users WHERE id=?').get(challenge.user_id);if(!user||discordId!==(user.discord_id||user.id))fail('Verify the Discord account linked to this Rookrift account.',403);const session=await db.prepare('SELECT * FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?').get(challenge.session_token_hash,user.id,Date.now());if(!session)fail('Your sign-in expired. Sign in again.',401);return issue(user.id,session,'discord');},
  async remove(userId,session,token,input){noSupportView(session);const v=z.object({confirmation:z.literal('DELETE'),acknowledged:z.literal(true),totp:z.string().max(6).optional()}).strict().parse(input);return withAccountLock(userId,async()=>{
   const user=await assertAccountOpen(db,userId);if(!await proofRow(userId,session,token))fail('Verify your identity again before deleting the account.',401);if(!await account.verifyTotp(userId,v.totp))fail('Enter your current authenticator code.',401);
   let workspaces=await owned(userId);const before=billing.deletionStatus?await billing.deletionStatus(workspaces):{allowed:workspaces.every(w=>['free','canceled','expired','incomplete_expired'].includes(w.subscription_status))};if(!before.allowed)fail('Cancel every paid membership before deleting your account. Refresh the cancellation check when ready.',409);
   await db.prepare('UPDATE users SET deleting_at=? WHERE id=?').run(Date.now(),userId);
   try{
    if(billing.deletionStatus&&!(await billing.deletionStatus(workspaces,{closePending:true})).allowed)fail('Billing changed or cancellation could not be verified. The account has not been deleted.',409);
    await store?.stopCheckoutsForDeletion?.(userId,workspaces);
    workspaces=await owned(userId);await verifyBusy(userId,workspaces);
    return await db.transaction(async()=>{
     const allLocked=await db.prepare('SELECT * FROM workspaces WHERE (owner_id=? OR id IN (SELECT workspace_id FROM store_orders WHERE user_id=?)) AND closed_at IS NULL ORDER BY id FOR UPDATE').all(userId,userId),locked=allLocked.filter(w=>w.owner_id===userId);
     await verifyBusy(userId,locked);const identity=await db.prepare('SELECT * FROM users WHERE id=? FOR UPDATE').get(userId);if(!identity)fail('Account not found.',404);await erase(identity,locked);return{ok:true};
    });
   }finally{await db.prepare('UPDATE users SET deleting_at=NULL WHERE id=?').run(userId);}
  });}
 };
}
