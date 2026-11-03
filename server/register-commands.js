import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './bot.js';
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_BOT_TOKEN) throw new Error('Configure DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN first.');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
const route = process.env.DISCORD_DEV_GUILD_ID ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_DEV_GUILD_ID) : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
await rest.put(route, { body: commandDefinitions() });
console.log('Rookrift slash commands registered.');
