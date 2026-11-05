import React,{useState} from 'react';
import {Save} from 'lucide-react';
import {EmailSettings} from './email-settings-ui';
import {Button} from './ui';
import './account-settings.css';

const categories=[['email','Email delivery','SMTP, receipts and sales'],['discord','Discord','Bot and account sign-in'],['subscriptions','Subscriptions','Platform membership payments'],['store','Community payments','Store merchant integration']];
const discord=[['discord_client_id','Client ID'],['discord_client_secret','Client secret',true],['discord_bot_token','Bot token',true]];
const providers={
 stripe:{name:'Stripe',fields:[['stripe_secret_key','Secret key',true],['stripe_webhook_secret','Webhook secret',true],['stripe_tribe_monthly_price_id','Tribe monthly price ID'],['stripe_cluster_monthly_price_id','Cluster monthly price ID']]},
 paypal:{name:'PayPal Business',fields:[['paypal_client_id','Client ID'],['paypal_client_secret','Client secret',true],['paypal_webhook_id','Webhook ID'],['paypal_tribe_plan_id','Tribe plan ID'],['paypal_cluster_plan_id','Cluster plan ID']]},
 paypal_ipn:{name:'PayPal hosted buttons + IPN',fields:[['paypal_ipn_tribe_url','Tribe checkout URL',false,'url'],['paypal_ipn_cluster_url','Cluster checkout URL',false,'url']]},
 tebex:{name:'Tebex hosted checkout',fields:[['tebex_tribe_url','Tribe checkout URL',false,'url'],['tebex_cluster_url','Cluster checkout URL',false,'url']]}
};
const store=[['stripe_connect_secret_key','Connect secret key',true],['stripe_connect_webhook_secret','Connect webhook secret',true]];
export function AdminSettings({settings,request,onSaved,notify}){
 const [category,setCategory]=useState('email'),[provider,setProvider]=useState(settings.platform_billing_provider?.value||'stripe'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const selected=categories.find(([id])=>id===category),fields=category==='discord'?discord:category==='store'?store:providers[provider].fields;
 const configured=fields.filter(([key])=>settings[key]?.configured).length;
 async function save(event){event.preventDefault();const form=event.currentTarget,body=Object.fromEntries(new FormData(form));setBusy(true);setError('');try{const result=await request('/platform/settings','PATCH',body);await onSaved();form.reset();notify(result.restart_required?'Settings saved. Restart Rookrift to apply integration changes.':'Settings saved.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><div className="settings-category-intro"><h2>Global settings</h2><p>Configure one service at a time. Workspace owners manage their own community and server settings from the dashboard.</p></div><div className="admin-settings-layout"><nav className="settings-navigation" aria-label="Global settings categories">{categories.map(([id,label,hint])=><button key={id} type="button" disabled={busy} aria-current={category===id?'page':undefined} onClick={()=>{setCategory(id);setError('');}}>{label}<small>{hint}</small></button>)}</nav><div>
 {category==='email'?<EmailSettings request={request}/>:<section className="panel admin-settings" aria-labelledby="integration-heading"><div className="profile-section-heading"><h2 id="integration-heading">{selected[1]}</h2><p>{category==='discord'?'Connect the platform bot and enable Discord sign-in. Workspace guild and alert channel IDs belong in Workspace Settings.':category==='store'?'Stripe Connect credentials let community owners accept store payments.':'Choose how customers pay for Rookrift workspace memberships.'}</p></div><form className="admin-settings-form" onSubmit={save} key={category+provider}>
 {category==='subscriptions'&&<div className="admin-settings-group"><label>Subscription provider<select name="platform_billing_provider" value={provider} disabled={busy} onChange={e=>setProvider(e.target.value)}>{Object.entries(providers).map(([id,p])=><option value={id} key={id}>{p.name}</option>)}</select></label><p className="form-note">Changing provider takes effect after restart. Existing subscriptions remain with their original provider.</p></div>}
 <fieldset disabled={busy} className="integration-fields"><legend>{category==='subscriptions'?providers[provider].name+' configuration':'Credentials'}</legend><p className="muted">{configured} of {fields.length} values configured. Leave a field blank to keep its saved value.</p><div className="admin-setting-grid">{fields.map(([key,label,secret,type])=><label key={key}>{label}<input name={key} type={secret?'password':type||'text'} autoComplete="off" spellCheck={false} placeholder={settings[key]?.configured?'Configured — leave blank to keep it':type==='url'?'https://…':'Not configured'}/></label>)}</div></fieldset>
 <p className="form-note">Credentials are encrypted and are never displayed here. Environment variables override saved integration credentials. Restart the service after saving.</p>{error&&<p className="error-text" role="alert">{error}</p>}<Button icon={Save} disabled={busy}>{busy?'Saving…':'Save '+selected[1].toLowerCase()+' settings'}</Button></form></section>}
 </div></div></>;
}
