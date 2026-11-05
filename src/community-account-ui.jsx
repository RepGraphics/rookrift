import React,{useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,Link,LogOut,Palette,ShieldCheck,UserRound} from 'lucide-react';
import {Avatar} from './avatar';
import {AccountSettings} from './account-settings-ui';
import {CommunityGameAccounts} from './community-accounts';
import {Button,Field} from './ui';

const sections=[['profile','Profile',UserRound],['games','Game accounts',Link],['appearance','Appearance',Palette],['security','Sign-in & security',ShieldCheck],['billing','Billing history'],['deletion','Delete account']];
export function CommunityAccountMenu({viewer,onNavigate,onLogout,busy}){
 const [open,setOpen]=useState(false),root=useRef(null),trigger=useRef(null),id=useId();
 useEffect(()=>{if(!open)return;const close=event=>{if(event.type==='keydown'&&event.key==='Escape'){setOpen(false);trigger.current?.focus();}else if(event.type==='pointerdown'&&!root.current?.contains(event.target))setOpen(false);};document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close);};},[open]);
 return <div className="portal-user-menu" ref={root}><button ref={trigger} type="button" className="portal-member-button" aria-label={'My account for '+(viewer.display_name||viewer.name)} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><Avatar user={viewer} size={34} decorative/><span>{viewer.display_name||viewer.name}<small>My account</small></span><ChevronDown size={15}/></button>{open&&<nav id={id} className="portal-account-popover" aria-label="My account"><div className="menu-identity"><strong>{viewer.name}</strong><small>Signed in to Rookrift</small></div>{sections.slice(0,4).map(([section,label,Icon])=><button key={section} onClick={()=>{setOpen(false);onNavigate(section);}}><Icon size={17}/>{label}</button>)}<button className="menu-signout" disabled={busy} onClick={async()=>{if(await onLogout())setOpen(false);}}><LogOut size={17}/>{busy?'Signing out…':'Sign out'}</button></nav>}</div>;
}

export function CommunityAccountArea({slug,viewer,demo,signIn,section,onNavigate,request,onIdentityChange,onRefresh,notify,mode,onModeChange,allowThemeToggle}){
 if(!viewer)return <section className="panel portal-post portal-content"><h2>Your community account</h2><p>Sign in to manage your profile, link a game account and view your orders.</p>{signIn}</section>;
 const profileExtra=<CommunityNickname slug={slug} viewer={viewer} request={request} onRefresh={onRefresh} notify={notify}/>;
 return <><div className="portal-account-intro"><span className="eyebrow">MY ACCOUNT</span><h1>My account</h1><p>Your profile and sign-in settings follow you across Rookrift. Game accounts and your nickname belong to this community.</p></div><div className="portal-account-layout"><nav className="settings-navigation" aria-label="Community account settings">{sections.map(([id,label])=><button key={id} type="button" aria-current={section===id?'page':undefined} onClick={()=>onNavigate(id)}>{label}</button>)}</nav><div className="account-settings-content">
 {section==='games'?<CommunityGameAccounts slug={slug} viewer={viewer} demo={demo} signIn={signIn}/>:section==='appearance'?<section className="panel padded"><h2>Community appearance</h2><p>Choose how this community appears on this browser.</p>{allowThemeToggle?<Field label="Community appearance"><select value={mode} onChange={e=>onModeChange(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></Field>:<p className="form-note">The community owner has chosen a fixed appearance for this site.</p>}</section>:<AccountSettings data={{user:viewer}} request={request} notify={notify} demo={demo} section={section} profileExtra={profileExtra} onIdentityChange={onIdentityChange} returnTo={'/c/'+slug+'?page=account'}/>}
 </div></div></>;
}

function CommunityNickname({slug,viewer,request,onRefresh,notify}){
 const [value,setValue]=useState(viewer.display_name||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <form className="panel padded" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{await request('/public/communities/'+encodeURIComponent(slug)+'/member','PATCH',{display_name:value});await onRefresh();notify('Community nickname saved');}catch(e){setError(e.message);}finally{setBusy(false);}}}><span className="eyebrow">THIS COMMUNITY</span><h2>Community nickname</h2><p>Choose a name for your account menu here. Your sign-in name and verified game identity stay the same.</p><Field label="Community nickname" hint="Optional. Leave blank to use your profile name."><input value={value} onChange={e=>setValue(e.target.value)} maxLength={80} autoComplete="nickname"/></Field>{error&&<p className="error-text" role="alert">{error}</p>}<Button disabled={busy}>{busy?'Saving…':'Save nickname'}</Button></form>;
}
