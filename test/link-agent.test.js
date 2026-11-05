import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('log bridge tails new complete lines and retries transient failures without replaying old log history',{timeout:10000},async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'rookrift-link-agent-')),file=path.join(dir,'server.log'),events=[];
 await writeFile(file,'Old Player: /link RR-AAAAAAAAAAAAAAAA\n');let complete;const received=new Promise(r=>{complete=r;});
 const http=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;events.push(JSON.parse(raw));assert.equal(req.headers.authorization,'Bearer agent-test-token');res.writeHead(events.length===1?503:200);res.end('{}');if(events.length===2)complete();});http.listen(0,'127.0.0.1');await once(http,'listening');
 const child=spawn(process.execPath,['scripts/link-agent.mjs'],{cwd:process.cwd(),env:{...process.env,LINK_LOG_PATH:file,ROOKRIFT_LINK_ENDPOINT:'http://127.0.0.1:'+http.address().port,ROOKRIFT_LINK_TOKEN:'agent-test-token',ROOKRIFT_SERVER_ID:'00000000-0000-4000-8000-000000000000'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill('SIGTERM');await once(child,'exit').catch(()=>{});http.closeAllConnections();await new Promise(r=>http.close(r));assert.equal(path.dirname(dir),tmpdir());assert.match(path.basename(dir),/^rookrift-link-agent-/);await rm(dir,{recursive:true,force:true});});
 await once(child.stdout,'data');await appendFile(file,'Current Player: /link RR-BBBBBBBBBBBBBBBB');
 await appendFile(file,'\n');await Promise.race([received,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(new Error('Log bridge did not retry the queued line.')),6000);timeout.unref();})]);assert.equal(events.length,2);assert.ok(events.every(e=>e.message==='Current Player: /link RR-BBBBBBBBBBBBBBBB'));assert.equal(events[0].server_id,'00000000-0000-4000-8000-000000000000');
});
