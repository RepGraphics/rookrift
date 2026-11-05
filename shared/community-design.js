export const SITE_THEMES=['forest','ocean','slate','ember','violet','sand'];
export const BLOCK_TYPES=['text','image','callout','servers','news','events'];
export const DEFAULT_DESIGN={theme:'forest',eyebrow:'YOUR NEXT ADVENTURE STARTS HERE',pages:[{id:'home',slug:'home',title:'Home',blocks:[{id:'welcome',type:'text',title:'Survival, together.',body:'Find your world, meet the community and make your next adventure a shared one.',image_url:'',link_url:'',link_label:''},{id:'worlds',type:'servers',title:'Find your world',body:'',image_url:'',link_url:'',link_label:''}]}]};
export function communityDesign(value){return value?.pages?.length?value:structuredClone(DEFAULT_DESIGN);}
export function applicationSettings(site,kind){const staff=kind==='staff';return{open:Boolean(site?.[staff?'staff_applications_open':'join_requests_open']??site?.applications_open),questions:site?.[staff?'staff_questions':'join_questions']||site?.questions||[]};}
