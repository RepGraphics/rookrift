import {parsePatch,previewPatch} from './config-ini.js';

const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const ark=['asa','ase'],gus='GameUserSettings.ini',ini='Game.ini',properties='server.properties',cfg='serverDZ.cfg',gameSection='/script/shootergame.shootergamemode';
export const CONFIG_FILES={asa:[gus,ini],ase:[gus,ini],minecraft:[properties],dayz:[cfg]};
export const CONFIG_SOURCES={ark:'https://ark.wiki.gg/wiki/Server_configuration',minecraft:'https://docs.papermc.io/paper/reference/server-properties/',dayz:'https://community.bistudio.com/wiki/DayZ:Server_Configuration'};
export const managedConfigGame=game=>ark.includes(game);
export function assertConfigFile(game,filename){if(!CONFIG_FILES[game]?.includes(filename))fail('Choose a supported configuration file for this game.');}
export const configFormat=game=>managedConfigGame(game)?'ini':game==='minecraft'?'properties':'dayz';
const number=(key,label,description,value=1,min=0,max=1000,step='any')=>({key,label,description,type:'number',default:String(value),min,max,step});
const choice=(key,label,description,options,value)=>({key,label,description,type:'choice',options,default:value});
const bool=(key,label,description,style='ini',value=false)=>choice(key,label,description,style==='dayz'?['0','1']:style==='ini'?['False','True']:['false','true'],style==='dayz'?String(Number(value)):style==='ini'?(value?'True':'False'):String(value));
const define=(games,filename,section,category,fields)=>fields.map(field=>({...field,games,filename,section,category}));
export const CONFIG_SETTINGS=[
 ...define(ark,gus,'ServerSettings','Progression',[
  number('XPMultiplier','Experience rate','Higher values award more experience.'),
  number('HarvestAmountMultiplier','Harvest yield','Higher values increase harvested resources.'),
  number('TamingSpeedMultiplier','Taming speed','Higher values speed up taming.'),
  number('PlayerCharacterFoodDrainMultiplier','Player food drain','Lower values reduce player food consumption.'),
  number('PlayerCharacterWaterDrainMultiplier','Player water drain','Lower values reduce player water consumption.')]),
 ...define(ark,gus,'ServerSettings','World & rules',[
  bool('ServerPVE','PvE mode','Disables normal player-versus-player combat.'),
  bool('ShowMapPlayerLocation','Show player map position','Shows players their own location on the map.'),
  bool('AllowThirdPersonPlayer','Third-person view','Allows third-person camera mode.'),
  bool('ServerCrosshair','Crosshair','Enables the server crosshair.'),
  number('DayCycleSpeedScale','Day cycle speed','Higher values shorten the entire day/night cycle.',1,0.01,100),
  number('DayTimeSpeedScale','Daytime speed','Lower values make daytime last longer.',1,0.01,100),
  number('NightTimeSpeedScale','Nighttime speed','Higher values make nights shorter.',1,0.01,100)]),
 ...define(ark,ini,gameSection,'Breeding',[
  number('EggHatchSpeedMultiplier','Egg hatching speed','Higher values shorten incubation.',1,0.01,1000),
  number('BabyMatureSpeedMultiplier','Baby maturation speed','Higher values shorten maturation. Check species-specific imprint timing.',1,0.01,1000),
  number('MatingIntervalMultiplier','Mating interval','Lower values shorten the mating cooldown.',1,0.01,100),
  number('BabyCuddleIntervalMultiplier','Imprint request interval','Lower values request care more often; test alongside maturation settings.',1,0.01,100)]),
 ...define(['minecraft'],properties,'','Gameplay',[
  choice('difficulty','Difficulty','Select the world difficulty.',['peaceful','easy','normal','hard'],'normal'),
  choice('gamemode','Default game mode','Applies to new players unless other rules override it.',['survival','creative','adventure','spectator'],'survival'),
  bool('force-gamemode','Force default game mode','Resets player mode to the server default when joining.','properties'),
  bool('hardcore','Hardcore mode','Death has permanent spectator consequences. Review carefully.','properties'),
  bool('pvp','Player combat','Allows players to damage each other.','properties',true),
  number('spawn-protection','Spawn protection radius','Protected radius in blocks; operator privileges affect enforcement.',16,0,1000,1)]),
 ...define(['minecraft'],properties,'','Capacity & access',[
  number('max-players','Player slots','Review your hosting allowance before increasing this limit.',20,1,1000,1),
  number('view-distance','View distance','Chunks sent around each player. Lower values reduce distance, not a performance guarantee.',10,3,32,1),
  number('simulation-distance','Simulation distance','Chunks simulated around players. Test with your server version and plugins.',10,3,32,1),
  number('player-idle-timeout','Idle timeout','Minutes before idle players are removed; 0 disables this timeout.',0,0,1440,1),
  bool('white-list','Enable whitelist','Add your players to the whitelist in your panel before enabling.','properties'),
  bool('enforce-whitelist','Enforce whitelist','Can remove connected players who are not whitelisted.','properties')]),
 ...define(['dayz'],cfg,'','Time & survival',[
  number('serverTimeAcceleration','Time acceleration','Speeds up the overall clock; 24 makes a full cycle one hour.',1,0.1,64),
  number('serverNightTimeAcceleration','Additional night acceleration','Multiplies the overall time rate during nighttime.',1,0.1,64),
  bool('serverTimePersistent','Persist world time','Resumes from the saved world time after restart.','dayz'),
  choice('thirdPersonView','Third-person camera','DayZ 1.30+: 0 disables, 1 enables, 2 allows it in vehicles only.',['0','1','2'],'1'),
  bool('disableCrosshair','Disable crosshair','Removes the crosshair.','dayz'),
  bool('disablePersonalLight','Disable personal light','Disables the personal light for connected clients.','dayz')]),
 ...define(['dayz'],cfg,'','Base protection',[
  bool('disableBaseDamage','Protect fences and watchtowers','Disables damage and destruction for these base structures.','dayz'),
  bool('disableContainerDamage','Protect storage containers','Disables damage to supported tents and storage containers.','dayz')])
];
export const configSettings=(game,filename)=>CONFIG_SETTINGS.filter(s=>s.games.includes(game)&&s.filename===filename);
export const settingIdentity=(game,section,key)=>managedConfigGame(game)?(section+'\0'+key).toLowerCase():key;
export const configSetting=(game,filename,entry)=>configSettings(game,filename).find(s=>settingIdentity(game,s.section,s.key)===settingIdentity(game,entry.section,entry.key));
export function validateSetting(setting,value){
 const text=String(value);if(setting.type==='choice'&&!setting.options.some(v=>managedConfigGame(setting.games[0])?v.toLowerCase()===text.toLowerCase():v===text))fail('Choose a supported value for '+setting.label+'.');
 if(setting.type==='number'&&(!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)||!Number.isFinite(Number(text))||Number(text)<setting.min||Number(text)>setting.max||(setting.step===1&&!/^\d+$/.test(text))))fail(setting.label+' must be '+(setting.step===1?'a whole number using digits':'a number')+' between '+setting.min+' and '+setting.max+'.');
}
function checkText(text,max=16000){if(typeof text!=='string'||text.length>max||/[\0\uFFFD]/.test(text))fail('Use supported UTF-8 configuration text within the file size limit.');}
export function parseConfigPatch(game,filename,body){
 assertConfigFile(game,filename);checkText(body);if(managedConfigGame(game))return parsePatch(body);
 const entries=[],seen=new Set();
 for(const raw of body.split(/\r?\n/)){
  const line=raw.trim();if(!line||/^[#!]/.test(line)||(game==='dayz'&&line.startsWith('//')))continue;
  const match=game==='minecraft'?line.match(/^([a-z][a-z0-9.-]*)\s*=\s*([^\\\r\n]*)$/):line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*([0-9.]+)\s*;$/);
  if(!match)fail('Use one supported '+(game==='minecraft'?'key=value property':'numeric key = value; assignment')+' per line.');
  const entry={section:'',key:match[1],value:match[2].trim(),identity:match[1]},setting=configSetting(game,filename,entry);
  if(!setting)fail('This export format accepts only settings in the guided catalogue. Credentials, connections and complex settings must stay in your hosting panel.');
  validateSetting(setting,entry.value);if(seen.has(entry.identity))fail('Each setting can appear only once in a patch.');seen.add(entry.identity);entries.push(entry);
 }
 if(!entries.length||entries.length>100)fail('Include 1-100 supported settings.');return entries;
}
export function serializeConfigEntries(game,filename,entries){
 assertConfigFile(game,filename);if(!managedConfigGame(game))return entries.map(e=>e.key+(game==='dayz'?' = ':'=')+e.value+(game==='dayz'?';':'')).join('\n')+'\n';
 const groups=new Map();for(const e of entries){const identity=e.section.toLowerCase(),group=groups.get(identity)||{section:e.section,lines:[]};group.lines.push(e.key+'='+e.value);groups.set(identity,group);}return [...groups.values()].map(g=>'['+g.section+']\n'+g.lines.join('\n')).join('\n\n')+'\n';
}
export function validateGuidedEntries(game,filename,entries){for(const e of entries){const setting=configSetting(game,filename,e);if(setting)validateSetting(setting,e.value);}return parseConfigPatch(game,filename,serializeConfigEntries(game,filename,entries));}
export function defaultConfigBody(game,filename){const s=configSettings(game,filename)[0];return serializeConfigEntries(game,filename,[{section:s.section,key:s.key,value:game==='asa'||game==='ase'?'2':s.default}]);}

// Imports return only recognised settings. Never return or retain the uploaded source.
function stripCfgComments(text){let out='',quoted=false,line=false,block=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(line){if(ch==='\n'){line=false;out+='\n';}continue;}if(block){if(ch==='*'&&next==='/'){block=false;i++;}else if(ch==='\n')out+='\n';continue;}if(quoted){out+=ch;if(ch==='\\'&&next){out+=next;i++;}else if(ch==='"')quoted=false;continue;}if(ch==='"'){quoted=true;out+=ch;}else if(ch==='/'&&next==='/'){line=true;i++;}else if(ch==='/'&&next==='*'){block=true;out+=' ';i++;}else out+=ch;}if(block||quoted)fail('Close quoted strings and block comments before importing this file.');return out;}
function extractSettings(text,game,filename){
 assertConfigFile(game,filename);checkText(text,262144);const entries=[],seen=new Set();let section='',skipped=0,depth=0;
 const cleaned=game==='dayz'?stripCfgComments(text):text.replace(/^\uFEFF/,'');
 for(const raw of cleaned.split(/\r?\n/)){
  const line=raw.trim();if(!line||/^[;#!]/.test(line))continue;
  if(managedConfigGame(game)&&/^\[[^\]\r\n]+\]$/.test(line)){section=line.slice(1,-1).trim();continue;}
  if(game==='dayz'){const structural=line.replace(/"(?:\\.|[^"\\])*"/g,'');const before=depth;depth+=(structural.match(/\{/g)||[]).length-(structural.match(/\}/g)||[]).length;if(depth<0)fail('The imported file has unbalanced class braces.');if(before||/[{}]/.test(structural)){skipped++;continue;}}
  const match=game==='dayz'?line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*([0-9.]+)\s*;$/):line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([^\r\n]*)$/);
  if(!match){skipped++;continue;}
  const entry={section:managedConfigGame(game)?section:'',key:match[1],value:match[2].trim()},setting=configSetting(game,filename,entry);
  if(!setting){skipped++;continue;}entry.section=setting.section;entry.key=setting.key;entry.identity=settingIdentity(game,entry.section,entry.key);validateSetting(setting,entry.value);if(managedConfigGame(game)&&setting.type==='choice')entry.value=setting.options.find(v=>v.toLowerCase()===entry.value.toLowerCase());
  if(seen.has(entry.identity))fail('The imported file repeats '+setting.label+'. Resolve duplicate values first.');seen.add(entry.identity);entries.push(entry);
 }
 if(depth)fail('The imported file has unbalanced class braces.');return{entries,skipped};
}
export function importConfigSettings(text,game,filename){const result=extractSettings(text,game,filename);if(!result.entries.length)fail('No recognised settings for this game and file were found.');return{...result,body:serializeConfigEntries(game,filename,result.entries)};}
export function compareConfigText(text,game,filename,body){const entries=parseConfigPatch(game,filename,body);checkText(text,262144);if(managedConfigGame(game))return previewPatch(text,body).changes;const source=extractSettings(text,game,filename).entries,values=new Map(source.map(e=>[e.identity,e.value]));return entries.filter(e=>values.get(e.identity)!==e.value).map(e=>({section:e.section,key:e.key,before:values.get(e.identity)??null,after:e.value}));}

