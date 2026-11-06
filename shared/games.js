const ark=['status','players','chat','save','broadcast','direct','kick','ban','unban','purchase'];
export const GAMES={
 asa:{id:'asa',name:'ARK: Survival Ascended',short:'ARK Survival Ascended',protocol:'source-rcon',port:27020,available:true,actions:ark,identity:'eos',linking:true,configuration:true},
 ase:{id:'ase',name:'ARK: Survival Evolved',short:'ARK Survival Evolved',protocol:'source-rcon',port:27020,available:true,actions:ark,identity:'steam',linking:true,configuration:true},
 minecraft:{id:'minecraft',name:'Minecraft Java',short:'Minecraft Java',protocol:'source-rcon',port:25575,available:true,beta:true,actions:['status','players','save','broadcast','direct','kick','ban','unban','purchase'],identity:'minecraft',linking:false,configuration:false},
 dayz:{id:'dayz',name:'DayZ',short:'DayZ',protocol:'battleye',port:2306,available:true,beta:true,actions:['status','players','broadcast','ban','purchase'],identity:'battleye',linking:false,configuration:false}
};
export const GAME_IDS=Object.keys(GAMES);
export const gameName=id=>GAMES[id]?.short||id;
export const supportsAction=(game,action)=>Boolean(GAMES[game]?.actions.includes(action));
export function assertGameAction(game,action){if(!supportsAction(game,action))throw Object.assign(new Error((GAMES[game]?.name||'This game')+' does not support this '+action+' action. Use its supported controls or a compatible hosting integration.'),{status:400});}
