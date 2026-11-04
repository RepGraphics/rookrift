import {createCommunity} from './community.js';
import { Client, GatewayIntentBits, PermissionFlagsBits, EmbedBuilder, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { listServers } from './db.js';
import { effectivePlan } from './plans.js';
export function commandDefinitions() {
  const builder = new SlashCommandBuilder().setName('rookrift').setDescription('Manage your survival servers').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).setContexts(0);
  builder.addSubcommand(c => c.setName('servers').setDescription('List your connected game servers'));
  builder.addSubcommand(c=>c.setName('community').setDescription('Open your published community hub'));
  builder.addSubcommand(c=>c.setName('applications').setDescription('Show the pending community application count'));
  builder.addSubcommand(c => c.setName('dashboard').setDescription('Open your command center'));
  builder.addSubcommand(c => c.setName('maintenance').setDescription('Pause scheduled tasks and alerts for a server').addStringOption(o => o.setName('server').setDescription('Choose a game server').setRequired(true).setAutocomplete(true)).addBooleanOption(o => o.setName('enabled').setDescription('Enable or end maintenance mode').setRequired(true)));
  for (const action of ['status', 'players', 'save', 'broadcast']) {
    builder.addSubcommand(c => {
      c.setName(action).setDescription({
        status: 'Check an ARK server connection',
        players: 'List connected players',
        save: 'Save the world now',
        broadcast: 'Send a server announcement'
      }[action]).addStringOption(o => o.setName('server').setDescription('Choose a game server').setRequired(true).setAutocomplete(true));
      if (action === 'broadcast') c.addStringOption(o => o.setName('message').setDescription('Announcement text').setRequired(true).setMaxLength(300));
      return c;
    });
  }
  return [builder.toJSON()];
}
export async function startBot(db, service, env = process.env) {
  if (!env.DISCORD_BOT_TOKEN) return null;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });
  client.on('error', () => console.error('Discord client error. Check connectivity.'));
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;
    if (interaction.commandName !== 'rookrift') return;
    try {
      const permitted = interaction.inGuild() && interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      const ws = permitted && (await db.prepare('SELECT * FROM workspaces WHERE guild_id=?').get(interaction.guildId));
      if (interaction.isAutocomplete()) {
        const query = interaction.options.getFocused().toLowerCase();
        const choices = ws ? (await listServers(db, ws.id)).slice(0, effectivePlan(ws).servers).filter(s => s.name.toLowerCase().includes(query)).slice(0, 25).map(s => ({
          name: s.name,
          value: s.id
        })) : [];
        await interaction.respond(choices);
        return;
      }
      if (!permitted) {
        await interaction.reply({
          content: 'Manage Server permission is required.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      if (!ws) {
        await interaction.reply({
          content: `Link this Discord community in Dashboard → Settings: ${env.APP_URL}`,
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await interaction.deferReply({
        flags: MessageFlags.Ephemeral
      });
      const action = interaction.options.getSubcommand();
      let title = 'Rookrift',
        description;
      if(action==='community'){const {site}=await createCommunity(db).manage(ws.id);description=site?.enabled?env.APP_URL+'/c/'+site.slug:'Publish a community page from Community hub in your dashboard first.';}else if(action==='applications'){const rows=await createCommunity(db).applications(ws.id);description=`${rows.length} pending application${rows.length===1?'':'s'}. Review privately in the dashboard: ${env.APP_URL}`;}else if (action === 'dashboard') description = env.APP_URL;else if (action === 'servers') {
        title = `${ws.name} · ${effectivePlan(ws).name}`;
        description = (await listServers(db, ws.id)).map((s, i) => `${i >= effectivePlan(ws).servers ? '⏸' : s.status === 'online' ? '🟢' : '⚪'} **${s.name}** · ${s.game.toUpperCase()} · ${s.status === 'online' ? s.players : '—'} players${s.maintenance ? ' · Maintenance' : ''}`).join('\n') || 'No servers yet. Add your first server in the dashboard.';
      } else if (action === 'maintenance') {
        const id = interaction.options.getString('server', true);
        await service.getServer(ws.id, id);
        const server = await service.updateServer(ws.id, id, {
          maintenance: interaction.options.getBoolean('enabled', true)
        });
        title = `${server.name} · Maintenance ${server.maintenance ? 'enabled' : 'ended'}`;
        description = server.maintenance ? 'Scheduled tasks and connection alerts are paused. RCON monitoring and manual controls remain available.' : 'Scheduled tasks and connection alerts have resumed.';
      } else {
        const result = await service.action(ws.id, interaction.options.getString('server', true), action, interaction.options.getString('message'), `Discord: ${interaction.user.username}`);
        title = `Rookrift · ${action}`;
        description = result.players ? result.players.join('\n') || 'No players connected.' : result.output;
      }
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0xc4f56a).setTitle(title).setDescription(String(description).slice(0, 4000)).setFooter({
          text: 'Rookrift · Your servers. Under control.'
        })],
        allowedMentions: {
          parse: []
        }
      });
    } catch (error) {
      const message = error.status ? error.message : 'Unable to complete that command. Please try again.';
      try {
        if (interaction.isAutocomplete()) await interaction.respond([]);else if (interaction.deferred) await interaction.editReply({
          content: message
        });else await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral
        });
      } catch {/* expired interaction */}
    }
  });
  await client.login(env.DISCORD_BOT_TOKEN);
  return client;
}
export async function sendAlert(client, ws, text) {
  if (!client?.isReady() || !ws.guild_id || !ws.alert_channel_id) return;
  const channel = await client.channels.fetch(ws.alert_channel_id);
  if (channel?.guildId === ws.guild_id && channel.isTextBased() && 'send' in channel) await channel.send({
    content: `**Rookrift** · ${text}`,
    allowedMentions: {
      parse: []
    }
  });
}