const preset=(id,games,filename,category,name,description,note,values)=>({id,games,filename,category,name,description,note,body:serializeConfigEntries(games[0],filename,Object.entries(values).map(([key,value])=>({section:filename===ini?gameSection:filename===gus?'ServerSettings':'',key,value:String(value)})))});
export const CONFIG_PRESET_CATEGORIES={progression:'Progression',rules:'World & rules',breeding:'Breeding',performance:'Distances & capacity',access:'Player access'};
export const CONFIG_PRESETS=[
 preset('ark-standard',ark,gus,'progression','ARK standard rate baseline','Set XP, harvesting and taming multipliers to 1.','A multiplier of 1 is a baseline, not a promise of current official-server event rates.',{XPMultiplier:1,HarvestAmountMultiplier:1,TamingSpeedMultiplier:1}),
 preset('ark-weekend',ark,gus,'progression','ARK boosted weekend','Start with 2x XP, 2x harvesting and 3x taming.','These are example community rates. Existing difficulty, mods and other multipliers affect the result.',{XPMultiplier:2,HarvestAmountMultiplier:2,TamingSpeedMultiplier:3}),
 preset('ark-pve',ark,gus,'rules','ARK cooperative world','Enable PvE, map position, third-person view and a crosshair.','Review the impact of switching an existing world to PvE. This patch does not configure every PvE rule.',{ServerPVE:'True',ShowMapPlayerLocation:'True',AllowThirdPersonPlayer:'True',ServerCrosshair:'True'}),
 preset('ark-breeding',ark,ini,'breeding','ARK faster breeding','Start with faster incubation and maturation and a shorter mating cooldown.','Test imprint timing for your species. These values do not guarantee full imprinting or alter all breeding rules.',{EggHatchSpeedMultiplier:5,BabyMatureSpeedMultiplier:5,MatingIntervalMultiplier:0.5,BabyCuddleIntervalMultiplier:0.2}),
 preset('ark-daylight',ark,gus,'rules','ARK longer daylight','Slow daytime and shorten nighttime.','Rates affect the existing day/night cycle; they do not set a precise real-time day length.',{DayCycleSpeedScale:1,DayTimeSpeedScale:0.5,NightTimeSpeedScale:2}),
 preset('minecraft-survival',['minecraft'],properties,'rules','Minecraft community survival','Normal-difficulty survival with player combat disabled.','Versioned export only. Merge the patch into the active server.properties through your panel; keep authentication and RCON settings intact.',{gamemode:'survival',difficulty:'normal',pvp:'false',hardcore:'false'}),
 preset('minecraft-creative',['minecraft'],properties,'rules','Minecraft creative building','Creative mode with peaceful difficulty.','Forcing game mode changes players on joining. Review this choice and merge only these properties into the existing file.',{gamemode:'creative',difficulty:'peaceful','force-gamemode':'true',pvp:'false'}),
 preset('minecraft-distance',['minecraft'],properties,'performance','Minecraft shorter view distances','Start with an 8-chunk view and 6-chunk simulation distance.','Lower distances trade visibility for less work. Benchmark your own world and plugins; this is not a performance guarantee.',{'view-distance':8,'simulation-distance':6,'player-idle-timeout':20}),
 preset('minecraft-whitelist',['minecraft'],properties,'access','Minecraft whitelist access','Enable and enforce the player whitelist.','Add your own account and other permitted players in the panel first. Enforcing the whitelist may remove unlisted players.',{'white-list':'true','enforce-whitelist':'true'}),
 preset('dayz-daylight',['dayz'],cfg,'rules','DayZ accelerated clock','Use a 6x clock and an additional 2x night multiplier.','Manual patch export. DayZ uses the filename selected by its -config startup option; merge these assignments into that active file, preserving Missions and credentials.',{serverTimeAcceleration:6,serverNightTimeAcceleration:2,serverTimePersistent:1}),
 preset('dayz-perspective',['dayz'],cfg,'rules','DayZ first-person survival','Disable third-person camera, crosshair and personal light.','The thirdPersonView setting targets DayZ 1.30 or newer. Check your build before merging this patch. It is not a complete startup configuration.',{thirdPersonView:0,disableCrosshair:1,disablePersonalLight:1}),
 preset('dayz-bases',['dayz'],cfg,'rules','DayZ protected bases','Protect supported base structures and storage containers from damage.','This is not a complete PvE system and does not prevent every form of raiding. Mods can change behaviour.',{disableBaseDamage:1,disableContainerDamage:1})
];
export function configPresetDraft(id,game){const p=CONFIG_PRESETS.find(p=>p.id===id);if(!p||!p.games.includes(game))fail('Choose a preset matching this game.');return{name:p.name,game,filename:p.filename,body:p.body,summary:'Created from '+p.name,preset_info:{name:p.name,note:p.note}};}
