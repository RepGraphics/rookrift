const forbidden=/(password|secret|token|credential|webhook|licen[cs]e|apikey|accesskey|privatekey|signingkey|connectionstring|authorization|rcon)/i;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function parsePatch(text){
  if(typeof text!=='string'||text.length>16000||text.includes('\0'))fail('Use an INI patch of at most 16,000 characters.');
  let section='';const entries=[],seen=new Set();
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line||/^[;#]/.test(line))continue;
    if(/^\[[^\]\r\n]+\]$/.test(line)){section=line.slice(1,-1).trim();continue;}
    const match=line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*([^\r\n]*)$/);if(!match||!section)fail('Use [sections] followed by simple Key=Value settings. Unreal array operators and duplicate keys need manual editing.');
    const key=match[1],value=match[2],identity=section.toLowerCase()+'\0'+key.toLowerCase();if(forbidden.test((section+key).replace(/[^a-z0-9]/gi,'')))fail('Do not put credentials, webhook URLs, licence keys or RCON connection settings in templates.');if(seen.has(identity))fail('Each section/key can appear only once in a patch.');seen.add(identity);entries.push({section,key,value,identity});
  }
  if(!entries.length||entries.length>100)fail('Include 1–100 simple INI settings.');return entries;
}
export function previewPatch(source,patch){
  const entries=parsePatch(patch),newline=source.includes('\r\n')?'\r\n':'\n',lines=source.split(/\r?\n/),locations=new Map(),sections=new Map();let section='';
  for(let index=0;index<lines.length;index++){
    const line=lines[index].trim();if(/^\[[^\]\r\n]+\]$/.test(line)){section=line.slice(1,-1).trim();sections.set(section.toLowerCase(),index);continue;}
    const match=line.match(/^([^;#=][^=]*?)\s*=\s*(.*)$/);if(match&&section){const identity=section.toLowerCase()+'\0'+match[1].trim().toLowerCase();const values=locations.get(identity)||[];values.push({index,value:match[2]});locations.set(identity,values);}
  }
  const changes=[],append=new Map();
  for(const entry of entries){const matches=locations.get(entry.identity)||[];if(matches.length>1)fail('The target file has repeated values for '+entry.key+'. Resolve those manually before applying this patch.');const before=matches[0]?.value??null;if(before===entry.value)continue;changes.push({section:entry.section,key:entry.key,before,after:entry.value});if(matches.length)lines[matches[0].index]=entry.key+'='+entry.value;else{const list=append.get(entry.section)||[];list.push(entry.key+'='+entry.value);append.set(entry.section,list);}}
  for(const [name,settings]of [...append].sort((a,b)=>(sections.get(b[0].toLowerCase())??-1)-(sections.get(a[0].toLowerCase())??-1))){const header=sections.get(name.toLowerCase());if(header===undefined){if(lines.at(-1)!=='')lines.push('');lines.push('['+name+']',...settings,'');}else{let end=header+1;while(end<lines.length&&!/^\s*\[/.test(lines[end]))end++;lines.splice(end,0,...settings);}}
  return{content:lines.join(newline),changes};
}
export const configPath=(platform,filename)=>'/ShooterGame/Saved/Config/'+platform+'/'+filename;
