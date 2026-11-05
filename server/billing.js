import Stripe from 'stripe';
import { audit } from './db.js';
import { PLANS } from './plans.js';
export function createBilling(db, env = process.env, injectedStripe, paypal) {
  const stripe = injectedStripe || (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null);
  const prices = {
    tribe: env.STRIPE_TRIBE_MONTHLY_PRICE_ID,
    cluster: env.STRIPE_CLUSTER_MONTHLY_PRICE_ID
  };
  const legacy = {
    tribe: (env.STRIPE_TRIBE_LEGACY_MONTHLY_PRICE_IDS || '').split(',').map(v => v.trim()).filter(Boolean),
    cluster: (env.STRIPE_CLUSTER_LEGACY_MONTHLY_PRICE_IDS || '').split(',').map(v => v.trim()).filter(Boolean)
  };
  const ready = Boolean(stripe && env.STRIPE_WEBHOOK_SECRET && prices.tribe && prices.cluster);
  const checkoutBusy = new Set();
  const configuredProvider = env.PLATFORM_BILLING_PROVIDER || 'stripe';
  function requireReady() {
    if (!ready) throw Object.assign(new Error('Billing is not configured yet. Ask the service owner to complete Stripe setup.'), {
      status: 503
    });
  }
  async function syncSubscription(subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const workspace = await db.prepare('SELECT * FROM workspaces WHERE customer_id=?').get(customerId);
    if (!workspace) return;
    // Only the two configured price IDs grant paid capabilities. Never trust client or metadata plan values.
    const price = subscription.items.data[0]?.price.id;
    const plan = Object.keys(prices).find(key => prices[key] && prices[key] === price || legacy[key].includes(price)) || 'scout';
    if (workspace.subscription_id && workspace.subscription_id !== subscription.id) {
      const existing = await stripe.subscriptions.retrieve(workspace.subscription_id);
      if (['active', 'trialing'].includes(existing.status)) return;
    }
    await db.prepare('UPDATE workspaces SET subscription_id=?,subscription_status=?,plan=? WHERE id=?').run(subscription.id, subscription.status, plan, workspace.id);
    if (workspace.plan !== plan || workspace.subscription_status !== subscription.status) await audit(db, workspace.id, 'Subscription updated', `${plan} · ${subscription.status}`);
  }
  return {
    async accountHistory(workspaces) {
      const history = [];
      for (const workspace of workspaces) {
        const row = { workspace_id: workspace.id, workspace_name: workspace.name, plan: workspace.plan, status: workspace.subscription_status, invoices: [] };
        if (stripe?.invoices?.list && workspace.customer_id) {
          const invoices = await stripe.invoices.list({ customer: workspace.customer_id, limit: 50 }).catch(() => ({ data: [] }));
          row.invoices = invoices.data.map(invoice => ({ id: invoice.id, number: invoice.number, status: invoice.status, amount: invoice.amount_paid ?? invoice.total ?? 0, currency: invoice.currency, paid_at: invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : null, hosted_url: invoice.hosted_invoice_url, pdf_url: invoice.invoice_pdf }));
        }
        history.push(row);
      }
      return history;
    },
    ready,
    syncSubscription,
    async checkout(workspace, plan, provider = configuredProvider) {
      if (provider === 'paypal') {
        if (!paypal?.ready) throw Object.assign(new Error('PayPal billing is not configured yet.'), { status: 503 });
        const planId = env[`PAYPAL_${plan.toUpperCase()}_PLAN_ID`];
        if (!planId) throw Object.assign(new Error('This PayPal membership plan is not configured yet.'), { status: 503 });
        const checkout = await paypal.createSubscription({
          planId,
          reference: `membership-${workspace.id}-${plan}`,
          returnUrl: `${env.APP_URL}/dashboard?billing=success`,
          cancelUrl: `${env.APP_URL}/dashboard?billing=canceled`
        });
        if (!checkout.url) throw Object.assign(new Error('PayPal did not return an approval URL.'), { status: 502 });
        return checkout.url;
      }
      if (provider === 'paypal_ipn' || provider === 'tebex') {
        const key = `${provider === 'paypal_ipn' ? 'PAYPAL_IPN' : 'TEBEX'}_${plan.toUpperCase()}_URL`;
        const url = env[key];
        if (!url) throw Object.assign(new Error(`${provider === 'paypal_ipn' ? 'PayPal IPN' : 'Tebex'} is selected for platform billing but its hosted ${plan} checkout URL is not configured.`), { status: 503 });
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'https:') throw new Error();
        } catch {
          throw Object.assign(new Error('The configured hosted payment URL must use HTTPS.'), { status: 503 });
        }
        return url;
      }
      requireReady();
      if (!prices[plan]) throw Object.assign(new Error('Choose a paid plan.'), {
        status: 400
      });
      if (checkoutBusy.has(workspace.id)) throw Object.assign(new Error('A checkout is already being prepared. Try again shortly.'), {
        status: 409
      });
      checkoutBusy.add(workspace.id);
      try {
        const configured = await stripe.prices.retrieve(prices[plan]);
        if (!configured.active || configured.currency !== 'gbp' || configured.unit_amount !== Math.round(PLANS[plan].price * 100) || configured.recurring?.interval !== 'month' || configured.recurring?.interval_count !== 1) throw Object.assign(new Error('The configured Stripe price does not match this plan’s monthly GBP price. Ask the service owner to update billing configuration.'), {
          status: 503
        });
        // Refresh customer ID inside the lock, including for simultaneous first-time requests.
        let customer = (await db.prepare('SELECT customer_id FROM workspaces WHERE id=?').get(workspace.id)).customer_id;
        if (!customer) {
          customer = (await stripe.customers.create({
            metadata: {
              workspace_id: workspace.id
            }
          }, {
            idempotencyKey: `customer-${workspace.id}`
          })).id;
          await db.prepare('UPDATE workspaces SET customer_id=? WHERE id=?').run(customer, workspace.id);
        }
        // Check Stripe directly; the completed-checkout webhook may not have arrived yet.
        const subscriptions = await stripe.subscriptions.list({
          customer,
          status: 'all',
          limit: 100
        });
        if (subscriptions.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) throw Object.assign(new Error('Use Manage billing to change your existing subscription.'), {
          status: 409
        });
        const pending = await stripe.checkout.sessions.list({
          customer,
          status: 'open',
          limit: 100
        });
        for (const session of pending.data.filter(s => s.mode === 'subscription')) {
          if (session.metadata?.plan === plan && session.metadata?.price_id === prices[plan] && session.url) return session.url;
          await stripe.checkout.sessions.expire(session.id);
        }
        const session = await stripe.checkout.sessions.create({
          customer,
          mode: 'subscription',
          line_items: [{
            price: prices[plan],
            quantity: 1
          }],
          client_reference_id: workspace.id,
          metadata: {
            plan,
            price_id: prices[plan]
          },
          subscription_data: {
            metadata: {
              workspace_id: workspace.id
            }
          },
          allow_promotion_codes: true,
          // Let Stripe offer every payment method enabled for this account,
          // including cards, wallets, bank methods, and buy-now-pay-later
          // options where the customer and currency are eligible.
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'always'
          },
          success_url: `${env.APP_URL}/dashboard?billing=success`,
          cancel_url: `${env.APP_URL}/dashboard?billing=canceled`
        });
        return session.url;
      } finally {
        checkoutBusy.delete(workspace.id);
      }
    },
    async portal(workspace) {
      requireReady();
      if (!workspace.customer_id) throw Object.assign(new Error('You do not have a billing account yet. Choose a plan first.'), {
        status: 400
      });
      return (await stripe.billingPortal.sessions.create({
        customer: workspace.customer_id,
        return_url: env.APP_URL+'/dashboard'
      })).url;
    },
    async webhook(body, signature) {
      requireReady();
      let event;
      try {
        event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET);
      } catch {
        throw Object.assign(new Error('Invalid Stripe webhook signature.'), {
          status: 400
        });
      }
      if (await db.prepare('SELECT id FROM stripe_events WHERE id=?').get(event.id)) return;
      const object = event.data.object;
      const subscriptionId = event.type.startsWith('customer.subscription.') ? object.id : event.type === 'checkout.session.completed' ? object.subscription : ['invoice.paid', 'invoice.payment_failed'].includes(event.type) ? object.parent?.subscription_details?.subscription || object.subscription : null;
      if (subscriptionId) await syncSubscription(typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id);
      await db.prepare('INSERT INTO stripe_events VALUES(?,?) ON CONFLICT DO NOTHING').run(event.id, Date.now());
    },
    async reconcile() {
      if (!ready) return;
      for (const ws of await db.prepare('SELECT subscription_id FROM workspaces WHERE subscription_id IS NOT NULL').all()) {
        await syncSubscription(ws.subscription_id).catch(() => console.error('Stripe reconciliation failed; retrying next cycle.'));
      }
      await db.prepare('DELETE FROM stripe_events WHERE created_at<?').run(Date.now() - 90 * 86400000);
    }
  };
}
