import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {battleyePacket,battleyeCrc,battleyeRcon} from '../server/battleye-rcon.js';
import {minecraftPlayers,battleyePlayers} from '../server/game-players.js';
import {commandFor,runRcon} from '../server/games.js';
import {createVault} from '../server/crypto.js';
import {onlineRecipient} from '../shared/online-recipient.js';
import {renderPurchaseCommand} from '../shared/store-delivery.js';
const guid='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const allowLoopback=t=>{const old=process.env.ALLOW_PRIVATE_RCON;process.env.ALLOW_PRIVATE_RCON='true';t.after(()=>{if(old===undefined)delete process.env.ALLOW_PRIVATE_RCON;else process.env.ALLOW_PRIVATE_RCON=old;});};
async function udp(t,handler){const socket=createSocket('udp4');socket.on('message',(packet,peer)=>handler(packet.subarray(7),body=>socket.send(battleyePacket(body),peer.port,peer.address),packet,peer,socket));socket.bind(0,'127.0.0.1');await once(socket,'listening');t.after(()=>new Promise(resolve=>socket.close(resolve)));return socket.address().port;}
test('BattlEye CRC uses the protocol checksum and multipart UDP replies tolerate ordering and duplicate fragments',async t=>{
 assert.equal(battleyeCrc(Buffer.from('123456789')),0xcbf43926);let commands=0,ack=false;
 const port=await udp(t,(body,send,packet,peer,socket)=>{if(body[0]===0)send(Buffer.from([0,1]));else if(body[0]===1&&body.subarray(2).toString()==='players'){commands++;send(Buffer.from([2,9]));}else if(body[0]===2&&body[1]===9){ack=true;send(Buffer.concat([Buffer.from([1,0,0,2,1]),Buffer.from('world')]));send(Buffer.concat([Buffer.from([1,0,0,2,1]),Buffer.from('world')]));const bad=battleyePacket(Buffer.concat([Buffer.from([1,0,0,2,0]),Buffer.from('CORRUPT')]));bad[2]^=1;socket.send(bad,peer.port,peer.address);send(Buffer.concat([Buffer.from([1,0,0,2,0]),Buffer.from('hello ')]));}});
 assert.equal(await battleyeRcon({host:'127.0.0.1',port,password:'fixture',command:'players'}),'hello world');assert.equal(commands,1);assert.equal(ack,true);
});
test('BattlEye rejects bad credentials and never retries a command whose response was lost',async t=>{
 const denied=await udp(t,(body,send)=>{if(body[0]===0)send(Buffer.from([0,0]));});await assert.rejects(battleyeRcon({host:'127.0.0.1',port:denied,password:'wrong',command:'players'}),/authentication failed/);
 let commands=0;const silent=await udp(t,(body,send)=>{if(body[0]===0)send(Buffer.from([0,1]));else if(body[0]===1&&body.subarray(2).toString()==='say -1 reward')commands++;});await assert.rejects(battleyeRcon({host:'127.0.0.1',port:silent,password:'fixture',command:'say -1 reward',timeout:150}),/timed out/);assert.equal(commands,1);
});
test('Minecraft and DayZ player parsers retain game identities and omit BattlEye network addresses',()=>{
 assert.deepEqual(minecraftPlayers('There are 2 of a max of 20 players online: Steve, Player_2'),['Steve, Steve','Player_2, Player_2']);assert.deepEqual(minecraftPlayers('There are 0 of a max of 20 players online: '),[]);assert.throws(()=>minecraftPlayers('Plugin-specific unknown output'),/format is unsupported/);
 const data='Players on server:\n0 198.51.100.2:2304 21 '+guid+'(OK) Survivor One\n(1 players in total)';assert.deepEqual(battleyePlayers(data),['Survivor One, '+guid]);assert.deepEqual(battleyePlayers('(0 players in total)'),[]);assert.throws(()=>battleyePlayers('(1 players in total)'),/format is unsupported/);
});
test('game commands and online delivery checks use capabilities and never guess character IDs from account IDs',()=>{
 assert.equal(commandFor('save','','minecraft'),'save-all flush');assert.equal(commandFor('broadcast','Welcome','minecraft'),'say Welcome');assert.equal(commandFor('unban','Steve','minecraft'),'pardon Steve');assert.equal(commandFor('ban',guid,'dayz'),'addBan '+guid+' 0');assert.equal(commandFor('broadcast','Welcome','dayz'),'say -1 Welcome');for(const action of ['save','kick','unban','chat'])assert.throws(()=>commandFor(action,'Steve','dayz'),/does not support/);assert.throws(()=>commandFor('ban','@a','minecraft'),/exact Minecraft/);
 assert.equal(onlineRecipient('minecraft','minecraft','steve',['Steve, Steve']),true);assert.equal(onlineRecipient('dayz','battleye',guid,['Survivor, '+guid]),true);assert.equal(onlineRecipient('asa','numeric','123456',['Survivor, '+guid]),false);assert.equal(onlineRecipient('minecraft','minecraft','Other',['Steve, Steve']),false);
});
test('Minecraft purchase templates preserve literal command data while rejecting unknown placeholders and separators',()=>{
 const template='tellraw {identifier} {"text":"Thanks for supporting our server","color":"green"}';
 assert.equal(renderPurchaseCommand(template,'Steve','minecraft','order'),template.replace('{identifier}','Steve'));
 assert.equal(renderPurchaseCommand('give {identifier} minecraft:stone 1','Player_2','minecraft','order'),'give Player_2 minecraft:stone 1');
 assert.throws(()=>renderPurchaseCommand('give {identifier} {unknown} 1','Steve','minecraft','order'),/only/);
 assert.throws(()=>renderPurchaseCommand('give {identifier} stone 1; op Steve','Steve','minecraft','order'),/separators/);
 assert.throws(()=>renderPurchaseCommand('give {identifier} stone 1','@a','minecraft','order'),/valid Minecraft/);
 assert.throws(()=>commandFor('purchase','say -1 welcome \u00e9','dayz'),/ASCII/);
});
test('Minecraft monitoring uses the Source TCP transport with encrypted credentials and a native player response',async t=>{
 allowLoopback(t);const sockets=new Set(),commands=[];
 function packet(id,type,text){const body=Buffer.from(text),buffer=Buffer.alloc(body.length+14);buffer.writeInt32LE(body.length+10);buffer.writeInt32LE(id,4);buffer.writeInt32LE(type,8);body.copy(buffer,12);return buffer;}
 const server=createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));let pending=Buffer.alloc(0);socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=4){const length=pending.readInt32LE(0);if(pending.length<length+4)return;const next=pending.subarray(0,length+4);pending=pending.subarray(length+4);const id=next.readInt32LE(4),type=next.readInt32LE(8),text=next.subarray(12,-2).toString();if(type===3){assert.equal(text,'fixture');socket.write(packet(id,2,''));}else{commands.push(text);socket.write(packet(id,0,text?'There are 1 of a max of 20 players online: Steve':''));}}});});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{for(const s of sockets)s.destroy();server.close(resolve);}));
 const vault=createVault('01'.repeat(32)),result=await runRcon({game:'minecraft',host:'127.0.0.1',port:server.address().port,password:vault.encrypt('fixture')},vault,'status');assert.deepEqual(result.players,['Steve, Steve']);assert.equal(commands[0],'list');
});
test('DayZ monitoring routes to UDP and returns canonical players without exposing BattlEye IP addresses',async t=>{
 allowLoopback(t);const port=await udp(t,(body,send)=>{if(body[0]===0)send(Buffer.from([0,1]));else if(body[0]===1&&body.subarray(2).toString()==='players')send(Buffer.concat([Buffer.from([1,0]),Buffer.from('Players on server:\n0 198.51.100.2:2304 21 '+guid+'(OK) Survivor\n(1 players in total)')]));});const vault=createVault('02'.repeat(32)),result=await runRcon({game:'dayz',host:'127.0.0.1',port,password:vault.encrypt('fixture')},vault,'status');assert.deepEqual(result.players,['Survivor, '+guid]);assert.ok(!result.output.includes('198.51.100.2'));
});
