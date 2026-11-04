import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const exec=promisify(execFile),suffix=randomUUID(),network=`rookrift-smoke-${suffix}`,containers=[];
const image=process.argv.includes('--skip-build')?'rookrift:postgres-redis':'rookrift:production-smoke';
const password=randomBytes(24).toString('hex'),pgName=`rookrift-pg-${suffix}`,redisName=`rookrift-redis-${suffix}`;
const env={...process.env,POSTGRES_PASSWORD:password,REDIS_PASSWORD:password,DATABASE_URL:`postgresql://rookrift:${password}@${pgName}:5432/rookrift`,REDIS_URL:`redis://:${password}@${redisName}:6379/0`,ENCRYPTION_KEY:randomBytes(32).toString('hex'),APP_URL:'https://rookrift-smoke.invalid',NODE_ENV:'production'};
const docker=async args=>(await exec('docker',args,{env,timeout:60000,maxBuffer:1024*1024})).stdout.trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(args){const id=await docker(['run','-d','--network',network,...args]);containers.push(id);return id;}
async function build(){const code=await new Promise((resolve,reject)=>{const child=spawn('docker',['build','-t',image,'.'],{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});if(code!==0)throw new Error('Docker build failed.');}
let madeNetwork=false;
try{
  if(!process.argv.includes('--skip-build'))await build();
  await docker(['network','create',network]);madeNetwork=true;
  const pg=await run(['--name',pgName,'-e','POSTGRES_PASSWORD','-e','POSTGRES_USER=rookrift','-e','POSTGRES_DB=rookrift','postgres:18-alpine']);
  const redis=await run(['--name',redisName,'-e','REDIS_PASSWORD','redis:8-alpine','/bin/sh','-c','exec redis-server --requirepass "$REDIS_PASSWORD" --save "" --appendonly no']);
  let ready=false;for(let n=0;n<100;n++){try{await docker(['exec',pg,'pg_isready','-U','rookrift','-d','rookrift']);ready=true;break;}catch{await sleep(200);}}assert.ok(ready,'PostgreSQL readiness');
  const settings=['-e','DATABASE_URL','-e','REDIS_URL','-e','ENCRYPTION_KEY','-e','APP_URL','-e','NODE_ENV'];
  const app=await run(['-p','127.0.0.1::3000',...settings,image]);const info=JSON.parse(await docker(['inspect',app]))[0],port=info.NetworkSettings.Ports['3000/tcp'][0].HostPort,base=`http://127.0.0.1:${port}`;
  async function waitForCache(status){for(let n=0;n<100;n++){try{const r=await fetch(base+'/api/ready',{signal:AbortSignal.timeout(1000)}),body=await r.json();if(r.status===200&&body.database==='postgres'&&body.cache===status)return;}catch{}await sleep(150);}throw new Error('Production readiness/cache status did not settle.');}
  await waitForCache('ready');assert.equal((await fetch(base)).status,200);assert.equal((await fetch(base+'/api/bootstrap')).status,401);
  const second=await run([...settings,image]);assert.equal(await docker(['wait',second]),'1','Duplicate runtime should stop instead of starting another scheduler.');
  assert.equal(await docker(['run','--rm','--network',network,...settings,'--entrypoint','node',image,'scripts/database.mjs','migrate']),'PostgreSQL schema is up to date.');
  await docker(['stop',redis]);await waitForCache('degraded');assert.equal((await fetch(base+'/api/health')).status,200);
  console.log('Production Docker smoke passed: PostgreSQL migrations, authenticated Redis, readiness, duplicate-runtime rejection, packaged migration CLI and Redis outage fallback.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{for(const id of containers.reverse())await docker(['rm','-f','-v',id]).catch(()=>{});if(madeNetwork)await docker(['network','rm',network]).catch(()=>{});}
