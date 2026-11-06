const formatError=game=>Object.assign(new Error(game+' player list format is unsupported. Check the server response and enabled plugins.'),{status:502,code:'PLAYER_LIST_FORMAT'});
export function minecraftPlayers(output){
 const clean=output.replace(/\u00a7[0-9a-fk-or]/gi,'').trim(),match=clean.match(/^There are (\d+) of a max of \d+ players online:\s*(.*)$/is);if(!match)throw formatError('Minecraft');
 const names=match[2].trim()?match[2].split(',').map(n=>n.trim()):[];if(names.length!==Number(match[1])||names.some(n=>!/^\w{3,16}$/.test(n)))throw formatError('Minecraft');return names.map(name=>name+', '+name);
}
export function battleyePlayers(output){
 const footer=output.match(/\((\d+) players? in total\)/i),players=[];
 for(const line of output.split(/\r?\n/)){const match=line.match(/^\s*\d+\s+\S+\s+\d+\s+([a-f0-9]{32})(?:\s*\([^)]*\))?\s+(.+?)\s*$/i);if(match)players.push(match[2].replace(/[\x00-\x1f\x7f]/g,'').trim()+', '+match[1].toLowerCase());}
 if(!footer||Number(footer[1])!==players.length)throw formatError('DayZ');return players;
}
