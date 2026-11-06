import {createHash} from 'node:crypto';
import {z} from 'zod';
import {PermissionFlagsBits} from 'discord.js';
import {renderPurchaseCommand,deliveryKindsForGame,gameIdentifierLabel} from '../shared/store-delivery.js';
import {parseActions,refreshDeliveryStatus} from './store-delivery-state.js';
import {audit} from './db.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const fingerprint=s=>createHash('sha256').update([s.game,s.host,s.port,s.password].join('\0')).digest('hex');
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('rcon'),server_id:z.string().uuid(),command_template:z.string().trim().min(1).max(600),identity_kind:z.enum(['numeric','eos','steam','uuid','game']),target_fingerprint:z.string().optional(),label:z.string().optional()}).strict(),
 z.object({type:z.literal('discord_role'),role_id:z.string().regex(/^\d{17,20}$/),guild_id:z.string().optional(),label:z.string().optional()}).strict()
]);
const samples={numeric:'123456',eos:'0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa',steam:'76561198000000000',uuid:'00000000-0000-4000-8000-000000000000',game:'PLAYER-001'};

export function createDiscordRewards(getBot){
 const unsafe=[PermissionFlagsBits.Administrator,PermissionFlagsBits.ManageGuild,PermissionFlagsBits.ManageRoles,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageWebhooks,PermissionFlagsBits.BanMembers,PermissionFlagsBits.KickMembers,PermissionFlagsBits.ModerateMembers];
 async function context(guildId){const bot=getBot();if(!bot?.isReady())fail('The Discord bot is not connected.',503);const guild=await bot.guilds.fetch(guildId);await guild.members.fetchMe();await guild.roles.fetch();return guild;}
 const eligible=role=>role&&role.id!==role.guild.id&&!role.managed&&role.editable&&!unsafe.some(bit=>role.permissions.has(bit));
 return{
  async roles(guildId){const guild=await context(guildId);return [...guild.roles.cache.values()].filter(eligible).map(r=>({id:r.id,name:r.name})).sort((a,b)=>a.name.localeCompare(b.name));},
  async check(guildId,roleId){const guild=await context(guildId),role=guild.roles.cache.get(roleId);if(!eligible(role))fail('Choose a non-staff role below the bot role that the bot can manage.',409);return role.name;},
  async award(guildId,roleId,userId,orderId){const guild=await context(guildId),role=guild.roles.cache.get(roleId);if(!eligible(role))fail('The reward role is no longer assignable.',409);let member;try{member=await guild.members.fetch({user:userId,force:true});}catch{fail('The buyer must join the linked Discord community before this role can be awarded.',409);}if(member.roles.cache.has(roleId))return{preexisting:true};await member.roles.add(roleId,'Rookrift purchase '+orderId);return{preexisting:false};}
 };
}

