import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { createBilling } from '../server/billing.js';
test('checkout rejects mismatched price amounts, currencies and billing intervals before creating a customer', async () => {
  const db = await openDatabase(':memory:');
  await db.prepare("INSERT INTO users VALUES('u','Owner',NULL,'encrypted')").run();
  await db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w','u',1)").run();
  let created = 0;
  const expected = {
    active: true,
    currency: 'gbp',
    unit_amount: 399,
    recurring: {
      interval: 'month',
      interval_count: 1
    }
  };
  for (const override of [{
    unit_amount: 900
  }, {
    currency: 'eur'
  }, {
    active: false
  }, {
    recurring: {
      interval: 'year',
      interval_count: 1
    }
  }, {
    recurring: {
      interval: 'month',
      interval_count: 3
    }
  }]) {
    const billing = createBilling(db, {
      STRIPE_WEBHOOK_SECRET: 'secret',
      STRIPE_TRIBE_MONTHLY_PRICE_ID: 'tribe',
      STRIPE_CLUSTER_MONTHLY_PRICE_ID: 'cluster'
    }, {
      prices: {
        retrieve: async () => ({
          ...expected,
          ...override
        })
      },
      customers: {
        create: async () => {
          created++;
          return {
            id: 'cus_1'
          };
        }
      }
    });
    await assert.rejects(billing.checkout(await db.prepare("SELECT * FROM workspaces WHERE id='w'").get(), 'tribe'), /does not match/);
  }
  assert.equal(created, 0);
  await db.close();
});
test('legacy subscription price IDs preserve entitlement during migration without becoming new checkout prices', async () => {
  const db = await openDatabase(':memory:');
  await db.prepare("INSERT INTO users VALUES('u','Owner',NULL,'encrypted')").run();
  await db.prepare("INSERT INTO workspaces(id,owner_id,created_at,customer_id) VALUES('w','u',1,'cus_1')").run();
  const billing = createBilling(db, {
    STRIPE_WEBHOOK_SECRET: 'secret',
    STRIPE_TRIBE_MONTHLY_PRICE_ID: 'new-tribe',
    STRIPE_CLUSTER_MONTHLY_PRICE_ID: 'new-cluster',
    STRIPE_TRIBE_LEGACY_MONTHLY_PRICE_IDS: 'old-tribe, old-tribe-2'
  }, {
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        items: {
          data: [{
            price: {
              id: 'old-tribe-2'
            }
          }]
        }
      })
    }
  });
  await billing.syncSubscription('sub_1');
  assert.equal((await db.prepare("SELECT plan FROM workspaces WHERE id='w'").get()).plan, 'tribe');
  await db.close();
});
test('checkout reuses a pending session and refuses duplicate subscriptions before a webhook arrives', async () => {
  const db = await openDatabase(':memory:');
  await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u', 'Owner', null, 'encrypted');
  await db.prepare('INSERT INTO workspaces(id,owner_id,created_at,customer_id) VALUES(?,?,?,?)').run('w', 'u', Date.now(), 'cus_1');
  const workspace = await db.prepare('SELECT * FROM workspaces').get();
  let subscriptions = [],
    pending = [],
    creates = 0,
    expired = 0;
  const stripe = {
    prices: {
      async retrieve(id) {
        return {
          active: true,
          currency: 'gbp',
          unit_amount: id === 'tribe' ? 399 : 999,
          recurring: {
            interval: 'month',
            interval_count: 1
          }
        };
      }
    },
    subscriptions: {
      async list() {
        return {
          data: subscriptions
        };
      }
    },
    checkout: {
      sessions: {
        async list() {
          return {
            data: pending
          };
        },
        async expire() {
          expired++;
          pending = [];
        },
        async create(input) {
          creates++;
          pending = [{
            id: `cs_${creates}`,
            mode: 'subscription',
            metadata: input.metadata,
            url: `https://checkout.stripe.com/test-${creates}`
          }];
          return pending[0];
        }
      }
    }
  };
  const billing = createBilling(db, {
    STRIPE_WEBHOOK_SECRET: 'secret',
    STRIPE_TRIBE_MONTHLY_PRICE_ID: 'tribe',
    STRIPE_CLUSTER_MONTHLY_PRICE_ID: 'cluster',
    APP_URL: 'https://example.com'
  }, stripe);
  assert.equal(await billing.checkout(workspace, 'tribe'), 'https://checkout.stripe.com/test-1');
  assert.equal(await billing.checkout(workspace, 'tribe'), 'https://checkout.stripe.com/test-1');
  assert.equal(creates, 1);
  assert.equal(await billing.checkout(workspace, 'cluster'), 'https://checkout.stripe.com/test-2');
  assert.equal(expired, 1);
  subscriptions = [{
    id: 'sub_1',
    status: 'active'
  }];
  await assert.rejects(billing.checkout(workspace, 'tribe'), /Manage billing/);
  assert.equal(creates, 2);
  assert.equal((await db.prepare('SELECT plan FROM workspaces').get()).plan, 'scout');
  await db.close();
});
