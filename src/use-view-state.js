import {useEffect,useRef,useState} from 'react';
import {VIEW_VALUES,readView} from '../shared/view-state';
export const VIEW_EVENT='rookrift-view-change';

export function useViewState(key,defaultValue,allowed=VIEW_VALUES[key],aliases={}){
 const definition=useRef(null);definition.current={key,defaultValue,allowed,aliases};
 const read=()=>{const d=definition.current;return readView(window.location.search,d.key,typeof d.defaultValue==='function'?d.defaultValue():d.defaultValue,d.allowed,d.aliases);};
 const [value,setValue]=useState(read),allowedKey=allowed.join('|');
 useEffect(()=>{const sync=()=>setValue(read());window.addEventListener('popstate',sync);window.addEventListener(VIEW_EVENT,sync);sync();return()=>{window.removeEventListener('popstate',sync);window.removeEventListener(VIEW_EVENT,sync);};},[key,allowedKey]);
 const update=(next,options={})=>{
  const d=definition.current,requested=typeof next==='function'?next(read()):next;if(!d.allowed.includes(requested))return;
  const url=new URL(window.location.href);url.searchParams.set(d.key,requested);
  if(d.key==='view'){
   if(url.pathname==='/')url.pathname='/dashboard';
   if(url.hash.startsWith('#invite='))url.hash='';
   // Payment/OAuth return markers select an initial page once. Deliberate
   // navigation supersedes them; nested, non-sensitive tab choices stay intact.
   for(const marker of ['plan','billing','community_payments','settings'])url.searchParams.delete(marker);
   if(requested!=='account')url.searchParams.delete('account');
  }
  const address=url.pathname+url.search+url.hash,current=window.location.pathname+window.location.search+window.location.hash;
  if(address!==current)window.history[options.replace?'replaceState':'pushState'](null,'',address);
  setValue(requested);window.dispatchEvent(new Event(VIEW_EVENT));
 };
 return[value,update];
}
