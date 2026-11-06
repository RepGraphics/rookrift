import {validatePurchaseCommand} from '../shared/store-delivery.js';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { sourceRcon } from './source-rcon.js';
export {GAMES} from '../shared/games.js';
import {GAMES,assertGameAction} from '../shared/games.js';
import {battleyeRcon} from './battleye-rcon.js';
import {minecraftPlayers,battleyePlayers} from './game-players.js';
export async function resolveTarget(host, allowPrivate = process.env.ALLOW_PRIVATE_RCON === 'true') {
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || (!allowPrivate && addresses.some(item => ipaddr.process(item.address).range() !== 'unicast'))) {
    throw Object.assign(new Error('RCON must use a public server address. Private networks require operator configuration.'), { status: 400 });
  }
  // Pin the validated address, preventing a second DNS lookup from bypassing validation.
  return addresses[0].address;
}
export function commandFor(action, message = '', game = '') {
  if(game)assertGameAction(game,action);
  if(game==='minecraft'){
   if(action==='purchase')return validatePurchaseCommand(message);
   if(['players','status'].includes(action))return 'list';if(action==='save')return 'save-all flush';
   if(['kick','ban','unban'].includes(action)){if(!/^[A-Za-z0-9_]{3,16}$/.test(message))throw Object.assign(new Error('Use an exact Minecraft Java username.'),{status:400});return (action==='unban'?'pardon':action)+' '+message;}
   if(action==='broadcast'){const text=String(message).replace(/[\x00-\x1f\x7f]/g,' ').trim();if(!text||text.length>300)throw Object.assign(new Error('Use a message of 1-300 characters.'),{status:400});return 'say '+text;}
   if(action==='direct'){const at=message.indexOf('|'),name=message.slice(0,at),text=message.slice(at+1).replace(/[\x00-\x1f\x7f]/g,' ').trim();if(at<1||!/^\w{3,16}$/.test(name)||!text||text.length>300)throw Object.assign(new Error('Choose a Minecraft username and a message.'),{status:400});return 'tell '+name+' '+text;}
  }
  if(game==='dayz'){
   if(action==='purchase'){const command=validatePurchaseCommand(message);if(/[^\x20-\x7e]/.test(command))throw Object.assign(new Error('DayZ BattlEye commands must use plain ASCII characters.'),{status:400});return command;}
   if(['players','status'].includes(action))return 'players';
   if(action==='ban'){if(!/^[a-f0-9]{32}$/i.test(message))throw Object.assign(new Error('Use an exact BattlEye GUID.'),{status:400});return 'addBan '+message.toLowerCase()+' 0';}
   if(action==='broadcast'){const text=String(message).trim();if(!text||text.length>300||/[^\x20-\x7e]/.test(text))throw Object.assign(new Error('DayZ broadcasts need 1-300 plain ASCII characters.'),{status:400});return 'say -1 '+text;}
  }
  if(action==='purchase')return validatePurchaseCommand(message);
  if (action === 'players' || action === 'status') return 'ListPlayers';
  if (action === 'chat') return 'GetChat';
  if (action === 'save') return 'SaveWorld';
  if (['kick','ban','unban'].includes(action)) {
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(message)) throw Object.assign(new Error('Use a valid server-reported player identifier.'),{status:400});
    return `${({kick:'KickPlayer',ban:'BanPlayer',unban:'UnbanPlayer'})[action]} ${message}`;
  }
  if (action === 'broadcast') {
    const cleaned = message.replace(/[\x00-\x1f\x7f|]/g, ' ').trim();
    if (!cleaned || cleaned.length > 300) throw Object.assign(new Error('Broadcast must contain 1–300 characters.'), { status: 400 });
    return `${game === 'asa' ? 'ServerChat' : 'Broadcast'} ${cleaned}`;
  }
  if (action === 'direct') {
    const separator = message.indexOf('|'), player = message.slice(0, separator).trim(), text = message.slice(separator + 1).replace(/[\x00-\x1f\x7f|]/g, ' ').trim();
    if (separator < 1 || !/^[A-Za-z0-9 _-]{1,100}$/.test(player) || !text || text.length > 300) throw Object.assign(new Error('Use a valid player name and message.'), { status: 400 });
    return `ServerChatToPlayer ${player} ${text}`;
  }
  throw Object.assign(new Error('Unsupported server action.'), { status: 400 });
}
export function parsePlayers(response) {
  if (/no players connected/i.test(response)) return [];
  return response.split(/\r?\n/).filter(line => /^\d+\.\s/.test(line)).map(line => line.replace(/^\d+\.\s*/, '').trim());
}
export async function runRcon(server, vault, action, message) {
  if (!GAMES[server.game]?.available) throw new Error('This game adapter is not available yet.');
  const command = commandFor(action, message, server.game), host = await resolveTarget(server.host);
  const start = Date.now();
  const output = await (server.game==='dayz'?battleyeRcon:sourceRcon)({host,port:server.port,password:vault.decrypt(server.password),command});
  const players=['players','status'].includes(action)?server.game==='minecraft'?minecraftPlayers(output):server.game==='dayz'?battleyePlayers(output):parsePlayers(output):undefined;
  const capacity=server.game==='minecraft'&&players?Number(output.replace(/\u00a7[0-9a-fk-or]/gi,'').match(/of a max of (\d+) players online:/i)?.[1]):0;
  return {output:server.game==='dayz'&&players?(players.join('\n')||'No players connected.'):output||'Command acknowledged.',latency:Date.now()-start,...(players?{players}:{}),...(capacity>0&&capacity<=1000?{metadata:{max_players:capacity}}:{})};
}
