const key='rookrift-admin-demo-v1';
const now=Date.now();
function seed(){return{user:{id:'demo-root',name:'Alex Morgan'},csrf:'demo',settings:{platform_billing_provider:{value:'stripe'}},users:Array.from({length:18},(_,i)=>({id:'demo-user-'+i,name:i===0?'Alex Morgan':['Casey','Jordan','Taylor','Morgan','Sam','Riley'][i%6]+' '+String(i).padStart(2,'0'),email:'player'+i+'@example.test',platform_admin:i===0,suspended:i===8,discord_connected:i%2===0,workspaces:i<4?1:0,active_sessions:i%4,account_created_at:now-i*86400000})),workspaces:['The Outpost','Evolved Frontier','Northwatch'].map((name,i)=>({id:'admin-demo-ws-'+i,name,owner_name:['Alex Morgan','Casey 01','Taylor 02'][i],plan:i===2?'scout':'tribe',subscription_status:i===1?'past_due':i===2?'free':'active',servers:3-i,created_at:now-i*86400000,guild_id:null,alert_channel_id:null,alerts_enabled:false,failure_threshold:2,site:{slug:'admin-demo-'+i,title:name,summary:'A community for survivors and explorers.',rules:'Respect other players.',server_ids:'[]',enabled:1,join_requests_open:1,staff_applications_open:0,join_questions:'["Why would you like to join?"]',staff_questions:'["What would you bring to the team?"]'}})),activity:[],email:{host:'',port:587,security:'starttls',username:'',from:'',name:'Rookrift',reply_to:'',enabled:false,receipts:false,sales:false,billing:false,password_configured:false,configured:false,source:'admin',counts:[],recent:[]}};}
export function demoAdminRequest(path,method='GET',body={}){
 let data;try{data=JSON.parse(localStorage.getItem(key));}catch{}data??=seed();
 const save=()=>localStorage.setItem(key,JSON.stringify(data)),event=(action,target='Platform')=>data.activity.unshift({id:crypto.randomUUID(),action,actor_name:'Alex Morgan',target_name:target,detail:'Simulated in this browser.',created_at:Date.now()});
 let result;
 if(path==='/platform'||path==='/platform/bootstrap')result=data;
 else if(path==='/platform/settings'){for(const [field,value]of Object.entries(body))if(value)data.settings[field]=field==='platform_billing_provider'?{value}:{configured:true};event('Global integration settings updated');result={restart_required:false};}
 else if(path==='/platform/email'&&method==='GET')result=data.email;
 else if(path==='/platform/email'){const {password,clear_password,...fields}=body;Object.assign(data.email,fields);data.email.password_configured=clear_password?false:Boolean(password)||data.email.password_configured;data.email.configured=Boolean(data.email.enabled&&data.email.host&&data.email.from);event('Email delivery settings updated');result={settings:data.email};}
 else if(path==='/platform/email/test')result={message:'Simulated test complete. No email was sent.'};
 else if(path==='/platform/email/retry')result={queued:0};
 else{const workspace=path.match(/^\/platform\/workspaces\/([^/]+)(\/community)?$/),user=path.match(/^\/platform\/users\/([^/]+)\/(suspension|revoke-sessions|impersonate)$/);
  if(workspace){const target=data.workspaces.find(w=>w.id===workspace[1]);if(!target)throw new Error('Demo workspace not found.');if(workspace[2]){Object.assign(target.site,body,{join_questions:JSON.stringify(body.join_questions),staff_questions:JSON.stringify(body.staff_questions)});event('Community page updated',target.name);}else{Object.assign(target,body);event('Workspace settings updated',target.name);}result={ok:true};}
  else if(user){const target=data.users.find(u=>u.id===user[1]);if(!target||target.platform_admin)throw new Error('Choose a non-root demo account.');if(user[2]==='suspension'){target.suspended=body.suspended;if(body.suspended)target.active_sessions=0;}if(user[2]==='revoke-sessions')target.active_sessions=0;event(user[2]==='impersonate'?'Support session opened':user[2]==='suspension'?'Account suspension changed':'Account sessions revoked',target.name);result={ok:true};}
  else throw new Error('This admin action is unavailable in the demo.');
 }
 data.activity=data.activity.slice(0,100);save();return structuredClone(result);
}
