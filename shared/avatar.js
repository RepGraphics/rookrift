const image=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export function uploadedAvatar(value){return typeof value==='string'&&value.length<=4194404&&image.test(value)?value:null;}
export function avatarSource(user={},size=128){
 const upload=uploadedAvatar(user?.avatar);if(upload)return upload;
 const url=user?.avatar_url;
 if(typeof url==='string'&&(/^\/api\/account\/avatars\/[a-z0-9_-]+\?v=[a-f0-9]{24}$/i.test(url)||uploadedAvatar(url)||/^https:\/\/cdn\.discordapp\.com\/avatars\/\d{17,20}\/(?:a_)?[a-f0-9]{32}\.(?:png|webp|gif)\?size=(?:32|64|128|256|512)$/i.test(url)))return url;
 const id=user?.discord_id||user?.user_id||user?.id,hash=user?.avatar;
 if(!/^\d{17,20}$/.test(id||'')||!/^(?:a_)?[a-f0-9]{32}$/i.test(hash||''))return null;
 const pixels=[32,64,128,256,512].find(n=>n>=size)||512;
 return 'https://cdn.discordapp.com/avatars/'+id+'/'+hash+'.'+(hash.startsWith('a_')?'gif':'png')+'?size='+pixels;
}
export function avatarInitials(name){const parts=String(name||'').trim().split(/\s+/u).filter(Boolean);return parts.length?parts.slice(0,2).map(part=>Array.from(part)[0]).join('').toLocaleUpperCase():'?';}
