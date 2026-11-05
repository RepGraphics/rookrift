import React from 'react';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {LegalPage} from '../src/legal-page';
import {LegalLinks} from '../src/legal-links';
import {AccountDeletionPanel} from '../src/account-deletion-ui';
import {siteRoute} from '../shared/navigation';
import {loadDemo,storeDemo} from '../src/demo';

beforeEach(()=>{localStorage.clear();window.history.replaceState(null,'','/dashboard');});afterEach(cleanup);
test('all legal pages are publicly routed, identify the operator and expose navigable policy sections',()=>{
 for(const [path,kind,title]of [['/terms','terms','Terms of Service'],['/refund-policy','refund','Refund Policy'],['/privacy-policy','privacy','Privacy Policy']]){expect(siteRoute(path)).toEqual({page:'legal',kind});const page=render(<LegalPage kind={kind} demo/>);expect(screen.getByRole('heading',{level:1,name:title})).toBeTruthy();expect(screen.getByRole('navigation',{name:'Policy contents'})).toBeTruthy();expect(screen.getByText('Euphoria Development',{selector:'.legal-operator strong'})).toBeTruthy();expect(screen.getByText('support@euphoriadevelopment.uk',{selector:'.legal-operator a'}).getAttribute('href')).toBe('mailto:support@euphoriadevelopment.uk');expect(screen.getByRole('note').textContent).toContain('business contact address');page.unmount();}
});
test('footer policy links use public canonical routes',()=>{render(<LegalLinks/>);for(const [name,path]of [['Terms of Service','/terms'],['Refund Policy','/refund-policy'],['Privacy Policy','/privacy-policy']])expect(screen.getByRole('link',{name}).getAttribute('href')).toBe(path);});

test('a renewing membership blocks deletion until cancellation is freshly confirmed',async()=>{
 let allowed=false;const request=vi.fn(async(path,method)=>{if(method==='GET')return{allowed,memberships:[{workspace_id:'ws',workspace_name:'Paid cluster',allowed,message:allowed?'Cancellation confirmed.':'Cancel membership first.'}],workspaces:1,servers:2,methods:{password:true},reauthenticated:false};}),user=userEvent.setup(),data=loadDemo();render(<AccountDeletionPanel request={request} data={data}/>);const button=await screen.findByRole('button',{name:'Review account deletion'});expect(button.disabled).toBe(true);allowed=true;await user.click(screen.getByRole('button',{name:'Refresh cancellation check'}));expect(button.disabled).toBe(false);await user.click(button);expect(screen.getByRole('heading',{name:'Confirm permanent account deletion'})).toBeTruthy();expect(request.mock.calls.some(([,method])=>method==='DELETE')).toBe(false);
});

test('deletion asks for identity and explicit irreversible consent before sending the final request',async()=>{
 const request=vi.fn(async(path,method)=>method==='GET'?{allowed:true,memberships:[],workspaces:1,servers:1,methods:{password:true},reauthenticated:false}:{ok:true}),deleted=vi.fn(),user=userEvent.setup();render(<AccountDeletionPanel request={request} data={loadDemo()} onDeleted={deleted}/>);await user.click(await screen.findByRole('button',{name:'Review account deletion'}));await user.type(screen.getByLabelText('Password for account deletion'),'current password');await user.type(screen.getByLabelText('Type DELETE to confirm'),'DELETE');await user.click(screen.getByRole('checkbox',{name:/I understand the consequences/}));await user.click(screen.getByRole('button',{name:'Permanently delete my account'}));await waitFor(()=>expect(deleted).toHaveBeenCalledOnce());expect(request).toHaveBeenCalledWith('/account/deletion/password','POST',{password:'current password'});expect(request).toHaveBeenCalledWith('/account/deletion','DELETE',{confirmation:'DELETE',acknowledged:true});
});

test('demo closure requires simulated cancellation and only clears browser demo records',async()=>{
 const data=loadDemo();storeDemo(data);const deleted=vi.fn(),request=vi.fn(),user=userEvent.setup();render(<AccountDeletionPanel request={request} data={data} demo onDeleted={deleted}/>);await user.click(await screen.findByRole('button',{name:'Simulate membership cancellation'}));await user.click(screen.getByRole('button',{name:'Review account deletion'}));await user.type(screen.getByLabelText('Demo password (any sample)'),'sample');await user.type(screen.getByLabelText('Type DELETE to confirm'),'DELETE');await user.click(screen.getByRole('checkbox',{name:/I understand/}));await user.click(screen.getByRole('button',{name:'Simulate account deletion'}));expect(deleted).toHaveBeenCalledOnce();expect(localStorage.getItem('rookrift-demo-v1')).toBeNull();expect(request).not.toHaveBeenCalled();
});
