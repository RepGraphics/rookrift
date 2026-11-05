import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {deliveryIdentifier} from '../shared/store-delivery.js';
import {chatLinkRecord,chatLinkPlayer} from '../shared/ark-chat-link.js';
import {hash} from './crypto.js';
import {effectivePlan} from './plans.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const accountInput=z.object({game:z.enum(['asa','ase','dayz']),identifier:z.string().trim().min(3).max(100),label:z.string().trim().max(80).default('')}).strict();
const linkEvent=z.union([z.object({server_id:z.string().uuid(),message:z.string().min(1).max(4096)}).strict(),z.object({server_id:z.string().uuid(),code:z.string().regex(/^RR-[A-F0-9]{10,32}$/i),identifier:z.string().min(3).max(100)}).strict()]);

export function createCommunityMembers(db,{service}={}){
  const community=async slug=>{const row=await db.prepare('SELECT * FROM community_sites WHERE slug=? AND enabled=1').get(slug);if(!row)fail('Community page not found.',404);return row;};
  const ensure=async(ws,user)=>db.prepare('INSERT INTO community_members(workspace_id,user_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(ws,user.id,Date.now(),Date.now());
  async function choices(site){
    const ws=await db.prepare('SELECT * FROM workspaces WHERE id=?').get(site.workspace_id),published=JSON.parse(site.server_ids||'[]');
    return(await db.prepare('SELECT id,name,game FROM servers WHERE workspace_id=? ORDER BY created_at,id').all(ws.id)).slice(0,effectivePlan(ws).servers).filter(s=>published.includes(s.id)&&['asa','ase'].includes(s.game));
  }
  async function list(site,user){
    await ensure(site.workspace_id,user);
    return{display_name:(await db.prepare('SELECT display_name FROM community_members WHERE workspace_id=? AND user_id=?').get(site.workspace_id,user.id)).display_name,
      accounts:await db.prepare('SELECT id,game,identifier,label,verified,verified_at,verified_server_id,created_at FROM community_game_accounts WHERE workspace_id=? AND user_id=? ORDER BY created_at,id').all(site.workspace_id,user.id),
      link_servers:await choices(site),link_request:await db.prepare('SELECT game,server_id,expires_at,used_at,created_at FROM community_link_codes WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1').get(site.workspace_id,user.id)||null};
  }
  async function linkFromMessage(server,message){
    const record=chatLinkRecord(message);if(!record)return{linked:false,ignored:true};
    const codeHash=hash(record.code);
    const pending=await db.prepare('SELECT user_id FROM community_link_codes WHERE code_hash=? AND workspace_id=? AND server_id=? AND game=? AND used_at IS NULL AND expires_at>?').get(codeHash,server.workspace_id,server.id,server.game,Date.now());
    if(!pending)return{linked:false,ignored:true};
    if(!service?.action)fail('Server link verification is unavailable.',503);
    await service.action(server.workspace_id,server.id,'status','','Account link verification');
    const latest=await service.getServer(server.workspace_id,server.id);
    let players=[];try{players=JSON.parse(latest.player_list||'[]');}catch{}
    const player=chatLinkPlayer(record,players);if(!player)return{linked:false,ignored:true,reason:'sender_unmatched'};
    const identifier=deliveryIdentifier(player.identifier,'game');
    return claimLink(server,codeHash,identifier);
  }
  async function claimLink(server,codeHash,identifier){const now=Date.now();
    return db.withWorkspaceLock(server.workspace_id,async()=>{
      const current=await db.prepare('SELECT * FROM community_link_codes WHERE code_hash=? FOR UPDATE').get(codeHash);
      if(!current||current.used_at||current.expires_at<=Date.now()||current.server_id!==server.id||current.game!==server.game)return{linked:false,ignored:true};if(!await db.prepare('SELECT 1 FROM community_sites WHERE workspace_id=? AND enabled=1').get(server.workspace_id)||await db.prepare('SELECT 1 FROM suspended_users WHERE user_id=?').get(current.user_id))return{linked:false,ignored:true};
      if(await db.prepare('SELECT id FROM community_game_accounts WHERE workspace_id=? AND game=? AND lower(identifier)=lower(?) AND verified=1 AND user_id<>?').get(server.workspace_id,server.game,identifier,current.user_id))fail('This game account is already verified for another member. Contact community staff.',409);
      const existing=await db.prepare('SELECT id FROM community_game_accounts WHERE workspace_id=? AND user_id=? AND game=? AND identifier=?').get(server.workspace_id,current.user_id,server.game,identifier);
      if(!existing&&(await db.prepare('SELECT count(*) AS n FROM community_game_accounts WHERE workspace_id=? AND user_id=?').get(server.workspace_id,current.user_id)).n>=20)fail('Remove an unused linked game account first.',409);
      await ensure(server.workspace_id,{id:current.user_id});
      await db.prepare('INSERT INTO community_game_accounts(id,workspace_id,user_id,game,identifier,label,verified,created_at,verified_server_id,verified_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(workspace_id,user_id,game,identifier) DO UPDATE SET verified=1,verified_server_id=excluded.verified_server_id,verified_at=excluded.verified_at').run(existing?.id||randomUUID(),server.workspace_id,current.user_id,server.game,identifier,'Verified in game',now,server.id,now);
      await db.prepare('UPDATE community_link_codes SET used_at=? WHERE code_hash=?').run(now,codeHash);
      return{linked:true,game:server.game,identifier};
    });
  }
  return{
    async view(slug,user){if(!user)fail('Sign in to manage linked game accounts.',401);return list(await community(slug),user);},
    async updateProfile(slug,user,input){
      if(!user)fail('Sign in to manage your community profile.',401);
      const value=z.object({display_name:z.string().trim().max(80)}).strict().parse(input),site=await community(slug);
      await ensure(site.workspace_id,user);
      await db.prepare('UPDATE community_members SET display_name=?,updated_at=? WHERE workspace_id=? AND user_id=?').run(value.display_name,Date.now(),site.workspace_id,user.id);
      return {display_name:value.display_name};
    },
    async add(slug,user,input){
      if(!user)fail('Sign in to link a game account.',401);const value=accountInput.parse(input),site=await community(slug),identifier=deliveryIdentifier(value.identifier,'game');
      return db.withWorkspaceLock(site.workspace_id,async()=>{await ensure(site.workspace_id,user);if((await db.prepare('SELECT count(*) AS n FROM community_game_accounts WHERE workspace_id=? AND user_id=?').get(site.workspace_id,user.id)).n>=20)fail('You can save up to 20 game accounts.',409);try{await db.prepare('INSERT INTO community_game_accounts(id,workspace_id,user_id,game,identifier,label,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),site.workspace_id,user.id,value.game,identifier,value.label,Date.now());}catch(e){if(e.code==='23505')fail('That game account is already saved.',409);throw e;}return list(site,user);});
    },
    async createLinkCode(slug,user,game,serverId){
      if(!user)fail('Sign in to link a game account.',401);z.enum(['asa','ase']).parse(game);const site=await community(slug),available=(await choices(site)).filter(s=>s.game===game);
      const server=serverId?available.find(s=>s.id===serverId):available.length===1?available[0]:null;if(!server)fail('Choose a published server for this game.');
      const code='RR-'+randomBytes(8).toString('hex').toUpperCase(),now=Date.now(),expires=now+600000;
      await db.withWorkspaceLock(site.workspace_id,async()=>{await db.prepare('DELETE FROM community_link_codes WHERE user_id=? AND workspace_id=?').run(user.id,site.workspace_id);await db.prepare('INSERT INTO community_link_codes(code_hash,workspace_id,user_id,game,expires_at,created_at,server_id) VALUES(?,?,?,?,?,?,?)').run(hash(code),site.workspace_id,user.id,game,expires,now,server.id);});
      return{code,game,server_id:server.id,server_name:server.name,expires_at:expires,created_at:now,command:'/link '+code};
    },
    async ingestServerChat(serverId,message){const server=await db.prepare('SELECT id,workspace_id,game FROM servers WHERE id=?').get(serverId);if(!server)fail('Server not found.',404);return linkFromMessage(server,message);},
    async ingestChatEvent(token,input){const value=linkEvent.parse(input),server=await db.prepare('SELECT id,workspace_id,game FROM servers WHERE id=? AND link_ingest_token_hash=?').get(value.server_id,hash(token||''));if(!server)fail('Invalid server link-agent credentials.',401);if('message' in value)return{accepted:true,linked:false,source:'native_rcon'};await service.action(server.workspace_id,server.id,'status','','Controller account link verification');const latest=await service.getServer(server.workspace_id,server.id);let players=[];try{players=JSON.parse(latest.player_list||'[]');}catch{}const identifier=deliveryIdentifier(value.identifier,'game');if(!players.some(line=>String(line).slice(String(line).lastIndexOf(',')+1).trim()===identifier))return{linked:false,ignored:true};return claimLink(server,hash(value.code.toUpperCase()),identifier);},
    async remove(slug,user,id){if(!user)fail('Sign in to manage linked game accounts.',401);const site=await community(slug);if(!(await db.prepare('DELETE FROM community_game_accounts WHERE id=? AND workspace_id=? AND user_id=?').run(id,site.workspace_id,user.id)).changes)fail('Linked game account not found.',404);return list(site,user);},
    async resolve(ws,user,id){if(!id)return null;return db.prepare('SELECT game,identifier FROM community_game_accounts WHERE id=? AND workspace_id=? AND user_id=?').get(id,ws,user.id);}
  };
}
