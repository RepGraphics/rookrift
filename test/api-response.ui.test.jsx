import {apiResponse} from '../src/api-response';
import React from 'react';
import {render,screen,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AdminApp} from '../src/platform-admin-ui';

beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/admin');});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

test('plain-text rate limits and HTML gateway failures retain their HTTP meaning without exposing response bodies',async()=>{
 for(const [status,pattern] of [[429,/Too many requests/],[504,/proxy is unavailable/],[401,/session has expired/],[403,/permission/]]){
  await expect(apiResponse({ok:false,status,json:async()=>{throw new SyntaxError('<html>private upstream output</html>');}})).rejects.toMatchObject({status,message:expect.stringMatching(pattern)});
 }
 await expect(apiResponse({ok:true,status:200,json:async()=>{throw new SyntaxError('unexpected character');}})).rejects.toThrow(/deployment URL and proxy/);
 await expect(apiResponse({ok:false,status:409,json:async()=>({error:'Save and enable SMTP delivery first.'})})).rejects.toThrow('Save and enable SMTP delivery first.');
});

test('the admin mail test shows a readable proxy error and remains available for an explicit retry',async()=>{
 const settings=Object.fromEntries(['discord_client_id','discord_client_secret','discord_bot_token'].map(key=>[key,{configured:false}]));
 const email={host:'smtp.example.test',port:587,security:'starttls',username:'',from:'mail@example.test',enabled:true,name:'Rookrift',configured:true,counts:[],recent:[]};
 const fetch=vi.fn(async path=>path.endsWith('/test')?{ok:false,status:504,json:async()=>{throw new SyntaxError('JSON.parse: unexpected character');}}:{ok:true,status:200,json:async()=>path==='/api/platform/email'?email:{csrf:'fixture',users:[],workspaces:[],settings}});vi.stubGlobal('fetch',fetch);
 const user=userEvent.setup();render(<AdminApp/>);await user.click(await screen.findByRole('button',{name:'Global settings'}));await user.click(await screen.findByRole('button',{name:'Send test to my account'}));
 expect((await screen.findByRole('alert')).textContent).toContain('HTTP 504');expect(screen.getByRole('button',{name:'Send test to my account'}).disabled).toBe(false);expect(fetch.mock.calls.filter(([path])=>path.endsWith('/test'))).toHaveLength(1);expect(screen.queryByText(/JSON.parse/)).toBeNull();
});
