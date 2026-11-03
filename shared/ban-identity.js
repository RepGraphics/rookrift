export const ID_KINDS=['auto','eos','uuid','steam','game'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex32=/^[0-9a-f]{32}$/i;
export function normalizeIdentity(input,requested='auto') {
  if(typeof input!=='string'||!ID_KINDS.includes(requested))throw Object.assign(new Error('Enter a valid identifier and ID type.'),{status:400});
  let raw=input.trim(),kind=requested;
  const uuidText=raw.replace(/^urn:uuid:/i,'').replace(/^\{(.+)\}$/,'$1');
  if(kind==='auto')kind=uuid.test(uuidText)?'uuid':hex32.test(raw)?'eos':/^\d{17}$/.test(raw)?'steam':'game';
  let value,display;
  if(kind==='uuid') {
    if(!uuid.test(uuidText)&&!hex32.test(uuidText))throw Object.assign(new Error('Enter a UUID in hex-and-dash format, or 32 hexadecimal digits with UUID selected.'),{status:400});
    value=uuidText.replaceAll('-','').toLowerCase();display=`${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
  } else {
    if(!/^[A-Za-z0-9_-]{3,128}$/.test(raw))throw Object.assign(new Error('Use the exact server-reported ID, without spaces, wildcards, or command characters.'),{status:400});
    if(kind==='steam'&&!/^\d{17}$/.test(raw))throw Object.assign(new Error('Enter a 17-digit Steam64 ID.'),{status:400});
    // Common hexadecimal EOS tokens are normalized; other opaque tokens retain case.
    value=kind==='eos'&&hex32.test(raw)?raw.toLowerCase():raw;display=value;
  }
  return {kind,value,display,key:`${kind}:${value}`};
}
export function identityFromKey(key) {const colon=key.indexOf(':');return normalizeIdentity(key.slice(colon+1),key.slice(0,colon));}
export function tryIdentity(raw,kind='auto'){try{return normalizeIdentity(raw,kind);}catch{return null;}}
export const identityLabel=kind=>({eos:'EOSID',uuid:'UUID',steam:'Steam64',game:'Game ID',auto:'Auto-detect'})[kind]||'Game ID';
