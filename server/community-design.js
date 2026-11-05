import {z} from 'zod';
import {SITE_THEMES,BLOCK_TYPES,DEFAULT_DESIGN} from '../shared/community-design.js';
import {audit} from './db.js';
const short=max=>z.string().trim().max(max);
const webUrl=z.union([z.literal(''),z.string().max(1000).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}},'Use an HTTPS URL.')]);
const block=z.object({id:short(80).min(1),type:z.enum(BLOCK_TYPES),title:short(100),body:short(5000),image_url:webUrl,link_url:webUrl,link_label:short(60)}).strict().superRefine((v,c)=>{if(v.type==='image'&&!v.image_url)c.addIssue({code:'custom',message:'Choose an image URL.'});if(v.link_url&&!v.link_label)c.addIssue({code:'custom',message:'Give the link a label.'});});
export const designSchema=z.object({theme:z.enum(SITE_THEMES),eyebrow:short(100),pages:z.array(z.object({id:short(80).min(1),slug:z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),title:short(60).min(1),blocks:z.array(block).min(1).max(12)}).strict()).min(1).max(6)}).strict().superRefine((v,c)=>{if(Buffer.byteLength(JSON.stringify(v),'utf8')>60000)c.addIssue({code:'custom',message:'Keep the site design under 60 KB of content.'});for(const key of ['id','slug'])if(new Set(v.pages.map(p=>p[key])).size!==v.pages.length)c.addIssue({code:'custom',message:'Every page needs a unique '+key+'.'});if(v.pages.some(p=>['servers','news','events','rules','join','staff','store','apply'].includes(p.slug)))c.addIssue({code:'custom',message:'That page address is reserved for a community section.'});for(const p of v.pages)if(new Set(p.blocks.map(b=>b.id)).size!==p.blocks.length)c.addIssue({code:'custom',message:'Every section needs a unique ID.'});});
export function createCommunityDesign(db){
 async function site(ws){const row=await db.prepare('SELECT * FROM community_sites WHERE workspace_id=?').get(ws);if(!row)throw Object.assign(new Error('Save your community page details first.'),{status:409});return row;}
 const parse=value=>{try{const parsed=JSON.parse(value);return designSchema.safeParse(parsed).success?parsed:structuredClone(DEFAULT_DESIGN);}catch{return structuredClone(DEFAULT_DESIGN);}};
 return{
  async view(ws){const row=await site(ws);return{draft:parse(row.builder_draft),published:parse(row.builder_published),published_at:row.builder_published_at};},
  async save(ws,input){const draft=designSchema.parse(input);return db.withWorkspaceLock(ws,async()=>{await site(ws);await db.prepare('UPDATE community_sites SET builder_draft=? WHERE workspace_id=?').run(JSON.stringify(draft),ws);await audit(db,ws,'Community site draft saved',draft.pages.length+' pages');return this.view(ws);});},
  async publish(ws){return db.withWorkspaceLock(ws,async()=>{const row=await site(ws),draft=designSchema.parse(parse(row.builder_draft));await db.prepare('UPDATE community_sites SET builder_published=?,builder_published_at=? WHERE workspace_id=?').run(JSON.stringify(draft),Date.now(),ws);await audit(db,ws,'Community site design published',draft.pages.map(p=>p.title).join(', '));return this.view(ws);});},
  async reset(ws){return db.withWorkspaceLock(ws,async()=>{const row=await site(ws);await db.prepare('UPDATE community_sites SET builder_draft=? WHERE workspace_id=?').run(JSON.stringify(parse(row.builder_published)),ws);return this.view(ws);});}
 };
}
