import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { hash } from './crypto.js';
import { effectivePlan, PLANS } from './plans.js';
import { listServers, publicServer, playerSnapshot, audit } from './db.js';
import { GAMES, resolveTarget } from './games.js';
import { serverSchema, serverUpdateSchema } from './service.js';
const discordFetch = async (path, token) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Object.assign(new Error('Discord authorization expired or is unavailable. Sign in again.'), { status: 401 });
  return response.json();
};
const canManage = guild => guild.owner || (BigInt(guild.permissions || 0) & 0x28n) !== 0n;
export function createApp({ db, vault, service, billing, getBot = () => null, env = process.env }) {
  const app = express(), origin = new URL(env.APP_URL || 'http://localhost:3000').origin;
  const secure = env.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', Number(env.TRUST_PROXY_HOPS || 0));
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'], 'style-src': ["'self'", "'unsafe-inline'"], 'script-src': ["'self'"], 'connect-src': ["'self'"] } } }));
  app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    await billing.webhook(req.body, req.headers['stripe-signature']); res.json({ received: true });
  });
  app.use(express.json({ limit: '16kb' }), cookieParser());
  app.get('/api/health', (_, res) => res.json({ status: 'ok', service: 'rookrift' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/auth', rateLimit({ windowMs: 900000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  app.get('/auth/discord', (req, res) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) { res.status(503).send('Discord sign-in is not configured. See the Rookrift setup guide.'); return; }
    const state = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO oauth_states VALUES(?,?)').run(hash(state), Date.now() + 600000);
    res.cookie('rookrift_oauth', state, { ...cookieOptions, maxAge: 600000 });
    const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify guilds', redirect_uri: env.DISCORD_REDIRECT_URI, state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/discord/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const row = state && db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(hash(state));
    if (!row || row.expires_at < Date.now() || req.cookies.rookrift_oauth !== state || typeof req.query.code !== 'string') { res.status(400).send('Sign-in state is invalid or expired. Please sign in again.'); return; }
    db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash(state));
    res.clearCookie('rookrift_oauth', cookieOptions);
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: env.DISCORD_REDIRECT_URI }), signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) { res.status(401).send('Discord sign-in failed. Please try again.'); return; }
    const token = await response.json(), user = await discordFetch('/users/@me', token.access_token);
    db.prepare('INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar,access_token=excluded.access_token').run(user.id, user.global_name || user.username, user.avatar || null, vault.encrypt(token.access_token));
    db.prepare('INSERT OR IGNORE INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run(randomUUID(), user.id, Date.now());
    const session = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(session), user.id, csrf, Date.now() + 7 * 86400000);
    res.cookie('rookrift_session', session, { ...cookieOptions, maxAge: 7 * 86400000 }).redirect(origin);
  });
  app.use('/api', (req, res, next) => {
    const sessionToken = req.cookies.rookrift_session;
    const session = sessionToken && db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(sessionToken), Date.now());
    if (!session) { res.status(401).json({ error: 'Sign in with Discord to continue.' }); return; }
    req.auth = session;
    req.workspace = db.prepare('SELECT * FROM workspaces WHERE owner_id=?').get(session.user_id);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('Origin') !== origin || req.get('X-CSRF-Token') !== session.csrf)) { res.status(403).json({ error: 'Request verification failed. Refresh the dashboard.' }); return; }
    next();
  });
  app.get('/api/bootstrap', (req, res) => {
    const ws = req.workspace, plan = effectivePlan(ws), servers = listServers(db, ws.id);
    const user = db.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(req.auth.user_id);
    const schedules = db.prepare('SELECT * FROM schedules WHERE workspace_id=? ORDER BY rowid').all(ws.id).map((s, i) => ({ ...s, paused: i >= plan.schedules || !servers.slice(0, plan.servers).some(server => server.id === s.server_id) }));
    const history = db.prepare('SELECT CAST(m.created_at/3600000 AS INTEGER)*3600000 AS time, SUM(m.players) AS players,COUNT(*) AS samples FROM metrics m JOIN servers s ON m.server_id=s.id WHERE s.workspace_id=? AND m.created_at>? GROUP BY time ORDER BY time').all(ws.id, Date.now() - 86400000);
    const uptime = db.prepare('SELECT AVG(m.online)*100 AS value FROM metrics m JOIN servers s ON m.server_id=s.id WHERE s.workspace_id=? AND m.created_at>?').get(ws.id, Date.now() - 86400000).value;
    // Bucket average across polling cycles instead of summing repeated player samples.
    const activeCount = Math.max(1, Math.min(servers.length, plan.servers));
    const chart = history.map(h => ({ time: h.time, players: Math.round(h.players / Math.max(1, h.samples / activeCount)) }));
    const activity = db.prepare('SELECT * FROM activity WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100').all(ws.id);
    const invite = env.DISCORD_CLIENT_ID ? `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, scope: 'bot applications.commands', permissions: '19456', integration_type: '0' })}` : null;
    const entitled = servers.map((server, i) => ({ ...server, paused: i >= plan.servers }));
    res.set('Cache-Control', 'no-store').json({ user, workspace: { id: ws.id, name: ws.name, plan: plan.id, subscription_status: ws.subscription_status, hasBillingAccount: Boolean(ws.customer_id), guild_id: ws.guild_id, guild_name: ws.guild_name, alert_channel_id: ws.alert_channel_id, alerts_enabled: Boolean(ws.alerts_enabled) }, servers: entitled.map(s => publicServer(s, s.paused)), players: playerSnapshot(entitled), schedules, activity, metrics: { history: chart, uptime }, plans: Object.values(PLANS), games: Object.values(GAMES), csrf: req.auth.csrf, integrations: { discord: Boolean(getBot()?.isReady()), billing: billing.ready, invite } });
  });
  app.post('/api/logout', (req, res) => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.auth.token_hash); res.clearCookie('rookrift_session', cookieOptions).json({ ok: true }); });
  app.post('/api/servers', async (req, res) => {
    const input = serverSchema.parse(req.body);
    await resolveTarget(input.host);
    res.status(201).json(service.addServer(req.workspace.id, input));
  });
  app.patch('/api/servers/:id', async (req, res) => {
    const input = serverUpdateSchema.parse(req.body);
    service.getServer(req.workspace.id, req.params.id, false);
    if (input.host !== undefined) await resolveTarget(input.host);
    res.json(service.updateServer(req.workspace.id, req.params.id, input));
  });
  app.post('/api/servers/bulk-actions', async (req, res) => res.json(await service.bulkAction(req.workspace.id, req.body)));
  app.delete('/api/servers/:id', (req, res) => {
    const server = service.getServer(req.workspace.id, req.params.id, false);
    db.prepare('DELETE FROM servers WHERE id=? AND workspace_id=?').run(server.id, req.workspace.id);
    audit(db, req.workspace.id, 'Server removed', server.name); res.json({ ok: true });
  });
  app.post('/api/servers/:id/actions', async (req, res) => {
    const input = z.object({ action: z.enum(['status', 'players', 'save', 'broadcast']), message: z.string().max(300).optional() }).parse(req.body);
    res.json(await service.action(req.workspace.id, req.params.id, input.action, input.message));
  });
  app.post('/api/schedules', (req, res) => res.status(201).json(service.addSchedule(req.workspace.id, req.body)));
  app.patch('/api/schedules/:id', (req, res) => {
    res.json(service.updateSchedule(req.workspace.id, req.params.id, req.body));
  });
  app.post('/api/schedules/:id/run', async (req, res) => res.json(await service.runSchedule(req.workspace.id, req.params.id)));
  app.delete('/api/schedules/:id', (req, res) => { db.prepare('DELETE FROM schedules WHERE id=? AND workspace_id=?').run(req.params.id, req.workspace.id); res.json({ ok: true }); });
  app.patch('/api/workspace', async (req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(60), guild_id: z.string().regex(/^\d{17,20}$/).nullable().optional(), alert_channel_id: z.string().regex(/^\d{17,20}$/).nullable().optional(), alerts_enabled: z.boolean().optional() }).parse(req.body);
    let guildId = req.workspace.guild_id, guildName = req.workspace.guild_name, channelId = req.workspace.alert_channel_id;
    const bot = getBot();
    if (input.guild_id !== undefined && input.guild_id !== guildId) {
      guildId = input.guild_id; guildName = null; channelId = null;
      if (guildId) {
        const user = db.prepare('SELECT access_token FROM users WHERE id=?').get(req.auth.user_id);
        const guilds = await discordFetch('/users/@me/guilds', vault.decrypt(user.access_token));
        const guild = guilds.find(g => g.id === guildId && canManage(g));
        if (!guild) throw Object.assign(new Error('You need Manage Server permission in that Discord community.'), { status: 403 });
        if (!bot?.isReady() || !await bot.guilds.fetch(guildId).catch(() => null)) throw Object.assign(new Error('Invite the Rookrift bot to that Discord server first.'), { status: 400 });
        guildName = guild.name;
      }
    }
    if (input.alert_channel_id !== undefined) {
      channelId = input.alert_channel_id;
      if (channelId && (channelId !== req.workspace.alert_channel_id || guildId !== req.workspace.guild_id)) {
        const channel = bot?.isReady() && await bot.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.guildId !== guildId || !channel.isTextBased() || !('send' in channel)) throw Object.assign(new Error('Choose a text channel in the linked Discord community.'), { status: 400 });
      }
    }
    const occupied = guildId && db.prepare('SELECT id FROM workspaces WHERE guild_id=? AND id!=?').get(guildId, req.workspace.id);
    if (occupied) throw Object.assign(new Error('That Discord community is already linked to another workspace.'), { status: 409 });
    db.prepare('UPDATE workspaces SET name=?,guild_id=?,guild_name=?,alert_channel_id=?,alerts_enabled=? WHERE id=?').run(input.name, guildId, guildName, channelId, input.alerts_enabled === undefined ? req.workspace.alerts_enabled : Number(input.alerts_enabled), req.workspace.id);
    res.json({ ok: true });
  });
  app.post('/api/billing/checkout', async (req, res) => { const { plan } = z.object({ plan: z.enum(['tribe', 'cluster']) }).parse(req.body); res.json({ url: await billing.checkout(req.workspace, plan) }); });
  app.post('/api/billing/portal', async (req, res) => res.json({ url: await billing.portal(req.workspace) }));
  app.use('/api', (_, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  if (existsSync(resolve('dist/index.html'))) { app.use(express.static(resolve('dist'))); app.get('/{*path}', (_, res) => res.sendFile(resolve('dist/index.html'))); }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(i => i.message).join(' ') }); return; }
    const status = error.status || 500;
    if (status >= 500) console.error(`${req.method} ${req.path}: request failed (${status})`);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : error.message });
  });
  return app;
}
