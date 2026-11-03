import Stripe from 'stripe';
import { audit } from './db.js';
export function createBilling(db, env = process.env, injectedStripe) {
  const stripe = injectedStripe || (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null);
  const prices = { tribe: env.STRIPE_TRIBE_MONTHLY_PRICE_ID, cluster: env.STRIPE_CLUSTER_MONTHLY_PRICE_ID };
  const ready = Boolean(stripe && env.STRIPE_WEBHOOK_SECRET && prices.tribe && prices.cluster);
  const checkoutBusy = new Set();
  function requireReady() { if (!ready) throw Object.assign(new Error('Billing is not configured yet. Ask the service owner to complete Stripe setup.'), { status: 503 }); }
  async function syncSubscription(subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const workspace = db.prepare('SELECT * FROM workspaces WHERE customer_id=?').get(customerId);
    if (!workspace) return;
    // Only the two configured price IDs grant paid capabilities. Never trust client or metadata plan values.
    const price = subscription.items.data[0]?.price.id;
    const plan = Object.keys(prices).find(key => prices[key] && prices[key] === price) || 'scout';
    if (workspace.subscription_id && workspace.subscription_id !== subscription.id) {
      const existing = await stripe.subscriptions.retrieve(workspace.subscription_id);
      if (['active', 'trialing'].includes(existing.status)) return;
    }
    db.prepare('UPDATE workspaces SET subscription_id=?,subscription_status=?,plan=? WHERE id=?').run(subscription.id, subscription.status, plan, workspace.id);
    if (workspace.plan !== plan || workspace.subscription_status !== subscription.status) audit(db, workspace.id, 'Subscription updated', `${plan} · ${subscription.status}`);
  }
  return {
    ready, syncSubscription,
    async checkout(workspace, plan) {
      requireReady();
      if (!prices[plan]) throw Object.assign(new Error('Choose a paid plan.'), { status: 400 });
      if (checkoutBusy.has(workspace.id)) throw Object.assign(new Error('A checkout is already being prepared. Try again shortly.'), { status: 409 });
      checkoutBusy.add(workspace.id);
      try {
        // Refresh customer ID inside the lock, including for simultaneous first-time requests.
        let customer = db.prepare('SELECT customer_id FROM workspaces WHERE id=?').get(workspace.id).customer_id;
        if (!customer) {
          customer = (await stripe.customers.create({ metadata: { workspace_id: workspace.id } }, { idempotencyKey: `customer-${workspace.id}` })).id;
          db.prepare('UPDATE workspaces SET customer_id=? WHERE id=?').run(customer, workspace.id);
        }
        // Check Stripe directly; the completed-checkout webhook may not have arrived yet.
        const subscriptions = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
        if (subscriptions.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) throw Object.assign(new Error('Use Manage billing to change your existing subscription.'), { status: 409 });
        const pending = await stripe.checkout.sessions.list({ customer, status: 'open', limit: 100 });
        for (const session of pending.data.filter(s => s.mode === 'subscription')) {
          if (session.metadata?.plan === plan && session.url) return session.url;
          await stripe.checkout.sessions.expire(session.id);
        }
        const session = await stripe.checkout.sessions.create({
          customer, mode: 'subscription', line_items: [{ price: prices[plan], quantity: 1 }], client_reference_id: workspace.id,
          metadata: { plan }, subscription_data: { metadata: { workspace_id: workspace.id } }, allow_promotion_codes: true,
          success_url: `${env.APP_URL}/?billing=success`, cancel_url: `${env.APP_URL}/?billing=canceled`
        });
        return session.url;
      } finally { checkoutBusy.delete(workspace.id); }
    },
    async portal(workspace) {
      requireReady();
      if (!workspace.customer_id) throw Object.assign(new Error('You do not have a billing account yet. Choose a plan first.'), { status: 400 });
      return (await stripe.billingPortal.sessions.create({ customer: workspace.customer_id, return_url: env.APP_URL })).url;
    },
    async webhook(body, signature) {
      requireReady();
      let event;
      try { event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET); }
      catch { throw Object.assign(new Error('Invalid Stripe webhook signature.'), { status: 400 }); }
      if (db.prepare('SELECT id FROM stripe_events WHERE id=?').get(event.id)) return;
      const object = event.data.object;
      const subscriptionId = event.type.startsWith('customer.subscription.') ? object.id
        : event.type === 'checkout.session.completed' ? object.subscription
        : ['invoice.paid', 'invoice.payment_failed'].includes(event.type) ? (object.parent?.subscription_details?.subscription || object.subscription) : null;
      if (subscriptionId) await syncSubscription(typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id);
      db.prepare('INSERT OR IGNORE INTO stripe_events VALUES(?,?)').run(event.id, Date.now());
    },
    async reconcile() {
      if (!ready) return;
      for (const ws of db.prepare('SELECT subscription_id FROM workspaces WHERE subscription_id IS NOT NULL').all()) {
        await syncSubscription(ws.subscription_id).catch(() => console.error('Stripe reconciliation failed; retrying next cycle.'));
      }
      db.prepare('DELETE FROM stripe_events WHERE created_at<?').run(Date.now() - 90 * 86400000);
    }
  };
}
