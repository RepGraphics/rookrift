import {randomUUID} from 'node:crypto';
export const parseActions=value=>{try{return JSON.parse(value||'[]');}catch{return[];}};
export {publicDelivery} from '../shared/store-delivery.js';
export async function enqueueDelivery(db,order){
 if(order.payment_status!=='paid')return;
 const actions=parseActions(order.delivery_actions);
 for(let i=0;i<actions.length;i++)await db.prepare('INSERT INTO store_delivery_jobs(id,workspace_id,order_id,position,type,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(order_id,position) DO NOTHING').run(randomUUID(),order.workspace_id,order.id,i,actions[i].type,JSON.stringify(actions[i]),Date.now(),Date.now());
}
export async function refreshDeliveryStatus(db,ws,id){
 const order=await db.prepare('SELECT * FROM store_orders WHERE workspace_id=? AND id=?').get(ws,id);if(!order||order.payment_status!=='paid'||order.fulfillment_status==='fulfilled')return;
 const jobs=await db.prepare('SELECT status,type FROM store_delivery_jobs WHERE order_id=? ORDER BY position').all(id);if(!jobs.length)return;
 const complete=jobs.every(j=>j.status==='succeeded'),review=jobs.some(j=>['blocked','uncertain','cancelled'].includes(j.status));
 const note=complete?'Configured purchase actions completed. Game commands were acknowledged by RCON; contact staff if an item has not arrived.':'';
 await db.prepare('UPDATE store_orders SET fulfillment_status=?,fulfillment_note=CASE WHEN ? THEN ? ELSE fulfillment_note END,fulfilled_at=CASE WHEN ? THEN ? ELSE fulfilled_at END,updated_at=? WHERE id=?').run(complete?'fulfilled':review?'review_required':'pending',complete,note,complete,Date.now(),Date.now(),id);
}
