import React from 'react';
import {render,screen,within,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../src/main';
import {CommunityPortal} from '../src/community-ui';
import {loadDemo,storeDemo} from '../src/demo';
import {DEFAULT_DESIGN} from '../shared/community-design';

beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/dashboard');});afterEach(cleanup);
const stored=()=>JSON.parse(localStorage.getItem('rookrift-demo-v1'));
async function editor(user){await user.click(screen.getByRole('button',{name:'Community hub'}));await screen.findByLabelText('Community name');await user.click(screen.getByRole('button',{name:'Site editor'}));await user.click(await screen.findByRole('button',{name:'Brand & appearance'}));}

test('public header uses community branding and remembers a visitor appearance choice',async()=>{
 const data=loadDemo();data.community.site.title='Raven Coast';data.community.site.logo_url='https://example.com/raven.png';storeDemo(data);const user=userEvent.setup();render(<CommunityPortal slug="the-outpost" demo/>);
 await screen.findByRole('heading',{name:'Raven Coast'});const header=screen.getByRole('banner'),brand=within(header).getByRole('link',{name:'Raven Coast community home'});expect(brand.getAttribute('href')).toBe('/c/the-outpost');expect(brand.querySelector('img').getAttribute('src')).toBe('https://example.com/raven.png');expect(within(header).queryByText('ROOKRIFT')).toBeNull();expect(document.title).toContain('Raven Coast');
 await user.click(screen.getByRole('button',{name:'Switch community to light mode'}));expect(document.querySelector('.community-portal').dataset.communityMode).toBe('light');expect(localStorage.getItem('rookrift-community-theme:the-outpost')).toBe('light');
});

test('appearance edits stay private until published, then apply colour, layout and navigation choices',async()=>{
 const user=userEvent.setup(),app=render(<App/>);await editor(user);await user.selectOptions(screen.getByLabelText('Site colour theme'),'violet');fireEvent.change(screen.getByLabelText('Accent hex colour'),{target:{value:'#ffd166'}});await user.selectOptions(screen.getByLabelText('Default community appearance'),'light');await user.selectOptions(screen.getByLabelText('Hero alignment'),'center');await user.selectOptions(screen.getByLabelText('Page width'),'compact');await user.selectOptions(screen.getByLabelText('Corner style'),'soft');await user.type(screen.getByLabelText(/^Banner image URL/),'https://example.com/coast.webp');await user.click(screen.getByLabelText('Show server, player and event counts'));const nav=screen.getByRole('group',{name:'Public navigation sections'});await user.click(within(nav).getByRole('checkbox',{name:'News'}));await user.click(screen.getByRole('button',{name:'Save draft'}));expect(stored().community.design.published_at).toBeNull();app.unmount();
 let portal=render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByRole('heading',{name:'The Outpost'});expect(document.querySelector('.community-portal').dataset.communityTheme).toBe('forest');portal.unmount();
 const manager=render(<App/>);await editor(user);await user.click(screen.getByRole('button',{name:'Publish design'}));expect(stored().community.design.published.appearance.accent).toBe('#ffd166');manager.unmount();portal=render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByRole('heading',{name:'The Outpost'});const root=document.querySelector('.community-portal');expect(root.dataset.communityTheme).toBe('violet');expect(root.dataset.communityMode).toBe('light');expect(root.dataset.contentWidth).toBe('compact');expect(root.style.getPropertyValue('--primary')).toBe('#ffd166');expect(document.querySelector('.portal-cover-image').getAttribute('src')).toBe('https://example.com/coast.webp');expect(document.querySelector('.portal-stats')).toBeNull();expect(within(screen.getByRole('navigation',{name:'Community sections'})).queryByRole('button',{name:'News'})).toBeNull();
});

test('members generate a server-bound command, confirm a simulated game link and remove their identity',async()=>{
 const user=userEvent.setup();render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'My account for Alex Morgan'}));await user.click(screen.getByRole('button',{name:'Game accounts'}));await screen.findByLabelText('Server to link on');await user.selectOptions(screen.getByLabelText('Server to link on'),'d1');await user.click(screen.getByRole('button',{name:'Generate link code'}));expect(document.querySelector('.member-code-value').textContent).toMatch(/\/link RR-[A-F0-9]{16}/);expect(stored().community.link_requests[0].server_id).toBe('d1');await user.click(screen.getByRole('button',{name:'Simulate in-game link'}));expect(await screen.findByText('Your game account is linked.')).toBeTruthy();expect(screen.getByText('Verified in game')).toBeTruthy();await user.click(screen.getByRole('button',{name:'Remove'}));expect(screen.queryByText('Verified in game')).toBeNull();expect(stored().community.member_accounts).toHaveLength(0);
});

test('existing designs receive appearance defaults without losing custom content',async()=>{
 const data=loadDemo();data.community.design={draft:structuredClone(DEFAULT_DESIGN),published:structuredClone(DEFAULT_DESIGN),published_at:Date.now()};data.community.design.published.pages[0].blocks[0].body='Older published content is still here.';storeDemo(data);render(<CommunityPortal slug="the-outpost" demo/>);await screen.findByRole('heading',{name:'The Outpost'});expect(screen.getByText('Older published content is still here.')).toBeTruthy();expect(document.querySelector('.community-portal').dataset.communityMode).toBe('dark');
});
