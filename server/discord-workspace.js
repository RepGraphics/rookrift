import {z} from 'zod';
import {PermissionFlagsBits} from 'discord.js';

const id=z.preprocess(value=>typeof value==='string'?(value.trim()||null):value,z.string().regex(/^\d{17,20}$/,'Use a Discord ID containing 17–20 digits.').nullable().optional());
const inputSchema=z.object({name:z.string().trim().min(2).max(60),guild_id:id,alert_channel_id:id,alerts_enabled:z.boolean().optional(),failure_threshold:z.coerce.number().int().min(1).max(5).optional()}).strict();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const manage=guild=>{try{return guild.owner||(BigInt(guild.permissions||0)&0x28n)!==0n;}catch{return false;}};

export function createDiscordWorkspace(db,vault,{getBot,fetchGuilds}){return async(workspace,user,input)=>{
 const value=inputSchema.parse(input),guildId=value.guild_id===undefined?workspace.guild_id:value.guild_id,guildChanged=guildId!==workspace.guild_id;
 const channelId=value.alert_channel_id===undefined?(guildChanged?null:workspace.alert_channel_id):value.alert_channel_id,channelChanged=channelId!==workspace.alert_channel_id;
 let guildName=guildChanged?null:workspace.guild_name;
 if(channelId&&!guildId&&(guildChanged||channelChanged))fail('Add a Discord server ID before choosing an alert channel.');
 if(guildId&&await db.prepare('SELECT 1 FROM workspaces WHERE guild_id=? AND id<>?').get(guildId,workspace.id))fail('That Discord server is already linked to another workspace. Switch to that workspace or unlink it there first.',409);
 if(guildId&&(guildChanged||channelChanged&&channelId)){
  if(!user.platform_admin){
   const saved=await db.prepare('SELECT access_token FROM users WHERE id=?').get(user.id);let token;
   try{if(saved?.access_token)token=vault.decrypt(saved.access_token);}catch{}
   if(!token)fail('Connect your Discord account using the button below before linking a server. Your email sign-in stays available.',409);
   let guilds;try{guilds=await fetchGuilds(token);}catch{fail('Reconnect Discord using the button below to refresh permission to view your servers.',409);}
   if(!Array.isArray(guilds)||!guilds.some(g=>g.id===guildId&&manage(g)))fail('Your linked Discord account needs Manage Server permission in that server.',403);
  }
  const bot=getBot();if(!bot?.isReady())fail(user.platform_admin?'The Discord bot is offline. Configure its token in Platform admin → Global settings and restart the service, then retry.':'The Discord bot is offline. Ask the service operator to reconnect it, then retry.',503);
  let guild;try{guild=await bot.guilds.fetch(guildId);}catch{fail('Invite Rookrift to that Discord server before saving this connection.');}
  if(!guild||guild.id!==guildId)fail('Invite Rookrift to that Discord server before saving this connection.');
  guildName=guild.name;
  if(channelId){
   let channel;try{channel=await bot.channels.fetch(channelId);}catch{fail('The alert channel could not be found. Copy its channel ID and check that the bot can view it.');}
   if(!channel||channel.guildId!==guildId||!channel.isTextBased()||typeof channel.send!=='function')fail('Choose a text channel in the selected Discord server.');
   let member;try{member=await guild.members.fetchMe();}catch{fail('The bot could not verify its server permissions. Try again shortly.',503);}
   const permissions=channel.permissionsFor(member),sendPermission=channel.isThread?.()?PermissionFlagsBits.SendMessagesInThreads:PermissionFlagsBits.SendMessages;
   if(!permissions?.has([PermissionFlagsBits.ViewChannel,sendPermission]))fail('Give Rookrift View Channel and Send Messages permissions in the alert channel, then retry.',403);
  }
 }
 return db.withWorkspaceLock(workspace.id,async()=>{
  const fresh=await db.prepare('SELECT * FROM workspaces WHERE id=?').get(workspace.id),owner=await db.prepare('SELECT deleting_at FROM users WHERE id=?').get(fresh.owner_id);
  if(fresh.closed_at||!owner||owner.deleting_at)fail('This workspace is closing. Refresh the page.',409);
  if(fresh.guild_id!==workspace.guild_id||fresh.alert_channel_id!==workspace.alert_channel_id)fail('The Discord connection changed while you were editing. Refresh and retry.',409);
  try{await db.prepare('UPDATE workspaces SET name=?,guild_id=?,guild_name=?,alert_channel_id=?,alerts_enabled=?,failure_threshold=? WHERE id=?').run(value.name,guildId,guildName,channelId,value.alerts_enabled===undefined?fresh.alerts_enabled:Number(value.alerts_enabled),value.failure_threshold??fresh.failure_threshold,workspace.id);}catch(error){if(error.code==='23505')fail('That Discord server is already linked to another workspace.',409);throw error;}
  return{ok:true};
 });
};}
