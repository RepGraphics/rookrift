import {dashboardReturn} from './view-state.js';
const plans=new Set(['tribe','cluster']);
export function communityReturn(value){return typeof value==='string'&&/^\/c\/[a-z0-9-]{3,48}(?:\?page=[a-z0-9-]{1,40})?$/.test(value)?value:null;}
export function accountReturn(value){return communityReturn(value)||dashboardReturn(value);}
export function authDestination(search=''){
 const params=new URLSearchParams(search),community=communityReturn(params.get('return_to'));
 if(community)return community;
 const account=accountReturn(params.get('return_to'));if(account)return account;
 if(params.has('view'))return dashboardReturn('/dashboard'+search)||'/dashboard';
 const plan=params.get('plan');return '/dashboard'+(plans.has(plan)?'?plan='+plan:'');
}
export function siteRoute(pathname,search='',hash=''){
 const path=pathname.replace(/\/+$/,'')||'/',params=new URLSearchParams(search),community=path.match(/^\/c\/([a-z0-9-]{3,48})$/);
 if(community)return{page:'community',slug:community[1]};
 const legal={'/terms':'terms','/terms-of-service':'terms','/refund-policy':'refund','/refunds':'refund','/privacy-policy':'privacy','/privacy':'privacy'};if(legal[path])return{page:'legal',kind:legal[path]};
 if(['/dashboard','/admin','/login','/register','/forgot-password','/reset-password'].includes(path))return{page:path.slice(1)};
 if(path==='/'){
  // Retain links sent before the public homepage had its own route.
  if(params.has('return_to'))return{page:'login'};
  if(/^[a-f0-9]{64}$/.test(new URLSearchParams(hash.replace(/^#/,'')).get('invite')||''))return{page:'dashboard'};
  if(params.has('billing')||params.has('community_payments'))return{page:'dashboard'};
  return{page:'landing'};
 }
 return{page:'missing'};
}
