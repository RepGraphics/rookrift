import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {once} from 'node:events';
import {a2sInfo,minecraftQuery,parseA2sInfo,cleanServerMetadata} from '../server/server-query.js';
import {metadataFromVariables,metadataFromConfig,createHostingAdapter} from '../server/hosting.js';

async function udp(t,handler){const socket=createSocket('udp4');socket.on('message',(packet,peer)=>handler(packet,data=>socket.send(data,peer.port,peer.address)));socket.bind(0,'127.0.0.1');await once(socket,'listening');t.after(()=>new Promise(resolve=>socket.close(resolve)));return socket.address().port;}
function info(){return Buffer.concat([Buffer.from([255,255,255,255,0x49,17]),Buffer.from('Pilot\0TheIsland\0ark\0ARK\0'),Buffer.from([0,0,1,70,0,100,108,0,1]),Buffer.from('1.0\0')]);}
test('A2S info handles a challenge and reordered duplicate split replies on the pinned peer',async t=>{
 let packets=0;const response=info(),port=await udp(t,(packet,send)=>{packets++;if(packets===1)send(Buffer.from([255,255,255,255,0x41,1,2,3,4]));else{assert.deepEqual(packet.subarray(-4),Buffer.from([1,2,3,4]));const chunk=(index,data)=>{const header=Buffer.alloc(12);header.writeInt32LE(-2);header.writeUInt32LE(5,4);header[8]=2;header[9]=index;header.writeUInt16LE(1400,10);return Buffer.concat([header,data]);};send(chunk(1,response.subarray(18)));send(chunk(1,response.subarray(18)));send(chunk(0,response.subarray(0,18)));}});
 assert.deepEqual(await a2sInfo({host:'validated.example',port,resolve:async host=>{assert.equal(host,'validated.example');return'127.0.0.1';}}),{map:'TheIsland',max_players:70});assert.equal(packets,2);
});
test('A2S rejects truncated/compressed responses and times out without inventing metadata',async t=>{
 assert.throws(()=>parseA2sInfo(info().subarray(0,20)),/Invalid|Truncated/);
 const port=await udp(t,(_packet,send)=>{const response=Buffer.alloc(12);response.writeInt32LE(-2);response.writeUInt32LE(0x80000001,4);response[8]=1;send(response);});await assert.rejects(a2sInfo({host:'127.0.0.1',port,resolve:async host=>host}),/Compressed/);
 const silent=await udp(t,()=>{});await assert.rejects(a2sInfo({host:'127.0.0.1',port:silent,timeout:60,resolve:async host=>host}),/timed out/);
 await assert.rejects(a2sInfo({host:'127.0.0.1',port:0}),/valid query port/);
});
test('Minecraft Query binds the challenge to its session and extracts only map/capacity',async t=>{
 let requests=0;const port=await udp(t,(packet,send)=>{requests++;const session=packet.subarray(3,7);if(packet[2]===9){send(Buffer.concat([Buffer.from([9]),session,Buffer.from('12345\0')]));}else{assert.equal(packet.readInt32BE(7),12345);send(Buffer.concat([Buffer.from([0]),session,Buffer.from('splitnum\0\x80\0','binary'),Buffer.from(['hostname','Pilot','map','test-world','maxplayers','4','secret','DO NOT EXPOSE','',''].join('\0'),'binary')]));}});
 assert.deepEqual(await minecraftQuery({host:'127.0.0.1',port,resolve:async host=>host}),{map:'test-world',max_players:4});assert.equal(requests,2);
});
test('hosting metadata extracts allowlisted settings and never returns credentials or paths',async()=>{
 assert.deepEqual(metadataFromVariables([{attributes:{env_variable:'MAX_PLAYERS',server_value:'4'}},{attributes:{env_variable:'SERVER_MAP',server_value:'TheIsland_WP'}},{attributes:{env_variable:'STEAM_PASS',server_value:'DO NOT EXPOSE'}}]),{map:'TheIsland_WP',max_players:4});
 assert.deepEqual(metadataFromConfig('minecraft','rcon.password=DO NOT EXPOSE\nlevel-name=My\\ World\nmax-players=4\n'),{map:'My World',max_players:4});
 assert.deepEqual(metadataFromConfig('dayz','// maxPlayers=99;\nmaxPlayers=4; class Missions { class DayZ { template="dayzOffline.chernarusplus"; }; }; password="DO NOT EXPOSE";'),{map:'chernarusplus',max_players:4});
 assert.deepEqual(cleanServerMetadata({map:'bad\nvalue',max_players:0,password:'DO NOT EXPOSE'}),{});
 assert.deepEqual(cleanServerMetadata({max_players:true,query_port:true}),{});
 const host=createHostingAdapter(async()=>({status:'success',data:{gameserver:{status:'started',service_id:123,query:{map:'TheIsland_WP',player_max:70},query_port:27015,credentials:{password:'DO NOT EXPOSE'}}}}));
 assert.deepEqual(await host.metadata({provider:'nitrado',origin:'https://api.nitrado.net',remote_id:'123',key:'fixture'},'asa'),{map:'TheIsland_WP',max_players:70,query_port:27015,sources:{map:'nitrado-query',max_players:'nitrado-query'}});
});
