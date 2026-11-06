import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import nodemailer from 'nodemailer';
import {smtpErrorMessage,smtpTransportOptions} from '../server/email.js';

test('required STARTTLS reports the provider rejection and explicit compatibility can verify without sending a message',async t=>{
 const commands=[],sockets=new Set(),server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 fixture SMTP\r\n');let pending='';socket.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+2);commands.push(line.split(' ')[0]);if(line.startsWith('EHLO'))socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');else if(line==='STARTTLS')socket.write('502 5.5.1 STARTTLS not implemented\r\n');else if(line.startsWith('AUTH PLAIN '))socket.write('235 2.7.0 Authenticated\r\n');else if(line==='QUIT')socket.end('221 Bye\r\n');else socket.write('502 Not implemented\r\n');}});});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(resolve);}));
 const settings={host:'127.0.0.1',port:server.address().port,username:'fixture',password:'fixture',security:'starttls'};
 const required=nodemailer.createTransport(smtpTransportOptions(settings,{verification:true}));try{await assert.rejects(required.verify(),error=>{assert.equal(error.code,'ETLS');assert.equal(error.command,'STARTTLS');assert.equal(error.responseCode,502);assert.match(smtpErrorMessage(error),/rejected STARTTLS before login/);return true;});}finally{required.close();}
 assert.ok(!commands.includes('AUTH'));const compatible=nodemailer.createTransport(smtpTransportOptions({...settings,security:'auto'},{verification:true}));try{assert.equal(await compatible.verify(),true);}finally{compatible.close();}
 assert.ok(commands.includes('AUTH'));assert.ok(!commands.includes('MAIL'));assert.ok(!commands.includes('RCPT'));assert.ok(!commands.includes('DATA'));
});
test('SMTP diagnostics expose safe stages/codes while omitting raw server replies, passwords and recipients',()=>{
 const error={code:'EAUTH',command:'AUTH PLAIN PRIVATE-ENCODED-DATA',responseCode:535,response:'username@example.test PRIVATE PASSWORD',message:'PRIVATE PASSWORD'};const message=smtpErrorMessage(error);assert.match(message,/authentication failed/);assert.match(message,/EAUTH \/ AUTH \/ SMTP 535/);assert.ok(!/PRIVATE|example\.test/.test(message));
 assert.match(smtpErrorMessage({code:'ESOCKET',originalCode:'ERR_TLS_CERT_ALTNAME_INVALID'}),/certificate verification failed/);
 assert.match(smtpErrorMessage({code:'EENVELOPE',command:'MAIL FROM:private@example.test',responseCode:550}),/rejected the sender/);
 assert.equal(smtpTransportOptions({security:'unknown'}).requireTLS,true);assert.equal(smtpTransportOptions({security:'tls'}).tls.rejectUnauthorized,true);
});
