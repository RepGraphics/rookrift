import test from 'node:test';
import assert from 'node:assert/strict';
import {accountReturn,authDestination,siteRoute} from '../shared/navigation.js';
test('public entry routes keep legacy billing, community and invitation links working',()=>{
 assert.deepEqual(siteRoute('/'),{page:'landing'});assert.deepEqual(siteRoute('/login/'),{page:'login'});assert.deepEqual(siteRoute('/register'),{page:'register'});assert.deepEqual(siteRoute('/dashboard'),{page:'dashboard'});assert.deepEqual(siteRoute('/c/the-outpost/'),{page:'community',slug:'the-outpost'});
 assert.equal(siteRoute('/','?billing=success').page,'dashboard');assert.equal(siteRoute('/','?community_payments=return').page,'dashboard');assert.equal(siteRoute('/','?return_to=%2Fc%2Fthe-outpost').page,'login');assert.equal(siteRoute('/','','#invite='+'a'.repeat(64)).page,'dashboard');assert.equal(siteRoute('/missing').page,'missing');
});

test('nested dashboard return addresses stay internal and reject unexpected or duplicate parameters',()=>{
 const path='/dashboard?view=community&community=store&store=settings';assert.equal(accountReturn(path),path);assert.equal(authDestination('?return_to='+encodeURIComponent(path)),path);assert.equal(authDestination('?view=community&community=store&store=settings'),path);
 for(const address of ['/dashboard?view=unknown','/dashboard?view=community&next=https://evil.example','/dashboard?view=servers&view=account','/dashboard?view=servers#token','/dashboard/../admin','//evil.example/dashboard?view=community','/dashboard?toString=x','/dashboard?constructor=x','/dashboard?__proto__=x','/dashboard?\nview=servers'])assert.equal(accountReturn(address),null);
});
test('auth destinations preserve known plans and community sections without accepting external redirects',()=>{
 assert.equal(authDestination('?plan=cluster'),'/dashboard?plan=cluster');assert.equal(authDestination('?plan=unknown'),'/dashboard');assert.equal(authDestination('?return_to='+encodeURIComponent('/c/the-outpost?page=staff')),'/c/the-outpost?page=staff');
 for(const path of ['https://evil.example','//evil.example','/\\evil.example','/dashboard?plan=unknown','/c/the-outpost?next=https://evil.example'])assert.equal(accountReturn(path),null);
 for(const path of ['/dashboard','/dashboard?plan=tribe','/c/the-outpost?page=join'])assert.equal(accountReturn(path),path);
});
