export const VIEW_VALUES={
 view:['overview','servers','players','automations','configuration','workflows','activity','history','operations','community','discord','billing','team','settings','account'],
 community:['hub','builder','store','linking','news','events','join','staff'],
 store:['catalog','categories','promotions','analytics','orders','settings'],
 operations:['health','incidents','announcements','maintenance','hosting','moderation'],
 players:['players','profiles','activity','bans'],configuration:['templates','history'],workflows:['definitions','runs'],
 account:['profile','security','appearance','billing','deletion'],admin:['overview','users','workspaces','activity','settings'],
 integration:['email','discord','subscriptions','store'],editor:['pages','appearance']
};
export const ACCOUNT_ALIASES={discord:'security','delete-verified':'deletion'};
export function legacyDashboardView(search,defaultValue='overview'){
 const p=new URLSearchParams(search);if(VIEW_VALUES.account.includes(p.get('account'))||Object.hasOwn(ACCOUNT_ALIASES,p.get('account')))return'account';
 if(p.get('settings')==='discord')return'settings';if(p.has('community_payments'))return'community';
 if(p.has('billing')||['tribe','cluster'].includes(p.get('plan')))return'billing';return defaultValue;
}
export function readView(search,key,defaultValue,allowed=VIEW_VALUES[key],aliases={}){
 const value=new URLSearchParams(search).get(key),next=Object.hasOwn(aliases,value)?aliases[value]:value;return allowed?.includes(next)?next:defaultValue;
}
export function dashboardReturn(value){
 if(typeof value!=='string'||!/^\/dashboard(?:\?|$)/.test(value)||/[\u0000-\u0020\u007f\\]/.test(value))return null;
 let url;try{url=new URL(value,'https://rookrift.invalid');}catch{return null;}
 if(url.origin!=='https://rookrift.invalid'||url.pathname!=='/dashboard'||url.hash)return null;
 const legacy={account:[...VIEW_VALUES.account,...Object.keys(ACCOUNT_ALIASES)],plan:['tribe','cluster'],settings:['discord'],billing:['success','canceled'],community_payments:['return','refresh']},seen=new Set();
 for(const[key,entry]of url.searchParams){const allowed=Object.hasOwn(legacy,key)?legacy[key]:Object.hasOwn(VIEW_VALUES,key)?VIEW_VALUES[key]:null;if(seen.has(key)||!allowed?.includes(entry))return null;seen.add(key);}
 // Preserve the supplied internal address only after validating every key.
 return value;
}
