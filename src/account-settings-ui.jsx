import {ACCOUNT_ALIASES} from '../shared/view-state';
import {useViewState} from './use-view-state';
import React,{useEffect,useState} from 'react';
import {startRegistration} from '@simplewebauthn/browser';
import {LockKeyhole,MessageCircle,ShieldCheck} from 'lucide-react';
import {AccountProfileForm} from './account-profile-ui';
import {AccountDeletionPanel} from './account-deletion-ui';
import {Button,Field} from './ui';
import {useTheme} from './use-theme';
import {loadDemo,storeDemo} from './demo';
import './account-settings.css';

const sections=[['profile','Profile'],['security','Sign-in & security'],['appearance','Appearance'],['billing','Billing history'],['deletion','Delete account']];
export function AccountSettings({data,request,notify=()=>{},busy=false,onIdentityChange,demo=false,section:controlledSection,onSectionChange,profileExtra,returnTo='/dashboard?account=discord'}){
 const [account,setAccount]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[invoices,setInvoices]=useState(null),[billingError,setBillingError]=useState('');
 const [localSection,setLocalSection]=useViewState('account','profile',undefined,ACCOUNT_ALIASES);
 const section=controlledSection||localSection;
 const load=async()=>{const next=await request('/account?summary=1','GET');setAccount(next);return next;};
 useEffect(()=>{let active=true;setError('');setAccount(null);if(demo){setAccount({profile:{...data.user,email:'demo@rookrift.test',username:data.user.username||'demo',discord_linked:true},security:{totp_enabled:false,passkeys:[]}});}else request('/account?summary=1','GET').then(value=>{if(active)setAccount(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[data.user.id,demo]);
 useEffect(()=>{if(section!=='billing')return;let active=true;setBillingError('');if(demo)setInvoices([]);else request('/account/billing','GET').then(value=>{if(active)setInvoices(value);}).catch(e=>{if(active)setBillingError(e.message);});return()=>{active=false;};},[section,demo,data.user.id]);
 function navigate(id){setError('');if(onSectionChange)onSectionChange(id);else setLocalSection(id);}
 async function submit(path,method,body,message){setSaving(true);setError('');try{if(demo){notify('Security changes are unavailable in the browser demo.');return false;}await request(path,method,body);await load();notify(message);return true;}catch(e){setError(e.message);return false;}finally{setSaving(false);}}
 const disabled=busy||saving;
 return <div className="account-settings">
  {!controlledSection&&<nav className="settings-navigation" aria-label="Account settings">{sections.map(([id,label])=><button type="button" key={id} aria-current={section===id?'page':undefined} onClick={()=>navigate(id)}>{label}</button>)}</nav>}
  <div className="account-settings-content">
  {error&&<div className="error-panel" role="alert">{error}{!account&&<Button secondary onClick={()=>load().catch(e=>setError(e.message))}>Try again</Button>}</div>}
  {!account&&!error&&<p role="status">Loading your account…</p>}
  {account&&<>
   {section==='profile'&&<><AccountProfileForm profile={account.profile} busy={disabled} onSave={async body=>{setError('');try{let next;if(demo){const snapshot=loadDemo();next={...account,profile:{...account.profile,...body,...(body.avatar!==undefined?{avatar_url:body.avatar}:{})}};Object.assign(snapshot.user,next.profile);delete snapshot.user.email;delete snapshot.user.discord_linked;storeDemo(snapshot);}else next=await request('/account/profile','PATCH',body);setAccount(next);onIdentityChange?.(next.profile);notify(demo?'Demo profile saved':'Profile saved');return true;}catch(e){setError(e.message);return false;}}}/>{profileExtra}</>}
   {section==='security'&&<div className="account-layout">
    <div className="settings-page-intro"><h2>Sign-in & security</h2><p>Protect the Rookrift account you use across communities.</p></div>
    {account.profile.email?<div className="account-two-column">
     <form className="panel padded" onSubmit={e=>{e.preventDefault();submit('/account/email','PATCH',Object.fromEntries(new FormData(e.currentTarget)),'Email address updated');}}><h3>Email address</h3><p>Used for sign-in and password recovery.</p><Field label="Email"><input type="email" name="email" defaultValue={account.profile.email} required autoComplete="email"/></Field><Field label="Current password for email change"><input type="password" name="password" required autoComplete="current-password"/></Field><Button disabled={disabled||demo}>Change email</Button></form>
     <form className="panel padded" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;if(await submit('/account/password','POST',Object.fromEntries(new FormData(form)),'Password changed'))form.reset();}}><h3>Password</h3><p>Changing your password signs out other active sessions.</p><Field label="Current password"><input type="password" name="current_password" required autoComplete="current-password"/></Field><Field label="New password"><input type="password" name="password" required minLength={8} maxLength={128} autoComplete="new-password"/></Field><Button disabled={disabled||demo}>Change password</Button></form>
    </div>:<div className="form-note">You sign in with Discord or a passkey. There is no email/password sign-in on this account.</div>}
    <section className="panel padded"><div className="section-heading"><div><h3>Discord sign-in</h3><p>Use Discord to sign in and receive community role rewards.</p></div><MessageCircle size={24}/></div>{account.profile.discord_linked?<span className="result-badge success">Discord connected</span>:<a className="button secondary" href={'/auth/discord/link?return_to='+encodeURIComponent(returnTo)}>Link Discord</a>}</section>
    <section className="panel padded"><div className="section-heading"><div><h3>Two-factor authentication</h3><p>Add an authenticator app to protect password sign-in.</p></div><LockKeyhole size={24}/></div>{account.security.totp_enabled?<form onSubmit={e=>{e.preventDefault();submit('/account/2fa/disable','POST',{code:new FormData(e.currentTarget).get('code')},'Two-factor authentication disabled');}}><p className="result-badge success">Authenticator app enabled</p><Field label="Authenticator code"><input name="code" inputMode="numeric" pattern="[0-9]{6}" required autoComplete="one-time-code" maxLength={6}/></Field><Button danger disabled={disabled||demo}>Disable 2FA</Button></form>:<TwoFactorSetup request={request} reload={load} notify={notify} disabled={disabled||demo}/>}</section>
    <section className="panel padded"><div className="section-heading"><div><h3>Passkeys</h3><p>Use your device or a security key for password-free sign-in.</p></div><ShieldCheck size={24}/></div>{account.security.passkeys.length?account.security.passkeys.map(key=><div className="account-row" key={key.id}><span>{key.label}</span><Button quiet disabled={disabled||demo} onClick={()=>submit('/account/passkeys/'+key.id,'DELETE',null,'Passkey removed')}>Remove</Button></div>):<p className="muted">No passkeys registered yet.</p>}<Button disabled={disabled||demo} onClick={async()=>{setSaving(true);setError('');try{const options=await request('/account/passkeys/options','POST',{}),response=await startRegistration({optionsJSON:options});await request('/account/passkeys','POST',{challenge_id:options.challenge_id,response,label:'My passkey'});await load();notify('Passkey added');}catch(e){setError(e.message);}finally{setSaving(false);}}}>Add passkey</Button></section>
    {demo&&<p className="form-note">Security controls are read-only in the browser demo.</p>}
   </div>}
   {section==='appearance'&&<AccountAppearance/>}
   {section==='billing'&&<section className="panel padded"><h2>Billing history</h2><p>Subscription invoices for workspaces you own. Manage plans from Plans & billing in your workspace.</p>{billingError?<p role="alert" className="error-text">{billingError}</p>:!invoices?<p role="status">Loading invoices…</p>:!invoices.length?<p className="muted">You have no workspace invoices yet.</p>:invoices.map(item=><div className="billing-history" key={item.workspace_id}><div><strong>{item.workspace_name}</strong><span>{item.plan} · {item.status}</span></div>{item.invoices.length?item.invoices.map(invoice=><div className="account-row" key={invoice.id}><span>{invoice.number||invoice.id} · {invoice.status} · {(invoice.amount/100).toFixed(2)} {String(invoice.currency||'gbp').toUpperCase()}</span>{invoice.pdf_url&&<a href={invoice.pdf_url} target="_blank" rel="noreferrer">Invoice PDF</a>}</div>):<span className="muted">No invoices yet.</span>}</div>)}</section>}
   {section==='deletion'&&<AccountDeletionPanel data={data} request={request} totpEnabled={account.security.totp_enabled} demo={demo} returnTo={returnTo.startsWith('/c/')?returnTo:undefined}/>}
  </>}
  </div>
 </div>;
}

function AccountAppearance(){const {theme,setTheme}=useTheme();return <section className="panel padded"><h2>Appearance</h2><p>Choose how the Rookrift dashboard appears on this browser. Community pages have their own appearance settings.</p><Field label="Dashboard appearance"><select value={theme} onChange={e=>setTheme(e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></Field></section>;}

function TwoFactorSetup({request,reload,notify,disabled}){
 const [setup,setSetup]=useState(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(fn){setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <>{error&&<p role="alert" className="error-text">{error}</p>}{setup?<form onSubmit={e=>{e.preventDefault();run(async()=>{await request('/account/2fa/confirm','POST',{code});await reload();notify('Two-factor authentication enabled');});}}><p>Enter this setup key in your authenticator app, then enter its six-digit code.</p><code className="account-secret">{setup.secret}</code><Field label="Authenticator code"><input value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code"/></Field><div className="button-row"><Button disabled={disabled||busy}>Enable 2FA</Button><Button type="button" secondary disabled={busy} onClick={()=>{setSetup(null);setCode('');}}>Cancel setup</Button></div></form>:<Button secondary disabled={disabled||busy} onClick={()=>run(async()=>setSetup(await request('/account/2fa/setup','POST',{})))}>Set up authenticator app</Button>}</>;
}
