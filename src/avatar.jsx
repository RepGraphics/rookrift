import React,{useEffect,useState} from 'react';
import {avatarSource,avatarInitials} from '../shared/avatar';
import './avatar.css';

export function Avatar({user,size=34,className='',label,decorative=false}){
 const source=avatarSource(user,Math.min(512,size*2)),[failed,setFailed]=useState(null),name=user?.name||user?.username||'Account',description=label||name+' profile picture';
 useEffect(()=>{setFailed(null);},[source]);
 return <span className={'account-avatar '+className} style={{'--avatar-size':size+'px'}} {...(decorative?{'aria-hidden':true}:{role:'img','aria-label':description})}>{source&&failed!==source?<img key={source} src={source} alt="" width={size} height={size} decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(source)}/>:<span className="account-avatar-initials">{avatarInitials(name)}</span>}</span>;
}
