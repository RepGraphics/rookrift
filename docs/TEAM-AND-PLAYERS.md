# Teams and persistent player records

Version 0.5 adds dashboard team membership and persistent player profiles. The hosted demo simulates these features locally; real invitations and shared workspaces run on the authenticated Node backend.

## Invite your staff

Open **Team → Invite staff member**, enter their Discord user ID, choose a role, and choose all servers or selected servers. Discord Developer Mode exposes Copy User ID. A cluster selector selects that cluster's current servers; future servers need a separate grant unless All servers was chosen.

The owner gets a link to share themselves. Rookrift does not send an email or Discord message. The intended recipient opens the link, signs in with the matching Discord account, reviews the workspace/role/server scope, and chooses **Accept invitation**. An invitation cannot be accepted by a different account. Links expire after seven days, work once, and can be revoked under Pending invitations. The raw link is shown only when created; revoke/reissue a lost link. Only its hash is stored server-side.

The invitation token is carried in the URL fragment and saved in tab-local session storage while Discord sign-in completes. It is removed from the address bar and cleared after acceptance or dismissal. Preview and acceptance use authenticated, CSRF-protected POST requests. No invitation link grants access by itself.

Use the **Active workspace** selector in the header to switch between your own workspace and accepted invitations. Selection belongs to the current login session. API requests resolve current membership and server grants again rather than trusting browser state or a cached role. Removing a member or changing their scope applies on their next request; an already accepted/in-progress game command cannot be recalled. If selected membership ends or becomes plan-paused, the next request rejects it and clears that selection; reload to return to an available workspace.

| Role | Permitted work |
| --- | --- |
| Owner | All servers, workspace settings, billing, team membership, community sharing, and all existing operations |
| Administrator | Granted connections, RCON controls, automation management, permitted maintenance windows, hosting/backup operations, moderation, profiles and notes |
| Moderator | Granted server checks, saves/broadcasts, kick/ban/unban, incident acknowledgement/notes, player profiles and private player notes |
| Viewer | Read-only permitted server status, player snapshots/profiles/notes, moderation records, analytics and task history; no game commands or record changes |

The staff dashboard hides unavailable operations, and API authorization independently enforces the same role and server boundaries. Workspace-wide announcement template administration requires an administrator with All servers access. Windows touching an ungranted server are excluded and cannot be edited. Billing, Discord/workspace settings, notification read state, team management, and ban-report sharing preferences remain owner-only. Scoped members do not receive hidden server records, their metrics, incidents, activity or ban matches through bootstrap or profile lookup.

Tribe includes **3 additional staff seats** and Cluster **10**; Scout is owner-only. Pending valid invitations reserve a seat. On downgrade, saved members remain, with access enabled for the oldest members up to the new limit and extras paused. The owner retains access. Removing/revoking a grant never deletes historical author/audit records.

The Team page shows up to 100 recent staff audit records: invitation and role changes, note edits/removals, and successful dashboard mutation requests. A command request record is not proof the game completed the requested action. Private note bodies and connection credentials are excluded from the audit detail.

Discord bot commands still use the existing guild Manage Server permission model. A dashboard role does not change someone's Discord permissions.

## Player profiles

Open **Players → Player profiles** or choose **Profile** on a connected-player row. Successful RCON snapshots create typed, game-scoped profiles. Search reported names or identifiers, filter by game/presence, and page through 25 results at a time.

A profile retains approximate first/last sightings, latest reported name per observed server, sighting count, private notes, and recorded moderation actions. It survives disappearance from the latest snapshot or a failed RCON connection. Presence uses the latest successful snapshot and current connection/plan state; a plan-paused or offline server is not presented as current presence.

This is sampled observation, not exact playtime or a continuous join/leave log. Sightings are counted once per distinct successful check timestamp. UUID/EOSID/Steam64/Game ID namespaces and ASE/ASA game scopes remain distinct. Profiles do not link accounts using similar names. Once a connection has player/moderation history, add a new connection to change its game so historical records keep their original game association.

Notes belong to a profile **and an observed server**. Authorised viewers can read them; moderators can create and edit/remove their own notes; administrators and the owner can edit/remove notes in their scope. Notes include their author and timestamps. The community ban directory never publishes their contents. A member who can access one server cannot read another server's notes or sightings for the same identifier.

Aggregate profiles, observations, and notes persist independently of the plan's rolling metric/activity history. Removing a server cascades its sightings and notes; profiles with no remaining visible sightings do not appear in the list. There is no historical backfill beyond the latest valid saved snapshot on upgrade. New observations start accumulating with successful checks.

## API and upgrade

`GET /api/bootstrap` now includes the current `access` and available `workspaces`. Workspace selection uses `POST /api/workspaces/switch` with `{workspace_id}`. Owner Team routes list members/audit, create/revoke invitations, and update/remove members. Invite preview/accept are available to their authenticated target account.

`GET /api/player-profiles` accepts `search`, `game` (all/asa/ase), `state` (all/online/offline), and `page`. `GET /api/player-profiles/:id` returns the scoped profile. Create a note with `POST /api/player-profiles/:id/notes` and `{server_id,body}`; edit with PATCH `{body}` or remove with DELETE at `.../notes/:noteId`. Notes allow 1–2,000 trimmed characters. Workspace IDs and actors come from the authenticated context, not request bodies. All authenticated API responses use `no-store`.

Stop the single application process and take a consistent database/WAL plus encryption-key backup before upgrading. Schema version 4 adds membership, invitations, session selections, staff audit, profiles, observations and notes. Existing owners retain owner access. Existing unexpired sessions remain usable. No invitation or staff grant is created automatically in a live database. The demo adds fictional staff and preserves local edits.

For the lower-priced defaults, configure fresh monthly GBP Stripe prices of **399 pence for Tribe** and **999 pence for Cluster**. Checkout verifies active status, amount, currency, and a one-month interval before creating a customer/checkout. Existing subscriptions are not repriced automatically. If replacing price IDs, preserve old entitled IDs in comma-separated `STRIPE_TRIBE_LEGACY_MONTHLY_PRICE_IDS` / `STRIPE_CLUSTER_LEGACY_MONTHLY_PRICE_IDS`. Legacy IDs grant entitlement during reconciliation but are never selected for new checkout. Update the Stripe customer portal's allowed prices too; it remains an operator-configured integration.
