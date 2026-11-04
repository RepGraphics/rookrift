const formatters=new Map();
const weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function formatter(zone){if(!formatters.has(zone)){if(formatters.size>=128)formatters.clear();formatters.set(zone,new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));}return formatters.get(zone);}
const parts=(format,time)=>Object.fromEntries(format.formatToParts(time).map(p=>[p.type,p.value]));
const stamp=p=>Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
export function validTimeZone(zone){try{formatter(zone);return true;}catch{return false;}}
// One occurrence per local calendar day. Skip nonexistent DST times; use the first repeated time.
export function nextRun(task,after=Date.now()){
  if(task.schedule_type!=='weekly')return after+task.interval_minutes*60000;
  const fmt=formatter(task.time_zone),today=parts(fmt,after),start=Date.UTC(+today.year,+today.month-1,+today.day),days=typeof task.days==='string'?JSON.parse(task.days):task.days;
  const [hour,minute]=task.start_time.split(':').map(Number);
  for(let day=0;day<=8;day++){
    const date=new Date(start+day*86400000);if(!days.includes(date.getUTCDay()))continue;
    const wanted=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate(),hour,minute);let estimate=wanted;
    for(let n=0;n<4;n++)estimate+=wanted-stamp(parts(fmt,estimate));
    const matches=[];for(let offset=-120;offset<=120;offset+=30){const candidate=estimate+offset*60000;if(stamp(parts(fmt,candidate))===wanted)matches.push(candidate);}
    const first=Math.min(...matches);if(Number.isFinite(first)&&first>after)return first;
  }
  throw new Error('No valid scheduled time in the next eight days.');
}
export function scheduleLabel(task){if(task.schedule_type!=='weekly')return `Every ${task.interval_minutes<60?task.interval_minutes+'m':task.interval_minutes/60+'h'}`;const days=typeof task.days==='string'?JSON.parse(task.days):task.days;return `${days.length===7?'Daily':days.map(d=>weekday[d]).join(', ')} · ${task.start_time} ${task.time_zone}`;}
