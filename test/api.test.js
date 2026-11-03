import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { createVault, hash } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createOperations } from '../server/operations.js';
async function setup(t,options={}) {
  const db = openDatabase(':memory:'), vault = createVault(randomBytes(32).toString('hex'));
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run('u1', 'Test admin', null, vault.encrypt('discord-secret'));
  db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?)').run('w1', 'u1', Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash('test-session'), 'u1', 'test-csrf', Date.now() + 600000);
  const service = createService(db, vault, options.transport || (async () => ({ output: 'OK', players: ['Test player'], latency: 1 })));
  const operations=createOperations(db,vault,service,options.hosting);
  const app = createApp({ db, vault, service,operations, billing: { ready: false, webhook() { throw Object.assign(new Error('Not configured'), { status: 503 }); } }, env: { APP_URL: 'http://localhost:3000' } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  const headers = { Cookie: 'rookrift_session=test-session', 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'X-CSRF-Token': 'test-csrf' };
  return { db, service,operations, url, headers };
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
test('new server editing and snapshot endpoints keep secrets private and reject private addresses', async t => {
  const {service,url,headers}=await setup(t); const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'});
  const response=await fetch(`${url}/api/servers/${server.id}`,{method:'PATCH',headers,body:JSON.stringify({cluster:'Main',maintenance:true,password:''})});
  assert.equal(response.status,200); const data=await response.json(); assert.equal(data.maintenance,true); assert.equal(data.password,undefined);
  assert.equal((await fetch(`${url}/api/servers/${server.id}`,{method:'PATCH',headers,body:JSON.stringify({host:'127.0.0.1'})})).status,400);
  await service.action('w1',server.id,'status'); const bootstrap=await (await fetch(`${url}/api/bootstrap`,{headers})).json();
  assert.equal(bootstrap.players[0].name,'Test player'); assert.equal(bootstrap.servers[0].player_list,undefined);
});
test('bulk actions and automation editing work through authenticated API routes', async t => {
  const {db,service,url,headers}=await setup(t); db.prepare("UPDATE workspaces SET plan='tribe',subscription_status='active' WHERE id='w1'").run();
  const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'});
  const task=service.addSchedule('w1',{server_id:server.id,name:'Hourly save',action:'save',interval_minutes:60});
  const edit=await fetch(`${url}/api/schedules/${task.id}`,{method:'PATCH',headers,body:JSON.stringify({server_id:server.id,name:'Updated task',action:'save',interval_minutes:120})}); assert.equal(edit.status,200);
  const run=await fetch(`${url}/api/schedules/${task.id}/run`,{method:'POST',headers}); assert.equal(run.status,200); assert.equal((await run.json()).status,'success');
  const bulk=await fetch(`${url}/api/servers/bulk-actions`,{method:'POST',headers,body:JSON.stringify({server_ids:[server.id],action:'save'})}); assert.equal(bulk.status,200); assert.equal((await bulk.json()).results[0].ok,true);
  const malformed=await fetch(`${url}/api/schedules/${task.id}`,{method:'PATCH',headers,body:'null'}); assert.equal(malformed.status,400);
});
test('workspace connection alerts can be disabled without altering the linked channel', async t => {
  const {db,url,headers}=await setup(t);
  db.prepare("UPDATE workspaces SET alert_channel_id='123456789012345678' WHERE id='w1'").run();
  const response=await fetch(`${url}/api/workspace`,{method:'PATCH',headers,body:JSON.stringify({name:'My tribe',alerts_enabled:false,alert_channel_id:'123456789012345678'})}); assert.equal(response.status,200);
  const workspace=db.prepare("SELECT * FROM workspaces WHERE id='w1'").get(); assert.equal(workspace.alerts_enabled,0); assert.equal(workspace.alert_channel_id,'123456789012345678');
});
test('announcement, maintenance and analytics routes honor authentication and paid limits',async t=>{const {db,service,url,headers}=await setup(t);const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'});const templateResponse=await fetch(`${url}/api/templates`,{method:'POST',headers,body:JSON.stringify({name:'Welcome',body:'Welcome to {server}'})});assert.equal(templateResponse.status,201);const template=await templateResponse.json();assert.equal((await fetch(`${url}/api/templates/${template.id}/send`,{method:'POST',headers,body:JSON.stringify({server_ids:[server.id]})})).status,200);const window={name:'Weekly',server_ids:[server.id],days:[0],start_time:'04:00',duration_minutes:30,time_zone:'UTC'};assert.equal((await fetch(`${url}/api/maintenance-windows`,{method:'POST',headers,body:JSON.stringify(window)})).status,403);db.prepare("UPDATE workspaces SET plan='tribe',subscription_status='active' WHERE id='w1'").run();assert.equal((await fetch(`${url}/api/maintenance-windows`,{method:'POST',headers,body:JSON.stringify(window)})).status,201);assert.equal((await fetch(`${url}/api/analytics?server_id=${server.id}&hours=24`,{headers})).status,200);assert.equal((await fetch(`${url}/api/analytics?server_id=${server.id}&hours=720`,{headers})).status,403);assert.equal((await fetch(`${url}/api/templates`,{method:'POST',headers:{...headers,'X-CSRF-Token':'wrong'},body:JSON.stringify({name:'Fake',body:'Hi'})})).status,403);});
test('hosting API verifies credentials without exposing them and gates power requests',async t=>{let power=0;const {service,url,headers}=await setup(t,{hosting:{resources:async()=>({state:'running',cpu:1,memory_bytes:0,disk_bytes:0,uptime_ms:0}),backups:async()=>[],action:async()=>{power++;return{accepted:true};}}});const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'});const connection=await fetch(`${url}/api/servers/${server.id}/hosting`,{method:'PUT',headers,body:JSON.stringify({provider:'pterodactyl',origin:'https://panel.example.com',remote_id:'abcd1234',api_key:'private-hosting-key'})});assert.equal(connection.status,200);assert.equal((await connection.text()).includes('private-hosting-key'),false);const boot=await (await fetch(`${url}/api/bootstrap`,{headers})).json();assert.equal(JSON.stringify(boot).includes('private-hosting-key'),false);assert.equal(boot.hosting_links[0].api_key,undefined);assert.equal((await fetch(`${url}/api/servers/${server.id}/hosting/actions`,{method:'POST',headers,body:JSON.stringify({action:'restart',confirmation:'Wrong'})})).status,400);assert.equal(power,0);assert.equal((await fetch(`${url}/api/servers/${server.id}/hosting/actions`,{method:'POST',headers,body:JSON.stringify({action:'restart',confirmation:'Island'})})).status,200);assert.equal(power,1);});
test('moderation API requires a reported player and records the authenticated actor',async t=>{const {service,url,headers}=await setup(t,{transport:async()=>({output:'ACK',players:['Nora, PLAYER-001'],latency:1})});const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'});const body={server_id:server.id,identifier:'PLAYER-001',action:'kick',reason:'Rule violation'};assert.equal((await fetch(`${url}/api/moderation`,{method:'POST',headers,body:JSON.stringify(body)})).status,409);await service.action('w1',server.id,'status');assert.equal((await fetch(`${url}/api/moderation`,{method:'POST',headers,body:JSON.stringify(body)})).status,200);const data=await (await fetch(`${url}/api/bootstrap`,{headers})).json();assert.equal(data.moderation[0].actor,'Test admin');assert.equal(data.moderation[0].reason,'Rule violation');});
test('automation history and notifications are returned and read through the API',async t=>{const {db,service,url,headers}=await setup(t,{transport:async()=>{throw new Error('Offline');}});db.prepare("UPDATE workspaces SET plan='tribe',subscription_status='active' WHERE id='w1'").run();const server=service.addServer('w1',{name:'Island',game:'asa',map:'The Island',host:'8.8.8.8',port:27020,password:'secret'}),task=service.addSchedule('w1',{server_id:server.id,name:'Hourly',action:'save',interval_minutes:60});assert.equal((await fetch(`${url}/api/schedules/${task.id}/run`,{method:'POST',headers})).status,502);const runs=await (await fetch(`${url}/api/schedules/${task.id}/history`,{headers})).json();assert.equal(runs[0].status,'failed');let data=await (await fetch(`${url}/api/bootstrap`,{headers})).json();assert.equal(data.notifications.unread,1);assert.equal((await fetch(`${url}/api/notifications/read-all`,{method:'POST',headers})).status,200);data=await (await fetch(`${url}/api/bootstrap`,{headers})).json();assert.equal(data.notifications.unread,0);});
