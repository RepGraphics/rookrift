import React from 'react';
import {render,screen,cleanup,waitFor,act,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../src/main';
import {AdminApp} from '../src/platform-admin-ui';
import {loadDemo,storeDemo} from '../src/demo';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/dashboard');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

test('reloading restores Community hub, Store & orders, Store settings from the URL',async()=>{
 const user=userEvent.setup(),view=render(<App/>);await user.click(screen.getByRole('button',{name:'Community hub'}));await user.click(await screen.findByRole('button',{name:'Store & orders'}));await user.click(await screen.findByRole('button',{name:'Store settings'}));expect(screen.getByLabelText('Store currency')).toBeTruthy();const p=new URLSearchParams(window.location.search);expect(p.get('view')).toBe('community');expect(p.get('community')).toBe('store');expect(p.get('store')).toBe('settings');view.unmount();render(<App/>);expect(await screen.findByLabelText('Store currency')).toBeTruthy();expect(screen.queryByRole('heading',{name:'Overview'})).toBeNull();
});
test('deep links and browser history restore sibling and parent sections without saved form data',async()=>{
 window.history.replaceState(null,'','/dashboard?view=community&community=store&store=settings');const user=userEvent.setup();render(<App/>);await screen.findByLabelText('Store currency');await user.click(screen.getByRole('button',{name:'Categories'}));await screen.findByRole('heading',{name:'Store categories'});await act(async()=>window.history.back());await screen.findByLabelText('Store currency');await act(async()=>window.history.forward());await screen.findByRole('heading',{name:'Store categories'});await user.click(screen.getByRole('button',{name:/^Game servers/}));expect(new URLSearchParams(window.location.search).get('view')).toBe('servers');await act(async()=>window.history.back());expect(await screen.findByRole('heading',{name:'Store categories'})).toBeTruthy();
});
test('player, workflow, configuration, operations and account sections survive a remount',async()=>{
 for(const [address,locate]of [
 ['/dashboard?view=players&players=bans',()=>screen.findByRole('tab',{name:'Ban lookup'})],
 ['/dashboard?view=configuration&configuration=history',()=>screen.findByRole('button',{name:'Deployment history'})],
 ['/dashboard?view=workflows&workflows=runs',()=>screen.findByRole('button',{name:/Run history/})],
 ['/dashboard?view=operations&operations=hosting',()=>screen.findByRole('tab',{name:'Hosting & backups'})],
 ['/dashboard?view=account&account=appearance',()=>screen.findByLabelText('Dashboard appearance')]
 ]){window.history.replaceState(null,'',address);const first=render(<App/>);const before=await locate();expect(before.getAttribute('aria-selected')==='true'||before.className.includes('selected')||before.tagName==='SELECT').toBe(true);first.unmount();const second=render(<App/>);await locate();second.unmount();}
});
test('admin settings reopen their chosen category after a reload',async()=>{
 const data={user:{id:'root',name:'Root'},csrf:'fixture',settings:{},users:[],workspaces:[]};vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>data})));window.history.replaceState(null,'','/admin?admin=settings&integration=discord');let view=render(<AdminApp/>);await screen.findByLabelText('Bot token');expect(screen.queryByRole('heading',{name:'Platform users'})).toBeNull();view.unmount();view=render(<AdminApp/>);await screen.findByLabelText('Bot token');
});
test('invalid view values fall back safely and OAuth deletion/settings aliases still select their page',async()=>{
 window.history.replaceState(null,'','/dashboard?view=https://example.com&community=unknown');const first=render(<App/>);expect(screen.getByRole('heading',{name:'Overview'})).toBeTruthy();first.unmount();window.history.replaceState(null,'','/dashboard?account=discord');const next=render(<App/>);expect(await screen.findByRole('heading',{name:'Sign-in & security'})).toBeTruthy();next.unmount();window.history.replaceState(null,'','/dashboard?settings=discord');render(<App/>);expect(await screen.findByLabelText(/^Discord server ID/)).toBeTruthy();
});

test('staff reloads restore permitted sections and unsupported owner-only pages fall back to their server list',async()=>{
 const data=loadDemo();data.access={role:'viewer',server_ids:['d1']};data.servers=data.servers.filter(s=>s.id==='d1');storeDemo(data);window.history.replaceState(null,'','/dashboard?view=configuration&configuration=history');let view=render(<App/>);const button=await screen.findByRole('button',{name:'Deployment history'});expect(button.className.includes('selected')).toBe(true);view.unmount();view=render(<App/>);expect((await screen.findByRole('button',{name:'Deployment history'})).className.includes('selected')).toBe(true);view.unmount();window.history.replaceState(null,'','/dashboard?view=community&community=store&store=settings');render(<App/>);expect(await screen.findByRole('heading',{name:'Permitted game servers'})).toBeTruthy();expect(screen.queryByLabelText('Store currency')).toBeNull();
});
