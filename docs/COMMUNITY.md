# Community hub and calendar automations

Release 0.7 adds community workflows inspired by the jobs covered by [GameServerApp community tools](https://www.gameserverapp.com/feature/community-tools) and [scheduled tasks](https://www.gameserverapp.com/feature/automations-tasks). Rookrift implements these independently using the existing ARK adapters, staff permissions and subscription allowances.

## Publish a community hub

Open **Community hub → Community page**. Set a name, address, introduction, Discord invite and community rules. Select the servers whose status you want to publish, then enable **Publish this community page** and save. Live pages are served at `https://YOUR_APP_DOMAIN/c/your-community` without requiring dashboard access.

New installations start with no published page. Publishing is explicit. Unpublishing returns 404 for the public page and closes its public API, applications and RSVPs. Changing the address breaks existing links. The ChatGPT Site retains its existing owner-private audience and demonstrates these pages using browser-local sample data; use your Dokploy domain for a real public community page.

The public server list includes selected, plan-entitled servers only. It exposes names, game/map labels, status, player counts/capacity and the last check time. RCON addresses/ports, credentials, player identities, staff notes, incidents and draft news remain private. Checks older than three minutes show unknown status. Maintenance is labelled separately. Public API responses are not cached in Redis or by shared HTTP caches.

## News

Use **News → Write an update** to create a draft. Enable publication when it is ready. Edit or remove news from the same section. Public visitors see published updates in newest-first order. Content is plain text; HTML and scripts are displayed as text.

## Events and RSVPs

Create an event with a start/end time, details and optional capacity. Enter times in the timezone displayed by your browser; they are stored as absolute instants and displayed in each visitor's local timezone. Events may last up to seven days. Capacity 0 means unlimited places. Cancel an event to keep its notice visible while closing new RSVPs, or remove it and its RSVPs.

Discord sign-in is required to reserve a place. One account reserves at most one place per event. Event row locks prevent concurrent requests from exceeding capacity. Members can cancel their own reservation; names and account IDs are not exposed in public RSVP counts. New reservations close at the event start time. Past events remain on the public calendar for 30 days. Staff can edit capacity provided it remains at least the existing reservation count.

## Applications and staff review

Enable applications in page settings and write up to six required questions, one per line. The same questions support **join** and **staff** applications. Applicants sign in with Discord, select ASE or ASA, supply their game identifier, answer the questions and acknowledge the rules. Form revisions prevent old forms from being submitted against changed questions. Questions/answers are snapshotted for review.

Game IDs are **self-reported**. A Discord sign-in proves control of that Discord account, not control of the supplied UUID/EOSID/Steam ID. Application approval records a staff decision and applicant-visible message. It does not automatically whitelist a player, grant a game role, link player identities or deliver a paid perk. Staff should verify identity and apply in-game access separately.

Applicants can see only their own submissions and decision messages, and withdraw pending submissions. There can be only one pending application per account/type/community. A maximum of three submissions per account/community/day and a separate public write rate limit curb spam.

Owners and administrators with unrestricted server scope can manage pages, news and events. Unrestricted moderators can view/review applications. Scoped administrators/moderators and viewers cannot access the review queue. Decisions are atomic: a decided or withdrawn application cannot be decided again. Staff actions are audited. Administrators can remove decided/withdrawn application records and their answers; pending records must first be reviewed or withdrawn.

Existing Discord sessions work on public pages. Sign-in uses a validated same-origin return path to bring members back to their community. Player-only sign-ins do not create an unused management workspace; one is created if they later open a dashboard and have no workspace available.

## Calendar automations

Open **Automations → New automation**. Choose **Local time & weekdays**, select the days, enter a local time and an IANA timezone such as `Europe/London`. Selecting every day makes it a daily task. Existing interval tasks continue to work.

The scheduler runs once per chosen local day. It skips nonexistent daylight-saving times and uses the first occurrence of a repeated time. Downtime and maintenance do not cause a catch-up storm: each due task advances to its next future occurrence before execution. Failed actions are recorded without automatic retries. A manual **Run now** does not change the next scheduled occurrence. Pausing/resuming or editing recalculates the next future run.

Scheduled actions are **save world**, **announcement** and **request provider backup**. Backups require a verified Pterodactyl connection for that server and use the same provider-action locks as manual host controls. They do not send a backup command over RCON. A successful scheduled backup run means the provider accepted the request; check **Operations → Hosting & backups** for completion/failure and storage use. Provider quotas, retention and storage charges remain under the owner's hosting account. Rookrift does not automatically delete provider archives.

Calendar and backup tasks use the existing scheduled-task allowance, including plan pauses and maintenance suppression. A single application runtime is still required; see [Dokploy setup](DOKPLOY.md).

## Allowances and upgrade

Community tools are included in the existing plans. News/event record limits per workspace are Scout 10, Tribe 50 and Cluster 250 for each collection. Application-record limits are Scout 200, Tribe 500 and Cluster 2,000. Deleting old records frees capacity; downgrades preserve stored records and prevent new additions over the lower limit. Public endpoints show at most 50 published news updates, 100 recent/upcoming events, and 50 of the signed-in member's applications. Staff review views show the newest 200 records for the chosen status.

PostgreSQL migration 2 applies automatically at startup and preserves existing schedules as interval tasks. Retain a database backup before upgrading. No new environment variables are required. Re-register Discord slash commands with `npm run bot:register`: `/rookrift community` returns the published hub link and `/rookrift applications` returns the pending count for the linked guild's authorised administrators. Bot replies remain private.

The working additions do not constitute feature parity with GSA. Multi-step/event-triggered workflows, automatic whitelist execution, merchant accounts/store fulfillment, configuration deployment and host agents remain separate future work.
