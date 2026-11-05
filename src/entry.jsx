import React,{lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight} from 'lucide-react';
import {LandingPage} from './landing-page';
import {siteRoute} from '../shared/navigation';
import './styles.css';

const Dashboard=lazy(()=>import('./main').then(module=>({default:module.App})));
const Authentication=lazy(()=>import('./main').then(module=>({default:module.AuthPage})));
const Community=lazy(()=>import('./community-ui').then(module=>({default:module.CommunityPortal})));
const Administration=lazy(()=>import('./platform-admin-ui').then(module=>({default:module.AdminApp})));

export function SiteRouter({pathname=window.location.pathname,search=window.location.search,hash=window.location.hash}){
 const route=siteRoute(pathname,search,hash),demo=__DEMO__;
 let content;
 if(route.page==='landing')return <LandingPage demo={demo}/>;
 if(route.page==='login'||route.page==='register')content=<Authentication register={route.page==='register'}/>;
 else if(route.page==='dashboard')content=<Dashboard/>;
 else if(route.page==='admin')content=<Administration/>;
 else if(route.page==='community')content=<Community slug={route.slug} demo={demo}/>;
 else return <main className="route-missing"><img src="/brand/favicon-64.png" alt="Rookrift" width="48" height="48"/><h1>This page has wandered off.</h1><p>Head back to Rookrift to find your way.</p><a className="button" href="/">Back to home <ArrowRight size={16}/></a></main>;
 return <Suspense fallback={<main className="route-missing" role="status"><img src="/brand/favicon-64.png" alt="Rookrift" width="48" height="48"/><p>Opening Rookrift…</p></main>}>{content}</Suspense>;
}
if(document.getElementById('root'))createRoot(document.getElementById('root')).render(<SiteRouter/>);
