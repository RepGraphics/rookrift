import { PLANS } from '../server/plans.js';
const now = Date.now();
export const demoSeed = {
  user: { id: 'demo', name: 'Alex Morgan' },
  workspace: { id: 'demo', name: 'The Outpost', plan: 'tribe', subscription_status: 'active', hasBillingAccount: false, guild_id: '123456789012345678', guild_name: 'The Outpost', alert_channel_id: '123456789012345679' },
  integrations: { discord: true, billing: false, invite: null },
  plans: Object.values(PLANS),
  servers: [
    { id: 'd1', name: 'The Island · PvE', game: 'asa', map: 'The Island', host: 'island.example.com', port: 27020, max_players: 70, players: 32, latency: 24, status: 'online', created_at: now - 9000000 },
    { id: 'd2', name: 'Scorched Earth · PvP', game: 'asa', map: 'Scorched Earth', host: 'scorched.example.com', port: 27020, max_players: 70, players: 18, latency: 31, status: 'online', created_at: now - 8000000 },
    { id: 'd3', name: 'Ragnarok · PvE', game: 'ase', map: 'Ragnarok', host: 'ragnarok.example.com', port: 27020, max_players: 70, players: 0, latency: null, status: 'offline', created_at: now - 7000000 }
  ],
  schedules: [
    { id: 't1', name: 'Keep the world safe', server_id: 'd1', action: 'save', message: '', interval_minutes: 60, next_run: now + 2400000, enabled: 1 },
    { id: 't2', name: 'Community reminder', server_id: 'd2', action: 'broadcast', message: 'Join our Discord community for news and events!', interval_minutes: 120, next_run: now + 5400000, enabled: 1 }
  ],
  activity: [
    { id: 'a1', title: 'World saved', detail: 'The Island · PvE · Scheduled save', level: 'success', created_at: now - 120000 },
    { id: 'a2', title: 'Server went offline', detail: 'Ragnarok · PvE · RCON connection lost', level: 'error', created_at: now - 840000 },
    { id: 'a3', title: 'Broadcast sent', detail: 'Scorched Earth · PvP · Community reminder', level: 'info', created_at: now - 1800000 },
    { id: 'a4', title: 'Server connected', detail: 'Scorched Earth · PvP added to your workspace', level: 'success', created_at: now - 3600000 }
  ],
  metrics: { uptime: 98.7, history: [19, 17, 16, 20, 25, 23, 31, 27, 22, 28, 34, 31, 32, 38, 42, 37, 44, 41, 50, 45, 48, 43, 53, 50].map((players, i) => ({ time: now - (23 - i) * 3600000, players })) }
};
export function loadDemo() {
  try { const saved = JSON.parse(localStorage.getItem('rookrift-demo-v1')); if (saved?.workspace && Array.isArray(saved.servers) && Array.isArray(saved.activity)) return saved; } catch { /* storage may be unavailable */ }
  return structuredClone(demoSeed);
}
export function storeDemo(data) { try { localStorage.setItem('rookrift-demo-v1', JSON.stringify(data)); } catch { /* continue with in-memory demo */ } }
