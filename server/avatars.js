import {avatarSource,uploadedAvatar} from '../shared/avatar.js';
import {hash} from './crypto.js';

export function userAvatarUrl(user){
 if(uploadedAvatar(user.avatar))return '/api/account/avatars/'+encodeURIComponent(user.user_id||user.id)+'?v='+hash(user.avatar).slice(0,24);
 return avatarSource(user);
}
// Apply to explicitly selected account/member DTOs, never unrestricted user rows.
export function presentUser(user){const{avatar,discord_id,...rest}=user;return{...rest,avatar_url:userAvatarUrl(user)};}
export function avatarImage(value){const raw=uploadedAvatar(value);if(!raw)return null;const [header,base64]=raw.split(','),bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>3*1024*1024)return null;return{bytes,type:header.slice(5,-7),etag:'"'+hash(raw).slice(0,24)+'"'};}
