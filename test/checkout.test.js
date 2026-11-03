import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { createBilling } from '../server/billing.js';
test('checkout reuses a pending session and refuses duplicate subscriptions before a webhook arrives', async () => {
  const db = openDatabase(':memory:'); db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u', 'Owner', null, 'encrypted');
  db.prepare('INSERT INTO workspaces(id,owner_id,created_at,customer_id) VALUES(?,?,?,?)').run('w', 'u', Date.now(), 'cus_1');
  const workspace = db.prepare('SELECT * FROM workspaces').get();
  let subscriptions = [], pending = [], creates = 0, expired = 0;
  const stripe = {
    subscriptions: { async list() { return { data: subscriptions }; } },
    checkout: { sessions: {
      async list() { return { data: pending }; },
      async expire() { expired++; pending = []; },
      async create(input) { creates++; pending = [{ id: `cs_${creates}`, mode: 'subscription', metadata: input.metadata, url: `https://checkout.stripe.com/test-${creates}` }]; return pending[0]; }
    } }
  };
  const billing = createBilling(db, { STRIPE_WEBHOOK_SECRET: 'secret', STRIPE_TRIBE_MONTHLY_PRICE_ID: 'tribe', STRIPE_CLUSTER_MONTHLY_PRICE_ID: 'cluster', APP_URL: 'https://example.com' }, stripe);
  assert.equal(await billing.checkout(workspace, 'tribe'), 'https://checkout.stripe.com/test-1');
  assert.equal(await billing.checkout(workspace, 'tribe'), 'https://checkout.stripe.com/test-1'); assert.equal(creates, 1);
  assert.equal(await billing.checkout(workspace, 'cluster'), 'https://checkout.stripe.com/test-2'); assert.equal(expired, 1);
  subscriptions = [{ id: 'sub_1', status: 'active' }];
  await assert.rejects(billing.checkout(workspace, 'tribe'), /Manage billing/); assert.equal(creates, 2);
  assert.equal(db.prepare('SELECT plan FROM workspaces').get().plan, 'scout'); db.close();
});
