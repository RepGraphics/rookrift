export async function discordRegistrationConfig(db,vault,env){
 const result={clientId:env.DISCORD_CLIENT_ID||'',botToken:env.DISCORD_BOT_TOKEN||'',guildId:env.DISCORD_DEV_GUILD_ID||''};
 if(result.clientId&&result.botToken)return result;
 const rows=await db.prepare("SELECT key,value FROM platform_settings WHERE key IN ('discord_client_id','discord_bot_token')").all();
 for(const row of rows){if(row.key==='discord_client_id'&&!result.clientId)result.clientId=vault.decrypt(row.value);if(row.key==='discord_bot_token'&&!result.botToken)result.botToken=vault.decrypt(row.value);}
 return result;
}
