export const reservedOrder=order=>!['expired','failed'].includes(order.payment_status);
export const normaliseCoupon=value=>String(value||'').trim().toUpperCase();
export function promotionApplies(promotion,product,now=Date.now()){
 if(!promotion.enabled||promotion.archived||(promotion.starts_at&&now<promotion.starts_at)||(promotion.ends_at&&now>=promotion.ends_at)||product.price<promotion.minimum_amount||product.price===0)return false;
 const products=typeof promotion.product_ids==='string'?JSON.parse(promotion.product_ids):promotion.product_ids||[],categories=typeof promotion.category_ids==='string'?JSON.parse(promotion.category_ids):promotion.category_ids||[];
 return (!products.length&&!categories.length)||products.includes(product.id)||categories.includes(product.category_id);
}
export function discountFor(promotion,price){
 const requested=promotion.discount_type==='percent'?Math.floor(price*promotion.discount_value/100):promotion.discount_value;
 // Paid products keep a 0.50 minimum. A promotion never silently turns a paid
 // purchase into a free claim; explicitly free products use their own workflow.
 return Math.max(0,Math.min(requested,price-50));
}
export function availabilityFor(product,used=0,customerUsed=0,now=Date.now()){
 const remaining=product.stock_limit==null?null:Math.max(0,product.stock_limit-used),customerRemaining=product.customer_limit==null?null:Math.max(0,product.customer_limit-customerUsed);
 let reason='';if(product.available_from&&now<product.available_from)reason='Opens '+new Date(product.available_from).toISOString();
 else if(product.available_until&&now>=product.available_until)reason='This offer has ended.';
 else if(remaining===0)reason='Sold out.';
 else if(customerRemaining===0)reason='You have reached this product’s purchase limit.';
 return{available:!reason,reason,remaining,customer_remaining:customerRemaining,starts_at:product.available_from||null,ends_at:product.available_until||null};
}
export function analyticsWindow(days=30,now=Date.now()){
 const today=new Date(now);today.setUTCHours(0,0,0,0);return{from:today.getTime()-(days-1)*86400000,to:today.getTime()+86400000};
}
export function demoSalesAnalytics(orders,days=30,now=Date.now()){
 const range=analyticsWindow(days,now),sales=orders.filter(o=>(o.paid_at||o.created_at)>=range.from&&(o.paid_at||o.created_at)<range.to&&o.payment_status==='paid'&&o.amount>0),series=[],products=new Map();
 for(let time=range.from;time<range.to;time+=86400000){const day=new Date(time).toISOString().slice(0,10),rows=sales.filter(o=>new Date(o.paid_at||o.created_at).toISOString().startsWith(day));series.push({day,amount:rows.reduce((n,o)=>n+o.amount,0),orders:rows.length});}
 for(const order of sales){const key=order.product_id||order.title,item=products.get(key)||{id:key,title:order.title,amount:0,orders:0};item.amount+=order.amount;item.orders++;products.set(key,item);}
 const amount=sales.reduce((n,o)=>n+o.amount,0);return{...range,days,amount,orders:sales.length,discounts:sales.reduce((n,o)=>n+(o.discount_amount||0),0),average:sales.length?Math.round(amount/sales.length):0,free_claims:orders.filter(o=>o.payment_status==='paid'&&o.amount===0&&(o.paid_at||o.created_at)>=range.from).length,needs_delivery:orders.filter(o=>o.payment_status==='paid'&&o.fulfillment_status!=='fulfilled').length,review:orders.filter(o=>['refunded','partially_refunded','disputed'].includes(o.payment_status)).length,series,products:[...products.values()].sort((a,b)=>b.amount-a.amount).slice(0,10)};
}
