import {chatLinkRecord} from '../shared/ark-chat-link.js';

export function createLinkMonitor(db,operations,members,{intervalMs=3000,autoStart=true}={}){
  const streams=new Map(),states=new Map(),queues=new Map(),seen=new Map(),retryAfter=new Map();
  let stopped=false,running=false,inFlight=Promise.resolve(),timer;
  const state=id=>{if(!states.has(id))states.set(id,{rcon:'idle',console:'idle',checked_at:null,last_linked_at:null,message:'Waiting for a member to request a link code.'});return states.get(id);};
  function closeStream(id){const entry=streams.get(id);streams.delete(id);entry?.close?.();}
  function queue(id,line){if(!chatLinkRecord(line))return;const key=id+'\0'+line;if((seen.get(key)||0)>Date.now()-30000)return;seen.set(key,Date.now());const items=queues.get(id)||[];if(items.length<30)items.push({line,expires:Date.now()+20000});queues.set(id,items);}
  async function connect(row){
    const s=state(row.server_id);if(!['pterodactyl','pelican'].includes(row.provider)){s.console='unavailable';return;}
    if(streams.has(row.server_id)||(retryAfter.get(row.server_id)||0)>Date.now())return;
    const entry={close:null};streams.set(row.server_id,entry);s.console='connecting';
    try{
      // Console text is a wake-up signal only. Identity proof comes from native
      // GetChat or an authenticated controller event, never arbitrary log text.
      entry.close=await operations.hostingConsole(row.server_id,line=>{if(/\/link\s+RR-/i.test(line))s.console_seen_at=Date.now();},()=>{if(streams.get(row.server_id)===entry){streams.delete(row.server_id);s.console='disconnected';retryAfter.set(row.server_id,Date.now()+15000);}});
      if(stopped||streams.get(row.server_id)!==entry){entry.close();return;}s.console='connected';
    }catch{if(streams.get(row.server_id)===entry)streams.delete(row.server_id);s.console='unavailable';retryAfter.set(row.server_id,Date.now()+30000);}
  }
  async function poll(row){
    const id=row.server_id,s=state(id);s.checked_at=Date.now();
    try{
      const result=await operations.serverChat(id),output=result?.output||'';
      if(/unknown command|command not recognized|unrecognized command/i.test(output)){s.rcon='unsupported';s.message='GetChat is unavailable. Use a server extension with controller-based link events.';return;}
      s.rcon='connected';s.message='Listening for /link in global game chat.';
      for(const line of output.split(/\r?\n/))queue(id,line);
    }catch(error){s.rcon=error.code==='SERVER_BUSY'?'waiting':'unavailable';s.message=error.code==='SERVER_BUSY'?'Waiting for another server action to finish.':'Cannot read game chat. Check the RCON connection and server status.';}
    const items=queues.get(id)||[];
    while(items.length){
      const item=items[0];if(item.expires<Date.now()){items.shift();continue;}
      try{const outcome=await members.ingestServerChat(id,item.line);items.shift();if(outcome.linked){s.last_linked_at=Date.now();s.message='A member game account was linked successfully.';}else if(outcome.reason==='sender_unmatched')s.message='The chat sender did not match one unique connected account. Ask the player to use a unique account name and retry.';}
      catch(error){if(error.code==='SERVER_BUSY')break;items.shift();s.message=error.status===409?'A link needs review. The game account may already belong to another member.':'Player verification failed. Check the server connection and request a new code.';}
    }
  }
  async function cycle(){
    const rows=await db.prepare('SELECT DISTINCT s.id AS server_id,h.provider FROM servers s LEFT JOIN hosting_connections h ON h.server_id=s.id JOIN community_link_codes c ON c.server_id=s.id WHERE c.used_at IS NULL AND c.expires_at>?').all(Date.now()),ids=new Set(rows.map(r=>r.server_id));
    for(const id of streams.keys())if(!ids.has(id))closeStream(id);
    for(const [id,s]of states)if(!ids.has(id)){s.rcon='idle';s.console='idle';if(!s.last_linked_at)s.message='Waiting for a member to request a link code.';queues.delete(id);}
    for(const row of rows)void connect(row);
    for(let start=0;start<rows.length&&!stopped;start+=4)await Promise.all(rows.slice(start,start+4).map(poll));
    for(const [key,time]of seen)if(time<Date.now()-60000)seen.delete(key);
  }
  const api={
    status(id){return{...state(id)};},
    async tick(){if(stopped||running)return;running=true;inFlight=cycle();try{await inFlight;}finally{running=false;}},
    async stop(){stopped=true;clearInterval(timer);for(const id of streams.keys())closeStream(id);await inFlight;}
  };
  if(autoStart){void api.tick().catch(()=>{});timer=setInterval(()=>void api.tick().catch(()=>console.error('Account-link monitoring cycle failed.')),intervalMs);}
  return api;
}
