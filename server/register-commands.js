import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './bot.js';
import {openDatabase} from './db.js';
import {createVault} from './crypto.js';
import {discordRegistrationConfig} from './discord-registration.js';
let config={clientId:process.env.DISCORD_CLIENT_ID,botToken:process.env.DISCORD_BOT_TOKEN,guildId:process.env.DISCORD_DEV_GUILD_ID},db;
try{
 if(!config.clientId||!config.botToken){db=await openDatabase();config=await discordRegistrationConfig(db,createVault(process.env.ENCRYPTION_KEY),process.env);}
 if(!config.clientId||!config.botToken)throw new Error('missing');
 const rest=new REST({version:'10'}).setToken(config.botToken),route=config.guildId?Routes.applicationGuildCommands(config.clientId,config.guildId):Routes.applicationCommands(config.clientId),commands=await rest.put(route,{body:commandDefinitions()});
 console.log('Registered '+commands.length+' Rookrift slash commands: '+commands.map(c=>c.name).join(', ')+'.');
}catch{console.error('Command registration failed. Configure the Discord application ID and bot token in the environment or encrypted Platform admin settings, and verify access to Discord.');process.exitCode=1;}
finally{await db?.close();}
