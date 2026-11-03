import React from 'react';
import {render,screen,within,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../src/main.jsx';
import {demoSeed,upgradeDemo} from '../src/demo';
import {DEMO_EOSID,DEMO_UUID} from '../src/demo-ban-directory';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
async function open(user){await user.click(screen.getByRole('button',{name:'Players'}));await user.click(screen.getByRole('tab',{name:'Ban lookup'}));}
test('connected player actions open the ban lookup with the exact reported ID',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Players'}));const row=screen.getAllByRole('row')[1],identifier=within(row).getByText('DEMO-D1-001').textContent;
  await user.click(within(row).getByRole('button',{name:'Check bans'}));expect(screen.getByRole('tab',{name:'Ban lookup'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByLabelText('Player identifier').value).toBe(identifier);
  await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByText('No matching community reports')).toBeTruthy();expect(screen.getByText(/No match does not establish/)).toBeTruthy();
});
test('EOS lookup shows source communities, withdrawn status and game scope',async()=>{
  const user=userEvent.setup();render(<App/>);await open(user);await user.click(screen.getByRole('button',{name:'Use sample EOSID'}));fireEvent.change(screen.getByLabelText('Player identifier'),{target:{value:DEMO_EOSID.toUpperCase()}});await user.click(screen.getByRole('button',{name:'Search bans'}));
  expect(await screen.findByText('Northwatch (sample)')).toBeTruthy();expect(screen.queryByText('Haven (sample)')).toBeNull();expect(screen.getByText('Active report')).toBeTruthy();
  await user.click(screen.getByRole('checkbox',{name:'Include withdrawn reports'}));expect(screen.queryByRole('region',{name:'Ban lookup results'})).toBeNull();await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByText('Haven (sample)')).toBeTruthy();expect(screen.getByText('Withdrawn')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Game scope'),'asa');await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByText('Northwatch (sample)')).toBeTruthy();expect(screen.queryByText('Haven (sample)')).toBeNull();
});
test('compact UUID lookup requires explicit UUID type and does not match an EOS namespace',async()=>{
  const user=userEvent.setup();render(<App/>);await open(user);fireEvent.change(screen.getByLabelText('Player identifier'),{target:{value:DEMO_UUID.replaceAll('-','').toUpperCase()}});await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByText('No matching community reports')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('ID type'),'uuid');await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByText('Northwatch (sample)')).toBeTruthy();expect(screen.getByText(DEMO_UUID)).toBeTruthy();
});
test('new bans appear in the private cluster list and internal reasons stay in moderation history',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Players'}));await user.click(within(screen.getAllByRole('row')[1]).getByRole('button',{name:'Ban'}));await user.type(screen.getByLabelText('Internal moderation reason'),'Private abuse investigation details');await user.click(screen.getByRole('button',{name:'Confirm ban'}));await user.click(screen.getByRole('tab',{name:'Ban lookup'}));expect(await screen.findByText('DEMO-D1-001')).toBeTruthy();expect(screen.getByText('Main cluster')).toBeTruthy();expect(screen.getByText('1 active')).toBeTruthy();expect(screen.queryByText('Private abuse investigation details')).toBeNull();
  const saved=JSON.parse(localStorage.getItem('rookrift-demo-v1'));expect(saved.moderation[0].identity_key).toBe('game:DEMO-D1-001');expect(saved.ban_directory.sharing_enabled).toBe(false);
});
test('sharing is explicitly opt-in, uses a public name, and saves only to the demo workspace',async()=>{
  const user=userEvent.setup();render(<App/>);await open(user);await user.click(screen.getByText('Community sharing'));const checkbox=screen.getByRole('checkbox',{name:'Share ban reports with participating communities'});expect(checkbox.checked).toBe(false);await user.click(checkbox);const name=screen.getByLabelText('Public community name');await user.clear(name);await user.type(name,'Public Outpost');await user.click(screen.getByRole('button',{name:'Save sharing preferences'}));
  expect(JSON.parse(localStorage.getItem('rookrift-demo-v1')).ban_directory).toMatchObject({sharing_enabled:true,public_name:'Public Outpost'});expect(screen.getByText('Enabled')).toBeTruthy();expect(screen.getByText('Demo only. No reports are published to other users.')).toBeTruthy();
});
test('workspace cluster ban list paginates and supports withdrawn filtering',async()=>{
  const seed=upgradeDemo(structuredClone(demoSeed));seed.moderation=Array.from({length:27},(_,index)=>({id:`b${index}`,server_id:'d1',identifier:`PLAYER-${index}`,action:'ban',identity_kind:'game',active:1,created_at:Date.now()-index*1000}));localStorage.setItem('rookrift-demo-v1',JSON.stringify(seed));
  const user=userEvent.setup();render(<App/>);await open(user);expect(await screen.findByText('1–25 of 27')).toBeTruthy();expect(screen.getAllByRole('row').length).toBe(26);await user.click(screen.getByRole('button',{name:'Next'}));expect(await screen.findByText('26–27 of 27')).toBeTruthy();expect(screen.getAllByRole('row').length).toBe(3);await user.selectOptions(screen.getByLabelText('Workspace ban status'),'withdrawn');expect(await screen.findByText('No matching workspace bans')).toBeTruthy();
});
test('malformed identifiers produce an actionable lookup error without stale results',async()=>{
  const user=userEvent.setup();render(<App/>);await open(user);fireEvent.change(screen.getByLabelText('Player identifier'),{target:{value:'PLAYER|DoExit'}});await user.click(screen.getByRole('button',{name:'Search bans'}));expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByRole('alert').textContent).toContain('exact server-reported ID');expect(screen.queryByRole('region',{name:'Ban lookup results'})).toBeNull();
});
