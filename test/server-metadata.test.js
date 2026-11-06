import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openDatabase} from '../server/db.js';
import {createVault} from '../server/crypto.js';
import {createService} from '../server/service.js';
import {createMetadataDiscovery} from '../server/server-metadata.js';
import {authorizeRequest} from '../server/access.js';
const input={name:'Pilot',game:'ase',host:'8.8.8.8',port:27020,password:'fixture',metadata_auto:true};
async function fixture(t,metadata){const db=await openDatabase(':memory:'),vault=createVault(randomBytes(32).toString('hex'));await db.prepare("INSERT INTO users(id,name,access_token) VALUES('u','Owner','')").run();for(const id of ['w','other'])await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,1)').run(id,'u');const service=createService(db,vault,async()=>({output:'OK',players:[],latency:1,metadata:{max_players:4}}),{metadata});t.after(()=>db.close());return{db,vault,service};}
test('automatic details start unknown, persist provenance, cache refreshes, preserve last known values and respect manual overrides',async t=>{
 let calls=0,fail=false;const f=await fixture(t,async()=>{calls++;if(fail)throw new Error('DO NOT EXPOSE');return{map:'TheIsland',max_players:70,sources:{map:'a2s',max_players:'a2s'}};});const created=await f.service.addServer('w',input);assert.equal(created.max_players,null);assert.equal(created.map,'');assert.equal(created.metadata_auto,true);
 let server=await f.service.refreshMetadata('w',created.id,{force:true});assert.equal(server.map,'TheIsland');assert.equal(server.max_players,70);assert.equal(server.detected_metadata.map_source,'a2s');await f.service.refreshMetadata('w',created.id,{force:true});assert.equal(calls,1);
 await f.service.updateServer('w',created.id,{metadata_auto:false,map:'My map',max_players:12});await f.db.prepare("UPDATE servers SET detected_metadata=detected_metadata-'checked_at' WHERE id=?").run(created.id);await f.service.refreshMetadata('w',created.id,{force:true});server=await f.service.getServer('w',created.id);assert.equal(server.map,'My map');assert.equal(server.max_players,12);assert.equal(server.detected_metadata.max_players,70);
 await f.service.updateServer('w',created.id,{metadata_auto:true});fail=true;await f.db.prepare("UPDATE servers SET detected_metadata=detected_metadata-'checked_at' WHERE id=?").run(created.id);server=await f.service.refreshMetadata('w',created.id,{force:true});assert.equal(server.map,'TheIsland');assert.equal(server.max_players,70);assert.equal(server.detected_metadata.status,'unavailable');assert.ok(!JSON.stringify(server).includes('DO NOT EXPOSE'));
 await assert.rejects(f.service.refreshMetadata('other',created.id,{force:true}),/not found/);
});
test('a slow discovery cannot apply results after the connection or metadata settings change',async t=>{
 let release,start;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{start=resolve;});const f=await fixture(t,async()=>{start();await gate;return{map:'Wrong target',max_players:99};}),server=await f.service.addServer('w',input);const pending=f.service.refreshMetadata('w',server.id,{force:true});await started;await f.service.updateServer('w',server.id,{host:'8.8.4.4'});release();await pending;const current=await f.service.getServer('w',server.id);assert.equal(current.map,'');assert.equal(current.max_players,null);assert.deepEqual(current.detected_metadata,{});
});
test('Minecraft monitoring updates capacity without a query port while metadata failures leave RCON monitoring online',async t=>{
 const f=await fixture(t,async()=>{throw new Error('Unreachable query');}),server=await f.service.addServer('w',{...input,game:'minecraft',port:25575});await f.service.action('w',server.id,'status');let current=await f.service.getServer('w',server.id);assert.equal(current.max_players,4);await f.service.refreshMetadata('w',server.id,{force:true});current=await f.service.getServer('w',server.id);assert.equal(current.status,'online');assert.equal(current.max_players,4);assert.equal(current.detected_metadata.max_players_source,'minecraft-rcon');
});
test('provider/native metadata is merged with native RCON capacity and admin refreshes respect server scope',async t=>{
 const f=await fixture(t,async()=>({})),server=await f.service.addServer('w',{...input,game:'minecraft'});await f.db.prepare('INSERT INTO hosting_connections VALUES(?,?,?,?,?,?,?)').run(server.id,'w','pterodactyl','https://panel.example.test','abcdefgh',f.vault.encrypt('secret'),1);
 const discover=createMetadataDiscovery(f.db,f.vault,{hosting:{metadata:async()=>({map:'configured-world',max_players:30,query_port:25565,sources:{map:'pterodactyl-file',max_players:'pterodactyl-file'}})},minecraft:async()=>({map:'live-world',max_players:20}),rcon:async()=>({metadata:{max_players:4}})});const metadata=await discover(await f.service.getServer('w',server.id));assert.equal(metadata.map,'live-world');assert.equal(metadata.max_players,4);assert.equal(metadata.sources.map,'minecraft-query');assert.equal(metadata.sources.max_players,'minecraft-rcon');
 for(const role of ['viewer','moderator'])await assert.rejects(authorizeRequest(f.db,{path:'/servers/'+server.id+'/discovery',method:'POST',workspace:{id:'w'},access:{role,server_ids:null},body:{}}),/role/);
 await authorizeRequest(f.db,{path:'/servers/'+server.id+'/discovery',method:'POST',workspace:{id:'w'},access:{role:'admin',server_ids:[server.id]},body:{}});
 await assert.rejects(authorizeRequest(f.db,{path:'/servers/'+server.id+'/discovery',method:'POST',workspace:{id:'w'},access:{role:'admin',server_ids:[]},body:{}}),/not found/);
});
