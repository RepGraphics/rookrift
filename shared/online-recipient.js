import {gameIdentifierKind,deliveryIdentifier} from './store-delivery.js';
export function onlineRecipient(game,kind,identifier,players){
 if(kind!==gameIdentifierKind(game)||!Array.isArray(players))return false;
 let value;try{value=deliveryIdentifier(identifier,kind);}catch{return false;}
 return players.some(line=>{if(typeof line!=='string')return false;const comma=line.lastIndexOf(',');if(comma<0)return false;const candidate=line.slice(comma+1).trim();return ['eos','battleye','minecraft'].includes(kind)?candidate.toLowerCase()===value.toLowerCase():candidate===value;});
}
