import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,escapeMarkdown} from 'discord.js';
const amount=(value,currency)=>new Intl.NumberFormat('en-GB',{style:'currency',currency:currency.toUpperCase()}).format(value/100);
const status={pending:'Awaiting payment',paid:'Paid',expired:'Expired',failed:'Payment failed',refunded:'Refunded',partially_refunded:'Partially refunded',disputed:'Under review'};

export async function handleStoreInteraction(db,store,interaction,env){
 if(!['shop','orders'].includes(interaction.commandName))return false;
 try{
  if(interaction.isAutocomplete?.()){await interaction.respond([]);return true;}
  if(!interaction.inGuild()){await interaction.reply({content:'Use this command in your community’s Discord server.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return true;}
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const workspaces=await db.prepare('SELECT id,name FROM workspaces WHERE guild_id=? AND closed_at IS NULL ORDER BY id LIMIT 2').all(interaction.guildId);
  if(workspaces.length!==1){await interaction.editReply({content:'This Discord server does not have a single active Rookrift community linked yet.',allowedMentions:{parse:[]}});return true;}
  const ws=workspaces[0],site=await db.prepare('SELECT slug,title,enabled FROM community_sites WHERE workspace_id=?').get(ws.id);
  if(!site){await interaction.editReply({content:'The community website is not available yet.',allowedMentions:{parse:[]}});return true;}
  const origin=new URL(env.APP_URL).origin,url=origin+'/c/'+encodeURIComponent(site.slug),row=new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(interaction.commandName==='shop'?'Open community store':'Open my orders').setURL(url+'?page=store'));
  const embed=new EmbedBuilder().setColor(0x91baa9).setTitle((site.title+' · '+(interaction.commandName==='shop'?'Store':'Your orders')).slice(0,256));
  if(interaction.commandName==='shop'){
   if(!site.enabled){await interaction.editReply({content:'This community store is not published yet.',allowedMentions:{parse:[]}});return true;}
   const page=await store.publicPage(site.slug,null),products=page.products.filter(p=>p.availability?.available!==false).sort((a,b)=>a.sort_order-b.sort_order||a.title.localeCompare(b.title)).slice(0,5);
   embed.setDescription(products.length?products.map(p=>'**'+escapeMarkdown(p.title)+'** · '+(p.price===0?'Free':amount(p.price,page.currency))+'\n'+escapeMarkdown(p.description.slice(0,150))).join('\n\n'):'The catalog is being prepared. Check the website for updates.').setFooter({text:'Preview of up to five available packages. Review prices, recipients and terms on the website.'});
  }else{
   const users=await db.prepare("SELECT id FROM users WHERE deleting_at IS NULL AND (discord_id=? OR (discord_id IS NULL AND id=?)) AND NOT EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=users.id) LIMIT 2").all(interaction.user.id,interaction.user.id);
   if(users.length!==1){await interaction.editReply({content:'Sign in to the community website and link this Discord account under My account → Sign-in & security to view your orders.',components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open my account').setURL(url+'?page=account'))],allowedMentions:{parse:[]}});return true;}
   const orders=await db.prepare('SELECT id,title,amount,currency,payment_status,fulfillment_status FROM store_orders WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 5').all(ws.id,users[0].id);
   embed.setDescription(orders.length?orders.map(o=>'**'+escapeMarkdown(o.title)+'** · '+(o.amount===0?'Free':amount(o.amount,o.currency))+'\n'+status[o.payment_status]+' · '+(o.fulfillment_status==='fulfilled'?'Delivered':o.fulfillment_status==='review_required'?'Staff review required':o.payment_status==='paid'?'Delivery pending':'Payment pending')+'\n`'+o.id+'`').join('\n\n'):'You do not have any purchases in this community yet.').setFooter({text:'Your latest five orders. This reply is visible only to you.'});
  }
  await interaction.editReply({embeds:[embed],components:site.enabled?[row]:[],allowedMentions:{parse:[]}});
 }catch(error){const content=error.status&&error.status<500?'The community store is unavailable. Please check the website.':'Unable to load the store right now. Please try again.';try{if(interaction.deferred)await interaction.editReply({content,allowedMentions:{parse:[]}});else await interaction.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});}catch{/* An expired interaction cannot receive another reply. */}}
 return true;
}
