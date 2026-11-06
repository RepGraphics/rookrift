import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {audit} from './db.js';
import {effectivePlan} from './plans.js';
import {availabilityFor,promotionApplies,discountFor,normaliseCoupon,analyticsWindow} from '../shared/store-growth.js';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const timestamp=z.number().int().min(1).max(8640000000000000).nullable();
const limits=z.object({stock_limit:z.number().int().min(0).max(1000000).nullable(),customer_limit:z.number().int().min(1).max(10000).nullable(),available_from:timestamp,available_until:timestamp}).strict().refine(v=>!v.available_from||!v.available_until||v.available_until>v.available_from,'End time must be after the start time.');
const promotionSchema=z.object({name:z.string().trim().min(2).max(80),kind:z.enum(['coupon','sale']),code:z.string().trim().max(32).default(''),discount_type:z.enum(['percent','fixed']),discount_value:z.number().int().min(1).max(100000),minimum_amount:z.number().int().min(0).max(100000),product_ids:z.array(z.string().uuid()).max(100),category_ids:z.array(z.string().uuid()).max(30),starts_at:timestamp,ends_at:timestamp,usage_limit:z.number().int().min(1).max(1000000).nullable(),customer_limit:z.number().int().min(1).max(10000).nullable(),enabled:z.boolean()}).strict().superRefine((v,ctx)=>{
 if(v.kind==='coupon'&&!/^[A-Z0-9_-]{3,32}$/.test(normaliseCoupon(v.code)))ctx.addIssue({code:'custom',message:'Coupon codes need 3–32 letters, numbers, underscores or hyphens.'});
 if(v.discount_type==='percent'&&v.discount_value>95)ctx.addIssue({code:'custom',message:'Use a percentage from 1 to 95.'});
 if(v.starts_at&&v.ends_at&&v.ends_at<=v.starts_at)ctx.addIssue({code:'custom',message:'End time must be after the start time.'});
 if(v.product_ids.length&&v.category_ids.length)ctx.addIssue({code:'custom',message:'Choose products or categories, not both.'});
});
const reserved="payment_status NOT IN ('expired','failed')";

