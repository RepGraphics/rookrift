# Community hub, site editor and calendar automations

Release 0.7 adds community workflows inspired by the jobs covered by [GameServerApp community tools](https://www.gameserverapp.com/feature/community-tools) and [scheduled tasks](https://www.gameserverapp.com/feature/automations-tasks). Rookrift implements these independently using the existing ARK adapters, staff permissions and subscription allowances.

## Publish a community hub

Open **Community hub → Community page**. Set a name, address, introduction, Discord invite and community rules. Select the servers whose status you want to publish, then enable **Publish this community page** and save. Live pages are served at `https://YOUR_APP_DOMAIN/c/your-community` without requiring dashboard access.

New installations start with no published page. Publishing is explicit. Unpublishing returns 404 for the public page and closes its public API, applications and RSVPs. Changing the address breaks existing links. The ChatGPT Site retains its existing owner-private audience and demonstrates these pages using browser-local sample data; use your Dokploy domain for a real public community page.

The public server list includes selected, plan-entitled servers only. It exposes names, game/map labels, status, player counts/capacity and the last check time. Connection details are hidden unless the owner explicitly enables their display. Credentials, player identities, staff notes, incidents and draft news remain private. Checks older than three minutes show unknown status. Maintenance is labelled separately. Public API responses are not cached in Redis or by shared HTTP caches.

## News

Use **News → Write an update** to create a draft. Enable publication when it is ready. Edit or remove news from the same section. Public visitors see published updates in newest-first order. Content is plain text; HTML and scripts are displayed as text.

## Events and RSVPs

Create an event with a start/end time, details and optional capacity. Enter times in the timezone displayed by your browser; they are stored as absolute instants and displayed in each visitor's local timezone. Events may last up to seven days. Capacity 0 means unlimited places. Cancel an event to keep its notice visible while closing new RSVPs, or remove it and its RSVPs.

A local account or Discord sign-in is required to reserve a place. One account reserves at most one place per event. Event row locks prevent concurrent requests from exceeding capacity. Members can cancel their own reservation; names and account IDs are not exposed in public RSVP counts. New reservations close at the event start time. Past events remain on the public calendar for 30 days. Staff can edit capacity provided it remains at least the existing reservation count.

## Applications and staff review

In page settings, **Join Requests** and **Staff Applications** each have their own enabled toggle and up to six required questions, one per line. Disable either to hide its public menu/hero option and reject new submissions of that kind. Disable both to hide both application options. Existing submissions remain in separate staff review views. Applicants sign in with a local account or Discord, select ASE or ASA, supply their game identifier, answer the relevant questions and acknowledge the rules. Form revisions prevent old forms from being submitted against changed questions. Questions/answers are snapshotted for review.

Game IDs are **self-reported**. A Discord sign-in proves control of that Discord account, not control of the supplied UUID/EOSID/Steam ID. Application approval records a staff decision and applicant-visible message. It does not automatically whitelist a player, grant a game role, link player identities or deliver a paid perk. Staff should verify identity and apply in-game access separately.

Applicants can see only their own submissions and decision messages, and withdraw pending submissions. There can be only one pending application per account/type/community. A maximum of three submissions per account/community/day and a separate public write rate limit curb spam.

Owners and administrators with unrestricted server scope can manage pages, news and events. Unrestricted moderators can view/review applications. Scoped administrators/moderators and viewers cannot access the review queue. Decisions are atomic: a decided or withdrawn application cannot be decided again. Staff actions are audited. Administrators can remove decided/withdrawn application records and their answers; pending records must first be reviewed or withdrawn.

Existing Discord sessions work on public pages. Sign-in uses a validated same-origin return path to bring members back to their community. Player-only sign-ins do not create an unused management workspace; one is created if they later open a dashboard and have no workspace available.

## Calendar automations

Open **Automations → New automation**. Choose **Local time & weekdays**, select the days, enter a local time and an IANA timezone such as `Europe/London`. Selecting every day makes it a daily task. Existing interval tasks continue to work.

The scheduler runs once per chosen local day. It skips nonexistent daylight-saving times and uses the first occurrence of a repeated time. Downtime and maintenance do not cause a catch-up storm: each due task advances to its next future occurrence before execution. Failed actions are recorded without automatic retries. A manual **Run now** does not change the next scheduled occurrence. Pausing/resuming or editing recalculates the next future run.

Scheduled actions are **save world**, **announcement** and **request provider backup**. Backups require a verified Pterodactyl or Pelican connection for that server and use the same provider-action locks as manual host controls. They do not send a backup command over RCON. A successful scheduled backup run means the provider accepted the request; check **Operations → Hosting & backups** for completion/failure and storage use. Provider quotas, retention and storage charges remain under the owner's hosting account. Rookrift does not automatically delete provider archives.

Calendar and backup tasks use the existing scheduled-task allowance, including plan pauses and maintenance suppression. A single application runtime is still required; see [Dokploy setup](DOKPLOY.md).

## Allowances and upgrade

Community tools are included in the existing plans. News/event record limits per workspace are Scout 10, Tribe 50 and Cluster 250 for each collection. Application-record limits are Scout 200, Tribe 500 and Cluster 2,000. Deleting old records frees capacity; downgrades preserve stored records and prevent new additions over the lower limit. Public endpoints show at most 50 published news updates, 100 recent/upcoming events, and 50 of the signed-in member's applications. Staff review views show the newest 200 records for the chosen status.

PostgreSQL migration 2 applies automatically at startup and preserves existing schedules as interval tasks. Retain a database backup before upgrading. No new environment variables are required. Re-register Discord slash commands with `npm run bot:register`: `/rookrift community` returns the published hub link and `/rookrift applications` returns the pending count for the linked guild's authorised administrators. Bot replies remain private.

Release 0.10 adds configured purchase commands/Discord rewards to the [community storefront](STOREFRONT.md). Release 0.11 adds [in-game account linking](ACCOUNT-LINKING.md), community branding and expanded appearance controls. Automatic whitelist execution, verified inventory delivery, recurring supporter perks, forums, mod installation and host agents remain future work.


## Site editor and branding (0.11)

Save your community name and logo under **Community page**. The public header and browser title use that identity; a missing logo gets a community monogram. Use a public HTTPS logo URL or upload a PNG, JPEG, WebP or GIF up to 3 MB. SVG uploads and credential-bearing image URLs are rejected. A configured logo is also used as the public-page favicon.

Open **Community hub → Site editor → Brand & appearance**. Choose Forest, Ocean, Slate, Ember, Violet or Sand, or supply a custom accent. Set the default light/dark appearance and whether visitors can switch it. Button foreground and accent text contrast are adjusted automatically. Visitor preferences are stored separately per community in the browser.

Configure a HTTPS banner image, readable overlay, hero alignment/spacing, stat visibility, page width, filled/outlined cards, corner style, heading font and footer text. Show/hide the built-in server, news, event and rules navigation sections. Store and application visibility continue to follow their own controls. These design changes remain drafts until published, and the preview uses the same theme/hero/branding components as the public page.

Under **Pages & sections**, add up to six pages and twelve sections per page. Text, HTTPS images, linked callouts, live selected-server cards, published news and upcoming events are available. Move pages/sections up or down and inspect the draft preview. Content is escaped plain text; arbitrary HTML, CSS and scripts are not accepted.

**Save draft** stores the design privately. **Publish design** saves and publishes the current draft; public visitors receive only the published design. **Restore published design** discards unsaved/draft layout edits in favour of the last published layout. Undo keeps up to 25 editor changes in memory. Page navigation uses `?page=your-page-address`; built-in server/news/event/rule/store/application addresses are reserved. News and event publications still follow their own settings.

Existing published designs retain their pages and content, with default appearance settings added when edited. Migration 8 added the original site design/store tables; migration 16 adds account-link provenance. Back up PostgreSQL before upgrading. The default hub remains live until a custom design is published.
