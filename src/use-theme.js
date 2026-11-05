import {useEffect,useState} from 'react';

export function useTheme({lightColor='#f3f5f7',darkColor='#191d23'}={}){
 const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('rookrift-theme')==='light'?'light':'dark';}catch{return 'dark';}});
 useEffect(()=>{
  document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?darkColor:lightColor);
  try{localStorage.setItem('rookrift-theme',theme);}catch{ /* Appearance still works when storage is unavailable. */ }
 },[theme,lightColor,darkColor]);
 return{theme,toggleTheme:()=>setTheme(value=>value==='light'?'dark':'light')};
}
