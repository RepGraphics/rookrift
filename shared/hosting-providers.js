const panel={start:true,stop:true,restart:true,backups:true,files:true,usage:true,uptime:true};
export const HOSTING_PROVIDERS=Object.freeze({
 pterodactyl:{name:'Pterodactyl',...panel},
 pelican:{name:'Pelican',...panel},
 nitrado:{name:'Nitrado',start:true,stop:true,restart:true,backups:false,files:false,usage:false,uptime:false}
});
export function hostingCapabilities(provider='pterodactyl'){return HOSTING_PROVIDERS[provider]||{name:'Unknown provider',start:false,stop:false,restart:false,backups:false,files:false,usage:false,uptime:false};}
export function assertHostingCapability(provider,feature){if(!hostingCapabilities(provider)[feature])throw Object.assign(new Error(hostingCapabilities(provider).name+' does not support '+({backups:'Rookrift backup creation and verification',files:'configuration deployment'}[feature]||feature)+' through this connector.'),{status:400});}
