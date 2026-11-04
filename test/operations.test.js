import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { createVault } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { createOperations } from '../server/operations.js';
import { windowActive, renderAnnouncement } from '../shared/operations.js';
import { maintenanceState } from '../server/operations-state.js';
import { createHostingAdapter, securePanelRequest } from '../server/hosting.js';
import { commandFor } from '../server/games.js';
const input = {
  name: 'Island EU',
  game: 'asa',
  map: 'The Island',
  host: '8.8.8.8',
  port: 27020,
  password: 'secret',
  cluster: 'Main',
  max_players: 70
};
async function fixture(t, transport = async () => ({
  output: 'Command acknowledged.',
  players: ['Nora, PLAYER-001'],
  latency: 30
}), hosting) {
  const db = await openDatabase(':memory:'),
    vault = createVault(randomBytes(32).toString('hex'));
  for (const id of ['u1', 'u2']) await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, id, null, 'encrypted');
  await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w1','u1','tribe','active',?)").run(Date.now());
  await db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w2','u2',?)").run(Date.now());
  const service = createService(db, vault, transport),
    operations = createOperations(db, vault, service, hosting);
  t.after(async () => await db.close());
  return {
    db,
    vault,
    service,
    operations
  };
}
test('weekly windows handle cross-midnight, zones, disabled state, and overlapping manual maintenance', async t => {
  const {
    service,
    operations,
    db
  } = await fixture(t);
  const server = await service.addServer('w1', input);
  const window = await operations.saveWindow('w1', {
    name: 'Sunday upkeep',
    server_ids: [server.id],
    days: [0],
    start_time: '23:30',
    duration_minutes: 90,
    time_zone: 'UTC',
    enabled: true
  });
  assert.equal(windowActive(window, Date.parse('2026-11-01T23:45:00Z')), true);
  assert.equal(windowActive(window, Date.parse('2026-11-02T00:30:00Z')), true);
  assert.equal(windowActive(window, Date.parse('2026-11-02T01:00:00Z')), false);
  assert.equal(windowActive({
    ...window,
    time_zone: 'Europe/London'
  }, Date.parse('2026-07-05T22:45:00Z')), true);
  assert.equal(windowActive({
    ...window,
    enabled: false
  }, Date.parse('2026-11-01T23:45:00Z')), false);
  await service.updateServer('w1', server.id, {
    maintenance: true
  });
  await operations.deleteWindow('w1', window.id);
  assert.equal((await maintenanceState(db, await service.getServer('w1', server.id))).in_maintenance, true);
});
test('maintenance windows enforce plan caps, target ownership, and IANA time zones', async t => {
  const {
    operations,
    service,
    db
  } = await fixture(t);
  const server = await service.addServer('w2', input),
    own = await service.addServer('w1', input);
  const window = {
    name: 'Weekly',
    server_ids: [own.id],
    days: [1],
    start_time: '04:00',
    duration_minutes: 30,
    time_zone: 'UTC',
    enabled: true
  };
  await assert.rejects(async () => await operations.saveWindow('w1', {
    ...window,
    server_ids: [server.id]
  }), /not found/);
  await assert.rejects(async () => await operations.saveWindow('w1', {
    ...window,
    time_zone: 'Unknown/Zone'
  }));
  await assert.rejects(async () => await operations.saveWindow('w2', {
    ...window,
    server_ids: [server.id]
  }), /Scout allows 0 windows/);
  await db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await assert.rejects(async () => await operations.saveWindow('w1', window), /Scout allows/);
});
test('announcement library resolves current server values, validates all recipients, and keeps messages within limits', async t => {
  const calls = [];
  const {
    operations,
    service
  } = await fixture(t, async (server, vault, action, message) => {
    calls.push({
      server: server.id,
      action,
      message
    });
    return {
      output: 'ACK'
    };
  });
  const server = await service.addServer('w1', input),
    foreign = await service.addServer('w2', input);
  const template = await operations.saveTemplate('w1', {
    name: 'Welcome',
    body: 'Welcome to {server} on {map}. {players} online in {cluster}.'
  });
  assert.equal(renderAnnouncement(template.body, {
    ...server,
    players: 12
  }), 'Welcome to Island EU on The Island. 12 online in Main.');
  await assert.rejects(operations.sendTemplate('w1', template.id, [server.id, foreign.id]), /not found/);
  assert.equal(calls.length, 0);
  await operations.sendTemplate('w1', template.id, [server.id]);
  assert.equal(calls[0].message, 'Welcome to Island EU on The Island. 0 online in Main.');
  await assert.rejects(async () => await operations.saveTemplate('w1', {
    name: 'Bad token',
    body: 'Hello {password}'
  }));
  const long = await operations.saveTemplate('w1', {
    name: 'Long',
    body: 'x'.repeat(280) + ' {server} {map}'
  });
  await assert.rejects(operations.sendTemplate('w1', long.id, [server.id]), /300 characters/);
});
test('free announcement capacity and cross-workspace template edits are enforced', async t => {
  const {
    operations
  } = await fixture(t);
  for (let index = 0; index < 3; index++) await operations.saveTemplate('w2', {
    name: `Template ${index}`,
    body: 'Welcome'
  });
  await assert.rejects(async () => await operations.saveTemplate('w2', {
    name: 'Fourth',
    body: 'Welcome'
  }), /Scout allows 3 templates/);
  const template = await operations.saveTemplate('w1', {
    name: 'Own',
    body: 'Welcome'
  });
  await assert.rejects(async () => await operations.saveTemplate('w2', {
    name: 'Changed',
    body: 'Hi'
  }, template.id), /not found/);
  await assert.rejects(async () => await operations.deleteTemplate('w2', template.id), /not found/);
});
test('broadcasts and moderation IDs cannot inject additional game commands', () => {
  assert.equal(commandFor('broadcast', 'Hello | DestroyAll Dinos\nWelcome'), 'Broadcast Hello   DestroyAll Dinos Welcome');
  assert.throws(() => commandFor('ban', 'PLAYER-1|DoExit'), /identifier/);
  assert.throws(() => commandFor('kick', 'PLAYER 1'), /identifier/);
  assert.equal(commandFor('kick', 'PLAYER-001'), 'KickPlayer PLAYER-001');
  assert.equal(commandFor('unban', '76561198000000001'), 'UnbanPlayer 76561198000000001');
});
test('moderation requires a current reported identity, records internal reasons, and tracks unban requests', async t => {
  const calls = [];
  const {
    service,
    operations,
    db
  } = await fixture(t, async (server, vault, action, message) => {
    calls.push({
      action,
      message
    });
    return action === 'status' ? {
      output: 'OK',
      players: ['Nora, PLAYER-001'],
      latency: 10
    } : {
      output: 'Command acknowledged.'
    };
  });
  const server = await service.addServer('w1', input);
  await assert.rejects(operations.moderate('w1', {
    server_id: server.id,
    identifier: 'PLAYER-001',
    action: 'ban',
    reason: 'Repeated abuse'
  }, 'Admin'), /Refresh the player list/);
  await service.action('w1', server.id, 'status');
  await operations.moderate('w1', {
    server_id: server.id,
    identifier: 'PLAYER-001',
    action: 'ban',
    reason: 'Repeated abuse'
  }, 'Admin');
  assert.equal((await operations.moderation('w1'))[0].active, 1);
  assert.equal(calls.at(-1).message, 'PLAYER-001');
  assert.equal(calls.at(-1).action, 'ban');
  await assert.rejects(operations.moderate('w1', {
    server_id: server.id,
    identifier: 'PLAYER-001',
    action: 'ban',
    reason: 'Duplicate'
  }, 'Admin'), /already exists/);
  await operations.moderate('w1', {
    server_id: server.id,
    identifier: 'PLAYER-001',
    action: 'unban',
    reason: 'Appeal accepted'
  }, 'Admin');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM moderation WHERE active=1').get()).n, 0);
  assert.equal((await operations.moderation('w2')).length, 0);
  await assert.rejects(operations.moderate('w2', {
    server_id: server.id,
    identifier: 'PLAYER-001',
    action: 'kick',
    reason: 'Foreign'
  }, 'Other'), /not found/);
});
test('hosting connections encrypt keys and require exact confirmation before provider mutations', async t => {
  const calls = [];
  const fake = {
    resources: async connection => {
      calls.push({
        kind: 'verify',
        key: connection.key
      });
      return {
        state: 'running'
      };
    },
    backups: async () => [],
    action: async (connection, action) => {
      calls.push({
        kind: action
      });
      return {
        accepted: true,
        detail: 'Accepted'
      };
    }
  };
  const {
    operations,
    service,
    db,
    vault
  } = await fixture(t, undefined, fake);
  const server = await service.addServer('w1', input);
  await operations.connectHosting('w1', server.id, {
    provider: 'pterodactyl',
    origin: 'https://panel.example.com',
    remote_id: 'abcd1234',
    api_key: 'ptlc_private_secret'
  });
  assert.equal((await operations.hostingLinks('w1'))[0].api_key, undefined);
  const row = await db.prepare('SELECT * FROM hosting_connections').get();
  assert.notEqual(row.api_key, 'ptlc_private_secret');
  assert.equal(vault.decrypt(row.api_key), 'ptlc_private_secret');
  await assert.rejects(operations.hostingAction('w1', server.id, {
    action: 'restart',
    confirmation: 'Wrong name'
  }), /exact game server name/);
  assert.equal(calls.filter(call => call.kind === 'restart').length, 0);
  await operations.hostingAction('w1', server.id, {
    action: 'restart',
    confirmation: server.name
  });
  assert.equal(calls.at(-1).kind, 'restart');
  assert.equal((await service.getServer('w1', server.id)).status, 'unknown');
  await assert.rejects(operations.connectHosting('w1', server.id, {
    provider: 'pterodactyl',
    origin: 'https://other.example.com',
    remote_id: 'abcd1234',
    api_key: ''
  }), /Enter an API key/);
  await assert.rejects(operations.hostingStatus('w2', server.id), /not found/);
});
test('Pterodactyl adapter maps power, resources and backup requests without exposing the credential', async () => {
  const calls = [];
  const adapter = createHostingAdapter(async (origin, path, key, method, body) => {
    calls.push({
      origin,
      path,
      key,
      method,
      body
    });
    if (path.endsWith('/resources')) return {
      attributes: {
        current_state: 'running',
        resources: {
          cpu_absolute: 14,
          memory_bytes: 1024,
          disk_bytes: 2048,
          uptime: 60000
        }
      }
    };
    if (path.endsWith('/backups') && method === 'POST') return {
      attributes: {
        uuid: 'backup-1'
      }
    };
    if (path.endsWith('/backups')) return {
      data: [{
        attributes: {
          uuid: 'backup-1',
          name: 'Archive',
          bytes: 100,
          created_at: '2026-11-03T00:00:00Z',
          completed_at: '2026-11-03T00:01:00Z',
          is_successful: true
        }
      }]
    };
    return {};
  });
  const connection = {
    origin: 'https://panel.example.com',
    remote_id: 'abcd1234',
    key: 'private-key'
  };
  const resources = await adapter.resources(connection);
  assert.equal(resources.memory_bytes, 1024);
  assert.equal(JSON.stringify(resources).includes('private-key'), false);
  assert.equal((await adapter.backups(connection))[0].status, 'completed');
  await adapter.action(connection, 'restart');
  assert.deepEqual(calls.at(-1).body, {
    signal: 'restart'
  });
  assert.equal(calls.at(-1).path, '/api/client/servers/abcd1234/power');
  await adapter.action(connection, 'backup', 'Archive');
  assert.deepEqual(calls.at(-1).body, {
    name: 'Archive'
  });
  assert.equal(calls.at(-1).method, 'POST');
});
test('hosting requests reject insecure URLs, URL credentials and metadata targets before sending a key', async () => {
  await assert.rejects(securePanelRequest('http://example.com', '/api/client', 'secret'), /HTTPS/);
  await assert.rejects(securePanelRequest('https://user:password@example.com', '/api/client', 'secret'), /HTTPS/);
  const previous = process.env.ALLOW_PRIVATE_HOSTING;
  process.env.ALLOW_PRIVATE_HOSTING = 'false';
  try {
    await assert.rejects(securePanelRequest('https://169.254.169.254', '/api/client', 'secret'), /public address/);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_PRIVATE_HOSTING;else process.env.ALLOW_PRIVATE_HOSTING = previous;
  }
});
test('incidents open once after a failure threshold, acknowledge independently, and close on recovery', async t => {
  let online = true;
  const sent = [];
  const {
    service,
    operations,
    db
  } = await fixture(t, async () => {
    if (!online) throw new Error('Unavailable');
    return {
      output: 'OK',
      players: [],
      latency: 12
    };
  });
  const server = await service.addServer('w1', input);
  await db.prepare("UPDATE workspaces SET failure_threshold=2 WHERE id='w1'").run();
  await service.pollAll();
  online = false;
  await service.pollAll(async (_, message) => sent.push(message));
  assert.equal((await operations.incidents('w1')).length, 0);
  await service.pollAll(async (_, message) => sent.push(message));
  await service.pollAll(async (_, message) => sent.push(message));
  assert.equal((await operations.incidents('w1')).length, 1);
  assert.equal(sent.length, 1);
  const incident = (await operations.incidents('w1'))[0];
  await operations.updateIncident('w1', incident.id, {
    acknowledged: true,
    notes: 'Investigating'
  });
  assert.ok((await operations.incidents('w1'))[0].acknowledged_at);
  await assert.rejects(async () => await operations.updateIncident('w2', incident.id, {
    notes: 'Foreign'
  }), /not found/);
  online = true;
  await service.pollAll(async (_, message) => sent.push(message));
  assert.ok((await operations.incidents('w1'))[0].resolved_at);
  assert.equal(sent.length, 2);
  assert.equal((await operations.notifications('w1')).unread, 2);
});
test('planned maintenance does not count toward a later unplanned outage threshold', async t => {
  const {
    service,
    operations,
    db
  } = await fixture(t, async () => {
    throw new Error('Offline');
  });
  const server = await service.addServer('w1', input);
  await db.prepare("UPDATE workspaces SET failure_threshold=2 WHERE id='w1'").run();
  await service.updateServer('w1', server.id, {
    maintenance: true
  });
  await service.pollAll();
  await service.pollAll();
  assert.equal((await service.getServer('w1', server.id)).failed_checks, 0);
  await service.updateServer('w1', server.id, {
    maintenance: false
  });
  await service.pollAll();
  assert.equal((await operations.incidents('w1')).length, 0);
  await service.pollAll();
  assert.equal((await operations.incidents('w1')).length, 1);
});
test('notifications retain per-workspace read state and automation history records failures', async t => {
  const {
    service,
    operations,
    db
  } = await fixture(t, async () => {
    throw new Error('Offline');
  });
  const server = await service.addServer('w1', input),
    task = await service.addSchedule('w1', {
      server_id: server.id,
      name: 'Save task',
      action: 'save',
      interval_minutes: 60
    });
  await assert.rejects(service.runSchedule('w1', task.id));
  const runs = await operations.runs('w1', task.id);
  assert.equal(runs[0].status, 'failed');
  assert.equal((await operations.notifications('w1')).unread, 1);
  const notice = (await operations.notifications('w1')).items[0];
  await assert.rejects(async () => await operations.readNotification('w2', notice.id), /not found/);
  await operations.readNotification('w1', notice.id);
  assert.equal((await operations.notifications('w1')).unread, 0);
  await assert.rejects(async () => await operations.runs('w2', task.id), /not found/);
});
test('health analytics use observed samples, bounded ranges, and latency percentiles', async t => {
  const {
    operations,
    service,
    db
  } = await fixture(t);
  const server = await service.addServer('w1', input);
  for (let index = 0; index < 20; index++) await db.prepare('INSERT INTO metrics(server_id,players,online,created_at,latency) VALUES(?,?,?,?,?)').run(server.id, index, index < 18 ? 1 : 0, Date.now() - index * 60000, index < 18 ? 10 + index : null);
  const health = await operations.health('w1', server.id, 24);
  assert.equal(health.samples, 20);
  assert.equal(health.availability, 90);
  assert.equal(health.peak_players, 19);
  assert.equal(health.p95_latency, 27);
  assert.ok(health.series.length <= 97);
  await assert.rejects(async () => await operations.health('w1', server.id, 720), /168 hours/);
  await assert.rejects(async () => await operations.health('w2', server.id, 24), /not found/);
});
