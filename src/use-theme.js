import {useEffect,useState} from 'react';

export function useTheme({lightColor='#f3f5f7',darkColor='#191d23'}={}){
 const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('rookrift-theme')==='light'?'light':'dark';}catch{return 'dark';}});
 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?darkColor:lightColor);
  try{localStorage.setItem('rookrift-theme',theme);}catch{ /* Appearance still works when storage is unavailable. */ }
 },[theme,lightColor,darkColor]);
 useEffect(()=>{const sync=event=>{if(event.type==='storage'&&event.key!=='rookrift-theme')return;const value=event.type==='storage'?event.newValue:event.detail;if(['dark','light'].includes(value))setTheme(value);};window.addEventListener('storage',sync);window.addEventListener('rookrift-theme-change',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('rookrift-theme-change',sync);};},[]);
 const changeTheme=value=>{if(!['dark','light'].includes(value))return;setTheme(value);window.dispatchEvent(new CustomEvent('rookrift-theme-change',{detail:value}));};
 return{theme,setTheme:changeTheme,toggleTheme:()=>changeTheme(theme==='light'?'dark':'light')};
}
