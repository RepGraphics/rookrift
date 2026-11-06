import {createSocket} from 'node:dgram';
import {isIP} from 'node:net';
const MAX_BYTES=1024*1024;
const table=Array.from({length:256},(_,i)=>{let n=i;for(let b=0;b<8;b++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function battleyeCrc(data){let crc=0xffffffff;for(const byte of data)crc=table[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
export function battleyePacket(payload){const packet=Buffer.alloc(payload.length+7);packet.write('BE');packet[6]=255;payload.copy(packet,7);packet.writeUInt32LE(battleyeCrc(packet.subarray(6)),2);return packet;}
// A command is sent once. UDP loss produces a timeout, never a blind replay of
// a potentially successful game command. The delivery queue handles uncertainty.
export function battleyeRcon({host,port,password,command,timeout=7000}){
 if(!/^[\x20-\x7e]+$/.test(password)||!command||/[^\x20-\x7e]/.test(command))return Promise.reject(Object.assign(new Error('BattlEye requires plain ASCII credentials and commands.'),{status:400}));
 return new Promise((resolve,reject)=>{
  const socket=createSocket(isIP(host)===6?'udp6':'udp4'),parts=new Map();let done=false,authenticated=false,total=0,bytes=0,packets=0;
  const timer=setTimeout(()=>finish(new Error('BattlEye RCON timed out.')),timeout);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);const close=()=>{try{socket.close();}catch{}};if(authenticated){try{socket.send(battleyePacket(Buffer.concat([Buffer.from([1,1]),Buffer.from('logout')])),close);}catch{close();}}else close();if(error)reject(error);else resolve(value);}
  function send(payload){socket.send(battleyePacket(payload),error=>{if(error)finish(error);});}
  socket.on('error',finish);
  socket.on('message',packet=>{
   if(done)return;if(++packets>4096||(bytes+=packet.length)>MAX_BYTES){finish(new Error('BattlEye response exceeds the size limit.'));return;}
   if(packet.length<8||packet[0]!==66||packet[1]!==69||packet[6]!==255||packet.readUInt32LE(2)!==battleyeCrc(packet.subarray(6)))return;
   const body=packet.subarray(7),type=body[0];
   if(type===2&&body.length>=2){send(Buffer.from([2,body[1]]));return;}
   if(!authenticated&&type===0){if(body.length!==2||body[1]!==1){finish(new Error('BattlEye RCON authentication failed.'));return;}authenticated=true;send(Buffer.concat([Buffer.from([1,0]),Buffer.from(command,'ascii')]));return;}
   if(!authenticated||type!==1||body.length<2||body[1]!==0)return;
   const value=body.subarray(2);if(value.length&&value[0]===0){if(value.length<3||!value[1]||value[2]>=value[1]||(total&&total!==value[1])){finish(new Error('Invalid BattlEye multipart response.'));return;}total=value[1];const index=value[2],chunk=value.subarray(3);if(parts.has(index)&&!parts.get(index).equals(chunk)){finish(new Error('Conflicting BattlEye multipart response.'));return;}parts.set(index,chunk);if(parts.size===total)finish(null,Buffer.concat(Array.from({length:total},(_,i)=>parts.get(i))).toString('utf8'));}
   else if(total)finish(new Error('Invalid mixed BattlEye response.'));else finish(null,value.toString('utf8'));
  });
  socket.connect(port,host,()=>send(Buffer.concat([Buffer.from([0]),Buffer.from(password,'ascii')])));
 });
}
