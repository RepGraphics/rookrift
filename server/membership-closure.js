const terminal=new Set(['canceled','cancelled','expired','incomplete_expired','free']);
export function membershipClosure(db,stripe,paypal){
 async function pages(list,input){const values=[];let after;for(let n=0;n<20;n++){const page=await list({...input,limit:100,...(after?{starting_after:after}:{})});if(!Array.isArray(page.data))throw new Error('Invalid billing response');values.push(...page.data);if(!page.has_more)return values;after=page.data.at(-1)?.id;if(!after)break;}throw new Error('Billing history needs manual review');}
 return{
  async deletionStatus(workspaces,{closePending=false}={}){
   const memberships=[];
   for(const ws of workspaces){
    const row={workspace_id:ws.id,workspace_name:ws.name,allowed:true,message:'No renewing membership.',pending_checkouts:0,can_manage:Boolean(ws.customer_id)};
    try{
     let checked=false;
     if(ws.customer_id||ws.subscription_id){
      if(!stripe?.subscriptions)throw new Error('Stripe verification unavailable');
      let subscriptions=ws.customer_id?await pages(input=>stripe.subscriptions.list(input),{customer:ws.customer_id,status:'all'}):[];
      if(ws.subscription_id&&!subscriptions.some(s=>s.id===ws.subscription_id))subscriptions.push(await stripe.subscriptions.retrieve(ws.subscription_id));
      for(const sub of subscriptions){const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;if(ws.customer_id&&customer!==ws.customer_id)throw new Error('Subscription customer mismatch');if(!terminal.has(String(sub.status).toLowerCase())&&sub.cancel_at_period_end!==true){row.allowed=false;row.message='Cancel this Stripe membership before deleting your account.';}else if(sub.cancel_at_period_end===true&&!terminal.has(sub.status))row.message='Cancellation is scheduled. Deleting ends your remaining Rookrift access immediately.';}
      if(ws.customer_id){const pending=(await pages(input=>stripe.checkout.sessions.list(input),{customer:ws.customer_id,status:'open'})).filter(s=>s.mode==='subscription');row.pending_checkouts=pending.length;if(closePending)for(const session of pending)await stripe.checkout.sessions.expire(session.id);}
      if(closePending&&ws.customer_id){const current=await pages(input=>stripe.subscriptions.list(input),{customer:ws.customer_id,status:'all'});if(current.some(sub=>!terminal.has(String(sub.status).toLowerCase())&&sub.cancel_at_period_end!==true)){row.allowed=false;row.message='Membership state changed. Cancel it and retry deletion.';}}
      checked=true;
     }
     if(ws.paypal_subscription_id){if(!paypal?.getSubscription)throw new Error('PayPal verification unavailable');const sub=await paypal.getSubscription(ws.paypal_subscription_id);if(sub.id!==ws.paypal_subscription_id)throw new Error('Subscription mismatch');if(!['CANCELLED','EXPIRED'].includes(String(sub.status).toUpperCase())){row.allowed=false;row.message='Cancel this membership in PayPal before deleting your account.';}checked=true;}
     const attempts=await db.prepare("SELECT provider,external_id,state FROM billing_checkout_attempts WHERE workspace_id=? AND state NOT IN ('resolved','expired','cancelled')").all(ws.id);
     for(const attempt of attempts){if(attempt.provider==='paypal'&&attempt.external_id&&paypal?.getSubscription){const sub=await paypal.getSubscription(attempt.external_id);if(sub.id!==attempt.external_id||!['CANCELLED','EXPIRED'].includes(String(sub.status).toUpperCase())){row.allowed=false;row.message='Close the pending PayPal subscription or contact support before deletion.';}}else{row.allowed=false;row.message='A pending or externally managed checkout needs cancellation confirmation from support.';}}
     if(!checked&&!terminal.has(String(ws.subscription_status||'free').toLowerCase())){row.allowed=false;row.message='Cancel this membership first. Contact support if its billing provider is managed manually.';}
    }catch{row.allowed=false;row.message='Billing cancellation could not be verified. Try again or contact support; the account has not been deleted.';}
    memberships.push(row);
   }
   return{allowed:memberships.every(r=>r.allowed),memberships};
  }
 };
}
