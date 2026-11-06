import {createSocket} from 'node:dgram';
import {isIP} from 'node:net';
import {randomBytes} from 'node:crypto';
import {resolveTarget} from './games.js';

const invalid=message=>Object.assign(new Error(message),{code:'QUERY_FORMAT',status:502});
const integer=value=>typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):NaN;
const fields=value=>{
 const result={};
 if(typeof value.map==='string'&&value.map.trim()&&value.map.trim().length<=60&&!/[\x00-\x1f\x7f]/.test(value.map))result.map=value.map.trim();
 const max=integer(value.max_players);if(Number.isInteger(max)&&max>0&&max<=1000)result.max_players=max;
 const port=integer(value.query_port);if(Number.isInteger(port)&&port>0&&port<=65535)result.query_port=port;
 return result;
};
export {fields as cleanServerMetadata};
function stringAt(buffer,state){const end=buffer.indexOf(0,state.offset);if(end<0||end-state.offset>1024)throw invalid('Invalid query string.');const text=buffer.toString('utf8',state.offset,end);state.offset=end+1;return text;}
export function parseA2sInfo(packet){
 const data=packet.length>=4&&packet.readInt32LE(0)===-1?packet.subarray(4):packet;
 if(data.length<2||data[0]!==0x49)throw invalid('Unsupported A2S info response.');
 const state={offset:2};stringAt(data,state);const map=stringAt(data,state);stringAt(data,state);stringAt(data,state);
 if(data.length<state.offset+9)throw invalid('Truncated A2S info response.');
 const max_players=data[state.offset+3];state.offset+=9;stringAt(data,state);
 return fields({map,max_players});
}
export function parseMinecraftQuery(packet,session){
 if(packet.length<16||packet[0]!==0||!packet.subarray(1,5).equals(session)||!packet.subarray(5,16).equals(Buffer.from('splitnum\0\x80\0','binary')))throw invalid('Unsupported Minecraft Query response.');
 const state={offset:16},values=Object.create(null);let ended=false;
 for(let n=0;n<512&&state.offset<packet.length;n++){const key=stringAt(packet,state);if(!key){ended=true;break;}values[key]=stringAt(packet,state);}
 if(!ended)throw invalid('Truncated Minecraft Query fields.');return fields({map:values.map,max_players:values.maxplayers});
}
async function query({host,port,timeout=1800,resolve=resolveTarget},mode){
 if(!Number.isInteger(port)||port<1||port>65535)throw Object.assign(new Error('Enter a valid query port.'),{status:400});
 const address=await resolve(host);
 return new Promise((resolve,reject)=>{
  const socket=createSocket(isIP(address)===6?'udp6':'udp4'),parts=new Map(),session=Buffer.from(randomBytes(4).map(value=>value&15));
  let done=false,bytes=0,count=0,challengeCount=0,splitId=null,total=0,requested=false;
  const initial=Buffer.concat([Buffer.from([255,255,255,255,0x54]),Buffer.from('Source Engine Query\0')]);
  const timer=setTimeout(()=>finish(Object.assign(new Error('Server query timed out.'),{code:'QUERY_TIMEOUT'})),timeout);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);try{socket.close();}catch{}if(error)reject(error);else resolve(value);}
  const send=body=>socket.send(body,error=>{if(error)finish(error);});
  socket.on('error',finish);
  socket.on('message',packet=>{
   if(done)return;if(++count>128||(bytes+=packet.length)>262144){finish(invalid('Server query response exceeded its size limit.'));return;}
   try{
    if(mode==='minecraft'){
     if(packet.length<5||!packet.subarray(1,5).equals(session))return;
     if(packet[0]===9&&!requested){const text=packet.subarray(5).toString('ascii').replace(/\0$/,'');if(!/^-?\d{1,11}$/.test(text))throw invalid('Invalid Minecraft Query challenge.');const challenge=Number(text);if(challenge< -2147483648||challenge>2147483647)throw invalid('Invalid Minecraft Query challenge.');const token=Buffer.alloc(4);token.writeInt32BE(challenge);requested=true;send(Buffer.concat([Buffer.from([0xfe,0xfd,0]),session,token,Buffer.alloc(4)]));}
     else if(packet[0]===0&&requested)finish(null,parseMinecraftQuery(packet,session));
     return;
    }
    if(packet.length<5)return;const header=packet.readInt32LE(0);
    if(header===-1&&packet[4]===0x41){if(packet.length!==9||++challengeCount>2)throw invalid('Invalid A2S challenge.');send(Buffer.concat([initial,packet.subarray(5,9)]));return;}
    if(header===-2){
     if(packet.length<12)throw invalid('Truncated A2S split header.');const id=packet.readUInt32LE(4),size=packet[8],index=packet[9];
     if(id&0x80000000)throw invalid('Compressed A2S responses are not supported.');
     if(!size||size>64||index>=size)throw invalid('Invalid A2S split response.');
     if(splitId===null){splitId=id;total=size;}if(splitId!==id)return;if(total!==size)throw invalid('Conflicting A2S split response.');
     const part=packet.subarray(12);if(parts.has(index)&&!parts.get(index).equals(part))throw invalid('Conflicting A2S fragment.');parts.set(index,part);
     if(parts.size===total)finish(null,parseA2sInfo(Buffer.concat(Array.from({length:total},(_,i)=>parts.get(i)))));
    }else if(header===-1&&packet[4]===0x49)finish(null,parseA2sInfo(packet));
   }catch(error){finish(error);}
  });
  socket.connect(port,address,()=>send(mode==='minecraft'?Buffer.concat([Buffer.from([0xfe,0xfd,9]),session]):initial));
 });
}
export const a2sInfo=options=>query(options,'a2s');
export const minecraftQuery=options=>query(options,'minecraft');
