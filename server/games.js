import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { sourceRcon } from './source-rcon.js';
export const GAMES = {
  asa: { id: 'asa', name: 'ARK: Survival Ascended', protocol: 'source-rcon', available: true },
  ase: { id: 'ase', name: 'ARK: Survival Evolved', protocol: 'source-rcon', available: true },
  dayz: { id: 'dayz', name: 'DayZ', protocol: 'battleye', available: false }
};
export async function resolveTarget(host, allowPrivate = process.env.ALLOW_PRIVATE_RCON === 'true') {
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || (!allowPrivate && addresses.some(item => ipaddr.process(item.address).range() !== 'unicast'))) {
    throw Object.assign(new Error('RCON must use a public server address. Private networks require operator configuration.'), { status: 400 });
  }
  // Pin the validated address, preventing a second DNS lookup from bypassing validation.
  return addresses[0].address;
}
export function commandFor(action, message = '') {
  if (action === 'players' || action === 'status') return 'ListPlayers';
  if (action === 'save') return 'SaveWorld';
  if (action === 'broadcast') {
    const cleaned = message.replace(/[\r\n\x00-\x1f]/g, ' ').trim();
    if (!cleaned || cleaned.length > 300) throw Object.assign(new Error('Broadcast must contain 1–300 characters.'), { status: 400 });
    return `Broadcast ${cleaned}`;
  }
  throw Object.assign(new Error('Unsupported server action.'), { status: 400 });
}
export function parsePlayers(response) {
  if (/no players connected/i.test(response)) return [];
  return response.split(/\r?\n/).filter(line => /^\d+\.\s/.test(line)).map(line => line.replace(/^\d+\.\s*/, '').trim());
}
export async function runRcon(server, vault, action, message) {
  if (!GAMES[server.game]?.available) throw new Error('This game adapter is not available yet.');
  const command = commandFor(action, message), host = await resolveTarget(server.host);
  const start = Date.now();
  const output = await sourceRcon({ host, port: server.port, password: vault.decrypt(server.password), command });
  return { output: output || 'Command acknowledged.', latency: Date.now() - start, ...(action === 'players' || action === 'status' ? { players: parsePlayers(output) } : {}) };
}
