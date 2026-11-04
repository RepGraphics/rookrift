import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { openDatabase } from '../server/db.js';
import { createBilling } from '../server/billing.js';
test('signed billing events reconcile current Stripe state, deduplicate, and honor canceled subscriptions', async () => {
  const db = await openDatabase(':memory:');
  await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('user', 'Owner', null, 'encrypted');
  await db.prepare('INSERT INTO workspaces(id,owner_id,created_at,customer_id) VALUES(?,?,?,?)').run('ws', 'user', Date.now(), 'cus_test');
  let calls = 0,
    status = 'active',
    price = 'price_tribe';
  const sdk = new Stripe('sk_test_fake');
  const stripe = {
    webhooks: sdk.webhooks,
    subscriptions: {
      async retrieve(id) {
        calls++;
        return {
          id,
          customer: 'cus_test',
          status,
          items: {
            data: [{
              price: {
                id: price
              }
            }]
          }
        };
      }
    }
  };
  const env = {
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    STRIPE_TRIBE_MONTHLY_PRICE_ID: 'price_tribe',
    STRIPE_CLUSTER_MONTHLY_PRICE_ID: 'price_cluster'
  };
  const billing = createBilling(db, env, stripe);
  const deliver = async (id, type, object) => {
    const payload = JSON.stringify({
      id,
      type,
      data: {
        object
      }
    });
    const signature = sdk.webhooks.generateTestHeaderString({
      payload,
      secret: env.STRIPE_WEBHOOK_SECRET
    });
    await billing.webhook(Buffer.from(payload), signature);
  };
  await assert.rejects(billing.webhook(Buffer.from('{}'), 'fake-signature'), /Invalid Stripe/);
  await deliver('evt_1', 'customer.subscription.updated', {
    id: 'sub_test',
    status: 'canceled'
  });
  assert.equal((await db.prepare('SELECT plan FROM workspaces').get()).plan, 'tribe');
  assert.equal(calls, 1);
  await deliver('evt_1', 'customer.subscription.updated', {
    id: 'sub_test'
  });
  assert.equal(calls, 1);
  status = 'canceled';
  await deliver('evt_2', 'customer.subscription.deleted', {
    id: 'sub_test'
  });
  assert.equal((await db.prepare('SELECT subscription_status FROM workspaces').get()).subscription_status, 'canceled');
  status = 'active';
  price = 'unrecognized';
  await deliver('evt_3', 'customer.subscription.updated', {
    id: 'sub_test',
    metadata: {
      plan: 'cluster'
    }
  });
  assert.equal((await db.prepare('SELECT plan FROM workspaces').get()).plan, 'scout');
  status = 'active';
  price = 'price_cluster';
  await billing.reconcile();
  assert.equal((await db.prepare('SELECT plan FROM workspaces').get()).plan, 'cluster');
  await db.close();
});
