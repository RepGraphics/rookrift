import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostingAdapter} from '../server/hosting.js';
import {hostingSchema} from '../server/operations.js';
import {hostingCapabilities} from '../shared/hosting-providers.js';

test('Nitrado uses fixed service endpoints, scrubs secrets, and starts only the authoritative stopped game',async()=>{
 const calls=[],connection={provider:'nitrado',origin:'https://api.nitrado.net',remote_id:'12345',key:'secret-service-token'};let status='stopped';
 const host=createHostingAdapter(async(origin,path,key,method='GET',body,options)=>{calls.push({origin,path,key,method,body,options});return{status:'success',data:method==='GET'?{gameserver:{service_id:12345,status,game:'arksa',memory_mb:10000,credentials:{ftp:'DO NOT EXPOSE'},websocket_token:'DO NOT EXPOSE'}}:{}};});
 const resources=await host.resources(connection);assert.equal(resources.state,'offline');assert.equal(resources.memory_bytes,null);assert.ok(!JSON.stringify(resources).includes('DO NOT EXPOSE'));
 await host.action(connection,'start');assert.equal(calls.at(-1).path,'/services/12345/gameservers/games/start');assert.deepEqual(calls.at(-1).body,{game:'arksa'});assert.equal(calls.at(-1).options.form,true);
 status='started';await assert.rejects(host.action(connection,'start'),/stopped/);await host.action(connection,'restart');assert.equal(calls.at(-1).path,'/services/12345/gameservers/restart');await host.action(connection,'stop');assert.equal(calls.at(-1).path,'/services/12345/gameservers/stop');
 assert.throws(()=>host.action(connection,'backup'),/does not support/);assert.throws(()=>host.readFile(connection,'secrets.ini'),/configuration deployment/);assert.equal(hostingCapabilities('nitrado').uptime,false);
 await assert.rejects(host.resources({...connection,origin:'https://attacker.example'}),/Nitrado API origin/);
});
test('Pelican uses the shared client contract and provider changes cannot bypass schema validation',async()=>{
 const calls=[],host=createHostingAdapter(async(origin,path,key,method,body)=>{calls.push({path,method,body});return path.endsWith('/resources')?{attributes:{current_state:'running',resources:{cpu_absolute:3,memory_bytes:4,disk_bytes:5,uptime:6}}}:{};}),c={provider:'pelican',origin:'https://panel.example.com',remote_id:'abcdefgh',key:'pacc_fixture'};
 assert.equal((await host.resources(c)).state,'running');await host.action(c,'restart');assert.deepEqual(calls.at(-1),{path:'/api/client/servers/abcdefgh/power',method:'POST',body:{signal:'restart'}});
 assert.equal(hostingSchema.safeParse({provider:'nitrado',origin:'https://panel.example.com',remote_id:'123',api_key:'test'}).success,false);assert.equal(hostingSchema.safeParse({provider:'nitrado',origin:'https://api.nitrado.net',remote_id:'abc',api_key:'test'}).success,false);
});
