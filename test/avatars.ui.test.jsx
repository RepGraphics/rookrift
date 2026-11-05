import React from 'react';
import {render,screen,within,cleanup,fireEvent,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Avatar} from '../src/avatar';
import {AccountProfileForm} from '../src/account-profile-ui';
import {App} from '../src/main';
import {AdminApp} from '../src/platform-admin-ui';
import {StaffDashboard} from '../src/staff-dashboard';
import {CommunityPortal} from '../src/community-ui';
import {loadDemo,storeDemo} from '../src/demo';

const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII=',image='data:image/png;base64,'+pixel;
const upload=()=>new File([Uint8Array.from(atob(pixel),c=>c.charCodeAt(0))],'profile.png',{type:'image/png'});
beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/dashboard');});afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

test('avatars crop pictures consistently, fall back after a broken image and recover when the source changes',()=>{
 const view=render(<Avatar user={{name:'Alex Morgan',avatar_url:image}} size={40}/>),avatar=screen.getByRole('img',{name:'Alex Morgan profile picture'});expect(avatar.querySelector('img').getAttribute('src')).toBe(image);expect(avatar.style.getPropertyValue('--avatar-size')).toBe('40px');fireEvent.error(avatar.querySelector('img'));expect(avatar.querySelector('img')).toBeNull();expect(avatar.textContent).toBe('AM');const next='/api/account/avatars/alex?v='+'f'.repeat(24);view.rerender(<Avatar user={{name:'Alex Morgan',avatar_url:next}}/>);expect(avatar.querySelector('img').getAttribute('src')).toBe(next);
});

test('profile form previews uploads before saving and leaves an untouched picture out of name-only updates',async()=>{
 const user=userEvent.setup(),save=vi.fn(async()=>true),profile={id:'alex',name:'Alex Morgan',username:'alex',avatar_url:image};render(<AccountProfileForm profile={profile} onSave={save}/>);await user.click(screen.getByRole('button',{name:'Save profile'}));expect(save).toHaveBeenLastCalledWith({name:'Alex Morgan',username:'alex'});await user.upload(screen.getByLabelText(/^Profile picture/),upload());expect(await screen.findByText('New picture selected. Save to apply it.')).toBeTruthy();expect(screen.getByRole('img',{name:'Alex Morgan profile picture'}).querySelector('img').getAttribute('src')).toBe(image);await user.click(screen.getByRole('button',{name:'Save profile'}));expect(save).toHaveBeenLastCalledWith({name:'Alex Morgan',username:'alex',avatar:image});await user.click(screen.getByRole('button',{name:'Remove picture'}));expect(screen.getByRole('img',{name:'Alex Morgan profile picture'}).querySelector('img')).toBeNull();await user.click(screen.getByRole('button',{name:'Save profile'}));expect(save).toHaveBeenLastCalledWith({name:'Alex Morgan',username:'alex',avatar:null});
});

test('invalid or oversized pictures are rejected before submitting and a valid selection clears the error',async()=>{
 const user=userEvent.setup({applyAccept:false}),save=vi.fn();render(<AccountProfileForm profile={{id:'alex',name:'Alex Morgan',username:'alex'}} onSave={save}/>);const input=screen.getByLabelText(/^Profile picture/);await user.upload(input,new File(['<svg/>'],'image.svg',{type:'image/svg+xml'}));expect(screen.getByRole('alert').textContent).toContain('PNG');expect(screen.getByRole('button',{name:'Save profile'}).disabled).toBe(true);await user.upload(input,new File([new Uint8Array(3*1024*1024+1)],'large.png',{type:'image/png'}));expect(screen.getByRole('alert').textContent).toContain('3 MB');await user.upload(input,upload());await screen.findByText('New picture selected. Save to apply it.');expect(screen.queryByRole('alert')).toBeNull();expect(save).not.toHaveBeenCalled();
});

test('saving a demo picture updates both account buttons immediately, persists and reaches the signed-in community menu',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const user=userEvent.setup(),view=render(<App/>);await user.click(screen.getByRole('button',{name:'Open account'}));await user.upload(await screen.findByLabelText(/^Profile picture/),upload());await screen.findByText('New picture selected. Save to apply it.');await user.click(screen.getByRole('button',{name:'Save profile'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Open account'}).querySelector('img').getAttribute('src')).toBe(image));expect(screen.getByRole('button',{name:'Open account for Alex Morgan'}).querySelector('img').getAttribute('src')).toBe(image);expect(JSON.parse(localStorage.getItem('rookrift-demo-v1')).user.avatar_url).toBe(image);expect(fetch).not.toHaveBeenCalled();view.unmount();render(<CommunityPortal slug="the-outpost" demo/>);const menu=await screen.findByRole('button',{name:'My account for Alex Morgan'});expect(menu.querySelector('img').getAttribute('src')).toBe(image);
});

test('team and platform user lists show pictures beside names and administration has a personal avatar link',async()=>{
 const data=loadDemo();data.user.avatar_url=image;data.team.members[0].avatar_url=image;storeDemo(data);const user=userEvent.setup(),view=render(<App/>);await user.click(screen.getByRole('button',{name:'Team'}));const member=await screen.findByRole('row',{name:/Morgan Lee/});expect(member.querySelector('img').getAttribute('src')).toBe(image);view.unmount();const admin={user:{id:'root',name:'Root',avatar_url:image},csrf:'fixture',settings:{},workspaces:[],users:[{id:'alex',name:'Alex Morgan',email:'alex@example.test',avatar_url:image,active_sessions:1,workspaces:1}]};vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>admin})));render(<AdminApp/>);const link=await screen.findByRole('link',{name:'Open my account'});expect(link.querySelector('img').getAttribute('src')).toBe(image);await user.click(screen.getByRole('button',{name:'Users'}));expect((await screen.findByRole('row',{name:/Alex Morgan/})).querySelector('img').getAttribute('src')).toBe(image);
});

test('staff can open their personal account through the picture in the staff header',async()=>{
 const data=loadDemo();data.user.avatar_url=image;data.access={role:'viewer',server_ids:null};const user=userEvent.setup();render(<StaffDashboard data={data} request={vi.fn()} mutate={vi.fn()} Dialog={()=>null} notify={vi.fn()} accountPage={<h2>Personal account settings</h2>}/>);const button=screen.getByRole('button',{name:'Open account'});expect(button.querySelector('img').getAttribute('src')).toBe(image);await user.click(button);expect(screen.getByRole('heading',{name:'Personal account settings'})).toBeTruthy();
});
