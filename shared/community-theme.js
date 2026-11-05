export const DEFAULT_APPEARANCE={mode:'dark',accent:'',hero_image_url:'',hero_overlay:75,hero_alignment:'left',hero_size:'comfortable',content_width:'wide',card_style:'soft',corners:'rounded',heading_font:'manrope',show_stats:true,allow_theme_toggle:true,footer_text:'Survival, together.',sections:{servers:true,news:true,events:true,rules:true}};
export const COMMUNITY_PALETTES={
 forest:{bg:'#141d1b',panel:'#1e2a25',accent:'#b8d4c2',light:'#eef4ef',ink:'#275441'},
 ocean:{bg:'#121d26',panel:'#1c2a36',accent:'#a8cfe5',light:'#eef4f8',ink:'#295975'},
 slate:{bg:'#171b23',panel:'#242a36',accent:'#bcc9e0',light:'#f0f2f6',ink:'#43597a'},
 ember:{bg:'#241b18',panel:'#30251f',accent:'#e5bba5',light:'#f8f1ec',ink:'#82503b'},
 violet:{bg:'#1d1928',panel:'#282236',accent:'#d0b9eb',light:'#f4f0f8',ink:'#66468c'},
 sand:{bg:'#211f19',panel:'#2c2a23',accent:'#dacda9',light:'#f5f3eb',ink:'#65582d'}
};
export function appearanceOf(design){const value=design?.appearance||{};return{...DEFAULT_APPEARANCE,...value,sections:{...DEFAULT_APPEARANCE.sections,...value.sections}};}
const channels=color=>color.slice(1).match(/../g).map(h=>parseInt(h,16));
export const mixColor=(a,b,weight)=>'#'+channels(a).map((v,i)=>Math.round(v*(1-weight)+channels(b)[i]*weight).toString(16).padStart(2,'0')).join('');
function luminance(color){const c=channels(color).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
export const colorContrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
function readable(color,backgrounds){const target=luminance(backgrounds[0])>.4?'#17251f':'#f1f6f3';for(let n=0;n<=20;n++){const candidate=mixColor(color,target,n/20);if(backgrounds.every(bg=>colorContrast(candidate,bg)>=4.5))return candidate;}return target;}
export function communityTheme(design,modeOverride){
 const a=appearanceOf(design),p=COMMUNITY_PALETTES[design?.theme]||COMMUNITY_PALETTES.forest,dark=(modeOverride||a.mode)!=='light',bg=dark?p.bg:p.light,panel=dark?p.panel:'#ffffff',raw=/^#[a-f0-9]{6}$/i.test(a.accent)?a.accent:dark?p.accent:p.ink;
 const on=colorContrast(raw,'#ffffff')>colorContrast(raw,'#000000')?'#ffffff':'#000000';
 return{'--bg':bg,'--panel':panel,'--surface-alt':dark?mixColor(panel,'#ffffff',.025):mixColor(p.light,'#ffffff',.5),'--surface-hover':mixColor(panel,dark?'#ffffff':'#17251f',.07),'--line':mixColor(panel,dark?'#ffffff':'#17251f',.17),'--line-strong':mixColor(panel,dark?'#ffffff':'#17251f',.3),'--heading':dark?'#f1f6f3':'#1c2a25','--text':dark?'#d4dfd9':'#33463c','--muted':dark?'#aebfb4':'#56695d','--soft':dark?'#aebfb4':'#56695d','--accent':readable(raw,[panel,bg]),'--accent-soft':mixColor(panel,raw,.08),'--brand':raw,'--primary':raw,'--primary-hover':mixColor(raw,on==='#ffffff'?'#000000':'#ffffff',.1),'--on-primary':on,'--radius':a.corners==='square'?'3px':a.corners==='soft'?'20px':'11px','--community-font':a.heading_font==='dm-sans'?"'DM Sans',sans-serif":"Manrope,sans-serif"};
}
