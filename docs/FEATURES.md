# Everyday operations

The hosted preview demonstrates every workflow using local sample data. On a live deployment the same controls use the authenticated API, stored workspace settings, and supported game adapters.

## Start with a game task template

Open **Automations** or **Workflows**, then browse the [game-specific template library](TASK-TEMPLATES.md). Choose ARK Ascended, ARK Evolved, Minecraft Java or DayZ, filter by category, and select a target server. Saves, announcements, event reminders, provider backups, restart countdowns and connection checks open as editable disabled drafts. Requirements are shown before selection; unsupported host or game actions cannot be selected. Review the schedule, messages and steps before saving and enabling.

## Build reusable game configurations

Open **Configuration > Preset library** for ARK, Minecraft Java and DayZ examples. The [configuration toolkit](CONFIGURATION.md) provides friendly setting controls, a text editor, local file comparison, recognised-setting imports, patch copying/downloading and independent duplication. Minecraft/DayZ use manual patch exports; ARK retains guarded stopped-server host deployment. Saved copies share the existing plan allowance and revision history.

## Organise and edit a fleet

Open **Game servers**. Use the edit icon on a card, or **Manage → Edit connection**, to change its name, game, map label, capacity, RCON host/port, and server group. Group names are optional and shared across both ARK games. Filter by group, game, connection status, or maintenance, and sort by name, player count, or connection status.

Leave the password blank to retain the current encrypted secret. Entering a new password encrypts its replacement; the API never returns either value. A host, port, game, or password change clears the old connection status and player snapshot until the next authenticated check. A rename or group change preserves the connection. The demo discards passwords entirely.

## Run actions across several servers

Select individual cards or **Select visible**. Choose **Check connections**, **Save worlds**, or **Broadcast**. Review the selected server names and confirm. Announcements require a non-empty message, up to 300 characters. Selecting all visible servers preserves other existing selections; the toolbar always shows the total selection count, and the confirmation lists every target.

The API validates every server's workspace ownership and plan entitlement before executing the first command. A batch supports up to 20 distinct servers, with at most four independent RCON operations at a time. Results are shown per server, including partial failures. Failed commands are not automatically retried. Closing the browser or losing the HTTP response does not cancel commands already accepted by the backend; inspect activity and server state before retrying. For the newer reliability, moderation, and hosting tools, see [OPERATIONS.md](OPERATIONS.md).

`SaveWorld` updates a game's current world save. It does not create an independent backup, and these controls do not restart or shut down game processes.

## Maintenance mode

Use the wrench icon on a server card or **Manage → Maintenance mode**. Maintenance is persisted per server and:

- Skips scheduled saves and announcements, recording a skipped outcome when due.
- Suppresses its Discord offline/online alerts.
- Continues RCON monitoring and player snapshots.
- Keeps manual save, broadcast, player, and connection controls available.

End maintenance to resume normal behavior. Missed scheduled runs are not replayed. Connection changes during maintenance remain visible in the activity log. Maintenance does not stop the game server and does not free a plan slot.

The same operation is available in Discord:

```text
/rookrift maintenance server:<selection> enabled:true
/rookrift maintenance server:<selection> enabled:false
```

Run `npm run bot:register` again after upgrading to make this new slash subcommand available. The existing guild link and Manage Server permission checks apply.

## Player snapshots

Open **Players** for the latest reported names and IDs across online servers allowed by your plan. Search by player name, ID, or server; filter to one server. **Refresh players** opens a confirmed connection check across the workspace's entitled servers.

Rows show their check time. They are snapshots from `ListPlayers`, not a continuous connection stream or a join/leave history. Offline and plan-paused servers are excluded. Names and identifiers are supplied by the game server and displayed as text. Sample identifiers in the demo begin with `DEMO-`.

The connected-player table uses the latest per-server snapshot, replacing it after each successful check and clearing it on failed connectivity or credential changes. Version 0.5 also stores persistent typed sightings and private notes under Players > Player profiles; see [the teams and players guide](TEAM-AND-PLAYERS.md). These records are owner-visible through the authenticated dashboard; no public player directory is created.

## Edit, run, and inspect automations

Use the pencil icon under **Automations** to edit a task's name, server, action, message, and interval. Saving edits resets its next run to the new interval. Pausing preserves the task; enabling it starts a fresh interval.

The play button opens **Run automation now**. It runs the saved action once and leaves the next scheduled time unchanged. Manually running a paused task is allowed if it remains within the current plan. Maintenance and plan-paused tasks cannot be run from the dashboard. The backend records skipped maintenance attempts defensively.

Each task shows its latest execution status and time: successful, failed, skipped, or not run yet. The History button now provides up to 50 retained execution records. Detailed events also remain in the workspace activity log under your plan's retention policy. Failed tasks are not automatically retried.

## Control notifications and export activity

**Settings → Enable Discord connection alerts** controls workspace-wide offline/online messages to the linked channel. Disabling alerts preserves the channel, game monitoring, and activity records. Maintenance overrides alerts for individual servers. Existing alert settings can be changed while the bot is offline; changing the destination still requires validation.

Under **Activity log**, combine level, server, and text filters. **Export visible** downloads those displayed records as CSV, with UTC timestamps and server names. The live dashboard loads the latest 100 retained events; the export does not claim to be a full account archive. Quoted cells and potentially executable spreadsheet formulas are escaped. Server passwords and Discord credentials are never part of this export.

## Upgrading an existing installation

For release 0.6, use the PostgreSQL deployment and explicit SQLite import procedure in [DOKPLOY.md](DOKPLOY.md). Keep the original encryption key, stop the old application before taking its consistent snapshot, and do not run old/new backends against separate stores simultaneously. Register commands again and verify a test connection, task, maintenance and alert.

Existing demo workspaces are upgraded locally with group names, snapshot data, and default alert settings, preserving your prior server and automation edits.


## Community growth (0.9)

The [community hub](COMMUNITY.md) now includes independent join/staff forms and a multi-page site editor with private drafts and publication. The [storefront](STOREFRONT.md) supports separate connected merchant accounts, one-time purchases, payment/refund verification and staff delivery records. [Hosting connectors](HOSTING-PROVIDERS.md) support Pterodactyl, Pelican and Nitrado according to each provider?s tested API capabilities.

## Player activity in 0.22

Players now has an Activity & sessions tab with filtered observed sessions, estimated online time, per-player rankings, a snapshot timeline and CSV exports. Each profile includes its permitted server session history. The page distinguishes player absence from connection loss, monitoring gaps, process restarts and plan pauses. Timings are polling estimates; native join/leave events and exact playtime remain separate future integrations. See [player activity](PLAYER-ACTIVITY.md).
