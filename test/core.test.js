import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase, listServers } from '../server/db.js';
import { createVault } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { effectivePlan } from '../server/plans.js';
import { commandFor, parsePlayers, resolveTarget, GAMES } from '../server/games.js';
import { commandDefinitions } from '../server/bot.js';
export async function fixture(transport) {
  const db = await openDatabase(':memory:'),
    vault = createVault(randomBytes(32).toString('hex'));
  for (const id of ['u1', 'u2']) await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, id, null, vault.encrypt('access'));
  for (const id of ['w1', 'w2']) await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run(id, id === 'w1' ? 'u1' : 'u2', Date.now());
  const service = createService(db, vault, transport || (async () => ({
    output: 'OK',
    players: ['1, steam-id'],
    latency: 5
  })));
  return {
    db,
    vault,
    service
  };
}
export const input = {
  name: 'Test world',
  game: 'asa',
  map: 'The Island',
  host: 'example.com',
  port: 27020,
  password: 'super-secret',
  max_players: 70
};
test('RCON vault encrypts with unique IVs, decrypts, and rejects tampering', () => {
  const vault = createVault(randomBytes(32).toString('hex')),
    first = vault.encrypt('password'),
    second = vault.encrypt('password');
  assert.notEqual(first, second);
  assert.equal(vault.decrypt(first), 'password');
  assert.ok(!first.includes('password'));
  const data = Buffer.from(first, 'base64');
  data[data.length - 1] ^= 1;
  assert.throws(() => vault.decrypt(data.toString('base64')));
  assert.throws(() => createVault('short'));
});
test('free cap is enforced on every insert and paid status controls capacity', async () => {
  const {
    db,
    service
  } = await fixture();
  await service.addServer('w1', input);
  await service.addServer('w1', input);
  await assert.rejects(async () => await service.addServer('w1', input), /Scout allows 2 servers/);
  await db.prepare("UPDATE workspaces SET plan='tribe',subscription_status='active' WHERE id='w1'").run();
  for (let i = 0; i < 3; i++) await service.addServer('w1', input);
  await assert.rejects(async () => await service.addServer('w1', input), /Tribe allows 5 servers/);
  await db.prepare("UPDATE workspaces SET subscription_status='past_due' WHERE id='w1'").run();
  assert.equal(effectivePlan(await db.prepare("SELECT * FROM workspaces WHERE id='w1'").get()).id, 'scout');
  const servers = await listServers(db, 'w1');
  await assert.doesNotReject(async () => await service.getServer('w1', servers[0].id));
  await assert.rejects(async () => await service.getServer('w1', servers[2].id), /paused/);
  assert.equal(servers.length, 5);
  await db.close();
});
test('tenant isolation applies to controls, schedules, and returned secrets', async () => {
  const {
    db,
    service
  } = await fixture();
  const server = await service.addServer('w1', input);
  assert.equal(server.password, undefined);
  assert.equal(server.workspace_id, undefined);
  await assert.rejects(async () => await service.getServer('w2', server.id), /not found/);
  await assert.rejects(service.action('w2', server.id, 'save'), /not found/);
  await assert.rejects(async () => await service.addSchedule('w2', {
    server_id: server.id,
    name: 'Foreign task',
    action: 'save',
    interval_minutes: 60
  }), /not found/);
  await db.close();
});
test('DayZ and invalid game inputs are refused rather than using the ARK protocol', async () => {
  const {
    db,
    service
  } = await fixture();
  assert.equal(GAMES.dayz.available, false);
  await assert.rejects(async () => await service.addServer('w1', {
    ...input,
    game: 'dayz'
  }));
  await assert.rejects(async () => await service.addServer('w1', {
    ...input,
    port: 0
  }));
  await assert.rejects(async () => await service.addServer('w1', {
    ...input,
    host: 'https://example.com'
  }));
  await db.close();
});
test('source RCON commands and player parsing are bounded', () => {
  assert.equal(commandFor('save'), 'SaveWorld');
  assert.equal(commandFor('status'), 'ListPlayers');
  assert.equal(commandFor('broadcast', 'Hello\nworld'), 'Broadcast Hello world');
  assert.throws(() => commandFor('broadcast', ''));
  assert.throws(() => commandFor('destroy'));
  assert.deepEqual(parsePlayers('0. Survivor, 7656111\n1. Bob, 7656112\n'), ['Survivor, 7656111', 'Bob, 7656112']);
  assert.deepEqual(parsePlayers('No Players Connected'), []);
});
test('network target validation blocks loopback, metadata, private and mapped private addresses', async () => {
  for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.5', '::1', '::ffff:127.0.0.1']) await assert.rejects(resolveTarget(host, false), /public server/);
  assert.equal(await resolveTarget('8.8.8.8', false), '8.8.8.8');
  assert.equal(await resolveTarget('10.0.0.5', true), '10.0.0.5');
});
test('persisted schedules run once when due, skip missed intervals and pause excess tasks on downgrade', async () => {
  let calls = 0;
  const {
    db,
    service
  } = await fixture(async () => {
    calls++;
    return {
      output: 'OK',
      latency: 1
    };
  });
  await db.prepare("UPDATE workspaces SET plan='tribe',subscription_status='active' WHERE id='w1'").run();
  const server = await service.addServer('w1', input);
  for (let n = 0; n < 2; n++) {
    const first = await service.addSchedule('w1', {
      server_id: server.id,
      name: 'Free allowance ' + n,
      action: 'save',
      interval_minutes: 15
    });
    await service.updateSchedule('w1', first.id, {
      enabled: false
    });
  }
  const task = await service.addSchedule('w1', {
    server_id: server.id,
    name: 'World save',
    action: 'save',
    interval_minutes: 15
  });
  await db.prepare('UPDATE schedules SET next_run=? WHERE id=?').run(Date.now() - 86400000, task.id);
  await service.runDueSchedules();
  await service.runDueSchedules();
  assert.equal(calls, 1);
  await db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w1'").run();
  await db.prepare('UPDATE schedules SET next_run=0').run();
  await service.runDueSchedules();
  assert.equal(calls, 1);
  await db.prepare('DELETE FROM servers WHERE id=?').run(server.id);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM schedules').get()).n, 0);
  await db.close();
});
test('overlapping commands on one server are refused', async () => {
  let complete,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const {
    db,
    service
  } = await fixture(() => new Promise(resolve => {
    complete = resolve;started();
  }));
  const s = await service.addServer('w1', input);
  const pending = service.action('w1', s.id, 'save');
  await entered;
  await assert.rejects(service.action('w1', s.id, 'save'), /Another command/);
  complete({
    output: 'OK'
  });
  await pending;
  await db.close();
});
test('bot commands are guild-only, permission-gated, and have complete definitions', () => {
  const [command] = commandDefinitions();
  assert.equal(command.name, 'rookrift');
  assert.equal(command.default_member_permissions, '32');
  assert.deepEqual(command.contexts, [0]);
  assert.equal(command.options.length, 7);
  const maintenance = command.options.find(option => option.name === 'maintenance');
  assert.ok(maintenance.options.some(option => option.name === 'enabled' && option.required));
});
