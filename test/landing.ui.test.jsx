import React from 'react';
import {render,screen,within,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LandingPage} from '../src/landing-page';
import {SiteRouter} from '../src/entry';
import {AuthPage,LoginPage} from '../src/main';
import {PLANS} from '../server/plans';

beforeEach(()=>{localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

test('the public homepage showcases the service before requesting account details',()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<SiteRouter/>);
 expect(screen.getByRole('heading',{level:1,name:/Your worlds/})).toBeTruthy();expect(screen.getByRole('link',{name:'Get started free'}).getAttribute('href')).toBe('/register');expect(within(screen.getByRole('banner')).getByRole('link',{name:'Sign in'}).getAttribute('href')).toBe('/login');
 expect(screen.queryByLabelText('Password')).toBeNull();expect(fetch).not.toHaveBeenCalled();expect(localStorage.getItem('rookrift-demo-v1')).toBeNull();
 expect(screen.getByText('Product preview · Example data')).toBeTruthy();expect(screen.getByRole('link',{name:'Explore the demo'}).getAttribute('href')).toBe('/dashboard');
});
test('pricing uses the app plan values and preserves the selected paid plan',()=>{
 render(<LandingPage/>);for(const p of Object.values(PLANS)){const card=screen.getByRole('heading',{name:p.name}).closest('article');expect(within(card).getByText(p.servers+' game servers')).toBeTruthy();expect(within(card).getByText(p.schedules+' scheduled automations')).toBeTruthy();expect(card.textContent).toContain(p.price===0?'Free':p.price.toFixed(2));expect(within(card).getByRole('link').getAttribute('href')).toBe('/register'+(p.price?'?plan='+p.id:''));}
 expect(screen.getByText(/Game hosting is purchased separately/)).toBeTruthy();
});
test('feature tour works with tabs and keyboard navigation and labels its examples',async()=>{
 const user=userEvent.setup();render(<LandingPage/>);const automation=screen.getByRole('tab',{name:'Automate the routine'});expect(automation.getAttribute('aria-selected')).toBe('true');
 await user.click(screen.getByRole('tab',{name:'Stay close in Discord'}));expect(screen.getByRole('heading',{name:'Your community is already here.'})).toBeTruthy();expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('tour-tab-discord');
 await user.keyboard('{ArrowRight}');expect(screen.getByRole('heading',{name:'A proper home for your players.'})).toBeTruthy();expect(screen.getByRole('tab',{name:'Make it your community'}).getAttribute('aria-selected')).toBe('true');
 await user.keyboard('{Home}');expect(screen.getByRole('heading',{name:'A little setup. A lot less repetition.'})).toBeTruthy();
});
test('mobile navigation opens and closes with links or Escape and FAQ disclosures expand',async()=>{
 const user=userEvent.setup();render(<LandingPage/>);await user.click(screen.getByRole('button',{name:'Open navigation'}));expect(screen.getByRole('button',{name:'Close navigation'}).getAttribute('aria-expanded')).toBe('true');await user.keyboard('{Escape}');expect(screen.getByRole('button',{name:'Open navigation'}).getAttribute('aria-expanded')).toBe('false');
 await user.click(screen.getByRole('button',{name:'Open navigation'}));await user.click(within(screen.getByRole('navigation',{name:'Main navigation'})).getByRole('link',{name:'Pricing'}));expect(screen.getByRole('button',{name:'Open navigation'}).getAttribute('aria-expanded')).toBe('false');
 const question=screen.getByText('Which games are supported?');await user.click(question);expect(question.closest('details').open).toBe(true);
});
test('registration and dashboard have distinct routes and preview accounts do not collect credentials',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);let view=render(<SiteRouter pathname="/register"/>);expect(await screen.findByRole('heading',{name:'Create your account'})).toBeTruthy();expect(screen.getByRole('button',{name:'Create account'}).disabled).toBe(true);expect(screen.getByRole('link',{name:'Explore the demo dashboard'}).getAttribute('href')).toBe('/dashboard');expect(fetch).not.toHaveBeenCalled();view.unmount();
 view=render(<SiteRouter pathname="/dashboard"/>);expect(await screen.findByRole('heading',{name:'Overview'})).toBeTruthy();
});
test('live account creation submits to the existing auth API and continues to the selected plan',async()=>{
 window.history.replaceState(null,'','/register?plan=tribe');const assign=vi.spyOn(window.location,'assign').mockImplementation(()=>{}),fetch=vi.fn(async(path)=>path==='/api/bootstrap'?{ok:false,status:401}:{ok:true,json:async()=>({ok:true})});vi.stubGlobal('fetch',fetch);const user=userEvent.setup();render(<AuthPage register demo={false}/>);await screen.findByLabelText('Name');await user.type(screen.getByLabelText('Name'),'Test Survivor');await user.type(screen.getByLabelText('Email'),'survivor@example.com');await user.type(screen.getByLabelText('Password'),'example-password');await user.click(screen.getByRole('button',{name:'Create account'}));
 expect(fetch).toHaveBeenCalledWith('/auth/register',expect.objectContaining({method:'POST',body:JSON.stringify({email:'survivor@example.com',password:'example-password',name:'Test Survivor'})}));expect(assign).toHaveBeenCalledWith('/dashboard?plan=tribe');
});
test('a returning signed-in user continues straight to the chosen dashboard view',async()=>{
 window.history.replaceState(null,'','/login?plan=cluster');const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200})));render(<AuthPage demo={false}/>);await waitFor(()=>expect(replace).toHaveBeenCalledWith('/dashboard?plan=cluster'));
});
test('community sign-in retains its return path and rejects an external return destination',async()=>{
 window.history.replaceState(null,'','/login?return_to='+encodeURIComponent('/c/the-outpost?page=staff'));const assign=vi.spyOn(window.location,'assign').mockImplementation(()=>{}),fetch=vi.fn(async()=>({ok:true,json:async()=>({ok:true})}));vi.stubGlobal('fetch',fetch);const user=userEvent.setup();render(<LoginPage/>);await user.type(screen.getByLabelText('Email'),'survivor@example.com');await user.type(screen.getByLabelText('Password'),'example-password');await user.click(screen.getByRole('button',{name:'Sign in'}));expect(assign).toHaveBeenCalledWith('/c/the-outpost?page=staff');
 cleanup();window.history.replaceState(null,'','/login?return_to=https://example.com');render(<LoginPage/>);await user.type(screen.getByLabelText('Email'),'survivor@example.com');await user.type(screen.getByLabelText('Password'),'example-password');await user.click(screen.getByRole('button',{name:'Sign in'}));expect(assign).toHaveBeenLastCalledWith('/dashboard');
});
test('unknown routes provide a useful path back to the public homepage',()=>{render(<SiteRouter pathname="/missing-page"/>);expect(screen.getByRole('heading',{name:'This page has wandered off.'})).toBeTruthy();expect(screen.getByRole('link',{name:'Back to home'}).getAttribute('href')).toBe('/');});