export function createStoreGrowth(db){
 async function counts(ws,userId){return db.prepare(`SELECT product_id,count(*) AS used,count(*) FILTER(WHERE user_id=?) AS customer_used FROM store_orders WHERE workspace_id=? AND ${reserved} GROUP BY product_id`).all(userId||'',ws);}
 async function promotions(ws,userId){return db.prepare(`SELECT p.*,count(o.id) AS used,count(o.id) FILTER(WHERE o.user_id=?) AS customer_used FROM store_promotions p LEFT JOIN store_orders o ON o.workspace_id=p.workspace_id AND o.promotion_id=p.id AND o.${reserved} WHERE p.workspace_id=? AND p.archived=0 GROUP BY p.id ORDER BY p.created_at,p.id`).all(userId||'',ws);}
 function availablePromotion(p){return(p.usage_limit==null||p.used<p.usage_limit)&&(p.customer_limit==null||p.customer_used<p.customer_limit);}
 async function quote(ws,product,userId,code='',provider='stripe',cachedPromotions){
  const rows=cachedPromotions||await promotions(ws,userId),normalised=normaliseCoupon(code);let promotion;
  if(provider!=='stripe'&&product.price>0){if(normalised)fail('This hosted payment provider manages its own promotions. Rookrift codes apply to Stripe purchases.');return{base_amount:product.price,amount:product.price,discount_amount:0,promotion:null};}
  if(normalised){promotion=rows.find(p=>p.kind==='coupon'&&p.code===normalised);if(!promotion||!promotionApplies(promotion,product)||!availablePromotion(promotion)||!discountFor(promotion,product.price))fail('This code is unavailable, has reached its limit, or does not apply to this product.');}
  else promotion=rows.filter(p=>p.kind==='sale'&&promotionApplies(p,product)&&availablePromotion(p)).sort((a,b)=>discountFor(b,product.price)-discountFor(a,product.price))[0];
  const discount=promotion?discountFor(promotion,product.price):0;
  return{base_amount:product.price,amount:product.price-discount,discount_amount:discount,promotion:discount?{id:promotion.id,name:promotion.name,code:promotion.code||'',ends_at:promotion.ends_at}:null};
 }
 return{
  counts,promotions,quote,
  async list(ws){const workspace=await db.prepare('SELECT * FROM workspaces WHERE id=?').get(ws);return{promotions:await promotions(ws),promotion_limit:({scout:10,tribe:50,cluster:200})[effectivePlan(workspace).id]};},
  async savePromotion(ws,id,input){const value=promotionSchema.parse(input);return db.withWorkspaceLock(ws,async()=>{
   const row=id?await db.prepare('SELECT * FROM store_promotions WHERE workspace_id=? AND id=? AND archived=0').get(ws,id):null;if(id&&!row)fail('Promotion not found.',404);
   for(const [table,ids]of [['store_products',value.product_ids],['store_categories',value.category_ids]])for(const target of ids)if(!await db.prepare(`SELECT id FROM ${table} WHERE id=? AND workspace_id=?`).get(target,ws))fail('Choose promotion targets from this workspace.',404);
   const list=await this.list(ws);if(!id&&list.promotions.length>=list.promotion_limit)fail('Your plan promotion limit has been reached.',403);
   const code=value.kind==='coupon'?normaliseCoupon(value.code):null;if(row&&(row.kind!==value.kind||row.code!==code))fail('Create a new promotion to change its type or code.');
   const data=[value.name,value.kind,code,value.discount_type,value.discount_value,value.minimum_amount,JSON.stringify([...new Set(value.product_ids)]),JSON.stringify([...new Set(value.category_ids)]),value.starts_at,value.ends_at,value.usage_limit,value.customer_limit,Number(value.enabled),Date.now()];
   try{if(id)await db.prepare('UPDATE store_promotions SET name=?,kind=?,code=?,discount_type=?,discount_value=?,minimum_amount=?,product_ids=?,category_ids=?,starts_at=?,ends_at=?,usage_limit=?,customer_limit=?,enabled=?,updated_at=? WHERE id=? AND workspace_id=?').run(...data,id,ws);else await db.prepare('INSERT INTO store_promotions(name,kind,code,discount_type,discount_value,minimum_amount,product_ids,category_ids,starts_at,ends_at,usage_limit,customer_limit,enabled,updated_at,id,workspace_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...data,randomUUID(),ws,Date.now());}catch(e){if(e.code==='23505')fail('That code has already been used by this community. Choose another code.',409);throw e;}
   await audit(db,ws,'Store promotion saved',value.name);return this.list(ws);
  });},
  async archivePromotion(ws,id){return db.withWorkspaceLock(ws,async()=>{const result=await db.prepare('UPDATE store_promotions SET archived=1,enabled=0,updated_at=? WHERE id=? AND workspace_id=? AND archived=0').run(Date.now(),id,ws);if(!result.changes)fail('Promotion not found.',404);await audit(db,ws,'Store promotion archived',id);return this.list(ws);});},
  async saveAvailability(ws,id,input){const value=limits.parse(input);return db.withWorkspaceLock(ws,async()=>{const result=await db.prepare('UPDATE store_products SET stock_limit=?,customer_limit=?,available_from=?,available_until=?,updated_at=? WHERE id=? AND workspace_id=? AND archived=0').run(value.stock_limit,value.customer_limit,value.available_from,value.available_until,Date.now(),id,ws);if(!result.changes)fail('Product not found.',404);await audit(db,ws,'Product availability saved',id);return{ok:true};});},
  async checkAvailability(ws,product,userId){const c=(await counts(ws,userId)).find(c=>c.product_id===product.id),availability=availabilityFor(product,c?.used||0,c?.customer_used||0);if(!availability.available)fail(availability.reason,409);return availability;},
  async goal(ws){const settings=await db.prepare('SELECT goal_enabled,goal_amount,goal_title,currency FROM community_stores WHERE workspace_id=?').get(ws);if(!settings?.goal_enabled)return null;const date=new Date(),from=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1),to=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1),row=await db.prepare("SELECT COALESCE(sum(amount),0) AS raised FROM store_orders WHERE workspace_id=? AND payment_status='paid' AND amount>0 AND paid_at>=? AND paid_at<?").get(ws,from,to);return{title:settings.goal_title,target:settings.goal_amount,raised:row.raised,currency:settings.currency,from,to};},
  async saveGoal(ws,input){const v=z.object({goal_enabled:z.boolean(),goal_amount:z.number().int().min(1000).max(100000000),goal_title:z.string().trim().min(2).max(100)}).strict().parse(input);const result=await db.prepare('UPDATE community_stores SET goal_enabled=?,goal_amount=?,goal_title=?,updated_at=? WHERE workspace_id=?').run(Number(v.goal_enabled),v.goal_amount,v.goal_title,Date.now(),ws);if(!result.changes)fail('Save your store settings first.',409);await audit(db,ws,'Community sales goal saved',v.goal_enabled?'Public goal enabled':'Public goal hidden');return v;},
  async analytics(ws,days=30){if(![7,30,90,365].includes(days))fail('Choose a 7, 30, 90 or 365 day range.');const {from,to}=analyticsWindow(days);
   const [metrics,totals,series,products]=await Promise.all([
    db.prepare("SELECT COALESCE(sum(amount),0) AS amount,count(*) AS orders,COALESCE(sum(discount_amount),0) AS discounts FROM store_orders WHERE workspace_id=? AND payment_status='paid' AND amount>0 AND paid_at>=? AND paid_at<?").get(ws,from,to),
    db.prepare("SELECT count(*) FILTER(WHERE payment_status='paid' AND amount=0 AND paid_at>=? AND paid_at<?) AS free_claims,count(*) FILTER(WHERE payment_status='paid' AND fulfillment_status<>'fulfilled') AS needs_delivery,count(*) FILTER(WHERE payment_status IN ('refunded','partially_refunded','disputed')) AS review FROM store_orders WHERE workspace_id=?").get(from,to,ws),
    db.prepare("SELECT to_char(to_timestamp(paid_at/1000.0) AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,sum(amount) AS amount,count(*) AS orders FROM store_orders WHERE workspace_id=? AND payment_status='paid' AND amount>0 AND paid_at>=? AND paid_at<? GROUP BY day ORDER BY day").all(ws,from,to),
    db.prepare("SELECT product_id AS id,title,sum(amount) AS amount,count(*) AS orders FROM store_orders WHERE workspace_id=? AND payment_status='paid' AND amount>0 AND paid_at>=? AND paid_at<? GROUP BY product_id,title ORDER BY amount DESC,orders DESC,title LIMIT 10").all(ws,from,to)
   ]);const full=[];for(let time=from;time<to;time+=86400000){const day=new Date(time).toISOString().slice(0,10);full.push(series.find(s=>s.day===day)||{day,amount:0,orders:0});}
   return{...metrics,...totals,average:metrics.orders?Math.round(metrics.amount/metrics.orders):0,days,from,to,series:full,products};
  }
 };
}
