import {beforeEach} from 'vitest';
// Each test starts at the dashboard. Reload/navigation persistence is tested
// explicitly within a test; a previous test's address must not select its page.
beforeEach(()=>window.history.replaceState(null,'','/dashboard'));
