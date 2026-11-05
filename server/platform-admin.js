import { randomBytes } from 'node:crypto';
import { hash } from './crypto.js';
import { z } from 'zod';
import { PLANS } from './plans.js';
import {presentUser} from './avatars.js';

const fail = (message, status = 403) => Object.assign(new Error(message), { status });

export function createPlatformAdmin(db, community, vault, env = process.env) {
  const requireRoot = user => {
    if (!user?.platform_admin) throw fail('Platform administrator access required.', 403);
  };
  async function overview(user) {
    requireRoot(user);
    const users = await db.prepare(`SELECT u.id,u.name,u.avatar,u.discord_id,EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=u.id) AS platform_admin,
      EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended,u.access_token<>'' AS discord_connected,
      a.email,a.created_at AS account_created_at,
      (SELECT count(*) FROM workspaces w WHERE w.owner_id=u.id) AS workspaces,
      (SELECT count(*) FROM sessions s WHERE s.user_id=u.id AND s.expires_at>?) AS active_sessions
      FROM users u LEFT JOIN local_accounts a ON a.user_id=u.id WHERE u.id<>'deleted-account' ORDER BY u.name,u.id`).all(Date.now());
    const workspaces = await db.prepare(`SELECT w.id,w.name,w.plan,w.subscription_status,w.created_at,w.guild_id,w.alert_channel_id,w.alerts_enabled,w.failure_threshold,u.id AS owner_id,u.name AS owner_name,
      (SELECT count(*) FROM servers s WHERE s.workspace_id=w.id) AS servers
      FROM workspaces w JOIN users u ON u.id=w.owner_id WHERE w.closed_at IS NULL ORDER BY w.created_at DESC,w.id`).all();
    const details=await Promise.all(workspaces.map(async workspace=>({
      ...workspace,
      site: await db.prepare('SELECT slug,title,summary,rules,discord_url,enabled,applications_open,show_connection_details,questions,server_ids FROM community_sites WHERE workspace_id=?').get(workspace.id)
    })));
    const stored=await db.prepare('SELECT key FROM platform_settings').all();
    const keys=new Set(stored.map(row=>row.key));
    return { user:presentUser(user),users:users.map(presentUser), workspaces:details, settings: {
      discord_client_id: {configured:Boolean(env.DISCORD_CLIENT_ID||keys.has('discord_client_id'))},
      discord_client_secret: {configured:Boolean(env.DISCORD_CLIENT_SECRET||keys.has('discord_client_secret'))},
      discord_bot_token: {configured:Boolean(env.DISCORD_BOT_TOKEN||keys.has('discord_bot_token'))},
      stripe_connect_secret_key: {configured:Boolean(env.STRIPE_CONNECT_SECRET_KEY||keys.has('stripe_connect_secret_key'))},
      stripe_connect_webhook_secret: {configured:Boolean(env.STRIPE_CONNECT_WEBHOOK_SECRET||keys.has('stripe_connect_webhook_secret'))},
      stripe_secret_key: {configured:Boolean(env.STRIPE_SECRET_KEY||keys.has('stripe_secret_key'))},
      stripe_webhook_secret: {configured:Boolean(env.STRIPE_WEBHOOK_SECRET||keys.has('stripe_webhook_secret'))},
      stripe_tribe_monthly_price_id: {configured:Boolean(env.STRIPE_TRIBE_MONTHLY_PRICE_ID||keys.has('stripe_tribe_monthly_price_id'))},
      stripe_cluster_monthly_price_id: {configured:Boolean(env.STRIPE_CLUSTER_MONTHLY_PRICE_ID||keys.has('stripe_cluster_monthly_price_id'))}
      ,paypal_client_id: {configured:Boolean(env.PAYPAL_CLIENT_ID||keys.has('paypal_client_id'))}
      ,paypal_client_secret: {configured:Boolean(env.PAYPAL_CLIENT_SECRET||keys.has('paypal_client_secret'))}
      ,paypal_webhook_id: {configured:Boolean(env.PAYPAL_WEBHOOK_ID||keys.has('paypal_webhook_id'))}
      ,paypal_tribe_plan_id: {configured:Boolean(env.PAYPAL_TRIBE_PLAN_ID||keys.has('paypal_tribe_plan_id'))}
      ,paypal_cluster_plan_id: {configured:Boolean(env.PAYPAL_CLUSTER_PLAN_ID||keys.has('paypal_cluster_plan_id'))}
      ,platform_billing_provider: {value:env.PLATFORM_BILLING_PROVIDER||'stripe'}
      ,paypal_ipn_tribe_url: {configured:Boolean(env.PAYPAL_IPN_TRIBE_URL||keys.has('paypal_ipn_tribe_url'))}
      ,paypal_ipn_cluster_url: {configured:Boolean(env.PAYPAL_IPN_CLUSTER_URL||keys.has('paypal_ipn_cluster_url'))}
      ,tebex_tribe_url: {configured:Boolean(env.TEBEX_TRIBE_URL||keys.has('tebex_tribe_url'))}
      ,tebex_cluster_url: {configured:Boolean(env.TEBEX_CLUSTER_URL||keys.has('tebex_cluster_url'))}
    }};
  }
  return {
    overview,
    async suspend(user, id, suspended) {
      requireRoot(user);
      if(id==='deleted-account')throw fail('This account is deleted.',404);
      if (id === user.id) throw fail('The platform root account cannot be suspended.', 400);
      const target = await db.prepare('SELECT id FROM users WHERE id=?').get(id);
      if (!target) throw fail('User not found.', 404);
      if (suspended) await db.prepare('INSERT INTO suspended_users VALUES(?,?) ON CONFLICT DO NOTHING').run(id,Date.now());
      else await db.prepare('DELETE FROM suspended_users WHERE user_id=?').run(id);
      if (suspended) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return { ok: true };
    },
    async revokeSessions(user, id) {
      requireRoot(user);
      if (id === user.id) throw fail('The platform root account cannot revoke its own sessions here.', 400);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      return { ok: true };
    },
    async impersonate(user, id, createSession) {
      requireRoot(user);
      if (id === user.id) throw fail('Use your own account directly.', 400);
      const target = await db.prepare('SELECT u.id,EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id) AS suspended FROM users u WHERE u.id=?').get(id);
      if (!target) throw fail('User not found.', 404);
      if (target.suspended) throw fail('Suspended users cannot be impersonated.', 409);
      const session = await createSession(id);
      await db.prepare('INSERT INTO platform_impersonations VALUES(?,?,?)').run(hash(session.token), user.id, Date.now());
      return session;
    },
    async updateWorkspace(user,id,input) {
      requireRoot(user);
      const value=z.object({
        name:z.string().trim().min(2).max(60),
        plan:z.enum(Object.keys(PLANS)),
        subscription_status:z.enum(['free','trialing','active','past_due','canceled']),
        guild_id:z.string().regex(/^\d{17,20}$/).nullable(),
        alert_channel_id:z.string().regex(/^\d{17,20}$/).nullable(),
        alerts_enabled:z.boolean(),
        failure_threshold:z.number().int().min(1).max(5)
      }).strict().parse(input);
      const exists=await db.prepare('SELECT id FROM workspaces WHERE id=? AND closed_at IS NULL').get(id);
      if(!exists)throw fail('Workspace not found.',404);
      await db.prepare('UPDATE workspaces SET name=?,plan=?,subscription_status=?,guild_id=?,alert_channel_id=?,alerts_enabled=?,failure_threshold=? WHERE id=?').run(value.name,value.plan,value.subscription_status,value.guild_id,value.alert_channel_id,Number(value.alerts_enabled),value.failure_threshold,id);
      return {ok:true};
    },
    async updateCommunity(user,id,input) {
      requireRoot(user);
      const exists=await db.prepare('SELECT id FROM workspaces WHERE id=?').get(id);
      if(!exists)throw fail('Workspace not found.',404);
      return community.saveSite(id,input);
    },
    async updateSettings(user,input) {
      requireRoot(user);
      const allowed=['discord_client_id','discord_client_secret','discord_bot_token','stripe_secret_key','stripe_webhook_secret','stripe_connect_secret_key','stripe_connect_webhook_secret','stripe_tribe_monthly_price_id','stripe_cluster_monthly_price_id','paypal_client_id','paypal_client_secret','paypal_webhook_id','paypal_tribe_plan_id','paypal_cluster_plan_id','platform_billing_provider','paypal_ipn_tribe_url','paypal_ipn_cluster_url','tebex_tribe_url','tebex_cluster_url'];
      if(input.platform_billing_provider!==undefined&&!['stripe','paypal','paypal_ipn','tebex'].includes(input.platform_billing_provider))throw fail('Choose Stripe, PayPal Business, PayPal IPN, or Tebex for platform billing.',400);
      for(const key of allowed)if(input[key]!==undefined&&input[key]!=='')await db.prepare('INSERT INTO platform_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key,vault.encrypt(String(input[key])),Date.now());
      return {ok:true,restart_required:true};
    },
    async exitImpersonation(session, createSession) {
      const row = await db.prepare('SELECT root_user_id FROM platform_impersonations WHERE session_token_hash=?').get(session.token_hash);
      if (!row) throw fail('This session is not an impersonation session.', 400);
      await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
      await db.prepare('DELETE FROM platform_impersonations WHERE session_token_hash=?').run(session.token_hash);
      return createSession(row.root_user_id);
    }
  };
}
