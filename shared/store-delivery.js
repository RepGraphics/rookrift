export const DELIVERY_ID_KINDS={numeric:'Numeric in-game PlayerID',eos:'EOS ID',steam:'Steam64 ID',minecraft:'Minecraft Java username',battleye:'BattlEye GUID',uuid:'UUID',game:'Game / plugin account ID'};
export const gameIdentifierKind=game=>({asa:'eos',ase:'steam',minecraft:'minecraft',dayz:'battleye'})[game]||'game';
export const gameIdentifierLabel=game=>DELIVERY_ID_KINDS[gameIdentifierKind(game)];
export const deliveryKindsForGame=game=>[gameIdentifierKind(game),...(['asa','ase'].includes(game)?['numeric']:[]),'uuid','game'].filter((value,index,all)=>all.indexOf(value)===index);
export function publicDelivery(actions,game){const commands=actions.filter(a=>a.type==='rcon');return{automatic:actions.length>0,commands:commands.length,discord_roles:actions.filter(a=>a.type==='discord_role').length,waits_for_player:commands.some(a=>a.require_online),requires_identifier:commands.length>0||actions.length===0,identifier_kind:commands[0]?.identity_kind||gameIdentifierKind(game)};}
export function deliveryIdentifier(value,kind='game'){
 if(typeof value!=='string')throw Object.assign(new Error('Enter a recipient identifier.'),{status:400});
 const id=value.trim(),patterns={numeric:/^[1-9][0-9]{0,19}$/,eos:/^[a-f0-9]{32}$/i,steam:/^[0-9]{17}$/,minecraft:/^[A-Za-z0-9_]{3,16}$/,battleye:/^[a-f0-9]{32}$/i,uuid:/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,game:/^[A-Za-z0-9_-]{3,100}$/};
 if(!patterns[kind]?.test(id))throw Object.assign(new Error('Enter a valid '+(DELIVERY_ID_KINDS[kind]||'recipient identifier')+'.'),{status:400});return id;
}
export function validatePurchaseCommand(command){
 if(typeof command!=='string'||!command.trim()||command.length>600||/[\x00-\x1f\x7f;|]/.test(command))throw Object.assign(new Error('Use one command, up to 600 characters, without control characters or command separators.'),{status:400});return command.trim();
}
export function renderPurchaseCommand(template,identifier,kind,orderId){
 validatePurchaseCommand(template);if(!template.includes('{identifier}')||/\{(?!identifier\}|order_id\})[A-Za-z_][A-Za-z0-9_]*\}/.test(template))throw Object.assign(new Error('Include {identifier}; only {identifier} and {order_id} placeholders are supported.'),{status:400});
 return validatePurchaseCommand(template.replaceAll('{identifier}',deliveryIdentifier(identifier,kind)).replaceAll('{order_id}',orderId));
}
