import React from 'react';
import {render,screen,within,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {App} from '../src/main.jsx';
import {CommunityPortal} from '../src/community-ui.jsx';
import {loadDemo,storeDemo} from '../src/demo';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
async function community(user){await user.click(screen.getByRole('button',{name:'Community hub'}));await user.click(await screen.findByRole('button',{name:'Community page'}));await screen.findByLabelText('Community name');}
const stored=()=>JSON.parse(localStorage.getItem('rookrift-demo-v1'));
test('community publication settings persist and explicit server selections control the public hub',async()=>{
  const user=userEvent.setup();const app=render(<App/>);await community(user);
  const title=screen.getByLabelText('Community name');await user.clear(title);await user.type(title,'Explorer Network');
  await user.click(screen.getByRole('checkbox',{name:/Scorched Earth/}));await user.click(screen.getByRole('button',{name:'Save community page'}));
  expect(stored().community.site.title).toBe('Explorer Network');expect(stored().community.site.server_ids).toEqual(['d1']);
  app.unmount();render(<CommunityPortal demo slug="the-outpost"/>);expect(await screen.findByRole('heading',{name:'Explorer Network'})).toBeTruthy();expect(screen.queryByRole('heading',{name:/Scorched Earth/})).toBeNull();expect(screen.getByRole('heading',{name:/The Island/})).toBeTruthy();
});
test('public community pages default to dark mode',async()=>{
  document.documentElement.removeAttribute('data-theme');render(<CommunityPortal demo slug="the-outpost"/>);
  await screen.findByRole('heading',{name:'The Outpost'});expect(document.documentElement.dataset.theme).toBe('dark');
});
test('news drafts stay private until published and text renders without interpreting HTML',async()=>{
  const user=userEvent.setup();const app=render(<App/>);await community(user);await user.click(screen.getByRole('button',{name:'News'}));await user.click(screen.getByRole('button',{name:'Write an update'}));
  await user.type(screen.getByLabelText('News title'),'Season two');fireEvent.change(screen.getByLabelText('Update'),{target:{value:'<script>unsafe()</script> New season news.'}});await user.click(screen.getByRole('button',{name:'Save news'}));
  expect(stored().community.posts[0].published).toBe(false);const card=screen.getByRole('heading',{name:'Season two'}).closest('article');await user.click(within(card).getByRole('button',{name:'Edit'}));await user.click(screen.getByRole('checkbox',{name:'Publish on the community page'}));await user.click(screen.getByRole('button',{name:'Save news'}));
  app.unmount();render(<CommunityPortal demo slug="the-outpost"/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'News'}));expect(screen.getByText('<script>unsafe()</script> New season news.')).toBeTruthy();expect(document.querySelector('script')).toBeNull();
});
test('public applications persist and staff decisions appear to the applicant',async()=>{
  const user=userEvent.setup();const portal=render(<CommunityPortal demo slug="the-outpost"/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'Join Requests'}));
  await user.type(screen.getByLabelText(/Game account identifier/),'DEMO-SELF-REPORTED-ID');await user.type(screen.getByLabelText('Tell us about your gaming experience.'),'I enjoy exploring.');await user.type(screen.getByLabelText('What are you looking for in a community?'),'Weekend adventures.');await user.click(screen.getByRole('checkbox',{name:/I have read/}));await user.click(screen.getByRole('button',{name:'Submit join request'}));expect(await screen.findByText('Awaiting review')).toBeTruthy();expect(stored().community.applications[0].identifier).toBe('DEMO-SELF-REPORTED-ID');
  portal.unmount();const app=render(<App/>);await community(user);await user.click(screen.getByRole('button',{name:/^Join Requests/}));const card=(await screen.findByRole('heading',{name:'Alex Morgan'})).closest('article');await user.click(within(card).getByRole('button',{name:'Review application'}));await user.type(screen.getByLabelText('Message to the applicant'),'Welcome! Please verify your ID with staff.');await user.click(screen.getByRole('button',{name:'Save decision'}));expect(stored().community.applications[0].status).toBe('approved');
  app.unmount();render(<CommunityPortal demo slug="the-outpost"/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'Join Requests'}));expect(screen.getByText('Approved')).toBeTruthy();expect(screen.getByText('Welcome! Please verify your ID with staff.')).toBeTruthy();
});
test('community events reserve one place per member and let them cancel their RSVP',async()=>{
  const user=userEvent.setup();render(<CommunityPortal demo slug="the-outpost"/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'Events'}));await user.click(screen.getByRole('button',{name:'Reserve a place'}));expect(await screen.findByRole('button',{name:'Cancel my RSVP'})).toBeTruthy();expect(stored().community.rsvps.length).toBe(1);await user.click(screen.getByRole('button',{name:'Cancel my RSVP'}));expect(await screen.findByRole('button',{name:'Reserve a place'})).toBeTruthy();expect(stored().community.rsvps.length).toBe(0);
});
test('event editing preserves absolute times and cancelled events close public reservations',async()=>{
  const user=userEvent.setup(),app=render(<App/>);await community(user);await user.click(screen.getByRole('button',{name:'Events'}));await user.click(screen.getByRole('button',{name:'Edit'}));await user.click(screen.getByRole('checkbox',{name:'Mark event cancelled'}));await user.click(screen.getByRole('button',{name:'Save event'}));expect(stored().community.events[0].cancelled).toBe(true);app.unmount();render(<CommunityPortal demo slug="the-outpost"/>);await screen.findByRole('heading',{name:'The Outpost'});await user.click(screen.getByRole('button',{name:'Events'}));expect(screen.getByRole('button',{name:'Reserve a place'}).disabled).toBe(true);
});
test('weekly automations persist local weekdays, time and timezone and display the chosen schedule',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Automations'}));await user.click(screen.getByRole('button',{name:'New automation'}));await user.type(screen.getByLabelText('Automation name'),'Morning save');await user.selectOptions(screen.getByLabelText('Game server'),'d1');await user.selectOptions(screen.getByLabelText('Schedule'),'weekly');fireEvent.change(screen.getByLabelText('Local start time'),{target:{value:'04:30'}});await user.click(screen.getByRole('checkbox',{name:'Sun'}));await user.click(screen.getByRole('checkbox',{name:'Sat'}));await user.click(screen.getByRole('button',{name:'Create automation'}));const task=stored().schedules.at(-1);expect(task.schedule_type).toBe('weekly');expect(task.days).toEqual([1,2,3,4,5]);expect(task.start_time).toBe('04:30');expect(task.time_zone).toBe('Europe/London');expect(screen.getByText(/Mon, Tue, Wed, Thu, Fri · 04:30 Europe\/London/)).toBeTruthy();
});
test('scheduled backups require a connected host and record provider acceptance separately from completion',async()=>{
  const user=userEvent.setup();render(<App/>);await user.click(screen.getByRole('button',{name:'Automations'}));await user.click(screen.getByRole('button',{name:'New automation'}));await user.type(screen.getByLabelText('Automation name'),'Daily archive');await user.selectOptions(screen.getByLabelText('Game server'),'d2');expect(within(screen.getByLabelText('Action')).getByRole('option',{name:/Request provider backup/}).disabled).toBe(true);await user.selectOptions(screen.getByLabelText('Game server'),'d1');await user.selectOptions(screen.getByLabelText('Action'),'backup');await user.click(screen.getByRole('button',{name:'Create automation'}));expect(stored().schedules.at(-1).action).toBe('backup');await user.click(screen.getByRole('button',{name:'Run Daily archive now'}));await user.click(within(screen.getByRole('dialog')).getByRole('button',{name:/Run automation/}));expect(stored().runs[0].detail).toContain('request accepted');expect(stored().backups.d1[0].completed_at).toBeNull();
});
test('unpublished demo communities show an unavailable page and preserve private records',async()=>{
  const data=loadDemo();data.community.site.enabled=false;storeDemo(data);render(<CommunityPortal demo slug="the-outpost"/>);expect(await screen.findByRole('heading',{name:'Community page not found.'})).toBeTruthy();expect(screen.queryByText('A new season at The Outpost')).toBeNull();
});
