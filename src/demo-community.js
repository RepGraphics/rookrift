export function ensureDemoCommunity(data){
  const now=Date.now();
  data.community??={site:{slug:'the-outpost',title:data.workspace.name,summary:'A welcoming home for ARK survivors. Build, explore and find your next tribe.',rules:'Respect other survivors and staff.\nNo cheating, exploiting or harassment.\nKeep trading fair and follow each map’s PvE or PvP rules.',discord_url:'',enabled:true,applications_open:true,questions:['Tell us about your ARK experience.','What are you looking for in a community?'],server_ids:data.servers.slice(0,2).map(s=>s.id),updated_at:now},posts:[{id:'news-welcome',title:'A new season at The Outpost',body:'Our new season is open. Explore the maps, meet your neighbours and join us for the weekend community event.',published:1,created_at:now-86400000,updated_at:now-86400000}],events:[{id:'event-weekend',title:'Weekend explorer meetup',body:'Meet at the community hub for a relaxed map tour. New survivors and returning players are welcome.',starts_at:now+2*86400000,ends_at:now+2*86400000+7200000,capacity:20,cancelled:0,created_at:now,updated_at:now}],applications:[{id:'application-sample',user_id:'demo-survivor',applicant:'RiverScout',kind:'join',game:'asa',identifier:'DEMO-EOS-002',answers:JSON.stringify([{question:'Tell us about your ARK experience.',answer:'I enjoy building and exploring with friends.'},{question:'What are you looking for in a community?',answer:'A friendly PvE cluster with weekend events.'}]),status:'pending',decision_message:'',created_at:now-3600000}],rsvps:[]};
  return data.community;
}
export function demoCommunityRequest(data,path,method='GET',body){
  const c=ensureDemoCommunity(data),now=Date.now(),id=()=>crypto.randomUUID(),user=data.user;
  const events=()=>c.events.map(e=>({...e,attendees:c.rsvps.filter(r=>r.event_id===e.id).length,attending:c.rsvps.some(r=>r.event_id===e.id&&r.user_id===user.id)}));
  if(path==='/community')return{site:c.site,posts:c.posts,events:events()};
  if(path.startsWith('/community/applications')&&method==='GET'){const status=new URLSearchParams(path.split('?')[1]).get('status')||'pending';return c.applications.filter(a=>status==='all'||a.status===status);}
  if(path==='/community/site'){Object.assign(c.site,body,{updated_at:now});return c.site;}
  let match=path.match(/^\/community\/(posts|events)(?:\/([^/]+))?$/);
  if(match){const list=c[match[1]],old=list.find(x=>x.id===match[2]);if(method==='DELETE'){c[match[1]]=list.filter(x=>x.id!==match[2]);return{ok:true};}if(old)Object.assign(old,body,{updated_at:now});else list.unshift({...body,id:id(),created_at:now,updated_at:now});return old||list[0];}
  match=path.match(/^\/community\/applications\/([^/]+)$/);if(match){const row=c.applications.find(x=>x.id===match[1]);if(method==='DELETE'){if(!row||row.status==='pending')throw new Error('Review or withdraw the application first.');c.applications=c.applications.filter(x=>x.id!==row.id);return{ok:true};}if(!row||row.status!=='pending')throw new Error('This application is no longer pending.');Object.assign(row,body,{reviewed_at:now});return{ok:true};}
  match=path.match(/^\/public\/communities\/([^/]+)(.*)$/);
  if(!match||match[1]!==c.site.slug||!c.site.enabled)throw new Error('Community page not found.');
  if(!match[2])return{site:{...c.site,form_revision:c.site.updated_at},posts:c.posts.filter(p=>p.published),events:events(),servers:data.servers.filter(s=>c.site.server_ids.includes(s.id)).slice(0,data.plans.find(p=>p.id===data.workspace.plan).servers).map(s=>({id:s.id,name:s.name,map:s.map,game:s.game,cluster:s.cluster,players:s.players,max_players:s.max_players,status:s.maintenance?'maintenance':s.status,checked_at:s.last_checked})),viewer:{id:user.id,name:user.name,csrf:'demo'},applications:c.applications.filter(a=>a.user_id===user.id)};
  if(match[2]==='/applications'){
    if(body.rules_accepted!==true)throw new Error('Acknowledge the community rules first.');
    if(!c.site.applications_open)throw new Error('Applications are currently closed.');
    if(body.form_revision!==c.site.updated_at)throw new Error('The form has changed. Refresh the community page.');
    if(c.applications.some(a=>a.user_id===user.id&&a.kind===body.kind&&a.status==='pending'))throw new Error('You already have a pending application of this type.');
    const row={...body,id:id(),user_id:user.id,applicant:user.name,status:'pending',decision_message:'',answers:JSON.stringify(c.site.questions.map((question,i)=>({question,answer:body.answers[i]}))),created_at:now};c.applications.unshift(row);return row;
  }
  const withdrawal=match[2].match(/^\/applications\/([^/]+)$/);if(withdrawal){const row=c.applications.find(a=>a.id===withdrawal[1]&&a.user_id===user.id);if(!row||row.status!=='pending')throw new Error('Only your pending applications can be withdrawn.');row.status='withdrawn';return{ok:true};}
  const rsvp=match[2].match(/^\/events\/([^/]+)\/rsvp$/);if(rsvp){const event=c.events.find(e=>e.id===rsvp[1]);if(!event)throw new Error('Event not found.');const existing=c.rsvps.some(r=>r.event_id===event.id&&r.user_id===user.id);if(body.attending){if(existing)return{ok:true};if(event.cancelled||event.starts_at<=now)throw new Error('RSVPs are closed for this event.');if(event.capacity&&c.rsvps.filter(r=>r.event_id===event.id).length>=event.capacity)throw new Error('This event is full.');c.rsvps.push({event_id:event.id,user_id:user.id});}else c.rsvps=c.rsvps.filter(r=>r.event_id!==event.id||r.user_id!==user.id);return{ok:true};}
  throw new Error('Community action unavailable.');
}
