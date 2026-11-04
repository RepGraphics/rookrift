import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {Pool} from 'pg';
const exec=promisify(execFile),owned=[];
async function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit',env});child.on('error',reject);child.on('exit',code=>resolve(code??1));});}
async function container(image,envArgs){const name=`rookrift-test-${randomUUID()}`;const{stdout}=await exec('docker',['run','-d','--rm','--name',name,...envArgs,image],{env:{...process.env,POSTGRES_PASSWORD:password}});owned.push(stdout.trim());const info=JSON.parse((await exec('docker',['inspect',name])).stdout)[0];return Object.values(info.NetworkSettings.Ports).flat()[0].HostPort;}
const password=randomBytes(24).toString('hex');let code=1;
try{
  const env={...process.env,NODE_ENV:'test'};
  if(!env.TEST_DATABASE_URL){console.log('Starting isolated PostgreSQL and Redis test services…');const pgPort=await container('postgres:18-alpine',['-e','POSTGRES_PASSWORD','-e','POSTGRES_USER=rookrift','-e','POSTGRES_DB=rookrift_test','-p','127.0.0.1::5432']);env.TEST_DATABASE_URL=`postgresql://rookrift:${password}@127.0.0.1:${pgPort}/rookrift_test`;const redisPort=await container('redis:8-alpine',['-p','127.0.0.1::6379']);env.TEST_REDIS_URL=`redis://127.0.0.1:${redisPort}`;}
  const pool=new Pool({connectionString:env.TEST_DATABASE_URL,connectionTimeoutMillis:1000});let ready=false;
  for(let n=0;n<80;n++){try{await pool.query('SELECT 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}await pool.end();if(!ready)throw new Error('PostgreSQL test service did not become ready.');
  const files=(await readdir('test')).filter(f=>f.endsWith('.test.js')).map(f=>'test/'+f);code=await run(process.execPath,['--test','--test-concurrency=4',...files],env);
}catch{console.error('Could not run PostgreSQL tests. Start Docker, or configure TEST_DATABASE_URL and TEST_REDIS_URL.');code=1;}
finally{for(const id of owned)await exec('docker',['rm','-f',id]).catch(()=>{});}
process.exitCode=code;
