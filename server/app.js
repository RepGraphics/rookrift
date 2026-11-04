import { createMetricsCache } from './cache.js';
import { createTeam, staffAudit } from './team.js';
import { authorizeRequest } from './access.js';
import { buildDashboard } from './dashboard.js';
import { createPlayerProfiles } from './player-profiles.js';
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
import { createOperations } from './operations.js';
import { maintenanceState } from './operations-state.js';
import { createBanDirectory } from './ban-directory.js';
const discordFetch = async (path, token) => {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Object.assign(new Error('Discord authorization expired or is unavailable. Sign in again.'), {
    status: 401
  });
  return response.json();
};
const canManage = guild => guild.owner || (BigInt(guild.permissions || 0) & 0x28n) !== 0n;
export function createApp({
  db,
  vault,
  service,
  billing,
  operations: providedOperations,
  cache = createMetricsCache({
    url: null
  }),
  getBot = () => null,
  env = process.env
}) {
  const operations = providedOperations || createOperations(db, vault, service, undefined, cache);
  const banDirectory = createBanDirectory(db),
    team = createTeam(db),
    profiles = createPlayerProfiles(db);
  const app = express(),
    origin = new URL(env.APP_URL || 'http://localhost:3000').origin;
  const secure = env.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', Number(env.TRUST_PROXY_HOPS || 0));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'script-src': ["'self'"],
        'connect-src': ["'self'"]
      }
    }
  }));
  app.post('/api/webhooks/stripe', express.raw({
    type: 'application/json',
    limit: '1mb'
  }), async (req, res) => {
    await billing.webhook(req.body, req.headers['stripe-signature']);
    res.json({
      received: true
    });
  });
  app.use(express.json({
    limit: '16kb'
  }), cookieParser());
  app.get('/api/health', (_, res) => res.json({
    status: 'ok',
    service: 'rookrift'
  }));
  app.get('/api/ready', async (req, res) => {
    try {
      await db.ping();
      res.json({
        status: 'ok',
        database: 'postgres',
        cache: cache.status
      });
    } catch {
      res.status(503).json({
        status: 'unavailable',
        database: 'unavailable',
        cache: cache.status
      });
    }
  });
  app.use('/api', rateLimit({
    windowMs: 60000,
    limit: 180,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  }));
  app.use('/auth', rateLimit({
    windowMs: 900000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  }));
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/'
  };
  app.get('/auth/discord', async (req, res) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
      res.status(503).send('Discord sign-in is not configured. See the Rookrift setup guide.');
      return;
    }
    const state = randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO oauth_states VALUES(?,?)').run(hash(state), Date.now() + 600000);
    res.cookie('rookrift_oauth', state, {
      ...cookieOptions,
      maxAge: 600000
    });
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      response_type: 'code',
      scope: 'identify guilds',
      redirect_uri: env.DISCORD_REDIRECT_URI,
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/discord/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if(!state||req.cookies.rookrift_oauth!==state||typeof req.query.code!=='string'){res.status(400).send('Sign-in state is invalid or expired. Please sign in again.');return;}
    const row=await db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash').get(hash(state),Date.now());
    if(!row){res.status(400).send('Sign-in state is invalid or expired. Please sign in again.');return;}
    res.clearCookie('rookrift_oauth', cookieOptions);
    const response = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: env.DISCORD_REDIRECT_URI
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      res.status(401).send('Discord sign-in failed. Please try again.');
      return;
    }
    const token = await response.json(),
      user = await discordFetch('/users/@me', token.access_token);
    await db.prepare('INSERT INTO users VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar,access_token=excluded.access_token').run(user.id, user.global_name || user.username, user.avatar || null, vault.encrypt(token.access_token));
    await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(randomUUID(), user.id, Date.now());
    const session = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(session), user.id, csrf, Date.now() + 7 * 86400000);
    res.cookie('rookrift_session', session, {
      ...cookieOptions,
      maxAge: 7 * 86400000
    }).redirect(origin);
  });
  app.use('/api', async (req, res, next) => {
    const sessionToken = req.cookies.rookrift_session;
    const session = sessionToken && (await db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(sessionToken), Date.now()));
    if (!session) {
      res.status(401).json({
        error: 'Sign in with Discord to continue.'
      });
      return;
    }
    req.auth = session;
    res.set('Cache-Control', 'no-store');
    req.user = await db.prepare('SELECT id,name,avatar FROM users WHERE id=?').get(session.user_id);
    const context = await team.resolve(session);
    req.workspace = context.workspace;
    req.access = context.access;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.get('Origin') !== origin || req.get('X-CSRF-Token') !== session.csrf)) {
      res.status(403).json({
        error: 'Request verification failed. Refresh the dashboard.'
      });
      return;
    }
    await authorizeRequest(db, req);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && /^\/(servers|schedules|templates|maintenance-windows|incidents|moderation)(\/|$)/.test(req.path)) {
      const action = req.method + ' ' + req.path,
        workspace = req.workspace.id,
        user = req.user,
        server = req.body?.server_id || null;
      res.on('finish', async () => {
        if (res.statusCode < 300) await staffAudit(db, workspace, user, action, null, server).catch(() => console.error('Staff audit write failed.'));
      });
    }
    next();
  });
  app.get('/api/bootstrap', async (req, res) => res.set('Cache-Control', 'no-store').json(await buildDashboard({
    db,
    req,
    operations,
    banDirectory,
    team,
    billing,
    bot: getBot(),
    env
  })));
  app.get('/api/workspaces', async (req, res) => res.set('Cache-Control', 'no-store').json(await team.listWorkspaces(req.auth.user_id)));
  app.post('/api/workspaces/switch', async (req, res) => {
    const value = z.object({
      workspace_id: z.string().min(1).max(100)
    }).strict().parse(req.body);
    res.json(await team.switchWorkspace(req.auth, value.workspace_id));
  });
  app.get('/api/team', async (req, res) => res.set('Cache-Control', 'no-store').json(await team.summary(req.workspace.id)));
  app.post('/api/team/invitations', async (req, res) => res.status(201).json(await team.invite(req.workspace.id, req.body, req.user, origin)));
  app.post('/api/team/invitations/preview', async (req, res) => {
    const value = z.object({
      token: z.string().length(64)
    }).strict().parse(req.body);
    res.set('Cache-Control', 'no-store').json(await team.preview(value.token, req.auth.user_id));
  });
  app.post('/api/team/invitations/accept', async (req, res) => {
    const value = z.object({
      token: z.string().length(64)
    }).strict().parse(req.body);
    res.json(await team.accept(value.token, req.user, req.auth));
  });
  app.delete('/api/team/invitations/:id', async (req, res) => res.json(await team.revoke(req.workspace.id, req.params.id, req.user)));
  app.patch('/api/team/members/:id', async (req, res) => res.json(await team.update(req.workspace.id, req.params.id, req.body, req.user)));
  app.delete('/api/team/members/:id', async (req, res) => res.json(await team.remove(req.workspace.id, req.params.id, req.user)));
  app.get('/api/player-profiles', async (req, res) => res.set('Cache-Control', 'no-store').json(await profiles.list(req.workspace.id, req.query, req.access.server_ids)));
  app.get('/api/player-profiles/:id', async (req, res) => res.set('Cache-Control', 'no-store').json(await profiles.detail(req.workspace.id, req.params.id, req.access.server_ids)));
  app.post('/api/player-profiles/:id/notes', async (req, res) => res.status(201).json(await profiles.addNote(req.workspace.id, req.params.id, req.body, req.user, req.access.server_ids)));
  app.patch('/api/player-profiles/:id/notes/:note', async (req, res) => res.json(await profiles.updateNote(req.workspace.id, req.params.id, req.params.note, req.body, req.user, req.access)));
  app.delete('/api/player-profiles/:id/notes/:note', async (req, res) => res.json(await profiles.deleteNote(req.workspace.id, req.params.id, req.params.note, req.user, req.access)));
  app.post('/api/logout', async (req, res) => {
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.auth.token_hash);
    res.clearCookie('rookrift_session', cookieOptions).json({
      ok: true
    });
  });
  app.post('/api/servers', async (req, res) => {
    const input = serverSchema.parse(req.body);
    await resolveTarget(input.host);
    res.status(201).json(await service.addServer(req.workspace.id, input));
  });
  app.patch('/api/servers/:id', async (req, res) => {
    const input = serverUpdateSchema.parse(req.body);
    await service.getServer(req.workspace.id, req.params.id, false);
    if (input.host !== undefined) await resolveTarget(input.host);
    res.json(await service.updateServer(req.workspace.id, req.params.id, input));
  });
  app.post('/api/servers/bulk-actions', async (req, res) => res.json(await service.bulkAction(req.workspace.id, req.body)));
  app.delete('/api/servers/:id', async (req, res) => {
    res.json(await service.removeServer(req.workspace.id, req.params.id));
  });
  app.post('/api/servers/:id/actions', async (req, res) => {
    const input = z.object({
      action: z.enum(['status', 'players', 'save', 'broadcast']),
      message: z.string().max(300).optional()
    }).parse(req.body);
    res.json(await service.action(req.workspace.id, req.params.id, input.action, input.message, req.user.name));
  });
  app.post('/api/schedules', async (req, res) => res.status(201).json(await service.addSchedule(req.workspace.id, req.body)));
  app.patch('/api/schedules/:id', async (req, res) => {
    res.json(await service.updateSchedule(req.workspace.id, req.params.id, req.body));
  });
  app.post('/api/schedules/:id/run', async (req, res) => res.json(await service.runSchedule(req.workspace.id, req.params.id)));
  app.get('/api/schedules/:id/history', async (req, res) => res.set('Cache-Control', 'no-store').json(await operations.runs(req.workspace.id, req.params.id)));
  app.get('/api/analytics', async (req, res) => {
    const value = z.object({
      server_id: z.string().uuid(),
      hours: z.coerce.number().int().min(1).max(720).default(24)
    }).parse(req.query);
    res.set('Cache-Control', 'no-store').json(await operations.health(req.workspace.id, value.server_id, value.hours));
  });
  app.post('/api/templates', async (req, res) => res.status(201).json(await operations.saveTemplate(req.workspace.id, req.body)));
  app.patch('/api/templates/:id', async (req, res) => res.json(await operations.saveTemplate(req.workspace.id, req.body, req.params.id)));
  app.delete('/api/templates/:id', async (req, res) => {
    await operations.deleteTemplate(req.workspace.id, req.params.id);
    res.json({
      ok: true
    });
  });
  app.post('/api/templates/:id/send', async (req, res) => {
    const value = z.object({
      server_ids: z.array(z.string().uuid()).min(1).max(20)
    }).strict().parse(req.body);
    res.json(await operations.sendTemplate(req.workspace.id, req.params.id, value.server_ids));
  });
  app.post('/api/maintenance-windows', async (req, res) => res.status(201).json(await operations.saveWindow(req.workspace.id, req.body)));
  app.patch('/api/maintenance-windows/:id', async (req, res) => res.json(await operations.saveWindow(req.workspace.id, req.body, req.params.id)));
  app.delete('/api/maintenance-windows/:id', async (req, res) => {
    await operations.deleteWindow(req.workspace.id, req.params.id);
    res.json({
      ok: true
    });
  });
  app.patch('/api/incidents/:id', async (req, res) => res.json(await operations.updateIncident(req.workspace.id, req.params.id, req.body)));
  app.post('/api/notifications/read-all', async (req, res) => {
    await operations.readNotification(req.workspace.id, 'all');
    res.json({
      ok: true
    });
  });
  app.patch('/api/notifications/:id', async (req, res) => {
    await operations.readNotification(req.workspace.id, req.params.id);
    res.json({
      ok: true
    });
  });
  app.post('/api/moderation', async (req, res) => {
    const user = await db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.user_id);
    res.json(await operations.moderate(req.workspace.id, req.body, user.name));
  });
  app.get('/api/ban-directory/bans', async (req, res) => res.set('Cache-Control', 'no-store').json(await banDirectory.ownBans(req.workspace.id, req.query, req.access.server_ids)));
  app.post('/api/ban-directory/search', rateLimit({
    windowMs: 60000,
    limit: 30,
    keyGenerator: req => req.auth.user_id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Lookup limit reached. Try again in a minute.'
    }
  }), async (req, res) => res.set('Cache-Control', 'no-store').json(await banDirectory.lookup(req.workspace.id, req.body, req.access.server_ids)));
  app.patch('/api/ban-directory/preferences', async (req, res) => res.set('Cache-Control', 'no-store').json(await banDirectory.updatePreferences(req.workspace.id, req.body)));
  app.put('/api/servers/:id/hosting', async (req, res) => res.json(await operations.connectHosting(req.workspace.id, req.params.id, req.body)));
  app.delete('/api/servers/:id/hosting', async (req, res) => {
    await operations.disconnectHosting(req.workspace.id, req.params.id);
    res.json({
      ok: true
    });
  });
  app.get('/api/servers/:id/hosting', async (req, res) => res.set('Cache-Control', 'no-store').json(await operations.hostingStatus(req.workspace.id, req.params.id)));
  app.post('/api/servers/:id/hosting/actions', rateLimit({
    windowMs: 60000,
    limit: 5,
    keyGenerator: req => req.auth.user_id,
    standardHeaders: 'draft-8',
    legacyHeaders: false
  }), async (req, res) => res.json(await operations.hostingAction(req.workspace.id, req.params.id, req.body)));
  app.delete('/api/schedules/:id', async (req, res) => {
    await service.deleteSchedule(req.workspace.id, req.params.id);
    res.json({
      ok: true
    });
  });
  app.patch('/api/workspace', async (req, res) => {
    const input = z.object({
      name: z.string().trim().min(2).max(60),
      guild_id: z.string().regex(/^\d{17,20}$/).nullable().optional(),
      alert_channel_id: z.string().regex(/^\d{17,20}$/).nullable().optional(),
      alerts_enabled: z.boolean().optional(),
      failure_threshold: z.coerce.number().int().min(1).max(5).optional()
    }).parse(req.body);
    let guildId = req.workspace.guild_id,
      guildName = req.workspace.guild_name,
      channelId = req.workspace.alert_channel_id;
    const bot = getBot();
    if (input.guild_id !== undefined && input.guild_id !== guildId) {
      guildId = input.guild_id;
      guildName = null;
      channelId = null;
      if (guildId) {
        const user = await db.prepare('SELECT access_token FROM users WHERE id=?').get(req.auth.user_id);
        const guilds = await discordFetch('/users/@me/guilds', vault.decrypt(user.access_token));
        const guild = guilds.find(g => g.id === guildId && canManage(g));
        if (!guild) throw Object.assign(new Error('You need Manage Server permission in that Discord community.'), {
          status: 403
        });
        if (!bot?.isReady() || !(await bot.guilds.fetch(guildId).catch(() => null))) throw Object.assign(new Error('Invite the Rookrift bot to that Discord server first.'), {
          status: 400
        });
        guildName = guild.name;
      }
    }
    if (input.alert_channel_id !== undefined) {
      channelId = input.alert_channel_id;
      if (channelId && (channelId !== req.workspace.alert_channel_id || guildId !== req.workspace.guild_id)) {
        const channel = bot?.isReady() && (await bot.channels.fetch(channelId).catch(() => null));
        if (!channel || channel.guildId !== guildId || !channel.isTextBased() || !('send' in channel)) throw Object.assign(new Error('Choose a text channel in the linked Discord community.'), {
          status: 400
        });
      }
    }
    const occupied = guildId && (await db.prepare('SELECT id FROM workspaces WHERE guild_id=? AND id!=?').get(guildId, req.workspace.id));
    if (occupied) throw Object.assign(new Error('That Discord community is already linked to another workspace.'), {
      status: 409
    });
    await db.prepare('UPDATE workspaces SET name=?,guild_id=?,guild_name=?,alert_channel_id=?,alerts_enabled=?,failure_threshold=? WHERE id=?').run(input.name, guildId, guildName, channelId, input.alerts_enabled === undefined ? req.workspace.alerts_enabled : Number(input.alerts_enabled), input.failure_threshold ?? req.workspace.failure_threshold, req.workspace.id);
    res.json({
      ok: true
    });
  });
  app.post('/api/billing/checkout', async (req, res) => {
    const {
      plan
    } = z.object({
      plan: z.enum(['tribe', 'cluster'])
    }).parse(req.body);
    res.json({
      url: await billing.checkout(req.workspace, plan)
    });
  });
  app.post('/api/billing/portal', async (req, res) => res.json({
    url: await billing.portal(req.workspace)
  }));
  app.use('/api', (_, res) => res.status(404).json({
    error: 'Endpoint not found.'
  }));
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (_, res) => res.sendFile(resolve('dist/index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: error.issues.map(i => i.message).join(' ')
      });
      return;
    }
    const status = error.status || 500;
    if (status >= 500) console.error(`${req.method} ${req.path}: request failed (${status})`);
    res.status(status).json({
      error: status === 500 ? 'Something went wrong. Please try again.' : error.message
    });
  });
  return app;
}
