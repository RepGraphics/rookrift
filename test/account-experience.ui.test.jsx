import React from 'react';
import {cleanup,render,screen,within,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {CommunityPortal} from '../src/community-ui';
import {AdminApp} from '../src/platform-admin-ui';
import {AccountSettings} from '../src/account-settings-ui';
import {App} from '../src/main';
import {loadDemo,storeDemo} from '../src/demo';

beforeEach(()=>{localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/c/the-outpost');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function openAccount(user,section='Profile'){await user.click(await screen.findByRole('button',{name:'My account for Alex Morgan'}));await user.click(within(screen.getByRole('navigation',{name:'My account'})).getByRole('button',{name:section}));}
const stored=()=>JSON.parse(localStorage.getItem('rookrift-demo-v1'));

test('community members have one game-linking entry and a full profile without leaving their community',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const user=userEvent.setup();render(<CommunityPortal slug="the-outpost" demo/>);
 await screen.findByRole('heading',{name:'The Outpost'});expect(within(screen.getByRole('navigation',{name:'Community sections'})).queryByRole('button',{name:'Game accounts'})).toBeNull();
 await openAccount(user);await screen.findByLabelText('Name');expect(screen.queryByLabelText('Server to link on')).toBeNull();expect(screen.queryByLabelText('Current password')).toBeNull();
 await user.clear(screen.getByLabelText('Name'));await user.type(screen.getByLabelText('Name'),'Alex Survivor');await user.click(screen.getByRole('button',{name:'Save profile'}));await screen.findByRole('button',{name:'My account for Alex Survivor'});expect(stored().user.name).toBe('Alex Survivor');
 await user.type(screen.getByLabelText(/^Community nickname/),'River Scout');await user.click(screen.getByRole('button',{name:'Save nickname'}));await screen.findByRole('button',{name:'My account for River Scout'});expect(stored().community.member_profiles[stored().user.id].display_name).toBe('River Scout');
 await user.click(within(screen.getByRole('navigation',{name:'Community account settings'})).getByRole('button',{name:'Game accounts'}));await screen.findByLabelText('Server to link on');expect(screen.getAllByRole('button',{name:'Generate link code'})).toHaveLength(1);expect(screen.queryByText('Save an identifier without in-game verification')).toBeNull();expect(fetch).not.toHaveBeenCalled();
});

test('community menu supports Escape, outside click, logout and a persistent signed-out demo state',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const user=userEvent.setup(),view=render(<CommunityPortal slug="the-outpost" demo/>);const trigger=await screen.findByRole('button',{name:'My account for Alex Morgan'});
 await user.click(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('true');await user.keyboard('{Escape}');expect(trigger.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(trigger);
 await user.click(trigger);await user.click(screen.getByRole('heading',{name:'The Outpost'}));expect(screen.queryByRole('navigation',{name:'My account'})).toBeNull();
 await user.click(trigger);await user.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByRole('button',{name:'Sign in to demo'});expect(screen.queryByRole('button',{name:'My account for Alex Morgan'})).toBeNull();view.unmount();
 render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByRole('button',{name:'Sign in to demo'});await user.click(screen.getByRole('button',{name:'Sign in to demo'}));await screen.findByRole('button',{name:'My account for Alex Morgan'});expect(fetch).not.toHaveBeenCalled();
});

test('legacy community account links open the single linking flow and preferences respect the owner theme',async()=>{
 window.history.replaceState(null,'','/c/the-outpost?page=account');const data=loadDemo();data.community.design.published.appearance={...data.community.design.published.appearance,allow_theme_toggle:false};data.community.design.published_at=Date.now();storeDemo(data);const user=userEvent.setup();render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByLabelText('Server to link on');
 await user.click(screen.getByRole('button',{name:'Appearance'}));expect(screen.getByText('The community owner has chosen a fixed appearance for this site.')).toBeTruthy();expect(screen.queryByRole('combobox',{name:'Community appearance'})).toBeNull();
});

test('live community sign-out uses personal CSRF-protected logout and failed sign-out remains visible',async()=>{
 let loggedOut=false,fail=true;const fetch=vi.fn(async(path,options)=>{if(path==='/api/account/logout'){expect(options.method).toBe('POST');expect(options.headers['X-CSRF-Token']).toBe('member-csrf');if(fail)return{ok:false,json:async()=>({error:'Try signing out again.'})};loggedOut=true;return{ok:true,json:async()=>({ok:true})};}const d=loadDemo();return{ok:true,json:async()=>({site:{...d.community.site,design:null},servers:[],posts:[],events:[],applications:[],viewer:loggedOut?null:{id:'member',name:'Alex Morgan',csrf:'member-csrf'}})};});vi.stubGlobal('fetch',fetch);
 const user=userEvent.setup();render(<CommunityPortal slug="the-outpost"/>);await user.click(await screen.findByRole('button',{name:'My account for Alex Morgan'}));await user.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByText('Try signing out again.');expect(screen.getByRole('button',{name:'My account for Alex Morgan'})).toBeTruthy();fail=false;await user.click(screen.getByRole('button',{name:'Sign out'}));await screen.findByRole('link',{name:'Sign in'});expect(fetch.mock.calls.some(([path])=>path==='/api/bootstrap'||path==='/api/logout')).toBe(false);
});

test('personal account separates profile and security and loads invoices only on demand',async()=>{
 const user=userEvent.setup(),account={profile:{id:'member',name:'Alex Morgan',username:'alex',email:'alex@example.test',discord_linked:true},security:{totp_enabled:false,passkeys:[]}},request=vi.fn(async path=>path==='/account/billing'?[]:account);
 render(<AccountSettings data={{user:{id:'member'}}} request={request}/>);await screen.findByRole('button',{name:'Save profile'});expect(request).toHaveBeenCalledWith('/account?summary=1','GET');expect(request.mock.calls.some(([path])=>path==='/account/billing')).toBe(false);expect(screen.queryByLabelText('Current password')).toBeNull();
 await user.click(screen.getByRole('button',{name:'Sign-in & security'}));expect(await screen.findByLabelText('Current password')).toBeTruthy();expect(screen.getByRole('heading',{name:'Discord sign-in'})).toBeTruthy();expect(screen.queryByRole('heading',{name:'Connected accounts'})).toBeNull();
 await user.click(screen.getByRole('button',{name:'Billing history'}));expect(await screen.findByText('You have no workspace invoices yet.')).toBeTruthy();expect(request).toHaveBeenCalledWith('/account/billing','GET');
});

test('dashboard appearance settings synchronise the header toggle and grouped navigation',async()=>{
 const user=userEvent.setup();render(<App/>);expect(screen.getByText('Servers & players')).toBeTruthy();expect(screen.getByText('Workspace & account')).toBeTruthy();await user.click(screen.getByRole('button',{name:'Open account'}));await user.click(screen.getByRole('button',{name:'Appearance'}));const select=await screen.findByLabelText('Dashboard appearance');await user.selectOptions(select,'light');expect(document.documentElement.dataset.theme).toBe('light');expect(screen.getByRole('button',{name:'Switch to dark mode'})).toBeTruthy();await user.click(screen.getByRole('button',{name:'Switch to dark mode'}));expect(select.value).toBe('dark');
});

test('admin categories show one integration and save only the selected provider credentials',async()=>{
 const settings={platform_billing_provider:{value:'stripe'}},bootstrap={user:{name:'Root'},csrf:'admin-csrf',users:[],workspaces:[],settings};const fetch=vi.fn(async(path,options)=>({ok:true,json:async()=>path==='/api/platform/email'?{port:587,security:'starttls',name:'Rookrift',counts:[],recent:[]}:path==='/api/platform/settings'?{restart_required:true}:bootstrap}));vi.stubGlobal('fetch',fetch);
 const user=userEvent.setup();render(<AdminApp/>);await user.click(await screen.findByRole('button',{name:'Global settings'}));await screen.findByRole('heading',{name:'Email & SMTP'});expect(screen.queryByLabelText('Bot token')).toBeNull();
 await user.click(screen.getByRole('button',{name:/^Discord Bot/}));await user.type(screen.getByLabelText('Bot token'),'fixture-bot-token');await user.click(screen.getByRole('button',{name:'Save discord settings'}));await screen.findByText('Settings saved. Restart Rookrift to apply integration changes.');let sent=JSON.parse(fetch.mock.calls.find(([path])=>path==='/api/platform/settings')[1].body);expect(Object.keys(sent).sort()).toEqual(['discord_bot_token','discord_client_id','discord_client_secret']);expect(sent.discord_bot_token).toBe('fixture-bot-token');
 await user.click(screen.getByRole('button',{name:/^Subscriptions Platform/}));expect(screen.queryByLabelText('Bot token')).toBeNull();expect(screen.getByLabelText('Secret key')).toBeTruthy();expect(screen.queryByLabelText('Tribe plan ID')).toBeNull();await user.selectOptions(screen.getByLabelText('Subscription provider'),'paypal');expect(screen.queryByLabelText('Secret key')).toBeNull();await user.type(screen.getByLabelText('Client ID'),'fixture-paypal');await user.click(screen.getByRole('button',{name:'Save subscriptions settings'}));await waitFor(()=>expect(fetch.mock.calls.filter(([path])=>path==='/api/platform/settings')).toHaveLength(2));sent=JSON.parse(fetch.mock.calls.filter(([path])=>path==='/api/platform/settings').at(-1)[1].body);expect(sent.platform_billing_provider).toBe('paypal');expect(sent.paypal_client_id).toBe('fixture-paypal');expect(sent.stripe_secret_key).toBeUndefined();
 await user.click(screen.getByRole('button',{name:/^Community payments Store/}));expect(screen.getByLabelText('Connect secret key')).toBeTruthy();expect(screen.queryByLabelText('Subscription provider')).toBeNull();
});
