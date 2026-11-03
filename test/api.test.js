import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { createVault, hash } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
async function setup(t) {
  const db = openDatabase(':memory:'), vault = createVault(randomBytes(32).toString('hex'));
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u1', 'Test admin', null, vault.encrypt('discord-secret'));
  db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run('w1', 'u1', Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash('test-session'), 'u1', 'test-csrf', Date.now() + 600000);
  const service = createService(db, vault, async () => ({ output: 'OK', players: ['Test player'], latency: 1 }));
  const app = createApp({ db, vault, service, billing: { ready: false, webhook() { throw Object.assign(new Error('Not configured'), { status: 503 }); } }, env: { APP_URL: 'http://localhost:3000' } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const headers = { Cookie: 'rookrift_session=test-session', 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-CSRF-Token': 'test-csrf' };
  return { db, service, url, headers };
}
test('API rejects anonymous access, expired sessions, and forged OAuth states', async t => {
  const { db, url, headers } = await setup(t);
  assert.equal((await fetch(`${url}/api/health`)).status, 200);
  assert.equal((await fetch(`${url}/api/bootstrap`)).status, 401);
  assert.equal((await fetch(`${url}/auth/discord/callback?state=forged&code=x`)).status, 400);
  db.prepare('UPDATE sessions SET expires_at=0').run();
  assert.equal((await fetch(`${url}/api/bootstrap`, { headers })).status, 401);
});
test('API blocks CSRF and cross-origin mutations', async t => {
  const { url, headers } = await setup(t);
  for (const overrides of [{ 'X-CSRF-Token': '' }, { Origin: 'https://evil.example' }]) {
    const response = await fetch(`${url}/api/workspace`, { method: 'PATCH', headers: { ...headers, ...overrides }, body: JSON.stringify({ name: 'Changed' }) });
    assert.equal(response.status, 403);
  }
  const response = await fetch(`${url}/api/workspace`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'My tribe' }) });
  assert.equal(response.status, 200);
});
test('bootstrap never includes encrypted passwords or Discord tokens', async t => {
  const { service, url, headers } = await setup(t);
  service.addServer('w1', { name: 'Test world', game: 'asa', map: 'The Island', host: '8.8.8.8', port: 27020, password: 'super-secret', max_players: 70 });
  const response = await fetch(`${url}/api/bootstrap`, { headers }); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.servers.length, 1);
  assert.equal(data.servers[0].password, undefined); assert.equal(data.user.access_token, undefined);
  assert.ok(!JSON.stringify(data).includes('super-secret')); assert.equal(data.workspace.plan, 'scout');
});
test('API validates input, rejects private targets, and prevents cross-workspace deletion', async t => {
  const { service, db, url, headers } = await setup(t);
  const input = { name: 'Test server', game: 'asa', map: 'The Island', host: '127.0.0.1', port: 27020, password: 'secret' };
  assert.equal((await fetch(`${url}/api/servers`, { method: 'POST', headers, body: JSON.stringify(input) })).status, 400);
  assert.equal((await fetch(`${url}/api/servers`, { method: 'POST', headers, body: JSON.stringify({ ...input, game: 'dayz' }) })).status, 400);
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u2', 'Other', null, 'encrypted');
  db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run('w2', 'u2', Date.now());
  const foreign = service.addServer('w2', { ...input, host: '8.8.8.8' });
  assert.equal((await fetch(`${url}/api/servers/${foreign.id}`, { method: 'DELETE', headers })).status, 404);
  assert.ok(db.prepare('SELECT id FROM servers WHERE id=?').get(foreign.id));
});
test('same-origin logout revokes the session', async t => {
  const { url, headers } = await setup(t);
  const response = await fetch(`${url}/api/logout`, { method: 'POST', headers }); assert.equal(response.status, 200);
  assert.equal((await fetch(`${url}/api/bootstrap`, { headers })).status, 401);
});
