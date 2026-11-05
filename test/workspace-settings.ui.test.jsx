import React from 'react';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkspaceSettings} from '../src/workspace-settings';
import {loadDemo,storeDemo} from '../src/demo';
import {App} from '../src/main';

beforeEach(()=>{localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/dashboard');});afterEach(cleanup);
const guild='123456789012345678',channel='223456789012345678';
test('settings trim copied IDs, preserve every digit and show a persistent save failure',async()=>{
 const data=loadDemo(),mutate=vi.fn(async()=>({ok:false,error:'Reconnect Discord to refresh your permissions.'})),user=userEvent.setup();data.integrations.discord_linking_available=true;data.integrations.discord_account_authorized=false;render(<WorkspaceSettings data={data} mutate={mutate}/>);const server=screen.getByLabelText(/^Discord server ID/),alert=screen.getByLabelText(/^Alert channel ID/);await user.clear(server);await user.type(server,' '+guild+' ');await user.clear(alert);await user.type(alert,' '+channel+' ');await user.click(screen.getByRole('button',{name:'Save changes'}));expect(mutate).toHaveBeenCalledWith('/workspace','PATCH',expect.objectContaining({guild_id:guild,alert_channel_id:channel}),expect.any(Function),'Workspace settings saved');expect((await screen.findByRole('alert')).textContent).toMatch(/Reconnect Discord/);expect(screen.getByRole('link',{name:'Connect Discord'}).getAttribute('href')).toContain('return_to=');
});
test('changing servers clears the previous channel and saved state survives a Discord round trip',async()=>{
 const data=loadDemo(),user=userEvent.setup(),view=render(<WorkspaceSettings data={data} mutate={vi.fn()}/>);data.integrations.discord_linking_available=true;view.rerender(<WorkspaceSettings data={data} mutate={vi.fn()}/>);const server=screen.getByLabelText(/^Discord server ID/),alert=screen.getByLabelText(/^Alert channel ID/);await user.clear(server);await user.type(server,guild);expect(alert.value).toBe('');await user.type(alert,channel);const link=screen.getByRole('link',{name:/Connect Discord|Reconnect Discord/});link.addEventListener('click',e=>e.preventDefault());await user.click(link);view.unmount();render(<WorkspaceSettings data={data} mutate={vi.fn()}/>);expect(screen.getByLabelText(/^Discord server ID/).value).toBe(guild);expect(screen.getByLabelText(/^Alert channel ID/).value).toBe(channel);
});
test('root settings explain bot setup without requiring a personal Discord link',()=>{
 const data=loadDemo();data.user.platform_admin=true;data.integrations.discord=false;render(<WorkspaceSettings data={data} mutate={vi.fn()}/>);expect(screen.queryByRole('link',{name:'Connect Discord'})).toBeNull();expect(screen.getByRole('link',{name:'Open platform settings'}).getAttribute('href')).toBe('/admin');expect(screen.getByText(/Platform roots can link/)).toBeTruthy();
});
test('the approved OAuth return opens workspace settings and demo save remains local',async()=>{
 window.history.replaceState(null,'','/dashboard?settings=discord');const data=loadDemo();data.workspace.guild_id=null;data.workspace.alert_channel_id=null;storeDemo(data);const user=userEvent.setup();render(<App/>);await user.type(screen.getByLabelText(/^Discord server ID/),guild);await user.type(screen.getByLabelText(/^Alert channel ID/),channel);await user.click(screen.getByRole('button',{name:'Save changes'}));await waitFor(()=>expect(JSON.parse(localStorage.getItem('rookrift-demo-v1')).workspace.guild_id).toBe(guild));expect(JSON.parse(localStorage.getItem('rookrift-demo-v1')).workspace.alert_channel_id).toBe(channel);expect(screen.getByText('Demo settings saved. No Discord request was made.')).toBeTruthy();
});
