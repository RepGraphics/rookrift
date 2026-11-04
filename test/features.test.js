import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { openDatabase, publicServer, playerSnapshot, listServers } from '../server/db.js';
import { createVault } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { csvCell, activityCsv } from '../shared/csv.js';
const input = {
  name: 'Island',
  game: 'asa',
  map: 'The Island',
  host: '8.8.8.8',
  port: 27020,
  password: 'initial-secret',
  max_players: 70,
  cluster: 'Main cluster'
};
async function fixture(t, transport = async () => ({
  output: 'OK',
  players: ['Nora, DEMO-1'],
  latency: 5
})) {
  const db = await openDatabase(':memory:'),
    vault = createVault(randomBytes(32).toString('hex'));
  for (const id of ['u1', 'u2']) await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, id, null, 'encrypted');
  await db.prepare("INSERT INTO workspaces(id,owner_id,plan,subscription_status,created_at) VALUES('w1','u1','tribe','active',?)").run(Date.now());
  await db.prepare("INSERT INTO workspaces(id,owner_id,created_at) VALUES('w2','u2',?)").run(Date.now());
  t.after(async () => await db.close());
  return {
    db,
    vault,
    service: createService(db, vault, transport)
  };
}
test('server edits preserve blank passwords, encrypt replacements, reset connection snapshots, and isolate tenants', async t => {
  const {
    db,
    vault,
    service
  } = await fixture(t);
  const server = await service.addServer('w1', input);
  await service.action('w1', server.id, 'status');
  const old = (await service.getServer('w1', server.id)).password;
  const changed = await service.updateServer('w1', server.id, {
    name: 'Island renamed',
    cluster: '  PvE cluster  ',
    password: ''
  });
  assert.equal(changed.cluster, 'PvE cluster');
  assert.equal(changed.status, 'online');
  assert.equal(changed.password, undefined);
  assert.equal(changed.player_list, undefined);
  assert.equal((await service.getServer('w1', server.id)).password, old);
  await service.updateServer('w1', server.id, {
    password: 'replacement-secret'
  });
  const stored = await service.getServer('w1', server.id);
  assert.equal(vault.decrypt(stored.password), 'replacement-secret');
  assert.equal(stored.status, 'unknown');
  assert.equal(stored.player_list, '[]');
  assert.equal(stored.players, 0);
  await assert.rejects(async () => await service.updateServer('w2', server.id, {
    name: 'Foreign'
  }), /not found/);
  await assert.rejects(async () => await service.updateServer('w1', server.id, {
    workspace_id: 'w2'
  }));
  assert.equal(JSON.stringify(publicServer(stored)).includes('replacement-secret'), false);
});
test('bulk actions validate every target and entitlement before any server receives a command', async t => {
  let calls = 0;
  const {
    db,
    service
  } = await fixture(t, async () => {
    calls++;
    return {
      output: 'OK'
    };
  });
  const first = await service.addServer('w1', input),
    extra = await service.addServer('w1', {
      ...input,
      name: 'Second'
    }),
    second = await service.addServer('w1', {
      ...input,
      name: 'Scorched'
    }),
    foreign = await service.addServer('w2', input);
  await assert.rejects(service.bulkAction('w1', {
    server_ids: [first.id, foreign.id],
    action: 'save'
  }), /not found/);
  assert.equal(calls, 0);
  await db.prepare('UPDATE servers SET created_at=1 WHERE id=?').run(first.id);
  await db.prepare('UPDATE servers SET created_at=2 WHERE id=?').run(extra.id);
  await db.prepare('UPDATE servers SET created_at=3 WHERE id=?').run(second.id);
  await db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await assert.rejects(service.bulkAction('w1', {
    server_ids: [first.id, second.id],
    action: 'save'
  }), /paused/);
  assert.equal(calls, 0);
});
test('bulk actions report partial failures, validate broadcasts, and reject duplicate targets', async t => {
  let calls = 0;
  const {
    service
  } = await fixture(t, async server => {
    calls++;
    if (server.name === 'Broken') throw new Error('secret failure');
    return {
      output: 'Saved'
    };
  });
  const good = await service.addServer('w1', input),
    bad = await service.addServer('w1', {
      ...input,
      name: 'Broken'
    });
  await assert.rejects(service.bulkAction('w1', {
    server_ids: [good.id, good.id],
    action: 'save'
  }));
  await assert.rejects(service.bulkAction('w1', {
    server_ids: [good.id],
    action: 'broadcast',
    message: ' '
  }), /Broadcast/);
  assert.equal(calls, 0);
  const result = await service.bulkAction('w1', {
    server_ids: [good.id, bad.id],
    action: 'save'
  });
  assert.deepEqual(result.results.map(row => row.ok), [true, false]);
  assert.equal(calls, 2);
  assert.equal(result.results[1].detail.includes('secret failure'), false);
  assert.equal((await service.getServer('w1', bad.id)).status, 'offline');
});
test('maintenance skips automations while monitoring and manual controls remain available', async t => {
  const calls = [];
  const {
    db,
    service
  } = await fixture(t, async (server, vault, action) => {
    calls.push(action);
    return {
      output: 'OK',
      ...(action === 'status' ? {
        players: ['Nora, 123'],
        latency: 2
      } : {})
    };
  });
  const server = await service.addServer('w1', input),
    task = await service.addSchedule('w1', {
      server_id: server.id,
      name: 'Hourly save',
      action: 'save',
      interval_minutes: 60
    });
  await service.updateServer('w1', server.id, {
    maintenance: true
  });
  await db.prepare('UPDATE schedules SET next_run=0 WHERE id=?').run(task.id);
  await service.runDueSchedules();
  assert.equal(calls.length, 0);
  assert.equal((await service.getSchedule('w1', task.id)).last_status, 'skipped');
  assert.ok((await service.getSchedule('w1', task.id)).next_run > Date.now());
  await service.pollAll();
  await service.action('w1', server.id, 'save');
  assert.deepEqual(calls, ['status', 'save']);
  await service.updateServer('w1', server.id, {
    maintenance: false
  });
  const next = (await service.getSchedule('w1', task.id)).next_run;
  await service.runSchedule('w1', task.id);
  assert.equal((await service.getSchedule('w1', task.id)).next_run, next);
  assert.equal((await service.getSchedule('w1', task.id)).last_status, 'success');
});
test('connection alerts honor workspace preferences and per-server maintenance without hiding audit events', async t => {
  let online = true;
  const notices = [];
  const {
    db,
    service
  } = await fixture(t, async () => {
    if (!online) throw new Error('Offline');
    return {
      output: 'OK',
      players: [],
      latency: 1
    };
  });
  const server = await service.addServer('w1', input);
  await service.pollAll();
  await db.prepare("UPDATE workspaces SET alerts_enabled=0 WHERE id='w1'").run();
  online = false;
  await service.pollAll(async (_, text) => notices.push(text));
  assert.equal(notices.length, 0);
  await db.prepare("UPDATE workspaces SET alerts_enabled=1 WHERE id='w1'").run();
  online = true;
  await service.pollAll(async (_, text) => notices.push(text));
  assert.equal(notices.length, 1);
  await service.updateServer('w1', server.id, {
    maintenance: true
  });
  online = false;
  await service.pollAll(async (_, text) => notices.push(text));
  assert.equal(notices.length, 1);
  assert.ok((await db.prepare("SELECT count(*) AS n FROM activity WHERE title='Server went offline'").get()).n >= 2);
});
test('automation edits validate ownership, reset the next run, and enforce paid limits on run and enable', async t => {
  const {
    db,
    service
  } = await fixture(t);
  const server = await service.addServer('w1', input),
    foreign = await service.addServer('w2', input);
  for (let n = 0; n < 2; n++) await service.addSchedule('w1', {
    server_id: server.id,
    name: 'Free allowance ' + n,
    action: 'save',
    interval_minutes: 60
  });
  const task = await service.addSchedule('w1', {
    server_id: server.id,
    name: 'Old task',
    action: 'save',
    interval_minutes: 15
  });
  await assert.rejects(async () => await service.updateSchedule('w1', task.id, {
    server_id: foreign.id,
    name: 'Hijack',
    action: 'save',
    interval_minutes: 30
  }), /not found/);
  await assert.rejects(async () => await service.updateSchedule('w1', task.id, null));
  await service.updateSchedule('w1', task.id, {
    server_id: server.id,
    name: 'New task',
    action: 'broadcast',
    message: 'Welcome',
    interval_minutes: 120
  });
  const updated = await service.getSchedule('w1', task.id);
  assert.equal(updated.name, 'New task');
  assert.ok(updated.next_run > Date.now() + 119 * 60000);
  await db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await assert.rejects(service.runSchedule('w1', task.id), /paused by your current plan/);
  await assert.rejects(async () => await service.updateSchedule('w1', task.id, {
    enabled: true
  }), /paused by your current plan/);
  await assert.doesNotReject(async () => await service.updateSchedule('w1', task.id, {
    enabled: false
  }));
});
test('failed and successful run-now executions retain outcomes and do not move the next interval', async t => {
  let fail = true;
  const {
    service
  } = await fixture(t, async () => {
    if (fail) throw new Error('network password=secret');
    return {
      output: 'OK'
    };
  });
  const server = await service.addServer('w1', input),
    task = await service.addSchedule('w1', {
      server_id: server.id,
      name: 'Save test',
      action: 'save',
      interval_minutes: 60
    });
  await assert.rejects(service.runSchedule('w1', task.id), /RCON connection failed/);
  const failed = await service.getSchedule('w1', task.id);
  assert.equal(failed.last_status, 'failed');
  assert.equal(failed.last_detail.includes('password='), false);
  assert.equal(failed.next_run, task.next_run);
  fail = false;
  await service.runSchedule('w1', task.id);
  const success = await service.getSchedule('w1', task.id);
  assert.equal(success.last_status, 'success');
  assert.ok(success.last_run);
  assert.equal(success.next_run, task.next_run);
});
test('player snapshots include only online entitled servers and never expose stored password fields', async t => {
  const {
    service,
    db
  } = await fixture(t);
  const a = await service.addServer('w1', input),
    b = await service.addServer('w1', {
      ...input,
      name: 'Second'
    });
  await service.action('w1', a.id, 'status');
  await service.action('w1', b.id, 'status');
  const servers = (await listServers(db, 'w1')).map((server, index) => ({
    ...server,
    paused: index > 0
  }));
  const players = playerSnapshot(servers);
  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'Nora');
  assert.equal(players[0].identifier, 'DEMO-1');
  assert.equal(players[0].cluster, 'Main cluster');
  assert.equal(players[0].password, undefined);
  servers[0].status = 'offline';
  assert.deepEqual(playerSnapshot(servers), []);
});
test('CSV exports escape cells, preserve commas and newlines, and neutralize spreadsheet formulas', () => {
  for (const value of ['=SUM(1,2)', ' +1', '@cmd', '-10', '\t=HYPERLINK("x")']) assert.ok(csvCell(value).startsWith('"\''));
  assert.equal(csvCell('Hello "world"'), '"Hello ""world"""');
  const csv = activityCsv([{
    created_at: 0,
    title: '=danger',
    detail: 'Hello,\nworld',
    level: 'info',
    server_id: 's'
  }], [{
    id: 's',
    name: 'Island'
  }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"\'=danger"'));
  assert.ok(csv.includes('"Hello,\nworld"'));
  assert.ok(csv.includes('"Island"'));
});