export function createPurchaseDelivery(db,store,service,rewards){
 let running=false,stopped=false,inFlight=Promise.resolve();
 const order=async(ws,id)=>{const row=await db.prepare('SELECT * FROM store_orders WHERE workspace_id=? AND id=?').get(ws,id);if(!row)fail('Order not found.',404);return row;};
 async function validate(ws,product,input,checking=false){
  const actions=z.array(actionSchema).max(6).parse(input),workspace=await db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws),result=[];
  const kinds=new Set(actions.filter(a=>a.type==='rcon').map(a=>a.identity_kind));if(kinds.size>1)fail('All command actions on a product must use the same recipient ID type.');
  for(const a of actions){
   if(a.type==='rcon'){
    if(!deliveryKindsForGame(product.game).includes(a.identity_kind))fail('Use '+gameIdentifierLabel(product.game)+' for this game, or explicitly select the character/plugin identifier required by your command.');
    const server=await service.getServer(ws,a.server_id);if(server.game!==product.game)fail('Purchase command servers must run the product game.');
    renderPurchaseCommand(a.command_template,samples[a.identity_kind],a.identity_kind,'00000000-0000-4000-8000-000000000000');
    if(/\b(?:GiveItemToPlayer|GiveItemNumToPlayer|GiveExpToPlayer)\b/i.test(a.command_template)&&a.identity_kind!=='numeric')fail('This ARK command requires a numeric in-game PlayerID, not an EOS or Steam account ID.');
    const hash=fingerprint(server);if(checking&&hash!==a.target_fingerprint)fail('The command server connection changed. Ask the owner to review purchase actions.',409);
    result.push({type:'rcon',server_id:a.server_id,command_template:a.command_template,identity_kind:a.identity_kind,target_fingerprint:hash,label:checking?a.label:server.name});
   }else{
    if(!workspace.guild_id)fail('Link this workspace to its Discord community first.',409);if(checking&&a.guild_id!==workspace.guild_id)fail('The linked Discord community changed. Review purchase actions.',409);
    const name=await rewards.check(workspace.guild_id,a.role_id);result.push({type:'discord_role',guild_id:workspace.guild_id,role_id:a.role_id,label:checking?a.label:name});
   }
  }
  return result;
 }
 async function finish(job,status,detail,preexisting=null){return db.withWorkspaceLock(job.workspace_id,async()=>{await db.prepare('UPDATE store_delivery_jobs SET status=?,detail=?,preexisting=?,updated_at=? WHERE id=? AND status=?').run(status,detail,preexisting===null?null:Number(preexisting),Date.now(),job.id,job.claimed?'executing':'pending');await refreshDeliveryStatus(db,job.workspace_id,job.order_id);});}
 async function execute(job){
  let committed=false;const payload=JSON.parse(job.payload);
  try{
   const purchase=await store.verifyForDelivery(job.workspace_id,job.order_id);if(purchase.payment_status!=='paid'){await finish(job,'cancelled','Payment is no longer paid. Staff review required.');return;}
   const claim=async server=>db.withWorkspaceLock(job.workspace_id,async()=>{
    const current=await order(job.workspace_id,job.order_id),j=await db.prepare('SELECT * FROM store_delivery_jobs WHERE id=? FOR UPDATE').get(job.id);
    const closing=await db.prepare('SELECT 1 FROM users WHERE deleting_at IS NOT NULL AND (id=? OR id=(SELECT owner_id FROM workspaces WHERE id=?))').get(current.user_id,job.workspace_id);if(closing||j.status!=='pending'||current.payment_status!=='paid')fail('This delivery is no longer pending.',409);
    if(server&&fingerprint(server)!==payload.target_fingerprint)fail('The server connection changed. Staff review required.',409);
    const ws=await db.prepare('SELECT guild_id FROM workspaces WHERE id=?').get(job.workspace_id);if(payload.type==='discord_role'&&ws.guild_id!==payload.guild_id)fail('The linked Discord community changed.',409);
    await db.prepare("UPDATE store_delivery_jobs SET status='executing',attempts=attempts+1,updated_at=? WHERE id=?").run(Date.now(),job.id);
   }).then(()=>{committed=true;job.claimed=true;});
   if(payload.type==='rcon'){
    const command=renderPurchaseCommand(payload.command_template,purchase.identifier,payload.identity_kind,purchase.id);
    const response=await service.purchaseCommand(job.workspace_id,payload.server_id,command,claim);
    if(/unknown command|command not recognized|invalid player|no player|not found|not online|error:|failed/i.test(response.output||'')){await finish(job,'uncertain','The game returned a possible command error. Verify in-game before resolving; it will not be replayed.');return;}
    await finish(job,'succeeded','RCON acknowledged the configured command. Inventory delivery is not independently verified.');
   }else{
    if(!purchase.discord_user_id)fail('The purchase has no verified Discord recipient.',409);await claim();const result=await rewards.award(payload.guild_id,payload.role_id,purchase.discord_user_id,purchase.id);await finish(job,'succeeded',result.preexisting?'Buyer already held this role.':'Discord role awarded.',result.preexisting);
   }
   await audit(db,job.workspace_id,'Purchase action completed',purchase.id+' - '+payload.type);
  }catch(error){
   if(!committed&&['SERVER_BUSY','TARGET_NOT_READY'].includes(error.code)&&Date.now()-job.created_at<7*86400000){await db.prepare('UPDATE store_delivery_jobs SET next_attempt=?,detail=?,updated_at=? WHERE id=? AND status=?').run(Date.now()+60000,'Waiting for an available, online server.',Date.now(),job.id,'pending');return;}
   const uncertain=committed&&payload.type==='rcon';await finish(job,uncertain?'uncertain':'blocked',uncertain?'The command outcome is uncertain. Check in-game and resolve manually; it will not be automatically repeated.':(error.status?error.message:'Discord or payment verification is unavailable. Review and retry when ready.').slice(0,500));
  }
 }
 return{
  validate,
  async options(ws){const workspace=await db.prepare('SELECT guild_id FROM workspaces WHERE id=?').get(ws);if(!workspace.guild_id)return{ready:false,roles:[],message:'Link a Discord community in Settings first.'};try{return{ready:true,roles:await rewards.roles(workspace.guild_id)};}catch(e){return{ready:false,roles:[],message:e.status?e.message:'Discord role permissions are unavailable.'};}},
  async jobs(ws,id){await order(ws,id);return db.prepare('SELECT id,position,type,status,detail,attempts,preexisting,created_at,updated_at FROM store_delivery_jobs WHERE workspace_id=? AND order_id=? ORDER BY position').all(ws,id);},
  async retry(ws,id){return db.withWorkspaceLock(ws,async()=>{const o=await order(ws,id);if(o.payment_status!=='paid')fail('Only paid orders can retry delivery.',409);await db.prepare("UPDATE store_delivery_jobs SET status='pending',detail='',next_attempt=0,updated_at=? WHERE workspace_id=? AND order_id=? AND status='blocked'").run(Date.now(),ws,id);await refreshDeliveryStatus(db,ws,id);return{ok:true};});},
  async resolve(ws,id,jobId,input,actor){const v=z.object({status:z.enum(['succeeded','cancelled']),note:z.string().trim().min(10).max(500)}).strict().parse(input);return db.withWorkspaceLock(ws,async()=>{await order(ws,id);const row=await db.prepare('SELECT * FROM store_delivery_jobs WHERE workspace_id=? AND order_id=? AND id=?').get(ws,id,jobId);if(!row)fail('Delivery action not found.',404);if(!['uncertain','blocked','pending'].includes(row.status))fail('This action cannot be resolved in its current state.',409);await db.prepare('UPDATE store_delivery_jobs SET status=?,detail=?,updated_at=? WHERE id=?').run(v.status,'Staff resolution: '+v.note,Date.now(),jobId);await refreshDeliveryStatus(db,ws,id);await audit(db,ws,'Purchase action resolved',id+' - '+v.status+' - '+actor.name);return{ok:true};});},
  async recover(){await db.prepare("UPDATE store_delivery_jobs SET status=CASE WHEN type='rcon' THEN 'uncertain' ELSE 'pending' END,detail=CASE WHEN type='rcon' THEN 'Execution was interrupted. Check in-game; do not replay without verification.' ELSE 'Rechecking idempotent Discord role award after restart.' END,updated_at=? WHERE status='executing'").run(Date.now());for(const o of await db.prepare("SELECT DISTINCT workspace_id,order_id FROM store_delivery_jobs WHERE status='uncertain'").all())await refreshDeliveryStatus(db,o.workspace_id,o.order_id);},
  async tick(){if(running||stopped)return;running=true;inFlight=(async()=>{for(let i=0;i<10&&!stopped;i++){const j=await db.prepare("SELECT j.* FROM store_delivery_jobs j JOIN store_orders o ON o.id=j.order_id WHERE j.status='pending' AND j.next_attempt<=? AND o.payment_status='paid' AND NOT EXISTS(SELECT 1 FROM store_delivery_jobs prior WHERE prior.order_id=j.order_id AND prior.position<j.position AND prior.status NOT IN ('succeeded','cancelled')) ORDER BY j.created_at,j.order_id,j.position LIMIT 1").get(Date.now());if(!j)break;await execute(j);}})();try{await inFlight;}finally{running=false;}},
  async stop(){stopped=true;await inFlight;}
 };
}
