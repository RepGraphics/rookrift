const formatters=new Map();
export function windowActive(window, now = Date.now()) {
  if (!window.enabled || window.paused) return false;
  try {
    if(!formatters.has(window.time_zone)){if(formatters.size>=128)formatters.clear();formatters.set(window.time_zone,new Intl.DateTimeFormat('en-GB',{timeZone:window.time_zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));}
    const parts=Object.fromEntries(formatters.get(window.time_zone).formatToParts(new Date(now)).map(part=>[part.type,part.value]));
    const day=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday);
    const [hour,minute]=window.start_time.split(':').map(Number);
    let elapsed=Number(parts.hour)*60+Number(parts.minute)-hour*60-minute,startDay=day;
    if(elapsed<0){elapsed+=1440;startDay=(day+6)%7;}
    const days=typeof window.days==='string'?JSON.parse(window.days):window.days;
    return days.includes(startDay)&&elapsed<window.duration_minutes;
  }catch{return false;}
}
export function renderAnnouncement(body,server) {
  return body.replace(/\{(server|map|players|cluster)\}/g,(_,key)=>String(({server:server.name,map:server.map,players:server.players,cluster:server.cluster||'Ungrouped'})[key]));
}
export const inMaintenance=server=>Boolean(server.in_maintenance??server.maintenance);
