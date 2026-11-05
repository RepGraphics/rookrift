import {createPurchaseDelivery,createDiscordRewards} from './purchase-delivery.js';
import {createWorkspace,ensurePersonalWorkspace} from './workspaces.js';
import {accountReturn} from '../shared/navigation.js';
import { createMetricsCache } from './cache.js';
import { createCommunity } from './community.js';
import {createCommunityDesign} from './community-design.js';
import {createCommunityStore} from './community-store.js';
import {createCommunityMembers} from './community-members.js';
import {createWorkflows} from './workflows.js';
import {createConfigLibrary} from './config-library.js';
import {sendAlert} from './bot.js';
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
import { hash, hashPassword, verifyPassword } from './crypto.js';
import { effectivePlan, PLANS } from './plans.js';
import { listServers, publicServer, playerSnapshot, audit } from './db.js';
import { GAMES, resolveTarget } from './games.js';
import { serverSchema, serverUpdateSchema } from './service.js';
import { createOperations } from './operations.js';
import { maintenanceState } from './operations-state.js';
import { createBanDirectory } from './ban-directory.js';
import { createPlatformAdmin } from './platform-admin.js';
import { createAccount } from './account.js';
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
  paypal,
  store:providedStore,
  rewards:providedRewards,
  operations: providedOperations,
  workflows:providedWorkflows,
  configurations:providedConfigurations,
  cache = createMetricsCache({
    url: null
  }),
  getBot = () => null,
  env = process.env
}) {
  const operations = providedOperations || createOperations(db, vault, service, undefined, cache);
  service.setBackupHandler?.((workspace,server)=>operations.hostingAction(workspace,server.id,{action:'backup',confirmation:server.name}));
  const workflows=providedWorkflows||createWorkflows(db,service,operations,{send:(ws,message)=>sendAlert(getBot(),ws,message)});
  const configurations=providedConfigurations||createConfigLibrary(db,vault,service,operations);
  const community = createCommunity(db), members = createCommunityMembers(db, { service }), accountService = createAccount(db, vault, env, billing);
  const siteDesign=createCommunityDesign(db),store=providedStore||createCommunityStore(db,env);
  const delivery=createPurchaseDelivery(db,store,service,providedRewards||createDiscordRewards(getBot));
  store.setActionsValidator?.(delivery.validate);
  const banDirectory = createBanDirectory(db),
    team = createTeam(db),
    profiles = createPlayerProfiles(db),
    platformAdmin = createPlatformAdmin(db, community, vault, env);
  const app = express(),
    origin = new URL(env.APP_URL || 'http://localhost:3000').origin;
  const secure = env.NODE_ENV === 'production';
  const pendingAuditWrites=new Set();
  app.locals.flushAuditWrites=async()=>{while(pendingAuditWrites.size)await Promise.all([...pendingAuditWrites]);};
  app.locals.workflows=workflows;
  app.locals.configurations=configurations;
  app.locals.store=store;app.locals.delivery=delivery;
  app.locals.members=members;
  app.locals.operations=operations;
  app.disable('x-powered-by');
  app.set('trust proxy', Number(env.TRUST_PROXY_HOPS || 0));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
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
    app.post('/api/webhooks/paypal', express.json({limit:'1mb'}), async (req,res)=>{
      if(!paypal?.ready || !(await paypal.verifyWebhook(req.headers,req.body))) return res.status(400).json({error:'Invalid PayPal webhook.'});
      res.json({received:true});
    });
  });
  app.post('/api/webhooks/community-stripe',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{await store.webhook(req.body,req.headers['stripe-signature']);res.json({received:true});});
  app.use(express.json({
    limit: '64kb'
  }), cookieParser());
  app.post('/api/link-events', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const authorization = req.get('Authorization') || '';
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    res.json(await members.ingestChatEvent(token, req.body));
  });
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
  app.use('/api/hooks',rateLimit({windowMs:3600000,limit:60,standardHeaders:'draft-8',legacyHeaders:false}),(_,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.post('/api/hooks/workflows/:id',async(req,res)=>res.status(202).json(await workflows.webhook(req.params.id,req.get('Authorization'),req.body)));
  app.use('/api/hooks',(_,res)=>res.status(404).json({error:'Webhook endpoint not found.'}));
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
    if(accountReturn(req.query.return_to))res.cookie('rookrift_return',req.query.return_to,{...cookieOptions,maxAge:600000});
    else res.clearCookie('rookrift_return',cookieOptions);
    const params = new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      response_type: 'code',
      scope: 'identify guilds',
      redirect_uri: env.DISCORD_REDIRECT_URI,
      state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/discord/link', async (req, res) => {
    const token = req.cookies.rookrift_session;
    const session = token && await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(hash(token), Date.now());
    if (!session) { res.redirect('/login?return_to=%2Fdashboard%3Faccount%3Ddiscord'); return; }
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) { res.status(503).send('Discord linking is not configured. See the Rookrift setup guide.'); return; }
    const state = randomBytes(32).toString('hex');
    await db.prepare('INSERT INTO oauth_link_states VALUES(?,?,?)').run(hash(state), session.user_id, Date.now() + 600000);
    res.cookie('rookrift_oauth_link', state, { ...cookieOptions, maxAge: 600000 });
    const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify', redirect_uri: env.DISCORD_REDIRECT_URI, state });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });
  app.get('/auth/discord/callback', async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if(!state||(!req.cookies.rookrift_oauth&&!req.cookies.rookrift_oauth_link)||(req.cookies.rookrift_oauth!==state&&req.cookies.rookrift_oauth_link!==state)||typeof req.query.code!=='string'){res.status(400).send('Sign-in state is invalid or expired. Please sign in again.');return;}
    const linkRow = req.cookies.rookrift_oauth_link && await db.prepare('DELETE FROM oauth_link_states WHERE state_hash=? AND expires_at>? RETURNING user_id').get(hash(state), Date.now());
    const row=linkRow ? linkRow : await db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash').get(hash(state),Date.now());
    if(!row){res.status(400).send('Sign-in state is invalid or expired. Please sign in again.');return;}
    res.clearCookie('rookrift_oauth', cookieOptions); res.clearCookie('rookrift_oauth_link', cookieOptions);
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
    if (linkRow) {
      const existing = await db.prepare('SELECT id FROM users WHERE discord_id=? AND id<>?').get(user.id, linkRow.user_id);
      if (existing) { res.status(409).send('That Discord account is already linked to another Rookrift account.'); return; }
      await db.prepare('UPDATE users SET discord_id=?,avatar=COALESCE(avatar,?) WHERE id=?').run(user.id, user.avatar || null, linkRow.user_id);
      res.redirect(origin + '/dashboard?account=discord-linked'); return;
    }
    await db.prepare('INSERT INTO users(id,name,avatar,access_token,discord_id) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,avatar=excluded.avatar,access_token=excluded.access_token,discord_id=excluded.discord_id').run(user.id, user.global_name || user.username, user.avatar || null, vault.encrypt(token.access_token), user.id);
    const returnPath=accountReturn(req.cookies.rookrift_return)||'/dashboard';
    if(!returnPath.startsWith('/c/'))await ensurePersonalWorkspace(db,user.id);
    const session = randomBytes(32).toString('hex'),
      csrf = randomBytes(24).toString('hex');
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(session), user.id, csrf, Date.now() + 7 * 86400000);
    res.clearCookie('rookrift_return',cookieOptions);
    res.cookie('rookrift_session', session, {
      ...cookieOptions,
      maxAge: 7 * 86400000
    }).redirect(origin+returnPath);
  });
  const authLimiter = rateLimit({ windowMs: 900000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  const emailSchema = z.string().trim().toLowerCase().email().max(254);
  const passwordSchema = z.string().min(8).max(128);
  const issueSession = async userId => {
    const session = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(session), userId, csrf, Date.now() + 7 * 86400000);
    return {token:session,csrf};
  };
  const createSession = async (userId, res) => {
    const {token:session}=await issueSession(userId);
    res.cookie('rookrift_session', session, { ...cookieOptions, maxAge: 7 * 86400000 });
  };
  app.post('/auth/register', authLimiter, async (req, res) => {
    const input = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().min(2).max(80) }).strict().parse(req.body);
    const existing = await db.prepare('SELECT user_id FROM local_accounts WHERE email=?').get(input.email);
    if (existing) throw Object.assign(new Error('An account already exists for that email.'), { status: 409 });
    const userId = randomUUID();
    await db.transaction(async () => {
      await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId, input.name, null, '');
      await db.prepare('INSERT INTO local_accounts VALUES(?,?,?,?)').run(userId, input.email, await hashPassword(input.password), Date.now());
      await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run(randomUUID(), userId, Date.now());
    });
    await createSession(userId, res);
    res.status(201).json({ ok: true });
  });
  app.post('/auth/login', authLimiter, async (req, res) => {
    const input = z.object({ email: emailSchema, password: z.string().max(128), totp: z.string().optional() }).strict().parse(req.body);
    const account = await db.prepare('SELECT u.id, u.name, EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended, a.password_hash FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE a.email=?').get(input.email);
    if (!account || account.suspended || !(await verifyPassword(input.password, account.password_hash))) throw Object.assign(new Error('Email or password is incorrect.'), { status: 401 });
    if (!(await accountService.verifyTotp(account.id, input.totp))) throw Object.assign(new Error('Enter the six-digit authenticator code to continue.'), { status: 401 });
    await createSession(account.id, res);
    res.json({ ok: true });
  });
  app.post('/auth/password-reset/request', authLimiter, async (req, res) => { await accountService.requestReset(req.body?.email); res.json({ ok: true, message: 'If that email belongs to an account, a reset link has been sent.' }); });
  app.post('/auth/password-reset/confirm', authLimiter, async (req, res) => res.json(await accountService.resetPassword(req.body?.token, req.body?.password)));
  app.post('/auth/passkeys/options', authLimiter, async (req, res) => res.json(await accountService.authenticationOptions()));
  app.post('/auth/passkeys/verify', authLimiter, async (req, res) => {
    const result = await accountService.authenticatePasskey(req.body);
    const session = await issueSession(result.user_id);
    res.cookie('rookrift_session', session.token, { ...cookieOptions, maxAge: 7 * 86400000 }).json({ ok: true });
  });
  // Public community routes deliberately precede the dashboard workspace middleware.
  app.use('/api/public',async(req,res,next)=>{
    res.set('Cache-Control','no-store');
    const token=req.cookies.rookrift_session;
    req.visitor=token?await db.prepare('SELECT u.id,u.name,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM suspended_users x WHERE x.user_id=u.id)').get(hash(token),Date.now()):null;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      if(!req.visitor){res.status(401).json({error:'Sign in to continue.'});return;}
      if(req.get('Origin')!==origin||req.get('X-CSRF-Token')!==req.visitor.csrf){res.status(403).json({error:'Request verification failed. Refresh the community page.'});return;}
    }
    next();
  });
  const communityWrites=rateLimit({windowMs:3600000,limit:30,standardHeaders:'draft-8',legacyHeaders:false});
  app.get('/api/public/communities/:slug',async(req,res)=>res.json(await community.publicPage(req.params.slug,req.visitor)));
  app.get('/api/public/communities/:slug/store',async(req,res)=>res.json(await store.publicPage(req.params.slug,req.visitor)));
  app.get('/api/public/communities/:slug/store/orders',async(req,res)=>res.json(await store.buyerOrders(req.params.slug,req.visitor)));
  app.get('/api/public/communities/:slug/member',async(req,res)=>res.json(await members.view(req.params.slug,req.visitor)));
  app.post('/api/public/communities/:slug/member/link-code',communityWrites,async(req,res)=>res.json(await members.createLinkCode(req.params.slug,req.visitor,req.body?.game)));
  app.post('/api/public/communities/:slug/member/game-accounts',communityWrites,async(req,res)=>res.json(await members.add(req.params.slug,req.visitor,req.body)));
  app.delete('/api/public/communities/:slug/member/game-accounts/:id',communityWrites,async(req,res)=>res.json(await members.remove(req.params.slug,req.visitor,req.params.id)));
  app.post('/api/public/communities/:slug/store/checkout',communityWrites,async(req,res)=>res.json(await store.checkout(req.params.slug,req.visitor,req.body)));
  app.post('/api/public/communities/:slug/store/orders/:id/refresh',communityWrites,async(req,res)=>res.json(await store.refreshBuyerOrder(req.params.slug,req.visitor,req.params.id)));
  app.post('/api/public/communities/:slug/applications',communityWrites,async(req,res)=>res.status(201).json(await community.apply(req.params.slug,req.visitor,req.body)));
  app.delete('/api/public/communities/:slug/applications/:id',communityWrites,async(req,res)=>res.json(await community.withdraw(req.params.slug,req.visitor,req.params.id)));
  app.post('/api/public/communities/:slug/events/:id/rsvp',communityWrites,async(req,res)=>res.json(await community.rsvp(req.params.slug,req.visitor,req.params.id,req.body?.attending)));
  app.use('/api/public',(_,res)=>res.status(404).json({error:'Community endpoint not found.'}));
  app.use('/api', async (req, res, next) => {
    const sessionToken = req.cookies.rookrift_session;
    const session = sessionToken && (await db.prepare(`SELECT s.*,EXISTS(SELECT 1 FROM platform_impersonations p WHERE p.session_token_hash=s.token_hash) AS impersonating
      FROM sessions s WHERE s.token_hash=? AND s.expires_at>?`).get(hash(sessionToken), Date.now()));
    if (!session) {
      res.status(401).json({
        error: 'Sign in to continue.'
      });
      return;
    }
    req.auth = session;
    res.set('Cache-Control', 'no-store');
    req.user = await db.prepare(`SELECT id,name,avatar,EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=users.id) AS platform_admin,
      EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=users.id) AS suspended FROM users WHERE id=?`).get(session.user_id);
    if (req.user.suspended) { res.status(403).json({error:'This platform account is suspended.'}); return; }
    if(/^\/platform(?:\/|$)/.test(req.path)){
      if(!req.user.platform_admin&&!(['POST'].includes(req.method)&&req.path==='/platform/exit-impersonation'&&session.impersonating)){res.status(403).json({error:'Platform administrator access required.'});return;}
      if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||req.get('X-CSRF-Token')!==session.csrf)){res.status(403).json({error:'Request verification failed. Refresh the dashboard.'});return;}
      next(); return;
    }
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
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && /^\/(servers|schedules|templates|maintenance-windows|incidents|moderation|community|workflows|workflow-runs|config-templates|config-applications)(\/|$)/.test(req.path)) {
      const action = req.method + ' ' + req.path,
        workspace = req.workspace.id,
        user = req.user,
        server = req.body?.server_id || null;
      res.on('finish', () => {
        if(res.statusCode>=300)return;
        const write=staffAudit(db,workspace,user,action,null,server).catch(()=>console.error('Staff audit write failed.'));
        pendingAuditWrites.add(write);write.finally(()=>pendingAuditWrites.delete(write));
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
  app.post('/api/workspaces',async(req,res)=>res.status(201).json(await createWorkspace(db,req.auth,req.body)));
  app.get('/api/workspaces', async (req, res) => res.set('Cache-Control', 'no-store').json(await team.listWorkspaces(req.auth.user_id)));
  app.get('/api/workflows',async(req,res)=>res.json(await workflows.view(req.workspace.id,req.access.server_ids)));
  app.get('/api/workflow-runs/:id',async(req,res)=>res.json(await workflows.detail(req.workspace.id,req.params.id)));
  app.get('/api/config-templates',async(req,res)=>res.json(await configurations.view(req.workspace.id,req.access.server_ids)));
  app.post('/api/config-templates',async(req,res)=>res.status(201).json(await configurations.save(req.workspace.id,null,req.body,req.user)));
  app.patch('/api/config-templates/:id',async(req,res)=>res.json(await configurations.save(req.workspace.id,req.params.id,req.body,req.user)));
  app.get('/api/config-templates/:id/versions',async(req,res)=>res.json(await configurations.versions(req.workspace.id,req.params.id)));
  app.delete('/api/config-templates/:id',async(req,res)=>res.json(await configurations.remove(req.workspace.id,req.params.id)));
  app.post('/api/config-templates/:id/preview',async(req,res)=>res.json(await configurations.preview(req.workspace.id,req.params.id,req.body)));
  app.post('/api/config-templates/:id/apply',async(req,res)=>res.json(await configurations.apply(req.workspace.id,req.params.id,req.body,req.user)));
  app.post('/api/config-applications/:id/rollback',async(req,res)=>res.json(await configurations.rollback(req.workspace.id,req.params.id,req.body,req.user)));
  app.post('/api/config-applications/:id/verify',async(req,res)=>res.json(await configurations.verify(req.workspace.id,req.params.id)));
  app.delete('/api/config-applications/:id',async(req,res)=>res.json(await configurations.removeApplication(req.workspace.id,req.params.id)));
  app.post('/api/workflows',async(req,res)=>res.status(201).json(await workflows.save(req.workspace.id,null,req.body,req.user)));
  app.patch('/api/workflows/:id',async(req,res)=>res.json(await workflows.save(req.workspace.id,req.params.id,req.body,req.user)));
  app.post('/api/workflows/:id/toggle',async(req,res)=>res.json(await workflows.toggle(req.workspace.id,req.params.id,z.object({enabled:z.boolean()}).strict().parse(req.body).enabled)));
  app.post('/api/workflows/:id/run',async(req,res)=>res.status(202).json(await workflows.start(req.workspace.id,req.params.id,z.object({confirmation:z.string().max(60).optional()}).strict().parse(req.body||{}),req.user)));
  app.post('/api/workflows/:id/webhook-key',async(req,res)=>res.json(await workflows.rotateKey(req.workspace.id,req.params.id)));
  app.delete('/api/workflows/:id',async(req,res)=>res.json(await workflows.remove(req.workspace.id,req.params.id)));
  app.post('/api/workflow-runs/:id/cancel',async(req,res)=>res.json(await workflows.cancel(req.workspace.id,req.params.id,req.user)));
  app.get('/api/community',async(req,res)=>res.json(await community.manage(req.workspace.id)));
  app.put('/api/community/site',async(req,res)=>res.json(await community.saveSite(req.workspace.id,req.body)));
  app.get('/api/community/site-builder',async(req,res)=>res.json(await siteDesign.view(req.workspace.id)));
  app.put('/api/community/site-builder',async(req,res)=>res.json(await siteDesign.save(req.workspace.id,req.body)));
  app.post('/api/community/site-builder/publish',async(req,res)=>res.json(await siteDesign.publish(req.workspace.id)));
  app.post('/api/community/site-builder/reset',async(req,res)=>res.json(await siteDesign.reset(req.workspace.id)));
  app.get('/api/community/store/delivery-options',async(req,res)=>res.json(await delivery.options(req.workspace.id)));
  app.post('/api/community/store/categories',async(req,res)=>res.status(201).json(await store.category(req.workspace.id,null,req.body)));
  app.patch('/api/community/store/categories/:id',async(req,res)=>res.json(await store.category(req.workspace.id,req.params.id,req.body)));
  app.delete('/api/community/store/categories/:id',async(req,res)=>res.json(await store.removeCategory(req.workspace.id,req.params.id)));
  app.put('/api/community/store/products/:id/actions',async(req,res)=>res.json(await store.configureActions(req.workspace.id,req.params.id,req.body)));
  app.get('/api/community/store/orders/:id/delivery',async(req,res)=>res.json(await delivery.jobs(req.workspace.id,req.params.id)));
  app.post('/api/community/store/orders/:id/delivery/retry',async(req,res)=>res.json(await delivery.retry(req.workspace.id,req.params.id)));
  app.post('/api/community/store/orders/:id/delivery/:job/resolve',async(req,res)=>res.json(await delivery.resolve(req.workspace.id,req.params.id,req.params.job,req.body,req.user)));
  app.get('/api/community/store',async(req,res)=>res.json(await store.manage(req.workspace.id)));
  app.put('/api/community/store/settings',async(req,res)=>res.json(await store.settings(req.workspace.id,req.body)));
  app.post('/api/community/store/products',async(req,res)=>res.status(201).json(await store.product(req.workspace.id,null,req.body)));
  app.patch('/api/community/store/products/:id',async(req,res)=>res.json(await store.product(req.workspace.id,req.params.id,req.body)));
  app.delete('/api/community/store/products/:id',async(req,res)=>res.json(await store.archive(req.workspace.id,req.params.id)));
  app.post('/api/community/store/connect',async(req,res)=>res.json(await store.connect(req.workspace.id)));
  app.post('/api/community/store/payments/refresh',async(req,res)=>res.json(await store.refreshAccount(req.workspace.id)));
  app.post('/api/community/store/orders/:id/fulfill',async(req,res)=>res.json(await store.fulfill(req.workspace.id,req.params.id,req.body,req.user)));
  app.post('/api/community/posts',async(req,res)=>res.status(201).json(await community.savePost(req.workspace.id,null,req.body)));
  app.patch('/api/community/posts/:id',async(req,res)=>res.json(await community.savePost(req.workspace.id,req.params.id,req.body)));
  app.delete('/api/community/posts/:id',async(req,res)=>res.json(await community.remove(req.workspace.id,'posts',req.params.id)));
  app.post('/api/community/events',async(req,res)=>res.status(201).json(await community.saveEvent(req.workspace.id,null,req.body)));
  app.patch('/api/community/events/:id',async(req,res)=>res.json(await community.saveEvent(req.workspace.id,req.params.id,req.body)));
  app.delete('/api/community/events/:id',async(req,res)=>res.json(await community.remove(req.workspace.id,'events',req.params.id)));
  app.get('/api/community/applications',async(req,res)=>res.json(await community.applications(req.workspace.id,req.query.status||'pending',req.query.kind||'all')));
  app.patch('/api/community/applications/:id',async(req,res)=>res.json(await community.review(req.workspace.id,req.params.id,req.body,req.user)));
  app.delete('/api/community/applications/:id',async(req,res)=>res.json(await community.removeApplication(req.workspace.id,req.params.id)));
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
  app.post('/api/servers/:id/link-agent', async (req, res) => {
    const server = await service.getServer(req.workspace.id, req.params.id, false);
    const token = randomBytes(32).toString('base64url');
    await db.prepare('UPDATE servers SET link_ingest_token_hash=? WHERE id=? AND workspace_id=?').run(hash(token), server.id, req.workspace.id);
    res.json({ server_id: server.id, token, endpoint: `${origin}/api/link-events`, usage: 'Authorization: Bearer <token>' });
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
      url: await billing.checkout(req.workspace, plan, req.body?.provider || 'stripe')
    });
  });
  app.post('/api/billing/portal', async (req, res) => res.json({
    url: await billing.portal(req.workspace)
  }));
  app.get('/api/account', async (req, res) => res.json(await accountService.get(req.user.id)));
  app.patch('/api/account/profile', async (req, res) => res.json(await accountService.updateProfile(req.user.id, req.body)));
  app.patch('/api/account/email', async (req, res) => res.json(await accountService.updateEmail(req.user.id, req.body)));
  app.post('/api/account/password', async (req, res) => res.json(await accountService.changePassword(req.user.id, req.body, req.auth.token_hash)));
  app.post('/api/account/2fa/setup', async (req, res) => res.json(await accountService.setupTotp(req.user.id)));
  app.post('/api/account/2fa/confirm', async (req, res) => res.json(await accountService.confirmTotp(req.user.id, req.body?.code)));
  app.post('/api/account/2fa/disable', async (req, res) => res.json(await accountService.disableTotp(req.user.id, req.body)));
  app.post('/api/account/passkeys/options', async (req, res) => res.json(await accountService.registrationOptions(req.user.id)));
  app.post('/api/account/passkeys', async (req, res) => res.json(await accountService.registerPasskey(req.user.id, req.body)));
  app.delete('/api/account/passkeys/:id', async (req, res) => res.json(await accountService.removePasskey(req.user.id, req.params.id)));
  app.get('/api/platform', async (req,res)=>res.set('Cache-Control','no-store').json(await platformAdmin.overview(req.user)));
  app.get('/api/platform/bootstrap', async (req,res)=>res.set('Cache-Control','no-store').json({...await platformAdmin.overview(req.user),csrf:req.auth.csrf}));
  app.patch('/api/platform/settings', async (req,res)=>res.json(await platformAdmin.updateSettings(req.user,req.body)));
  app.patch('/api/platform/workspaces/:id', async (req,res)=>res.json(await platformAdmin.updateWorkspace(req.user,req.params.id,req.body)));
  app.put('/api/platform/workspaces/:id/community', async (req,res)=>res.json(await platformAdmin.updateCommunity(req.user,req.params.id,req.body)));
  app.patch('/api/platform/users/:id/suspension', async (req,res)=>res.json(await platformAdmin.suspend(req.user,req.params.id,req.body?.suspended)));
  app.post('/api/platform/users/:id/revoke-sessions', async (req,res)=>res.json(await platformAdmin.revokeSessions(req.user,req.params.id)));
  app.post('/api/platform/users/:id/impersonate', async (req,res)=>{
    const session=await platformAdmin.impersonate(req.user,req.params.id,issueSession);
    res.cookie('rookrift_session',session.token,{...cookieOptions,maxAge:7*86400000}).json({ok:true});
  });
  app.post('/api/platform/exit-impersonation', async (req,res)=>{
    const session=await platformAdmin.exitImpersonation(req.auth,issueSession);
    res.cookie('rookrift_session',session.token,{...cookieOptions,maxAge:7*86400000}).json({ok:true});
  });
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
